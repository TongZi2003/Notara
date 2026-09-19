import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// pi-ai's OpenAI-completions stream accumulates tool-call arguments by plain
// string concatenation. Two failure modes both degrade to a silent {}:
//   1. Providers that stream `function.arguments` already-parsed (objects)
//      contaminate partialArgs with "[object Object]" forever.
//   2. Any other unparseable argument payload is swallowed by
//      parseStreamingJson's {} fallback at finalization.
// Downstream tools then see empty arguments and report "missing fields",
// sending the model into an unfixable retry loop. Normalize non-string
// argument chunks before concat, and tag finalized empty parses with a
// __malformed_arguments marker so the failure is visible to the tool layer.
const patches = [
  {
    path: 'dist/api/openai-completions.js',
    sha: '1e2097ced37cf0e21aa5711297eecc77916de8a4ed81a9019bc7d97b22825fa3',
    replacements: [
      [
        'if (toolCall.function?.arguments) {\n                                delta = toolCall.function.arguments;\n                                block.partialArgs = (block.partialArgs ?? "") + toolCall.function.arguments;\n                                block.arguments = parseStreamingJson(block.partialArgs);\n                            }',
        'if (toolCall.function?.arguments) {\n                                const argChunk = typeof toolCall.function.arguments === "string" ? toolCall.function.arguments : JSON.stringify(toolCall.function.arguments);\n                                delta = argChunk;\n                                block.partialArgs = (block.partialArgs ?? "") + argChunk;\n                                block.arguments = parseStreamingJson(block.partialArgs);\n                            }',
      ],
      [
        'else {\n                        block.arguments = parseStreamingJson(block.partialArgs);\n                    }\n                    // Finalize in-place and strip the scratch buffers so replay only\n                    // carries parsed arguments.',
        'else {\n                        block.arguments = parseStreamingJson(block.partialArgs);\n                        if (typeof block.partialArgs === "string" && block.partialArgs.trim() !== "" && block.partialArgs.trim() !== "{}" && block.arguments !== null && typeof block.arguments === "object" && !Array.isArray(block.arguments) && Object.keys(block.arguments).length === 0) {\n                            block.arguments = { __malformed_arguments: block.partialArgs.slice(0, 2000) };\n                        }\n                    }\n                    // Finalize in-place and strip the scratch buffers so replay only\n                    // carries parsed arguments.',
      ],
    ],
  },
  {
    path: 'dist/api/anthropic-messages.js',
    sha: 'f748560c80fe91bb5736b62f6f34c5e2e2bfa224cd5eb959134ca903c226b604',
    replacements: [
      [
        'else if (block.type === "toolCall") {\n                            block.arguments = parseStreamingJson(block.partialJson);\n                            // Finalize in-place and strip the scratch buffer so replay only\n                            // carries parsed arguments.\n                            delete block.partialJson;',
        'else if (block.type === "toolCall") {\n                            block.arguments = parseStreamingJson(block.partialJson);\n                            if (typeof block.partialJson === "string" && block.partialJson.trim() !== "" && block.partialJson.trim() !== "{}" && block.arguments !== null && typeof block.arguments === "object" && !Array.isArray(block.arguments) && Object.keys(block.arguments).length === 0) {\n                                block.arguments = { __malformed_arguments: block.partialJson.slice(0, 2000) };\n                            }\n                            // Finalize in-place and strip the scratch buffer so replay only\n                            // carries parsed arguments.\n                            delete block.partialJson;',
      ],
    ],
  },
] as const;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
for (const patch of patches) {
  const path = new URL('../node_modules/@earendil-works/pi-ai/' + patch.path, import.meta.url);
  const source = readFileSync(path, 'utf8');
  if (sha(source) !== patch.sha) {
    let reversed = source;
    for (const [before, after] of [...patch.replacements].reverse()) reversed = reversed.replace(after, before);
    if (sha(reversed) !== patch.sha) throw new Error('Unknown pi-ai artifact; review tool-argument patch: ' + patch.path);
    continue;
  }
  let result = source;
  for (const [before, after] of patch.replacements) {
    if (!result.includes(before)) throw new Error('pi-ai tool-argument patch anchor missing: ' + patch.path);
    result = result.replace(before, after);
  }
  writeFileSync(path, result);
  console.log('Patched pi-ai tool-call argument handling: ' + patch.path);
}
