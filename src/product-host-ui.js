/** Use TT's export runtime so Android saves through its native Downloads bridge. */
export async function exportProductJson(data, name, {
  host = globalThis, documentRef = globalThis.document,
  loadExporter = () => import('/scripts/file-export.js'),
} = {}) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  if (host?.__TAURITAVERN__?.api) {
    const { downloadBlobWithRuntime } = await loadExporter();
    if (typeof downloadBlobWithRuntime !== 'function') throw new Error('当前 TT 缺少文件导出接口，请使用 TT 2.2.0 或更新版本');
    // Never silently fall back to a Blob link when native export failed.
    return downloadBlobWithRuntime(blob, name);
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
