import { TimestampSchema } from '@studyforge/contracts';
export interface Clock { now(): string; readonly timeZone: string; }
export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || /^[+-]/.test(timeZone)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(0); return true; } catch { return false; }
}
export function assertIanaTimeZone(timeZone: string): string {
  if (!isValidIanaTimeZone(timeZone)) throw new Error('Expected a valid IANA time zone');
  return timeZone;
}
export function createClock(timeZone: string, now: () => string = () => new Date().toISOString()): Clock {
  return { timeZone: assertIanaTimeZone(timeZone), now: () => TimestampSchema.parse(now()) };
}
export function createTestClock(now: string, timeZone: string): Clock {
  TimestampSchema.parse(now);
  return createClock(timeZone, () => now);
}
