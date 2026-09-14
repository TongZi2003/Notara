export type Point={x:number;y:number};
export const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export function angle(a:Point,b:Point,c:Point):number {const u={x:a.x-b.x,y:a.y-b.y},v={x:c.x-b.x,y:c.y-b.y},den=Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);return den<1e-7?NaN:Math.acos(Math.max(-1,Math.min(1,(u.x*v.x+u.y*v.y)/den)))*180/Math.PI;}
export function triangle(points:Point[]){const [a,b,c]=points as [Point,Point,Point];return {angles:[angle(b,a,c),angle(a,b,c),angle(a,c,b)],area:Math.abs((b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y))/2,centroid:{x:(a.x+b.x+c.x)/3,y:(a.y+b.y+c.y)/3}};}
export function onCircle(point:Point):Point{const t=Math.atan2(point.y-180,point.x-240);return {x:240+140*Math.cos(t),y:180+140*Math.sin(t)};}
