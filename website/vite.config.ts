import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import katex from 'katex';
import { defineConfig, type Plugin } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export const PAGES = {
  home: 'index.html',
  features: 'features/index.html',
  philosophy: 'philosophy/index.html',
  install: 'install/index.html',
  'first-lesson': 'first-lesson/index.html',
  faq: 'faq/index.html',
  notfound: '404.html',
} as const;

const partial = (name: string) => readFileSync(resolve(root, 'partials', `${name}.html`), 'utf8');

const decode = (text: string) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

/** Closing CJK punctuation that must not start a line after an inline formula. */
const CLOSING_PUNCTUATION = '，。、；：？！）”’」';
/** Formulas up to this TeX length stay on one line with that punctuation; longer ones keep KaTeX's own break points. */
const KEEP_WITH_PUNCTUATION = 30;

/** Render `\( … \)` and `\[ … \]` with KaTeX at build time, outside code, scripts and styles. */
function renderMath(html: string, file: string) {
  return html.split(/(<(pre|code|script|style)\b[\s\S]*?<\/\2>)/).map((part, index) => {
    if (index % 3 === 2) return '';
    if (index % 3 === 1) return part;
    const render = (tex: string, displayMode: boolean) => {
      try {
        return katex.renderToString(decode(tex.trim()), { displayMode, throwOnError: true, strict: 'error' });
      } catch (error) {
        throw new Error(`${file}: KaTeX failed on "${tex}": ${(error as Error).message}`);
      }
    };
    return part
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => render(tex, true))
      .replace(new RegExp(`\\\\\\(([\\s\\S]+?)\\\\\\)([${CLOSING_PUNCTUATION}]?)`, 'g'), (_, tex: string, punctuation: string) => {
        const math = render(tex, false);
        return punctuation && tex.trim().length <= KEEP_WITH_PUNCTUATION
          ? `<span class="math-keep">${math}${punctuation}</span>`
          : math + punctuation;
      });
  }).join('');
}

function site(): Plugin {
  return {
    name: 'notara-site',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const page = /<body[^>]*\bdata-page="([^"]+)"/.exec(html)?.[1];
        if (!page || !(page in PAGES)) throw new Error(`${context.filename}: <body data-page> must be one of ${Object.keys(PAGES).join(', ')}`);
        const withPartials = html.replace(/<!--\s*@include (\w+)\s*-->/g, (_, name: string) =>
          partial(name).replaceAll(`data-nav="${page}"`, `data-nav="${page}" aria-current="page"`));
        return renderMath(withPartials, context.filename);
      },
    },
  };
}

export default defineConfig({
  root,
  appType: 'mpa',
  publicDir: 'public',
  plugins: [site()],
  server: { port: 57180, strictPort: true, fs: { allow: [resolve(root, '..')] } },
  preview: { port: 57181, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: Object.fromEntries(Object.entries(PAGES).map(([key, file]) => [key, resolve(root, file)])) },
  },
});
