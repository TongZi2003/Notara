import * as nativeBash from '@deepseek-ai/dsh-tool-bash';

export const inject = nativeBash.inject;
export const Config = nativeBash.Config;

/** Only the model's shell dialect changes; native execution and approval stay intact. */
export function windowsPosixToolSchema(tool) {
  if (tool.name !== 'bash') return tool;
  return {
    ...tool,
    description: 'Execute a POSIX shell command in native BusyBox ash on Windows and return stdout/stderr. Each call runs in a fresh shell; use workdir for its working directory. Use forward-slash Windows paths (C:/...) and $NAME for environment variables. BusyBox supplies ls, cat, grep, sed, printf and other built-in applets; use "$DSH_NOTARA_RG" for packaged ripgrep. Quoted heredocs, pipelines and POSIX shell syntax work. This is ash with some Bash extensions: do not assume Bash arrays or every GNU utility option. Managed $DSH_* variables expose current harness environment facts. Long output is truncated; the full output path is reported when available. Commands retain the native file sandbox and approval policy. A file sandbox denial is a policy denial: do not retry another way.',
    parameters: {
      ...tool.parameters,
      properties: {
        ...tool.parameters.properties,
        command: { ...tool.parameters.properties.command, description: 'The POSIX ash command to execute on Windows.' },
      },
    },
  };
}

export function apply(ctx, config = {}) {
  nativeBash.apply(ctx, config);
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next();
    if (context.agent?.session?.header?.agentPreset !== 'notara-teacher') return result;
    return { ...result, tools: result.tools.map(windowsPosixToolSchema) };
  });
}
