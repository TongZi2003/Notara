export interface StudyForgeShellProps {
  canPreview: boolean;
  previewOpen: boolean;
  pending: boolean;
  message: string;
  onPreview(): void;
}

/** P0 learning surface; classroom and learning facts remain future work. */
export function StudyForgeShell({ canPreview, previewOpen, pending, message, onPreview }: StudyForgeShellProps): React.JSX.Element {
  return <main className="sf-shell" data-testid="studyforge-shell" data-preview={previewOpen}>
    <section className="sf-space">
      <header className="sf-heading"><span className="sf-kicker">学习空间</span><span className="sf-date">StudyForge</span></header>
      <div className="sf-empty">
        <span className="sf-page-number">01</span>
        <h1>还没有开始学习</h1>
        <p>把要读的资料放在右侧，留出中间这一页。</p>
        {canPreview && <button className="sf-primary" data-testid="preview-example" disabled={pending} onClick={onPreview}>
          {pending ? '正在打开…' : '预览示例资料'}<span aria-hidden="true">↗</span>
        </button>}
        <p className="sf-message" role="status">{message}</p>
      </div>
      <footer className="sf-footer">读一段，想一想，再写下来。</footer>
    </section>
    {!previewOpen && <aside className="sf-context" aria-label="资料">
      <h2>资料</h2><div className="sf-page-outline" aria-hidden="true"><i /><i /><i /></div>
      <p>打开的资料会留在这里。</p><span>随时对照，慢慢读。</span>
    </aside>}
  </main>;
}
