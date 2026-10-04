/** Types for worker-catalog.js, read by the TypeScript scripts and tests. */
export interface WorkerPreset { readonly id: string; readonly name: string; readonly description: string }
export declare const WORKER_PRESETS: readonly WorkerPreset[];
export declare const WORKER_TOOLS: Readonly<Record<'none' | 'read' | 'read-only' | 'workspace', readonly string[]>>;
export declare function workerToolScope(session: unknown): 'none' | 'read' | 'read-only' | 'workspace';
export declare function workerAllows(session: unknown, name: string): boolean;
export declare function workerPreset(id: string): WorkerPreset | undefined;
