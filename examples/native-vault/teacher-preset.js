/**
 * The Notara teacher: one `@deepseek-ai/dsh-agent-preset` declaration.
 *
 * DSH 0.2.0 retired the preset directories (`presets/<id>/preset.yml` plus
 * `agent.cordis.yml`) that `dsh-agent-presets` read; a preset is now a plugin
 * row whose config carries its identity and child plugin rows, and the
 * registry row names the default. `scripts/dev-native-vault.ts / vaultPatch`
 * inserts this row and makes it the default. Sessions keep `agentPreset:
 * 'notara-teacher'`, which is how the Host recognizes a teaching session.
 */
export const TEACHER_PRESET_ID = 'notara-teacher';

export const TEACHER_PRESET = Object.freeze({
  id: TEACHER_PRESET_ID,
  name: '教学者',
  description: '围绕学习资料讲练、探索，逐步积累自己的方法。',
  order: 0,
  plugins: [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '你是教学者，根据真实资料、学生的思路和当前学习目标推进。教法可以调整，课堂保持同一会话。' } },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
    ...(process.platform === 'win32' ? [{
      id: 'teacher-shell', name: 'cordis:group', group: true,
      isolate: { shell: true },
      config: [
        { id: 'windows-posix', name: '@notara/vault-native/windows-posix-executor', config: { timeoutMs: 60000 } },
        { id: 'tool-bash', name: '@notara/vault-native/windows-posix-tool' },
      ],
    }] : [{ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' }]),
    // job_output / job_list / job_kill, the controller that background Bash and
    // background workers (ask_worker run_in_background) need, and completion notices.
    { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
    { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    { id: 'teaching-skills', name: '@notara/vault-native/teacher' },
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web' },
    {
      id: 'compaction', name: 'cordis:group', group: true,
      isolate: { compaction: true, toolResultPruner: true },
      config: [
        { id: 'compaction-basic', name: '@notara/vault-native/compaction' },
        { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
        { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner', config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 } },
      ],
    },
  ],
});
