// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { coins } from "../../web/fingerprint/data.js";
import { sculptureFailureMessage } from "../../web/fingerprint/render.js";
const state = vi.hoisted(() => ({
  constructorFails: false,
  shaderFails: false,
  instances: [] as any[],
}));
vi.mock("three", async (original) => {
  const actual = await original<object>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      debug = { onShaderError: null as any };
      loop: any = null;
      dispose = vi.fn();
      setPixelRatio = vi.fn();
      setSize = vi.fn();
      constructor() {
        if (state.constructorFails) throw new Error("context unavailable");
        state.instances.push(this);
      }
      setAnimationLoop(callback: any) {
        this.loop = callback;
      }
      render() {
        if (state.shaderFails) this.debug.onShaderError?.();
      }
    },
  };
});
import {
  createFluidMesh,
  mountFluid,
} from "../../web/fingerprint/sculpture.js";
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  state.instances = [];
  state.constructorFails = false;
  state.shaderFails = false;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
const options = () => ({
  isPaused: () => false,
  reduced: () => false,
  onFailure: vi.fn(),
});
it("creates material directly from GLSL without evaluating Shader Park DSL", () => {
  const evaluate = vi.spyOn(globalThis, "eval").mockImplementation(() => {
    throw new Error("runtime eval must not be used");
  });
  try {
    const mesh = createFluidMesh(coins[0], { value: 68 });
    expect(mesh.material.fragmentShader).toContain("uniform float warp");
    expect(mesh.material.uniforms._scale.value).toBe(1.5);
    expect(mesh.material.uniforms.mood.value).toBe(0.68);
    expect(evaluate).not.toHaveBeenCalled();
    mesh.geometry.dispose();
    mesh.material.dispose();
  } finally {
    evaluate.mockRestore();
  }
});
it("detects first-frame GPU compile failure, disposes resources and preserves the existing DOM", () => {
  state.shaderFails = true;
  const host = document.querySelector("#host")!;
  host.textContent = "placeholder";
  expect(() => mountFluid(host, coins[0], null, options())).toThrow(
    "SHADER_COMPILE",
  );
  expect(state.instances[0].dispose).toHaveBeenCalledOnce();
  expect(host.textContent).toBe("placeholder");
  expect(state.instances[0].loop).toBeNull();
});
it("releases the renderer and reports context loss after mounting", () => {
  const host = document.querySelector("#host")!,
    opts = options(),
    stop = mountFluid(host, coins[0], null, opts),
    renderer = state.instances[0];
  expect(host.querySelector("canvas")).not.toBeNull();
  renderer.domElement.dispatchEvent(
    new Event("webglcontextlost", { cancelable: true }),
  );
  expect(opts.onFailure).toHaveBeenCalledWith(
    expect.objectContaining({ code: "WEBGL_LOST" }),
  );
  expect(renderer.dispose).toHaveBeenCalledOnce();
  expect(renderer.loop).toBeNull();
  stop();
  expect(renderer.dispose).toHaveBeenCalledOnce();
});
it("does not blame module loading failures on device capability", () => {
  expect(
    sculptureFailureMessage(new ReferenceError("input is not defined")),
  ).toContain("加载或初始化失败");
  state.constructorFails = true;
  expect(() =>
    mountFluid(document.querySelector("#host")!, coins[0], null, options()),
  ).toThrow("WEBGL_CONTEXT");
});
it("does not allocate a WebGL renderer for a view removed while importing", () => {
  mountFluid(document.createElement("div"), coins[0], null, options())();
  expect(state.instances).toHaveLength(0);
});
