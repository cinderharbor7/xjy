import { visualParameters } from "./data.js";
let paused = false;
export function setMotionPaused(value) {
  paused = value;
}
export function isMotionPaused() {
  return paused;
}
const reduced = () =>
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

// The same parametric surface powers the moving canvas and the immutable SVG edition.
export function contourPoints(
  p,
  latitude,
  time = 0,
  count = 100,
  mouse = { x: 0, y: 0 },
) {
  const points = [],
    phi = latitude * Math.PI;
  const tilt = -0.35 + mouse.y * 0.14,
    turn = 0.35 + mouse.x * 0.22 + time * 0.045;
  for (let j = 0; j <= count; j++) {
    const a = (j / count) * Math.PI * 2;
    const wave =
      Math.sin(a * 3 + phi * 4 + p.seed + time * 0.22) * p.roughness * 0.21 +
      Math.cos(a * 5 - phi * 3 + time * 0.14) * p.roughness * 0.07;
    const radius = Math.sin(phi) * (1 + wave);
    let x = radius * Math.cos(a),
      y = Math.cos(phi) * 1.12,
      z = radius * Math.sin(a);
    y +=
      Math.sin(a * 2 + phi * 2 + time * 0.16) *
      Math.sin(phi) *
      p.roughness *
      0.24;
    const xx = x * Math.cos(turn) + z * Math.sin(turn),
      zz = -x * Math.sin(turn) + z * Math.cos(turn);
    const yy = y * Math.cos(0.4) - zz * Math.sin(0.4),
      depth = y * Math.sin(0.4) + zz * Math.cos(0.4);
    x = xx * Math.cos(tilt) - yy * Math.sin(tilt);
    y = xx * Math.sin(tilt) + yy * Math.cos(tilt);
    const perspective = 3.8 / (3.8 - depth * 0.22);
    points.push([x * perspective, y * perspective, depth]);
  }
  return points;
}
export function mountFingerprints(container, coinList, sentiment) {
  const items = [...container.querySelectorAll("canvas[data-coin]")].map(
    (canvas) => {
      const coin = coinList.find((c) => c.id === canvas.dataset.coin),
        ctx = canvas.getContext("2d");
      return {
        canvas,
        ctx,
        p: visualParameters(
          coin,
          coin.visualIdentity ? { value: null } : sentiment,
        ),
        small: canvas.dataset.size === "small",
        visible: true,
        mouse: { x: 0, y: 0 },
      };
    },
  );
  let raf,
    last = 0,
    time = 0,
    drawn = false;
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const item = items.find((i) => i.canvas === e.target);
      if (item) {
        item.visible = e.isIntersecting;
        drawn = false;
      }
    }
  });
  const cleanups = [];
  for (const item of items) {
    observer.observe(item.canvas);
    if (!item.small) {
      const move = (e) => {
        const r = item.canvas.getBoundingClientRect();
        item.mouse = {
          x: ((e.clientX - r.left) / r.width) * 2 - 1,
          y: ((e.clientY - r.top) / r.height) * 2 - 1,
        };
      };
      const reset = () => (item.mouse = { x: 0, y: 0 });
      item.canvas.addEventListener("pointermove", move);
      item.canvas.addEventListener("pointerleave", reset);
      cleanups.push(() => {
        item.canvas.removeEventListener("pointermove", move);
        item.canvas.removeEventListener("pointerleave", reset);
      });
    }
  }
  function draw(stamp) {
    raf = requestAnimationFrame(draw);
    if (document.hidden || stamp - last < 50) return;
    const delta = Math.min(stamp - last, 100);
    last = stamp;
    if (!paused && !reduced()) time += delta / 1000;
    if ((paused || reduced()) && drawn) return;
    for (const item of items) {
      if (!item.visible) continue;
      const { canvas, ctx, p, small, mouse } = item,
        r = canvas.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 2);
      if (!r.width || !r.height) continue;
      if (
        canvas.width !== Math.round(r.width * dpr) ||
        canvas.height !== Math.round(r.height * dpr)
      ) {
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const size = Math.min(r.width, r.height) * (small ? 0.37 : 0.345),
        cx = r.width / 2,
        cy = r.height / 2;
      const bands = small ? 30 : 83,
        steps = small ? 54 : 112;
      ctx.lineWidth = small ? 1.05 : 1.4;
      for (let i = 1; i < bands; i++) {
        const latitude = i / bands,
          points = contourPoints(
            p,
            latitude,
            time * (0.3 + p.activity * 0.5),
            steps,
            mouse,
          );
        const hue = p.hue + Math.sin(latitude * Math.PI * 2 + p.mood * 2) * 66;
        const gradient = ctx.createLinearGradient(
          cx - size,
          cy - size,
          cx + size,
          cy + size,
        );
        gradient.addColorStop(0, `hsla(${hue - 38},65%,48%,.82)`);
        gradient.addColorStop(
          0.46,
          `hsla(${hue + 55},60%,${48 + p.mood * 8}%,.92)`,
        );
        gradient.addColorStop(1, `hsla(${hue + 130},65%,44%,.78)`);
        ctx.strokeStyle = gradient;
        ctx.beginPath();
        points.forEach(([x, y], j) =>
          j
            ? ctx.lineTo(cx + x * size, cy + y * size)
            : ctx.moveTo(cx + x * size, cy + y * size),
        );
        ctx.stroke();
      }
    }
    drawn = true;
  }
  raf = requestAnimationFrame(draw);
  const onResize = () => {
    drawn = false;
  };
  window.addEventListener("resize", onResize);
  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    cleanups.forEach((f) => f());
    window.removeEventListener("resize", onResize);
  };
}
export function fingerprintSVG(coin, sentiment) {
  const p = visualParameters(coin, sentiment);
  const paths = Array.from({ length: 18 }, (_, i) => {
    const points = contourPoints(p, (i + 1) / 20, 0, 42);
    const d = points
      .map(
        ([x, y], j) =>
          `${j ? "L" : "M"}${Math.round(240 + x * 160)} ${Math.round(226 + y * 160)}`,
      )
      .join("");
    return `<path d="${d}Z" stroke="hsl(${Math.round(p.hue + Math.sin(((i + 1) / 20) * 6.28 + p.mood * 2) * 66)},60%,48%)"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 520"><rect width="480" height="520" fill="#f1f4f8"/><g fill="none" stroke-width="2">${paths}</g><text x="32" y="473" font-family="sans-serif" font-size="24" fill="#202b3b">${coin.id} / Currency Fingerprint</text><text x="32" y="500" font-family="sans-serif" font-size="12" fill="#526177">${coin.mode === "demo" ? "Illustrative data" : "Market snapshot"} / Contour edition v1</text></svg>`;
}

export async function mountSculpture(host, coin, sentiment) {
  const [{ createSculpture }, THREE] = await Promise.all([
    import("shader-park-core"),
    import("three"),
  ]);
  const p = visualParameters(coin, sentiment);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.z = 4.6;
  const source = `let t = input(0.0); let warp = input(0.3); let mood = input(0.5); let seed = input(2.0); let s = getSpace(); let n = sin(s.x*4.0+seed+t*.3)*cos(s.y*3.0+t*.2)*sin(s.z*4.0+seed); metal(0.35); shine(0.7); color(0.45+sin(s.y*3.0+mood*3.0)*0.25,0.55+cos(s.x*2.0+seed)*0.25,0.7+sin(s.z*3.0)*0.2); rotateY(t*.12); sphere(0.82+n*warp*.38);`;
  let elapsed = 0,
    last = performance.now(),
    mx = 0,
    my = 0;
  const sculpture = createSculpture(
    source,
    () => ({ t: elapsed, warp: p.roughness, mood: p.mood, seed: p.seed }),
    { radius: 1.5 },
  );
  scene.add(sculpture);
  host.replaceChildren(renderer.domElement);
  const size = () => {
    const r = host.getBoundingClientRect();
    renderer.setSize(r.width, r.height);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  };
  size();
  const ro = new ResizeObserver(size);
  ro.observe(host);
  const move = (e) => {
    const r = host.getBoundingClientRect();
    mx = (e.clientX - r.left) / r.width - 0.5;
    my = (e.clientY - r.top) / r.height - 0.5;
  };
  host.addEventListener("pointermove", move);
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (!paused && !reduced()) elapsed += Math.min(now - last, 100) / 1000;
    last = now;
    if (document.hidden) return;
    sculpture.rotation.y = mx * 0.4;
    sculpture.rotation.x = my * 0.3;
    renderer.render(scene, camera);
  });
  return () => {
    renderer.setAnimationLoop(null);
    ro.disconnect();
    host.removeEventListener("pointermove", move);
    sculpture.geometry.dispose();
    sculpture.material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
