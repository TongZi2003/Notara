import type { MathScene } from './math-scene.ts';
/** Three-way merge by object/parameter name; unrelated student and AI edits survive. */
export function mergeMathScene<T extends MathScene>(base: T, local: T, remote: T): { document: T; conflicts: string[] } {
  const conflicts: string[] = [];
  const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  function merge(b: unknown, l: unknown, r: unknown, path: string): unknown {
    if (equal(b,l)) return r;
    if (equal(b,r) || equal(l,r)) return l;
    if (['objects','parameters'].includes(path) && Array.isArray(b) && Array.isArray(l) && Array.isArray(r)) {
      const names = [...new Set([...r,...l,...b].map(x => x.name))];
      return names.map(name => merge(b.find(x=>x.name===name),l.find(x=>x.name===name),r.find(x=>x.name===name),path+'.'+name)).filter(x=>x!==undefined);
    }
    if (object(b) && object(l) && object(r)) {
      return Object.fromEntries([...new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])].map(key => [key, merge(b[key],l[key],r[key],path?path+'.'+key:key)]).filter(([,v])=>v!==undefined));
    }
    conflicts.push(path); return l;
  }
  return { document: structuredClone(merge(base,local,remote,'') as T), conflicts };
}
