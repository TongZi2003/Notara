import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { packageBin } from './package-bin.ts';
import { codeContract, compareVersions, discoverRelease, download, extractRelease, sameRuntime } from './vault-updates.ts';

const INVENTORY = 'notara-files.json';
const LOCK = '.notara-install.lock';
const JOURNAL = '.notara-install-journal.json';
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const exists = async (path: string): Promise<boolean> => lstat(path).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error; });
interface Inventory { format: 1; version: string; files: Record<string, string> }
export interface InstallOptions {
  npmEntry: string;
  skipLatest?: boolean;
  fetcher?: typeof fetch;
  run?: typeof runInstallCommand;
  assertIdle?: (root: string) => Promise<void>;
  log?: (message: string) => void;
}

/** No shell parsing: paths containing spaces, Chinese text or & remain one argument. */
export async function runInstallCommand(cwd: string, entry: string, args: string[]): Promise<void> {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, npm_config_progress: 'false', npm_config_color: 'false' } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`安装命令失败（退出码 ${code ?? '未知'}）。请查看上方错误，修复后重新运行安装。`)));
  });
}

export async function assertNoRunningCode(root: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const literal = (root.toLowerCase() + '\\').replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $found=@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -and ($_.CommandLine.ToLower().Replace('/','\\').Contains('${literal}')) }); if($found.Count -gt 0){exit 9}`;
  try {
    await promisify(execFile)(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15_000 });
  } catch { throw new Error('无法确认此目录已停止运行。请先关闭使用此目录的 Notara 和构建进程，再重新安装。'); }
}

async function inventoryAt(root: string): Promise<Inventory> {
  const value = JSON.parse(await readFile(join(root, INVENTORY), 'utf8')) as Inventory;
  if (value.format !== 1 || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('发布包文件清单不正确，请重新下载 Release 压缩包。');
  compareVersions(value.version, value.version);
  const names = new Set<string>();
  for (const [name, hash] of Object.entries(value.files)) {
    const parts = name.split('/'), key = name.normalize('NFKC').toLowerCase();
    if (parts.some(part => !part || part.startsWith('.') || part === 'node_modules' || /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || key === INVENTORY || names.has(key) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('发布包文件清单包含不安全路径。');
    names.add(key);
    let current = root;
    for (const part of parts) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`安装目录包含链接，未覆盖：${name}`);
    }
    if (digest(await readFile(join(root, name))) !== hash) throw new Error(`文件已修改或损坏，未覆盖：${name}。请在新的空文件夹解压 Release，或使用原来的源码安装方式。`);
  }
  for (const required of ['package.json', 'package-lock.json', 'examples/native-vault/package.json', 'scripts/install-vault.ts']) {
    if (!value.files[required]) throw new Error(`发布包缺少 ${required}。`);
  }
  if ((await codeContract(root)).version !== value.version) throw new Error('发布包版本与文件清单不一致。');
  return value;
}

function topNames(inventory: Inventory): string[] { return [...new Set([...Object.keys(inventory.files).map(name => name.split('/')[0]!), INVENTORY])].sort(); }

/** Entire owned directories are switched; extra files inside them must never be swallowed. */
async function assertOwnedDirectories(root: string, inventory: Inventory): Promise<void> {
  const walk = async (relative: string): Promise<void> => {
    const info = await lstat(join(root, relative));
    if (info.isSymbolicLink()) throw new Error(`安装目录包含链接，未覆盖：${relative}`);
    if (info.isDirectory()) {
      if (!Object.keys(inventory.files).some(name => name.startsWith(`${relative}/`))) throw new Error(`程序目录有额外目录，未覆盖：${relative}。请另选空文件夹安装。`);
      for (const name of await readdir(join(root, relative))) await walk(`${relative}/${name}`);
    } else if (!inventory.files[relative] && relative !== INVENTORY) throw new Error(`程序目录有额外文件，未覆盖：${relative}。请另选空文件夹安装。`);
  };
  for (const name of topNames(inventory)) await walk(name);
}

async function assertCompleteArchive(root: string, inventory: Inventory): Promise<void> {
  const allowed = new Set(topNames(inventory));
  for (const name of await readdir(root)) {
    if (!allowed.has(name)) throw new Error(`发布包包含未登记的文件：${name}`);
  }
  await assertOwnedDirectories(root, inventory);
}

/** Installs only a released bundle. Learning data and runtime snapshots are never visited. */
export async function installVault(directory: string, options: InstallOptions): Promise<string> {
  const root = resolve(directory), log = options.log ?? console.log, run = options.run ?? runInstallCommand;
  const progress = (percent: number, stage: string): void => {
    const filled = Math.floor(percent / 5);
    log(`[${'#'.repeat(filled)}${'-'.repeat(20 - filled)}] ${percent}% ${stage}`);
  };
  progress(20, '校验安装包（百分比表示安装阶段，不是剩余时间）');
  if (await exists(join(root, '.git'))) throw new Error('这是源码仓库。请保留原来的 npm ci / npm run vault 安装方式；快捷安装请使用 Release 压缩包。');
  if (await exists(join(root, JOURNAL))) throw new Error(`上次替换中断，程序备份位置记录在 ${join(root, JOURNAL)}。请保留该目录，勿继续覆盖；可在新的空目录重新解压安装。`);
  const original = await inventoryAt(root);
  await assertOwnedDirectories(root, original);
  await (options.assertIdle ?? assertNoRunningCode)(root);
  const lock = await open(join(root, LOCK), 'wx').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') throw new Error('已有安装正在进行，或上次安装被强制中断。请关闭安装窗口；若确认没有安装进程，可删除解压目录中的 .notara-install.lock 后重试。');
    if (error.code === 'EACCES' || error.code === 'EPERM') throw new Error('没有权限写入安装目录。请将 Release 解压到当前用户可写的文件夹后重试。');
    throw error;
  });
  let work: string | undefined;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const contract = await codeContract(root);
    log(`安装位置：${root}\n压缩包版本：${contract.version}`);
    progress(25, options.skipLatest ? '使用包内版本，跳过联网检查' : '检查 GitHub 最新正式发布');
    const release = options.skipLatest ? null : await discoverRelease(contract.version, contract.runtime, options.fetcher);
    work = await mkdtemp(join(root, '.notara-install-'));
    let stage = join(work, 'bundled');
    const backup = join(work, 'backup');
    await mkdir(stage); await mkdir(backup);
    for (const name of topNames(original)) await cp(join(root, name), join(stage, name), { recursive: true, errorOnExist: true, force: false });
    progress(35, '在临时目录安装依赖；本阶段需等待 npm 完成');
    await run(stage, options.npmEntry, ['ci', '--include=dev', '--no-audit', '--no-fund']);
    if (release) {
      progress(50, `下载并校验正式版 ${release.version}`);
      const { unzipSync } = createRequire(join(stage, 'package.json'))('fflate') as typeof import('fflate');
      stage = join(work, 'new'); await mkdir(stage);
      await extractRelease(await download(release.archiveUrl, 100_000_000, options.fetcher ?? fetch), release.sha256, stage, unzipSync);
      const nextContract = await codeContract(stage);
      if (nextContract.version !== release.version || !sameRuntime(nextContract.runtime, release.runtime)) throw new Error('发布包内容与更新信息不一致。');
      await assertCompleteArchive(stage, await inventoryAt(stage));
      progress(60, '安装新版依赖；本阶段需等待 npm 完成');
      await run(stage, options.npmEntry, ['ci', '--include=dev', '--no-audit', '--no-fund']);
    }
    const next = await inventoryAt(stage);
    await assertOwnedDirectories(stage, next);
    progress(70, '构建白板与学习界面');
    await run(stage, packageBin(stage, 'tsx', 'tsx'), [join(stage, 'scripts/build-native-vault.ts')]);
    progress(80, '构建像素教室');
    await run(stage, packageBin(stage, 'tsx', 'tsx'), [join(stage, 'scripts/build-pixel-classroom.ts')]);
    // Generated assets can differ across supported platforms. Record the build
    // we actually installed, so a second installation still detects user edits.
    await assertOwnedDirectories(stage, next);
    for (const name of Object.keys(next.files)) next.files[name] = digest(await readFile(join(stage, name)));
    await writeFile(join(stage, INVENTORY), JSON.stringify(next, null, 2) + '\n');
    await (options.assertIdle ?? assertNoRunningCode)(root);
    const oldNames = new Set(topNames(original)), names = [...new Set([...oldNames, ...topNames(next), 'node_modules'])];
    for (const name of names) {
      if (name !== 'node_modules' && !oldNames.has(name) && await exists(join(root, name))) throw new Error(`新版程序与已有文件冲突，未覆盖：${name}`);
    }
    await inventoryAt(root);
    await assertOwnedDirectories(root, original);
    progress(90, '校验完成，切换程序文件');
    // Write recovery evidence before the first move. An abrupt power loss leaves
    // the backup intact and blocks a second installer from obscuring it.
    await writeFile(join(root, JOURNAL), JSON.stringify({ format: 1, version: next.version, backup, names }, null, 2), { flag: 'wx' });
    const moved: string[] = [], placed: string[] = [];
    try {
      for (const name of names) {
        if (await exists(join(root, name))) { await rename(join(root, name), join(backup, name)); moved.push(name); }
        if (await exists(join(stage, name))) { await rename(join(stage, name), join(root, name)); placed.push(name); }
      }
    } catch (error) {
      try {
        for (const name of placed.reverse()) await rename(join(root, name), join(stage, name));
        for (const name of moved.reverse()) await rename(join(backup, name), join(root, name));
        await unlink(join(root, JOURNAL));
      } catch { throw new Error(`安装替换失败且恢复未完成。请保留 ${work} 中的 backup；恢复信息见 ${JOURNAL}。`); }
      throw error;
    }
    await unlink(join(root, JOURNAL));
    progress(95, '程序已就绪');
    log(`安装完成：${next.version}，程序保存在当前解压目录。${release ? '' : '未选择或未发现可安装的更高正式版，保留包内版本。'}`);
    return next.version;
  } finally {
    await lock.close(); await unlink(join(root, LOCK));
    if (work && !await exists(join(root, JOURNAL))) await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2); let npmEntry = process.env.npm_execpath, skipLatest = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip-latest') skipLatest = true;
    else if (args[i] === '--npm-entry' && args[i + 1]) npmEntry = resolve(args[++i]!);
    else throw new Error(`未知安装参数：${args[i]}`);
  }
  if (!npmEntry) throw new Error('未找到 npm，请通过「安装 Notara.cmd」启动。');
  try { await installVault(resolve(dirname(fileURLToPath(import.meta.url)), '..'), { npmEntry, skipLatest }); }
  catch (error) { console.error(`Notara 安装未完成：${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
