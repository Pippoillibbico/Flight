export function openJsonPayloadInNewTab(payload, options = {}) {
  if (!payload) return false;
  const windowObject = options.windowObject ?? (typeof window !== 'undefined' ? window : null);
  if (!windowObject || typeof windowObject.open !== 'function') return false;

  const urlApi = options.urlApi ?? (typeof URL !== 'undefined' ? URL : null);
  if (!urlApi || typeof urlApi.createObjectURL !== 'function' || typeof urlApi.revokeObjectURL !== 'function') {
    return false;
  }

  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = urlApi.createObjectURL(blob);
  const revokeAfterMs = Number(options.revokeAfterMs) > 0 ? Number(options.revokeAfterMs) : 60_000;

  windowObject.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => urlApi.revokeObjectURL(url), revokeAfterMs);
  return true;
}

export function downloadTextFile(content, filename, options = {}) {
  if (!filename) return false;

  const documentObject = options.documentObject ?? (typeof document !== 'undefined' ? document : null);
  if (!documentObject || !documentObject.body || typeof documentObject.createElement !== 'function') return false;

  const urlApi = options.urlApi ?? (typeof URL !== 'undefined' ? URL : null);
  if (!urlApi || typeof urlApi.createObjectURL !== 'function' || typeof urlApi.revokeObjectURL !== 'function') {
    return false;
  }

  const mimeType = String(options.mimeType || 'text/plain;charset=utf-8');
  const blob = new Blob([String(content ?? '')], { type: mimeType });
  const url = urlApi.createObjectURL(blob);
  const link = documentObject.createElement('a');

  try {
    link.href = url;
    link.download = String(filename);
    documentObject.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    urlApi.revokeObjectURL(url);
  }

  return true;
}
