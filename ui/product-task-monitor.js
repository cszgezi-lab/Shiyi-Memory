import { taskMonitorText } from '../src/product-task-monitor.js';

export function taskMonitorHTML(){
 return `<section class="sy-task-monitor" data-task-monitor aria-label="当前任务"><div class="sy-task-head"><strong data-task-current role="status" aria-live="polite">当前没有运行任务</strong><button type="button" data-task-stop hidden>强制停止</button></div><p class="sy-help" data-task-automatic></p><div class="sy-task-meta sy-help"><span data-task-next></span><span data-task-manual></span></div><details data-task-queue hidden><summary data-task-queue-title>等待接口的请求</summary><ul data-task-requests></ul></details></section>`;
}

export function mountTaskMonitor({panel,app,run}){
 const root=panel.querySelector('[data-task-monitor]');if(!root)return {paint(){}};
 const $=selector=>root.querySelector(selector),stop=$('[data-task-stop]');let stopping=false,lastMonitor={};
 function paint(monitor={}){
  lastMonitor=monitor;const text=taskMonitorText(monitor);
  for(const [selector,value]of [['[data-task-current]',text.current],['[data-task-automatic]',text.automatic],['[data-task-next]',text.next],['[data-task-manual]',text.manualPending],['[data-task-queue-title]',text.queueTitle]]){
   const node=$(selector);if(node.textContent!==value)node.textContent=value;node.hidden=!value;
  }
  stop.hidden=!text.canStop&&!stopping;stop.disabled=stopping;stop.textContent=stopping?'正在停止…':'强制停止';stop.setAttribute('aria-busy',String(stopping));
  $('[data-task-queue]').hidden=!text.requests.length;
  const list=$('[data-task-requests]');
  if(list.dataset.content!==JSON.stringify(text.requests)){
   list.replaceChildren(...text.requests.map(value=>{const row=root.ownerDocument.createElement('li');row.textContent=value;return row;}));list.dataset.content=JSON.stringify(text.requests);
  }
 }
 stop.addEventListener('click',async()=>{
  if(stopping||!taskMonitorText(lastMonitor).canStop)return;
  stopping=true;paint(lastMonitor);
  try{await run(()=>app.stop(),{name:'stop',button:stop});}finally{stopping=false;paint(app.readViewState?.().taskMonitor??app.state?.taskMonitor??{});}
 });
 return {paint};
}
