import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ClassroomDefinition, ClassroomRule } from '@studyforge/contracts/classroom';
import { classmateMention } from '@studyforge/contracts/classroom';

export function classroomEvents(events: readonly SessionEvent[]): readonly SessionEvent[] {
  return events.slice(events.findLastIndex(event => event.type === 'session/end-seed' && event.data.inherited === true) + 1);
}

/** Count completed turns containing admitted student input; never receipts or child output. */
export function classroomRounds(events: readonly SessionEvent[], sinceSequence = -1): { turn: number; sequence: number; text: string }[] {
  const rounds: { turn: number; sequence: number; text: string }[] = [];
  let texts: string[] = [], turn = 0;
  for (const event of classroomEvents(events)) {
    if (event.type === 'turn/start') { turn = event.data.turn; texts = []; }
    if (event.type === 'user/message' && event.data.source.kind === 'user') texts.push(event.data.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n'));
    if (event.type === 'turn/end' && event.data.reason.kind === 'completed' && texts.length && event.seq > sinceSequence) {
      rounds.push({ turn, sequence: event.seq, text: texts.join('\n') });
    }
  }
  return rounds;
}

export function mentionedClassmates(text: string, definition: ClassroomDefinition): string[] {
  return definition.roles.filter(role => role.enabled && (text.includes(classmateMention(role.name, definition.title))
    || new RegExp('(?:^|\\s)@' + role.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[\\s，。！？,!?])', 'u').test(text))).map(role => role.id);
}

export function automaticRule(definition: ClassroomDefinition, kind: 'round' | 'stage', round: number): ClassroomRule | undefined {
  return definition.rules.find(rule => rule.enabled && rule.trigger.kind === kind
    && (rule.trigger.kind !== 'round' || round > 0 && round % rule.trigger.every === 0)
    && (rule.action.kind !== 'classmate' || definition.roles.some(role => role.id === (rule.action as { roleId: string }).roleId && role.enabled)));
}
