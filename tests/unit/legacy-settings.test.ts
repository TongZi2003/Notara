import { describe, expect, test } from 'vitest';
import { upgradeLegacySettings, WELCOME_NOTICE_VERSION } from '../../scripts/legacy-settings.ts';
import { studentProfile } from '../../scripts/vault-profile.ts';
import { parse } from 'yaml';

test('student defaults live in a writable profile and preserve explicit choices and other entries', () => {
  const text = '# personal settings\n- id: ui-chat\n  config:\n    transcriptView: compact\n- id: my-provider\n  config:\n    model: example-model\n';
  const updated = studentProfile(text);
  const rows = parse(updated);
  expect(rows.find((row: { id: string }) => row.id === 'ui-settings').config.enabled).toBe(false);
  expect(rows.find((row: { id: string }) => row.id === 'ui-chat').config).toEqual({ transcriptView: 'compact', performanceUsage: 'compact' });
  expect(rows.find((row: { id: string }) => row.id === 'my-provider').config.model).toBe('example-model');
  expect(updated).toContain('# personal settings');
  expect(studentProfile(updated)).toBe(updated);
  expect(() => studentProfile('invalid: profile')).toThrow(/未修改设置/);
});

const seeded = [
  'ui-onboarding:',
  '  welcomeNoticeVersion: 2026-08-13.1',
  'ui-theme:',
  '  mode: system',
  'ui-chat:',
  '  transcriptView: normal',
  '  linkOpening: sidebar',
  '',
].join('\n');

describe('upgradeLegacySettings', () => {
  test('the old seeds become what the Vault sets now, and nothing else moves', () => {
    expect(upgradeLegacySettings(seeded)).toBe(seeded
      .replace('welcomeNoticeVersion: 2026-08-13.1', `welcomeNoticeVersion: ${WELCOME_NOTICE_VERSION}`)
      .replace('transcriptView: normal', 'transcriptView: verbose'));
  });

  test('a mode the student chose and a newer notice stay as they are', () => {
    const chosen = 'ui-onboarding:\n  welcomeNoticeVersion: 2099-01-01.1\nui-chat:\n  transcriptView: compact\n';
    expect(upgradeLegacySettings(chosen)).toBe(chosen);
  });

  test('only the ui-chat and ui-onboarding sections are read', () => {
    const elsewhere = 'other:\n  transcriptView: normal\n  welcomeNoticeVersion: 2026-08-13.1\n';
    expect(upgradeLegacySettings(elsewhere)).toBe(elsewhere);
  });

  test('CRLF line endings and quoted values are kept', () => {
    expect(upgradeLegacySettings("ui-chat:\r\n  transcriptView: 'normal'\r\n")).toBe('ui-chat:\r\n  transcriptView: verbose\r\n');
  });
});
