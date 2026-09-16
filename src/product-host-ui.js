/** Use TT's export runtime so Android saves through its native Downloads bridge. */
export async function exportProductJson(data, name, {
  host = globalThis, documentRef = globalThis.document,
  loadExporter = () => import('/scripts/file-export.js'),
} = {}) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  if (host?.__TAURITAVERN__?.api) {
    let downloadBlobWithRuntime;
    try{({downloadBlobWithRuntime}=await loadExporter());if(typeof downloadBlobWithRuntime!=='function')throw new Error('missing exporter');}
    catch(error){throw Object.assign(new Error('当前 TT 文件导出接口不可用；日志可使用“查看／复制文本”导出'),{code:'FILE_EXPORT_FAILED',details:{reason:'export_module_unavailable',causeError:error}});}
    // Never silently fall back to a Blob link when native export failed.
    try{return await downloadBlobWithRuntime(blob, name);}
    catch(error){
      const canceled=error?.name==='AbortError'||/cancel(?:led|ed)?|取消/i.test(String(error?.message??error));
      const denied=error?.name==='NotAllowedError'||/permission|denied|not allowed|权限/i.test(String(error?.message??error));
      throw Object.assign(new Error(canceled?'已取消文件导出':denied?'系统拒绝文件保存权限；日志可使用“查看／复制文本”':'宿主保存文件失败；日志可使用“查看／复制文本”'),{code:canceled?'CANCELED':'FILE_EXPORT_FAILED',details:{reason:denied?'export_permission_denied':'export_native_failed',causeError:error}});
    }
  }
  const url = URL.createObjectURL(blob), anchor = documentRef.createElement('a');
  try {
    anchor.href = url; anchor.download = name;
    documentRef.body.appendChild(anchor); anchor.click();
    return { mode: 'browser' };
  } finally {
    anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
