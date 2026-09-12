/**
 * One logical write keeps one operation id.
 *
 * The Host answers a write by operation id: the same id is the same write, and
 * a replay returns what was really stored instead of storing a second object.
 * That only helps if the id survives a lost answer. A refused save or a
 * transport error leaves the outcome unknown — the write may already be on
 * disk — so the retry has to be the *same* operation rather than a fresh one.
 * The id therefore moves only when the payload itself moves (a different edit
 * is a different operation, and reusing an id for changed content would be an
 * operation mismatch) or when the caller has seen the write land.
 */
import { useCallback, useRef } from 'react';

export function useStableOperationId(): (key: string) => string {
  const attempt = useRef<{ readonly key: string; readonly id: string }>();
  return useCallback((key: string): string => {
    if (attempt.current?.key === key) return attempt.current.id;
    const id = crypto.randomUUID();
    attempt.current = { key, id };
    return id;
  }, []);
}

/** One attempt's identity: same target, baseline and payload keep the same id. */
export function attemptKey(...parts: readonly string[]): string {
  return parts.join('\u0000');
}

/** A write nobody answered: retryable, and not silently assumed lost. */
export const UNKNOWN_WRITE_COPY = '这次没有收到回话，结果不确定：再点一次会用同一次操作重试，不会重复保存。';

/** The same thing, said for one review mark instead of a form save. */
export const UNKNOWN_REVIEW_COPY = '这次没有收到回话，可能已经记上了：再点同一个档位会按同一次重试，不会记两次。';
