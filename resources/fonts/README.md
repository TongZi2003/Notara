# 字体

`wenkai.woff2` 是手帐外观用的霞鹜文楷，由 Host 的 `/notara/vault/fonts/wenkai.woff2` 路由按需提供（`examples/native-vault/font-route.js`），构建时由 `scripts/build-native-vault.ts` 拷入 `examples/native-vault/fonts/`。

- 来源：[LXGW WenKai v1.522](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.522) 的简体版 `LXGWWenKai-Regular.ttf`，SHA-256 `39ad71264b588165b469e35e6afb162a378dacd1f95348160240ba9038ac3009`，用 fontTools 转为 WOFF2，保留全部编码字符（不含 FFTM 表）。
- 许可证：SIL Open Font License 1.1，全文见 `wenkai-license.txt`。
- 0.21.0 前放在旧工作台的 `packages/client/assets/notebook/`，旧工作台退役时挪到这里。
