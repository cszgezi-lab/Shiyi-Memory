import {clone,sha256} from './utils.js';
import {foldName} from './persona-identity.js';

// Optional guidance, appended to the wire contract rather than overwriting a
// user's saved preset. There is still only one model request per persona batch.
export const PERSONA_DEVELOPMENT_RULE=`正文新人物与原书人物同等处理，original不是人物白名单。先在本批正文识别人物，再判断首次建档或已有档案更新。characterCandidates只是显式说话人线索，不是已经确认的人物；也须寻找没有显式台词标签的正文人物。首次出现且有可归属信息的具名人物建立简明但完整的档案，不因没有世界书而省略；只被提及且没有个人信息的名字不强行建档。别称、简繁字是同一身份；不把旁白、物品、群体或泛称当新角色。
没有本人物original.parts时必须updates:[]，上一版正文不是original片段。original中source=chat是程序提供的本聊天人物底稿，同样按实际ref局部更新；其他未变信息程序保留。不要把底稿中的旧衣着或旧权限原样留着又在text写相反当前状态；在相应ref中标注历史或更新到当前情境。不得自行编造ref。
角色弧光不是编写未来剧情。记录已发生的“原本怎样→经历/原因→现在怎样”，保留底色、未改变的自由属性，关系和口吻按对象与场景区分。普通路人允许只保存可靠概况，无需编创伤、愿望、成长动机。一次脸红/烦躁不等于永久性格、恋爱或决裂；具体亲密只对该对象，不推广给其他人。衣着是场景状态，不是成长阶段。
记录强度不超过证据：一次穿着不能写成习惯穿着，一次记日记不能写成经常或从来；“未见过/未读过”不等于“不知道其存在”，“未交出”不等于“禁止持有”。保留原文的具体否定对象，不推导更广的未知或拒绝。原因、目的没有明说时留空，不因同场发生就补“为了”“以便”；不把谨慎润色为极端或极强。旧档案中的修饰语和推断不得在后续批次越写越强。
有明确转变时可另输出development:[{topic:"自由命名的变化主题",target:"具体对象；无对象填空串",before:"此前状态",after:"变化后的表现",cause:"原文明确的转变原因；未说明填空串",floor:1,evidence:"该楼支持变化的完整连续原文"}]。每项证据逐字引用本批正文，并包含人物归属与变化；没有足够依据就只保留有据概况，不编补原因。topic沿用previous.development同一主题，target沿用正式姓名；不能把不同对象合成泛泛的信任。只输出本批新增/改变的主题，程序保留其他主题，不用回显所有旧项。previous.development中的起点和转变供理解连续性，当前正文优先，倒叙只作历史，不能覆盖已有后续状态。text仍是可独立阅读的当前完整新增档案，不能仅写development或“同上”。语料examples保留能体现转变的真实原话及对象，不把私人心迹当作公开发言。无实质变化不输出该人物。`;

const unsafe=/\[\[SHIYI_PERSONA:|<%|%>|<\/?script\b|\{\{|@@/i;
const generic=/^(?:旁白|叙述|系統|系统|剧情|選項|选项|时间|地點|地点|角色|人物|姓名|我|你|他|她|它|大家|众人|有人|路人|老师|先生|小姐|店员|玩家|用户|助手|assistant|user|system|narrator)$/i;

// A bounded lexical aid, never a source of invented profiles or world ownership.
// Full source is still sent, so a missed name here does not exclude the person.
export function personaCharacterCandidates(messages,identity){
  const found=new Map();
  for(const m of messages){
    const pattern=/(?:^|[\n。！？])\s*([\p{L}][\p{L}·・ ]{0,30}?)(?:\s*【[^\n】]{0,40}】)?\s*(?:[：:]\s*(?=[“「『"\n])|(?:说|说道|问|问道|回答|答道)[：:]?\s*(?=[“「『"]))/gu;
    for(const match of m.text.matchAll(pattern)){
      const name=match[1].trim();if(generic.test(name)||/\s|心想|暗想|内心|旁白|对|向|如果/.test(name)||identity.resolve(name))continue;
      const key=foldName(name),item=found.get(key)??{name,floors:[]};
      if(!item.floors.includes(m.index))item.floors.push(m.index);found.set(key,item);
    }
  }
  return [...found.values()];
}

// A compact current projection. Prior revisions are already preserved by the
// persona checkpoint store; don't inject an ever-growing event history again.
export function mergePersonaDevelopment(updates,{previous=[],messages,identity,name}){
  const items=new Map(previous.map(item=>[item.key,clone(item)]));let rejected=0;
  if(updates!==undefined&&!Array.isArray(updates))return {items:[...items.values()],rejected:1};
  for(const row of updates??[]){
    const m=messages.find(m=>m.index===row?.floor);
    const fields=['topic','target','before','after','cause','evidence'];
    if(!m||fields.some(k=>typeof row[k]!=='string'||unsafe.test(row[k]))||!row.topic.trim()||!row.after.trim()||!row.evidence.trim()||!m.text.includes(row.evidence)||!identity.mentions(row.evidence).some(p=>p.key===foldName(name))){rejected++;continue;}
    const topic=row.topic.trim(),target=identity.resolve(row.target)?.name??row.target.trim();
    const key=sha256([foldName(topic),foldName(target)]).slice(0,24),old=items.get(key);
    // No stale rerun/flashback floor can roll the current projection backwards.
    if(old&&old.floor>row.floor)continue;
    const item={key,topic,target,before:row.before.trim(),after:row.after.trim(),cause:row.cause.trim(),floor:row.floor,evidence:row.evidence,origin:old?.origin??row.before.trim()};
    if(old&&old.after===item.after&&old.cause===item.cause)continue;
    items.set(key,item);
  }
  return {items:[...items.values()],rejected};
}

export function personaDevelopmentText(items){
  if(!items.length)return '';
  return '【有据的成长脉络 · 仅限所述对象与来源情境，不是预定剧情】\n'+items.map(e=>[
    `${e.topic}${e.target?' · 对'+e.target:''}（第${e.floor}楼）`,
    e.origin?`最初：${e.origin}`:'',
    e.before&&e.before!==e.origin?`此前：${e.before}`:'',
    `变化后：${e.after}`,e.cause?`转变缘由：${e.cause}`:'',
    `当时原文：${e.evidence}`
  ].filter(Boolean).join('\n')).join('\n\n');
}
