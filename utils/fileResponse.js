// Safe headers for files people uploaded: any file name (accents, Arabic, quotes, line breaks)
// becomes a valid Content-Disposition instead of crashing the response.
export function safeDownloadName(name, fallback = 'document') {
  const cleaned = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function contentDispositionHeader(type, name) {
  const fileName = safeDownloadName(name);
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/[\\;]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function sendStoredFile(res, result) {
  if (result.body || !result.file) {
    return res.status(result.status || 500).json(result.body || { success: false, message: 'Failed to load document' });
  }
  const { buffer, contentType, fileName, contentLength, cacheControl } = result.file;
  res.setHeader('Content-Type', contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDispositionHeader('inline', fileName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cacheControl || 'private, no-store');
  if (contentLength != null) res.setHeader('Content-Length', String(contentLength));
  return res.status(200).send(buffer);
}
