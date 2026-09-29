/** Types for lazy-assets.js, read by the TypeScript build script and client source. */
export declare const LAZY_PATH: string;
/** File name → content type: the one allowlist the build, the route and the client share. */
export declare const LAZY_FILES: Readonly<Record<string, string>>;
export declare function lazyUrl(name: string): string;
export declare function loadLazyModule<T = unknown>(name: string, prepare?: (module: any) => T | Promise<T>): Promise<T>;
