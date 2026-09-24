// Sample files only for a runtime created by startVaultIsolated. No user Vault.
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {upsertLessonSummary} from '../../examples/native-vault/lesson-data.js';
import {civilDay} from '../../examples/native-vault/calendar-data.js';
import {addReviewDays} from '../../examples/native-vault/review-data.js';
const {root}=JSON.parse(await readFile('.runtime/modern-preview.json','utf8'));
const actual=await realpath(root),parent=await realpath(tmpdir());
if(!actual.startsWith(parent+'/')||!basename(actual).startsWith('notara-vault-native-'))throw Error('isolated sample root required');
const vault=join(root,'workspace/vault'),today=civilDay(new Date(),Intl.DateTimeFormat().resolvedOptions().timeZone);
const write=async(path,body)=>{await mkdir(join(vault,path.split('/').slice(0,-1).join('/')),{recursive:true});await writeFile(join(vault,path),body);};
const card=(title,body,source,learned=true)=>'---\ntype: card\ntags: [数学]\n'+(learned?'learned: true\nmastery: 2\ninterval: 3\nlast_review: '+addReviewDays(today,-4)+'\nnext_review: '+addReviewDays(today,-1)+'\n':'')+'---\n# '+title+'\n\n![[知识/'+source+'.md]]\n\n## 内容\n\n'+body+'\n\n## 参考理解\n\n先比较条件，再选择合适的表示。\n\n## 学生理解\n\n这是隔离实例的合成示例，等待实际作答。\n';
await write('知识/圆锥曲线.md','---\ntype: note\ntags: [数学, 圆锥曲线]\n---\n# 圆锥曲线\n\n## 点差法\n\n把两个端点代入同一个方程，相减之后观察“和”与“差”。\n\n## 椭圆定义\n\n到两定点距离之和为常数，且常数大于两定点距离。\n');
await write('卡片/中点弦的斜率.md',card('中点弦的斜率','椭圆 $x^2/4+y^2/3=1$，弦的中点为 $(1,1/2)$。求弦的斜率。','圆锥曲线'));
await write('卡片/椭圆的第一定义.md',card('椭圆的第一定义','为什么要求距离和大于两定点距离？','圆锥曲线'));
await write('卡片/基底与坐标表示.md',card('基底与坐标表示','为什么两个不共线向量可以表示平面内任一向量？','向量',false));
await write('锦囊/先检查运算条件.md','---\ntype: insight\ntags: [数学, 方法]\n---\n# 先检查运算条件\n\n遇到比值时先看分母，遇到平方时注意逆向推导是否等价。\n\n[[卡片/中点弦的斜率]]\n');
const lessons=[
 {id:'definition',title:'椭圆的定义与标准方程',stage:'定义与方程',pathway:'main',materials:['知识/圆锥曲线.md']},
 {id:'chord',title:'中点弦与点差法',parent:'definition',stage:'弦与斜率',pathway:'main',prerequisites:['definition'],scheduledOn:today,materials:['卡片/中点弦的斜率.md']},
 {id:'practice',title:'点差法变式练习',parent:'chord',stage:'弦与斜率',pathway:'remedial',materials:['卡片/中点弦的斜率.md']},
 {id:'focal',title:'焦点弦与弦长',parent:'chord',stage:'综合与拓展',pathway:'main',prerequisites:['definition'],materials:['知识/圆锥曲线.md']},
 {id:'polar',title:'极点与极线',parent:'focal',stage:'综合与拓展',pathway:'extension',materials:['知识/圆锥曲线.md']},
];
await write('路线/圆锥曲线路线.md','---\ntype: route\ntags: [数学]\nlessons: '+JSON.stringify(lessons)+'\n---\n# 圆锥曲线\n\n## 目标\n\n从定义出发，建立中点、斜率与方程的联系。\n\n'+lessons.map(n=>'<!-- notara:route-node '+JSON.stringify(n.id)+' -->\n## '+n.title+'\n\n'+(n.pathway==='remedial'?'需要提示才能想到相减时，再做一道变式。':'先请学生尝试，根据实际理解决定深入或补充。')+'\n<!-- notara:route-node:end -->\n').join('\n'));
await write('课堂小结/向量基底.md',upsertLessonSummary('---\ntype: lesson-summary\ntags: [数学]\n---\n# 向量 · 基底\n\n',{sessionId:'synthetic-modern-demo',title:'向量 · 基底',throughAt:today+'T09:00:00+08:00',savedAt:today+'T09:00:00+08:00',body:'合成课堂记录：能画图说明分解，唯一性仍需要进一步检验。'}));
console.log('Synthetic material, review and route fixtures written to the isolated runtime.');
