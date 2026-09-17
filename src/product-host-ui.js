function triggerBrowserExport(blob, name, documentRef) {
  if (!documentRef?.createElement || !documentRef?.body) throw new Error('TT 下载桥和浏览器导出接口均不可用');
  const url = URL.createObjectURL(blob), anchor = documentRef.createElement('a');
  try {
    anchor.href = url; anchor.download = name; documentRef.body.appendChild(anchor); anchor.click();
    return { mode: 'browser-fallback' };
  } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

/** Use TT's export runtime so Android saves through its native Downloads bridge. */
export async function exportProductJson(data, name, {
  host = globalThis, documentRef = globalThis.document,
  loadExporter = () => import('/scripts/file-export.js'),
} = {}) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  if (host?.__TAURITAVERN__?.api) {
    let downloadBlobWithRuntime;
    try{({downloadBlobWithRuntime}=await loadExporter());if(typeof downloadBlobWithRuntime!=='function')throw new Error('missing exporter');}
    catch(error){
      try{return {...triggerBrowserExport(blob,name,documentRef),nativeAttempt:'unavailable'};}
      catch(fallbackError){throw Object.assign(new Error('当前 TT 文件导出接口不可用；日志可使用“查看／复制文本”导出'),{code:'FILE_EXPORT_FAILED',details:{reason:'export_module_unavailable',causeError:error,fallbackError}});}
    }
    try{return await downloadBlobWithRuntime(blob, name);}
    catch(error){
      const canceled=error?.name==='AbortError'||/cancel(?:led|ed)?|取消/i.test(String(error?.message??error));
      const denied=error?.name==='NotAllowedError'||/permission|denied|not allowed|权限/i.test(String(error?.message??error));
      if(canceled)throw Object.assign(new Error('已取消文件导出'),{code:'CANCELED',details:{reason:'canceled',causeError:error}});
      if(denied)throw Object.assign(new Error('系统拒绝文件保存权限；日志可使用“查看／复制文本”'),{code:'FILE_EXPORT_FAILED',details:{reason:'export_permission_denied',causeError:error}});
      // Some TT builds install the native download bridge on anchor clicks
      // even when the directly imported exporter is unavailable or rejects.
      // Give that host-owned path one explicit retry, but report it as a
      // fallback hand-off rather than pretending the file was already saved.
      try{return {...triggerBrowserExport(blob,name,documentRef),nativeAttempt:'failed'};}
      catch(fallbackError){
        throw Object.assign(new Error('宿主保存文件失败；日志可使用“查看／复制文本”'),{code:'FILE_EXPORT_FAILED',details:{reason:'export_native_failed',causeError:error,fallbackError}});
      }
    }
  }
  return triggerBrowserExport(blob,name,documentRef);
}
