# Pinned Billion-context kernel

Notara 0.24.4's native context integration uses the fixed pure core from [billion-context](https://github.com/ranxianglei/billion-context) and [acp-kernel](https://github.com/ranxianglei/acp-kernel).

Source: billion-context 0.1.187, commit `d4de8d44e047cbb84dd225f27c4b0f669b79e554`; embedded acp-kernel 0.0.105. `upstream-lock.json` records SHA-256 hashes of the unmodified upstream files. Both upstream license notices, including their attribution terms, are retained.

`scripts/build-billion-kernel.ts` builds the selected pure exports with the repository's locked esbuild. Notara does not load the upstream fetch proxy, launcher, auto updater, or global kernel state. Network, model credentials, native compaction transactions and classroom authorization remain with DSH/Notara. The fixed core is integrated into native summary validation and classroom history retrieval; this does not establish long-term teaching quality or recall reliability.
