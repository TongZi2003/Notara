# Minimal theme polish — draft spec

Scope: Native Vault white minimal theme only (`examples/native-vault`). Polish, not redesign:
keep IA, features, copy, white + light-gray direction (user previously rejected yellow tints and
big black buttons; wants pure white background and light-gray buttons). No changes to
packages/client, the notebook theme, native DSH packages, or board canvas colors.

Where things live: tokens `modern-theme.js` (`pairs`), overrides `modern-theme.css`,
home `today-entry.css`, module base CSS strings `ui-client.js` (UI_CSS), `views-client.js` (CSS),
`calendar-client.js` (CSS), `routes-client.js` (ROUTE_CSS), inline `STYLE` in `client-source.ts`.
Prefer expressing changes in modern-theme.css / tokens; touch module CSS or STYLE only where
inline styles or layout (not just skin) must change.

## 1. Scale tokens (on `body[data-notara-ui=modern]`)
- Radius: `--nv-r-sm:8px` (tags, badges, icon buttons, menu items), `--nv-r-md:10px` (buttons,
  inputs, selects, segmented items, list/nav rows), `--nv-r-lg:14px` (cards, menus/popovers,
  route cards/nodes, worker cards), `--nv-r-xl:20px` (sidebar card, dialogs, composer card).
  Keep old names as aliases: `--nv-control-radius:var(--nv-r-md)` (was 14),
  `--nv-card-radius:var(--nv-r-lg)` (was 20), `--nv-input-radius:var(--nv-r-xl)` (was 24).
  Replace literal radii in modern-theme.css / today-entry.css with the scale
  (7–9→sm, 10–13→md, 14–16→lg, 18–24→xl). Nested rule: a container with padding p around an
  item of radius r gets radius r+p (segmented track = calc(var(--nv-r-md) + 3px)).
- Heights: toolbar controls (buttons, inputs, selects) 32px; segmented items 28px inside a
  3px-padded track; dialog form fields 36px.
- Shadows: `--nv-shadow-sm:0 1px 2px rgba(20,28,38,.06)` (segmented thumb);
  `--nv-shadow-md:0 8px 24px rgba(20,28,38,.08),0 1px 2px rgba(20,28,38,.04)` (menus, popovers);
  `--nv-shadow-lg:0 24px 64px rgba(20,28,38,.14)` (dialogs). Cards: no shadow.
  Dark: same geometry with rgba(0,0,0,.35/.45/.5). Keep `--nv-shadow` as alias of md.

## 2. Color token adjustments (`modern-theme.js` pairs; [light, dark])
- `--dsw-alias-interactive-bg-hover` and `-hover-solid`: ['#f3f4f6','#232830'] (active is
  currently LIGHTER than hover in light mode, and a heavy bluish slab in dark).
- `--dsw-alias-interactive-bg-active`: ['#ebedf0','#2b313a'].
- `--dsw-alias-button-info-fill`: ['#f0f1f3','#2b313a']; `-hover`: ['#e6e8eb','#353c46'].
- User chat bubble: find the native token that paints the user bubble (currently light bluish)
  and set it to ['#f3f4f6','#252b34'] via the same pairs map.
- Dark-only custom vars for things tokens don't cover (e.g. segmented thumb): use
  `body[data-notara-ui=modern][data-ds-dark-theme]` after confirming that attribute is present in
  dark mode in this runtime; thumb = light #ffffff / dark #313842.
- `.nv-board-tool-row` hardcoded #8a929d → var(--dsw-alias-label-caption).
- Checkbox accent → var(--dsw-alias-label-primary).

## 3. Typography
- CJK headings: letter-spacing no tighter than -.01em (`.nv-workspace :is(h1,h2,h3)` → -.005em,
  `.nv-lesson-entry h1` → -.01em, `.nv-home-welcome h1` → -.01em).
- `font-variant-numeric:tabular-nums` on dates/counts: session row time, review row dates,
  month grid days, home ticker position, card/graph counts.

## 4. Shell
- Remove the full-height vertical divider line drawn at the edge of the sidebar column (beside
  the floating sidebar card) in the modern theme; keep the card's own border. Locate the element
  in the DOM (native layout container border or resize handle). If it is a resize handle, keep it
  functional: transparent by default, visible on hover/drag.
- Sidebar: card radius xl; nav rows / 新的一课 / directory button radius md, rows 36px tall
  (padding 8px 12px), nav gap 2px; brand mark radius sm; active row = interactive-bg-active +
  label-primary + 500; hover = interactive-bg-hover.
- `.nv-shell-heading`: min-height 64px.

## 5. Segmented controls — one look everywhere
Applies to `.nv-shell-tabs`, `.nv-route-views`, `.nv-class-views` (对话/白板/教室, currently a
gray pill without track), `.nb-tabs` (board 课堂板书/知识视图), and `.nv-workspace-tabs` where it
acts as a tab set. Track: bg layer-2, padding 3px, gap 2px, radius md+3. Item: height 28px,
padding 0 12px, radius md, label-secondary, hover label-primary; selected: thumb bg (white /
dark #313842), label-primary, 500, shadow-sm.

## 6. Form fields (scoped to `[data-notara-ui=modern] :is(.nv-workspace,.nv-dialog)`)
Exclude CodeMirror (`.cm-editor`), the native composer (`[data-composer-card]`), and `.nb-board`.
- `select`, text-like `input`s (text/search/date/number/untyped), `textarea`: 1px border-l1
  (hover border-l2), radius md, bg layer-1, label-primary, font inherit 13px; inputs/selects 32px
  tall, padding 0 10px; textarea padding 8px 10px, line-height 1.6, resize vertical.
- `select`: appearance:none, padding-right 28px, chevron as an inline SVG background in a
  mid-gray (#8a93a0) that reads in both modes.
- Placeholder: label-caption. Focus: border-l3 +
  `box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-active)`, no outline.
- Inline-styled fields in `client-source.ts` STYLE (search, templateInput, assetPage): align to the
  same values (radius 10, border l1) so they match.

## 7. Buttons and links
- Page-level secondary text buttons (e.g. 带入对话复习, 添加能力, 保存评估, 浏览文件夹, 打开目录,
  shell toolbar buttons, STYLE.quiet): no border, bg button-info-fill, hover button-info-hover,
  radius md, 32px tall, padding 0 12px, label-primary, 500; disabled opacity .45. Find each
  button's actual source/class; do not restyle composer, board toolbar, or icon buttons.
- Text links (STYLE.link — e.g. card footer "↩ 圆锥曲线 / 复习安排 / 在图谱中查看"): no
  underline; label-secondary; hover label-primary + underline (inline style can't hover — give
  the link a class and move decoration to CSS). `.nv-card-source` becomes a wrapping row
  (flex, wrap, gap 6px 16px) instead of one link per line.
- Focus-visible for workspace/sidebar buttons: 2px solid border-l3, offset 2px.

## 8. Cards, lists, menus, dialogs
- `.nv-card`: radius lg, padding 18px; title 15px/600; `.nv-card-kind` radius 6px, 11px.
  `.nv-worker-card`, route cards/nodes: radius lg (via alias).
- Review row selected: radius md.
- `.nv-menu,.nv-popover-panel`: radius lg, padding 6px, border l1, shadow-md; items radius sm,
  32px tall, padding 0 10px.
- `.nv-dialog>section`: radius xl, shadow-lg. Native settings panel radius 24 → xl.

## 9. Toolbar stacking
- 资料库·卡片: drop the divider between the toolbar row (search/select/checkbox/count) and the
  chip filter row so they read as one block; tighten the gap; keep one divider under the chips.
  Chips: 28px, radius md, selected = button-info-fill + label-primary, no border.
- 计划·复习: drop the divider between the filter chips row and the search row (one group).

## 10. Composer
- Dark mode home: the composer shows a rectangular darker backdrop behind its rounded card —
  remove it so the card sits directly on the page (find the element painting it).
- Hero composer card radius xl (was 22); keep border l1 + faint shadow.

## Out of scope
Board canvas/dark board colors, IA/copy changes, native DSH internals beyond tokens, locale
strings, packages/client, notebook theme.
