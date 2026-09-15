import { afterEach, expect, test } from 'vitest';
import sharp from 'sharp';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { ArtifactView } from '@studyforge/contracts/creation';
let runtime: IsolatedRuntime | undefined;
afterEach(async () => { await runtime?.stop(); });
const value = (reply: any): any => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('local avatars normalize, persist with creator roles, survive restart and never embed image bytes in the classroom document', async () => {
  runtime = await startIsolated({ testModel: true }); let client = await connectRuntime(runtime);
  const input = { base64: (await sharp({ create: { width: 420, height: 220, channels: 3, background: '#b17845' } }).png().toBuffer()).toString('base64') };
  const image = value(await client.rpc('notaraClassroomView/uploadAvatar', { input }));
  expect(image.ref).toMatch(/^avatar:[a-f0-9]{64}$/);
  expect(value(await client.rpc('notaraClassroomView/uploadAvatar', { input })).ref).toBe(image.ref);
  const metadata = await sharp(Buffer.from(image.base64, 'base64')).metadata(); expect(metadata.width).toBe(192); expect(metadata.height).toBe(192); expect(metadata.format).toBe('webp');
  expect((await client.rpc('notaraClassroomView/uploadAvatar', { input: { base64: Buffer.from('not an image').toString('base64') } })).ok).toBe(false);
  expect((await client.rpc('notaraClassroomView/readAvatar', { input: { ref: '../outside.png' } })).ok).toBe(false);
  expect((await client.rpc('notaraClassroomView/readAvatar', { input: { ref: 'avatar:' + '0'.repeat(64) } })).ok).toBe(false);
  const document = { entries: [], classroom: { title: '我的主题教室', roles: [{ id: 'peer', name: '同桌', purpose: '解释与讨论', instructions: '根据老师给的信息回应。', enabled: true, avatar: image.ref }], rules: [], carrySummary: false } };
  let project: ArtifactView = value(await client.rpc('studyforgeCreation/create', { input: { title: '主题教室', kind: 'classroom', operationId: 'avatar-room', references: [], content: JSON.stringify(document) } }));
  expect(JSON.stringify(project)).not.toContain(image.base64);
  const file = project.files.find(item => item.path === 'worldbook.json')!;
  value(await client.rpc('studyforgeCreation/publishArtifact', { input: { ref: project.ref, digest: project.digest, operationId: 'install-room', expectedVersion: 0 } }));
  const packages = value(await client.rpc('studyforgePlugins/list', {})), installed = packages.find((item: any) => item.creationRef === project.ref);
  const session = value(await client.rpc('studyforgeCreation/openTeacher', {})), target = { ...session, id: 'plugin-' + installed.ref.slice(7) + '-main' };
  expect(value(await client.rpc('studyforgePlugins/readWorldbook', { input: target })).document.classroom.roles[0].avatar).toBe(image.ref);
  await runtime.restart(); client = await connectRuntime(runtime);
  expect(value(await client.rpc('notaraClassroomView/readAvatar', { input: { ref: image.ref } })).base64).toBe(image.base64);
  expect(value(await client.rpc('studyforgeCreation/read', { input: { ref: project.ref } })).digest).toBe(project.digest);
  const reset = structuredClone(document); delete (reset.classroom.roles[0] as { avatar?: string }).avatar;
  project = value(await client.rpc('studyforgeCreation/save', { input: { ref: project.ref, path: 'worldbook.json', expectedDigest: file.digest, content: JSON.stringify(reset) } }));
  expect(JSON.parse(project.files.find(item => item.path === 'worldbook.json')!.body).classroom.roles[0].avatar).toBeUndefined();
  // The installed snapshot and prior lessons keep their original appearance.
  expect(value(await client.rpc('studyforgePlugins/readWorldbook', { input: target })).document.classroom.roles[0].avatar).toBe(image.ref);
}, 90000);
