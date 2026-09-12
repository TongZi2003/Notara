/**
 * One request channel between the pages that meet a card.
 *
 * The 资料 page shows the student's own saved cards, but the card library owns
 * opening one: its page mounts only while its panel is on stage, so a request
 * that arrives before that mount is kept, not dropped. Nothing is stored here —
 * no second card lifecycle, no route of its own. The card's identity is the
 * Host's `ref`, and the library re-reads the card it is given.
 */
export type CardOpenListener = (target: string) => void;

export class CardOpenRequest {
  private readonly listeners = new Set<CardOpenListener>();
  /** A request made while the library page was not mounted yet. */
  private pending: string | undefined;

  subscribe(listener: CardOpenListener): () => void {
    this.listeners.add(listener);
    if (this.pending !== undefined) {
      const target = this.pending;
      this.pending = undefined;
      listener(target);
    }
    return () => { this.listeners.delete(listener); };
  }

  request(target: string): void {
    if (this.listeners.size === 0) { this.pending = target; return; }
    for (const listener of this.listeners) listener(target);
  }
}

/** One client instance owns one channel; both pages import this same object. */
export const cardOpenRequest = new CardOpenRequest();
