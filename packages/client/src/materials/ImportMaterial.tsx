/**
 * P3.1 the one way a file becomes a material: pick, drop, or paste.
 *
 * The control only decides *which* files the student chose; the page turns them
 * into bytes and one Host operation. Nothing here names, versions or stores a
 * material on its own, and an import never creates a lesson or a learning set.
 */
import { useEffect, useRef, useState } from 'react';

export interface ImportMaterialProps {
  /** One Host import runs at a time; the control stays inert while it does. */
  readonly pending: boolean;
  /** Every picked file, in the order the student chose them. */
  readonly onFiles: (files: readonly File[]) => void;
}

/** Accept list for the file picker; the page still validates what arrives. */
const ACCEPT = '.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.svg,.md,.markdown,.html,.htm,.txt';

/** Pick, drop, or paste one original into the materials list. */
export function ImportMaterial({ pending, onFiles }: ImportMaterialProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);

  // Pasting is a page-level gesture: a screenshot has no file path to pick.
  useEffect(() => {
    function onPaste(event: ClipboardEvent): void {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      onFiles(files);
    }
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('paste', onPaste); };
  }, [onFiles]);

  return <section className="sf-import" aria-label="导入资料">
    <input
      ref={inputRef}
      className="sf-import-input"
      type="file"
      multiple
      accept={ACCEPT}
      data-testid="material-file-input"
      onChange={event => {
        const files = [...(event.target.files ?? [])];
        event.target.value = '';
        if (files.length > 0) onFiles(files);
      }}
    />
    <div
      className={over ? 'sf-import-drop sf-import-drop-over' : 'sf-import-drop'}
      data-testid="material-drop-zone"
      onDragOver={event => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => { setOver(false); }}
      onDrop={event => {
        event.preventDefault();
        setOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length > 0) onFiles(files);
      }}
    >
      <button type="button" className="sf-action" disabled={pending} data-testid="material-pick"
        onClick={() => { inputRef.current?.click(); }}>
        {pending ? '正在收下…' : '导入一份资料'}
      </button>
      <p className="sf-note">把文件拖到这里，或直接粘贴一张图。PDF、Word、图片、Markdown、网页、纯文本都可以；导入后直接读，不会替你开课。</p>
    </div>
  </section>;
}
