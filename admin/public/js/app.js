/**
 * Admin Panel — SPA Router & Shell
 */

// --- Toast ---
let _toastCount = 0;
function toast(msg, type = 'success') {
  const offset = _toastCount * 56;
  _toastCount++;
  const el = document.createElement('div');
  el.className = `fixed right-4 z-50 px-5 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all duration-300 ${type === 'error' ? 'bg-red-600' : type === 'warning' ? 'bg-amber-500' : 'bg-teal-600'}`;
  el.style.top = `${16 + offset}px`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; _toastCount = Math.max(0, _toastCount - 1); setTimeout(() => el.remove(), 300); }, 3000);
}

// --- Debounce ---
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// --- Modal ---
function modal(title, bodyHtml, actions = []) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div class="flex items-center justify-between px-6 py-4 border-b">
          <h3 class="text-lg font-semibold text-gray-900">${title}</h3>
          <button class="modal-close text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div class="px-6 py-4 overflow-y-auto flex-1">${bodyHtml}</div>
        <div class="flex justify-end gap-3 px-6 py-4 border-t">
          ${actions.map((a) => `<button class="modal-action px-4 py-2 rounded-lg text-sm font-medium ${a.class || 'bg-gray-100 text-gray-700 hover:bg-gray-200'}" data-action="${a.value || ''}">${a.label}</button>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('.modal-close').onclick = () => close(null);
    overlay.querySelectorAll('.modal-action').forEach((btn) => {
      btn.onclick = () => close(btn.dataset.action);
    });
  });
}

// --- Confirm ---
async function confirmAction(msg) {
  const result = await modal('Onay', `<p class="text-gray-600">${msg}</p>`, [
    { label: 'İptal', value: 'cancel' },
    { label: 'Evet', value: 'confirm', class: 'bg-red-600 text-white hover:bg-red-700' },
  ]);
  return result === 'confirm';
}

// --- Router ---
const routes = {};
function route(pattern, handler) { routes[pattern] = handler; }

function navigate(hash) {
  window.location.hash = hash;
}

function matchRoute(hash) {
  const path = hash.replace(/^#\/?/, '/');
  for (const [pattern, handler] of Object.entries(routes)) {
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
    const match = path.match(regex);
    if (match) return { handler, params: match.groups || {} };
  }
  return null;
}

async function handleRoute() {
  const hash = window.location.hash || '#/';
  const main = document.getElementById('main-content');
  const match = matchRoute(hash);

  // Update active sidebar link
  document.querySelectorAll('[data-nav]').forEach((el) => {
    const isActive = hash.startsWith(el.dataset.nav);
    el.classList.toggle('bg-teal-50', isActive);
    el.classList.toggle('text-teal-700', isActive);
    el.classList.toggle('text-gray-600', !isActive);
  });

  if (match) {
    try {
      main.innerHTML = '<div class="flex items-center justify-center py-20"><div class="animate-spin w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full"></div></div>';
      await match.handler(main, match.params);
    } catch (err) {
      main.innerHTML = `<div class="bg-red-50 text-red-700 p-6 rounded-xl"><strong>Hata:</strong> ${err.message}</div>`;
    }
  } else {
    main.innerHTML = '<div class="text-center py-20 text-gray-500">Sayfa bulunamadı.</div>';
  }
}

window.addEventListener('hashchange', handleRoute);

// --- Escape HTML ---
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// --- Register routes ---

// Dashboard
route('/', async (el) => {
  const stats = await API.get('/stats');
  const typeRows = Object.entries(stats.typeCounts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `<tr><td class="py-1.5 text-gray-600">${esc(t)}</td><td class="py-1.5 text-right font-medium">${c}</td></tr>`)
    .join('');

  el.innerHTML = `
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="bg-white rounded-xl border p-5"><div class="text-3xl font-bold text-teal-700">${stats.articleCount}</div><div class="text-sm text-gray-500 mt-1">Makale</div></div>
      <div class="bg-white rounded-xl border p-5"><div class="text-3xl font-bold text-amber-600">${stats.articlesInPressCount}</div><div class="text-sm text-gray-500 mt-1">Baskıda</div></div>
      <div class="bg-white rounded-xl border p-5"><div class="text-3xl font-bold text-blue-600">${stats.issueCount}</div><div class="text-sm text-gray-500 mt-1">Sayı</div></div>
      <div class="bg-white rounded-xl border p-5"><div class="text-3xl font-bold text-purple-600">${stats.newsCount}</div><div class="text-sm text-gray-500 mt-1">Haber</div></div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-white rounded-xl border p-5">
        <h2 class="font-semibold text-gray-900 mb-3">Makale Türleri</h2>
        <table class="w-full text-sm">${typeRows}</table>
      </div>
      <div class="bg-white rounded-xl border p-5">
        <h2 class="font-semibold text-gray-900 mb-3">Hızlı İşlemler</h2>
        <div class="space-y-2">
          <a href="#/jats-import" class="block px-4 py-3 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 font-medium">JATS XML Aktar</a>
          <a href="#/articles/new" class="block px-4 py-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium">Yeni Makale</a>
          <a href="#/issues" class="block px-4 py-3 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 font-medium">Sayı Oluştur</a>
          <button onclick="doBackup()" class="w-full text-left px-4 py-3 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 font-medium">Yedek Al</button>
        </div>
      </div>
    </div>`;
});

async function doBackup() {
  try {
    const result = await API.post('/backup');
    toast(`Yedek alındı: ${result.fileCount} dosya`);
  } catch (err) { toast(err.message, 'error'); }
}

// Articles list
route('/articles', async (el, params) => {
  const page = parseInt(new URLSearchParams(window.location.hash.split('?')[1]).get('page')) || 1;
  const data = await API.get(`/articles?page=${page}&limit=50`);

  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Makaleler <span class="text-gray-400 text-lg font-normal">(${data.total})</span></h1>
      <div class="flex gap-2">
        <a href="#/jats-import" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">XML Aktar</a>
        <a href="#/articles/new" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">Yeni Makale</a>
      </div>
    </div>
    <div class="mb-4"><input id="article-search" type="text" placeholder="Ara (başlık, DOI, yazar)..." class="w-full px-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"></div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50"><tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">ID</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Başlık</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Tür</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Cilt/Sayı</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Tarih</th>
          <th class="px-4 py-3"></th>
        </tr></thead>
        <tbody id="articles-tbody">
          ${data.articles.map((a) => `
            <tr class="border-t hover:bg-gray-50 cursor-pointer" onclick="navigate('#/articles/${a.id}')">
              <td class="px-4 py-3 text-gray-400">${a.id}</td>
              <td class="px-4 py-3 max-w-md truncate">${esc(a.title)}</td>
              <td class="px-4 py-3"><span class="px-2 py-0.5 bg-gray-100 rounded text-xs">${esc(a.type)}</span></td>
              <td class="px-4 py-3 text-gray-500">${a.volume || '-'}/${a.issue || '-'}</td>
              <td class="px-4 py-3 text-gray-500">${a.published || '-'}</td>
              <td class="px-4 py-3"><button class="text-red-500 hover:text-red-700 text-xs" onclick="event.stopPropagation(); deleteArticle(${a.id})">Sil</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="flex justify-between items-center mt-4 text-sm text-gray-500">
      <span>Sayfa ${data.page} / ${Math.ceil(data.total / data.limit)}</span>
      <div class="flex gap-2">
        ${data.page > 1 ? `<a href="#/articles?page=${data.page - 1}" class="px-3 py-1.5 bg-white border rounded hover:bg-gray-50">Önceki</a>` : ''}
        ${data.page * data.limit < data.total ? `<a href="#/articles?page=${data.page + 1}" class="px-3 py-1.5 bg-white border rounded hover:bg-gray-50">Sonraki</a>` : ''}
      </div>
    </div>`;

  // Client-side search with debounce
  const _originalRows = document.getElementById('articles-tbody').innerHTML;
  document.getElementById('article-search').addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    const tbody = document.getElementById('articles-tbody');
    if (q.length < 2) {
      tbody.innerHTML = _originalRows;
      return;
    }
    const result = await API.get(`/articles?search=${encodeURIComponent(q)}&limit=50`);
    tbody.innerHTML = result.articles.map((a) => `
      <tr class="border-t hover:bg-gray-50 cursor-pointer" onclick="navigate('#/articles/${a.id}')">
        <td class="px-4 py-3 text-gray-400">${a.id}</td>
        <td class="px-4 py-3 max-w-md truncate">${esc(a.title)}</td>
        <td class="px-4 py-3"><span class="px-2 py-0.5 bg-gray-100 rounded text-xs">${esc(a.type)}</span></td>
        <td class="px-4 py-3 text-gray-500">${a.volume || '-'}/${a.issue || '-'}</td>
        <td class="px-4 py-3 text-gray-500">${a.published || '-'}</td>
        <td class="px-4 py-3"><button class="text-red-500 hover:text-red-700 text-xs" onclick="event.stopPropagation(); deleteArticle(${a.id})">Sil</button></td>
      </tr>`).join('');
  }, 300));
});

async function deleteArticle(id) {
  if (!await confirmAction('Bu makaleyi silmek istediğinizden emin misiniz?')) return;
  try {
    await API.del(`/articles/${id}`);
    toast('Makale silindi');
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// Article edit / new
route('/articles/new', (el) => renderArticleForm(el, null));
route('/articles/:id', async (el, { id }) => {
  const article = await API.get(`/articles/${id}`);
  renderArticleForm(el, article);
});

async function renderArticleForm(el, article) {
  const isNew = !article;
  const a = article || { id: '', type: '', title: '', authors: [], abstract: '', abstractHtml: '', previewText: '', keywords: [], doi: '', received: '', accepted: '', published: '', volume: '', issue: '', pages: '', pmid: '', featured: false, imageCorner: false, relatedArticles: [] };

  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">${isNew ? 'Yeni Makale' : `Makale #${a.id}`}</h1>
      <div class="flex gap-2">
        <a href="#/articles" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">Geri</a>
        <button onclick="saveArticle(${isNew ? 'true' : 'false'})" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Kaydet</button>
      </div>
    </div>

    <div class="bg-white rounded-xl border">
      <!-- Tabs -->
      <div class="flex border-b overflow-x-auto">
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-teal-600 text-teal-700" data-tab="general">Genel</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="authors">Yazarlar</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="abstract">Özet</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="issue">Sayı</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="links">Bağlantılar</button>
      </div>

      <!-- General tab -->
      <div class="tab-panel p-6" data-tab="general">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Tür</label>
            <input id="f-type" value="${esc(a.type)}" class="w-full px-3 py-2 border rounded-lg text-sm" list="type-list">
            <datalist id="type-list"><option value="Original Article"><option value="Editorial"><option value="Invited Review"><option value="Brief Report"><option value="Letter to the Editor"><option value="Clinical Image"><option value="Case Report"><option value="Erratum"><option value="Retraction Notice"></datalist>
          </div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">DOI</label><input id="f-doi" value="${esc(a.doi)}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <div class="mt-4"><label class="block text-sm font-medium text-gray-700 mb-1">Başlık</label><input id="f-title" value="${esc(a.title)}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Alındığı Tarih</label><input id="f-received" type="date" value="${a.received}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Kabul Tarihi</label><input id="f-accepted" type="date" value="${a.accepted}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Yayın Tarihi</label><input id="f-published" type="date" value="${a.published}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">PMID</label><input id="f-pmid" value="${esc(a.pmid || '')}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
          <div class="flex items-end gap-4">
            <label class="flex items-center gap-2 text-sm"><input id="f-featured" type="checkbox" ${a.featured ? 'checked' : ''} class="rounded"> Öne Çıkan</label>
            <label class="flex items-center gap-2 text-sm"><input id="f-imageCorner" type="checkbox" ${a.imageCorner ? 'checked' : ''} class="rounded"> Görsel Köşesi</label>
          </div>
        </div>
      </div>

      <!-- Authors tab -->
      <div class="tab-panel p-6 hidden" data-tab="authors">
        <div id="authors-list" class="space-y-3">${(a.authors || []).map((au, i) => authorRow(au, i)).join('')}</div>
        <button onclick="addAuthor()" class="mt-3 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium">+ Yazar Ekle</button>
      </div>

      <!-- Abstract tab -->
      <div class="tab-panel p-6 hidden" data-tab="abstract">
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Özet (HTML)</label>
          <textarea id="f-abstractHtml" rows="8" class="w-full px-3 py-2 border rounded-lg text-sm font-mono">${esc(a.abstractHtml)}</textarea>
        </div>
        <div class="mt-4"><label class="block text-sm font-medium text-gray-700 mb-1">Anahtar Kelimeler (virgül ile)</label>
          <input id="f-keywords" value="${esc((a.keywords || []).join(', '))}" class="w-full px-3 py-2 border rounded-lg text-sm">
        </div>
      </div>

      <!-- Issue tab -->
      <div class="tab-panel p-6 hidden" data-tab="issue">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Cilt</label><input id="f-volume" type="number" value="${a.volume || ''}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Sayı</label><input id="f-issue" value="${esc(a.issue)}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Sayfalar</label><input id="f-pages" value="${esc(a.pages)}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
        </div>
      </div>

      <!-- Links tab -->
      <div class="tab-panel p-6 hidden" data-tab="links">
        <div id="links-list" class="space-y-2 mb-4">
          ${(a.relatedArticles || []).map((r) => `
            <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div><span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-xs font-medium">${esc(r.type)}</span>
              <a href="#/articles/${r.targetId}" class="ml-2 text-sm text-teal-700 hover:underline">#${r.targetId} — ${esc(r.label || '').slice(0, 60)}</a></div>
              ${!isNew ? `<button onclick="removeLink(${a.id}, ${r.targetId})" class="text-red-500 text-xs hover:text-red-700">Kaldır</button>` : ''}
            </div>`).join('') || '<p class="text-gray-400 text-sm">Bağlantı yok.</p>'}
        </div>
        ${!isNew ? `
        <div class="border-t pt-4 mt-4">
          <h3 class="text-sm font-medium text-gray-700 mb-2">Yeni Bağlantı Ekle</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select id="link-type" class="px-3 py-2 border rounded-lg text-sm">
              <option value="erratum-for">Erratum (Bu makale düzeltiyor)</option>
              <option value="retraction-of">Retraction (Bu makale geri çekiyor)</option>
              <option value="reply-to">Reply (Bu makale yanıtlıyor)</option>
              <option value="comment-on">Comment (Bu makale yorum yapıyor)</option>
              <option value="related-to">İlişkili</option>
            </select>
            <input id="link-target" type="number" placeholder="Hedef Makale ID" class="px-3 py-2 border rounded-lg text-sm">
            <button onclick="addLink(${a.id})" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm">Ekle</button>
          </div>
        </div>` : ''}
      </div>
    </div>`;

  // Tab switching
  el.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.tab-btn').forEach((b) => { b.classList.remove('border-teal-600', 'text-teal-700'); b.classList.add('border-transparent', 'text-gray-500'); });
      btn.classList.add('border-teal-600', 'text-teal-700');
      btn.classList.remove('border-transparent', 'text-gray-500');
      el.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      el.querySelector(`.tab-panel[data-tab="${btn.dataset.tab}"]`).classList.remove('hidden');
    });
  });
}

function authorRow(au, idx) {
  return `<div class="flex gap-2 items-start p-3 bg-gray-50 rounded-lg author-row">
    <div class="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
      <input class="au-name px-2 py-1.5 border rounded text-sm" placeholder="Ad Soyad" value="${esc(au.name)}">
      <input class="au-aff px-2 py-1.5 border rounded text-sm" placeholder="Kurum" value="${esc(au.affiliation)}">
      <input class="au-orcid px-2 py-1.5 border rounded text-sm" placeholder="ORCID" value="${esc(au.orcid)}">
    </div>
    <button onclick="this.closest('.author-row').remove()" class="text-red-400 hover:text-red-600 text-lg px-1">&times;</button>
  </div>`;
}

function addAuthor() {
  const list = document.getElementById('authors-list');
  list.insertAdjacentHTML('beforeend', authorRow({ name: '', affiliation: '', orcid: '' }, list.children.length));
}

async function saveArticle(isNew) {
  const getVal = (id) => document.getElementById(id)?.value?.trim() || '';
  const authors = [];
  document.querySelectorAll('.author-row').forEach((row) => {
    authors.push({
      name: row.querySelector('.au-name').value.trim(),
      affiliation: row.querySelector('.au-aff').value.trim(),
      orcid: row.querySelector('.au-orcid').value.trim(),
    });
  });

  const data = {
    type: getVal('f-type'),
    title: getVal('f-title'),
    doi: getVal('f-doi'),
    received: getVal('f-received'),
    accepted: getVal('f-accepted'),
    published: getVal('f-published'),
    pmid: getVal('f-pmid'),
    featured: document.getElementById('f-featured')?.checked || false,
    imageCorner: document.getElementById('f-imageCorner')?.checked || false,
    abstractHtml: getVal('f-abstractHtml'),
    abstract: getVal('f-abstractHtml').replace(/<[^>]+>/g, '').trim(),
    keywords: getVal('f-keywords').split(',').map((k) => k.trim()).filter(Boolean),
    volume: parseInt(getVal('f-volume')) || null,
    issue: getVal('f-issue'),
    pages: getVal('f-pages'),
    authors,
  };

  data.previewText = data.abstract.slice(0, 360);

  try {
    if (isNew) {
      const result = await API.post('/articles', data);
      toast('Makale oluşturuldu');
      navigate(`#/articles/${result.id}`);
    } else {
      const id = window.location.hash.match(/#\/articles\/(\d+)/)?.[1];
      await API.put(`/articles/${id}`, data);
      toast('Makale güncellendi');
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function addLink(sourceId) {
  const type = document.getElementById('link-type').value;
  const targetId = parseInt(document.getElementById('link-target').value);
  if (!targetId) return toast('Hedef makale ID giriniz', 'warning');
  try {
    await API.post(`/articles/${sourceId}/link`, { type, targetId });
    toast('Bağlantı eklendi');
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

async function removeLink(sourceId, targetId) {
  try {
    await API.del(`/articles/${sourceId}/link/${targetId}`);
    toast('Bağlantı kaldırıldı');
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// JATS Import
route('/jats-import', async (el) => {
  el.innerHTML = `
    <h1 class="text-2xl font-bold text-gray-900 mb-6">JATS XML Aktar</h1>
    <div class="bg-white rounded-xl border p-6 mb-6">
      <div id="drop-zone" class="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:border-teal-400 transition-colors cursor-pointer">
        <svg class="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
        <p class="text-gray-600 font-medium">XML dosyalarını buraya sürükleyin veya tıklayın</p>
        <p class="text-sm text-gray-400 mt-1">Tek veya birden fazla JATS XML dosyası</p>
        <input id="xml-input" type="file" accept=".xml" multiple class="hidden">
      </div>
    </div>
    <div id="parsed-results" class="space-y-4"></div>`;

  const dropZone = document.getElementById('drop-zone');
  const input = document.getElementById('xml-input');

  dropZone.onclick = () => input.click();
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('border-teal-400', 'bg-teal-50'); };
  dropZone.ondragleave = () => dropZone.classList.remove('border-teal-400', 'bg-teal-50');
  dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('border-teal-400', 'bg-teal-50'); handleXmlFiles(e.dataTransfer.files); };
  input.onchange = () => handleXmlFiles(input.files);
});

async function handleXmlFiles(files) {
  const results = document.getElementById('parsed-results');
  results.innerHTML = '<div class="text-center py-4 text-gray-500">İşleniyor...</div>';

  try {
    const parsed = await API.uploadFiles('/jats/parse-batch', files, 'xml');
    results.innerHTML = parsed.map((r, i) => {
      if (!r.success) {
        return `<div class="bg-red-50 border border-red-200 rounded-xl p-4"><strong class="text-red-700">${esc(r.filename)}</strong>: ${esc(r.error)}</div>`;
      }
      const a = r.article;
      return `
        <div class="bg-white rounded-xl border p-5" id="parsed-${i}">
          <div class="flex items-start justify-between mb-3">
            <div>
              <span class="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">${esc(a.type)}</span>
              <span class="text-xs text-gray-400 ml-2">${esc(r.filename)}</span>
            </div>
            <button onclick="importParsed(${i})" class="px-4 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Aktar</button>
          </div>
          <h3 class="font-semibold text-gray-900 mb-2">${esc(a.title)}</h3>
          <div class="text-sm text-gray-600 mb-2">${(a.authors || []).map((au) => esc(au.name)).join(', ')}</div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-500">
            <div><strong>DOI:</strong> ${esc(a.doi)}</div>
            <div><strong>Cilt:</strong> ${a.volume || '-'} / ${esc(a.issue) || '-'}</div>
            <div><strong>Sayfa:</strong> ${esc(a.pages)}</div>
            <div><strong>Tarih:</strong> ${esc(a.published)}</div>
          </div>
          ${a.relatedArticles?.length ? `<div class="mt-2 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded">Bağlantı: ${a.relatedArticles.map((r) => esc(r.type)).join(', ')}</div>` : ''}
        </div>`;
    }).join('');

    // Store parsed data for import
    window._parsedArticles = parsed;
  } catch (err) {
    results.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded-xl">${esc(err.message)}</div>`;
  }
}

async function importParsed(index) {
  const parsed = window._parsedArticles?.[index];
  if (!parsed?.success) return;

  try {
    const result = await API.post('/jats/import', {
      parsedArticle: parsed.article,
      fullTextHtml: parsed.article.fullTextHtml || '',
    });
    toast(`Makale aktarıldı: #${result.id}`);
    document.getElementById(`parsed-${index}`).classList.add('opacity-50');
    document.getElementById(`parsed-${index}`).querySelector('button').disabled = true;
    document.getElementById(`parsed-${index}`).querySelector('button').textContent = 'Aktarıldı';
  } catch (err) { toast(err.message, 'error'); }
}

// Issues
route('/issues', async (el) => {
  const archive = await API.get('/issues');
  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Sayılar</h1>
      <button onclick="showNewIssueForm()" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Yeni Sayı</button>
    </div>
    <div id="new-issue-form" class="hidden bg-white rounded-xl border p-5 mb-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input id="ni-year" type="number" placeholder="Yil (2026)" class="px-3 py-2 border rounded-lg text-sm">
        <input id="ni-volume" type="number" placeholder="Cilt (43)" class="px-3 py-2 border rounded-lg text-sm">
        <input id="ni-issue" placeholder="Sayı (3)" class="px-3 py-2 border rounded-lg text-sm">
        <button onclick="createIssue()" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Oluştur</button>
      </div>
    </div>
    <div class="space-y-4">
      ${archive.map((y) => `
        <div class="bg-white rounded-xl border">
          <div class="px-5 py-3 bg-gray-50 rounded-t-xl font-semibold text-gray-700">${esc(y.year)} — Volume ${y.volume}</div>
          <div class="divide-y">
            ${y.issues.map((iss) => `
              <div class="flex items-center justify-between px-5 py-3">
                <div><span class="font-medium">${esc(iss.label)}</span> <span class="text-sm text-gray-400 ml-2">${iss.articleCount} makale</span></div>
                <div class="flex gap-2">
                  <button onclick="rebuildIssue(${iss.volume}, '${iss.issue}')" class="text-xs text-teal-600 hover:text-teal-800">Yeniden Oluştur</button>
                  <button onclick="deleteIssue('${y.year}', ${iss.volume}, '${iss.issue}')" class="text-xs text-red-500 hover:text-red-700">Sil</button>
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
});

function showNewIssueForm() { document.getElementById('new-issue-form').classList.toggle('hidden'); }

async function createIssue() {
  const year = document.getElementById('ni-year').value;
  const volume = document.getElementById('ni-volume').value;
  const issue = document.getElementById('ni-issue').value;
  try {
    await API.post('/issues', { year, volume: parseInt(volume), issue });
    toast('Sayı oluşturuldu');
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

async function rebuildIssue(volume, issue) {
  try {
    const result = await API.post(`/issues/${volume}/${issue}/rebuild`);
    toast(`Yeniden oluşturuldu: ${result.articleCount} makale`);
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteIssue(year, volume, issue) {
  if (!await confirmAction('Bu sayıyı silmek istediğinizden emin misiniz?')) return;
  try {
    await API.del(`/issues/${year}/${volume}/${issue}`);
    toast('Sayı silindi');
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// News
route('/news', async (el) => {
  const news = await API.get('/news');
  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Haberler <span class="text-gray-400 text-lg font-normal">(${news.length})</span></h1>
      <a href="#/news/new" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Yeni Haber</a>
    </div>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50"><tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">ID</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Başlık</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Kategori</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Öne Çıkan</th>
          <th class="px-4 py-3"></th>
        </tr></thead>
        <tbody>${news.map((n) => `
          <tr class="border-t hover:bg-gray-50 cursor-pointer" onclick="navigate('#/news/${n.id}')">
            <td class="px-4 py-3 text-gray-400">${n.id}</td>
            <td class="px-4 py-3 max-w-md truncate">${esc(n.title)}</td>
            <td class="px-4 py-3"><span class="px-2 py-0.5 bg-gray-100 rounded text-xs">${esc(n.category || '')}</span></td>
            <td class="px-4 py-3">${n.featured ? '<span class="text-teal-600">Evet</span>' : '-'}</td>
            <td class="px-4 py-3"><button class="text-red-500 hover:text-red-700 text-xs" onclick="event.stopPropagation(); deleteNews(${n.id})">Sil</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
});

async function deleteNews(id) {
  if (!await confirmAction('Bu haberi silmek istediğinizden emin misiniz?')) return;
  try { await API.del(`/news/${id}`); toast('Haber silindi'); handleRoute(); }
  catch (err) { toast(err.message, 'error'); }
}

route('/news/new', (el) => renderNewsForm(el, null));
route('/news/:id', async (el, { id }) => {
  const news = await API.get('/news');
  const item = news.find((n) => n.id === Number(id));
  if (!item) { el.innerHTML = '<p class="text-red-600">Haber bulunamadı.</p>'; return; }
  renderNewsForm(el, item);
});

function renderNewsForm(el, item) {
  const isNew = !item;
  const n = item || { title: '', excerpt: '', content: '', category: 'News', image: '', date: '', featured: false };

  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">${isNew ? 'Yeni Haber' : `Haber #${n.id}`}</h1>
      <div class="flex gap-2">
        <a href="#/news" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">Geri</a>
        <button onclick="saveNews(${isNew ? 'null' : n.id})" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Kaydet</button>
      </div>
    </div>
    <div class="bg-white rounded-xl border p-6 space-y-4">
      <div><label class="block text-sm font-medium text-gray-700 mb-1">Başlık</label><input id="fn-title" value="${esc(n.title)}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
      <div><label class="block text-sm font-medium text-gray-700 mb-1">Özet</label><textarea id="fn-excerpt" rows="3" class="w-full px-3 py-2 border rounded-lg text-sm">${esc(n.excerpt)}</textarea></div>
      <div><label class="block text-sm font-medium text-gray-700 mb-1">İçerik (HTML)</label><textarea id="fn-content" rows="10" class="w-full px-3 py-2 border rounded-lg text-sm font-mono">${esc(n.content)}</textarea></div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Kategori</label><input id="fn-category" value="${esc(n.category)}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Tarih</label><input id="fn-date" type="date" value="${n.date}" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
        <div class="flex items-end"><label class="flex items-center gap-2 text-sm"><input id="fn-featured" type="checkbox" ${n.featured ? 'checked' : ''} class="rounded"> Öne Çıkan</label></div>
      </div>
    </div>`;
}

async function saveNews(id) {
  const data = {
    title: document.getElementById('fn-title').value.trim(),
    excerpt: document.getElementById('fn-excerpt').value.trim(),
    content: document.getElementById('fn-content').value.trim(),
    category: document.getElementById('fn-category').value.trim(),
    date: document.getElementById('fn-date').value,
    featured: document.getElementById('fn-featured').checked,
  };
  try {
    if (id === null) {
      const result = await API.post('/news', data);
      toast('Haber oluşturuldu');
      navigate(`#/news/${result.id}`);
    } else {
      await API.put(`/news/${id}`, data);
      toast('Haber güncellendi');
    }
  } catch (err) { toast(err.message, 'error'); }
}

// Editorial Board
route('/editorial', async (el) => {
  const board = await API.get('/editorial');
  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Yayın Kurulu</h1>
      <button onclick="saveEditorial()" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Kaydet</button>
    </div>
    <div class="space-y-6">
      <div class="bg-white rounded-xl border p-5">
        <h2 class="font-semibold text-gray-900 mb-3">Baş Editör</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input id="eic-name" value="${esc(board.editorInChief?.name)}" placeholder="Ad" class="px-3 py-2 border rounded-lg text-sm">
          <input id="eic-title" value="${esc(board.editorInChief?.title)}" placeholder="Ünvan" class="px-3 py-2 border rounded-lg text-sm">
          <input id="eic-aff" value="${esc(board.editorInChief?.affiliation)}" placeholder="Kurum" class="px-3 py-2 border rounded-lg text-sm">
          <input id="eic-email" value="${esc(board.editorInChief?.email)}" placeholder="Email" class="px-3 py-2 border rounded-lg text-sm">
        </div>
      </div>
      ${['honoraryEditors', 'deputyEditors', 'associateEditors'].map((key) => {
        const label = key === 'honoraryEditors' ? 'Onursal Editörler' : key === 'deputyEditors' ? 'Yardımcı Editörler' : 'Yardımcı Editörler (Genis)';
        return `<div class="bg-white rounded-xl border p-5">
          <h2 class="font-semibold text-gray-900 mb-3">${label}</h2>
          <div id="ed-${key}" class="space-y-2">${(board[key] || []).map((m) => `
            <div class="flex gap-2 ed-row"><input class="ed-name flex-1 px-2 py-1.5 border rounded text-sm" value="${esc(m.name)}" placeholder="Ad"><input class="ed-title w-20 px-2 py-1.5 border rounded text-sm" value="${esc(m.title || '')}" placeholder="Ünvan"><input class="ed-aff flex-1 px-2 py-1.5 border rounded text-sm" value="${esc(m.affiliation)}" placeholder="Kurum"><button onclick="this.closest('.ed-row').remove()" class="text-red-400 hover:text-red-600">&times;</button></div>
          `).join('')}</div>
          <button onclick="addEdMember('ed-${key}')" class="mt-2 text-sm text-blue-600 hover:text-blue-800">+ Ekle</button>
        </div>`;
      }).join('')}
    </div>`;
});

function addEdMember(containerId) {
  document.getElementById(containerId).insertAdjacentHTML('beforeend',
    `<div class="flex gap-2 ed-row"><input class="ed-name flex-1 px-2 py-1.5 border rounded text-sm" placeholder="Ad"><input class="ed-title w-20 px-2 py-1.5 border rounded text-sm" placeholder="Ünvan"><input class="ed-aff flex-1 px-2 py-1.5 border rounded text-sm" placeholder="Kurum"><button onclick="this.closest('.ed-row').remove()" class="text-red-400 hover:text-red-600">&times;</button></div>`
  );
}

async function saveEditorial() {
  const getMembers = (id) => {
    return [...document.querySelectorAll(`#${id} .ed-row`)].map((r) => ({
      name: r.querySelector('.ed-name').value.trim(),
      title: r.querySelector('.ed-title').value.trim(),
      affiliation: r.querySelector('.ed-aff').value.trim(),
    })).filter((m) => m.name);
  };

  const board = {
    editorInChief: {
      name: document.getElementById('eic-name').value.trim(),
      title: document.getElementById('eic-title').value.trim(),
      affiliation: document.getElementById('eic-aff').value.trim(),
      email: document.getElementById('eic-email').value.trim(),
      photo: '',
    },
    honoraryEditors: getMembers('ed-honoraryEditors'),
    deputyEditors: getMembers('ed-deputyEditors'),
    associateEditors: getMembers('ed-associateEditors'),
  };
  try {
    await API.put('/editorial', board);
    toast('Yayın kurulu güncellendi');
  } catch (err) { toast(err.message, 'error'); }
}

// Pages
route('/pages', async (el) => {
  const pages = await API.get('/pages');
  el.innerHTML = `
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Sayfalar</h1>
    <div class="bg-white rounded-xl border divide-y">
      ${pages.map((p) => `
        <a href="#/pages/${p.slug}" class="flex items-center justify-between px-5 py-4 hover:bg-gray-50">
          <div><span class="font-medium text-gray-900">${esc(p.title)}</span><span class="text-sm text-gray-400 ml-2">${esc(p.file)}</span></div>
          <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
        </a>`).join('')}
    </div>`;
});

route('/pages/:slug', async (el, { slug }) => {
  const page = await API.get(`/pages/${slug}`);
  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">${esc(page.title)}</h1>
      <div class="flex gap-2">
        <a href="#/pages" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">Geri</a>
        <button onclick="savePage('${slug}')" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Kaydet</button>
      </div>
    </div>
    <div class="bg-white rounded-xl border p-6">
      <textarea id="page-content" rows="30" class="w-full px-3 py-2 border rounded-lg text-sm font-mono">${esc(page.content)}</textarea>
    </div>`;
});

async function savePage(slug) {
  try {
    await API.put(`/pages/${slug}`, { content: document.getElementById('page-content').value });
    toast('Sayfa güncellendi');
  } catch (err) { toast(err.message, 'error'); }
}

// Article types
route('/article-types', async (el) => {
  const types = await API.get('/article-types');
  el.innerHTML = `
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Makale Türleri</h1>
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50"><tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Tür</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Makale Sayısi</th>
          <th class="px-4 py-3"></th>
        </tr></thead>
        <tbody>${types.map((t) => `
          <tr class="border-t"><td class="px-4 py-3 font-medium">${esc(t.name)}</td><td class="px-4 py-3">${t.count}</td>
          <td class="px-4 py-3"><button onclick="renameType('${esc(t.name)}')" class="text-teal-600 text-xs hover:text-teal-800">Yeniden Adlandır</button></td></tr>`).join('')}</tbody>
      </table>
    </div>`;
});

async function renameType(oldName) {
  const newName = prompt(`"${oldName}" için yeni ad:`);
  if (!newName || newName === oldName) return;
  try {
    const result = await API.put('/article-types/rename', { oldName, newName });
    toast(`${result.renamed} makale güncellendi`);
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// Nav/Footer
route('/nav-footer', async (el) => {
  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Menu & Footer</h1>
      <div class="flex gap-2">
        <button onclick="saveNavFooter()" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Kaydet</button>
        <button onclick="syncNavFooter()" class="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium">Tüm Sayfalara Uygula</button>
      </div>
    </div>
    <div class="bg-white rounded-xl border p-6">
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">Nav HTML</label>
        <textarea id="nf-nav" rows="15" class="w-full px-3 py-2 border rounded-lg text-sm font-mono"></textarea>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Footer HTML</label>
        <textarea id="nf-footer" rows="15" class="w-full px-3 py-2 border rounded-lg text-sm font-mono"></textarea>
      </div>
    </div>`;

  try {
    const data = await API.get('/nav-footer');
    document.getElementById('nf-nav').value = data.navHtml || '';
    document.getElementById('nf-footer').value = data.footerHtml || '';
  } catch { /* first run, no data yet */ }
});

async function saveNavFooter() {
  try {
    await API.put('/nav-footer', {
      navHtml: document.getElementById('nf-nav').value,
      footerHtml: document.getElementById('nf-footer').value,
    });
    toast('Kaydedildi');
  } catch (err) { toast(err.message, 'error'); }
}

async function syncNavFooter() {
  if (!await confirmAction('Nav ve footer tüm sayfalara uygulanacak. Devam etmek istiyor musunuz?')) return;
  try {
    const result = await API.post('/nav-footer/sync');
    const updated = result.results.filter((r) => r.status === 'updated').length;
    toast(`${updated} sayfa güncellendi`);
  } catch (err) { toast(err.message, 'error'); }
}

// Init
document.addEventListener('DOMContentLoaded', handleRoute);
