/**
 * The material's own text, held next to the element that renders it.
 *
 * A Markdown preview is HTML, so the rendered DOM no longer carries source
 * offsets. The element is the key: the text is remembered when the preview
 * mounts and read back only for a selection inside that same element, so two
 * open originals can never resolve each other's quotes.
 */
const texts = new WeakMap<Element, string>();

/** Remember the exact source text of one rendered preview element. */
export function rememberSourceText(element: Element, text: string): void {
  texts.set(element, text);
}

/** The source text that belongs to this element, if it was remembered. */
export function sourceTextOf(element: Element): string | undefined {
  return texts.get(element);
}
