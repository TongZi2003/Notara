/**
 * Notara's own session events (`notara/*`) as the readers see them.
 *
 * DSH 0.2.0 moved sessions to format v4. Opening an older (v3) session renames
 * every unknown ignorable event to `plugin:<type>`, and a later migration step
 * would add the prefix again, so readers strip any number of `plugin:`
 * prefixes before matching. New events are still written as `notara/*`.
 * Pure: the browser bundle imports it too.
 */
export function pluginEventType(type) {
  return typeof type === 'string' ? type.replace(/^(?:plugin:)+/, '') : type;
}
