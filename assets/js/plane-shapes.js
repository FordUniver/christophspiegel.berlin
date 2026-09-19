import { createSimulation, shapeLibrary } from "./plane-physics.mjs";

(async () => {
  const fields = [...document.querySelectorAll("[data-plane-shapes]")];
  if (!fields.length) return;
  const placements = [
    { left: 2, top: 8, size: 43 },
    { left: 48, top: 2, size: 46 },
    { left: 54, top: 49, size: 38 },
    { left: 6, top: 57, size: 36 },
  ];
  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const shuffled = items => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(any-pointer: fine)");
  const pointer = { active: false, x: 0, y: 0, vx: 0, vy: 0, time: 0 };
  const portraitParallaxRatio = 0.16;
  const groups = fields.map(field => {
    const slots = shuffled(placements);
    const count = Math.random() < 0.5 ? 2 : 3;
    // Two shapes always span the light/deep shades; a third adds the middle.
    const tones = shuffled(["light", "deep", "medium"].slice(0, count));
    const shapes = shuffled(shapeLibrary).slice(0, count).map(({ name, vertices, clip, areaScale }, index) => {
      const slot = slots[index];
      const element = document.createElement("span");
      const rotation = random(-20, 20);
      element.className = "plane-shape";
      element.dataset.planeShape = name;
      element.dataset.planeTone = tones[index];
      element.style.setProperty("--plane-left", (slot.left + random(-2, 2)) + "%");
      element.style.setProperty("--plane-top", (slot.top + random(-2, 2)) + "%");
      element.style.setProperty("--plane-size", (slot.size + random(-2, 2)) + "%");
      element.style.setProperty("--plane-area-scale", areaScale);
      element.style.setProperty("--plane-rotation", rotation + "deg");
      element.style.setProperty("--plane-clip", clip);
      element.style.setProperty("--plane-blur", random(0.8, 2.4).toFixed(2) + "px");
      field.append(element);
      return { element, vertices, rotation: rotation * Math.PI / 180, density: random(0.0008, 0.0014) };
    });
    return { field, portraitFrame: field.closest(".portrait")?.querySelector(".portrait-frame") ?? null,
      shapes, simulation: null, seed: Math.floor(random(0, 2147483647)),
      visible: true, left: 0, top: 0, width: 0, height: 0, parallax: 0 };
  });

  let frame = null, lastTime = null, accumulator = 0;
  let geometryDirty = true;
  const timeStep = 1 / 120;

  function measure() {
    for (const group of groups) {
      const rect = group.field.getBoundingClientRect();
      group.left = rect.left + window.scrollX;
      group.top = rect.top + window.scrollY;
      if (rect.width !== group.width || rect.height !== group.height) {
        const layouts = group.shapes.map(shape => ({ ...shape,
          left: shape.element.offsetLeft, top: shape.element.offsetTop,
          size: shape.element.offsetWidth,
        }));
        if (group.simulation) group.simulation.resize(layouts);
        else group.simulation = createSimulation(globalThis.Matter, layouts, group.seed);
        group.width = rect.width;
        group.height = rect.height;
        group.shapes.forEach((shape, index) => {
          const { centroid } = group.simulation.bodies[index];
          shape.element.style.setProperty("--plane-origin-x", centroid.x / 240 * 100 + "%");
          shape.element.style.setProperty("--plane-origin-y", centroid.y / 240 * 100 + "%");
        });
      }
    }
    geometryDirty = false;
  }

  function render(group) {
    if (group.portraitFrame) {
      group.portraitFrame.style.setProperty("--portrait-parallax-y",
        (group.parallax * portraitParallaxRatio).toFixed(3) + "px");
    }
    group.shapes.forEach((shape, index) => {
      const { body, origin } = group.simulation.bodies[index];
      shape.element.style.setProperty("--plane-x", (body.position.x - origin.x).toFixed(3) + "px");
      shape.element.style.setProperty("--plane-y", (body.position.y - origin.y + group.parallax).toFixed(3) + "px");
      shape.element.style.setProperty("--plane-angle", (body.angle * 180 / Math.PI).toFixed(3) + "deg");
    });
  }

  function animate(now) {
    frame = null;
    if (document.hidden || reducedMotion.matches || !groups.some(group => group.visible)) {
      lastTime = null;
      return;
    }
    if (geometryDirty) measure();
    accumulator += lastTime === null ? timeStep : clamp((now - lastTime) / 1000, 0, 0.05);
    lastTime = now;
    const { scrollX, scrollY } = window;
    while (accumulator >= timeStep) {
      for (const group of groups) {
        if (!group.visible) continue;
        // Parallax is a camera offset, never a force applied to the bodies.
        group.parallax += (clamp(scrollY * 0.18, -100, 100) - group.parallax) * (1 - Math.exp(-5 * timeStep));
        const localPointer = pointer.active && finePointer.matches ? {
          x: pointer.x - group.left + scrollX,
          y: pointer.y - group.top + scrollY - group.parallax,
          vx: pointer.vx, vy: pointer.vy,
        } : null;
        group.simulation.step(timeStep, localPointer);
      }
      pointer.vx *= Math.exp(-10 * timeStep);
      pointer.vy *= Math.exp(-10 * timeStep);
      accumulator -= timeStep;
    }
    groups.filter(group => group.visible).forEach(render);
    frame = requestAnimationFrame(animate);
  }

  function start() {
    if (frame === null && !document.hidden && !reducedMotion.matches && groups.some(group => group.visible)) {
      lastTime = null;
      accumulator = 0;
      frame = requestAnimationFrame(animate);
    }
  }
  function releasePointer() {
    pointer.active = false;
    pointer.vx = pointer.vy = 0;
  }
  window.addEventListener("pointermove", event => {
    if (event.pointerType === "touch" || !finePointer.matches || reducedMotion.matches) return;
    const dt = (event.timeStamp - pointer.time) / 1000;
    const continuous = pointer.active && dt > 0 && dt < 0.15;
    pointer.vx = continuous ? clamp((event.clientX - pointer.x) / dt, -600, 600) : 0;
    pointer.vy = continuous ? clamp((event.clientY - pointer.y) / dt, -600, 600) : 0;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.time = event.timeStamp;
    pointer.active = true;
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", releasePointer);
  window.addEventListener("pointercancel", releasePointer);
  window.addEventListener("blur", releasePointer);
  window.addEventListener("scroll", start, { passive: true });

  function invalidateGeometry() { geometryDirty = true; start(); }
  window.addEventListener("resize", invalidateGeometry, { passive: true });
  window.addEventListener("pageshow", invalidateGeometry);
  const resizeObserver = new ResizeObserver(invalidateGeometry);
  resizeObserver.observe(document.querySelector(".site-main"));
  groups.forEach(group => resizeObserver.observe(group.field));
  const intersectionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) groups.find(group => group.field === entry.target).visible = entry.isIntersecting;
    start();
  }, { rootMargin: "160px" });
  groups.forEach(group => intersectionObserver.observe(group.field));
  reducedMotion.addEventListener("change", () => {
    releasePointer();
    measure();
    for (const group of groups) {
      group.simulation.reset();
      group.parallax = 0;
      render(group);
    }
    start();
  });
  document.addEventListener("visibilitychange", () => { releasePointer(); start(); });
  measure();
  groups.forEach(render);
  start();
})().catch(error => console.error("Floating shapes:", error));
