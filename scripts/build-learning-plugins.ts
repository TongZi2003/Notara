import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {catalog} from '../examples/plugin-sources/catalog.ts';
const root=resolve('.'),common=await readFile('examples/plugin-sources/common.css','utf8');
for(const plugin of catalog){
 const output=await build({entryPoints:[`examples/plugin-sources/${plugin.name}.ts`],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false});
 let css=await readFile('node_modules/katex/dist/katex.min.css','utf8');
 for(const match of [...css.matchAll(/url\(([^)]+)\)/g)]){const file=match[1]!;if(!file.endsWith('.woff2'))continue;const bytes=await readFile(join('node_modules/katex/dist',file));css=css.replaceAll(match[0],`url(data:font/woff2;base64,${bytes.toString('base64')})`);}
 css=css.replace(/,url\(fonts\/[^)]+\) format\("(?:woff|truetype)"\)/g,'');
 const html=`<style>${css}\n${common}</style><script type="module">${output.outputFiles[0]!.text.replaceAll('</script','<\\/script')}</script>\n`;
 if(Buffer.byteLength(html)>1_000_000)throw new Error(plugin.name+' exceeds entry limit');
 const dir=join(root,'examples/plugins',plugin.name);await mkdir(dir,{recursive:true});
 const manifest={name:'@notara/'+plugin.name,version:'1.0.0',files:['workbench.html','skill.md','README.md','LICENSE-KaTeX.txt',...('seed'in plugin?['seed.json']:[])],notara:{apiVersion:1,title:plugin.title,description:plugin.description,skills:[{id:'learn',title:plugin.skill,description:plugin.description,entry:'skill.md'}],workbenches:[{id:'workbench',title:plugin.title,description:plugin.description,entry:'workbench.html',permissions:plugin.permissions,...('seed'in plugin?{document:{kind:plugin.seed.kind,seed:'seed.json'}}:{})}]}};
 await writeFile(join(dir,'package.json'),JSON.stringify(manifest,null,2)+'\n');await writeFile(join(dir,'workbench.html'),html);
 await writeFile(join(dir,'LICENSE-KaTeX.txt'),await readFile('node_modules/katex/LICENSE','utf8'));
 if('seed'in plugin)await writeFile(join(dir,'seed.json'),JSON.stringify(plugin.seed,null,2)+'\n');
 await writeFile(join(dir,'skill.md'),`# ${plugin.skill}\n\n${plugin.instructions}\n\n工具不在当前列表时先load_tools加载目录中的真实工具名，按读到的参数合同调用。工作文档的documentJson是完整document序列化，不含revision或schema。出现版本冲突先重读并保留学生修改，不绕道写盘。正式成果保存仍走原有笔记/卡片确认，不能因操作工作台推进复习。\n`);
 await writeFile(join(dir,'README.md'),`# ${plugin.title}\n\n${plugin.description}\n\n插件页安装本目录或npm pack生成的tgz。课堂顶部打开工作台，＋或斜杠选择「${plugin.skill}」。操作中需要保存时点击相应保存按钮；整理为笔记会显示宿主确认。卸载保留已保存成果。\n\n${plugin.name==='seminar-room'?'研讨实际调用独立子会话，模型继承当前课堂，会使用模型额度；助教需要参考标准。可对同一子会话追问，失败/中断不当作完成。':'工作台中的示例、猜想和草稿不代表学生掌握；老师只能读取已经保存或发到对话的内容。'}\n\nHTML离线打包，沿用双主题；声明的权限见package.json。源码位于examples/plugin-sources，重建命令：node_modules/.bin/tsx scripts/build-learning-plugins.ts。${plugin.name==='time-atlas'?'底图使用Natural Earth public domain land数据：https://www.naturalearthdata.com/about/terms-of-use/ 。地图不表示历史疆域。':''}\n`);
 console.log(plugin.name,Buffer.byteLength(html));
}
