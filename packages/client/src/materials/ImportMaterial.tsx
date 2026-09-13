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
  /** Embedded next to the composer: only consume paste inside this control. */
  readonly pasteScope?: 'page' | 'control';
  readonly active?: boolean;
  readonly appearance?: 'sheet' | 'classroom' | 'compact';
}

/** Accept list for the file picker; the page still validates what arrives. */
const ACCEPT = '.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.svg,.md,.markdown,.html,.htm,.txt';

/** Pick, drop, or paste one original into the materials list. */
export function ImportMaterial({ pending, onFiles, pasteScope = 'page', active = true, appearance }: ImportMaterialProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const controlRef = useRef<HTMLElement | null>(null);
  const [over, setOver] = useState(false);

  // Pasting is a page-level gesture: a screenshot has no file path to pick.
  useEffect(() => {
    function onPaste(event: ClipboardEvent): void {
      if (pasteScope !== 'page' || !active || pending || event.defaultPrevented) return;
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      onFiles(files);
    }
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('paste', onPaste); };
  }, [onFiles, pending, active, pasteScope]);

  return <section className="sf-import" data-appearance={appearance} aria-label="导入资料" ref={controlRef}
    onPaste={event => {
      if (pasteScope !== 'control' || !active || pending || event.defaultPrevented) return;
      const files = [...event.clipboardData.files];
      if (!files.length) return;
      event.preventDefault(); event.stopPropagation(); onFiles(files);
    }}>
    <input
      ref={inputRef}
      className="sf-import-input"
      type="file"
      multiple
      disabled={pending || !active}
      accept={ACCEPT}
      data-testid="material-file-input"
      onChange={event => {
        const files = [...(event.target.files ?? [])];
        event.target.value = '';
        if (files.length > 0 && !pending && active) onFiles(files);
      }}
    />
    <div
      className={over ? 'sf-import-drop sf-import-drop-over' : 'sf-import-drop'}
      data-testid="material-drop-zone"
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); setOver(true); }}
      onDragLeave={() => { setOver(false); }}
      onDrop={event => {
        event.preventDefault(); event.stopPropagation();
        setOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length > 0 && !pending && active) onFiles(files);
      }}
      title="把文件拖到这里，或直接粘贴一张图"
    >
      {(appearance === 'sheet' || appearance === 'classroom') && <svg className="sf-import-glyph" viewBox="0 0 64 72" fill="none" aria-hidden="true">
        <path d="M14 7 43 5l10 12-2 47-39 2 2-59Z" />
        <path d="m42 6-1 14 12-2M23 29l17-1M23 37l12-1M23 45l10-1" />
        <path d="M46 43v18m-9-9h18" />
      </svg>}
      <button type="button" className="sf-action" disabled={pending || !active} data-testid="material-pick"
        onClick={() => { inputRef.current?.click(); }}>
        {pending ? '正在收下…' : appearance === 'sheet' ? '选择文件' : <>{appearance === 'compact' && <span aria-hidden="true">＋ </span>}导入资料</>}
      </button>
      {appearance !== 'compact' && <p className="sf-note">{appearance === 'classroom' ? <>拖进来，也可以粘贴图片<br />收进资料库，放进这节课</> : appearance === 'sheet' ? '也可以拖到这里，或粘贴图片' : '拖进来，或粘贴一张图'}</p>}
    </div>
  </section>;
}
