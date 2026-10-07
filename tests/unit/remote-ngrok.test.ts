import { expect, test } from 'vitest';
import { sanitizeNgrokDiagnosticChunks } from '../../scripts/remote-ngrok.ts';

test('ngrok diagnostics redact credentials split across output chunks', () => {
  const safe = sanitizeNgrokDiagnosticChunks([
    Buffer.from('authtoken: sup'), Buffer.from('ersecret\ncredentials: tea'), Buffer.from('cher:pass123\nstatus: connected\n'),
  ], ['supersecret', 'teacher', 'pass123']);
  expect(safe).not.toContain('supersecret');
  expect(safe).not.toContain('teacher');
  expect(safe).not.toContain('pass123');
  expect(safe).toContain('[redacted]');
  expect(safe).toContain('status: connected');
});

test('a truncated bounded log drops its partial first and last lines before redaction', () => {
  const safe = sanitizeNgrokDiagnosticChunks([
    Buffer.from('TOKEN-TAIL\ncomplete: diagnostic\npassword: unfinished-secret'),
  ], ['full-token-value'], true);
  expect(safe).toBe('complete: diagnostic\n');
  expect(safe).not.toContain('TAIL');
  expect(safe).not.toContain('unfinished-secret');
});
