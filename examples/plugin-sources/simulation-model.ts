export function advance(values:number[],effects:number[],limits:{minimum:number;maximum:number}[]):{values:number[];clipped:boolean;viable:boolean}{
 const raw=values.map((v,i)=>v+effects[i]!);return {values:raw.map((v,i)=>Math.max(0,Math.min(limits[i]!.maximum,v))),clipped:raw.some((v,i)=>v<0||v>limits[i]!.maximum),viable:raw.every((v,i)=>v>=limits[i]!.minimum)};
}
