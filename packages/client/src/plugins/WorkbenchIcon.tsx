import type { ReactNode } from 'react';

const pluginIcons: Record<string, string> = {
  '世界书': 'world', '教室': 'seminar', '函数实验台': 'function', '论证工作台': 'argument',
  '老师黑板': 'board', '错解诊所': 'clinic', '几何作图台': 'geometry',
  '史料侦探局': 'evidence', '时空地图': 'atlas', '多智能体研讨室': 'seminar', '情境模拟器': 'simulation',
};

export function WorkbenchIcon({ kind, title }: { kind?: string; title?: string }): React.JSX.Element {
  const drawings: Record<string, ReactNode> = {
    chat: <><path d="M5 5h26v20H17l-8 7v-7H5z" /><path d="M11 12h14M11 18h9M22 30h9l5 5V15h-5" /></>,
    thoughts: <><rect x="14" y="3" width="12" height="9" rx="2" /><path d="M20 12v8M8 27v-7h24v7" /><rect x="2" y="27" width="12" height="9" rx="2" /><rect x="26" y="27" width="12" height="9" rx="2" /></>,
    materials: <><rect x="4" y="5" width="21" height="30" rx="2" /><path d="M10 5v30M16 12h5M16 18h5M28 10h8v23h-8M28 17h4M28 23h4" /></>,
    world: <><circle cx="20" cy="20" r="15" /><ellipse cx="20" cy="20" rx="7" ry="15" /><path d="M5 20h30M9 10c7 5 15 5 22 0M9 30c7-5 15-5 22 0" /></>,
    function: <><path d="M6 4v30h30M3 20h33M19 4v32M7 30c9 0 7-22 14-22s5 21 14 21" /></>,
    argument: <><rect x="3" y="5" width="11" height="9" rx="2" /><rect x="3" y="26" width="11" height="9" rx="2" /><path d="m14 10 12 10-12 10M20 20h7" /><rect x="27" y="15" width="10" height="10" rx="2" /></>,
    board: <><rect x="4" y="5" width="32" height="23" rx="2" /><path d="M8 28h24M15 28l-4 8M25 28l4 8M10 13h11M10 19h7M24 14l6 6M30 14l-6 6" /></>,
    clinic: <><path d="M24 6H7v29h26V21M12 13h9M12 20h5M12 27h9" /><circle cx="29" cy="11" r="7" /><path d="m26 11 2 2 4-4" /></>,
    geometry: <><path d="m8 31 12-24 13 24zM20 7v24" /><circle cx="8" cy="31" r="2" /><circle cx="20" cy="7" r="2" /><circle cx="33" cy="31" r="2" /><path d="M20 27h4v4" /></>,
    evidence: <><path d="M25 5H6v30h25v-9M11 11h9M11 17h5M11 26h8" /><circle cx="26" cy="18" r="7" /><path d="m31 23 6 6" /></>,
    atlas: <><path d="m3 10 11-4 12 4 11-4v25l-11 4-12-4-11 4zM14 6v25M26 10v25" /><path d="M31 13c0 5-5 10-5 10s-5-5-5-10a5 5 0 0 1 10 0Z" /><circle cx="26" cy="13" r="1.5" /></>,
    seminar: <><circle cx="20" cy="9" r="4" /><circle cx="8" cy="23" r="4" /><circle cx="32" cy="23" r="4" /><path d="M13 18c0-6 14-6 14 0M2 35v-2c0-6 12-6 12 0v2M26 35v-2c0-6 12-6 12 0v2M17 28h6M17 32h6" /></>,
    simulation: <><path d="M5 6h12v10H5zM23 25h12v10H23zM11 16v15h12M17 11h12v14M25 20l4 5 4-5" /><path d="M24 5v9M20 9h8" /></>,
    plugin: <path d="M15 6H6v10h4a4 4 0 1 1 0 8H6v10h10v-4a4 4 0 1 1 8 0v4h10V24h-4a4 4 0 1 1 0-8h4V6H24v4a4 4 0 1 1-8 0V6z" />,
  };
  return <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawings[kind ?? pluginIcons[title ?? ''] ?? 'plugin'] ?? drawings.plugin}</svg>;
}
