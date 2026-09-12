/** B@3831987: 230px lesson cards, 280px generations, 150px branch lanes. */
export interface MapPoint { readonly x: number; readonly y: number; }
export interface MapCamera extends MapPoint { readonly z: number; }
export interface MapTreeNode { readonly key: string; readonly parent?: string; }
export function autoMapPositions(nodes: readonly MapTreeNode[]): Map<string, MapPoint> {
  const byId = new Map(nodes.map(node => [node.key, node]));
  const children = new Map<string, MapTreeNode[]>();
  for (const node of nodes) if (node.parent && byId.has(node.parent)) children.set(node.parent, [...children.get(node.parent) ?? [], node]);
  const positions = new Map<string, MapPoint>();
  let top = 30;
  const free = nodes.filter(node => !node.parent && !children.has(node.key));
  free.forEach((node, index) => positions.set(node.key, { x: 40 + index % 5 * 280, y: top + Math.floor(index / 5) * 150 }));
  if (free.length) top += Math.ceil(free.length / 5) * 150 + 40;
  for (const root of nodes.filter(node => !node.parent || !byId.has(node.parent))) {
    if (positions.has(root.key)) continue;
    let lanes = 0;
    const visit = (node: MapTreeNode, depth: number, lane: number): void => {
      if (positions.has(node.key)) return;
      positions.set(node.key, { x: 40 + depth * 280, y: top + lane * 150 });
      lanes = Math.max(lanes, lane);
      (children.get(node.key) ?? []).forEach((child, index) => { if (index > 0) lanes++; visit(child, depth + 1, index === 0 ? lane : lanes); });
    };
    visit(root, 0, 0); top += (lanes + 1) * 150 + 40;
  }
  // Incomplete projections stay visible; never lose an orphan while loading.
  for (const node of nodes) if (!positions.has(node.key)) { positions.set(node.key, { x: 40, y: top }); top += 150; }
  return positions;
}
export function zoomMap(camera: MapCamera, point: MapPoint, factor: number): MapCamera {
  const z = Math.min(1.6, Math.max(0.25, camera.z * factor));
  return { z, x: point.x - (point.x - camera.x) * z / camera.z, y: point.y - (point.y - camera.y) * z / camera.z };
}
export function fitMap(points: readonly MapPoint[], width: number, height: number): MapCamera {
  if (!points.length) return { x: 20, y: 150, z: 1 };
  const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
  const w = Math.max(...points.map(p => p.x)) + 230 - left, h = Math.max(...points.map(p => p.y)) + 130 - top;
  const usableHeight = Math.max(150, height - 180);
  const z = Math.min(1, Math.max(0.25, Math.min((width - 60) / w, usableHeight / h) * 0.96));
  return { z, x: (width - w * z) / 2 - left * z, y: 155 + (usableHeight - h * z) / 2 - top * z };
}
