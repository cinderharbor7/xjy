import * as THREE from "three";
import shader from "./sculpture-shader.json";
import { visualParameters } from "./data.js";

const failure = (code, cause) =>
  Object.assign(new Error(code), { code, cause });

// Mirrors Shader Park's Three.js material contract, using its precompiled GLSL.
// Keeping this pure also lets the actual minified production module be tested without a GPU.
export function createFluidMesh(coin, sentiment) {
  const params = visualParameters(coin, sentiment);
  const uniforms = Object.fromEntries(
    shader.uniforms.map((uniform) => {
      const value = Array.isArray(uniform.value)
        ? new THREE[`Vector${uniform.value.length}`](...uniform.value)
        : uniform.value;
      return [uniform.name, { value }];
    }),
  );
  uniforms._scale.value = 1.5;
  uniforms.opacity.value = 1;
  uniforms.mouse.value.set(0, 0, 0);
  uniforms.warp.value = params.roughness;
  uniforms.mood.value = params.mood;
  uniforms.seed.value = params.seed;
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    transparent: true,
    side: THREE.BackSide,
  });
  material.extensions.fragDepth = false;
  return new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 8), material);
}

export function mountFluid(
  host,
  coin,
  sentiment,
  { isPaused, reduced, onFailure = () => {} },
) {
  if (!host.isConnected) return () => {};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    throw failure("WEBGL_CONTEXT", error);
  }
  let mesh,
    observer,
    disposed = false,
    shaderError = null;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.z = 4.6;
  let elapsed = 0,
    last = performance.now(),
    mx = 0,
    my = 0;
  const move = (event) => {
    const r = host.getBoundingClientRect();
    mx = (event.clientX - r.left) / Math.max(r.width, 1) - 0.5;
    my = (event.clientY - r.top) / Math.max(r.height, 1) - 0.5;
  };
  const leave = () => {
    mx = 0;
    my = 0;
  };
  const lost = (event) => {
    event.preventDefault();
    stop();
    onFailure(failure("WEBGL_LOST"));
  };
  function stop() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    observer?.disconnect();
    host.removeEventListener("pointermove", move);
    host.removeEventListener("pointerleave", leave);
    renderer.domElement.removeEventListener("webglcontextlost", lost);
    mesh?.geometry.dispose();
    mesh?.material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  const size = () => {
    const r = host.getBoundingClientRect(),
      width = Math.max(r.width, 1),
      height = Math.max(r.height, 1);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    mesh.material.uniforms.resolution.value.set(width, height);
  };
  try {
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    renderer.debug.onShaderError = () => {
      shaderError = failure("SHADER_COMPILE");
    };
    mesh = createFluidMesh(coin, sentiment);
    scene.add(mesh);
    size();
    // GPU compilation errors are otherwise only logged by Three.js, leaving a blank canvas.
    renderer.render(scene, camera);
    if (shaderError) throw shaderError;
    host.replaceChildren(renderer.domElement);
    observer = new ResizeObserver(size);
    observer.observe(host);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    renderer.setAnimationLoop(() => {
      if (disposed) return;
      const now = performance.now();
      if (!isPaused() && !reduced())
        elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      if (document.hidden) return;
      try {
        mesh.material.uniforms.t.value = elapsed;
        mesh.rotation.y = mx * 0.4;
        mesh.rotation.x = my * 0.3;
        renderer.render(scene, camera);
        if (shaderError) throw shaderError;
      } catch (error) {
        stop();
        onFailure(error);
      }
    });
    return stop;
  } catch (error) {
    stop();
    throw error;
  }
}
