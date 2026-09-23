import {clone,sha256} from './utils.js';
import {foldName} from './persona-identity.js';
import {storyTimeRange} from './temporal.js';
export const PERSONA_IMPACT_RULE=`动态人设不是第二份事件记忆。客观事件、完整时间线和发生经过由记忆模块保存；这里只写现在仍有效的态度、边界和表达：对谁、在何种场合、现在怎样。当前描述与development按对象各写现在的状态，本批重大变化放最前；同一对象、同一情境只保留当前状态，不逐批追加日记。被后续状态代替的旧说法退出当前描述，不改写成留在当前层的否定句。客观事实留在底稿。转变原因只留一句与楼号，不重复事件经过。
必须核对本批是否改变了之后的选择、边界、目标、自我认知或对特定对象的表达。变化不限一种方向。不因原有一般性格抹掉有依据的对象变化，也不把一次反应写成永久人格替换。沿用development的主题与对象更新当前after，before/origin只是历史，不是当前指令。保留其他仍有效的对象关系。
examples优先选体现当前态度改变、措辞和表达方式的真实原话，写明对谁及情境；保留否定、条件与不确定性，不把威胁或玩笑升格为会执行的永久行为。稳定外貌、身份、独立爱好由底稿保留，不为缩短删除未变细节。应退出当前演绎的旧关系/口吻通过对应updates明确注明历史，不只追加矛盾结论。无依据不“彻底、完全、永远”强化。`;

// Optional guidance, appended to the wire contract rather than overwriting a
// user's saved preset. There is still only one model request per persona batch.
export const PERSONA_DEVELOPMENT_RULE=`正文新人物与原书人物同等处理，original不是人物白名单。先在本批正文识别人物，再判断首次建档或已有档案更新。characterCandidates只是显式说话人线索，不是已经确认的人物；也须寻找没有显式台词标签的正文人物。首次出现且有可归属信息的具名人物建立简明但完整的档案，不因没有世界书而省略；只被提及且没有个人信息的名字不强行建档。别称、简繁字是同一身份；不把旁白、物品、群体或泛称当新角色。
没有本人物original.parts时必须updates:[]，上一版正文不是original片段。original中source=chat是程序提供的本聊天人物底稿，同样按实际ref局部更新；其他未变信息程序保留。不要把底稿中的旧衣着或旧权限原样留着又在text写相反当前状态；在相应ref中标注历史或更新到当前情境。不得自行编造ref。
角色弧光不是编写未来剧情。记录已发生的“原本怎样→经历/原因→现在怎样”，保留底色、未改变的自由属性，关系和口吻按对象与场景区分。普通路人允许只保存可靠概况，无需编创伤、愿望、成长动机。一次脸红/烦躁不等于永久性格、恋爱或决裂；具体亲密只对该对象，不推广给其他人。衣着是场景状态，不是成长阶段。
记录强度不超过证据：一次穿着不能写成习惯穿着，一次记日记不能写成经常或从来；“未见过/未读过”不等于“不知道其存在”，“未交出”不等于“禁止持有”。保留原文的具体否定对象，不推导更广的未知或拒绝。原因、目的没有明说时留空，不因同场发生就补“为了”“以便”；不把谨慎润色为极端或极强。旧档案中的修饰语和推断不得在后续批次越写越强。
有明确转变时可另输出development:[{topic:"自由命名的变化主题",target:"具体对象；无对象填空串",before:"此前状态",after:"变化后的表现",cause:"原文明确的转变原因；未说明填空串",floor:1,evidence:"该楼支持变化的完整连续原文"}]。每项证据逐字引用本批正文，并包含人物归属与变化；没有足够依据就只保留有据概况，不编补原因。topic沿用previous.development同一主题，target沿用正式姓名；不能把不同对象合成泛泛的信任。只输出本批新增/改变的主题，程序保留其他主题，不用回显所有旧项。previous.development中的起点和转变供理解连续性，当前正文优先，倒叙只作历史，不能覆盖已有后续状态。首次text须可独立阅读；已有B/N仅修改必要段落，不能用development代替冲突段落的updates/noteUpdates，也不整篇回写text。语料examples保留能体现转变的真实原话及对象，不把私人心迹当作公开发言。无实质变化不输出该人物。`;

export const PERSONA_CURRENT_ARC_RULE=`development是当前变化索引，不是事件清单。同一变化即使换了topic措辞，也要回填previous.development中的key；新主题省略key，不编造。target和scope界定对象与适用情境，沿用旧项的原值；不同对象、公开/私下、条件不同分别保留，不为压缩强合。可填scope（原文支持的情境，旧项无此字段时为空串）、phase:"current"或"historical"、storyTime（原文逐字明确的日期；未知省略）。倒叙项用historical，不覆盖当前项；来源楼号增加不等于时间推进。每个key输出一个当前完整after及仍有效的边界，origin/before/evidence留作追溯，被后续状态代替的早期说法不与当前说法同时当作必须演绎的指令。
本批明确改变表达方式时，development.evidence尽量包含完整人物归属和有代表性的真实原话，不截掉条件/否定。examples可用developmentKey关联已给出的key，但必须逐字出自同条证据、同楼；未知就省略。选择几条不同情境的当前语料，不因强烈措辞更醒目就全选威胁/拒绝。本次修改的当前描述保持简洁，不回放origin/before和全部事件；原书片段中相冲突的旧口吻仍须用updates处理，未变稳定资料保留。`;

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
function earlierStoryTime(previous,next){
  const a=storyTimeRange(previous),b=storyTimeRange(next);
  if(!a||!b||(a.offset===null)!==(b.offset===null))return false;
  return b.end-(b.offset??0)<=a.start-(a.offset??0);
}
// A scene date can be stated before the turn that contains the change. Carry
// only an explicit leading full-date header, never an inferred relative date
// or a date across a flashback/scene-time transition.
function hasSceneStoryTime(value,floor,messages){
  if(typeof value!=='string'||!value.trim()||!storyTimeRange(value))return false;
  const current=messages.find(m=>m.index===floor);
  if(current?.text.includes(value))return true;
  const date=/^(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2})(?=[。．.，,\s]|$)/u;
  const ordered=messages.filter(m=>m.index<=floor).sort((a,b)=>a.index-b.index);
  let header=-1;
  for(let i=0;i<ordered.length;i++)if(date.test(ordered[i].text.trim()))header=i;
  if(header<0||ordered[header].text.trim().match(date)[1]!==value)return false;
  const interval=ordered.slice(header).map(m=>m.text).join('\n');
  return !/(?:回忆|回想|倒叙|往事|梦境|假如|假设|返回|回到|次日|翌日|第二天|[一二三四五六七八九十\d]+(?:天|周|月|年)后|flashback|next day)/iu.test(interval);
}
export function mergePersonaDevelopment(updates,{previous=[],messages,identity,name}){
  const items=new Map(previous.map(item=>[item.key,clone(item)]));let rejected=0;
  if(updates!==undefined&&!Array.isArray(updates))return {items:[...items.values()],rejected:1};
  const canonical=value=>{
    const person=identity.resolve(value);if(person)return person.name;
    if(identity.people.some(p=>[p.name,...p.aliases].some(n=>foldName(n)===foldName(value))))return null;
    return value.trim();
  };
  const proposals=[];
  for(const candidate of updates??[]){
    // Unknown past state/cause stays unknown. Their omission is not a reason
    // to discard an otherwise evidenced current change or invent a backstory.
    const row=candidate&&typeof candidate==='object'?{...candidate,before:candidate.before===undefined?'':candidate.before,cause:candidate.cause===undefined?'':candidate.cause}:candidate;
    const m=messages.find(m=>m.index===row?.floor);
    const fields=['topic','target','before','after','cause','evidence'];
    if(!m||fields.some(k=>typeof row[k]!=='string'||unsafe.test(row[k]))||!row.topic.trim()||!row.after.trim()||!row.evidence.trim()||!m.text.includes(row.evidence)||!identity.mentions(row.evidence).some(p=>p.key===foldName(name))){rejected++;continue;}
    if(row.phase!==undefined&&!['current','historical'].includes(row.phase)||row.scope!==undefined&&(typeof row.scope!=='string'||unsafe.test(row.scope))||row.storyTime!==undefined&&!hasSceneStoryTime(row.storyTime,row.floor,messages)){rejected++;continue;}
    if(row.phase==='historical')continue;
    const topic=row.topic.trim(),target=canonical(row.target),scope=(row.scope??'').trim();
    if(target===null){rejected++;continue;}
    const key=row.key??sha256(scope?[foldName(topic),foldName(target),scope]:[foldName(topic),foldName(target)]).slice(0,24),old=items.get(key);
    if(row.key!==undefined&&(!old||typeof row.key!=='string'||canonical(old.target??'')===null||foldName(canonical(old.target??''))!==foldName(target)||(old.scope??'').trim()!==scope)){rejected++;continue;}
    // No stale rerun/flashback floor can roll the current projection backwards.
    if(old&&old.floor>row.floor)continue;
    if(earlierStoryTime(old?.timeAnchor?.storyTime??old?.storyTime,row.storyTime)){rejected++;continue;}
    // An earlier dated revision is a chronology bound, not the date of a new
    // undated change. Keep its provenance privately for flashback protection;
    // do not attach it to the current floor or send it as current storyTime.
    const timeAnchor=row.storyTime?{storyTime:row.storyTime,floor:row.floor}:old?.timeAnchor??(old?.storyTime?{storyTime:old.storyTime,floor:old.floor}:undefined);
    const item={key,topic,target,before:row.before.trim(),after:row.after.trim(),cause:row.cause.trim(),floor:row.floor,evidence:row.evidence,origin:old?.origin??row.before.trim(),...(scope?{scope}:{}),...(row.storyTime?{storyTime:row.storyTime}:{}),...(timeAnchor?{timeAnchor}: {})};
    if(old&&old.after===item.after&&old.cause===item.cause)continue;
    proposals.push(item);
  }
  for(const item of proposals.sort((a,b)=>a.floor-b.floor)){
    // Conflicting answers for one key/floor are not last-row-wins.
    if(proposals.some(p=>p.key===item.key&&p.floor===item.floor&&JSON.stringify(p)!==JSON.stringify(item))){rejected++;continue;}
    const old=items.get(item.key);if(old&&old.floor>item.floor)continue;
    if(earlierStoryTime(old?.timeAnchor?.storyTime??old?.storyTime,item.storyTime)){rejected++;continue;}
    if(!item.storyTime&&(old?.timeAnchor||old?.storyTime))item.timeAnchor=clone(old.timeAnchor??{storyTime:old.storyTime,floor:old.floor});
    item.origin=old?.origin??item.origin;
    // One bounded first-recorded turning point, not an accumulating event log.
    // Preserve unknown causes as unknown; don't replace them with recent trivia.
    const start=old?.originChange??old??item;
    item.originChange=clone({floor:start.floor,cause:start.cause??'',evidence:start.evidence??''});
    items.set(item.key,item);
  }
  return {items:[...items.values()],rejected};
}

export function personaDevelopmentText(items){
  const current=items.filter(e=>e.phase!=='historical');
  if(!current.length)return '';
  // Group by the person this character is reacting to. The dossier is about
  // attitudes toward people; the full event trail stays in memory records.
  const groups=new Map();
  for(const e of [...current].sort((a,b)=>b.floor-a.floor)){const key=e.target||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
  const lines=[...groups].map(([target,rows])=>[
    target?`▶ 对${target}`:'▶ 对所有人或自身',
    ...rows.map(e=>[
      `${e.topic}${e.scope?' · '+e.scope:''}（第${e.floor}楼${e.storyTime?'；'+e.storyTime:''}）：${e.after}`,
      e.cause?`转变缘由：${e.cause}`:'',
      e.originChange?.cause&&e.originChange.floor!==e.floor?`最早的转折（第${e.originChange.floor}楼，已过去）：${e.originChange.cause}`:'',
    ].filter(Boolean).join('\n')),
  ].join('\n'));
  return '【对各人物的当前态度 · 按对象区分；这里只写现在仍有效的态度、边界和表达】\n'+lines.join('\n\n');
}
