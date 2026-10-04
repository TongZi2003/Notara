import { teachingManifest,teachingLegacyAliases,teachingResource,canonicalTeachingId } from './teaching-catalog.js';
import { activeUserSkills,skillContentWithInsights,userSkillChanges } from './user-skills.js';
import { resolveVaultRoot } from './vault.js';

export const inject=['skills'];
const builtIn=()=>[...teachingManifest.choices,...teachingManifest.skills];
// The menu shows the text before the full-width colon as the skill's title.
const userDescription=row=>`${row.title}：${row.description}`;
// Mounted in the teaching preset's standing scope, never in the ordinary agent catalog.
export function apply(ctx) {
  ctx.effect(()=>ctx.skills.registerProvider(control=>{
    // Adopted skills change the catalog; the body itself is re-read on every load.
    const refresh=()=>control?.invalidate();
    userSkillChanges.addEventListener('change',refresh);
    control?.signal.addEventListener('abort',()=>userSkillChanges.removeEventListener('change',refresh),{once:true});
    return {name:'notara-teaching',
      async list(options){
        if(options.signal?.aborted)return [];
        const bundled=builtIn().map(item=>({name:`notara-${item.id}`,description:item.description,provider:'notara-teaching',source:'bundled',invocation:{modelInvocable:true,userInvocable:true},rank:600,locator:item.file}));
        const aliases=Object.entries(teachingLegacyAliases).map(([alias,target])=>{
          const item=builtIn().find(row=>row.id===target);
          return {name:`notara-${alias}`,description:`兼容旧课堂调用；正文来自“${item.title}”。`,provider:'notara-teaching',source:'bundled-compat',invocation:{modelInvocable:true,userInvocable:false},rank:590,locator:item.file};
        });
        const adopted=(await activeUserSkills({cwd:options.cwd}).catch(()=>[])).map(row=>({name:row.name,description:userDescription(row),provider:'notara-teaching',source:`notara-${row.scope}`,invocation:{modelInvocable:true,userInvocable:true},rank:610,locator:{scope:row.scope,id:row.id}}));
        return [...bundled,...aliases,...adopted];
      },
      async get(candidate,options={}){
        if(typeof candidate.locator==='string'){
          const item=builtIn().find(row=>row.file===candidate.locator);if(!item)return undefined;
          const legacyId=candidate.name?.startsWith('notara-')?candidate.name.slice(7):'';
          const targetId=canonicalTeachingId(legacyId);
          const target=builtIn().find(row=>row.id===targetId);
          if(!target||target.file!==candidate.locator)return undefined;
          return {name:candidate.name,description:item.description,provider:'notara-teaching',source:candidate.source??'bundled',invocation:candidate.invocation,content:teachingResource(target.file)};
        }
        const row=(await activeUserSkills({cwd:options.cwd})).find(item=>item.scope===candidate.locator?.scope&&item.id===candidate.locator?.id);
        if(!row)return undefined;
        // A learning-set skill carries its generated 锦囊 index; the shared tier stays as written.
        const content=row.scope==='set'&&options.cwd?await skillContentWithInsights(row,resolveVaultRoot(options.cwd)):row.body;
        return {name:candidate.name,description:userDescription(row),provider:'notara-teaching',source:`notara-${row.scope}`,invocation:candidate.invocation,content};
      },
    };
  }));
}
