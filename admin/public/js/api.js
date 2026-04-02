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
};
