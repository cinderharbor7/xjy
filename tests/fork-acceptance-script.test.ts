import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("isolated Fork acceptance startup", () => {
  it.each([18545, 3107])("refuses occupied port %i before launching or modifying a node", async port => {
    const server = createServer();
    await new Promise<void>((ready, reject) => {
      server.once("error", reject); server.listen(port, "127.0.0.1", ready);
    });
    const child = spawn(process.execPath, [resolve("scripts/verify-guardian-fork.mjs"), "unused-anvil", "http://unused.invalid"],
      { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    try {
      const code = await new Promise<number | null>((done, reject) => { child.once("error", reject); child.once("exit", done); });
      expect(code).toBe(1);
      expect(output).toContain(`Acceptance port ${port} is already in use`);
      expect(output).not.toContain("Acceptance wait timed out");
    } finally {
      if (child.exitCode === null) child.kill();
      await new Promise<void>(done => server.close(() => done()));
    }
  });
});
