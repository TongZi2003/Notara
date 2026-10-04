/** Safe classroom projection: never retains reasoning, arguments, tool output
 * or an unfinished solution. Complete text remains in the native child log. */
export function workerProgress(previous, frame) {
  const state = {...previous, lastActivityAt: new Date().toISOString()};
  if (frame.type === 'start') state.phase = 'responding';
  else if (frame.type === 'end') state.phase = 'settling';
  else if (frame.type === 'chunk') {
    const chunk = frame.chunk;
    if (chunk.type === 'reasoning-delta') state.phase = 'thinking';
    else if (chunk.type === 'text-delta') {
      state.phase = 'writing';
      state.outputChars = (state.outputChars ?? 0) + Array.from(chunk.text ?? '').length;
    } else if (chunk.type.startsWith('tool-call')) state.phase = 'tool';
  }
  return state;
}
