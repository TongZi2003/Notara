import type { SkeletonChange } from '@studyforge/contracts/plans';
import type { AtlasChange } from '@studyforge/contracts/atlas';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import { positionLabel } from '../materials/lesson-materials-mindmap.ts';

interface Branch {
  path: string;
  title: string;
  positions: string[];
  children: Branch[];
}

/** A structure node as the directory renderer needs it: sources are optional provenance. */
type DirectoryNode = { readonly path: string; readonly sources?: readonly SourceAnchor[] | undefined };

/** Render semantic paths as a directory, keeping every proposed section visible. */
function directory(nodes: readonly DirectoryNode[]): Branch[] {
  const roots: Branch[] = [];
  for (const node of nodes) {
    let siblings = roots;
    let path = '';
    const parts = node.path.split('/');
    parts.forEach((title, index) => {
      path = path ? `${path}/${title}` : title;
      let branch = siblings.find(candidate => candidate.path === path);
      if (!branch) {
        branch = { path, title, positions: [], children: [] };
        siblings.push(branch);
      }
      if (index === parts.length - 1) branch.positions = [...new Set((node.sources ?? []).flatMap(source =>
        source.locator ? [positionLabel(source.locator)] : []))];
      siblings = branch.children;
    });
  }
  return roots;
}

function Directory({ branches }: { branches: Branch[] }): React.JSX.Element {
  return <ul className="sf-directory-tree">{branches.map(branch => <li key={branch.path}>
    <div className="sf-directory-row">
      <span className="sf-directory-title">{branch.title}</span>
      {branch.positions.length > 0 && <span className="sf-directory-position">{branch.positions.join('、')}</span>}
    </div>
    {branch.children.length > 0 && <Directory branches={branch.children} />}
  </li>)}</ul>;
}

/** The shared change summary: nodes to add, paths to remove, repaths, and detach. */
function ChangeBody({ change, detachCopy }: {
  change: { readonly nodes: readonly DirectoryNode[]; readonly replaceExisting: boolean; readonly removePaths: readonly string[]; readonly repath: readonly { readonly from: string; readonly to: string }[]; readonly detachDependents: boolean };
  detachCopy: string;
}): React.JSX.Element {
  return <>
    {change.nodes.length > 0 && <div data-testid="proposal-directory">
      <Directory branches={directory(change.nodes)} />
    </div>}
    {change.replaceExisting && <p className="sf-note">这份结构将替换原结构，未列出的层级也会移除。</p>}
    {change.removePaths.length > 0 && <div className="sf-directory-removals">
      <p className="sf-directory-caption">移除层级</p>
      <Directory branches={directory(change.removePaths.map(path => ({ path })))} />
    </div>}
    {change.repath.length > 0 && <div>
      <p className="sf-directory-caption">改名或移动</p>
      <ul className="sf-proposal-lines">{change.repath.map(({ from, to }) => <li key={from}>
        {from.split('/').join(' › ')} → {to.split('/').join(' › ')}
      </li>)}</ul>
    </div>}
    {change.detachDependents && <p className="sf-note">{detachCopy}</p>}
    {change.nodes.length === 0 && change.removePaths.length === 0 && change.repath.length === 0
      && !change.replaceExisting && !change.detachDependents && <p className="sf-note">没有实质改动</p>}
  </>;
}

export function SkeletonSummary({ change }: { change: SkeletonChange }): React.JSX.Element {
  return <div className="sf-proposal-content sf-directory-preview" data-testid="proposal-content">
    <ChangeBody change={change} detachCopy="同时解除受影响卡片和计划与这些章节的关联。" />
  </div>;
}

/** The same directory preview for the workspace knowledge map (atlas); dependents are card topics. */
export function AtlasSummary({ change }: { change: AtlasChange }): React.JSX.Element {
  return <div className="sf-proposal-content sf-directory-preview" data-testid="proposal-content">
    <ChangeBody change={change} detachCopy="同时解除受影响卡片与这些地图层级的关联。" />
  </div>;
}
