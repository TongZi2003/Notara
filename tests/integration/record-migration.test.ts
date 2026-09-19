import { expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { CourseMetadataSchema } from '../../packages/contracts/src/courses.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { COURSE_METADATA_SCHEMA_VERSION, migrateCourseMetadata } from '../../packages/domain/src/courses/course-metadata.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

test('a legacy course row migrates before the current schema validates every history version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-record-migration-'));
  const clock = createTestClock('2026-09-19T00:00:00Z', 'Asia/Shanghai');
  const legacyContext = new Context(); await legacyContext.plugin(Storage);
  const currentContext = new Context(); await currentContext.plugin(Storage);
  try {
    const legacyOwner = await openWorkspaceRecords(legacyContext, root, 'student-a', clock);
    const legacy = await legacyOwner.collection('course', z.json());
    await legacy.create({ workspaceId: 'student-a', sessionId: 'lesson-old', actor: 'student', purpose: 'learning', operationId: 'legacy-create' }, 'course_old', {
      sessionId: 'lesson-old', lessonMaterials: { materials: [] }, learningSetRef: null, archived: false,
    });
    await legacyOwner.close(); await legacyContext.fiber.dispose();

    const owner = await openWorkspaceRecords(currentContext, root, 'student-a', clock);
    const courses = await owner.collection('course', CourseMetadataSchema, { schemaVersion: COURSE_METADATA_SCHEMA_VERSION, migrate: migrateCourseMetadata });
    const read = { workspaceId: 'student-a', sessionId: 'lesson-old', actor: 'student' as const, purpose: 'learning' as const };
    expect(courses.read(read, 'course:course_old', 1)).toMatchObject({ version: 1, data: { closure: null } });
    const updated = await courses.update({ ...read, operationId: 'after-migration', expectedVersion: 1 }, 'course:course_old', { archived: true }, current => ({ ...current, archived: true }));
    expect(updated.version).toBe(2);
    expect(updated.data.closure).toBeNull();
    await owner.close();
  } finally {
    await currentContext.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
