function triggerBrowserExport(blob, name, documentRef) {
  if (!documentRef?.createElement || !documentRef?.body) throw new Error('TT 下载桥和浏览器导出接口均不可用');
  const url = URL.createObjectURL(blob), anchor = documentRef.createElement('a');
  try {
    anchor.href = url; anchor.download = name; documentRef.body.appendChild(anchor); anchor.click();
    // An anchor click only hands the payload to the host/browser download path.
    // It never proves that a file reached storage, so this result is reported as
    // "已派发" and can never be promoted to a save confirmation.
    return { mode: 'browser-fallback', status: 'dispatched', saved: false };
  } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

/** The TT Android bridge is an addJavascriptInterface method: when the Java
 * method throws, WebView surfaces the throwable itself. Recognize that shape so
 * a native Java failure can never be reported as a normal dispatchable error. */
function isHostExceptionError(error) {
  const name = String(error?.name ?? '');
  const text = `${String(error?.message ?? '')} ${String(error ?? '')}`;
  return /JavaException|Java exception was raised|Error invoking \w+|java\.lang\.|android\.(?:os|content|system)\.\w*(?:Exception|Error)/i.test(text)
    || /JavaException/i.test(name);
}
function messageOf(error) { return `${String(error?.name ?? '')} ${String(error?.message ?? '')} ${String(error ?? '')}`; }
function isCancelError(error) { return error?.name === 'AbortError' || /cancel(?:led|ed)?|取消/i.test(messageOf(error)); }
function isPermissionError(error) {
  return /NotAllowedError|SecurityException/i.test(String(error?.name ?? ''))
    || /permission|denied|not allowed|SecurityException|权限/i.test(messageOf(error));
}
/** Name the exact step that failed inside TT's Android export pipeline without
 * ever storing a path or host message. The official file-export.js resolves the
 * staging file before it talks to the MediaStore bridge, so its own thrown
 * texts identify the stage reliably. */
function saveStageOf(error) {
  const text = messageOf(error);
  if (/Export staging file not found|staging file/i.test(text)) return 'file_missing';
  if (/mkdir|app cache directory|staging directory|readable stream is required|unsupported binary chunk|blob payload is required/i.test(text)) return 'staging_failed';
  if (/did not return a saved path|Failed to create public Downloads entry|Failed to publish public Downloads entry|IS_PENDING|MediaStore/i.test(text)) return 'publish_failed';
  if (/Failed to copy export file|copyFileToContentUri|openOutputStream|Failed to open/i.test(text)) return 'write_failed';
  if (/Export source file is outside|Export filename must not contain/i.test(text)) return 'write_failed';
  return null;
}
const exportFailure = (message, reason, { stage, saveStage, causeError, fallbackError } = {}) => Object.assign(
  new Error(message),
  { code: 'FILE_EXPORT_FAILED', details: { stage, ...(saveStage ? { saveStage } : {}), reason, ...(causeError ? { causeError } : {}), ...(fallbackError ? { fallbackError } : {}) } },
);
function confirmedExport(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.mode === 'mobile-native') return Boolean(String(result.savedPath ?? '').trim() || String(result.uri ?? '').trim());
  if (result.mode === 'ios-native-share') return result.completed === true;
  if (result.mode === 'browser') return true;
  return false;
}
function dispatchOnly(result) {
  if (result?.mode === 'ios-native-share') return result.completed === false ? 'canceled' : 'share-unconfirmed';
  return 'browser-fallback';
}

/** Use TT's export runtime so Android saves through its native Downloads bridge.
 * Resolution contract: the promise only resolves when the host itself confirmed
 * a save (`saved:true`, mode mobile-native/ios-native-share/browser); every
 * other outcome resolves as `status:'dispatched'` (the payload was handed to a
 * host path that cannot confirm storage) or rejects with a classified
 * FILE_EXPORT_FAILED / CANCELED error. */
export async function exportProductJson(data, name, {
  host = globalThis, documentRef = globalThis.document,
  loadExporter = () => import('/scripts/file-export.js'),
} = {}) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  if (host?.__TAURITAVERN__?.api) {
    let downloadBlobWithRuntime;
    try{({downloadBlobWithRuntime}=await loadExporter());if(typeof downloadBlobWithRuntime!=='function')throw new Error('missing exporter');}
    catch(error){
      try{return {...triggerBrowserExport(blob,name,documentRef),nativeAttempt:'unavailable',reason:'export_module_unavailable',stage:'export_load'};}
      catch(fallbackError){throw exportFailure('当前 TT 文件导出接口不可用；日志可使用“查看／复制文本”导出','export_module_unavailable',{stage:'exporter_load',causeError:error,fallbackError});}
    }
    try{
      const result=await downloadBlobWithRuntime(blob, name);
      if(confirmedExport(result))return {...result,status:'saved',saved:true};
      return {...result,status:'dispatched',saved:false,reason:'export_dispatched_unconfirmed',dispatch:dispatchOnly(result)};
    }
    catch(error){
      const saveStage=saveStageOf(error);
      if(isCancelError(error))throw Object.assign(new Error('已取消文件导出'),{code:'CANCELED',details:{reason:'canceled',...(saveStage?{saveStage}:{}),causeError:error}});
      if(isPermissionError(error))throw exportFailure('系统拒绝文件保存权限；日志可使用“查看／复制文本”','export_permission_denied',{stage:'export_save_publish',saveStage,causeError:error});
      if(isHostExceptionError(error))throw exportFailure('宿主的原生下载接口抛出 Java 异常，本次没有确认文件已保存；请改用“查看／复制文本”导出','export_host_exception',{stage:'export_save_publish',saveStage,causeError:error});
      // A missing staging file means the failed step is known before the bridge
      // call; report it as its own reason instead of a generic native failure.
      if(saveStage==='file_missing')throw exportFailure('宿主找不到本次导出的暂存文件，文件没有保存；请改用“查看／复制文本”导出','export_stage_file_missing',{stage:'export_save_verify',saveStage,causeError:error});
      // A generic native failure cannot be confirmed as a save.  Offer the
      // host-owned dispatch path when it exists, but report it as unconfirmed
      // rather than pretending the file was stored.
      try{return {...triggerBrowserExport(blob,name,documentRef),nativeAttempt:'failed',reason:'export_native_failed',stage:'export_save_publish',...(saveStage?{saveStage}:{}),status:'dispatched',saved:false,dispatch:'browser-fallback'};}
      catch(fallbackError){throw exportFailure('宿主保存文件失败；本次没有确认文件已保存，可复制文本导出','export_native_failed',{stage:'export_save_publish',saveStage,causeError:error,fallbackError});}
    }
  }
  return {...triggerBrowserExport(blob,name,documentRef),reason:'export_dispatched_unconfirmed',stage:'export_dispatch',dispatch:'browser-fallback'};
}
