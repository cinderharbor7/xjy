import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EventSchema, GuardianError, StateSchema, type GuardianEvent, type GuardianState } from "./contracts";

/** One SQLite file owns config, lease and all events, atomically; never put it in Git. */
export class GuardianStore {
  private readonly db: DatabaseSync;
  constructor(path: string, initial: GuardianState) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS guardian (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, body TEXT NOT NULL);");
    this.db.prepare("INSERT OR IGNORE INTO guardian VALUES (1, ?)").run(JSON.stringify(StateSchema.parse(initial)));
    const saved = this.read();
    if (saved.wallet !== initial.wallet || saved.mode !== initial.mode) {
      this.db.close();
      throw new GuardianError(503, "STORE_BINDING_MISMATCH", "The durable state belongs to another wallet or mode. Use its original runtime configuration.");
    }
  }
  read(): GuardianState { return StateSchema.parse(JSON.parse((this.db.prepare("SELECT body FROM guardian WHERE id=1").get() as { body: string }).body)); }
  event(id: string): GuardianEvent {
    const row = this.db.prepare("SELECT body FROM events WHERE id=?").get(id) as { body: string } | undefined;
    if (!row) throw new GuardianError(503, "EVENT_MISSING", "The active event record is unavailable; execution is blocked.");
    return EventSchema.parse(JSON.parse(row.body));
  }
  events(): GuardianEvent[] { return this.db.prepare("SELECT body FROM events ORDER BY rowid DESC LIMIT 20").all().map(row => EventSchema.parse(JSON.parse(row.body as string))); }
  change<T>(fn: (state: GuardianState, saveEvent: (event: GuardianEvent) => void) => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.read();
      const result = fn(state, event => this.db.prepare("INSERT INTO events VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(event.id, JSON.stringify(EventSchema.parse(event))));
      this.db.prepare("UPDATE guardian SET body=? WHERE id=1").run(JSON.stringify(StateSchema.parse(state)));
      this.db.exec("COMMIT");
      return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  close() { this.db.close(); }
}
