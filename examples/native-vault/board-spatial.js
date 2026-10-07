/** Pure helpers for the lightweight SVG space-figure renderer. */
export function spatialTicks(from, to, limit = 16) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const start = Math.ceil(from), end = Math.floor(to);
  if (end < start) return [];
  const budget = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 256) : 16;
  const span = end - start, finiteSpan = Number.isFinite(span);
  const step = Math.max(1, Math.ceil(finiteSpan ? (span + 1) / budget : end / budget - start / budget));
  const count = finiteSpan ? Math.min(budget, Math.max(0, Math.floor(span / step) + 1)) : budget;
  return Array.from({ length: count }, (_, index) => {
    const value = start + index * step;
    return Number.isFinite(value) ? Math.min(end, Math.max(start, value)) : start * (1 - index / count) + end * (index / count);
  });
}

export function createSpatialProjector(bounds, camera, width = 760, height = 520) {
  const center = [(bounds.xmin + bounds.xmax) / 2, (bounds.ymin + bounds.ymax) / 2, (bounds.zmin + bounds.zmax) / 2];
  const extent = Math.max(bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin, bounds.zmax - bounds.zmin, 1);
  const scale = 0.62 * Math.min(width, height) / extent * camera.zoom;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  return point => {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) return [NaN, NaN, NaN];
    const [x, y, z] = point.map((value, index) => value - center[index]);
    const rx = x * cy - y * sy, ry0 = x * sy + y * cy;
    const ry = ry0 * cp - z * sp, depth = ry0 * sp + z * cp;
    return [width / 2 + rx * scale, height / 2 - ry * scale, depth];
  };
}

const add = (a, b) => a.map((value, index) => value + b[index]);
const multiply = (a, scalar) => a.map(value => value * scalar);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = vector => {
  const length = Math.hypot(...vector);
  return length > 1e-12 && Number.isFinite(length) ? multiply(vector, 1 / length) : null;
};

/** Returns a sampled ring in a plane normal to direction; zero directions are rejected. */
export function spatialRing(center, direction, radius, distance = 0, segments = 24) {
  const axis = unit(direction);
  if (!axis || !center.every(Number.isFinite) || !Number.isFinite(radius) || radius < 0 || !Number.isFinite(distance)) return [];
  const reference = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = unit(cross(axis, reference));
  if (!u) return [];
  const v = cross(axis, u);
  return Array.from({ length: segments }, (_, index) => {
    const theta = index * 2 * Math.PI / segments;
    const rim = add(multiply(u, Math.cos(theta) * radius), multiply(v, Math.sin(theta) * radius));
    return add(add(center, multiply(axis, distance)), rim);
  });
}

/** A cone's declared vertex is its apex; its circular base lies height units along the axis. */
export function spatialConeRings(apex, direction, radius, height, segments = 24) {
  return {
    apex: spatialRing(apex, direction, 0, 0, segments),
    base: spatialRing(apex, direction, radius, height, segments),
  };
}

export function spatialPointMap(spec, values, compileExpression) {
  const scope = { ...values };
  const evaluate = source => {
    const value = compileExpression(String(source), Object.keys(scope)).evaluate(scope);
    if (!Number.isFinite(value)) throw new Error('spatial_expression_invalid');
    return value;
  };
  const points = new Map();
  for (const item of spec.objects) if (item.kind === 'point') points.set(item.name, [evaluate(item.x), evaluate(item.y), evaluate(item.z)]);
  for (const item of spec.objects) if (item.kind === 'midpoint') {
    const a = points.get(item.points[0]), b = points.get(item.points[1]);
    if (a && b) points.set(item.name, a.map((value, index) => (value + b[index]) / 2));
  }
  // Validate every scalar expression before React renders the object tree, so a
  // runtime domain error becomes a local figure message instead of an uncaught render error.
  for (const item of spec.objects) for (const key of ['x', 'y', 'z', 'dx', 'dy', 'dz', 'radius', 'height', 'top']) {
    if (typeof item[key] === 'string') evaluate(item[key]);
  }
  return { points, evaluate, objects: spec.objects };
}
