import { WorkbenchIcon } from '../plugins/WorkbenchIcon.tsx';
import type { WorkbenchChoice } from '@studyforge/contracts/plugins';
import type { WorkspaceView } from './workspace-layout.ts';

const essentials = [
  { id: 'chat', title: '对话', description: '提出问题、一起推导，把想学的内容展开。', icon: 'chat' },
  { id: 'thoughts', title: '思维图', description: '串起课堂里的问题、思路和结论，回到关键节点。', icon: 'thoughts' },
  { id: 'materials', title: '资料工作台', description: '浏览原文与卡片，沿着章节查看它们的联系。', icon: 'materials' },
] as const;

/** A launch surface only: entries still use the existing view registry and docking action. */
export function WorkbenchGuide({ extensions, onOpen }: {
  extensions: readonly WorkbenchChoice[]; onOpen: (view: WorkspaceView) => void;
}): React.JSX.Element {
  return <section className="sf-workbench-guide" aria-label="工作台导览">
    <header className="sf-guide-head"><h1>工作台导览</h1><p>对话、思路与资料，可以独立打开，也可以并排使用。</p></header>
    <div className="sf-guide-essentials" role="group" aria-label="基础工作台">
      {essentials.map(item => <button type="button" key={item.id} className="sf-guide-primary" aria-label={'打开' + item.title} onClick={() => onOpen(item.id)}>
        <span className="sf-guide-illustration"><WorkbenchIcon kind={item.icon} /></span>
        <span className="sf-guide-title">{item.title}<span aria-hidden="true">↗</span></span>
        <span className="sf-guide-description">{item.description}</span>
      </button>)}
    </div>
    {extensions.length > 0 && <section className="sf-guide-extensions" aria-label="插件工作台">
      <h2>插件工作台</h2>
      <div className="sf-guide-plugin-list">{extensions.map(item => <button type="button" key={item.id} className="sf-guide-plugin" aria-label={'打开' + item.title} title={item.description} onClick={() => onOpen(item.id as WorkspaceView)}>
        <span className="sf-guide-plugin-icon"><WorkbenchIcon title={item.title} /></span>
        <span className="sf-guide-plugin-copy"><span className="sf-guide-title">{item.title}</span><span className="sf-guide-description">{item.description}</span></span>
        <span className="sf-guide-arrow" aria-hidden="true">↗</span>
      </button>)}</div>
    </section>}
  </section>;
}
