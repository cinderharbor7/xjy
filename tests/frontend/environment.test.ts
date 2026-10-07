import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { loadLocalEnvironment } from "../../server/environment";

const fixture = mkdtempSync(join(tmpdir(), "xjy-env-"));
afterEach(() => {
  vi.unstubAllEnvs();
  for (const name of [".env", ".env.local"]) rmSync(join(fixture, name), { force: true });
});
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

it("local settings override base settings and inherited variables override both", () => {
  vi.stubEnv("XJY_TEST_LOCAL_SETTING", undefined);
  vi.stubEnv("XJY_TEST_BASE_SETTING", undefined);
  vi.stubEnv("XJY_TEST_INHERITED_SETTING", "inherited");
  writeFileSync(join(fixture, ".env"), "XJY_TEST_LOCAL_SETTING=base\nXJY_TEST_BASE_SETTING=base-only\nXJY_TEST_INHERITED_SETTING=base\n");
  writeFileSync(join(fixture, ".env.local"), "XJY_TEST_LOCAL_SETTING=local\nXJY_TEST_INHERITED_SETTING=local\n");
  loadLocalEnvironment(fixture);
  expect(process.env.XJY_TEST_LOCAL_SETTING).toBe("local");
  expect(process.env.XJY_TEST_BASE_SETTING).toBe("base-only");
  expect(process.env.XJY_TEST_INHERITED_SETTING).toBe("inherited");
});

it("requires no environment files for Mock startup", () => {
  vi.stubEnv("XJY_TEST_LOCAL_SETTING", undefined);
  expect(() => loadLocalEnvironment(fixture)).not.toThrow();
  expect(process.env.XJY_TEST_LOCAL_SETTING).toBeUndefined();
});
