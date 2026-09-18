import type { ImportMaterialInput, NewMaterialVersionInput, MaterialVersion } from './material-records.ts';
export interface ImportUpload { operationId: string; material: ImportMaterialInput; base64: string; }
export interface VersionUpload { operationId: string; expectedVersion: number; material: NewMaterialVersionInput; base64: string; }
export interface MaterialResource { address: string; version: MaterialVersion; }
export interface MaterialBytes { version: MaterialVersion; base64: string; }
/** Chunked upload session for originals too large for one request message.
 * `begin` carries the same descriptor the one-shot calls carry; `kind` picks
 * which commit path (`import` or `createVersion`) the staged bytes take. */
export interface UploadBeginInput { operationId: string; kind: 'import' | 'version'; material: ImportMaterialInput | NewMaterialVersionInput; expectedVersion?: number; total: number; }
export interface UploadTicket { uploadId: string; received: number; total: number; }
export interface UploadChunkInput { uploadId: string; offset: number; base64: string; }
export interface UploadChunkAck { uploadId: string; received: number; }
export interface UploadCommitInput { uploadId: string; }
export interface UploadAbortInput { uploadId: string; }
