/**
 * API Client — fetch wrapper for admin panel.
 */
function handleAuthError(res) {
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Oturum süresi doldu');
  }
}

const API = {
  async get(url) {
    const res = await fetch(`/api${url}`);
    handleAuthError(res);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  },

  async post(url, data) {
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    handleAuthError(res);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  },

  async put(url, data) {
    const res = await fetch(`/api${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    handleAuthError(res);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  },

  async del(url) {
    const res = await fetch(`/api${url}`, { method: 'DELETE' });
    handleAuthError(res);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  },

  async uploadFile(url, file, fieldName = 'xml', extraFields = {}) {
    const form = new FormData();
    form.append(fieldName, file);
    for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
    const res = await fetch(`/api${url}`, { method: 'POST', body: form });
    handleAuthError(res);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return res.json();
  },

  async uploadFiles(url, files, fieldName = 'xml') {
    const form = new FormData();
    for (const file of files) form.append(fieldName, file);
    const res = await fetch(`/api${url}`, { method: 'POST', body: form });
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
      xhr.open('POST', `/api${url}`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || !onProgress) return;
        onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          window.location.href = '/login';
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
    for (const file of files) form.append(fieldName, file);
    for (const [k, v] of Object.entries(extraFields)) form.append(k, v);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api${url}`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable || !onProgress) return;
        onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          window.location.href = '/login';
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
