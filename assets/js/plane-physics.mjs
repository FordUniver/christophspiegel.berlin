// Share regular polygon geometry between CSS clipping and the physics engine.
// The circle is smooth in CSS; its 48-sided collision hull differs by <0.3 px
// at the reference diameter of 240 px.
const referenceArea = 3 * Math.sqrt(3) / 2 * 120 ** 2; // Original hexagon area.
export const shapeLibrary = [
  { name: "circle", sides: 48, start: 0 },
  { name: "triangle", sides: 3, start: -Math.PI / 2 },
  { name: "square", sides: 4, start: Math.PI / 4, radius: 120 * Math.SQRT2 },
  { name: "pentagon", sides: 5, start: -Math.PI / 2 },
  { name: "hexagon", sides: 6, start: 0 },
  { name: "octagon", sides: 8, start: Math.PI / 8 },
].map(({ name, sides, start, radius = 120 }) => {
  const vertices = Array.from({ length: sides }, (_, index) => {
    const angle = start + index * 2 * Math.PI / sides;
    return { x: 120 + radius * Math.cos(angle), y: 120 + radius * Math.sin(angle) };
  });
  const clip = name === "circle" ? "circle(50%)"
    : "polygon(" + vertices.map(({ x, y }) => `${x / 240 * 100}% ${y / 240 * 100}%`).join(",") + ")";
  const area = name === "circle" ? Math.PI * radius ** 2
    : sides * radius ** 2 * Math.sin(2 * Math.PI / sides) / 2;
  // A sampled size represents the same filled area for every shape.
  return { name, vertices, clip, areaScale: Math.sqrt(referenceArea / area) };
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);

// Smoothly interpolate a seeded random field in space and time. It supplies
// fluid velocity, never an animation target or a repeating orbit.
function noise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const sx = smooth(x - ix), sy = smooth(y - iy), sz = smooth(z - iz);
  let value = 0;
  for (let dx = 0; dx <= 1; dx += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dz = 0; dz <= 1; dz += 1) {
        let hash = seed ^ Math.imul(ix + dx, 374761393)
          ^ Math.imul(iy + dy, 668265263) ^ Math.imul(iz + dz, 1442695041);
        hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
        const sample = ((hash ^ (hash >>> 16)) >>> 0) / 2147483648 - 1;
        value += sample * (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
      }
    }
  }
  return value;
}

export function createSimulation(Matter, shapes, seed) {
  const { Body, Composite, Engine, Vertices } = Matter;
  const engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
  let elapsed = 0;
  const bodies = shapes.map(shape => {
    if (!Vertices.isConvex(shape.vertices)) throw new Error("Expected a convex shape");
    const centroid = Vertices.centre(shape.vertices);
    const body = Body.create({
      vertices: shape.vertices, density: shape.density ?? 0.001,
      frictionAir: 0, friction: 0.1, restitution: 0.05,
    });
    return { body, centroid, rotation: shape.rotation, size: 240, origin: { x: 0, y: 0 } };
  });
  Composite.add(engine.world, bodies.map(item => item.body));

  function resize(layouts) {
    bodies.forEach((item, index) => {
      const { left, top, size } = layouts[index];
      const scale = size / item.size;
      const offset = { x: item.body.position.x - item.origin.x, y: item.body.position.y - item.origin.y };
      item.origin = { x: left + item.centroid.x * size / 240, y: top + item.centroid.y * size / 240 };
      Body.scale(item.body, scale, scale);
      Body.setPosition(item.body, { x: item.origin.x + offset.x * scale, y: item.origin.y + offset.y * scale });
      item.size = size;
      item.drag = item.body.area * 0.001 / 1.8;
    });
  }

  function reset() {
    for (const item of bodies) {
      Body.setPosition(item.body, item.origin);
      Body.setAngle(item.body, item.rotation);
      Body.setVelocity(item.body, { x: 0, y: 0 });
      Body.setAngularVelocity(item.body, 0);
      item.body.force.x = item.body.force.y = item.body.torque = 0;
    }
    Engine.clear(engine);
  }

  function current(x, y) {
    return {
      x: 14 * noise(x / 140, y / 140, elapsed / 6, seed),
      y: 14 * noise(x / 140, y / 140, elapsed / 6, seed ^ 0x517cc1b7),
    };
  }

  function applyFluid(item) {
    const { body } = item;
    // Matter reports velocities per 1/60 s; our force model uses pixels/second.
    const velocity = Body.getVelocity(body);
    const omega = Body.getAngularVelocity(body) * 60;
    const edges = body.vertices.map((a, i) => {
      const b = body.vertices[(i + 1) % body.vertices.length];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, length: Math.hypot(b.x - a.x, b.y - a.y) };
    });
    const perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
    // Surface drag at edge midpoints produces torque from the actual geometry.
    for (const point of edges) {
      const flow = current(point.x, point.y);
      const localX = velocity.x * 60 - omega * (point.y - body.position.y);
      const localY = velocity.y * 60 + omega * (point.x - body.position.x);
      const drag = item.drag * point.length / perimeter * 1e-6;
      Body.applyForce(body, point, { x: drag * (flow.x - localX), y: drag * (flow.y - localY) });
    }
    const dx = body.position.x - item.origin.x, dy = body.position.y - item.origin.y;
    const distance = Math.hypot(dx, dy);
    // No tether inside this free region. A soft boundary preserves composition.
    const radius = clamp(item.size * 0.24, 26, 44);
    if (distance > radius) {
      const force = item.body.mass * 1.2 * (distance - radius) * 1e-6 / distance;
      Body.applyForce(body, body.position, { x: -dx * force, y: -dy * force });
    }
  }

  function applyPointer(item, pointer) {
    const { body } = item;
    let nearest, distanceSquared = Infinity;
    for (let i = 0; i < body.vertices.length; i += 1) {
      const a = body.vertices[i], b = body.vertices[(i + 1) % body.vertices.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = clamp(((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
      const point = { x: a.x + t * dx, y: a.y + t * dy };
      const squared = (point.x - pointer.x) ** 2 + (point.y - pointer.y) ** 2;
      if (squared < distanceSquared) { distanceSquared = squared; nearest = point; }
    }
    const inside = Vertices.contains(body.vertices, pointer);
    const distance = Math.sqrt(distanceSquared);
    const reach = 42;
    if (!inside && distance >= reach) return;
    const direction = inside ? -1 : 1;
    let nx = direction * (nearest.x - pointer.x), ny = direction * (nearest.y - pointer.y);
    if (distance < 0.001) { nx = body.position.x - nearest.x; ny = body.position.y - nearest.y; }
    const length = Math.hypot(nx, ny) || 1;
    nx /= length; ny /= length;
    const proximity = inside ? 1 : (1 - distance / reach) ** 2;
    const velocity = Body.getVelocity(body);
    const approach = Math.max(0, (pointer.vx - velocity.x * 60) * nx + (pointer.vy - velocity.y * 60) * ny);
    const pressure = Math.min(180, 55 + 0.55 * approach);
    const force = item.body.area * 0.001 * proximity * 1e-6;
    Body.applyForce(body, nearest, {
      x: force * (pressure * nx + pointer.vx * 0.09),
      y: force * (pressure * ny + pointer.vy * 0.09),
    });
  }

  function step(seconds, pointer = null) {
    elapsed += seconds;
    for (const item of bodies) {
      applyFluid(item);
      if (pointer) applyPointer(item, pointer);
    }
    Engine.update(engine, seconds * 1000);
  }

  // Establish the initial shape sizes before setting their resting transforms.
  resize(shapes);
  reset();
  return { bodies, resize, reset, step };
}
