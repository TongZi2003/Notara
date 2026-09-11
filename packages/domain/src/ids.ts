import { randomUUID } from 'node:crypto';
/** Host-issued identity. Native Session identities remain with DSH. */
export function newId(): string { return randomUUID(); }
export function objectRef(kind: string, id: string = newId()): string {
  if (!/^[a-z][a-z0-9-]*$/.test(kind) || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid object reference');
  return `${kind}:${id}`;
}
export function isObjectRef(value: string): boolean { return /^[a-z][a-z0-9-]*:[A-Za-z0-9_-]+$/.test(value); }
