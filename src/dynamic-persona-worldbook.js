import {clone,sha256} from './utils.js';
import {mvuContext,readMvu} from './product-custom-modules.js';
import {personaSpans,replacePersonaSpans} from './dynamic-persona-stage.js';

export function createPersonaWorldbook({host=globalThis,check=()=>{}}={}){
  const markers=new Map();
  const api=()=>host.TavernHelper??host;
  async function stageData(){if(!host.Mvu?.getMvuData)return {};const result=await readMvu(host,check);return result.data??{};}
  async function read(){
    check();const h=api(),context=mvuContext(host)??{},card=context.characters?.[context.characterId];
    const cardName=card?.name??context.name2??'当前角色卡';
    if(typeof h.getCharWorldbookNames!=='function'||typeof h.getWorldbook!=='function')return {cardName,entries:[],spans:[],status:'unavailable'};
    const binding=await h.getCharWorldbookNames('current');check();
    const chat=await h.getChatWorldbookName?.('current');check();
    const names=[...new Set([binding?.primary,...(binding?.additional??[]),chat].filter(Boolean))];
    const entries=[];
    for(const book of names){const rows=await h.getWorldbook(book);check();for(const row of rows){if(row.extra?.shiyiDynamicPersona)continue;entries.push({book,uid:row.uid,name:row.name??'',enabled:row.enabled!==false,content:String(row.content??'')});}}
    const data=await stageData();check();
    return {cardName,entries,spans:entries.filter(e=>e.enabled).flatMap(e=>personaSpans(e,data)),status:'ready'};
  }
  // A separate, disabled mirror is inspectable in the world's editor, but is
  // not bound globally or to the chat: the request hook is its only injector.
  async function mirror(scope,profiles,cardName){
    check();const h=api();if(!h.getWorldbookNames||!h.createWorldbook||!h.replaceWorldbook||!h.getWorldbook)return {status:'unavailable'};
    const owner=sha256(scope),name=`${cardName}＋角色模块·${owner.slice(0,10)}`;
    const names=await h.getWorldbookNames();check();
    if(names.includes(name)){const old=await h.getWorldbook(name);check();if(old.some(e=>e.extra?.shiyiDynamicPersona!==owner))throw new Error('同名世界书含用户条目，未覆盖');}
    else {await h.createWorldbook(name,[]);check();}
    const entries=profiles.filter(p=>!p.deleted).map((p,i)=>({uid:i,name:p.name,enabled:false,content:p.text,extra:{shiyiDynamicPersona:owner,profileId:p.id,through:p.through,stage:p.stage},strategy:{type:'constant',keys:[],keys_secondary:{logic:'and_any',keys:[]},scan_depth:'same_as_global'},position:{type:'before_character_definition',role:'system',depth:0,order:100},probability:100,recursion:{prevent_incoming:true,prevent_outgoing:true,delay_until:null},effect:{sticky:null,cooldown:null,delay:null}}));
    await h.replaceWorldbook(name,entries);check();const saved=await h.getWorldbook(name);check();
    if(saved.length!==entries.length||entries.some(e=>!saved.some(s=>s.extra?.profileId===e.extra.profileId&&s.content===e.content&&s.enabled===false)))throw new Error('动态世界书读回不一致；聊天档案仍保留');
    return {status:'saved',name};
  }
  async function applyLoaded(payload,profiles){
    if(!payload||typeof payload!=='object'||!profiles.length)return;
    const data=await stageData();check();
    for(const key of ['globalLore','characterLore','chatLore','personaLore']){
      if(!Array.isArray(payload[key]))continue;
      // Never mutate the host's cached entry objects.
      const entries=payload[key],updated=entries.map(entry=>{
        const book=entry.world??entry.book,uid=entry.uid;
        const spans=personaSpans({book,uid,name:entry.comment??entry.name,content:entry.content},data),replacements={};
        for(const p of profiles)for(const span of spans)if(p.bindings?.some(b=>b.id===span.id&&b.hash===span.hash&&b.stage===span.stage)){
          const key=`${p.id}:${span.id}`;markers.set(key,span.text);replacements[span.id]=`\n[[SHIYI_PERSONA:${key}]]\n`;
        }
        return Object.keys(replacements).length?{...clone(entry),content:replacePersonaSpans(entry.content,spans,replacements)}:entry;
      });
      // SillyTavern retains these array references after emitting the event.
      // Replace elements, not payload properties; entry objects remain cloned.
      for(let i=0;i<entries.length;i++)entries[i]=updated[i];
    }
  }
  async function finalize(payload,profiles){
    if(!Array.isArray(payload?.messages))return;
    if(!payload.messages.some(m=>typeof m.content==='string'&&m.content.includes('[[SHIYI_PERSONA:')))return {injected:[]};
    let data;try{data=await stageData();check();}catch{data=null;}
    const valid=profiles.filter(p=>p.bindings?.length&&p.bindings.every(b=>b.stage==='static'||data&&personaSpans({book:b.book,uid:b.uid,name:b.name,content:b.entryContent},data).some(s=>s.id===b.id))),byId=new Map(valid.map(p=>[p.id,p])),used=new Set();
    for(const m of payload.messages)if(typeof m.content==='string')m.content=m.content.replace(/\[\[SHIYI_PERSONA:([a-f0-9]+):([a-f0-9]+)\]\]/g,(_all,id,spanId)=>{
      const p=byId.get(id),key=`${id}:${spanId}`;if(!p)return markers.get(key)??'';if(used.has(id))return '';used.add(id);return `【${p.name}·当前阶段人设，依据至 #${p.through}；更新楼层后的正文优先】\n${p.text}`;
    });
    if(markers.size>1000)markers.clear();
    return {injected:[...used]};
  }
  return {read,mirror,applyLoaded,stageData,finalize};
}
