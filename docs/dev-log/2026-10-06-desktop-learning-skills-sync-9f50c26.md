# Desktop 学习资源原文同步来源

- Desktop 固定来源：origin/main `9f50c26ad94a0400a067df6bd17ef89593680e0d`（2026-10-05T20:53:34+08:00 feat: improve PDF reading and split-pane navigation）。
- 来源目录：`pi-packages/teaching/resources/`。
- Web 目标目录：`resources/vault-teaching/`。
- 原文同步范围：25 个 `skills/*.md`、`concepts.md`、`presets/mixed.md`，共 27 个文件。
- 校验方法：逐路径比较 Desktop commit tree blob 与 Web 工作区 `git hash-object`；结果 27/27 相同、0 不匹配。
- `manifest.json` 是 Web 运行时注册清单，独立保留 Web 菜单分类和 legacy aliases；未计入 27 个原文文件。Web `base.md`/`workers/` 保留平台运行时合同。
- 测试审阅：没有发现把旧 Skill 正文措辞钉死的断言。资源加载/路由测试按当前源文件验证实际传递，CLI/Bash 调用测试验证 Web 工具合同。

| Web 相对路径 | Desktop Git blob | Web Git blob |
| --- | --- | --- |
| `concepts.md` | `59c842824566389b7f4d57c281c466cb6f9e01d4` | `59c842824566389b7f4d57c281c466cb6f9e01d4` |
| `presets/mixed.md` | `6636912725626d9cf2ca52e1b29123e0090a96d7` | `6636912725626d9cf2ca52e1b29123e0090a96d7` |
| `skills/board.md` | `3fcd0e9d0036ecb9efc4f5f8a8a3dcb8b8f08c1b` | `3fcd0e9d0036ecb9efc4f5f8a8a3dcb8b8f08c1b` |
| `skills/consolidation.md` | `7c4b13f48e84e1f93923b70bdec2b2a0a77f01ff` | `7c4b13f48e84e1f93923b70bdec2b2a0a77f01ff` |
| `skills/essay-review.md` | `e069760bf477c6782d7f8275389fe895cda8bf2e` | `e069760bf477c6782d7f8275389fe895cda8bf2e` |
| `skills/exam-prep.md` | `089b8eeeab03119b0669f939fb2fb1d55a98a9ab` | `089b8eeeab03119b0669f939fb2fb1d55a98a9ab` |
| `skills/learning-review.md` | `6b577c23ca027ba343d3b0ebde474df6b5f6fab6` | `6b577c23ca027ba343d3b0ebde474df6b5f6fab6` |
| `skills/lesson-preparation.md` | `3fc5232143d5647b5ddb4731f12810d011263104` | `3fc5232143d5647b5ddb4731f12810d011263104` |
| `skills/material-outline.md` | `d3a298caeae1e0ff5b2ade08e0502dcd8292e986` | `d3a298caeae1e0ff5b2ade08e0502dcd8292e986` |
| `skills/material-search.md` | `06d7c98861db8483a979e5acd8dffbb840c83985` | `06d7c98861db8483a979e5acd8dffbb840c83985` |
| `skills/method-distillation.md` | `9f637756fbc2462f1dc2d3a6b3f43bd46dc39d01` | `9f637756fbc2462f1dc2d3a6b3f43bd46dc39d01` |
| `skills/research.md` | `4d4aa750bdb41c8b0ea283c909d054bd8e87828e` | `4d4aa750bdb41c8b0ea283c909d054bd8e87828e` |
| `skills/skill-authoring.md` | `5177ac886b6aae5c432c0e454ad2319e8e717995` | `5177ac886b6aae5c432c0e454ad2319e8e717995` |
| `skills/subject-chemistry-prep.md` | `39b83aaec88e5c4ce17524b4bf4d373df95ffb90` | `39b83aaec88e5c4ce17524b4bf4d373df95ffb90` |
| `skills/subject-chemistry.md` | `5f8c978c9e22e83d72b9403ae4b9dc81a47ac287` | `5f8c978c9e22e83d72b9403ae4b9dc81a47ac287` |
| `skills/subject-chinese.md` | `cdd3f4170c9c31f62177164509af1f633db7fc49` | `cdd3f4170c9c31f62177164509af1f633db7fc49` |
| `skills/subject-computing.md` | `907cb00ef19f024b8f4755f19099ca2bab30d7b2` | `907cb00ef19f024b8f4755f19099ca2bab30d7b2` |
| `skills/subject-english.md` | `a653d09381596229074eddf5fe41e6305da09776` | `a653d09381596229074eddf5fe41e6305da09776` |
| `skills/subject-humanities.md` | `c4bc795155c2fe1486d7bd801368971eb69ef7bb` | `c4bc795155c2fe1486d7bd801368971eb69ef7bb` |
| `skills/subject-math-prep.md` | `f0a66c2f1d8f77d2b5972781b5ea7b24f3ee1e36` | `f0a66c2f1d8f77d2b5972781b5ea7b24f3ee1e36` |
| `skills/subject-math.md` | `86c65373363095caced7cfc58d0cf64d38902db2` | `86c65373363095caced7cfc58d0cf64d38902db2` |
| `skills/subject-physics-prep.md` | `ca1cf694d4e9d0ad323bb8fdead90b56f5ed8790` | `ca1cf694d4e9d0ad323bb8fdead90b56f5ed8790` |
| `skills/subject-physics.md` | `071624b8f731456aa3cf6e4e9ffd43f601975915` | `071624b8f731456aa3cf6e4e9ffd43f601975915` |
| `skills/subject-science.md` | `6638a72718d6bd8504e5ae6847f6bc08c396e241` | `6638a72718d6bd8504e5ae6847f6bc08c396e241` |
| `skills/teaching-reflection.md` | `c8689633489d80e614b209db239c47c5af29b9d8` | `c8689633489d80e614b209db239c47c5af29b9d8` |
| `skills/vault-workflow.md` | `c737ae2950aaa5b3cfd9caac4bf8458dfadd17dd` | `c737ae2950aaa5b3cfd9caac4bf8458dfadd17dd` |
| `skills/worker-orchestration.md` | `c115dedefb97ed1efddae44ebc15e02758bb3bd9` | `c115dedefb97ed1efddae44ebc15e02758bb3bd9` |
