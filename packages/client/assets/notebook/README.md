# Offline notebook fonts

All seven fonts are distributed under their accompanying SIL Open Font License 1.1 in `licenses/` beside this file (byte-identical to the vendored originals). CSS aliases prefixed `SF` distinguish the bundled faces from machine-installed versions. Font loading never contacts an external service.

Google Fonts source commit: `5e35378e6bda803962ee6fd257e444a7d459660d`, repository https://github.com/google/fonts . The original TTF paths are `ofl/<directory>/<filename>`:

| Directory / filename | Source TTF SHA-256 |
|---|---|
| longcang / LongCang-Regular.ttf | e5bf2c3f24ef2327c6f136d8f73e2f9dfdf44896fdbeb35a9515f44777bb91bc |
| kalam / Kalam-Regular.ttf | 57cecb63d4608019371954274ae1d8c397764debd5b19d4a33c1efa4dc923c0b |
| mashanzheng / MaShanZheng-Regular.ttf | 6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb |
| patrickhand / PatrickHand-Regular.ttf | 0f173b3e6cb6d1af25babf7f0057c5ac4ee11f9992b0469bb817e967ef4ad0fc |
| caveat / Caveat[wght].ttf | 0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988 |
| zhimangxing / ZhiMangXing-Regular.ttf | 644e0cae9b40f0b10ab729a01bd32032e3973bac22be3dccae01bf6ae7fde969 |

`wenkai.woff2` uses the simplified-Chinese [LXGW WenKai v1.522 release](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.522), `LXGWWenKai-Regular.ttf`, SHA-256 `39ad71264b588165b469e35e6afb162a378dacd1f95348160240ba9038ac3009`. This replaces the prototype's TC face to preserve simplified-Chinese forms.

Conversion (development tool only; no fontTools dependency in the application):

```sh
pyftsubset source.ttf --unicodes='*' --layout-features='*' --name-IDs='*' --name-legacy --name-languages='*' --flavor=woff2 --output-file=font.woff2
```

All encoded characters are retained, not just text from the prototype. The unsupported FFTM build timestamp table is omitted by fontTools. Individual faces load only when needed. Total WOFF2 payload is approximately 16 MiB; the largest single face is WenKai (~7.6 MiB).
