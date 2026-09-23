/**
 * Student-facing LaTeX for the vault Live Preview.
 *
 * `$inline$` and `$$display$$` stay ordinary Markdown source. The rendered
 * formula is only a decoration, never a second document, and it shows its TeX
 * again as soon as the cursor enters the formula, so reading, clicking and
 * editing remain one continuous action.
 */
import katex from 'katex';
import { WidgetType } from '@codemirror/view';

export const MATH_INLINE = 'VaultMathInline';
export const MATH_DISPLAY = 'VaultMathDisplay';

const DOLLAR = 36;
const BACKSLASH = 92;
const KATEX_SETTINGS = { trust: false, throwOnError: true, strict: 'ignore', maxExpand: 300, maxSize: 30 };

/** A delimiter behind an odd number of backslashes is escaped text, not math. */
function isEscaped(cx, pos) {
  let backslashes = 0;
  for (let scan = pos - 1; scan >= 0 && cx.char(scan) === BACKSLASH; scan -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/** TeX that is written like money or has a space against its delimiter is prose. */
function usable(source) {
  return Boolean(source) && !/^\s/.test(source) && !/\s$/.test(source);
}

// `$…$` and inline `$$…$$` are one-line by construction; a paragraph that is
// nothing but `$$…$$` is handled as a display block by the decoration builder.
export const mathSyntax = {
  defineNodes: [MATH_DISPLAY, MATH_INLINE],
  parseInline: [{
    name: MATH_DISPLAY,
    parse(cx, next, pos) {
      if (next !== DOLLAR || cx.char(pos + 1) !== DOLLAR || isEscaped(cx, pos)) return -1;
      const match = /^\$\$([^\n]+?)\$\$(?!\$)/.exec(cx.slice(pos, cx.end));
      if (!match || !usable(match[1])) return -1;
      return cx.addElement(cx.elt(MATH_DISPLAY, pos, pos + match[0].length));
    },
  }, {
    name: MATH_INLINE,
    parse(cx, next, pos) {
      if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR || isEscaped(cx, pos)) return -1;
      for (let end = pos + 1; end < cx.end; end += 1) {
        if (cx.char(end) === 10) return -1;
        if (cx.char(end) !== DOLLAR || isEscaped(cx, end)) continue;
        const source = cx.slice(pos + 1, end);
        if (!usable(source) || /[\d$]/.test(String.fromCharCode(cx.char(end + 1)))) return -1;
        return cx.addElement(cx.elt(MATH_INLINE, pos, end + 1));
      }
      return -1;
    },
  }],
};

/** Delimiters of a parsed math node: `$x$` keeps one character, `$$x$$` two. */
export function mathSource(name, raw) {
  const width = name === MATH_DISPLAY ? 2 : 1;
  return raw.slice(width, raw.length - width);
}

/**
 * A paragraph that is nothing but `$$…$$` becomes a display block. Prose that
 * merely contains dollars, or an unmatched `$$`, returns null and stays source.
 */
export function displayMathSource(text) {
  const match = /^\s*\$\$((?:(?!\$\$)[\s\S])*)\$\$\s*$/.exec(text);
  const source = match?.[1];
  return source && source.trim() ? source : null;
}

const rendered = new Map();

/** Render once per formula; a broken formula returns null and stays editable. */
export function renderMath(source, display) {
  ensureMathStyles();
  const key = `${display ? 'display' : 'inline'}\u0000${source}`;
  if (rendered.has(key)) return rendered.get(key) ?? null;
  let html = null;
  try { html = katex.renderToString(source, { ...KATEX_SETTINGS, displayMode: display }); }
  catch { html = null; }
  if (rendered.size > 300) rendered.clear();
  rendered.set(key, html);
  return html;
}

class MathWidget extends WidgetType {
  kind = 'math';
  constructor(source, display, from, to, html) {
    super();
    this.source = source; this.display = display; this.from = from; this.to = to; this.html = html;
    this.cursor = from + (display ? 2 : 1);
  }
  eq(other) {
    return this.source === other.source && this.display === other.display
      && this.from === other.from && this.to === other.to;
  }
  toDOM(view) {
    const root = document.createElement(this.display ? 'div' : 'span');
    root.className = `cm-vault-math ${this.display ? 'cm-vault-math-display' : 'cm-vault-math-inline'}`;
    root.innerHTML = this.html;
    root.title = this.source;
    root.addEventListener('mousedown', event => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.cursor }, scrollIntoView: true });
      view.focus();
    });
    return root;
  }
  ignoreEvent() { return true; }
}

/** A widget for a renderable formula; null keeps the TeX source visible. */
export function mathWidget(kind, source, from, to) {
  const display = kind === 'display';
  const html = renderMath(source, display);
  return html ? new MathWidget(source, display, from, to, html) : null;
}

// The build inlines KaTeX's stylesheet and webfonts here; an unbuilt checkout
// keeps the placeholder and simply renders with the surrounding theme.
const mathStyles = { css: '__NOTARA_VAULT_LATEX_CSS__', applied: false };

export function ensureMathStyles() {
  if (mathStyles.applied || typeof document === 'undefined') return;
  mathStyles.applied = true;
  const css = mathStyles.css;
  if (typeof css !== 'string' || !css.includes('@font-face')) return;
  try {
    const style = document.createElement('style');
    style.dataset.notaraMathStyles = 'katex';
    style.textContent = css;
    document.head.append(style);
  } catch { /* styling is cosmetic; the formula itself still renders */ }
}
