import type { ImportMaterialInput, NewMaterialVersionInput, MaterialVersion } from './material-records.ts';
export interface ImportUpload { operationId: string; material: ImportMaterialInput; base64: string; }
export interface VersionUpload { operationId: string; expectedVersion: number; material: NewMaterialVersionInput; base64: string; }
export interface MaterialResource { address: string; version: MaterialVersion; }
export interface MaterialBytes { version: MaterialVersion; base64: string; }
