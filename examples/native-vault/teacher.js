import { teachingManifest,teachingResource } from './teaching-catalog.js';

export const inject=['skills'];
// Mounted in the teaching preset's standing scope, never in the ordinary agent catalog.
export function apply(ctx) {
  ctx.effect(()=>ctx.skills.registerProvider(()=>({name:'notara-teaching',
    async list(options){if(options.signal?.aborted)return [];return [...teachingManifest.choices,...teachingManifest.skills].map(item=>({name:`notara-${item.id}`,description:item.description,provider:'notara-teaching',source:'bundled',invocation:{modelInvocable:true,userInvocable:true},rank:600,locator:item.file}));},
    async get(candidate){const item=[...teachingManifest.choices,...teachingManifest.skills].find(row=>row.file===candidate.locator);if(!item)return undefined;return {name:candidate.name,description:item.description,provider:'notara-teaching',source:'bundled',invocation:candidate.invocation,content:teachingResource(item.file)};},
  })));
}
