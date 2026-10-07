import { sculptToThreeJSShaderSource } from "shader-park-core";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sculptureSource } from "./sculpture-source.mjs";
export function compileSculpture() {
  const result = sculptToThreeJSShaderSource(sculptureSource);
  if (result.error || !result.vert || !result.frag)
    throw new Error(
      `Shader Park compilation failed: ${result.error ?? "missing shader output"}`,
    );
  return {
    generator: "shader-park-core@0.2.8",
    uniforms: result.uniforms,
    vertexShader: result.vert,
    fragmentShader: result.frag,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shader = compileSculpture();
  writeFileSync(
    new URL("../web/fingerprint/sculpture-shader.json", import.meta.url),
    JSON.stringify(shader) + "\n",
  );
  console.log(
    `Precompiled fluid shader: ${shader.fragmentShader.length} GLSL characters`,
  );
}
