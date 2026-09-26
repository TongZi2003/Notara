/**
 * 森林: the light theme's reading of the same star projections. Each split
 * tree is one plot of land seen at an isometric angle, every node a thing
 * planted on its own tile: a tree that grows with real evidence, bare soil
 * where nothing has been evaluated, a bush or a rock for what stays outside
 * mastery. A course route is a road through one strip of land, a finished
 * lesson a golden ginkgo beside it.
 *
 * Nothing here withers. A real difficulty only keeps a tree small, and no
 * evidence is soil, not a failure. A parent's coverage is never drawn into its
 * tree: it shows as the grass, which is fresh only under evaluated nodes.
 * Relations are not drawn; the structure board is where they are read.
 */
import { splitTree, starHash, starLight } from './star-light.js';

export const TILE_W = 64, TILE_H = 32;
const PLOT_GAP = 2, SLACK = 1.5, TAU = Math.PI * 2;
/** Tile (i, j) to world coordinates: i runs down-right, j down-left. */
export const isoPoint = (i, j) => ({ x: (i - j) * TILE_W / 2, y: (i + j) * TILE_H / 2 });

/** Every form the forest can plant; there is no withered one. */
export const FOREST_FORMS = ['mound', 'sprout', 'sapling', 'tree', 'oak', 'bush', 'rock', 'ginkgo', 'stake'];

/** What grows on a node's tile, and how tall at zoom 1, from its light only. */
export function forestGrowth(star) {
  const light = starLight(star), L = light.level;
  if (star?.kind === 'course') return light.state === 'lit' ? { form: 'ginkgo', height: 56 } : light.state === 'opened' ? { form: 'sprout', height: 20 } : { form: 'stake', height: 16 };
  if (light.state === 'lit') {
    if (star.kind === 'parent') return { form: 'oak', height: 46 + 30 * L };
    return { form: L < .3 ? 'sprout' : L < .55 ? 'sapling' : 'tree', height: 18 + 44 * L };
  }
  const outside = star?.kind === 'unlinked' || light.state === 'unlinked';
  if (outside) return star?.node?.kind && star.node.kind !== 'page' ? { form: 'rock', height: 11 } : { form: 'bush', height: 15 };
  return { form: 'mound', height: star?.kind === 'parent' ? 12 : 9 };
}

/**
 * Where a planted node takes clicks, in pixels at `zoom`: as tall as the tree
 * and narrower than a tile, rising from the ground so the label starts there.
 * A nearer tile stacks above a farther one, the way the trees overlap.
 */
export function forestHit(star, zoom, point) {
  const height = Math.max(22, (forestGrowth(star).height + 4) * zoom), width = Math.max(22, Math.min(height * .7, TILE_W * zoom * .62));
  return { width, height, lift: height / 2, z: 1 + (point?.i ?? 0) + (point?.j ?? 0) };
}

/** Fresh grass grows only under a node real evidence has reached. */
export const forestLush = star => starLight(star).state === 'lit';

/** One plot's interior tiles in planting order: nearest ring first, then nearest, then a seeded tie-break. */
function nearestFree(taken, side, from, key) {
  let best = null;
  for (let ring = 1; ring <= side && !best; ring += 1) {
    for (let di = -ring; di <= ring; di += 1) for (let dj = -ring; dj <= ring; dj += 1) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
      const i = from.i + di, j = from.j + dj;
      if (i < 1 || j < 1 || i > side || j > side || taken.has(`${i},${j}`)) continue;
      const rank = [ring, di * di + dj * dj, starHash(`${key}@${i},${j}`, 3)];
      if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && (rank[1] < best.rank[1] || (rank[1] === best.rank[1] && rank[2] < best.rank[2])))) best = { i, j, rank };
    }
  }
  return best;
}

/** A split tree becomes one square plot: the root in the middle, each node on the free tile nearest its parent. */
function grove(root, children) {
  const order = [[root, 0]];
  for (let index = 0; index < order.length; index += 1) for (const kid of children.get(order[index][0])) order.push([kid, order[index][1] + 1]);
  const inner = Math.max(2, Math.ceil(Math.sqrt(order.length * SLACK))), centre = 1 + Math.floor((inner - 1) / 2);
  const tiles = new Map([[root, { i: centre, j: centre, depth: 0 }]]), taken = new Set([`${centre},${centre}`]), parentOf = new Map();
  for (const [key] of order) for (const kid of children.get(key)) parentOf.set(kid, key);
  for (const [key, depth] of order.slice(1)) {
    const spot = nearestFree(taken, inner, tiles.get(parentOf.get(key)), key);
    tiles.set(key, { i: spot.i, j: spot.j, depth }); taken.add(`${spot.i},${spot.j}`);
  }
  return { key: root, root, side: inner + 2, tiles };
}

/** Everything outside a split tree shares one meadow, planted outward from its middle. */
function meadow(keys) {
  const inner = Math.max(2, Math.ceil(Math.sqrt(keys.length * SLACK))), centre = 1 + Math.floor((inner - 1) / 2), spots = [];
  for (let i = 1; i <= inner; i += 1) for (let j = 1; j <= inner; j += 1) spots.push({ i, j, ring: Math.max(Math.abs(i - centre), Math.abs(j - centre)), d: (i - centre) ** 2 + (j - centre) ** 2, h: starHash(`meadow@${i},${j}`, 4) });
  spots.sort((a, b) => a.ring - b.ring || a.d - b.d || a.h - b.h);
  return { key: 'meadow', root: null, side: inner + 2, tiles: new Map(keys.map((key, index) => [key, { i: spots[index].i, j: spots[index].j, depth: 0 }])) };
}

/** Plots packed in rows, the largest first, with a lane of grass-free ground between them. */
function pack(beds) {
  const sorted = [...beds].sort((a, b) => b.side - a.side || String(a.key).localeCompare(String(b.key)));
  const width = Math.max(sorted[0]?.side ?? 0, Math.ceil(Math.sqrt(sorted.reduce((sum, bed) => sum + (bed.side + PLOT_GAP) ** 2, 0))));
  const points = new Map(), plots = [];
  let ci = 0, cj = 0, row = 0;
  for (const bed of sorted) {
    if (ci > 0 && ci + bed.side > width) { ci = 0; cj += row + PLOT_GAP; row = 0; }
    plots.push({ key: bed.key, i: ci, j: cj, w: bed.side, h: bed.side });
    for (const [key, tile] of bed.tiles) {
      const i = ci + tile.i, j = cj + tile.j;
      points.set(key, { i, j, ...isoPoint(i, j), depth: tile.depth, root: bed.root, plot: bed.key });
    }
    ci += bed.side + PLOT_GAP; row = Math.max(row, bed.side);
  }
  return { points, plots };
}

/**
 * The knowledge forest over the whole filtered projection, so expanding a
 * layer plants trees where they already belong. References move nothing.
 */
export function forestLayout(nodes = [], edges = []) {
  const keys = nodes.map(node => node.key), { parentOf, children } = splitTree(keys, edges);
  const beds = [], loose = [];
  for (const key of keys) if (!parentOf.has(key)) (children.get(key).length ? beds.push(grove(key, children)) : loose.push(key));
  if (loose.length) beds.push(meadow(loose));
  const { points, plots } = pack(beds), titles = new Map(nodes.map(node => [node.key, node.title]));
  // Each plot's name stands on a sign at its front corner, a border tile nothing grows on.
  const groups = plots.filter(plot => plot.key !== 'meadow').map(plot => {
    const i = plot.i + plot.w - 1, j = plot.j + plot.h - 1;
    return { key: `plot:${plot.key}`, label: titles.get(plot.key) || plot.key, i, j, ...isoPoint(i, j) };
  });
  return { points, plots, roads: [], groups, figures: [] };
}

/**
 * A route as one strip of land: 主线 lessons stand beside a road in order, a
 * new 阶段 leaves a tile of space and puts up a sign, and 条件补练 / 拓展 are
 * planted below or above the lesson they branch from.
 */
export function routeForestLayout(rows = [], edges = []) {
  const tiles = new Map(), taken = new Set();
  const claim = (key, i, j, step, extra) => { while (j === 0 || taken.has(`${i},${j}`)) j += step; tiles.set(key, { i, j, ...extra }); taken.add(`${i},${j}`); };
  let i = 0, index = 0, previous = null;
  const onMain = (row, stage) => { claim(row.key, i, -1, -1, { depth: index, stage }); i += 2; index += 1; };
  for (const row of rows) {
    if (row.pathway !== 'main') continue;
    const stage = row.stage || '';
    if (index && stage !== previous) i += 1;
    previous = stage; onMain(row, stage);
  }
  const sourceOf = key => edges.find(edge => edge.target === key && (edge.kind === 'branch' || edge.kind === 'sequence'))?.source;
  const hung = new Map();
  for (const row of rows) {
    if (tiles.has(row.key)) continue;
    const source = sourceOf(row.key), from = tiles.get(source);
    if (!from) { onMain(row, row.stage || ''); continue; }
    const below = row.pathway !== 'extension', slot = hung.get(`${source}:${below}`) ?? 0;
    hung.set(`${source}:${below}`, slot + 1);
    const lane = Math.floor(slot / 2);
    claim(row.key, from.i + slot % 2, below ? Math.max(1, from.j + 1) + lane : Math.min(-2, from.j - 1) - lane, below ? 1 : -1, { depth: from.depth + 1, stage: from.stage });
  }
  if (!tiles.size) return { points: new Map(), plots: [], roads: [], groups: [], figures: [] };
  // A 阶段 puts up a sign on the verge just before its first lesson.
  const signs = [];
  for (const stage of new Set([...tiles.values()].map(tile => tile.stage))) {
    if (!stage) continue;
    const first = Math.min(...[...tiles.values()].filter(tile => tile.stage === stage).map(tile => tile.i));
    let j = 1; while (taken.has(`${first - 1},${j}`)) j += 1;
    taken.add(`${first - 1},${j}`); signs.push({ key: `stage:${stage}`, label: stage, i: first - 1, j, ...isoPoint(first - 1, j) });
  }
  const all = [...tiles.values(), ...signs], is = all.map(tile => tile.i), js = all.map(tile => tile.j);
  const plot = { key: 'route', i: Math.min(...is) - 1, j: Math.min(-1, ...js) - 1, w: 0, h: 0 };
  plot.w = Math.max(...is) + 2 - plot.i; plot.h = Math.max(1, ...js) + 2 - plot.j;
  const points = new Map([...tiles].map(([key, tile]) => [key, { ...tile, ...isoPoint(tile.i, tile.j), root: null, plot: 'route' }]));
  const roads = Array.from({ length: plot.w }, (_, k) => ({ i: plot.i + k, j: 0 }));
  return { points, plots: [plot], roads, groups: signs, figures: [] };
}

/**
 * The world box that frames every plot, with room above for the tallest tree
 * and below for the soil and labels. `null` when nothing is planted.
 */
export function forestBounds(layout) {
  const corners = (layout?.plots ?? []).flatMap(plot => [[plot.i - .5, plot.j - .5], [plot.i + plot.w - .5, plot.j - .5], [plot.i + plot.w - .5, plot.j + plot.h - .5], [plot.i - .5, plot.j + plot.h - .5]].map(([i, j]) => isoPoint(i, j)));
  if (!corners.length) return null;
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys) - 80, maxY: Math.max(...ys) + 28 };
}

// ---- Painting -------------------------------------------------------------

const INK = {
  shadow: 'rgba(52,78,32,.2)', trunk: ['#a0714a', '#7d5535'],
  leaf: ['#86d36e', '#52a65b'], pine: ['#63bd76', '#3d8c58'], oak: ['#9bdb70', '#5aa957'], bush: ['#a6d584', '#72b060'],
  sprout: ['#94d66c', '#5fae4f'], ginkgo: ['#ffd65e', '#e7a92c'], mound: ['#cfa87e', '#a9825b'], rock: ['#cfd4d6', '#a3aaae'], stake: ['#c2956a', '#94693f'],
  grass: ['#d6e6b8', '#cee0ad'], lush: ['#a2d575', '#96cd68'], road: ['#ead7b1', '#e2cda3'], edge: 'rgba(110,140,80,.35)',
  sideLeft: '#c9a173', sideRight: '#a77c52', plotShadow: 'rgba(70,90,50,.12)',
  select: 'rgba(255,241,178,.9)', selectEdge: 'rgba(222,170,54,.95)',
};

/** Fill `path`, then light its left side: the flat two-tone look of a low-poly model. */
function twoTone(ctx, path, [light, dark], split = 0) {
  ctx.fillStyle = dark; ctx.beginPath(); path(); ctx.fill();
  ctx.save(); ctx.beginPath(); path(); ctx.clip(); ctx.fillStyle = light; ctx.fillRect(-400, -400, 400 + split, 800); ctx.restore();
}
const circles = (ctx, list) => () => { for (const [x, y, r] of list) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); } };

/** One node's growth, drawn with its base at the origin, `H` tall. */
function drawForm(ctx, form, H, seed) {
  const trunk = (width, height) => twoTone(ctx, () => ctx.rect(-width / 2, -height, width, height), INK.trunk);
  switch (form) {
    case 'mound':
      twoTone(ctx, () => ctx.ellipse(0, -H * .28, H * 1.15, H * .5, 0, 0, TAU), INK.mound);
      ctx.fillStyle = 'rgba(90,62,36,.55)'; ctx.beginPath(); ctx.ellipse(0, -H * .42, H * .18, H * .1, 0, 0, TAU); ctx.fill();
      return;
    case 'rock':
      twoTone(ctx, () => { ctx.moveTo(-H * .8, 0); ctx.lineTo(-H * .55, -H * .75); ctx.lineTo(H * .1, -H); ctx.lineTo(H * .75, -H * .55); ctx.lineTo(H * .85, 0); ctx.closePath(); }, INK.rock, H * .1);
      return;
    case 'bush':
      twoTone(ctx, circles(ctx, [[-H * .42, -H * .42, H * .42], [H * .38, -H * .4, H * .4], [0, -H * .66, H * .46]]), INK.bush);
      return;
    case 'stake':
      ctx.fillStyle = 'rgba(96,66,38,.45)'; ctx.beginPath(); ctx.ellipse(0, 0, H * .45, H * .18, 0, 0, TAU); ctx.fill();
      twoTone(ctx, () => { ctx.moveTo(-H * .1, 0); ctx.lineTo(-H * .1, -H * .82); ctx.lineTo(0, -H); ctx.lineTo(H * .1, -H * .82); ctx.lineTo(H * .1, 0); ctx.closePath(); }, INK.stake);
      return;
    case 'sprout': {
      ctx.strokeStyle = INK.sprout[1]; ctx.lineWidth = Math.max(1, H * .07); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -H * .62); ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(0, -H * .6); ctx.rotate(side * .75);
        ctx.fillStyle = side < 0 ? INK.sprout[0] : INK.sprout[1]; ctx.beginPath(); ctx.ellipse(0, -H * .2, H * .12, H * .24, 0, 0, TAU); ctx.fill(); ctx.restore();
      }
      return;
    }
    case 'sapling':
      trunk(Math.max(1.5, H * .08), H * .56);
      twoTone(ctx, circles(ctx, [[0, -H * .7, H * .28]]), INK.leaf);
      return;
    case 'oak': case 'ginkgo':
      trunk(H * .12, H * .42);
      twoTone(ctx, circles(ctx, [[0, -H * .7, H * .27], [-H * .22, -H * .56, H * .21], [H * .22, -H * .56, H * .21], [H * .02, -H * .88, H * .16]]), form === 'ginkgo' ? INK.ginkgo : INK.oak);
      return;
    default:
      if (seed < .42) {
        // A pine: three tiers, lit on the left.
        trunk(H * .1, H * .2);
        for (let tier = 0; tier < 3; tier += 1) {
          const base = -H * (.16 + tier * .22), half = H * (.3 - tier * .06), top = base - H * .38;
          twoTone(ctx, () => { ctx.moveTo(-half, base); ctx.lineTo(0, top); ctx.lineTo(half, base); ctx.closePath(); }, INK.pine);
        }
      } else {
        trunk(H * .1, H * .4);
        twoTone(ctx, circles(ctx, [[0, -H * .66, H * .3], [0, -H * .86, H * .18]]), INK.leaf);
      }
  }
}

/** One node at ground point (x, y). `size` scales world units to pixels. */
export function paintForestNode(ctx, x, y, star, size, { sway = 0, grow = 1, alpha = 1, seed = starHash(star?.key ?? '', 8) } = {}) {
  const { form, height } = forestGrowth(star), H = height * size * (.15 + .85 * grow);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
  ctx.fillStyle = INK.shadow; ctx.beginPath(); ctx.ellipse(H * .08, 0, Math.min(TILE_W * size * .34, H * .5 + 3 * size), Math.min(TILE_H * size * .3, H * .2 + 1.5 * size), 0, 0, TAU); ctx.fill();
  if (form !== 'mound' && form !== 'rock' && form !== 'stake') ctx.rotate(sway);
  drawForm(ctx, form, H, seed);
  ctx.restore();
}

function tilePath(ctx, c, w, h) { ctx.moveTo(c.x, c.y - h / 2); ctx.lineTo(c.x + w / 2, c.y); ctx.lineTo(c.x, c.y + h / 2); ctx.lineTo(c.x - w / 2, c.y); ctx.closePath(); }

/** The whole forest for one frame, from the scene the star map keeps. */
export function paintForest(ctx, current, width, height, t, at, progress) {
  const zoom = current.view.zoom, tw = TILE_W * zoom, th = TILE_H * zoom, depth = 12 * zoom, margin = 80 * zoom;
  const visible = c => c.x > -margin && c.x < width + margin && c.y > -margin && c.y < height + margin;
  const lush = new Set(), road = new Set((current.layout.roads ?? []).map(tile => `${tile.i},${tile.j}`));
  for (const node of current.drawn) { const point = current.layout.points.get(node.key); if (forestLush(node)) lush.add(`${point.i},${point.j}`); }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  for (const plot of current.layout.plots ?? []) {
    const corner = (i, j) => at(isoPoint(i, j));
    const top = corner(plot.i - .5, plot.j - .5), right = corner(plot.i + plot.w - .5, plot.j - .5), bottom = corner(plot.i + plot.w - .5, plot.j + plot.h - .5), left = corner(plot.i - .5, plot.j + plot.h - .5);
    if (Math.max(top.x, right.x, bottom.x, left.x) < 0 || Math.min(top.x, right.x, bottom.x, left.x) > width || top.y > height || bottom.y + depth < 0) continue;
    // A soft shadow, then the soil sides, then the grass.
    ctx.fillStyle = INK.plotShadow; ctx.beginPath(); ctx.moveTo(left.x, left.y + depth * 1.6); ctx.lineTo(bottom.x, bottom.y + depth * 2.2); ctx.lineTo(right.x, right.y + depth * 1.6); ctx.lineTo(right.x, right.y); ctx.lineTo(left.x, left.y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = INK.sideLeft; ctx.beginPath(); ctx.moveTo(left.x, left.y); ctx.lineTo(bottom.x, bottom.y); ctx.lineTo(bottom.x, bottom.y + depth); ctx.lineTo(left.x, left.y + depth); ctx.closePath(); ctx.fill();
    ctx.fillStyle = INK.sideRight; ctx.beginPath(); ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(right.x, right.y); ctx.lineTo(right.x, right.y + depth); ctx.lineTo(bottom.x, bottom.y + depth); ctx.closePath(); ctx.fill();
    for (let i = plot.i; i < plot.i + plot.w; i += 1) for (let j = plot.j; j < plot.j + plot.h; j += 1) {
      const c = at(isoPoint(i, j)); if (current.culled && !visible(c)) continue;
      const key = `${i},${j}`, tone = road.has(key) ? INK.road : lush.has(key) ? INK.lush : INK.grass;
      ctx.fillStyle = tone[(i + j) & 1]; ctx.beginPath(); tilePath(ctx, c, tw + .6, th + .6); ctx.fill();
    }
    ctx.strokeStyle = INK.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(right.x, right.y); ctx.lineTo(bottom.x, bottom.y); ctx.lineTo(left.x, left.y); ctx.closePath(); ctx.stroke();
  }
  if (current.selected && current.layout.points.has(current.selected) && current.byKey.has(current.selected)) {
    const point = current.layout.points.get(current.selected), c = at(point), breath = .5 + .5 * Math.sin(t * 1.6);
    ctx.globalAlpha = .7 + .3 * breath; ctx.fillStyle = INK.select; ctx.strokeStyle = INK.selectEdge; ctx.lineWidth = 1.5;
    ctx.beginPath(); tilePath(ctx, c, tw * .92, th * .92); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
  }
  // Back to front, so nearer trees stand in front of farther ones.
  const order = current.drawn.map(node => ({ node, point: current.layout.points.get(node.key) })).sort((a, b) => (a.point.i + a.point.j) - (b.point.i + b.point.j) || a.point.i - b.point.i);
  for (const { node, point } of order) {
    const c = at(point); if (current.culled && !visible(c)) continue;
    const seed = starHash(node.key, 8), lit = starLight(node).state === 'lit';
    const grow = lit ? 1 - (1 - progress(node.key, Math.min(8, point.depth ?? 0) * 90, 800)) ** 3 : 1;
    paintForestNode(ctx, c.x, c.y, node, zoom, { sway: Math.sin(t * (.8 + seed * .5) + seed * 12) * .035, grow, alpha: current.hover && !current.neighbors.has(node.key) ? .35 : 1, seed });
  }
  ctx.globalAlpha = 1;
}
