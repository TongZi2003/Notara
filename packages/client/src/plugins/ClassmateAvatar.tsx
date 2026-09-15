import type { Context } from '@deepseek-ai/cordis';
import { useEffect, useState } from 'react';
import type { ClassroomAvatarImage } from '@studyforge/contracts/classroom';
const caches = new WeakMap<Context, Map<string, Promise<string | undefined>>>();
function cache(ctx: Context): Map<string, Promise<string | undefined>> { let value = caches.get(ctx); if (!value) { value = new Map(); caches.set(ctx, value); } return value; }
export function rememberAvatar(ctx: Context, image: ClassroomAvatarImage): void { cache(ctx).set(image.ref, Promise.resolve('data:' + image.mediaType + ';base64,' + image.base64)); }
export function ClassmateAvatar({ ctx, avatar, index = 0 }: { ctx: Context; avatar?: string | undefined; index?: number }): React.JSX.Element {
  const [loaded, setLoaded] = useState<{ ref: string; url: string }>();
  useEffect(() => {
    if (!avatar) return;
    let live = true; const images = cache(ctx);
    if (!images.has(avatar)) images.set(avatar, ctx.remote.notaraClassroomView.readAvatar({ ref: avatar }).then(reply => reply.ok ? 'data:' + reply.value.mediaType + ';base64,' + reply.value.base64 : undefined).catch(() => undefined));
    void images.get(avatar)!.then(url => { if (!url) images.delete(avatar); if (live) setLoaded(url ? { ref: avatar, url } : undefined); });
    return () => { live = false; };
  }, [ctx, avatar]);
  return loaded?.ref === avatar && loaded ? <img className="nc-custom-avatar" src={loaded.url} alt="" draggable={false} onError={() => setLoaded(undefined)} /> : <DefaultAvatar index={index} />;
}
export function DefaultAvatar({ index = 0 }: { index?: number }): React.JSX.Element {
  return <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M4 36q1-10 14-10t14 10" fill={index === -1 ? '#b7c7e5' : '#cdd5dc'} /><ellipse cx="18" cy="18" rx="10" ry="12" fill="#eee3d5" /><path d={index % 2 ? 'M8 20Q3 7 14 5q14-3 13 15l-4 2V12q-7 6-12 1v9z' : 'M8 17Q5 8 13 5q13-3 14 12l-5-3-3-3-7 4z'} fill="#68747f" /><g stroke="#65717c" strokeWidth="1.2" fill="none" strokeLinecap="round"><path d="M13 18h.2M22 18h.2M16 24q2 1 4-1" />{index === 3 && <><rect x="10" y="15" width="6" height="5" rx="1.5" /><rect x="20" y="15" width="6" height="5" rx="1.5" /><path d="M16 17h4" /></>}</g></svg>;
}
