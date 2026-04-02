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
  clearDirty();

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
      main.innerHTML = `<div class="bg-red-50 text-red-700 p-6 rounded-xl"><strong>Hata:</strong> ${esc(err.message)}</div>`;
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

// --- Unsaved changes tracking ---
let _formDirty = false;
function markDirty() { _formDirty = true; }
function clearDirty() { _formDirty = false; }
window.addEventListener('beforeunload', (e) => {
  if (_formDirty) { e.preventDefault(); e.returnValue = ''; }
});

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
          <a href="#/zip-import" class="block px-4 py-3 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 font-medium">Sayı Aktar (ZIP)</a>
          <a href="#/jats-import" class="block px-4 py-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium">JATS XML Aktar</a>
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
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="media">Medya</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="links">Bağlantılar</button>
      </div>

      <!-- General tab -->
      <div class="tab-panel p-6" data-tab="general">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">Tür</label>
            <input id="f-type" value="${esc(a.type)}" class="w-full px-3 py-2 border rounded-lg text-sm" list="type-list">
            <datalist id="type-list"></datalist>
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
        <div class="mt-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">Görsel</label>
          <div class="flex items-center gap-3">
            <input id="f-imageUrl" value="${esc(a.imageUrl || '')}" placeholder="images/... veya dosya yükleyin" class="flex-1 px-3 py-2 border rounded-lg text-sm">
            <label class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm cursor-pointer">
              Yükle <input id="f-imageFile" type="file" accept="image/*" class="hidden">
            </label>
          </div>
          ${a.imageUrl ? `<img src="../${esc(a.imageUrl)}" class="mt-2 h-20 rounded border object-cover" onerror="this.style.display='none'">` : ''}
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

      <!-- Media tab -->
      <div class="tab-panel p-6 hidden" data-tab="media">
        ${!isNew ? `
        <div class="space-y-6">
          <!-- PDF -->
          <div>
            <h3 class="text-sm font-semibold text-gray-700 mb-2">PDF</h3>
            ${a.pdfUrl ? `<div class="flex items-center gap-3 mb-2"><span class="text-sm text-green-600">Mevcut:</span><code class="text-xs bg-gray-100 px-2 py-1 rounded">${esc(a.pdfUrl)}</code></div>` : '<p class="text-sm text-amber-600 mb-2">PDF yüklenmemiş</p>'}
            <label class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm cursor-pointer inline-block">
              PDF Yükle <input id="f-pdf-file" type="file" accept=".pdf" class="hidden">
            </label>
          </div>
          <!-- Figures -->
          <div>
            <h3 class="text-sm font-semibold text-gray-700 mb-2">Figürler</h3>
            <label class="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm cursor-pointer inline-block">
              Figür Yükle <input id="f-fig-files" type="file" accept="image/*,.tif,.tiff" multiple class="hidden">
            </label>
            <div id="f-fig-results" class="mt-2"></div>
          </div>
          <!-- Supplementary -->
          <div>
            <h3 class="text-sm font-semibold text-gray-700 mb-2">Ek Materyaller</h3>
            <label class="px-4 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 text-sm cursor-pointer inline-block">
              Ek Materyal Yükle <input id="f-supp-files" type="file" multiple class="hidden">
            </label>
            <div id="f-supp-results" class="mt-2"></div>
          </div>
        </div>
        ` : '<p class="text-gray-400 text-sm">Makaleyi kaydettikten sonra medya yükleyebilirsiniz.</p>'}
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

  // Image upload handler
  const imgInput = document.getElementById('f-imageFile');
  if (imgInput) {
    imgInput.addEventListener('change', async () => {
      if (!imgInput.files[0]) return;
      try {
        const result = await API.uploadFile('/media/upload/image', imgInput.files[0], 'image');
        document.getElementById('f-imageUrl').value = result.url;
        markDirty();
        toast('Görsel yüklendi');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // PDF upload for this article
  if (!isNew) {
    const pdfInput = document.getElementById('f-pdf-file');
    if (pdfInput) {
      pdfInput.addEventListener('change', async () => {
        if (!pdfInput.files[0]) return;
        try {
          const result = await API.uploadFile('/media/upload/pdf', pdfInput.files[0], 'pdf', { articleId: String(a.id) });
          toast('PDF yüklendi');
          // Update article pdfUrl
          await API.put(`/articles/${a.id}`, { pdfUrl: result.pdfUrl, localPdfUrl: result.pdfUrl });
          handleRoute();
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    const figInput = document.getElementById('f-fig-files');
    if (figInput) {
      figInput.addEventListener('change', async () => {
        if (!figInput.files.length) return;
        try {
          const result = await API.uploadFiles(`/media/upload/figures/${a.id}`, figInput.files, 'figures');
          const figResults = document.getElementById('f-fig-results');
          figResults.innerHTML = `<div class="text-sm text-green-600">${result.uploaded.length} figür yüklendi</div>
            ${result.uploaded.map((f) => `<div class="text-xs text-gray-500 mt-1"><code>${esc(f.url)}</code></div>`).join('')}
            <button onclick="applyArticleFigures(${a.id})" class="mt-2 px-3 py-1.5 bg-teal-600 text-white rounded text-xs font-medium hover:bg-teal-700">Tam Metne Uygula</button>`;
          window._articleFigureUpload = result;
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    const suppInput = document.getElementById('f-supp-files');
    if (suppInput) {
      suppInput.addEventListener('change', async () => {
        if (!suppInput.files.length) return;
        try {
          const result = await API.uploadFiles(`/media/upload/supplementary/${a.id}`, suppInput.files, 'files');
          const suppResults = document.getElementById('f-supp-results');
          suppResults.innerHTML = `<div class="text-sm text-green-600">${result.uploaded.length} dosya yüklendi</div>
            ${result.uploaded.map((f) => `<div class="text-xs text-gray-500 mt-1"><code>${esc(f.url)}</code></div>`).join('')}`;
        } catch (err) { toast(err.message, 'error'); }
      });
    }
  }

  // Load article types from API
  API.get('/article-types').then((types) => {
    const dl = document.getElementById('type-list');
    if (dl) dl.innerHTML = types.map((t) => `<option value="${esc(t.name)}">`).join('');
  }).catch(() => {});

  // Track unsaved changes
  clearDirty();
  el.addEventListener('input', markDirty);
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
    imageUrl: getVal('f-imageUrl'),
    authors,
  };

  data.previewText = data.abstract.slice(0, 360);

  if (!data.title) { toast('Başlık zorunludur', 'error'); return; }
  if (!data.type) { toast('Makale türü zorunludur', 'error'); return; }

  try {
    if (isNew) {
      const result = await API.post('/articles', data);
      clearDirty();
      toast('Makale oluşturuldu');
      navigate(`#/articles/${result.id}`);
    } else {
      const id = window.location.hash.match(/#\/articles\/(\d+)/)?.[1];
      await API.put(`/articles/${id}`, data);
      clearDirty();
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

// ZIP Import
route('/zip-import', async (el) => {
  const archive = await API.get('/issues');
  const issueOptions = [];
  for (const y of archive) {
    for (const iss of y.issues) {
      issueOptions.push({ label: `${y.year} — Vol ${iss.volume}, Issue ${iss.issue}`, volume: iss.volume, issue: iss.issue, year: y.year });
    }
  }

  // Scan server imports folder
  let serverFiles = [];
  try { serverFiles = await API.get('/imports/scan'); } catch {}

  el.innerHTML = `
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Sayı Aktar (ZIP)</h1>

    <!-- Server files (FTP) -->
    ${serverFiles.length ? `
    <div class="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-amber-800">Sunucudaki ZIP Dosyaları</h2>
        <button onclick="handleRoute()" class="text-sm text-amber-700 hover:text-amber-900 font-medium">Yenile</button>
      </div>
      <div class="space-y-2">
        ${serverFiles.map((f) => `
          <div class="flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-amber-100">
            <div>
              <span class="font-medium text-gray-900">${esc(f.filename)}</span>
              <span class="text-xs text-gray-400 ml-2">${esc(f.sizeHuman)} — ${esc(f.modified.slice(0, 10))}</span>
            </div>
            <div class="flex gap-2">
              <button onclick="previewServerZip('${esc(f.filename)}')" class="px-3 py-1.5 bg-amber-100 text-amber-800 rounded text-xs font-medium hover:bg-amber-200">Önizle</button>
              <button onclick="deleteServerZip('${esc(f.filename)}')" class="px-3 py-1.5 text-red-500 rounded text-xs hover:text-red-700">Sil</button>
            </div>
          </div>`).join('')}
      </div>
    </div>` : `
    <div class="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 text-center">
      <p class="text-gray-500 text-sm">Sunucuda bekleyen ZIP dosyası yok.</p>
      <p class="text-xs text-gray-400 mt-1">FTP ile <code>admin/imports/</code> klasörüne ZIP yükleyebilirsiniz.</p>
    </div>`}

    <!-- Upload ZIP -->
    <div class="bg-white rounded-xl border p-6 mb-6">
      <h2 class="font-semibold text-gray-900 mb-3">ZIP Dosyası Yükle</h2>
      <p class="text-sm text-gray-500 mb-4">ZIP içindeki XML, PDF ve görsel dosyaları otomatik olarak eşleştirilir ve aktarılır.</p>
      <div id="zip-drop-zone" class="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:border-teal-400 transition-colors cursor-pointer">
        <svg class="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
        <p class="text-gray-600 font-medium">ZIP dosyasını sürükleyin veya tıklayın</p>
        <p class="text-xs text-gray-400 mt-1">XML + PDF + JPG/PNG dosyaları içeren tek ZIP</p>
        <input id="zip-file-input" type="file" accept=".zip" class="hidden">
      </div>
    </div>

    <!-- Preview & Import area -->
    <div id="zip-preview-area"></div>`;

  // Drag & drop
  const dropZone = document.getElementById('zip-drop-zone');
  const input = document.getElementById('zip-file-input');
  dropZone.onclick = () => input.click();
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('border-teal-400', 'bg-teal-50'); };
  dropZone.ondragleave = () => dropZone.classList.remove('border-teal-400', 'bg-teal-50');
  dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('border-teal-400', 'bg-teal-50'); uploadAndPreviewZip(e.dataTransfer.files[0]); };
  input.onchange = () => { if (input.files[0]) uploadAndPreviewZip(input.files[0]); };

  // Store issue options for later
  window._zipIssueOptions = issueOptions;
});

async function uploadAndPreviewZip(file) {
  if (!file || !file.name.toLowerCase().endsWith('.zip')) {
    return toast('Lütfen ZIP dosyası seçin', 'warning');
  }

  const area = document.getElementById('zip-preview-area');
  area.innerHTML = '<div class="flex items-center justify-center py-8"><div class="animate-spin w-6 h-6 border-3 border-teal-600 border-t-transparent rounded-full mr-3"></div><span class="text-gray-500">ZIP yükleniyor ve analiz ediliyor...</span></div>';

  try {
    // Upload ZIP
    const uploadResult = await API.uploadFile('/imports/upload', file, 'zip');
    // Preview it
    await showZipPreview(uploadResult.filename);
  } catch (err) {
    area.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded-xl">${esc(err.message)}</div>`;
  }
}

async function previewServerZip(filename) {
  const area = document.getElementById('zip-preview-area');
  area.innerHTML = '<div class="flex items-center justify-center py-8"><div class="animate-spin w-6 h-6 border-3 border-teal-600 border-t-transparent rounded-full mr-3"></div><span class="text-gray-500">Analiz ediliyor...</span></div>';
  await showZipPreview(filename);
}

async function showZipPreview(filename) {
  const area = document.getElementById('zip-preview-area');
  try {
    const preview = await API.get(`/imports/preview/${encodeURIComponent(filename)}`);
    const issueOptions = window._zipIssueOptions || [];

    // Detect volume/issue from first article
    const firstArticle = preview.articles[0];
    const detectedVol = firstArticle?.volume || '';
    const detectedIss = firstArticle?.issue || '';

    area.innerHTML = `
      <div class="bg-white rounded-xl border mb-6">
        <div class="px-6 py-4 border-b bg-gray-50 rounded-t-xl">
          <h2 class="font-semibold text-gray-900">${esc(filename)}</h2>
          <div class="flex gap-4 mt-2 text-sm text-gray-500">
            <span>${preview.summary.totalXml} XML</span>
            <span>${preview.analysis.pdfFiles.length} PDF</span>
            <span>${preview.analysis.imageFiles.length} Görsel</span>
            <span>${preview.analysis.otherFiles.length} Diğer</span>
          </div>
        </div>

        <!-- Import settings -->
        <div class="px-6 py-4 border-b bg-blue-50">
          <h3 class="text-sm font-semibold text-gray-700 mb-3">Aktarma Ayarları</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label class="block text-xs text-gray-500 mb-1">Hedef Sayı</label>
              <select id="zip-target" class="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                <option value="auto">XML'den oku</option>
                ${issueOptions.map((o) => `<option value="${o.volume}|${o.issue}|${o.year}" ${o.volume == detectedVol && String(o.issue) === String(detectedIss) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                <option value="new">Yeni sayı oluştur</option>
              </select>
            </div>
            <div id="zip-new-issue-fields" class="hidden col-span-2">
              <div class="grid grid-cols-3 gap-2">
                <div><label class="block text-xs text-gray-500 mb-1">Yıl</label><input id="zip-year" type="number" value="${new Date().getFullYear()}" class="w-full px-2 py-2 border rounded-lg text-sm"></div>
                <div><label class="block text-xs text-gray-500 mb-1">Cilt</label><input id="zip-vol" type="number" value="${detectedVol}" class="w-full px-2 py-2 border rounded-lg text-sm"></div>
                <div><label class="block text-xs text-gray-500 mb-1">Sayı</label><input id="zip-iss" value="${detectedIss}" class="w-full px-2 py-2 border rounded-lg text-sm"></div>
              </div>
            </div>
            <div class="flex items-end">
              <label class="flex items-center gap-2 text-sm"><input id="zip-set-current" type="checkbox" class="rounded"> Güncel sayı yap</label>
            </div>
          </div>
        </div>

        <!-- Parsed articles -->
        <div class="px-6 py-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-700">Makaleler (${preview.summary.parsedOk})</h3>
            <button onclick="processZipImport('${esc(filename)}')" class="px-5 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium text-sm">Tümünü Aktar</button>
          </div>

          ${preview.errors.length ? `
          <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
            <p class="text-sm font-medium text-red-700">${preview.errors.length} XML parse edilemedi</p>
            ${preview.errors.map((e) => `<div class="text-xs text-red-600 mt-1">${esc(e.xmlFile)}: ${esc(e.error)}</div>`).join('')}
          </div>` : ''}

          <div class="space-y-2">
            ${preview.articles.map((a, i) => `
              <div class="flex items-center gap-3 p-3 rounded-lg border text-sm ${a.matchedPdf ? 'bg-white' : 'bg-amber-50 border-amber-200'}">
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-gray-900 truncate">${esc(a.title)}</div>
                  <div class="text-xs text-gray-500 mt-0.5">
                    ${esc(a.authors.slice(0, 3).join(', '))}${a.authors.length > 3 ? ' et al.' : ''}
                  </div>
                </div>
                <div class="flex gap-2 flex-shrink-0 text-xs">
                  <span class="px-2 py-0.5 bg-gray-100 rounded">${esc(a.type)}</span>
                  <span class="text-gray-400">${esc(a.pages || '-')}</span>
                  ${a.matchedPdf ? '<span class="text-green-600" title="PDF eşleşti">PDF &#10003;</span>' : '<span class="text-amber-600" title="PDF bulunamadı">PDF &#10007;</span>'}
                  ${a.matchedImages.length ? `<span class="text-green-600" title="${a.matchedImages.length} figür eşleşti">IMG ${a.matchedImages.length}/${a.figureCount}</span>` : (a.figureCount ? `<span class="text-amber-600">IMG 0/${a.figureCount}</span>` : '')}
                </div>
              </div>`).join('')}
          </div>

          <!-- File summary -->
          <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div class="bg-green-50 rounded-lg p-3 text-center">
              <div class="text-lg font-bold text-green-700">${preview.summary.parsedOk}</div>
              <div class="text-green-600">Makale</div>
            </div>
            <div class="bg-${preview.summary.pdfsMatched === preview.summary.parsedOk ? 'green' : 'amber'}-50 rounded-lg p-3 text-center">
              <div class="text-lg font-bold text-${preview.summary.pdfsMatched === preview.summary.parsedOk ? 'green' : 'amber'}-700">${preview.summary.pdfsMatched}/${preview.summary.parsedOk}</div>
              <div class="text-${preview.summary.pdfsMatched === preview.summary.parsedOk ? 'green' : 'amber'}-600">PDF Eşleşme</div>
            </div>
            <div class="bg-blue-50 rounded-lg p-3 text-center">
              <div class="text-lg font-bold text-blue-700">${preview.summary.imagesMatched}</div>
              <div class="text-blue-600">Figür Eşleşme</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3 text-center">
              <div class="text-lg font-bold text-gray-700">${preview.analysis.otherFiles.length}</div>
              <div class="text-gray-600">Ek Dosya</div>
            </div>
          </div>
        </div>
      </div>`;

    // Toggle new issue fields
    document.getElementById('zip-target').addEventListener('change', function () {
      document.getElementById('zip-new-issue-fields').classList.toggle('hidden', this.value !== 'new');
    });

  } catch (err) {
    area.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded-xl">${esc(err.message)}</div>`;
  }
}

async function processZipImport(filename) {
  const target = document.getElementById('zip-target').value;
  const setCurrent = document.getElementById('zip-set-current').checked;

  let targetVolume = null, targetIssue = null, year = null, shouldCreateIssue = false;

  if (target === 'new') {
    targetVolume = parseInt(document.getElementById('zip-vol').value);
    targetIssue = document.getElementById('zip-iss').value.trim();
    year = document.getElementById('zip-year').value.trim();
    if (!targetVolume || !targetIssue) return toast('Cilt ve sayı giriniz', 'warning');
    shouldCreateIssue = true;
  } else if (target !== 'auto') {
    const parts = target.split('|');
    targetVolume = parseInt(parts[0]);
    targetIssue = parts[1];
    year = parts[2];
  }

  if (!await confirmAction(`ZIP dosyası import edilecek. ${targetVolume ? `Hedef: Vol ${targetVolume}, Issue ${targetIssue}` : 'XML\'den okunan cilt/sayı kullanılacak'}. Devam?`)) return;

  const area = document.getElementById('zip-preview-area');
  area.innerHTML = '<div class="flex items-center justify-center py-12"><div class="animate-spin w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full mr-3"></div><span class="text-gray-600 font-medium">Import ediliyor... Bu işlem biraz sürebilir.</span></div>';

  try {
    const result = await API.post(`/imports/process/${encodeURIComponent(filename)}`, {
      targetVolume,
      targetIssue,
      setAsCurrent: setCurrent,
      createIssue: shouldCreateIssue,
      year,
    });

    let html = `<div class="bg-white rounded-xl border p-6">
      <h2 class="text-xl font-bold text-green-700 mb-4">Import Tamamlandı</h2>
      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="bg-green-50 rounded-lg p-4 text-center">
          <div class="text-3xl font-bold text-green-700">${result.totalImported}</div>
          <div class="text-sm text-green-600">Makale Aktarıldı</div>
        </div>
        ${result.totalErrors ? `<div class="bg-red-50 rounded-lg p-4 text-center">
          <div class="text-3xl font-bold text-red-700">${result.totalErrors}</div>
          <div class="text-sm text-red-600">Hata</div>
        </div>` : `<div class="bg-green-50 rounded-lg p-4 text-center">
          <div class="text-3xl font-bold text-green-700">0</div>
          <div class="text-sm text-green-600">Hata</div>
        </div>`}
      </div>`;

    if (result.imported.length) {
      html += `<h3 class="font-semibold text-gray-700 mb-2">Aktarılan Makaleler</h3>
        <div class="space-y-1 mb-4">${result.imported.map((a) => `
          <div class="flex items-center gap-2 text-sm p-2 rounded hover:bg-gray-50">
            <a href="#/articles/${a.id}" class="text-teal-600 hover:underline font-medium">#${a.id}</a>
            <span class="flex-1 truncate">${esc(a.title)}</span>
            ${a.hasPdf ? '<span class="text-green-500 text-xs">PDF &#10003;</span>' : '<span class="text-amber-500 text-xs">PDF &#10007;</span>'}
          </div>`).join('')}
        </div>`;
    }

    if (result.errors.length) {
      html += `<h3 class="font-semibold text-red-700 mb-2">Hatalar</h3>
        <div class="space-y-1">${result.errors.map((e) => `
          <div class="text-sm text-red-600 p-2 bg-red-50 rounded">${esc(e.file)}: ${esc(e.error)}</div>`).join('')}
        </div>`;
    }

    html += `<div class="mt-6 flex gap-3">
      ${result.volume ? `<a href="#/issues/${result.volume}/${result.issue}" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Sayıyı Görüntüle</a>` : ''}
      <a href="#/zip-import" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">Başka ZIP Aktar</a>
    </div></div>`;

    area.innerHTML = html;
    toast(`${result.totalImported} makale başarıyla aktarıldı`);
  } catch (err) {
    area.innerHTML = `<div class="bg-red-50 text-red-700 p-6 rounded-xl"><strong>Import hatası:</strong> ${esc(err.message)}</div>`;
  }
}

async function deleteServerZip(filename) {
  if (!await confirmAction(`"${filename}" silinecek. Emin misiniz?`)) return;
  try {
    await API.del(`/imports/${encodeURIComponent(filename)}`);
    toast('ZIP silindi');
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// JATS Import
route('/jats-import', async (el) => {
  const archive = await API.get('/issues');
  const issueOptions = [];
  for (const y of archive) {
    for (const iss of y.issues) {
      issueOptions.push({ label: `${y.year} — Vol ${iss.volume}, Issue ${iss.issue}`, volume: iss.volume, issue: iss.issue });
    }
  }

  el.innerHTML = `
    <h1 class="text-2xl font-bold text-gray-900 mb-6">JATS XML Aktar</h1>
    <div class="bg-white rounded-xl border p-6 mb-6">
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-2">Hedef</label>
        <div class="flex gap-3 items-center">
          <select id="import-target" class="px-3 py-2 border rounded-lg text-sm">
            <option value="auto">XML'den oku (otomatik)</option>
            <option value="in-press">Baskıda olarak ekle</option>
            ${issueOptions.map((o) => `<option value="${o.volume}|${o.issue}">Vol ${o.volume}, Issue ${o.issue} (${esc(o.label.split(' — ')[0])})</option>`).join('')}
          </select>
        </div>
      </div>
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
    const successful = parsed.filter((r) => r.success);

    let html = '';

    // Batch import button if multiple files
    if (successful.length > 1) {
      html += `<div class="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl p-4 mb-4">
        <span class="font-medium text-teal-800">${successful.length} makale başarıyla parse edildi</span>
        <button onclick="importAllParsed()" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Tümünü Aktar</button>
      </div>`;
    }

    html += parsed.map((r, i) => {
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

    results.innerHTML = html;
    window._parsedArticles = parsed;
  } catch (err) {
    results.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded-xl">${esc(err.message)}</div>`;
  }
}

async function importParsed(index) {
  const parsed = window._parsedArticles?.[index];
  if (!parsed?.success) return;

  const target = document.getElementById('import-target')?.value || 'auto';

  try {
    if (target === 'in-press') {
      const result = await API.post('/jats/import-in-press', { parsedArticles: [parsed.article] });
      toast(`Baskıda makale eklendi (${result.totalImported})`);
    } else if (target !== 'auto') {
      const [vol, iss] = target.split('|');
      const result = await API.post('/jats/import-batch', {
        parsedArticles: [parsed.article],
        targetVolume: Number(vol),
        targetIssue: iss,
      });
      toast(`Makale aktarıldı: Vol ${vol}, Issue ${iss}`);
    } else {
      const result = await API.post('/jats/import', {
        parsedArticle: parsed.article,
        fullTextHtml: parsed.article.fullTextHtml || '',
      });
      toast(`Makale aktarıldı: #${result.id}`);
    }
    document.getElementById(`parsed-${index}`).classList.add('opacity-50');
    const btn = document.getElementById(`parsed-${index}`).querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Aktarıldı';
  } catch (err) { toast(err.message, 'error'); }
}

async function importAllParsed() {
  const parsed = window._parsedArticles;
  if (!parsed) return;
  const toImport = parsed.filter((r) => r.success).map((r) => r.article);
  if (!toImport.length) return;

  const target = document.getElementById('import-target')?.value || 'auto';

  try {
    if (target === 'in-press') {
      const result = await API.post('/jats/import-in-press', { parsedArticles: toImport });
      toast(`${result.totalImported} makale baskıda olarak eklendi`);
    } else if (target !== 'auto') {
      const [vol, iss] = target.split('|');
      const result = await API.post('/jats/import-batch', {
        parsedArticles: toImport,
        targetVolume: Number(vol),
        targetIssue: iss,
      });
      if (result.totalImported) toast(`${result.totalImported} makale aktarıldı (Vol ${vol}, Issue ${iss})`);
      if (result.totalErrors) toast(`${result.totalErrors} hata`, 'warning');
    } else {
      const result = await API.post('/jats/import-batch', { parsedArticles: toImport });
      if (result.totalImported) toast(`${result.totalImported} makale aktarıldı`);
      if (result.totalErrors) toast(`${result.totalErrors} hata`, 'warning');
    }
    // Mark all as imported
    parsed.forEach((r, i) => {
      if (!r.success) return;
      const el = document.getElementById(`parsed-${i}`);
      if (el) {
        el.classList.add('opacity-50');
        const btn = el.querySelector('button');
        if (btn) { btn.disabled = true; btn.textContent = 'Aktarıldı'; }
      }
    });
  } catch (err) { toast(err.message, 'error'); }
}

// Issues
route('/issues', async (el) => {
  const archive = await API.get('/issues');
  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Sayılar</h1>
      <button onclick="checkServerImports()" class="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium">Sunucudan Kontrol Et</button>
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
              <div class="flex items-center justify-between px-5 py-3 hover:bg-gray-50 cursor-pointer" onclick="navigate('#/issues/${iss.volume}/${iss.issue}')">
                <div><span class="font-medium">${esc(iss.label)}</span> <span class="text-sm text-gray-400 ml-2">${iss.articleCount} makale</span></div>
                <div class="flex gap-2">
                  <button onclick="event.stopPropagation(); rebuildIssue(${iss.volume}, '${iss.issue}')" class="text-xs text-teal-600 hover:text-teal-800">Yeniden Oluştur</button>
                  <button onclick="event.stopPropagation(); deleteIssue('${y.year}', ${iss.volume}, '${iss.issue}')" class="text-xs text-red-500 hover:text-red-700">Sil</button>
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
});

async function checkServerImports() {
  try {
    const files = await API.get('/imports/scan');
    if (!files.length) {
      toast('Sunucuda bekleyen ZIP dosyası yok', 'warning');
      return;
    }
    toast(`${files.length} ZIP dosyası bulundu`);
    navigate('#/zip-import');
  } catch (err) { toast(err.message, 'error'); }
}

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

// Issue detail
route('/issues/:volume/:issue', async (el, { volume, issue }) => {
  const articles = await API.get(`/issues/${volume}/${issue}/articles`);

  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div>
        <a href="#/issues" class="text-sm text-teal-600 hover:text-teal-800">&larr; Tüm Sayılar</a>
        <h1 class="text-2xl font-bold text-gray-900 mt-1">Volume ${esc(volume)}, Issue ${esc(issue)}</h1>
        <p class="text-sm text-gray-500">${articles.length} makale</p>
      </div>
      <div class="flex gap-2">
        <button onclick="setCurrentIssue(${volume}, '${issue}')" class="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium">Güncel Sayı Yap</button>
        <button onclick="rebuildIssue(${volume}, '${issue}')" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">Yeniden Oluştur</button>
      </div>
    </div>

    <!-- Batch JATS upload for this issue -->
    <div class="bg-white rounded-xl border p-5 mb-6">
      <h2 class="font-semibold text-gray-900 mb-3">Bu Sayıya JATS XML Aktar</h2>
      <div id="issue-drop-zone" class="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-teal-400 transition-colors cursor-pointer">
        <p class="text-gray-600 font-medium">XML dosyalarını sürükleyin veya tıklayın</p>
        <p class="text-xs text-gray-400 mt-1">Tüm makaleler Volume ${esc(volume)}, Issue ${esc(issue)} olarak atanır</p>
        <input id="issue-xml-input" type="file" accept=".xml" multiple class="hidden">
      </div>
      <div id="issue-parsed-results" class="mt-4 space-y-3"></div>
    </div>

    <!-- Batch PDF upload for this issue -->
    <div class="bg-white rounded-xl border p-5 mb-6">
      <h2 class="font-semibold text-gray-900 mb-3">Bu Sayıya Toplu PDF Yükle</h2>
      <div id="issue-pdf-drop" class="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:border-teal-400 transition-colors cursor-pointer">
        <p class="text-gray-600 text-sm">PDF dosyalarını sürükleyin (dosya adı = makale ID)</p>
        <input id="issue-pdf-input" type="file" accept=".pdf" multiple class="hidden">
      </div>
      <div id="issue-pdf-results" class="mt-3"></div>
    </div>

    <!-- Articles in this issue -->
    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50"><tr>
          <th class="text-left px-4 py-3 font-medium text-gray-500">ID</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Sayfa</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Başlık</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Tür</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">DOI</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">PDF</th>
          <th class="px-4 py-3"></th>
        </tr></thead>
        <tbody>${articles.map((a) => `
          <tr class="border-t hover:bg-gray-50 cursor-pointer" onclick="navigate('#/articles/${a.id}')">
            <td class="px-4 py-3 text-gray-400">${a.id}</td>
            <td class="px-4 py-3 text-gray-500">${esc(a.pages || '-')}</td>
            <td class="px-4 py-3 max-w-sm truncate">${esc(a.title)}</td>
            <td class="px-4 py-3"><span class="px-2 py-0.5 bg-gray-100 rounded text-xs">${esc(a.type)}</span></td>
            <td class="px-4 py-3 text-xs text-gray-400">${esc(a.doi || '-')}</td>
            <td class="px-4 py-3 text-center">${a.pdfUrl ? '<span class="text-green-500" title="PDF mevcut">&#10003;</span>' : '<span class="text-gray-300" title="PDF yok">&#8212;</span>'}</td>
            <td class="px-4 py-3"><button class="text-red-500 hover:text-red-700 text-xs" onclick="event.stopPropagation(); deleteArticle(${a.id})">Sil</button></td>
          </tr>`).join('')}</tbody>
      </table>
      ${!articles.length ? '<div class="text-center py-8 text-gray-400">Bu sayıda henüz makale yok.</div>' : ''}
    </div>`;

  // Drop zone for this issue
  const dropZone = document.getElementById('issue-drop-zone');
  const input = document.getElementById('issue-xml-input');
  dropZone.onclick = () => input.click();
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('border-teal-400', 'bg-teal-50'); };
  dropZone.ondragleave = () => dropZone.classList.remove('border-teal-400', 'bg-teal-50');
  dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('border-teal-400', 'bg-teal-50'); handleIssueXmlFiles(e.dataTransfer.files, volume, issue); };
  input.onchange = () => handleIssueXmlFiles(input.files, volume, issue);

  // PDF drop zone for this issue
  const pdfDrop = document.getElementById('issue-pdf-drop');
  const pdfInput = document.getElementById('issue-pdf-input');
  pdfDrop.onclick = () => pdfInput.click();
  pdfDrop.ondragover = (e) => { e.preventDefault(); pdfDrop.classList.add('border-teal-400', 'bg-teal-50'); };
  pdfDrop.ondragleave = () => pdfDrop.classList.remove('border-teal-400', 'bg-teal-50');
  pdfDrop.ondrop = (e) => { e.preventDefault(); pdfDrop.classList.remove('border-teal-400', 'bg-teal-50'); handleIssuePdfUpload(e.dataTransfer.files); };
  pdfInput.onchange = () => handleIssuePdfUpload(pdfInput.files);
});

async function handleIssuePdfUpload(files) {
  const results = document.getElementById('issue-pdf-results');
  results.innerHTML = '<div class="text-sm text-gray-500">Yükleniyor...</div>';
  try {
    const result = await API.uploadFiles('/media/upload/pdf-batch', files, 'pdf');
    let html = '';
    if (result.totalMatched) html += `<div class="text-sm text-green-600">${result.totalMatched} PDF eşleştirildi</div>`;
    if (result.totalUnmatched) html += `<div class="text-sm text-amber-600">${result.totalUnmatched} PDF eşleştirilemedi</div>`;
    results.innerHTML = html;
  } catch (err) {
    results.innerHTML = `<div class="text-sm text-red-600">${esc(err.message)}</div>`;
  }
}

async function handleIssueXmlFiles(files, volume, issue) {
  const results = document.getElementById('issue-parsed-results');
  results.innerHTML = '<div class="text-center py-4 text-gray-500">İşleniyor...</div>';

  try {
    const parsed = await API.uploadFiles('/jats/parse-batch', files, 'xml');
    const successful = parsed.filter((r) => r.success);
    const failed = parsed.filter((r) => !r.success);

    let html = '';
    if (failed.length) {
      html += failed.map((r) => `<div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm"><strong class="text-red-700">${esc(r.filename)}</strong>: ${esc(r.error)}</div>`).join('');
    }

    if (successful.length) {
      html += `<div class="bg-gray-50 rounded-lg p-4">
        <div class="flex items-center justify-between mb-3">
          <span class="font-medium text-gray-700">${successful.length} makale başarıyla parse edildi</span>
          <button onclick="importBatchToIssue(${volume}, '${issue}')" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Tümünü Aktar</button>
        </div>
        <div class="space-y-2">${successful.map((r, i) => `
          <div class="flex items-center gap-3 text-sm" id="issue-parsed-${i}">
            <input type="checkbox" checked class="issue-import-check rounded" data-idx="${i}">
            <span class="px-2 py-0.5 bg-gray-200 rounded text-xs">${esc(r.article.type)}</span>
            <span class="flex-1 truncate">${esc(r.article.title)}</span>
            <span class="text-gray-400 text-xs">${esc(r.article.pages || '-')}</span>
          </div>`).join('')}
        </div>
      </div>`;
    }

    results.innerHTML = html;
    window._issueParsedArticles = parsed;
  } catch (err) {
    results.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded-lg">${esc(err.message)}</div>`;
  }
}

async function importBatchToIssue(volume, issue) {
  const parsed = window._issueParsedArticles;
  if (!parsed) return;

  const checks = document.querySelectorAll('.issue-import-check:checked');
  const indices = [...checks].map((c) => parseInt(c.dataset.idx));
  const toImport = indices.map((i) => parsed[i]?.article).filter(Boolean);

  if (!toImport.length) return toast('Aktarılacak makale seçilmedi', 'warning');

  try {
    const result = await API.post('/jats/import-batch', {
      parsedArticles: toImport,
      targetVolume: Number(volume),
      targetIssue: String(issue),
    });

    if (result.totalImported) toast(`${result.totalImported} makale aktarıldı`);
    if (result.totalErrors) toast(`${result.totalErrors} hata oluştu`, 'warning');

    handleRoute(); // Refresh page
  } catch (err) { toast(err.message, 'error'); }
}

async function setCurrentIssue(volume, issue) {
  if (!await confirmAction(`Volume ${volume}, Issue ${issue} güncel sayı olarak ayarlanacak. Devam?`)) return;
  try {
    const result = await API.post(`/issues/${volume}/${issue}/set-current`);
    toast(`Güncel sayı ayarlandı (${result.articleCount} makale)`);
  } catch (err) { toast(err.message, 'error'); }
}

// Articles in Press
route('/articles-in-press', async (el) => {
  const aip = await API.get('/articles-in-press');
  const archive = await API.get('/issues');

  // Build issue options for publish modal
  const issueOptions = [];
  for (const y of archive) {
    for (const iss of y.issues) {
      issueOptions.push({ label: `${y.year} — Vol ${iss.volume}, Issue ${iss.issue}`, volume: iss.volume, issue: iss.issue });
    }
  }

  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Baskıda Makaleler <span class="text-gray-400 text-lg font-normal">(${aip.length})</span></h1>
      <div class="flex gap-2">
        <button onclick="showAipImport()" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">JATS XML Aktar</button>
        ${aip.length ? `<button onclick="publishSelectedAip()" class="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium">Seçilenleri Yayınla</button>` : ''}
      </div>
    </div>

    <!-- JATS upload for in-press -->
    <div id="aip-import-zone" class="hidden bg-white rounded-xl border p-5 mb-6">
      <h2 class="font-semibold text-gray-900 mb-3">Baskıda Makale Olarak JATS XML Aktar</h2>
      <div id="aip-drop-zone" class="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-teal-400 transition-colors cursor-pointer">
        <p class="text-gray-600 font-medium">XML dosyalarını sürükleyin veya tıklayın</p>
        <p class="text-xs text-gray-400 mt-1">Cilt/sayı atanmadan baskıda olarak eklenir</p>
        <input id="aip-xml-input" type="file" accept=".xml" multiple class="hidden">
      </div>
      <div id="aip-parsed-results" class="mt-4 space-y-3"></div>
    </div>

    ${aip.length ? `
    <!-- Publish controls -->
    <div id="aip-publish-bar" class="hidden bg-amber-50 rounded-xl border border-amber-200 p-4 mb-6">
      <div class="flex items-center gap-4">
        <span class="text-sm font-medium text-amber-800" id="aip-selected-count">0 makale seçili</span>
        <select id="aip-target-issue" class="px-3 py-2 border rounded-lg text-sm flex-1">
          <option value="">Hedef sayı seçin...</option>
          ${issueOptions.map((o) => `<option value="${o.volume}|${o.issue}">${esc(o.label)}</option>`).join('')}
        </select>
        <button onclick="doPublishAip()" class="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium">Yayınla</button>
      </div>
    </div>` : ''}

    <div class="bg-white rounded-xl border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50"><tr>
          <th class="px-4 py-3 w-8"><input type="checkbox" id="aip-select-all" class="rounded"></th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">ID</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Başlık</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">Tür</th>
          <th class="text-left px-4 py-3 font-medium text-gray-500">DOI</th>
          <th class="px-4 py-3"></th>
        </tr></thead>
        <tbody>${aip.map((a) => `
          <tr class="border-t hover:bg-gray-50">
            <td class="px-4 py-3"><input type="checkbox" class="aip-check rounded" data-id="${a.id}"></td>
            <td class="px-4 py-3 text-gray-400">${a.id}</td>
            <td class="px-4 py-3 max-w-sm truncate">${esc(a.title)}</td>
            <td class="px-4 py-3"><span class="px-2 py-0.5 bg-gray-100 rounded text-xs">${esc(a.type)}</span></td>
            <td class="px-4 py-3 text-xs text-gray-400">${esc(a.doi || '-')}</td>
            <td class="px-4 py-3">
              <button class="text-red-500 hover:text-red-700 text-xs" onclick="deleteAip(${a.id})">Sil</button>
            </td>
          </tr>`).join('')}</tbody>
      </table>
      ${!aip.length ? '<div class="text-center py-8 text-gray-400">Baskıda makale yok.</div>' : ''}
    </div>`;

  // Select all handler
  const selectAll = document.getElementById('aip-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      document.querySelectorAll('.aip-check').forEach((c) => { c.checked = selectAll.checked; });
      updateAipSelection();
    });
    document.querySelectorAll('.aip-check').forEach((c) => {
      c.addEventListener('change', updateAipSelection);
    });
  }

  // Drop zone for in-press import
  const dropZone = document.getElementById('aip-drop-zone');
  const input = document.getElementById('aip-xml-input');
  if (dropZone && input) {
    dropZone.onclick = () => input.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('border-teal-400', 'bg-teal-50'); };
    dropZone.ondragleave = () => dropZone.classList.remove('border-teal-400', 'bg-teal-50');
    dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('border-teal-400', 'bg-teal-50'); handleAipXmlFiles(e.dataTransfer.files); };
    input.onchange = () => handleAipXmlFiles(input.files);
  }
});

function showAipImport() {
  document.getElementById('aip-import-zone').classList.toggle('hidden');
}

function updateAipSelection() {
  const checked = document.querySelectorAll('.aip-check:checked');
  const bar = document.getElementById('aip-publish-bar');
  const count = document.getElementById('aip-selected-count');
  if (bar) bar.classList.toggle('hidden', !checked.length);
  if (count) count.textContent = `${checked.length} makale seçili`;
}

function publishSelectedAip() {
  const bar = document.getElementById('aip-publish-bar');
  if (bar) bar.classList.remove('hidden');
  updateAipSelection();
}

async function doPublishAip() {
  const target = document.getElementById('aip-target-issue').value;
  if (!target) return toast('Hedef sayı seçin', 'warning');

  const [volume, issue] = target.split('|');
  const ids = [...document.querySelectorAll('.aip-check:checked')].map((c) => parseInt(c.dataset.id));
  if (!ids.length) return toast('Makale seçin', 'warning');

  if (!await confirmAction(`${ids.length} makale Volume ${volume}, Issue ${issue} olarak yayınlanacak. Devam?`)) return;

  try {
    const result = await API.post('/articles-in-press/publish', { articleIds: ids, volume: Number(volume), issue });
    toast(`${result.count} makale yayınlandı`);
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

async function handleAipXmlFiles(files) {
  const results = document.getElementById('aip-parsed-results');
  results.innerHTML = '<div class="text-center py-4 text-gray-500">İşleniyor...</div>';

  try {
    const parsed = await API.uploadFiles('/jats/parse-batch', files, 'xml');
    const successful = parsed.filter((r) => r.success);
    const failed = parsed.filter((r) => !r.success);

    let html = '';
    if (failed.length) {
      html += failed.map((r) => `<div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm"><strong class="text-red-700">${esc(r.filename)}</strong>: ${esc(r.error)}</div>`).join('');
    }
    if (successful.length) {
      html += `<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <span class="text-sm font-medium text-gray-700">${successful.length} makale parse edildi</span>
        <button onclick="importAipBatch()" class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Baskıda Olarak Aktar</button>
      </div>`;
      html += `<div class="space-y-1">${successful.map((r) => `
        <div class="text-sm px-3 py-1.5"><span class="px-2 py-0.5 bg-gray-200 rounded text-xs">${esc(r.article.type)}</span> <span class="ml-1">${esc(r.article.title)}</span></div>`).join('')}
      </div>`;
    }
    results.innerHTML = html;
    window._aipParsedArticles = parsed;
  } catch (err) {
    results.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded-lg">${esc(err.message)}</div>`;
  }
}

async function importAipBatch() {
  const parsed = window._aipParsedArticles;
  if (!parsed) return;
  const toImport = parsed.filter((r) => r.success).map((r) => r.article);
  if (!toImport.length) return;

  try {
    const result = await API.post('/jats/import-in-press', { parsedArticles: toImport });
    if (result.totalImported) toast(`${result.totalImported} makale baskıda olarak eklendi`);
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteAip(id) {
  if (!await confirmAction('Bu baskıda makaleyi silmek istediğinizden emin misiniz?')) return;
  try {
    await API.del(`/articles-in-press/${id}`);
    toast('Makale silindi');
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
  try {
    const item = await API.get(`/news/${id}`);
    renderNewsForm(el, item);
  } catch {
    el.innerHTML = '<p class="text-red-600">Haber bulunamadı.</p>';
  }
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

  // Track unsaved changes
  clearDirty();
  el.addEventListener('input', markDirty);
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
  if (!data.title) { toast('Başlık zorunludur', 'error'); return; }
  try {
    if (id === null) {
      const result = await API.post('/news', data);
      clearDirty();
      toast('Haber oluşturuldu');
      navigate(`#/news/${result.id}`);
    } else {
      await API.put(`/news/${id}`, data);
      clearDirty();
      toast('Haber güncellendi');
    }
  } catch (err) { toast(err.message, 'error'); }
}

// Media Management
route('/media', async (el) => {
  const stats = await API.get('/media/stats');

  el.innerHTML = `
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Medya Yönetimi</h1>

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="bg-white rounded-xl border p-5">
        <div class="text-3xl font-bold text-teal-700">${stats.pdfCount}</div>
        <div class="text-sm text-gray-500 mt-1">PDF Dosyası</div>
      </div>
      <div class="bg-white rounded-xl border p-5">
        <div class="text-3xl font-bold ${stats.withoutPdf ? 'text-red-600' : 'text-green-600'}">${stats.withoutPdf}</div>
        <div class="text-sm text-gray-500 mt-1">PDF'siz Makale</div>
      </div>
      <div class="bg-white rounded-xl border p-5">
        <div class="text-3xl font-bold text-blue-600">${stats.figureCount}</div>
        <div class="text-sm text-gray-500 mt-1">Figür Dosyası</div>
      </div>
      <div class="bg-white rounded-xl border p-5">
        <div class="text-3xl font-bold text-purple-600">${stats.suppCount}</div>
        <div class="text-sm text-gray-500 mt-1">Ek Materyal</div>
      </div>
    </div>

    <!-- Batch PDF Upload -->
    <div class="bg-white rounded-xl border p-5 mb-6">
      <h2 class="font-semibold text-gray-900 mb-3">Toplu PDF Yükle</h2>
      <p class="text-sm text-gray-500 mb-3">Dosya adı makale ID'si ile eşleştirilir (ör. 2805.pdf → Makale #2805)</p>
      <div id="pdf-drop-zone" class="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-teal-400 transition-colors cursor-pointer">
        <p class="text-gray-600 font-medium">PDF dosyalarını sürükleyin veya tıklayın</p>
        <input id="pdf-batch-input" type="file" accept=".pdf" multiple class="hidden">
      </div>
      <div id="pdf-batch-results" class="mt-4"></div>
    </div>

    <!-- Missing PDFs -->
    ${stats.withoutPdf > 0 ? `
    <div class="bg-white rounded-xl border p-5 mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-gray-900">PDF'siz Makaleler</h2>
        <button onclick="loadMissingPdfs()" class="text-sm text-teal-600 hover:text-teal-800 font-medium">Listele</button>
      </div>
      <div id="missing-pdfs-list"></div>
    </div>` : ''}

    <!-- Batch Figure Upload -->
    <div class="bg-white rounded-xl border p-5 mb-6">
      <h2 class="font-semibold text-gray-900 mb-3">Makale Figür Yükle</h2>
      <div class="flex gap-3 items-end mb-3">
        <div class="flex-1">
          <label class="block text-sm font-medium text-gray-700 mb-1">Makale ID</label>
          <input id="fig-article-id" type="number" placeholder="ör. 2805" class="w-full px-3 py-2 border rounded-lg text-sm">
        </div>
        <div>
          <label class="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium cursor-pointer">
            Figür Dosyaları Seç
            <input id="fig-files-input" type="file" accept="image/*,.tif,.tiff" multiple class="hidden">
          </label>
        </div>
      </div>
      <div id="fig-upload-results" class="mt-3"></div>
    </div>

    <!-- Supplementary Upload -->
    <div class="bg-white rounded-xl border p-5">
      <h2 class="font-semibold text-gray-900 mb-3">Ek Materyal Yükle</h2>
      <div class="flex gap-3 items-end mb-3">
        <div class="flex-1">
          <label class="block text-sm font-medium text-gray-700 mb-1">Makale ID</label>
          <input id="supp-article-id" type="number" placeholder="ör. 2805" class="w-full px-3 py-2 border rounded-lg text-sm">
        </div>
        <div>
          <label class="px-4 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 text-sm font-medium cursor-pointer">
            Dosyaları Seç
            <input id="supp-files-input" type="file" multiple class="hidden">
          </label>
        </div>
      </div>
      <div id="supp-upload-results" class="mt-3"></div>
    </div>`;

  // PDF batch upload
  const pdfDrop = document.getElementById('pdf-drop-zone');
  const pdfInput = document.getElementById('pdf-batch-input');
  pdfDrop.onclick = () => pdfInput.click();
  pdfDrop.ondragover = (e) => { e.preventDefault(); pdfDrop.classList.add('border-teal-400', 'bg-teal-50'); };
  pdfDrop.ondragleave = () => pdfDrop.classList.remove('border-teal-400', 'bg-teal-50');
  pdfDrop.ondrop = (e) => { e.preventDefault(); pdfDrop.classList.remove('border-teal-400', 'bg-teal-50'); handleBatchPdfUpload(e.dataTransfer.files); };
  pdfInput.onchange = () => handleBatchPdfUpload(pdfInput.files);

  // Figure upload
  document.getElementById('fig-files-input').onchange = async function () {
    const articleId = document.getElementById('fig-article-id').value.trim();
    if (!articleId) return toast('Makale ID giriniz', 'warning');
    if (!this.files.length) return;

    const resultsEl = document.getElementById('fig-upload-results');
    resultsEl.innerHTML = '<div class="text-sm text-gray-500">Yükleniyor...</div>';

    try {
      const result = await API.uploadFiles(`/media/upload/figures/${articleId}`, this.files, 'figures');
      resultsEl.innerHTML = `
        <div class="bg-green-50 border border-green-200 rounded-lg p-3">
          <p class="text-sm font-medium text-green-700">${result.uploaded.length} figür yüklendi</p>
          <div class="mt-2 space-y-1">${result.uploaded.map((f) => `
            <div class="text-xs text-gray-600 flex items-center gap-2">
              <img src="../${esc(f.url)}" class="h-8 w-8 object-cover rounded border" onerror="this.style.display='none'">
              <code>${esc(f.url)}</code>
            </div>`).join('')}
          </div>
          <button onclick="applyFigureMappings(${articleId})" class="mt-2 px-3 py-1.5 bg-teal-600 text-white rounded text-xs font-medium hover:bg-teal-700">Tam Metne Uygula</button>
        </div>`;
      window._lastFigureUpload = result;
    } catch (err) {
      resultsEl.innerHTML = `<div class="text-sm text-red-600">${esc(err.message)}</div>`;
    }
  };

  // Supplementary upload
  document.getElementById('supp-files-input').onchange = async function () {
    const articleId = document.getElementById('supp-article-id').value.trim();
    if (!articleId) return toast('Makale ID giriniz', 'warning');
    if (!this.files.length) return;

    const resultsEl = document.getElementById('supp-upload-results');
    resultsEl.innerHTML = '<div class="text-sm text-gray-500">Yükleniyor...</div>';

    try {
      const result = await API.uploadFiles(`/media/upload/supplementary/${articleId}`, this.files, 'files');
      resultsEl.innerHTML = `
        <div class="bg-green-50 border border-green-200 rounded-lg p-3">
          <p class="text-sm font-medium text-green-700">${result.uploaded.length} dosya yüklendi</p>
          <div class="mt-1 space-y-1">${result.uploaded.map((f) => `
            <div class="text-xs text-gray-600"><code>${esc(f.url)}</code></div>`).join('')}
          </div>
        </div>`;
    } catch (err) {
      resultsEl.innerHTML = `<div class="text-sm text-red-600">${esc(err.message)}</div>`;
    }
  };
});

async function handleBatchPdfUpload(files) {
  const results = document.getElementById('pdf-batch-results');
  results.innerHTML = '<div class="text-sm text-gray-500">Yükleniyor...</div>';

  try {
    const result = await API.uploadFiles('/media/upload/pdf-batch', files, 'pdf');
    let html = '';
    if (result.totalMatched) {
      html += `<div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-2">
        <p class="text-sm font-medium text-green-700">${result.totalMatched} PDF makale ile eşleştirildi</p>
        <div class="mt-1 text-xs text-gray-600">${result.matched.map((m) => `#${m.id} — ${esc(m.title?.slice(0, 50))}`).join('<br>')}</div>
      </div>`;
    }
    if (result.totalUnmatched) {
      html += `<div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p class="text-sm font-medium text-amber-700">${result.totalUnmatched} PDF eşleştirilemedi (yine de yüklendi)</p>
        <div class="mt-1 text-xs text-gray-600">${result.unmatched.map((u) => esc(u.filename)).join('<br>')}</div>
      </div>`;
    }
    results.innerHTML = html;
  } catch (err) {
    results.innerHTML = `<div class="text-sm text-red-600">${esc(err.message)}</div>`;
  }
}

async function loadMissingPdfs() {
  const list = document.getElementById('missing-pdfs-list');
  list.innerHTML = '<div class="text-sm text-gray-500">Yükleniyor...</div>';
  try {
    const missing = await API.get('/media/missing-pdfs');
    if (!missing.length) {
      list.innerHTML = '<div class="text-sm text-green-600">Tüm makalelerin PDF\'i mevcut.</div>';
      return;
    }
    list.innerHTML = `
      <div class="max-h-60 overflow-y-auto">
        <table class="w-full text-xs">
          <thead><tr><th class="text-left py-1 text-gray-500">ID</th><th class="text-left py-1 text-gray-500">Cilt/Sayı</th><th class="text-left py-1 text-gray-500">Başlık</th></tr></thead>
          <tbody>${missing.slice(0, 100).map((a) => `
            <tr class="border-t"><td class="py-1">${a.id}</td><td class="py-1 text-gray-400">${a.volume || '-'}/${a.issue || '-'}</td><td class="py-1 max-w-xs truncate">${esc(a.title)}</td></tr>`).join('')}
          </tbody>
        </table>
        ${missing.length > 100 ? `<p class="text-xs text-gray-400 mt-2">...ve ${missing.length - 100} makale daha</p>` : ''}
      </div>`;
  } catch (err) {
    list.innerHTML = `<div class="text-sm text-red-600">${esc(err.message)}</div>`;
  }
}

async function applyArticleFigures(articleId) {
  const upload = window._articleFigureUpload;
  if (!upload?.uploaded?.length) return;
  const mappings = upload.uploaded.map((f) => {
    const baseName = f.filename.replace(/\.[^.]+$/, '');
    return { originalHref: baseName, newUrl: f.url };
  });
  try {
    const result = await API.post(`/media/figures/${articleId}/apply`, { mappings });
    toast(`${result.replaced} figür yolu güncellendi`);
  } catch (err) { toast(err.message, 'error'); }
}

async function applyFigureMappings(articleId) {
  const upload = window._lastFigureUpload;
  if (!upload?.uploaded?.length) return;

  // Build auto-mappings: try to match by base name
  const mappings = upload.uploaded.map((f) => {
    const baseName = f.filename.replace(/\.[^.]+$/, '');
    return { originalHref: baseName, newUrl: f.url };
  });

  try {
    const result = await API.post(`/media/figures/${articleId}/apply`, { mappings });
    toast(`${result.replaced} figür yolu güncellendi`);
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
        const label = key === 'honoraryEditors' ? 'Onursal Editörler' : key === 'deputyEditors' ? 'Yardımcı Editörler' : 'Yardımcı Editörler (Geniş)';
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

// Logout
async function doLogout() {
  try {
    await API.post('/auth/logout');
  } catch { /* ignore */ }
  window.location.href = '/login';
}

// Change password
async function showChangePassword() {
  const result = await modal('Şifre Değiştir', `
    <div class="space-y-3">
      <div><label class="block text-sm font-medium text-gray-700 mb-1">Mevcut Şifre</label>
        <input id="cp-current" type="password" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
      <div><label class="block text-sm font-medium text-gray-700 mb-1">Yeni Şifre</label>
        <input id="cp-new" type="password" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
      <div><label class="block text-sm font-medium text-gray-700 mb-1">Yeni Şifre (Tekrar)</label>
        <input id="cp-confirm" type="password" class="w-full px-3 py-2 border rounded-lg text-sm"></div>
    </div>`, [
    { label: 'İptal', value: 'cancel' },
    { label: 'Değiştir', value: 'change', class: 'bg-teal-600 text-white hover:bg-teal-700' },
  ]);

  if (result !== 'change') return;

  const current = document.getElementById('cp-current')?.value;
  const newPw = document.getElementById('cp-new')?.value;
  const confirm = document.getElementById('cp-confirm')?.value;

  if (!current || !newPw) return toast('Tüm alanları doldurun', 'warning');
  if (newPw !== confirm) return toast('Yeni şifreler eşleşmiyor', 'error');
  if (newPw.length < 6) return toast('Şifre en az 6 karakter olmalı', 'warning');

  try {
    await API.post('/auth/change-password', { currentPassword: current, newPassword: newPw });
    toast('Şifre değiştirildi');
  } catch (err) { toast(err.message, 'error'); }
}

// Init
document.addEventListener('DOMContentLoaded', handleRoute);
