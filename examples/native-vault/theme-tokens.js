/**
 * The two Native Vault looks as native token layers. 极简 is the released
 * default; 手帐 repaints the same tokens as paper and ink and adds its own
 * `--nb-*` paper tokens, so every component that reads the native aliases
 * follows the notebook without a second set of dark-mode selectors.
 */

const pairs = {
  '--dsw-alias-bg-base':['#ffffff','#15181d'],
  '--dsw-alias-bg-layer-1':['#ffffff','#1d2128'],
  '--dsw-alias-bg-layer-2':['#f4f5f6','#242a33'],
  '--dsw-alias-bg-layer-3':['#eceef0','#2a323e'],
  '--dsw-alias-bg-module-platform':['#f4f5f6','#242a33'],
  '--dsw-specific-sidebar-fill':['#ffffff','#1b1f25'],
  '--dsw-specific-input-major':['#ffffff','#1d2128'],
  '--dsw-specific-selector':['#f4f5f6','#242a33'],
  '--dsw-alias-interactive-bg-hover':['#f3f4f6','#232830'],
  '--dsw-alias-interactive-bg-hover-solid':['#f3f4f6','#232830'],
  '--dsw-alias-interactive-bg-active':['#ebedf0','#2b313a'],
  '--dsw-alias-border-l1':['#e8ecf0','#2b323d'],
  '--dsw-alias-border-l2':['#d8dee6','#3b4553'],
  '--dsw-alias-border-l3':['#c7cdd4','#525c69'],
  '--dsw-alias-border-l4':['#b8c0ca','#66707e'],
  '--dsw-alias-label-primary':['#20252c','#edf0f4'],
  '--dsw-alias-label-secondary':['#525c69','#bac3cf'],
  '--dsw-alias-label-tertiary':['#697482','#a1aab7'],
  '--dsw-alias-label-caption':['#76808c','#939eac'],
  '--dsw-alias-label-link':['#59626e','#b5becb'],
  '--dsw-alias-link':['#59626e','#b5becb'],
  '--dsw-alias-brand-primary':['#59626e','#b5becb'],
  '--dsw-alias-state-business-primary':['#59626e','#b5becb'],
  '--dsw-alias-button-info-fill':['#f0f1f3','#2b313a'],
  '--dsw-alias-button-info-hover':['#e6e8eb','#353c46'],
  '--dsw-specific-bubble':['#f3f4f6','#252b34'],
  '--dsw-specific-bubble-highlight':['#e6e8eb','#2f3640'],
  '--dsh-composer-primary-color':['#343c46','#edf0f4'],
};
const font = '"Helvetica Neue",Helvetica,"Hiragino Sans GB","PingFang SC","Noto Sans SC","Microsoft YaHei UI",Arial,sans-serif';
const layer = entries => Object.fromEntries(Object.entries(entries).map(([name, [light, dark]]) => [name, { light, dark }]));
export const MODERN_TOKENS = { ...layer(pairs), '--dsw-font-family': { light: font, dark: font } };

/** The handwriting face the notebook loads on demand (霞鹜文楷, SIL OFL 1.1). */
export const NOTEBOOK_FONT_FAMILY = 'Notara WenKai';
const hand = `"${NOTEBOOK_FONT_FAMILY}","LXGW WenKai","Kaiti SC","STKaiti","KaiTi",serif`;

/** 手帐 paper and ink (docs/ui/notara-frontend-redesign.md §5.1, 手帐 · 浅 / 深). */
const notebook = {
  '--dsw-alias-bg-base':['#fbf7ee','#23211c'],
  '--dsw-alias-bg-layer-1':['#fffdf7','#2a2822'],
  '--dsw-alias-bg-layer-2':['#f3eddf','#2a2822'],
  '--dsw-alias-bg-layer-3':['#e6dcc5','#39362e'],
  '--dsw-alias-bg-module-platform':['#f3eddf','#2a2822'],
  '--dsw-specific-sidebar-fill':['#f3ecdb','#1d1b17'],
  '--dsw-specific-input-major':['#fffdf7','#2a2822'],
  '--dsw-specific-selector':['#f3eddf','#2a2822'],
  '--dsw-alias-interactive-bg-hover':['#ece4d1','#322f28'],
  '--dsw-alias-interactive-bg-hover-solid':['#ece4d1','#322f28'],
  '--dsw-alias-interactive-bg-active':['#e6dcc5','#39362e'],
  '--dsw-alias-border-l1':['#e4dbc6','#3a362d'],
  '--dsw-alias-border-l2':['#d2c6a9','#4a4539'],
  '--dsw-alias-border-l3':['#c2b594','#5a5446'],
  '--dsw-alias-border-l4':['#ab9d7b','#6b6453'],
  '--dsw-alias-label-primary':['#2e3548','#ebe4d3'],
  '--dsw-alias-label-secondary':['#5b5f70','#bdb5a2'],
  '--dsw-alias-label-tertiary':['#7d7867','#a39b88'],
  '--dsw-alias-label-caption':['#958f7e','#8c8575'],
  '--dsw-alias-label-link':['#34589c','#9db4e8'],
  '--dsw-alias-link':['#34589c','#9db4e8'],
  '--dsw-alias-brand-primary':['#34589c','#9db4e8'],
  '--dsw-alias-state-business-primary':['#34589c','#9db4e8'],
  '--dsw-alias-button-info-fill':['#efe7d4','#2f2c25'],
  '--dsw-alias-button-info-hover':['#e6dcc5','#39362e'],
  // A student's message is a sticky note on the page.
  '--dsw-specific-bubble':['#fff3bf','#4a4128'],
  '--dsw-specific-bubble-highlight':['#fbe9a0','#554a2e'],
  '--dsh-composer-primary-color':['#34589c','#9db4e8'],
  // Paper, notes and marks the notebook stylesheet draws with.
  '--nb-card':['#fffdf7','#2a2822'],
  '--nb-note':['#fff3bf','#4a4128'],
  '--nb-note-blue':['#e6effb','#28303d'],
  '--nb-hl':['rgba(252,214,92,.5)','rgba(200,160,60,.28)'],
  '--nb-tape':['rgba(214,196,140,.55)','rgba(160,140,90,.35)'],
  '--nb-rule':['#dde3ef','#34373f'],
  '--nb-margin':['#f0c2bb','#5a3531'],
  '--nb-seal':['#c0392b','#ff9180'],
  '--nb-accent':['#34589c','#9db4e8'],
  '--nb-accent-soft':['#e3e8f2','#2c3346'],
  '--nb-hole':['#fbf7ee','#23211c'],
  '--nb-wave':['#b0621a','#f0b060'],
  '--nb-shadow-1':['0 1px 0 rgba(90,70,30,.08)','0 1px 0 rgba(0,0,0,.3)'],
  '--nb-shadow-2':['0 6px 18px rgba(90,70,30,.14),0 1px 2px rgba(90,70,30,.1)','0 6px 18px rgba(0,0,0,.4),0 1px 2px rgba(0,0,0,.3)'],
};
export const NOTEBOOK_TOKENS = { ...layer(notebook), '--dsw-font-family': { light: hand, dark: hand } };

/** The token layer for a style; anything unknown is the released minimal theme. */
export const themeTokens = style => style === 'notebook' ? { ...MODERN_TOKENS, ...NOTEBOOK_TOKENS } : MODERN_TOKENS;
