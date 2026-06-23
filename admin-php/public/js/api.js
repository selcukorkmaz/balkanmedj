/**
 * API Client — fetch wrapper for admin panel.
 */
// Base path the admin panel is served under (e.g. "/yonetim"), set in index.html
// / login.html. Empty string when the panel is hosted at a domain root.
const API_BASE = (typeof window !== 'undefined' && window.__BASE__) ? window.__BASE__ : '';

function handleAuthError(res) {
  if (res.status === 401) {
    window.location.href = API_BASE + '/login';
    throw new Error('Oturum süresi doldu');
  }
}

// Safely parse a response that the server promised would be JSON. If the
// body is not JSON (e.g. server returned a 404 HTML page because the request
// hit a route that doesn't exist on this build, or the user has a stale
// app.js cached and is calling an old endpoint), give the caller a clear,
// actionable error instead of the cryptic native JSON.parse message.
async function parseJsonResponse(res, url) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();
  if (ct.includes('application/json')) {
    try { return JSON.parse(text); }
    catch (err) {
      throw new Error(`Sunucu bozuk JSON döndürdü (${url}). Detay: ${err.message}`);
    }
  }
  // Non-JSON response. Most common cause: 404 HTML because the endpoint was
  // removed/renamed and the browser is running a cached older app.js — a
  // hard refresh (Ctrl+Shift+R) usually fixes it.
  const hint = text.trimStart().startsWith('<')
    ? 'Sunucu beklenmeyen HTML yanıtı döndürdü. Tarayıcınız büyük olasılıkla eski bir admin paneli sürümünü kullanıyor — Ctrl+Shift+R ile sayfayı yenileyin.'
    : `Sunucu beklenmeyen yanıt döndürdü (HTTP ${res.status}).`;
  // Surface the first bit of the body for diagnostics but keep it short.
  const preview = text.slice(0, 120).replace(/\s+/g, ' ').trim();
  throw new Error(`${hint}${preview ? ` [${preview}${text.length > 120 ? '…' : ''}]` : ''}`);
}

async function readErrorMessage(res, url) {
  // For !res.ok responses, try to extract a meaningful message even if the
  // body isn't JSON. Never let JSON.parse blow up here.
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();
  if (ct.includes('application/json')) {
    try { return JSON.parse(text).error || res.statusText; } catch { /* fall through */ }
  }
  if (text.trimStart().startsWith('<')) {
    if (res.status === 404) {
      return `Sunucuda bu işlem rotası bulunamadı (${url}). Admin sunucusu eski kodla çalışıyor olabilir; admin sunucusunu kapatıp yeniden başlatın.`;
    }
    return `Sunucu beklenmeyen HTML yanıtı döndürdü (HTTP ${res.status}, ${url}).`;
  }
  return text.slice(0, 200) || res.statusText;
}

const API = {
  async get(url) {
    const res = await fetch(`${API_BASE}/api${url}`);
    handleAuthError(res);
    if (!res.ok) throw new Error(await readErrorMessage(res, url));
    return parseJsonResponse(res, url);
  },

  async post(url, data) {
    const res = await fetch(`${API_BASE}/api${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    handleAuthError(res);
    if (!res.ok) throw new Error(await readErrorMessage(res, url));
    return parseJsonResponse(res, url);
  },

  async put(url, data) {
    const res = await fetch(`${API_BASE}/api${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    handleAuthError(res);
    if (!res.ok) throw new Error(await readErrorMessage(res, url));
    return parseJsonResponse(res, url);
  },

  async del(url) {
    const res = await fetch(`${API_BASE}/api${url}`, { method: 'DELETE' });
    handleAuthError(res);
    if (!res.ok) throw new Error(await readErrorMessage(res, url));
    return parseJsonResponse(res, url);
  },

  async uploadFile(url, file, fieldName = 'xml', extraFields = {}) {
    const form = new FormData();
    form.append(fieldName, file);
    for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
    const res = await fetch(`${API_BASE}/api${url}`, { method: 'POST', body: form });
    handleAuthError(res);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  },

  async uploadFiles(url, files, fieldName = 'xml') {
    const form = new FormData();
    // Use "[]" so PHP receives an array of files (multiple same-named fields
    // without brackets are collapsed to the last one by PHP).
    for (const file of files) form.append(fieldName + '[]', file);
    const res = await fetch(`${API_BASE}/api${url}`, { method: 'POST', body: form });
    handleAuthError(res);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  },

  // Like uploadFile but uses XHR so the caller can track byte-level upload progress.
  // onProgress is called as (percent, loaded, total).
  uploadFileWithProgress(url, file, fieldName = 'xml', extraFields = {}, onProgress) {
    const form = new FormData();
    form.append(fieldName, file);
    for (const [k, v] of Object.entries(extraFields)) form.append(k, v);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api${url}`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || !onProgress) return;
        onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          window.location.href = API_BASE + '/login';
          reject(new Error('Oturum süresi doldu'));
          return;
        }
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || xhr.statusText || 'Yükleme hatası'));
      };
      xhr.onerror = () => reject(new Error('Ağ hatası'));
      xhr.send(form);
    });
  },

  // Multi-file variant of uploadFileWithProgress.
  // onProgress is called as (percent, loaded, total).
  uploadFilesWithProgress(url, files, fieldName = 'xml', extraFields = {}, onProgress) {
    const form = new FormData();
    // "[]" so PHP receives an array of files (see uploadFiles note).
    for (const file of files) form.append(fieldName + '[]', file);
    for (const [k, v] of Object.entries(extraFields)) form.append(k, v);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api${url}`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || !onProgress) return;
        onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          window.location.href = API_BASE + '/login';
          reject(new Error('Oturum süresi doldu'));
          return;
        }
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || xhr.statusText || 'Yükleme hatası'));
      };
      xhr.onerror = () => reject(new Error('Ağ hatası'));
      xhr.send(form);
    });
  },
};
