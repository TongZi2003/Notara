import { autocompletion, closeBrackets, closeBracketsKeymap, completeAnyWord, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { LanguageSupport, StreamLanguage, bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { c, cpp, java } from '@codemirror/legacy-modes/mode/clike';
import { gas } from '@codemirror/legacy-modes/mode/gas';
import { go } from '@codemirror/legacy-modes/mode/go';
import { json } from '@codemirror/legacy-modes/mode/javascript';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { scheme } from '@codemirror/legacy-modes/mode/scheme';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { CODE_LANGUAGES } from './media.js';

/**
 * The Vault's lightweight code editor: highlighting, language-aware indentation,
 * bracket handling and completion of names already in the file. It edits text
 * only; running and testing use the learner's own toolchain.
 */
const STREAM_PARSERS = { scheme, sql: standardSQL, c, cpp, java, go, rust, shell, verilog, vhdl, asm: gas, lua, ruby, yaml, toml, json };
const anyWord = EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]);

/** The editor mode for one language: a full grammar where installed, otherwise a stream mode. */
export function languageSupport(language) {
  if (language === 'python') return python();
  if (language === 'javascript') return javascript({ jsx: true });
  if (language === 'typescript') return javascript({ typescript: true, jsx: true });
  const parser = STREAM_PARSERS[language];
  if (!parser) return anyWord;
  const stream = StreamLanguage.define(parser);
  return new LanguageSupport(stream, stream.data.of({ autocomplete: completeAnyWord }));
}

/** Everything but the view-specific listeners, so the state is testable without a page. */
export function codeExtensions(language, { onSave } = {}) {
  const indent = CODE_LANGUAGES[language]?.indent ?? 4;
  return [
    lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), history(), drawSelection(),
    indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorState.tabSize.of(indent), indentUnit.of(language === 'go' ? '\t' : ' '.repeat(indent)),
    keymap.of([
      ...(onSave ? [{ key: 'Mod-s', preventDefault: true, run: () => { onSave(); return true; } }] : []),
      ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab,
    ]),
    languageSupport(language),
  ];
}

/** Asset bytes → text; anything that is not UTF-8 is not edited here. */
export function decodeCodeText(dataUrl) {
  const comma = dataUrl.indexOf(','), binary = atob(dataUrl.slice(comma + 1));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('code_text_invalid'); }
}

export function encodeCodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

const EXTERNAL = Annotation.define();
const CSS = `
.nv-code{display:grid;grid-template-rows:auto 1fr;min-height:0;height:100%;gap:8px}
.nv-code-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.nv-code-bar b{color:var(--dsw-alias-label-primary);font-weight:600;font-size:13px}
.nv-code-bar [role=status]{margin-left:auto}
.nv-code-host{min-height:320px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.nv-code-host .cm-editor{height:100%;font-size:13px}
.nv-code-host .cm-scroller{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.55}
.nv-code-host .cm-gutters{background:transparent;border-right:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.nv-code-host .cm-activeLine,.nv-code-host .cm-activeLineGutter{background:rgba(127,127,127,.07)}
`;

export function createCodeEditor(React) {
  const h = React.createElement, { useEffect, useRef, useState } = React;

  /**
   * One open code file. External edits (the teacher's native edit) replace a clean
   * buffer and never a dirty one; 放弃修改 loads the latest text. `onDirty` tells
   * the page, which refuses to switch files while there are unsaved edits.
   */
  function CodeEditor({ vault, asset, onSaved, onDirty }) {
    const host = useRef(null), view = useRef(null), revision = useRef(asset.revision), save = useRef(null);
    const [dirty, setDirty] = useState(false), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false), [broken, setBroken] = useState('');
    const dirtyRef = useRef(false), report = useRef(onDirty);
    report.current = onDirty;
    const markDirty = value => { dirtyRef.current = value; setDirty(value); report.current?.(value); };
    const language = asset.language ?? 'text', label = CODE_LANGUAGES[language]?.label ?? '纯文本';
    save.current = async () => {
      if (!view.current || saving) return;
      setSaving(true);
      try {
        const result = await vault.saveAsset({ path: asset.path, dataBase64: encodeCodeText(view.current.state.doc.toString()), mime: asset.mime, expectedRevision: revision.current });
        if (result?.ok) { revision.current = result.value.revision; markDirty(false); setNotice('已保存'); onSaved?.(result.value); }
        else setNotice('文件在你打开之后被改过（可能是老师刚修改），这次没有保存。先复制你的改动，再点“放弃修改”载入最新内容。');
      } catch { setNotice('暂时没有保存，请稍后再试。'); }
      finally { setSaving(false); }
    };
    useEffect(() => {
      let text;
      try { text = decodeCodeText(asset.dataUrl); } catch { setBroken('这个文件不是 UTF-8 文本，不能在这里编辑。'); return undefined; }
      revision.current = asset.revision;
      view.current = new EditorView({ parent: host.current, state: EditorState.create({ doc: text, extensions: [
        ...codeExtensions(language, { onSave: () => { void save.current?.(); } }),
        EditorView.contentAttributes.of({ 'aria-label': `${asset.path} 代码` }),
        EditorView.updateListener.of(update => {
          if (update.transactions.some(tr => tr.docChanged && !tr.annotation(EXTERNAL)) && !dirtyRef.current) { markDirty(true); setNotice(''); }
        }),
      ] }) });
      return () => { view.current?.destroy(); view.current = null; if (dirtyRef.current) report.current?.(false); };
    }, [asset.path]);
    useEffect(() => {
      if (!view.current || asset.revision === revision.current) return;
      if (dirtyRef.current) { setNotice('文件在别处被改过（可能是老师刚修改）。你的改动还在编辑器里，保存会被拒绝；先复制改动，再点“放弃修改”载入最新内容。'); return; }
      let text;
      try { text = decodeCodeText(asset.dataUrl); } catch { return; }
      view.current.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: text }, annotations: EXTERNAL.of(true) });
      revision.current = asset.revision;
      setNotice('已载入文件的最新内容');
    }, [asset.revision]);
    const discard = () => {
      if (!view.current) return;
      let text;
      try { text = decodeCodeText(asset.dataUrl); } catch { return; }
      view.current.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: text }, annotations: EXTERNAL.of(true) });
      revision.current = asset.revision; markDirty(false); setNotice('已放弃修改');
    };
    return h('section', { className: 'nv-code', 'aria-label': `代码编辑：${asset.path}` }, h('style', null, CSS),
      h('div', { className: 'nv-code-bar' },
        h('b', null, asset.path), h('span', null, label), h('span', null, '只编辑文本；运行与测试用本机的工具链'),
        h('span', { role: 'status' }, broken || notice || (dirty ? '有未保存的修改' : '')),
        !broken && h('button', { type: 'button', className: 'nv-quiet', disabled: !dirty || saving, onClick: discard }, '放弃修改'),
        !broken && h('button', { type: 'button', className: 'nv-quiet', disabled: !dirty || saving, onClick: () => { void save.current?.(); } }, saving ? '正在保存…' : '保存')),
      broken ? h('p', null, broken) : h('div', { className: 'nv-code-host', ref: host }));
  }

  return { CodeEditor };
}
