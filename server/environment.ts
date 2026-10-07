import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnvironment(root: string): void {
  // loadEnvFile preserves existing values: load the most specific file first.
  // Inherited process variables keep precedence over either file.
  for (const file of [".env.local", ".env"]) {
    const path = resolve(root, file);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}
