import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const dir = resolve("output/unified-preview");
mkdirSync(dir, { recursive: true });
const port = process.env.PORT || "3100";
const child = spawn(
  process.execPath,
  ["--import", "tsx", "server/index.ts", "--production"],
  {
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: port,
      XJY_ISOLATED_PREVIEW: "1",
      GUARDIAN_MODE: "MOCK",
      MOCK_MODE: "true",
      GUARDIAN_ORIGIN: `http://localhost:${port}`,
      GUARDIAN_DB_PATH: resolve(dir, "state.sqlite"),
      GUARDIAN_WALLET: "0x1111111111111111111111111111111111111111",
      GUARDIAN_SIGNAL_FILE: "",
    },
  },
);
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
process.once("SIGTERM", () => child.kill());
process.once("SIGINT", () => child.kill());
