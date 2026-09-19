import {ShiyiError} from './errors.js';
import {sha256,stableStringify} from './utils.js';
import {scheduleDeadline} from './request-deadline.js';

// Plugin-local, not a hook on the host's chat or global fetch. Never persist
// the scope (which is a digest of the origin and credential headers).
export function providerQueueScope(url,headers){
  const auth=Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v])
    .filter(([k])=>!['content-type','accept'].includes(k)).sort(([a],[b])=>a.localeCompare(b));
  return sha256(stableStringify([new URL(url).origin,auth]));
}

const canceled=()=>new ShiyiError('request canceled','CANCELED',{stage:'queue',reason:'canceled'});
// A logical task gets three retries, not three attempts. Safety/configuration
// failures require intervention; another model response may repair output shape.
export function backgroundRetryDelay(error, failures){
  const code=error?.code??'',d=error?.details??{},status=Number(d.status);
  if(d.recoveryExhausted===true)return 0;
  if(['content_blocked','context_limit'].includes(d.upstreamHint)||['insufficient_quota','invalid_api_key','api_key_missing','context_length_exceeded','model_not_found','invalid_request_error','outbound_host_denied'].includes(d.upstreamCode))return 0;
  if([400,401,403,404,413,422].includes(status))return 0;
  const retryable=[408,429,500,502,503,504].includes(status)||code.startsWith('network.')||['TIMEOUT','PROVIDER_REQUEST_FAILED','PERSONA_RESPONSE_INVALID','PERSONA_STAGE_CHANGED','SUMMARY_RESPONSE_ERROR','VALIDATION_ERROR','MODEL_OUTPUT_TRUNCATED'].includes(code);
  return retryable&&failures<=3?Math.max([60000,120000,300000][failures-1]??0,Number(d.retryAfterMs)||0):0;
}
// A service outage is not a bad record. Optional batch consumers persist the
// failed item, then leave unattempted items pending instead of probing each one.
export function shouldPauseProviderBatch(error){
  const status=Number(error?.details?.status),code=error?.code??'';
  return [401,403,408,429].includes(status)||status>=500&&status<=599||
    ['TIMEOUT','PROVIDER_REQUEST_FAILED','PROVIDER_FETCH_UNAVAILABLE','PROVIDER_PROFILE_INVALID','MODEL_UNAVAILABLE'].includes(code)||code.startsWith('network.');
}
export function createProviderScheduler({requestsPerMinute=()=>0,now=()=>Date.now(),schedule=scheduleDeadline}={}){
  const lanes=new Map();let disposed=false,foreground=false;
  function sweep(){for(const [key,lane] of lanes)if(!lane.active&&!lane.pending.length&&lane.cooldownUntil<=now()&&lane.starts.every(t=>t<=now()-60000)){lane.stop?.();lanes.delete(key);}}
  function pump(lane){
    lane.stop?.();lane.stop=null;
    lane.starts=lane.starts.filter(t=>t>now()-60000);
    if(disposed||!lane.pending.length)return;
    const rpm=Math.max(0,Math.floor(Number(requestsPerMinute())||0));
    const rateUntil=rpm&&lane.starts.length>=rpm?lane.starts[lane.starts.length-rpm]+60000:0;
    const until=Math.max(rateUntil,lane.cooldownUntil);
    const reason=foreground?'queue_foreground':lane.active?'queue_busy':until>now()?(lane.cooldownUntil>=rateUntil?'queue_cooldown':'queue_rpm'):null;
    if(reason){
      lane.pending.forEach((item,i)=>{
        const details={stage:'queue',reason,queuePosition:i+1,queueWaitMs:Math.max(0,now()-item.queuedAt),retryDelayMs:Math.max(0,until-now())};
        const signature=`${reason}:${i}:${until}`;
        if(item.notified!==signature){item.notified=signature;try{item.onWait?.(details);}catch{/* diagnostics cannot prevent dispatch */}}
      });
      if(!foreground&&!lane.active)lane.stop=schedule(Math.max(1,until-now()),()=>pump(lane));
      return;
    }
    const item=lane.pending.shift();item.signal?.removeEventListener('abort',item.abort);
    if(item.signal?.aborted){item.reject(canceled());pump(lane);return;}
    lane.active=true;lane.starts.push(now());let released=false;
    item.resolve({queueWaitMs:Math.max(0,now()-item.queuedAt),finish(error){
      if(released)return {};released=true;lane.active=false;
      const d=error?.details??{};
      const terminal=['context_limit','content_blocked'].includes(d.upstreamHint)||['insufficient_quota','invalid_api_key','api_key_missing','context_length_exceeded','model_not_found','invalid_request_error','outbound_host_denied'].includes(d.upstreamCode);
      const transient=!terminal&&([408,429,500,502,503,504].includes(d.status)||['network.timeout','network.connect_failed','network.body_interrupted','network.request_failed','TIMEOUT'].includes(error?.code));
      let retryDelayMs=0;
      if(transient){
        lane.failures=Math.min(lane.failures+1,5);
        retryDelayMs=Math.max(Math.min(60000,(d.status===429?10000:5000)*2**(lane.failures-1)),Number.isFinite(d.retryAfterMs)?Math.max(0,d.retryAfterMs):0);
        lane.cooldownUntil=Math.max(lane.cooldownUntil,now()+retryDelayMs);
      }else if(!error){lane.failures=0;lane.cooldownUntil=0;}
      pump(lane);
      return retryDelayMs?{retryDelayMs}:{};
    }});
    pump(lane);
  }
  return {
    setForeground(value){foreground=Boolean(value);for(const lane of lanes.values())pump(lane);},
    acquire(key,{signal,onWait}={}){
      if(disposed||signal?.aborted)return Promise.reject(canceled());
      sweep();
      let lane=lanes.get(key);
      if(!lane){lane={active:false,pending:[],starts:[],cooldownUntil:0,failures:0,stop:null};lanes.set(key,lane);}
      return new Promise((resolve,reject)=>{
        const item={signal,onWait,resolve,reject,queuedAt:now()};
        item.abort=()=>{const i=lane.pending.indexOf(item);if(i<0)return;lane.pending.splice(i,1);signal?.removeEventListener('abort',item.abort);reject(canceled());pump(lane);};
        signal?.addEventListener('abort',item.abort,{once:true});lane.pending.push(item);pump(lane);
      });
    },
    dispose(){disposed=true;for(const lane of lanes.values()){lane.stop?.();for(const item of lane.pending.splice(0)){item.signal?.removeEventListener('abort',item.abort);item.reject(canceled());}}lanes.clear();},
  };
}
