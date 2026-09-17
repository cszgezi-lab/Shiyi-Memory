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
  // A throwable from the Android @JavascriptInterface save method comes from the
  // native Downloads write itself; no other step in that bridge can throw at the
  // host level, so this is the MediaStore publish step.
  if (isHostExceptionError(error)) return 'publish_failed';
  if (/Export staging file not found|staging file/i.test(text)) return 'file_missing';
  if (/mkdir|app cache directory|staging directory|readable stream is required|unsupported binary chunk|blob payload is required/i.test(text)) return 'staging_failed';
  if (/did not return a saved path|Failed to create public Downloads entry|Failed to publish public Downloads entry|IS_PENDING|MediaStore/i.test(text)) return 'publish_failed';
  if (/Failed to copy export file|copyFileToContentUri|openOutputStream|Failed to open/i.test(text)) return 'write_failed';
  if (/Export source file is outside|Export filename must not contain/i.test(text)) return 'write_failed';
  return null;
}
/** Forward every attribution field the caller passed. Destructuring a fixed key
 * list here silently dropped exportAttempt / exportBytes / hostOperations, so
 * the thrown error lost exactly the diagnostics that identify the failing step. */
const exportFailure = (message, reason, details = {}) => {
  const { causeError, fallbackError, ...rest } = details;
  return Object.assign(new Error(message), {
    code: 'FILE_EXPORT_FAILED',
    details: { ...rest, reason, ...(causeError ? { causeError } : {}), ...(fallbackError ? { fallbackError } : {}) },
  });
};
/** TT's runtime returns camelCase (`savedPath`/`displayName`); a raw bridge
 * answer uses snake_case (`saved_path`/`display_name`). Accept both so a
 * successful save is never misread as unconfirmed. */
function normalizeExportResult(result) {
  if (!result || typeof result !== 'object') return result;
  const savedPath = result.savedPath ?? result.saved_path;
  const displayName = result.displayName ?? result.display_name;
  const mimeType = result.mimeType ?? result.mime_type;
  return {
    ...result,
    ...(savedPath ? { savedPath } : {}),
    ...(displayName ? { displayName } : {}),
    ...(mimeType ? { mimeType } : {}),
    uri: result.uri ?? '',
  };
}
function confirmedExport(result) {
  const value = normalizeExportResult(result);
  if (!value || typeof value !== 'object') return false;
  if (value.mode === 'mobile-native' || value.mode === 'android-document-picker') return Boolean(String(value.savedPath ?? '').trim() || String(value.uri ?? '').trim());
  if (value.mode === 'ios-native-share') return value.completed === true;
  if (value.mode === 'browser') return true;
  // No mode: a raw bridge answer that reports a saved location is still a save.
  return Boolean(String(value.savedPath ?? '').trim() || String(value.uri ?? '').trim()) && Boolean(value.displayName ?? value.savedPath ?? value.uri);
}
function dispatchOnly(result) {
  if (result?.mode === 'ios-native-share') return result.completed === false ? 'canceled' : 'share-unconfirmed';
  return 'browser-fallback';
}
const saveLocationOf = result => normalizeExportResult(result)?.mode === 'android-document-picker' || result?.savedPath === ''&&Boolean(result?.uri) ? '你选择的保存位置' : '手机 Downloads';
/** TT on Android can save two ways: the direct public-Downloads bridge, or the
 * system file picker plus a copy into the chosen document.  A device where one
 * is broken can still export through the other, so a failed direct save gets one
 * explicit picker attempt instead of only a text fallback. */
async function withDocumentPickerFallback(downloadBlobWithRuntime, blob, name, host, timeoutMs = 30000) {
  const bridge = host?.[BRIDGE_NAME];
  if (!bridge || typeof bridge.copyFileToContentUri !== 'function' || typeof bridge.requestCreateDocumentPicker !== 'function') return null;
  const direct = bridge.supportsDirectPublicDownloads;
  bridge.supportsDirectPublicDownloads = () => false;
  try { return { result: await withExportTimeout(downloadBlobWithRuntime(blob, name), timeoutMs) }; }
  catch (error) { return { error }; }
  finally { if (direct === undefined) delete bridge.supportsDirectPublicDownloads; else bridge.supportsDirectPublicDownloads = direct; }
}

const BRIDGE_NAME = 'TauriTavernAndroidPublicDownloadBridge';
/** Record which TT host operation the export actually reached, so a native
 * failure can be attributed to a specific step without storing any path, host
 * text or payload.  The direct public-Downloads save and the document-picker
 * copy fail for different reasons; this tells them apart. */
const BRIDGE_OPERATIONS = ['saveFileToDownloads', 'requestCreateDocumentPicker', 'copyFileToContentUri'];
function trackHostOperations(bridge, onError) {
  if (!bridge || typeof bridge !== 'object') return;
  for (const key of BRIDGE_OPERATIONS) {
    const original = bridge[key];
    if (typeof original !== 'function') continue;
    bridge[key] = function tracked(...args) {
      try { return original.apply(bridge, args); }
      catch (error) { try { onError(key, error); } catch { /* attribution must not mask the host error */ } throw error; }
    };
  }
}
/** Reject a promise if the host never answers, so a save that silently never
 * completes is reported instead of leaving the UI waiting forever. */
function withExportTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('宿主导出在限定时间内没有返回结果'), { code: 'TIMEOUT' })), timeoutMs); timer?.unref?.(); }),
  ]);
}

/** Use TT's export runtime so Android saves through its native Downloads bridge.
 * Resolution contract: the promise only resolves when the host itself confirmed
 * a save (`saved:true`); every other outcome resolves as `status:'dispatched'`
 * (the payload was handed to a host path that cannot confirm storage) or rejects
 * with a classified FILE_EXPORT_FAILED / CANCELED error. */
export async function exportProductJson(data, name, {
  host = globalThis, documentRef = globalThis.document,
  loadExporter = () => import('/scripts/file-export.js'),
  timeoutMs = 30000,
} = {}) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  if (host?.__TAURITAVERN__?.api) {
    let downloadBlobWithRuntime;
    try{({downloadBlobWithRuntime}=await loadExporter());if(typeof downloadBlobWithRuntime!=='function')throw new Error('missing exporter');}
    catch(error){
      try{return {...triggerBrowserExport(blob,name,documentRef),nativeAttempt:'unavailable',reason:'export_module_unavailable',stage:'export_load'};}
      catch(fallbackError){throw exportFailure('当前 TT 文件导出接口不可用；日志可使用“查看／复制文本”导出','export_module_unavailable',{stage:'exporter_load',causeError:error,fallbackError});}
    }
    const bridge = host[BRIDGE_NAME];
    const observed = [];
    // Attribution must never mask the real host failure: a bug while recording
    // the failing operation is swallowed, not rethrown over the host error.
    trackHostOperations(bridge, (operation, error) => {
      try { if (observed.length < 8) observed.push({ operation, reason: saveStageOf(error) ?? 'unclassified', errorType: error?.name }); }
      catch { /* diagnostics only */ }
    });
    const exportDiagnostics = extra => ({ ...extra, exportBytes: blob.size, ...(observed.length ? { hostOperations: observed } : {}) });
    let attempt;
    try{
      attempt = await withExportTimeout(downloadBlobWithRuntime(blob, name), timeoutMs);
    }
    catch(error){
      const saveStage=saveStageOf(error);
      if(isCancelError(error))throw Object.assign(new Error('已取消文件导出'),{code:'CANCELED',details:exportDiagnostics({reason:'canceled',...(saveStage?{saveStage}:{}),causeError:error})});
      if(isPermissionError(error))throw exportFailure('系统拒绝文件保存权限；日志可使用“查看／复制文本”','export_permission_denied',{stage:'export_save_publish',saveStage,exportAttempt:'direct',...exportDiagnostics({causeError:error})});
      // The direct public-Downloads save failed.  Try the system picker before
      // giving up: it writes through a user-chosen document URI instead of the
      // MediaStore Downloads collection that just failed, so a device where only
      // the direct path is broken can still export a file.
      const fallback = await withDocumentPickerFallback(downloadBlobWithRuntime, blob, name, host, timeoutMs);
      if (fallback) {
        if (!fallback.error && confirmedExport(fallback.result)) return {...normalizeExportResult(fallback.result),status:'saved',saved:true,exportAttempt:'picker',saveLocation:'你选择的保存位置',directFailure:true};
        if (isCancelError(fallback.error)) throw Object.assign(new Error('已取消文件导出'),{code:'CANCELED',details:exportDiagnostics({reason:'canceled',exportAttempt:'picker',causeError:fallback.error})});
      }
      const hostError = fallback?.error ?? error;
      const failedStage = saveStageOf(hostError) ?? saveStage;
      const exportAttempt = fallback ? 'picker_failed' : 'direct';
      const details = exportDiagnostics({stage:'export_save_publish',saveStage:failedStage,exportAttempt,causeError:hostError});
      if (isHostExceptionError(error)) {
        throw exportFailure(fallback ? '宿主的原生下载接口抛出 Java 异常，备用保存通道也没能确认文件已保存；请改用“查看／复制文本”导出' : '宿主的原生下载接口抛出 Java 异常，本次没有确认文件已保存；请改用“查看／复制文本”导出','export_host_exception',{...details,saveStage:saveStage??failedStage,causeError:error});
      }
      if (isHostExceptionError(hostError)) throw exportFailure('宿主的原生下载接口抛出 Java 异常，备用保存通道也没能确认文件已保存；请改用“查看／复制文本”导出','export_host_exception',details);
      // A missing staging file means the failed step is known before the bridge
      // call; report it as its own reason instead of a generic native failure.
      if (failedStage==='file_missing') throw exportFailure('宿主找不到本次导出的暂存文件，文件没有保存；请改用“查看／复制文本”导出','export_stage_file_missing',{...details,stage:'export_save_verify'});
      // A picker attempt that also failed is a definite failure: the anchor path
      // cannot help on Android, so do not degrade it into a vague "dispatched".
      if (fallback) throw exportFailure('宿主直存和系统文件选择器都没能保存文件；请改用“查看／复制文本”导出','export_native_failed',details);
      // A generic native failure without a picker channel cannot be confirmed as
      // a save.  Offer the host-owned dispatch path when it exists, but report it
      // as unconfirmed rather than pretending the file was stored.
      try{return {...triggerBrowserExport(blob,name,documentRef),nativeAttempt:'failed',reason:'export_native_failed',stage:'export_save_publish',...(failedStage?{saveStage:failedStage}:{}),exportAttempt,status:'dispatched',saved:false,dispatch:'browser-fallback'};}
      catch(fallbackError){throw exportFailure('宿主保存文件失败；本次没有确认文件已保存，可复制文本导出','export_native_failed',{...details,fallbackError});}
    }
    if(confirmedExport(attempt))return {...normalizeExportResult(attempt),status:'saved',saved:true,exportAttempt:'direct',saveLocation:saveLocationOf(attempt),...exportDiagnostics({})};
    return {...normalizeExportResult(attempt),status:'dispatched',saved:false,exportAttempt:'direct',reason:'export_dispatched_unconfirmed',dispatch:dispatchOnly(attempt),...exportDiagnostics({})};
  }
  return {...triggerBrowserExport(blob,name,documentRef),reason:'export_dispatched_unconfirmed',stage:'export_dispatch',exportAttempt:'browser',dispatch:'browser-fallback'};
}
