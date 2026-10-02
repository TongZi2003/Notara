/**
 * Where every lesson-board block sits, computed from the writing order and the
 * blocks' measured heights — never guessed from text length. Each section is a
 * blackboard of up to three columns written top to bottom: a column that is
 * full moves on to the next, and when all are full a new band starts below.
 * A wide block spans two columns and a full one all three, each placed under
 * what the columns it covers already hold. A block the student dragged is
 * pinned: its own x/y win and the flow neither moves nor avoids it.
 *
 * Sections run left to right. When the teacher starts the next section, the
 * previous one keeps only the columns it had used by then; blocks added to it
 * later go down within those columns (a wider block narrows to fit). So a
 * section with two short blocks is one column wide, not three.
 *
 * Positions depend only on earlier blocks, so adding a block never moves the
 * ones already placed; a block that grows only pushes down what is under it.
 */
export const BOARD_SIZES = Object.freeze(['narrow', 'wide', 'full']);
export const BOARD_RESIZE_LIMITS = Object.freeze({ minWidth: 230, maxWidth: 1600, minHeight: 100, maxHeight: 4000 });
export const LAYOUT = Object.freeze({ track: 340, gutter: 36, gap: 28, columns: 3, columnHeight: 900, sectionGap: 72, titleHeight: 64, origin: 60, estimate: 180 });

const spanOf = size => size === 'full' ? 3 : size === 'wide' ? 2 : 1;
export const sizeWidth = (size, layout = LAYOUT) => spanOf(size) * layout.track + (spanOf(size) - 1) * layout.gutter;
export const sectionWidth = (layout = LAYOUT, columns = layout.columns) => columns * layout.track + (columns - 1) * layout.gutter;
export const isPinned = block => Number.isFinite(block.x) && Number.isFinite(block.y);

/**
 * @param sections ordered `{id,title}` list
 * @param blocks blocks in writing order: `{id, section, size, x?, y?, width?, place?}`
 * @param heights measured height per block id (missing ones use an estimate)
 * @returns `{positions: Map(id → {x,y,width,height?}), frames: [{id,title,x,y,width,height,columns,titleWidth}]}`
 */
export function layoutBoard(sections, blocks, heights = new Map(), layout = LAYOUT) {
  const positions = new Map(), frames = [];
  const heightOf = id => { const value = heights.get(id); return Number.isFinite(value) && value > 0 ? value : layout.estimate; };
  const known = new Set(sections.map(section => section.id));
  // Pinned blocks without a section are the old board's own positions; the
  // sections begin to the right of them.
  let legacyRight = -Infinity;
  for (const block of blocks) {
    if (!isPinned(block)) continue;
    const width = Number.isFinite(block.width) ? block.width : sizeWidth(block.size, layout);
    positions.set(block.id, { x: block.x, y: block.y, width, ...(Number.isFinite(block.height)?{height:block.height}:{}), pinned: true });
    if (!known.has(block.section)) legacyRight = Math.max(legacyRight, block.x + width);
  }
  let left = Number.isFinite(legacyRight) ? legacyRight + layout.sectionGap : layout.origin;
  const step = layout.track + layout.gutter;
  // Where each section's writing began: the next section's start freezes the previous one's width.
  const firstIndex = new Map();
  blocks.forEach((block, index) => { if (!firstIndex.has(block.section)) firstIndex.set(block.section, index); });
  for (const [sectionIndex, section] of sections.entries()) {
    const top = layout.origin, start = top + layout.titleHeight;
    const next = sections.slice(sectionIndex + 1).map(item => firstIndex.get(item.id)).filter(Number.isFinite);
    const cutoff = next.length ? Math.min(...next) : Infinity;
    const bottoms = Array(layout.columns).fill(start), placed = new Map();
    let current = 0, band = start, used = 0, columns = layout.columns;
    const freeze = () => { if (columns === layout.columns && Number.isFinite(cutoff)) columns = Math.max(1, used); };
    const put = (id, column, span, y) => {
      const height = heightOf(id), entry = { x: left + column * step, y, width: span * layout.track + (span - 1) * layout.gutter, column, span, height };
      placed.set(id, entry); positions.set(id, { x: entry.x, y: entry.y, width: entry.width });
      for (let c = column; c < column + span; c++) bottoms[c] = y + height + layout.gap;
      used = Math.max(used, column + span);
    };
    const lowest = (column, span) => Math.max(...bottoms.slice(column, column + span));
    for (const [index, block] of blocks.entries()) {
      if (block.section !== section.id || isPinned(block)) continue;
      // Written after the next section began: this section keeps the columns it had.
      if (index > cutoff) freeze();
      const span = Math.min(spanOf(block.size), columns), height = heightOf(block.id), anchor = block.place ? placed.get(block.place.relativeTo) : undefined;
      if (anchor && block.place.position === 'beside' && anchor.column + anchor.span + span <= columns) {
        const column = anchor.column + anchor.span;
        put(block.id, column, span, Math.max(anchor.y, lowest(column, span)));
        current = column;
        continue;
      }
      if (anchor) {
        const column = Math.min(anchor.column, columns - span);
        put(block.id, column, span, Math.max(anchor.y + anchor.height + layout.gap, lowest(column, span)));
        current = column;
        continue;
      }
      if (span === 1) {
        // A full column hands over to the next; after the last one a new band
        // starts below everything written so far.
        const full = column => bottoms[column] > band && bottoms[column] + height > band + layout.columnHeight;
        current = Math.min(current, columns - 1);
        while (full(current) && current < columns - 1) current += 1;
        if (full(current)) { band = Math.max(...bottoms.slice(0, columns)); bottoms.fill(band); current = 0; }
        put(block.id, current, 1, bottoms[current]);
        continue;
      }
      const column = current + span <= columns ? current : columns - span;
      put(block.id, column, span, lowest(column, span));
      current = column;
    }
    freeze();
    // The last section is still open to the right; an earlier one ends where its columns end.
    const shown = Number.isFinite(cutoff) ? columns : Math.max(1, used), width = sectionWidth(layout, shown);
    frames.push({ id: section.id, title: section.title, x: left, y: top, width, height: Math.max(...bottoms) - top, columns: shown,
      // A title may run into the gap before the next section, or freely past the last one.
      titleWidth: Number.isFinite(cutoff) ? width + layout.sectionGap - 16 : Math.max(width, sectionWidth(layout)) });
    left += width + layout.sectionGap;
  }
  return { positions, frames };
}

/** The reading order used by the narrow reading mode and by export. */
export function readingOrder(sections, blocks) {
  const known = new Set(sections.map(section => section.id));
  const legacy = blocks.filter(block => !known.has(block.section));
  return [
    ...(legacy.length ? [{ id: null, title: null, blocks: legacy }] : []),
    ...sections.map(section => ({ id: section.id, title: section.title, blocks: blocks.filter(block => block.section === section.id) })),
  ].filter(group => group.blocks.length);
}
