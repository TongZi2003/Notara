# P0.1 版本基线与一手证据

核验日期 2026-09-11，Asia/Shanghai。命令均在本任务临时目录或 `R/dsh` 内执行；
所有 DSH 探针都设了隔离 `DSH_HOME`。**没有**读取任何真实用户凭据。

## 1. npm 发行通道（tag 名不是选版依据）

```text
$ npm view @deepseek-ai/dsh dist-tags --json
{
  "alpha": "0.1.5-alpha.2",
  "next": "0.1.5-rc.2",
  "latest": "0.1.5-rc.1"
}
# EXIT=0
```

`latest` 仍指向上一版 rc.1，rc.2 只挂在 `next` 上——这与计划 §全局约束 3 一致。

```text
$ npm view @deepseek-ai/dsh time --json      # 摘录
0.1.5-alpha.2  2026-09-09T14:41:15.754Z
0.1.5-rc.1     2026-09-10T03:12:53.293Z
0.1.5-rc.2     2026-09-10T14:57:10.790Z
# EXIT=0
```

## 2. GitHub tag / release 与 npm 版本对齐

```text
$ curl -sSL https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=30
dsh-v0.1.5-rc.2  fb2c4b9e698e30edb738bca4cf0618587db7d203
dsh-v0.1.5-rc.1  183f08e9c6dde7e36cd2318eaee70b0da08fb35e

$ curl -sSL https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=20
dsh-v0.1.5-rc.2  2026-09-10T15:09:34Z  target_commitish=master  prerelease=True
# EXIT=0
```

tag → commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`；release 时间与 npm 发布时间同日、相差约 12 分钟。

## 3. 包完整性（SRI）

```text
$ npm view @deepseek-ai/dsh@0.1.5-rc.2 dist --json
{ "integrity": "sha512-8Xc8hCQHcIWRmTCVU/xZdp6/qMsWMeAd2ObChKDEsfhUPJFXx6H0lgeb1DxUMD86HZrrVN+1bCvn1ppjZ/fOxw==",
  "shasum": "2c78db39568d910868f1e4f34062a4f346d4815d", "fileCount": 10, "unpackedSize": 48910,
  "tarball": "https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.5-rc.2.tgz" }
# EXIT=0

$ npm view @deepseek-ai/dsh-typert-generator@0.1.5-rc.2 dist --json
{ "integrity": "sha512-II4+JIRwODl9WiD2QgKpKPJ9vc9K1y0ZaDzrAf3Vuqp1hPHF0qVXgFHh7HwvSZuv+Ja5mmrRy2LQBzXhosinQQ==",
  "shasum": "555b7dbe65fd4e96d64d1ae4718b8c414c13abfd" }
# EXIT=0
```

生成器 exports（rc.2 实测）：

```text
$ npm view @deepseek-ai/dsh-typert-generator@0.1.5-rc.2 --json   # 摘录
exports = {".": {"types":"./lib/types/index.d.ts","default":"./lib/index.js"},
           "./tsdown": {"types":"./lib/types/tsdown-plugin.d.ts","default":"./lib/types/tsdown-plugin.js"},
           "./src/*": "./src/*", "./package.json": "./package.json"}
dependencies = {"@jridgewell/gen-mapping":"^0.3.13","typescript":"^6.0.3"}
peerDependencies = {"@deepseek-ai/cordis":"^4.0.2"}
# EXIT=0
```

## 4. 上游源码归档

```text
$ curl -sSL -o dsh.tar.gz \
    https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/fb2c4b9e698e30edb738bca4cf0618587db7d203
$ shasum -a 256 dsh.tar.gz
60038295d9ea8849dc50a9d77dfcbed6c14397f0d54fadb035f768841415a3bd
# EXIT=0（19,474,104 bytes）
```

## 5. CLI 隔离键（源码 + 实跑）

源码锚点（rc.2 commit）：`apps/cli/src/args.ts`、`apps/cli/src/profile-boot.ts`、
`packages/util/home-paths/src/index.ts`、`packages/boot/app-boot/src/profile.ts`、
`packages/bundle/web-app/src/startup.ts`、`packages/bundle/web-app/cordis.patch.yml`。

```text
$ DSH_HOME=<scratch> npx --no-install dsh --help       # EXIT=0
  --profile <name>               the profile under $DSH_HOME/profiles to boot
  --from-default-profile <name>  initialize a new custom profile from a shipped profile template
  --patch <path>                 extra patch-list overlay applied after the profile layer (repeatable)
  --dump-config / --dump-default-config
  web [options]                  boot the web profile (alias of --profile web)
  plugin [options]               manage a profile's plugins by forwarding the remaining arguments to pnpm

$ DSH_HOME=<scratch> npx --no-install dsh --profile web --help   # EXIT=0
  --host <host>                  bind host
  --no-open                      do not open the Web UI in the default browser
  --port <port>                  listen port; pass 0 to let the OS pick a free one
  --trusted-host <authority...>  extra authority the /api browser-trust fence accepts
```

`<scratch>` 下出现 `profiles/web/{package.json,cordis.yml,cordis.patch.yml,pnpm-workspace.yaml}` 与
`profiles/node_modules`；真实 `~/.dsh` 的 mtime 保持 2026-08-24 不变。默认 bind 从
`cordis.patch.yml` 的 `webserver` 行取 `ctx.webStartup.host ?? '127.0.0.1'` / `ctx.webStartup.port ?? 3080`。

## 6. 依赖树一致性（锁文件）

见 `R/dsh/package-lock.json`。全部 `@deepseek-ai/dsh-*` 落在 `0.1.5-rc.2`，cordis 家族落在 `4.0.2`
（`cordis-plugin-group 1.0.2`、`include 1.0.7`、`loader 1.0.3`），`typescript` 单解析为 `6.0.3`。无混 rc。
