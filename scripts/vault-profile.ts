import { isMap, isSeq, parseDocument } from 'yaml';
import { WELCOME_NOTICE_VERSION } from './legacy-settings.ts';

/** Seed writable defaults in the profile; a home overlay would lock its UI. */
export function studentProfile(text = '[]\n'): string {
  const doc = parseDocument(text);
  if (doc.errors.length || !isSeq(doc.contents)) throw new Error('Web profile 配置不是有效的补丁列表；未修改设置。');
  const defaults = [
    ['ui-settings', { enabled: false }],
    ['ui-settings-general', { welcomeNoticeVersion: WELCOME_NOTICE_VERSION }],
    ['ui-chat', { transcriptView: 'verbose', performanceUsage: 'compact' }],
  ] as const;
  let changed = false;
  for (const [id, config] of defaults) {
    const row = doc.contents.items.find(item => isMap(item) && item.getIn(['id']) === id);
    if (!isMap(row)) { doc.add({ id, config }); changed = true; continue; }
    for (const [key, value] of Object.entries(config)) {
      if (row.getIn(['config', key]) !== undefined) continue;
      row.setIn(['config', key], value); changed = true;
    }
    if (id === 'ui-chat' && row.getIn(['config', 'transcriptView']) === 'normal') {
      row.setIn(['config', 'transcriptView'], 'verbose'); changed = true;
    }
  }
  return changed ? doc.toString() : text;
}
