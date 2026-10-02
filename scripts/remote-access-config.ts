import { chmod, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const checkoutPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface RemoteAccessConfig {
  format: 1;
  publicHost: string;
  username: string;
  password: string;
  ngrokPath: string;
  localPort: number;
  proxyPort: number;
  ngrokApiPort: number;
}

export const defaultRemoteConfigPath = (): string => process.env.NOTARA_REMOTE_CONFIG
  ? resolve(process.env.NOTARA_REMOTE_CONFIG)
  : join(homedir(), '.notara', 'remote-access', 'config.json');

function containsPath(directory: string, path: string): boolean {
  const comparedDirectory = process.platform === 'win32' ? directory.toLowerCase() : directory;
  const comparedPath = process.platform === 'win32' ? path.toLowerCase() : path;
  const fromDirectory = relative(comparedDirectory, comparedPath);
  return fromDirectory === '' || (!fromDirectory.startsWith(`..${sep}`) && fromDirectory !== '..' && !isAbsolute(fromDirectory));
}

function assertOutsideCheckout(path: string, checkout = checkoutPath): string {
  const resolved = resolve(path);
  // Windows paths are case-insensitive, while path.relative can retain the
  // input spelling. Normalize the comparison so a differently-cased path
  // cannot bypass the private-state-outside-checkout rule.
  if (containsPath(checkout, resolved)) {
    throw new Error('Remote credentials and control state cannot be stored in the code checkout. Choose a private user configuration path.');
  }
  return resolved;
}

function assertPrivateDirectoryBoundary(path: string, checkout = checkoutPath, home = resolve(homedir())): string {
  const resolved = assertOutsideCheckout(path, checkout);
  // A directory ACL inherits into its descendants on Windows. Securing a
  // checkout's parent therefore also changes the code and dependency metadata,
  // which can invalidate live client modules even when their bytes are unchanged.
  if (containsPath(resolved, checkout)) {
    throw new Error('A private configuration directory cannot contain the code checkout. Choose a dedicated directory outside the checkout.');
  }
  if (dirname(resolved) === resolved || (containsPath(resolved, home) && containsPath(home, resolved))) {
    throw new Error('A private configuration directory must be a dedicated directory, not a filesystem root or user home.');
  }
  return resolved;
}

async function canonicalPath(path: string): Promise<string> {
  let current = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try { return resolve(await realpath(current), ...missing); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(current) === current) throw error;
      missing.unshift(basename(current));
      current = dirname(current);
    }
  }
}

async function checkedPrivateDirectory(path: string): Promise<string> {
  const resolved = assertPrivateDirectoryBoundary(path);
  const [canonical, checkout, home] = await Promise.all([
    canonicalPath(resolved), realpath(checkoutPath), canonicalPath(homedir()),
  ]);
  return assertPrivateDirectoryBoundary(canonical, checkout, home);
}

export function assertPrivatePathOutsideCheckout(path: string): string {
  return assertOutsideCheckout(path);
}

export function validateRemoteConfig(value: unknown): RemoteAccessConfig {
  if (!value || typeof value !== 'object') throw new Error('Remote access configuration must be an object.');
  const input = value as Partial<RemoteAccessConfig>;
  if (input.format !== 1) throw new Error('Unsupported remote access configuration format. Run the remote setup command again.');
  if (typeof input.publicHost !== 'string' || !isPublicHostname(input.publicHost)) throw new Error('publicHost must be a hostname assigned to your ngrok account.');
  if (typeof input.username !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(input.username) || input.username.includes(':') || input.username.includes('${')) {
    throw new Error('Remote username must be 1–64 printable ASCII characters, cannot contain a colon, and cannot contain `${`.');
  }
  if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128 || !/^[\x21-\x7e]+$/.test(input.password) || input.password.includes('${')) {
    throw new Error('Remote password must be 12–128 printable ASCII characters with no spaces or `${` expression markers.');
  }
  if (typeof input.ngrokPath !== 'string' || !input.ngrokPath.trim() || input.ngrokPath.includes('\n')) throw new Error('ngrokPath must name ngrok.exe or ngrok on PATH.');
  for (const [name, port] of [['localPort', input.localPort], ['proxyPort', input.proxyPort], ['ngrokApiPort', input.ngrokApiPort]] as const) {
    if (!Number.isInteger(port) || port! < 1 || port! > 65535) throw new Error(`${name} must be an integer from 1 to 65535.`);
  }
  if (new Set([input.localPort, input.proxyPort, input.ngrokApiPort]).size !== 3) throw new Error('Vault, proxy, and ngrok API ports must be different.');
  return {
    format: 1,
    publicHost: input.publicHost.toLowerCase(),
    username: input.username,
    password: input.password,
    ngrokPath: input.ngrokPath,
    localPort: input.localPort!,
    proxyPort: input.proxyPort!,
    ngrokApiPort: input.ngrokApiPort!,
  };
}

export function isPublicHostname(value: string): boolean {
  if (!value || value.length > 253 || /[\s/@?#:]/.test(value)) return false;
  try {
    const url = new URL(`https://${value}`);
    return url.hostname.toLowerCase() === value.toLowerCase() && url.hostname.includes('.') &&
      url.protocol === 'https:' && !url.port && url.pathname === '/' && !url.search && !url.hash &&
      !['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export async function readRemoteConfig(path = defaultRemoteConfigPath()): Promise<RemoteAccessConfig> {
  const resolved = assertOutsideCheckout(path);
  await assertPrivateDirectoryOutsideCheckout(dirname(resolved));
  let raw: string;
  let canonical: string;
  try { canonical = await realpath(resolved); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Remote access is not configured. Run the setup command first (${resolved}).`);
    throw error;
  }
  assertOutsideCheckout(canonical);
  await securePrivatePath(canonical);
  try { raw = await readFile(canonical, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Remote access is not configured. Run the setup command first (${resolved}).`);
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error) { throw new Error(`Cannot parse remote access configuration at ${resolved}.`, { cause: error }); }
  const config = validateRemoteConfig(value);
  return config;
}

/** Restrict private state to the current Windows user and SYSTEM, or mode 0600 elsewhere. */
export async function securePrivatePath(path: string, directory = false): Promise<void> {
  const resolved = assertOutsideCheckout(path);
  let canonical = await realpath(resolved);
  const isDirectory = directory || (await stat(canonical)).isDirectory();
  if (isDirectory) canonical = await checkedPrivateDirectory(resolved);
  else assertOutsideCheckout(canonical, await realpath(checkoutPath));
  if (process.platform === 'win32') {
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$path = $env:NOTARA_PRIVATE_PATH',
      '$isDirectory = [System.IO.Directory]::Exists($path)',
      '$acl = if ($isDirectory) { [System.IO.Directory]::GetAccessControl($path) } else { [System.IO.File]::GetAccessControl($path) }',
      '$acl.SetAccessRuleProtection($true, $false)',
      'foreach ($entry in @($acl.Access)) { $acl.RemoveAccessRuleAll($entry) }',
      '$rights = [System.Security.AccessControl.FileSystemRights]::FullControl',
      '$inheritance = [System.Security.AccessControl.InheritanceFlags]::None',
      'if (Test-Path -LiteralPath $path -PathType Container) { $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit }',
      '$propagation = [System.Security.AccessControl.PropagationFlags]::None',
      '$allow = [System.Security.AccessControl.AccessControlType]::Allow',
      '$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$system = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")',
      '$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($user, $rights, $inheritance, $propagation, $allow))',
      '$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($system, $rights, $inheritance, $propagation, $allow))',
      'if ($isDirectory) { [System.IO.Directory]::SetAccessControl($path, $acl) } else { [System.IO.File]::SetAccessControl($path, $acl) }',
    ].join('; ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true,
        env: { ...process.env, NOTARA_PRIVATE_PATH: canonical },
      });
    }
    catch (error) { throw new Error(`Could not secure private remote access state at ${path}.`, { cause: error }); }
  } else {
    await chmod(canonical, isDirectory ? 0o700 : 0o600);
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  const resolved = assertPrivateDirectoryBoundary(path);
  // Check existing ancestors before mkdir too, so a junction cannot create
  // private state inside the checkout before the final permissions check.
  await checkedPrivateDirectory(resolved);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  await securePrivatePath(resolved, true);
}

export async function assertPrivateDirectoryOutsideCheckout(path: string): Promise<void> {
  await ensurePrivateDirectory(path);
}

export async function writePrivateFile(path: string, content: string | Buffer): Promise<void> {
  const resolved = resolve(path);
  await ensurePrivateDirectory(dirname(resolved));
  const pending = `${resolved}.${randomUUID()}.next`;
  try {
    const file = await open(pending, 'wx', 0o600);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    await securePrivatePath(pending);
    await rename(pending, resolved);
    await securePrivatePath(resolved);
  } finally { await rm(pending, { force: true }); }
}

export async function writeRemoteConfig(config: RemoteAccessConfig, path = defaultRemoteConfigPath()): Promise<void> {
  const valid = validateRemoteConfig(config);
  const resolved = assertOutsideCheckout(path);
  await assertPrivateDirectoryOutsideCheckout(dirname(resolved));
  const actual = resolve(await realpath(dirname(resolved)), resolved.slice(dirname(resolved).length).replace(/^[/\\]/, ''));
  assertOutsideCheckout(actual);
  await writePrivateFile(resolved, `${JSON.stringify(valid, null, 2)}\n`);
}
