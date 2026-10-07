// Production minification regression, without opening a browser or requiring a GPU.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { compileSculpture } from "./compile-sculpture.mjs";
import { coins } from "../web/fingerprint/data.js";
const shader = JSON.parse(
  readFileSync("web/fingerprint/sculpture-shader.json", "utf8"),
);
assert.deepEqual(
  shader,
  compileSculpture(),
  "generated shader must match the build-time source",
);
await build({
  logLevel: "error",
  build: {
    outDir: resolve("output/sculpture-regression"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve("web/fingerprint/sculpture.js"),
      preserveEntrySignatures: "strict",
      output: { entryFileNames: "sculpture.mjs" },
    },
  },
});
const original = globalThis.eval;
try {
  globalThis.eval = () => {
    throw new Error(
      "Runtime eval reintroduced into the production fluid module",
    );
  };
  const module = await import(
    pathToFileURL(resolve("output/sculpture-regression/sculpture.mjs"))
  );
  for (const coin of coins) {
    const mesh = module.createFluidMesh(
      { ...coin, amplitude: 4, volume: 1e9 },
      { value: 68 },
    );
    assert.equal(mesh.material.fragmentShader, shader.fragmentShader);
    assert.equal(mesh.material.uniforms.mood.value, 0.68);
    assert.equal(mesh.material.uniforms._scale.value, 1.5);
    assert.ok(mesh.geometry.attributes.position.count > 0);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
} finally {
  globalThis.eval = original;
}
const assets = readdirSync("dist/assets").filter((f) => f.endsWith(".js"));
assert.ok(
  assets.some((f) => f.startsWith("sculpture-")),
  "main production build must include the fluid renderer",
);
for (const file of assets) {
  const js = readFileSync(resolve("dist/assets", file), "utf8");
  assert.ok(
    !js.includes("sculptToGLSL"),
    "Shader Park compiler must not ship to browsers",
  );
  assert.ok(
    !js.includes("createSculpture("),
    "runtime DSL compilation must not ship",
  );
}
const result = {
  precompiledSource: "matches",
  minifiedProductionMaterials: coins.length,
  runtimeEval: "not used",
  browserCompiler: "absent",
  gpuRendering: "not visually verified",
};
mkdirSync("output/sculpture-regression", { recursive: true });
writeFileSync(
  "output/sculpture-regression/result.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
