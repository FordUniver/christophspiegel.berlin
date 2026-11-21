// Match the SVG's contained aspect ratio with a simple invisible collision box.
// Letter strokes and gaps are rendered by the mask, independently of physics.
export function svgFigure({ name, path, width, height }) {
  const ratio = width / height;
  const w = Math.min(240, 240 * ratio), h = Math.min(240, 240 / ratio);
  const x = (240 - w) / 2, y = (240 - h) / 2;
  return { name, mask: `url(${JSON.stringify(path)})`, areaScale: 1, vertices: [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ] };
}

export function figurePlacements(count) {
  if (count <= 4) return [
    { left: 2, top: 8, size: 43 },
    { left: 48, top: 2, size: 46 },
    { left: 54, top: 49, size: 38 },
    { left: 6, top: 57, size: 36 },
  ];

  const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns);
  const width = 100 / columns, height = 100 / rows;
  return Array.from({ length: count }, (_, index) => ({
    left: index % columns * width + width * 0.06,
    top: Math.floor(index / columns) * height + height * 0.08,
    size: width * 0.85,
  }));
}
