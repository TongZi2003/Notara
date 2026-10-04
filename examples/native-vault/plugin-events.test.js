import assert from 'node:assert/strict';
import test from 'node:test';
import { Session } from '@deepseek-ai/dsh-session';
import { pluginEventType } from './plugin-events.js';
import { readTeachingSettings, SETTINGS_EVENT, LESSON_EVENT } from './teaching-state.js';
import { foldPomodoro, POMODORO_EVENT } from './pomodoro-data.js';

// Opening an rc.2 (format v3) session under DSH 0.2.0 renames every unknown
// ignorable event to `plugin:<type>`; the migration adds the prefix even to a
// name that already has one, so readers strip any number of them.
test('an event type reads the same with or without the migration prefix', () => {
  for (const type of ['notara/teaching-settings', 'plugin:notara/teaching-settings', 'plugin:plugin:notara/teaching-settings']) {
    assert.equal(pluginEventType(type), 'notara/teaching-settings');
  }
  assert.equal(pluginEventType('turn/end'), 'turn/end');
  assert.equal(pluginEventType(undefined), undefined);
});

test('settings, bindings and pomodoro written before the format migration still read after it', () => {
  const session = Session.create('migrated', [], { version: 4, id: 'migrated', createdAt: Date.now(), isSeeded: false });
  session.append(`plugin:${SETTINGS_EVENT}`, { revision: 1, teachingRef: 'feynman' }, { ignorable: true });
  session.append(`plugin:${LESSON_EVENT}`, { scriptPath: '备课/第一课.md' }, { ignorable: true });
  const settings = readTeachingSettings(session);
  assert.equal(settings.teachingRef, 'mixed');
  assert.equal(settings.scriptPath, '备课/第一课.md');
  const events = [{ type: `plugin:${POMODORO_EVENT}`, seq: 1, data: { op: 'start', id: 'p1', phase: 'focus', minutes: 25, startedAt: '2026-09-28T08:00:00.000Z', endsAt: '2026-09-28T08:25:00.000Z' } }];
  assert.equal(foldPomodoro(events).current?.id, 'p1');
});
