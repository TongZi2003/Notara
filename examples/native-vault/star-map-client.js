/**
 * 星图: the second renderer over the same graph and route projections. The
 * structure board stays the place to find, filter and edit relations; the star
 * map only shows how much light real evidence has put on each node.
 *
 * Light comes from the Host's read-only `learningStars` projection (knowledge)
 * or from a lesson's real summary (courses). Nothing here infers mastery: a
 * star without a projection is drawn as unknown, an unobserved star as a dim
 * twinkling point — never as a dark "failed" one. Layout is deterministic and
 * computed over the whole filtered projection, so expanding a layer reveals
 * stars in place instead of reshuffling the sky.
 *
 * The dark theme paints 深夜: stars are halo, spikes and core that add up as
 * light on a deep night and scintillate — nothing is an outlined shape.
 * Nebulae and star dust are decoration only — they encode nothing, and the
 * dust drifts with parallax while the sky is panned. The light theme reads the
 * same light as a 森林 instead (`forest-client.js`); the camera, selection and
 * node buttons here are shared by both.
 */
import { forestBounds, forestGrowth, forestHit, paintForest, paintForestNode } from './forest-client.js';
import { splitTree, starHash, starLight } from './star-light.js';

export { starHash, starLight };

export const STAR_CSS = `
.nv-star-board,.nv-star-legend{--nv-sky-edge:#050915;--nv-star-text:#a9b8da;--nv-star-text-lit:#eef3ff;--nv-star-root:#f3f6ff;--nv-star-group:#8ea0c8;--nv-star-shadow:0 1px 3px #000;--nv-star-shadow-lit:0 0 10px rgba(120,160,255,.6),0 1px 2px #000;--nv-star-shadow-gold:0 0 10px rgba(255,190,90,.55),0 1px 2px #000;--nv-star-button:rgba(18,28,58,.72);--nv-star-button-text:#c9d6f5;--nv-star-serif:"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","Noto Serif SC",serif}
.nv-star-board{position:relative;isolation:isolate;flex:1;min-width:0;min-height:360px;overflow:hidden;background:radial-gradient(130% 95% at 50% 36%,#111a3a 0%,#090f25 48%,#050915 100%);touch-action:none;cursor:grab;user-select:none;color-scheme:dark}
:is(.nv-star-board,.nv-star-legend)[data-sky=forest]{--nv-sky-edge:#f4f6ef;--nv-star-text:#56644c;--nv-star-text-lit:#26361d;--nv-star-root:#1f2e17;--nv-star-group:#6b5334;--nv-star-shadow:0 0 2px #fff,0 0 6px rgba(255,255,255,.95);--nv-star-shadow-lit:0 0 2px #fff,0 0 7px #fff;--nv-star-shadow-gold:0 0 2px #fff,0 0 7px #fff;--nv-star-button:rgba(255,255,255,.85);--nv-star-button-text:#3d4a35}
.nv-star-board[data-sky=forest]{background:linear-gradient(180deg,#f8faf5 0%,#eef2e7 100%);color-scheme:light}
.nv-star-board[data-sky=forest] .nv-star-label{font-weight:500}
.nv-star-board[data-sky=forest] .nv-star-controls{z-index:100000}
.nv-star-board[data-sky=forest] .nv-star-group{z-index:99999;transform:translate(-50%,-100%);padding:2px 10px;border-radius:6px;background:#fbf3e3;border:1px solid #d9c09a;box-shadow:0 1px 0 #c8aa7c;letter-spacing:.12em;text-shadow:none}
.nv-star-board:active{cursor:grabbing}
.nv-star-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.nv-star-hit{position:absolute;padding:0;border:0;border-radius:50%;background:transparent;transform:translate(-50%,-50%);cursor:pointer;color:inherit}
.nv-star-hit:focus-visible{outline:1px solid color-mix(in srgb,var(--nv-star-text-lit) 60%,transparent);outline-offset:4px}
.nv-star-label{position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;max-width:168px;overflow:hidden;text-overflow:ellipsis;pointer-events:none;font:11px/1.35 var(--dsw-font-family,system-ui);color:var(--nv-star-text);opacity:.85;text-shadow:var(--nv-star-shadow)}
.nv-star-hit[data-state=lit] .nv-star-label{color:var(--nv-star-text-lit);opacity:1;text-shadow:var(--nv-star-shadow-lit)}
.nv-star-hit[data-kind=course][data-state=lit] .nv-star-label{text-shadow:var(--nv-star-shadow-gold)}
.nv-star-hit[data-kind=parent] .nv-star-label,.nv-star-hit[data-kind=course] .nv-star-label{font:500 12.5px/1.35 var(--nv-star-serif);letter-spacing:.06em}
.nv-star-hit[data-root=true] .nv-star-label{font:600 15px/1.4 var(--nv-star-serif);letter-spacing:.22em;color:var(--nv-star-root);opacity:1}
.nv-star-hit[aria-pressed=true] .nv-star-label{color:var(--nv-star-root);opacity:1;font-weight:600}
.nv-star-group{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;pointer-events:none;font:500 13px/1.4 var(--nv-star-serif);letter-spacing:.26em;color:var(--nv-star-group);text-shadow:var(--nv-star-shadow)}
.nv-star-controls{position:absolute;left:12px;bottom:12px;display:flex;align-items:center;gap:6px;color:var(--nv-star-text);font-size:12px;text-shadow:var(--nv-star-shadow)}
.nv-star-controls button{color:var(--nv-star-button-text)!important;background:var(--nv-star-button)!important;border-color:color-mix(in srgb,var(--nv-star-text) 22%,transparent)!important}
.nv-star-legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;padding:8px 18px 10px;font-size:12px;color:var(--nv-star-text);background:var(--nv-sky-edge);border-top:1px solid color-mix(in srgb,var(--nv-star-text) 16%,transparent)}
.nv-star-legend>span{display:inline-flex;align-items:center;gap:4px}
.nv-star-legend small{color:color-mix(in srgb,var(--nv-star-text) 72%,transparent);font-size:11px}
.nv-star-reading{margin:4px 0 18px;padding:12px 0 2px;border-top:1px solid var(--dsw-alias-border-l1);display:grid;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.nv-star-reading>div{display:grid;grid-template-columns:auto 1fr;align-items:baseline;gap:4px 12px}
.nv-star-reading b{font-weight:500;color:var(--dsw-alias-label-primary);text-align:right;font-variant-numeric:tabular-nums}
.nv-star-meter{grid-column:1/-1;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.nv-star-meter i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#5f86e8,#a9c6ff)}
.nv-star-reading p{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
`;

const TAU = Math.PI * 2;
const RING = 86, RING_STEP = 58, ARC_GAP = 30, PACK_GAP = 56, LOOSE_GAP = 46;

/**
 * A constellation per split hierarchy: each root is the anchor star, children
 * sit on rings in wedges sized by their own subtree, and every angle and radius
 * carries a small seeded offset so the figure reads as a constellation rather
 * than a wheel. Constellations are then packed outward on a spiral, and
 * edge-less nodes gather as one loose cluster. References never move a star.
 */
export function constellationLayout(nodes = [], edges = []) {
  const keys = nodes.map(node => node.key), { parentOf, children, linked } = splitTree(keys, edges);
  const weight = new Map();
  const weigh = key => { if (weight.has(key)) return weight.get(key); const kids = children.get(key); const value = kids.length ? kids.reduce((sum, kid) => sum + weigh(kid), 0) : 1; weight.set(key, value); return value; };
  const roots = keys.filter(key => !parentOf.has(key));
  const figures = [], loose = [];
  for (const root of roots) {
    if (!children.get(root).length) { (linked.has(root) ? figures : loose).push(root); continue; }
    figures.push(root);
  }
  const points = new Map(), shapes = [];
  for (const root of figures) {
    const local = new Map([[root, { x: 0, y: 0, depth: 0 }]]), perDepth = [];
    const spin = starHash(root, 7) * TAU;
    const walk = (key, start, end, depth) => {
      const kids = children.get(key), total = kids.reduce((sum, kid) => sum + weigh(kid), 0);
      let cursor = start;
      for (const kid of kids) {
        const span = (end - start) * weigh(kid) / total;
        (perDepth[depth] ??= []).push({ key: kid, angle: cursor + span / 2 + (starHash(kid, 1) - .5) * span * .45 });
        walk(kid, cursor, cursor + span, depth + 1);
        cursor += span;
      }
    };
    walk(root, spin, spin + TAU, 1);
    let radius = 0, extent = 40;
    for (let depth = 1; depth < perDepth.length; depth += 1) {
      const ring = perDepth[depth] ?? [];
      radius = Math.max(depth === 1 ? RING : radius + RING_STEP, ring.length * ARC_GAP / TAU);
      for (const item of ring) {
        const r = radius * (1 + (starHash(item.key, 2) - .5) * .24);
        local.set(item.key, { x: Math.cos(item.angle) * r, y: Math.sin(item.angle) * r, depth });
        extent = Math.max(extent, r + 48);
      }
    }
    shapes.push({ root, local, extent });
  }
  if (loose.length) {
    const local = new Map(), step = LOOSE_GAP / Math.sqrt(Math.PI) * 1.6;
    loose.forEach((key, index) => { const angle = index * 2.399963229728653, r = step * Math.sqrt(index + .5); local.set(key, { x: Math.cos(angle) * r, y: Math.sin(angle) * r, depth: 0 }); });
    shapes.push({ root: null, local, extent: step * Math.sqrt(loose.length) + 44 });
  }
  // Largest figure in the middle; each next one takes the first spiral spot
  // that clears every placed figure.
  const placed = [];
  for (const shape of [...shapes].sort((a, b) => b.extent - a.extent)) {
    let cx = 0, cy = 0;
    if (placed.length) {
      for (let index = 1; ; index += 1) {
        const angle = index * 2.399963229728653, r = 26 * Math.sqrt(index) * Math.sqrt(shape.extent / 40);
        cx = Math.cos(angle) * r; cy = Math.sin(angle) * r * .72;
        if (placed.every(item => Math.hypot(item.cx - cx, item.cy - cy) >= item.extent + shape.extent + PACK_GAP)) break;
      }
    }
    placed.push({ cx, cy, extent: shape.extent, key: shape.root ?? 'loose', loose: !shape.root });
    for (const [key, point] of shape.local) points.set(key, { x: point.x + cx, y: point.y + cy, depth: point.depth, root: shape.root });
  }
  return { points, groups: [], figures: placed.map(({ key, cx, cy, extent, loose }) => ({ key, x: cx, y: cy, extent, loose })) };
}

/**
 * Courses read as one route across the sky: 主线 lessons advance left to right
 * with a small seeded rise and fall, a new 阶段 leaves a wider gap and names its
 * group, and 条件补练 / 拓展 hang below or above the lesson they branch from.
 */
export function routeStarLayout(rows = [], edges = []) {
  const points = new Map(), stageOf = new Map();
  let x = 0, index = 0, previous = null;
  const place = (row, point) => { points.set(row.key, point); stageOf.set(row.key, point.stage); };
  for (const row of rows) {
    if (row.pathway !== 'main') continue;
    const stage = row.stage || '';
    if (index && stage !== previous) x += 64;
    previous = stage;
    place(row, { x, y: (starHash(row.key, 3) - .5) * 84, depth: index, stage });
    x += 118; index += 1;
  }
  const sourceOf = key => edges.find(edge => edge.target === key && (edge.kind === 'branch' || edge.kind === 'sequence'))?.source;
  const hung = new Map();
  for (const row of rows) {
    if (points.has(row.key)) continue;
    const source = sourceOf(row.key), from = points.get(source);
    if (!from) { place(row, { x, y: 0, depth: index, stage: row.stage || '' }); x += 118; index += 1; continue; }
    const slot = hung.get(source) ?? 0, below = row.pathway !== 'extension';
    hung.set(source, slot + 1);
    place(row, { x: from.x + 36 + slot * 64, y: from.y + (below ? 1 : -1) * (104 + slot * 18), depth: from.depth + 1, stage: from.stage });
  }
  const xs = [...points.values()].map(point => point.x), mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  for (const point of points.values()) point.x -= mid;
  // A 阶段 names its own stretch of sky, above the highest star in it.
  const groups = [], figures = [];
  for (const stage of new Set(stageOf.values())) {
    const members = [...points.values()].filter(point => point.stage === stage), xs = members.map(point => point.x), ys = members.map(point => point.y);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2;
    figures.push({ key: `stage:${stage}`, x, y, extent: Math.max(90, (Math.max(...xs) - Math.min(...xs)) / 2 + 70) });
    if (stage) groups.push({ key: `stage:${stage}`, label: stage, x, y: Math.min(...ys) - 40 });
  }
  return { points, groups, figures };
}

/** A constellation line is lit only when both of its stars carry light. */
export const edgeLit = (from, to) => starLight(from).state === 'lit' && starLight(to).state === 'lit' && starLight(from).level >= .5 && starLight(to).level >= .5;

/**
 * How one star glows, in screen pixels at `scale`: a soft core, a halo and —
 * for well-supported light — diffraction spikes. Mastery sets how bright the
 * core burns; a parent's coverage sets how far its halo spreads, so a bright
 * branch that only one leaf supports stays a tight point.
 */
export function starGlow(star, scale = 1) {
  const light = starLight(star), L = light.level, s = scale;
  const dim = { core: 1.4 * s, alpha: .45, halo: 7 * s, haloAlpha: .14, spike: 0, spikeAlpha: 0, tone: 'dim', twinkle: .38 };
  if (star?.kind === 'course') {
    if (light.state === 'lit') return { core: 3.2 * s, alpha: 1, halo: 34 * s, haloAlpha: .85, spike: 30 * s, spikeAlpha: .75, tone: 'gold', twinkle: .16 };
    if (light.state === 'opened') return { ...dim, core: 2 * s, alpha: .7, halo: 11 * s, haloAlpha: .3, tone: 'gold' };
    return dim;
  }
  if (light.state === 'lit' && star.kind === 'parent') {
    return { core: (2.6 + 2.6 * L) * s, alpha: 1, halo: (14 + 50 * light.coverage) * s, haloAlpha: .35 + .5 * L,
      spike: L >= FLARE_AT ? (18 + 34 * L) * s : 0, spikeAlpha: Math.max(0, (L - .5) * 1.6), tone: 'blue', twinkle: .18 };
  }
  if (light.state === 'lit') {
    return { core: (1.6 + 2.2 * L) * s, alpha: .75 + .25 * L, halo: (10 + 22 * L) * s, haloAlpha: .3 + .6 * L,
      spike: L >= FLARE_AT ? (10 + 26 * L) * s : 0, spikeAlpha: Math.max(0, (L - .5) * 1.6), tone: 'blue', twinkle: .22 };
  }
  if (light.state === 'unobserved' || light.state === 'unreadable') return star.kind === 'parent' ? { ...dim, core: 1.9 * s, halo: 10 * s } : dim;
  return { core: 1.1 * s, alpha: light.state === 'unknown' ? .22 : .32, halo: 0, haloAlpha: 0, spike: 0, spikeAlpha: 0, tone: 'dim', twinkle: .3 };
}

const FLARE_AT = .6;
const percent = value => `${Math.round(value * 100)}%`;
const dayOf = stamp => { const date = stamp ? new Date(stamp) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : ''; };
const DRAWN = new Set(['split', 'sequence']);
const clamp01 = value => Math.min(1, Math.max(0, value));
const easeOut = value => 1 - (1 - value) ** 3;

/** Two layers of background dust in a unit tile: decoration, fixed per map. */
function dustField(seed) {
  const layer = (count, depth, salt) => Array.from({ length: count }, (_, index) => {
    const id = `${seed}:${salt}:${index}`, w = starHash(id, 13);
    return { u: starHash(id, 11), v: starHash(id, 12), depth, r: depth > .2 ? .55 + w * .9 : .35 + w * .55, o: .2 + w * .65, glow: depth > .2 && w > .9, rate: .6 + starHash(id, 14) * 2.2, phase: starHash(id, 15) * TAU };
  });
  return [...layer(150, .08, 'far'), ...layer(70, .3, 'near')];
}

/** 深夜 follows the app's dark theme; the light theme is always the 森林. */
const skyOf = () => typeof document === 'undefined' || document.body?.hasAttribute('data-ds-dark-theme') ? 'night' : 'forest';

/** The night's light: dark enough for every halo to add up like light. */
const SKIES = {
  night: {
    composite: 'lighter', dust: '#e4ecff', dustAlpha: 1, nebulaAlpha: .8,
    lit: [[7, .1, '110,160,255'], [2.6, .22, '150,190,255'], [1, .85, '222,233,255']], litGold: [[7, .1, '255,170,80'], [2.6, .22, '255,200,130'], [1, .85, '255,236,200']],
    dim: 'rgb(140,160,210)', dimGold: 'rgb(200,170,120)', dimAlpha: .26,
    blue: [[0, 'rgba(255,255,255,1)'], [.07, 'rgba(228,238,255,.92)'], [.2, 'rgba(160,192,255,.42)'], [.45, 'rgba(110,150,255,.12)'], [1, 'rgba(90,130,255,0)']],
    gold: [[0, 'rgba(255,252,240,1)'], [.07, 'rgba(255,232,180,.92)'], [.2, 'rgba(255,196,110,.42)'], [.45, 'rgba(255,160,70,.12)'], [1, 'rgba(255,140,50,0)']],
    pale: [[0, 'rgba(220,232,255,.5)'], [.35, 'rgba(170,200,255,.2)'], [1, 'rgba(150,185,255,0)']],
    core: [[0, 'rgba(255,255,255,1)'], [.45, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']],
    coreGold: [[0, 'rgba(255,255,250,1)'], [.45, 'rgba(255,244,220,.9)'], [1, 'rgba(255,230,190,0)']], coreScale: 1,
    dimStar: [[0, 'rgba(236,242,255,1)'], [.4, 'rgba(200,215,255,.6)'], [1, 'rgba(160,185,255,0)']],
    spike: '225,236,255', spikeGold: '255,232,190',
    nebula: [[58, 88, 208], [107, 70, 194], [28, 134, 168]].map(([r, g, b]) => [[0, `rgba(${r},${g},${b},.34)`], [.5, `rgba(${r},${g},${b},.12)`], [1, `rgba(${r},${g},${b},0)`]]),
  },
};

/** Soft light sprites, drawn once and reused by every map and swatch. */
const SPRITES = {};
function sprites(sky = 'night') {
  if (SPRITES[sky] || typeof document === 'undefined') return SPRITES[sky];
  const tone = SKIES[sky];
  const make = (size, paint) => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; paint(canvas.getContext('2d'), size); return canvas; };
  const glow = stops => make(128, (ctx, size) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [offset, color] of stops) g.addColorStop(offset, color);
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  });
  const spikes = tint => make(256, (ctx, size) => {
    const c = size / 2;
    ctx.filter = 'blur(1.2px)';
    for (const [angle, reach, width] of [[0, 1, 1.6], [Math.PI / 2, 1, 1.6], [Math.PI / 4, .42, 1], [-Math.PI / 4, .42, 1]]) {
      ctx.save(); ctx.translate(c, c); ctx.rotate(angle);
      const g = ctx.createLinearGradient(-c * reach, 0, c * reach, 0);
      g.addColorStop(0, `rgba(${tint},0)`); g.addColorStop(.5, `rgba(${tint},.95)`); g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g; ctx.fillRect(-c * reach, -width / 2, c * reach * 2, width); ctx.restore();
    }
  });
  SPRITES[sky] = { tone, blue: glow(tone.blue), gold: glow(tone.gold), pale: glow(tone.pale), core: glow(tone.core), coreGold: glow(tone.coreGold), dim: glow(tone.dimStar), spikeBlue: spikes(tone.spike), spikeGold: spikes(tone.spikeGold), nebula: tone.nebula.map(glow) };
  return SPRITES[sky];
}

/** One star: halo, spikes, core. `pulse` is the twinkle factor. */
function paintStar(ctx, x, y, glow, pulse = 1, flash = 0, art = sprites()) {
  if (!art) return;
  const tone = glow.tone === 'gold' ? art.gold : glow.tone === 'dim' ? art.dim : art.blue, blit = (image, radius, alpha) => {
    if (radius <= 0 || alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  };
  blit(tone, glow.halo * (1 + flash * .9) * (.92 + .08 * pulse), glow.haloAlpha * pulse * glow.alpha);
  if (glow.spike) blit(glow.tone === 'gold' ? art.spikeGold : art.spikeBlue, glow.spike * (.82 + .18 * pulse), glow.spikeAlpha * (.55 + .45 * pulse));
  blit(tone, glow.core * 3.2, .55 * glow.alpha * pulse);
  const core = glow.tone === 'dim' ? art.dim : glow.tone === 'gold' ? art.coreGold : art.core;
  blit(core, glow.core * (glow.tone === 'dim' ? 1.6 : art.tone.coreScale), glow.alpha * (.7 + .3 * pulse));
}

/** Which sky is showing, followed live when the app theme changes. */
function useSky(React) {
  const [sky, setSky] = React.useState(skyOf);
  React.useEffect(() => {
    if (typeof MutationObserver === 'undefined' || !document.body) return undefined;
    const observer = new MutationObserver(() => setSky(skyOf()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    return () => observer.disconnect();
  }, []);
  return sky;
}

export function createStarMap(React, { STYLE, IconButton }) {
  const h = React.createElement;
  const { useState, useEffect, useRef, useMemo } = React;
  const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /** How far below its centre a star's label has to start. */
  const labelOffset = glow => Math.max(7, glow.core * 2.6);

  /**
   * The map. `layout` comes from the whole filtered projection; `nodes` and
   * `edges` are what is drawn now. The sky is one canvas animated at ~30fps
   * (static under reduced motion); stars stay real buttons for selection,
   * keyboard focus and labels.
   */
  function StarMap({ nodes, edges, layout, selected, onSelect, onOpen, onContext, state, fitKey = '', label = '学习星图', nodeName = '星图节点' }) {
    const host = useRef(null), canvas = useRef(null), drag = useRef(null), moved = useRef(false), lastContext = useRef({ time: 0, key: '' });
    const dust = useMemo(() => dustField(label), [label]);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [camera, setCamera] = useState(() => state.starCamera ?? null);
    const [hover, setHover] = useState(null), sky = useSky(React);
    const fitted = useRef(state.starFit ?? null), since = useRef(new Map()), scene = useRef(null), steered = useRef(!!state.starSteered);
    const steer = () => { steered.current = true; state.starSteered = true; };
    useEffect(() => { state.starCamera = camera; }, [camera]);
    useEffect(() => { const element = host.current; const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight })); observer.observe(element); return () => observer.disconnect(); }, []);
    const drawn = useMemo(() => nodes.filter(node => layout.points.has(node.key)), [nodes, layout]);
    const fit = () => {
      if (!size.width || !drawn.length) return;
      // The forest frames whole plots and the trees on them; the sky frames its stars.
      const xs = drawn.map(node => layout.points.get(node.key).x), ys = drawn.map(node => layout.points.get(node.key).y);
      const box = sky === 'forest' ? forestBounds(layout) : null;
      const { minX, maxX, minY, maxY } = box ?? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      const zoom = Math.max(.3, Math.min(1.35, (size.width - 140) / Math.max(1, maxX - minX), (size.height - 150) / Math.max(1, maxY - minY)));
      steered.current = false; state.starSteered = false;
      setCamera({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 + 8 / zoom, zoom });
    };
    // A new slice refits; so does a resize (a detail pane opening) until the
    // learner has panned or zoomed the sky themselves.
    // A sky change swaps the layout underneath, so it always refits.
    const fitAs = `${sky}|${fitKey}`;
    useEffect(() => { if (!size.width) return; if (!camera || fitted.current !== fitAs || !steered.current) { fitted.current = fitAs; state.starFit = fitAs; fit(); } }, [size.width, size.height, fitAs, drawn.length > 0]);
    useEffect(() => {
      const element = host.current;
      const wheel = event => {
        event.preventDefault(); const bounds = element.getBoundingClientRect(); steer();
        setCamera(previous => {
          if (!previous) return previous;
          const zoom = Math.max(.2, Math.min(3, previous.zoom * Math.exp(-event.deltaY * .0012)));
          const sx = event.clientX - bounds.left - bounds.width / 2, sy = event.clientY - bounds.top - bounds.height / 2;
          return { zoom, x: previous.x + sx / previous.zoom - sx / zoom, y: previous.y + sy / previous.zoom - sy / zoom };
        });
      };
      element.addEventListener('wheel', wheel, { passive: false });
      return () => element.removeEventListener('wheel', wheel);
    }, []);
    const view = camera ?? { x: 0, y: 0, zoom: 1 };
    const scale = Math.max(.7, Math.min(1.45, Math.sqrt(view.zoom)));
    const screen = point => ({ x: size.width / 2 + (point.x - view.x) * view.zoom, y: size.height / 2 + (point.y - view.y) * view.zoom });
    const byKey = useMemo(() => new Map(drawn.map(node => [node.key, node])), [drawn]);
    const neighbors = useMemo(() => new Set(hover ? [hover, ...edges.flatMap(edge => edge.source === hover ? [edge.target] : edge.target === hover ? [edge.source] : [])] : []), [hover, edges]);
    const many = drawn.length > 48, culled = drawn.length > 300;
    const onScreen = point => !culled || (point.x > -120 && point.x < size.width + 120 && point.y > -120 && point.y < size.height + 120);
    // A star or line starts its ignition the first time it is seen lit.
    const now = typeof performance === 'undefined' ? 0 : performance.now();
    for (const node of drawn) if (starLight(node).state === 'lit' && !since.current.has(node.key)) since.current.set(node.key, now);
    for (const edge of edges) { const key = `${edge.kind}:${edge.source}>${edge.target}`, a = byKey.get(edge.source), b = byKey.get(edge.target); if (a && b && edgeLit(a, b) && !since.current.has(key)) since.current.set(key, now); }
    scene.current = { ...scene.current, drawn, edges, byKey, layout, view, size, scale, hover, neighbors, selected, dust, culled, sky, dirty: true };
    const forest = sky === 'forest';

    useEffect(() => {
      const element = canvas.current, ctx = element?.getContext('2d');
      if (!ctx) return undefined;
      let frame = 0, last = 0, still = reduced();
      const paint = time => {
        const current = scene.current, { width, height } = current.size;
        if (!width || !height) return;
        const ratio = window.devicePixelRatio || 1;
        if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) { element.width = Math.round(width * ratio); element.height = Math.round(height * ratio); }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
        const t = still ? 0 : time / 1000, { view: cam } = current;
        const at = point => ({ x: width / 2 + (point.x - cam.x) * cam.zoom, y: height / 2 + (point.y - cam.y) * cam.zoom });
        const progress = (key, delay, duration) => still ? 1 : clamp01((time - (since.current.get(key) ?? -1e9) - delay) / duration);
        if (current.sky === 'forest') { paintForest(ctx, current, width, height, t, at, progress); return; }
        const art = sprites(), sky = art.tone;
        ctx.globalCompositeOperation = sky.composite;
        // Nebulae: a few seeded clouds under each constellation.
        for (const figure of current.layout.figures ?? []) {
          const p = at(figure), base = (figure.extent * 1.25 + 60) * cam.zoom, tone = art.nebula[Math.floor(starHash(figure.key, 9) * art.nebula.length)];
          for (let index = 0; index < 4; index += 1) {
            const angle = starHash(figure.key, 20 + index) * TAU, reach = starHash(figure.key, 30 + index) * base * .45, r = base * (.55 + starHash(figure.key, 40 + index) * .6);
            ctx.globalAlpha = (figure.loose ? .45 : 1) * sky.nebulaAlpha;
            ctx.drawImage(tone, p.x + Math.cos(angle) * reach - r, p.y + Math.sin(angle) * reach * .7 - r * .75, r * 2, r * 1.5);
          }
        }
        // Dust drifts slower than the stars (parallax) and scintillates.
        const tileW = Math.max(width, 1200), tileH = Math.max(height, 800), camX = cam.x * cam.zoom, camY = cam.y * cam.zoom, wrap = (value, span) => ((value % span) + span) % span;
        ctx.fillStyle = sky.dust;
        for (const star of current.dust) {
          const x = wrap(star.u * tileW - camX * star.depth, tileW), y = wrap(star.v * tileH - camY * star.depth, tileH);
          if (x > width || y > height) continue;
          const pulse = .55 + .45 * Math.sin(t * star.rate + star.phase);
          if (star.glow) { ctx.globalAlpha = .35 * pulse; ctx.drawImage(art.pale, x - 7, y - 7, 14, 14); }
          ctx.globalAlpha = star.o * sky.dustAlpha * (.4 + .6 * pulse); ctx.beginPath(); ctx.arc(x, y, star.r, 0, TAU); ctx.fill();
        }
        // Constellation lines: a lit line draws itself in, then glows.
        ctx.lineCap = 'round';
        for (const edge of current.edges) {
          const a = current.byKey.get(edge.source), b = current.byKey.get(edge.target); if (!a || !b) continue;
          const p = at(current.layout.points.get(a.key)), q = at(current.layout.points.get(b.key));
          if (current.culled && (p.x < -120 || p.x > width + 120) && (q.x < -120 || q.x > width + 120)) continue;
          const faded = current.hover && !(edge.source === current.hover || edge.target === current.hover) ? .15 : 1, gold = edge.kind === 'sequence' || edge.kind === 'branch';
          if (edgeLit(a, b)) {
            const k = `${edge.kind}:${edge.source}>${edge.target}`, reach = DRAWN.has(edge.kind) ? easeOut(progress(k, 200 + Math.min(8, current.layout.points.get(b.key).depth ?? 0) * 90, 900)) : 1;
            const end = { x: p.x + (q.x - p.x) * reach, y: p.y + (q.y - p.y) * reach };
            ctx.setLineDash(edge.kind === 'branch' ? [6, 5] : []);
            for (const [width2, alpha, color] of gold ? sky.litGold : sky.lit) {
              ctx.globalAlpha = alpha * faded; ctx.strokeStyle = `rgb(${color})`; ctx.lineWidth = width2;
              ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(end.x, end.y); ctx.stroke();
            }
          } else {
            ctx.setLineDash(edge.kind === 'reference' || edge.kind === 'prerequisite' ? [1.5, 6] : edge.kind === 'branch' ? [6, 5] : []);
            ctx.globalAlpha = (edge.kind === 'reference' ? .6 : 1) * sky.dimAlpha * faded; ctx.strokeStyle = gold ? sky.dimGold : sky.dim; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
        ctx.setLineDash([]);
        // Stars last, so every halo adds onto the lines beneath it.
        for (const node of current.drawn) {
          const point = current.layout.points.get(node.key), p = at(point);
          if (current.culled && (p.x < -120 || p.x > width + 120 || p.y < -120 || p.y > height + 120)) continue;
          const glow = starGlow(node, current.scale), seed = starHash(node.key, 5);
          const pulse = 1 - glow.twinkle * (.5 + .25 * Math.sin(t * (1.1 + seed * 2.3) + seed * 40) + .25 * Math.sin(t * (2.9 + seed * 3.1) + seed * 17));
          const faded = current.hover && !current.neighbors.has(node.key) ? .25 : 1;
          const lit = starLight(node).state === 'lit', rise = lit ? easeOut(progress(node.key, Math.min(8, point.depth ?? 0) * 90, 700)) : 1;
          if (current.selected === node.key) {
            const breath = .5 + .5 * Math.sin(t * 1.6);
            ctx.globalAlpha = .55 + .25 * breath; const r = Math.max(glow.halo, 18 * current.scale) * 1.5 + 18 + 6 * breath;
            ctx.drawImage(art.pale, p.x - r, p.y - r, r * 2, r * 2);
          }
          ctx.save(); ctx.globalAlpha = 1;
          paintStar(ctx, p.x, p.y, { ...glow, alpha: glow.alpha * faded * rise }, pulse, lit ? (1 - rise) : 0, art);
          ctx.restore();
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      };
      // ~30fps while the sky scintillates; under reduced motion the same loop
      // only repaints a still frame after something changed.
      const loop = time => {
        frame = requestAnimationFrame(loop);
        const nowStill = reduced();
        if (nowStill !== still) { still = nowStill; scene.current.dirty = true; }
        if (still ? !scene.current.dirty : time - last < 32) return;
        last = time; scene.current.dirty = false; paint(still ? 0 : time);
      };
      frame = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(frame);
    }, []);

    const reportContext = (node, event) => {
      const now = Date.now();
      if (lastContext.current.key === node.key && now - lastContext.current.time < 250) return;
      lastContext.current = { time: now, key: node.key };
      event.preventDefault(); event.stopPropagation(); onContext?.(node, event);
    };
    const fade = key => hover && !neighbors.has(key) ? .3 : 1;
    return h('div', { ref: host, className: 'nv-star-board', 'data-sky': sky, role: 'group', 'aria-label': label,
      onPointerDown: event => {
        if (event.button !== 0 || event.ctrlKey || event.target.closest('button')) return;
        drag.current = { x: event.clientX, y: event.clientY, camera: view }; moved.current = false; event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: event => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
        if (!moved.current && Math.hypot(dx, dy) < 3) return; moved.current = true; steer();
        setCamera({ ...drag.current.camera, x: drag.current.camera.x - dx / drag.current.camera.zoom, y: drag.current.camera.y - dy / drag.current.camera.zoom });
      },
      onPointerUp: event => { if (drag.current) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; },
      onPointerCancel: () => { drag.current = null; } },
      h('canvas', { ref: canvas, className: 'nv-star-canvas', 'aria-hidden': true }),
      size.width > 0 && (layout.groups ?? []).map(group => { const p = screen(group); return h('span', { key: group.key, className: 'nv-star-group', style: { left: p.x, top: p.y } }, group.label); }),
      size.width > 0 && drawn.map(node => {
        const point = layout.points.get(node.key), p = screen(point); if (!onScreen(p)) return null;
        // A tree stands on its tile: its button covers the tree and its label starts at the ground.
        const tree = forest ? forestHit(node, view.zoom, point) : null, offset = tree ? tree.lift : labelOffset(starGlow(node, scale));
        const hit = Math.max(26, offset * 2 + 4), isRoot = node.kind === 'parent' && point.depth === 0 && !!point.root;
        const quiet = many ? view.zoom < 1.2 : view.zoom < .75;
        // Trees stand a tile apart and each plot has its own sign, so the forest names trees only when zoomed in or pointed at.
        const named = selected === node.key || neighbors.has(node.key);
        const showLabel = forest ? named || node.kind === 'course' || view.zoom >= (node.kind === 'parent' ? 1.1 : 1.6) : !quiet || node.kind !== 'leaf' && node.kind !== 'unlinked' || named;
        return h('button', { key: node.key, type: 'button', className: 'nv-star-hit', 'data-node': node.key, 'data-kind': node.kind, 'data-state': starLight(node).state, 'data-root': isRoot,
          'aria-label': `${nodeName} ${node.title}`, 'aria-pressed': selected === node.key, title: node.hint ? `${node.title} · ${node.hint}` : node.title,
          style: tree ? { left: p.x, top: p.y - tree.lift, width: tree.width, height: tree.height, zIndex: tree.z, borderRadius: 8, opacity: fade(node.key) } : { left: p.x, top: p.y, width: hit, height: hit, opacity: fade(node.key) },
          onClick: event => { if (event.button === 0 && !event.ctrlKey) onSelect(node); },
          onDoubleClick: event => { if (event.button === 0 && !event.ctrlKey) onOpen?.(node); },
          onPointerDown: event => { if (event.button === 2 || (event.button === 0 && event.ctrlKey)) reportContext(node, event); },
          onContextMenu: event => reportContext(node, event),
          onPointerEnter: () => setHover(node.key), onPointerLeave: () => setHover(null), onFocus: () => setHover(node.key), onBlur: () => setHover(null) },
          showLabel && h('span', { className: 'nv-star-label', style: { top: `calc(50% + ${offset + 4}px)` } }, node.title));
      }),
      h('div', { className: 'nv-star-controls' },
        h(IconButton, { icon: 'target', label: forest ? '显示整片森林' : '显示全部星体', onClick: fit }),
        h('span', null, `${Math.round(view.zoom * 100)}%`)));
  }

  /** A legend swatch is painted by the same paintStar the map uses. */
  function StarSwatch({ star, width = 36 }) {
    const ref = useRef(null), sky = useSky(React);
    useEffect(() => {
      const element = ref.current, ctx = element?.getContext('2d'); if (!ctx) return;
      const ratio = window.devicePixelRatio || 1;
      element.width = width * ratio; element.height = 28 * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, 28);
      if (sky === 'forest') { paintForestNode(ctx, width / 2, 25, star, Math.min(.9, 22 / forestGrowth(star).height), { seed: .7 }); return; }
      const art = sprites(sky);
      ctx.globalCompositeOperation = art.tone.composite;
      paintStar(ctx, width / 2, 14, starGlow(star, .6), 1, 0, art);
    }, [sky]);
    return h('canvas', { ref, style: { width, height: 28 }, 'aria-hidden': true });
  }

  const LEGEND = {
    night: {
      name: '星图图例',
      course: [['lit', { kind: 'course', light: { role: 'logged' } }, '金色：已完成小结'], ['open', { kind: 'course', light: { role: 'opened' } }, '暗金：已开课'], ['plan', { kind: 'course', light: { role: 'lesson' } }, '暗星：计划课程'], '点亮表示这节课完成过，不代表知识都已掌握'],
      knowledge: [['bright', { kind: 'leaf', light: { kind: 'leaf', observed: true, probability: .92 } }, '越亮，掌握估计越高'], ['mid', { kind: 'leaf', light: { kind: 'leaf', observed: true, probability: .42 } }, '仍在巩固'], ['dim', { kind: 'leaf', light: { kind: 'leaf', observed: false } }, '暗星：尚未评估'],
        ['parent', { kind: 'parent', light: { kind: 'parent', leafCount: 3, observedCount: 3, coverage: 1, mastery: .7 } }, '父节点：光晕越大，已评估的叶子越多'], ['faint', { kind: 'unlinked', light: { kind: 'unlinked' } }, '微光：尚未关联能力'], '亮度按已记录的评估推算，不是考试分数'],
    },
    forest: {
      name: '森林图例',
      course: [['lit', { kind: 'course', light: { role: 'logged' } }, '银杏：已完成小结'], ['open', { kind: 'course', light: { role: 'opened' } }, '嫩芽：已开课'], ['plan', { kind: 'course', light: { role: 'lesson' } }, '木桩：计划课程'], '种下银杏表示这节课完成过，不代表知识都已掌握'],
      knowledge: [['bright', { kind: 'leaf', light: { kind: 'leaf', observed: true, probability: .92 } }, '树越高大，掌握估计越高'], ['mid', { kind: 'leaf', light: { kind: 'leaf', observed: true, probability: .42 } }, '小树苗：仍在巩固'], ['dim', { kind: 'leaf', light: { kind: 'leaf', observed: false } }, '土堆：尚未评估'],
        ['parent', { kind: 'parent', light: { kind: 'parent', leafCount: 3, observedCount: 3, coverage: 1, mastery: .7 } }, '父节点：脚下草地越绿，已评估的叶子越多'], ['faint', { kind: 'unlinked', light: { kind: 'unlinked' }, node: { kind: 'page' } }, '灌木：尚未关联能力'],
        ['rock', { kind: 'unlinked', light: { kind: 'unlinked' }, node: { kind: 'asset' } }, '石头：资料文件'], '树的大小按已记录的评估推算，不是考试分数'],
    },
  };

  function StarLegend({ mode = 'knowledge' }) {
    const sky = useSky(React), legend = LEGEND[sky];
    const items = legend[mode === 'course' ? 'course' : 'knowledge'].map(item => typeof item === 'string'
      ? h('small', { key: 'note' }, item)
      : h('span', { key: item[0] }, h(StarSwatch, { key: sky, star: { key: item[0], ...item[1] } }), item[2]));
    return h('div', { className: 'nv-star-legend', 'data-sky': sky, 'aria-label': legend.name }, items);
  }

  /** The numbers behind one star, in the learner's words. */
  function StarReading({ star, error }) {
    const light = star?.light, state = starLight(star).state, forest = useSky(React) === 'forest', term = forest ? '状态' : '星光';
    const row = (name, value) => h('div', { key: name }, h('span', null, name), h('b', null, value));
    const meter = (key, value) => h('span', { key, className: 'nv-star-meter', 'aria-hidden': true }, h('i', { style: { width: percent(value) } }));
    let body;
    if (star?.kind === 'course') {
      body = light?.role === 'logged'
        ? [row(term, forest ? '已种下银杏' : '已点亮'), light.savedAt && row('完成于', dayOf(light.savedAt)), h('p', { key: 'note' }, `这节课已保存正式小结。${forest ? '银杏' : '点亮'}只表示课程完成过，不表示所有知识点已经掌握。`)]
        : [row(term, forest ? '尚未完成' : '尚未点亮'), h('p', { key: 'note' }, light?.role === 'opened' ? `已经开课，保存正式小结后${forest ? '种下银杏' : '点亮'}。` : '还没有开课。')];
    } else if (!light) body = [h('p', { key: 'note' }, error || (forest ? '正在读取…' : '星光正在读取…'))];
    else if (light.kind === 'leaf' && light.unreadable) body = [row(term, '无法读取'), h('p', { key: 'note' }, '这张卡片的评估记录格式有问题，请在资产页检查。它不计入上层掌握度。')];
    else if (light.kind === 'leaf') body = light.observed
      ? [row('掌握估计', `约 ${percent(light.probability)}`), meter('m', light.probability), row('评估记录', `${light.evidenceCount} 次`), row('最近证据', dayOf(light.lastEvidenceAt) || '—'), row('证据', light.confidence === 'supported' ? '较充分' : '初步'), h('p', { key: 'note' }, '按这张卡片已记录的能力评估推算，不是考试分数。')]
      : [row(term, '尚未评估'), h('p', { key: 'note' }, `还没有“已表现出来”或“仍有困难”的评估记录；尚未观察的评估${forest ? '不会让树长大' : '不改变星光'}。`)];
    else if (light.kind === 'parent' && light.leafCount) body = [
      state === 'lit' ? row('整体掌握', `约 ${percent(light.mastery)}`) : row(term, '尚未评估'), state === 'lit' && meter('m', light.mastery),
      row('已评估叶子', `${light.observedCount} / ${light.leafCount}`), meter('c', light.coverage), row('评估记录', `${light.evidenceCount} 次`), light.lastEvidenceAt && row('最近证据', dayOf(light.lastEvidenceAt)),
      light.unreadableCount > 0 && h('p', { key: 'bad' }, `有 ${light.unreadableCount} 张卡片的评估记录无法读取，未计入。`),
      h('p', { key: 'note' }, '由全部叶子卡片聚合，不随筛选或展开层级变化；未评估的叶子按先验计入，薄弱的基础会拉低整体。')];
    else body = [row(term, '尚未关联能力'), h('p', { key: 'note' }, '这个节点下面没有可评估的知识卡片，不参与掌握度计算。')];
    return h('section', { className: 'nv-star-reading', 'aria-label': forest ? '生长' : '星光' }, body.filter(Boolean));
  }

  return { StarMap, StarLegend, StarReading, useSky: () => useSky(React) };
}
