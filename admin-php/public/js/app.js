/**
 * Admin Panel — SPA Router & Shell
 */

// --- Categorical badge color mapper ---
// We previously rendered every article type in a different hue (violet, rose,
// sky, fuchsia, …), which produced a busy, eye-tiring table. Now categories
// render in a single neutral tone so the table stays calm. The few badges
// that *do* carry meaning (success/warning/info) keep their semantic colors.
function badgeColorFor() { return 'badge-neutral'; }
function typeBadge(type) {
  if (!type) return '<span class="badge badge-neutral">—</span>';
  return `<span class="badge badge-neutral">${esc(type)}</span>`;
}

// --- Page header helper ---
// Renders a consistent page header: eyebrow + title + subtitle on the left, actions on the right.
// `title` is always escaped (plain text). `subtitle` is treated as HTML so callers
// can use <strong>, <code>, etc. — callers are responsible for escaping any
// untrusted user content inside subtitle themselves.
// Usage:
//   pageHeader({ title: 'Makaleler', subtitle: '127 toplam', eyebrow: 'İçerik' })
//   pageHeader({ title: 'Dashboard', subtitle: 'Toplu işlem <strong>açık</strong>' })
function pageHeader({ title, subtitle, eyebrow, actions } = {}) {
  return `
    <header class="page-header">
      <div class="min-w-0">
        ${eyebrow ? `<div class="page-eyebrow">${esc(eyebrow)}</div>` : ''}
        <h1 class="page-title">${esc(title || '')}</h1>
        ${subtitle ? `<div class="page-subtitle">${subtitle}</div>` : ''}
      </div>
      ${actions ? `<div class="flex items-center gap-2 flex-shrink-0">${actions}</div>` : ''}
    </header>`;
}

// --- Toast (premium: with icon, slide-in animation, stacked) ---
let _toastCount = 0;
function toast(msg, type = 'success') {
  const offset = _toastCount * 56;
  _toastCount++;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.style.top = `${16 + offset}px`;
  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };
  el.innerHTML = `${icons[type] || icons.success}<span>${esc(msg)}</span>`;
  document.body.appendChild(el);
  // trigger entrance animation on next frame
  requestAnimationFrame(() => el.classList.add('is-visible'));
  setTimeout(() => {
    el.classList.remove('is-visible');
    _toastCount = Math.max(0, _toastCount - 1);
    setTimeout(() => el.remove(), 220);
  }, 3000);
}

// --- Debounce ---
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// --- Byte formatter ---
function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function dateInputValue(value) {
  if (!value) return '';
  return _parsePastedDateToISO(value) || '';
}

function articleDateSequenceError({ received, accepted, publishedOnline, published }) {
  const ts = (value) => value ? new Date(value + 'T00:00:00Z').getTime() : 0;
  const receivedTs = ts(received);
  const acceptedTs = ts(accepted);
  const onlineTs = ts(publishedOnline);
  const publishedTs = ts(published);
  if (receivedTs && acceptedTs && acceptedTs < receivedTs) {
    return 'Kabul tarihi, alındığı tarihten önce olamaz.';
  }
  if (acceptedTs && onlineTs && onlineTs < acceptedTs) {
    return 'Çevrimiçi yayın tarihi, kabul tarihinden önce olamaz.';
  }
  if (acceptedTs && publishedTs && publishedTs < acceptedTs) {
    return 'Makale yayın tarihi, kabul tarihinden önce olamaz.';
  }
  return '';
}

// --- Classify a FileList into {pdf, figure, other} with totals ---
function classifyFiles(files) {
  const IMG_RE = /\.(jpe?g|png|webp|gif|svg|tiff?)$/i;
  const PDF_RE = /\.pdf$/i;
  const out = { pdf: [], figure: [], other: [], totalBytes: 0, totalCount: 0 };
  for (const f of files) {
    if (PDF_RE.test(f.name)) out.pdf.push(f);
    else if (IMG_RE.test(f.name)) out.figure.push(f);
    else out.other.push(f);
    out.totalBytes += f.size || 0;
    out.totalCount += 1;
  }
  return out;
}

// --- Shared upload progress UI ---
// Renders a progress card into `container` (element or id) and returns an updater
// object with `update(pct, loaded, total)`, `complete(successHtml)`, and `fail(msg)`.
function renderUploadProgress(container, files, label = 'Yükleniyor') {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return { update() {}, complete() {}, fail() {} };
  const info = classifyFiles(files);
  const counts = [
    info.pdf.length ? `${info.pdf.length} PDF` : '',
    info.figure.length ? `${info.figure.length} figür` : '',
    info.other.length ? `${info.other.length} diğer` : '',
  ].filter(Boolean).join(' · ') || `${info.totalCount} dosya`;
  const totalHuman = formatBytes(info.totalBytes);
  const uid = 'up-' + Math.random().toString(36).slice(2, 8);
  el.innerHTML = `
    <div id="${uid}" class="bg-white border rounded-xl p-4">
      <div class="flex items-center justify-between mb-2">
        <div class="min-w-0">
          <div class="font-medium text-gray-900 text-sm truncate">${esc(label)} — ${esc(counts)}</div>
          <div class="text-xs text-gray-500 mt-0.5" data-role="label">Yükleniyor... 0%</div>
        </div>
        <div class="text-xs text-gray-500 flex-shrink-0 ml-3" data-role="bytes">0 B / ${esc(totalHuman)}</div>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div data-role="bar" class="h-full bg-teal-600 transition-all duration-150" style="width: 0%"></div>
      </div>
    </div>`;
  const root = document.getElementById(uid);
  const bar = root.querySelector('[data-role="bar"]');
  const lbl = root.querySelector('[data-role="label"]');
  const byt = root.querySelector('[data-role="bytes"]');
  return {
    info,
    update(pct, loaded, total) {
      if (bar) bar.style.width = pct + '%';
      if (byt) byt.textContent = `${formatBytes(loaded)} / ${formatBytes(total)}`;
      if (lbl) lbl.textContent = pct < 100 ? `Yükleniyor... ${pct}%` : 'Sunucu dosyaları işliyor...';
    },
    // Replace progress card with a success block (caller supplies HTML).
    complete(successHtml) {
      el.innerHTML = successHtml;
    },
    fail(msg) {
      el.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">${esc(msg)}</div>`;
    },
  };
}

// --- Modal (premium: backdrop blur, soft shadow, scale-in animation) ---
function modal(title, bodyHtml, actions = []) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-dialog">
        <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
          <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">${title}</h3>
          <button class="modal-close p-1.5 rounded-md transition-colors" style="color:var(--text-muted)" onmouseover="this.style.background='var(--bg-subtle)'" onmouseout="this.style.background='transparent'" aria-label="Kapat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="px-6 py-5 overflow-y-auto flex-1">${bodyHtml}</div>
        <div class="flex justify-end gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
          ${actions.map((a) => `<button class="modal-action btn ${a.class || 'btn-secondary'}" data-action="${a.value || ''}">${a.label}</button>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('.modal-close').onclick = () => close(null);
    overlay.querySelectorAll('.modal-action').forEach((btn) => {
      btn.onclick = () => close(btn.dataset.action);
    });
    // Click outside to dismiss
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    // Esc to dismiss
    const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(null); } };
    document.addEventListener('keydown', onKey);
  });
}

// --- Confirm (premium: clearer typography + danger styling) ---
async function confirmAction(msg) {
  const result = await modal('Onay', `<p style="color:var(--text)">${esc(msg)}</p>`, [
    { label: 'İptal', value: 'cancel', class: 'btn-secondary' },
    { label: 'Evet, onaylıyorum', value: 'confirm', class: 'btn-danger-solid' },
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
  // Split off the query string so '#/foo/bar?tab=x' still matches '/foo/bar'.
  // Query params are exposed to handlers via params.query (URLSearchParams).
  const rawPath = hash.replace(/^#\/?/, '/');
  const [path, queryString = ''] = rawPath.split('?');
  const query = new URLSearchParams(queryString);
  for (const [pattern, handler] of Object.entries(routes)) {
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
    const match = path.match(regex);
    if (match) return { handler, params: { ...(match.groups || {}), query } };
  }
  return null;
}

async function handleRoute() {
  const hash = window.location.hash || '#/';
  const main = document.getElementById('main-content');

  // Unsaved changes guard: if form is dirty, confirm before leaving
  if (_formDirty && _lastHash && _lastHash !== hash) {
    const prev = _lastHash;
    _formDirty = false; // avoid re-entry while confirm is open
    const ok = await confirmAction('Kaydedilmemiş değişiklikler var. Sayfadan ayrılmak istediğinizden emin misiniz?');
    if (!ok) {
      _formDirty = true;
      _updateDirtyIndicator();
      // revert URL without re-triggering handleRoute
      history.replaceState(null, '', prev);
      return;
    }
  }

  const match = matchRoute(hash);
  clearDirty();

  // Update active sidebar link — use the .is-active class hooked by stylesheet
  const navItems = document.querySelectorAll('[data-nav]');
  // Map article-edit (/articles/:id) and AIP-edit (/articles-in-press/:id/edit)
  // to their browsing sections so the right sidebar entry stays highlighted.
  let navHash = hash;
  if (/^#\/articles\/\d+/.test(hash)) navHash = '#/issues';            // article edit → Sayılar
  else if (/^#\/articles-in-press\//.test(hash)) navHash = '#/articles-in-press'; // AIP edit → e-Pub
  // Find the most specific (longest matching prefix) nav target.
  let bestMatch = null; let bestLen = 0;
  navItems.forEach((el) => {
    const target = el.dataset.nav;
    if (navHash === target || navHash.startsWith(target + '/') || (target === '#/' && navHash === '#/')) {
      if (target.length > bestLen) { bestMatch = el; bestLen = target.length; }
    }
  });
  navItems.forEach((el) => el.classList.toggle('is-active', el === bestMatch));

  if (match) {
    try {
      // Premium skeleton loader: page header + cards
      main.innerHTML = `
        <div style="opacity:.7">
          <div class="page-header">
            <div class="min-w-0" style="width:60%">
              <div class="skeleton" style="height:11px;width:90px;margin-bottom:8px"></div>
              <div class="skeleton" style="height:24px;width:60%;margin-bottom:6px"></div>
              <div class="skeleton" style="height:12px;width:40%"></div>
            </div>
            <div class="flex gap-2"><div class="skeleton" style="height:34px;width:100px"></div></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            ${Array(4).fill('<div class="card card-padded"><div class="skeleton" style="height:11px;width:50%;margin-bottom:14px"></div><div class="skeleton" style="height:28px;width:35%;margin-bottom:6px"></div><div class="skeleton" style="height:10px;width:60%"></div></div>').join('')}
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            ${Array(2).fill('<div class="card card-padded"><div class="skeleton" style="height:14px;width:30%;margin-bottom:18px"></div><div class="space-y-3">' + Array(5).fill('<div class="flex items-center gap-3"><div class="skeleton" style="height:24px;width:24px;border-radius:6px"></div><div class="skeleton" style="height:12px;flex:1"></div><div class="skeleton" style="height:12px;width:40px"></div></div>').join('') + '</div></div>').join('')}
          </div>
        </div>`;
      await match.handler(main, match.params);
      // After the route renders, wire up WYSIWYG paste interception on every
      // visual editor that now exists in the DOM. Idempotent — same editor
      // won't be wired twice (see _pasteAttached flag).
      wireAllWysiwygPasteHandlers();
    } catch (err) {
      main.innerHTML = `
        <div class="card card-padded" style="border-color:#fecaca;background:#fef2f2">
          <div class="flex items-start gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:2px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div>
              <div class="font-semibold" style="color:#991b1b">Bir şeyler ters gitti</div>
              <div class="text-sm mt-1" style="color:#b91c1c">${esc(err.message)}</div>
            </div>
          </div>
        </div>`;
    }
  } else {
    main.innerHTML = '<div class="text-center py-20" style="color:var(--text-muted)">Sayfa bulunamadı.</div>';
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
let _lastHash = window.location.hash;
function _updateDirtyIndicator() {
  document.querySelectorAll('[data-dirty-indicator]').forEach((el) => {
    el.textContent = _formDirty ? ' •' : '';
  });
}
// When `true`, markDirty() calls are silently dropped. We flip this on
// while the full-text loader runs initial DOM normalisations (assigning
// figure IDs, collapsing Word reference lists, auto-linking plain text)
// — those mutations come from the system, not the editor, so they
// shouldn't trigger the "unsaved changes" indicator or the navigation
// confirm prompt. The flag is reset right after the load completes.
let _suppressDirty = false;
function markDirty() {
  if (_suppressDirty) return;
  if (!_formDirty) { _formDirty = true; _updateDirtyIndicator(); }
}
function clearDirty() {
  if (_formDirty) { _formDirty = false; _updateDirtyIndicator(); }
  _lastHash = window.location.hash;
}
window.addEventListener('beforeunload', (e) => {
  if (_formDirty) { e.preventDefault(); e.returnValue = ''; }
});

// --- Row drag-and-drop (used by author/AIP author rows) -----------------
// A six-dot grip glyph users can grab to reorder rows.
const ROW_GRIP_SVG = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" focusable="false"><circle cx="2" cy="3"  r="1.2"/><circle cx="8" cy="3"  r="1.2"/><circle cx="2" cy="8"  r="1.2"/><circle cx="8" cy="8"  r="1.2"/><circle cx="2" cy="13" r="1.2"/><circle cx="8" cy="13" r="1.2"/></svg>';

// Document-level delegated DnD: works for any current/future rows whose class
// is registered in ROW_DND_SELECTORS. Saves rewiring per-render.
const ROW_DND_SELECTORS = ['.author-row', '.aipf-author-row', '.aip-list-row', '.ed-mrow', '.aff-row', '.aipf-aff-row', '.hs-row', '.banner-row'];
let _dndSrc = null;

function _dndRowFromEvent(e) {
  for (const sel of ROW_DND_SELECTORS) {
    const r = e.target.closest(sel);
    if (r) return r;
  }
  return null;
}
function _dndClearIndicators() {
  document.querySelectorAll('.drop-above, .drop-below').forEach((r) => {
    r.classList.remove('drop-above', 'drop-below');
  });
}

document.addEventListener('dragstart', (e) => {
  const row = _dndRowFromEvent(e);
  if (!row || row.getAttribute('draggable') !== 'true') return;
  _dndSrc = row;
  row.classList.add('row-dragging');
  try {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'row');
  } catch (_) { /* Safari quirks */ }
});
document.addEventListener('dragover', (e) => {
  if (!_dndSrc) return;
  const row = _dndRowFromEvent(e);
  if (!row || row === _dndSrc) return;
  // Only react when hovering a row from the same list as the source.
  if (row.parentNode !== _dndSrc.parentNode) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  _dndClearIndicators();
  const rect = row.getBoundingClientRect();
  const above = (e.clientY - rect.top) < rect.height / 2;
  row.classList.add(above ? 'drop-above' : 'drop-below');
});
document.addEventListener('drop', (e) => {
  if (!_dndSrc) return;
  const row = _dndRowFromEvent(e);
  if (row && row !== _dndSrc && row.parentNode === _dndSrc.parentNode) {
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const above = (e.clientY - rect.top) < rect.height / 2;
    if (_dndSrc.classList.contains('aip-list-row')) {
      _aipReorderByDrop(_dndSrc, row, above);
    } else if (_dndSrc.classList.contains('hs-row')) {
      // Homepage section (manual): reorder the _hsState.ids[key] array + re-render.
      _hsReorderByDrop(_dndSrc, row, above);
    } else if (_dndSrc.classList.contains('banner-row')) {
      // Hero banners: reorder the iframe slides + keep the carousel in sync.
      _bannerReorderByDrop(_dndSrc, row, above);
    } else if (_dndSrc.classList.contains('ed-mrow')) {
      // Editorial Board is model-driven: mutate _edModel and re-render
      // instead of touching the DOM directly (the re-render restores the
      // #N badges and disabled states on the ↑/↓ buttons).
      _edReorderMemberByDrop(_dndSrc, row, above);
    } else if (_dndSrc.classList.contains('aff-row') || _dndSrc.classList.contains('aipf-aff-row')) {
      // Affiliations: re-order + renumber badges + remap author index inputs
      // so that authors keep pointing to the right institution after the move.
      _reorderAffiliationByDrop(_dndSrc, row, above);
    } else {
      row.parentNode.insertBefore(_dndSrc, above ? row : row.nextSibling);
      markDirty();
    }
  }
  _dndClearIndicators();
  if (_dndSrc) {
    _dndSrc.classList.remove('row-dragging');
    _dndSrc.removeAttribute('draggable');
  }
  _dndSrc = null;
});

// --- Affiliation helpers (shared by Article + AIP editors) --------------
// Build a deduplicated affiliations list from authors[] (each `.affiliation`
// is a free-text string optionally containing "; "-separated institutions).
// Returns the unique list (insertion order, case-insensitive dedup) plus a
// parallel `authorIdx` array with each author's "1" / "1,2" index string.
function buildAffiliationsFromAuthors(authors) {
  const list = [];
  const indexByKey = {};
  const authorIdx = [];
  (authors || []).forEach((au) => {
    const raw = String((au && au.affiliation) || '').trim();
    if (!raw) { authorIdx.push(''); return; }
    const parts = raw.split(/\s*;\s*/).map((p) => p.trim()).filter(Boolean);
    const idxs = [];
    parts.forEach((p) => {
      const key = p.toLowerCase();
      if (!indexByKey[key]) {
        list.push(p);
        indexByKey[key] = list.length;
      }
      idxs.push(indexByKey[key]);
    });
    authorIdx.push(idxs.join(','));
  });
  return { affiliations: list, authorIdx };
}

// Look up "1,2" against affList and return "Text1; Text2". Drops out-of-range
// or empty-text references silently — validation is the caller's job.
function joinAffiliationsByIdx(idxStr, affList) {
  return String(idxStr || '')
    .split(/[,\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= affList.length)
    .map((n) => affList[n - 1])
    .filter((t) => t && t.trim())
    .join('; ');
}

// Rewrite an author-row index string like "1,3" through a mapping object
// `{1:2, 3:1, ...}` (old position -> new position; missing keys are dropped).
function remapAffIndices(str, mapping) {
  const seen = {};
  return String(str || '')
    .split(/[,\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && mapping[n] != null)
    .map((n) => mapping[n])
    .filter((n) => { if (seen[n]) return false; seen[n] = true; return true; })
    .join(',');
}

function affRow(text, num) {
  return `<div class="flex gap-2 items-center p-2 bg-white border border-gray-200 rounded-lg aff-row" ondragend="this.removeAttribute('draggable')">
    <span class="row-grip" title="Sıralamak için tutup sürükleyin" aria-label="Sürükle" onmousedown="this.closest('.aff-row').setAttribute('draggable','true')">${ROW_GRIP_SVG}</span>
    <span class="aff-num inline-flex items-center justify-center w-7 h-7 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold flex-shrink-0">${num}</span>
    <input class="aff-text flex-1 px-2 py-1.5 border rounded text-sm" placeholder="Kurum adı (ör. Department of X, Y University, City, Country)" value="${esc(text || '')}" oninput="markDirty()">
    <button onclick="removeAffiliationRow(this); markDirty();" class="text-red-400 hover:text-red-600 text-lg px-1" title="Bu kurumu sil">&times;</button>
  </div>`;
}

function aipfAffRow(text, num) {
  return `<div class="flex gap-2 items-center p-2 bg-white border border-gray-200 rounded-lg aipf-aff-row" ondragend="this.removeAttribute('draggable')">
    <span class="row-grip" title="Sıralamak için tutup sürükleyin" aria-label="Sürükle" onmousedown="this.closest('.aipf-aff-row').setAttribute('draggable','true')">${ROW_GRIP_SVG}</span>
    <span class="aff-num inline-flex items-center justify-center w-7 h-7 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold flex-shrink-0">${num}</span>
    <input class="aipf-aff-text flex-1 px-2 py-1.5 border rounded text-sm" placeholder="Kurum adı (ör. Department of X, Y University, City, Country)" value="${esc(text || '')}" oninput="markDirty()">
    <button onclick="removeAffiliationRow(this); markDirty();" class="text-red-400 hover:text-red-600 text-lg px-1" title="Bu kurumu sil">&times;</button>
  </div>`;
}

function addAffiliation() {
  const list = document.getElementById('affiliations-list');
  if (!list) return;
  list.insertAdjacentHTML('beforeend', affRow('', list.children.length + 1));
  markDirty();
}

function addAipAffiliation() {
  const list = document.getElementById('aipf-affiliations-list');
  if (!list) return;
  list.insertAdjacentHTML('beforeend', aipfAffRow('', list.children.length + 1));
  markDirty();
}

// Renumber the badges in an affiliations list and rewrite every author row's
// affiliation-index input through the supplied mapping (old pos -> new pos).
function _applyAffMapping(listEl, mapping) {
  Array.from(listEl.children).forEach((r, i) => {
    const badge = r.querySelector('.aff-num');
    if (badge) badge.textContent = String(i + 1);
  });
  const isAip = listEl.id === 'aipf-affiliations-list';
  const inputSel = isAip ? '.aipf-au-aff-idx' : '.au-aff-idx';
  document.querySelectorAll(inputSel).forEach((inp) => {
    inp.value = remapAffIndices(inp.value, mapping);
  });
}

function removeAffiliationRow(btn) {
  const row = btn.closest('.aff-row, .aipf-aff-row');
  if (!row) return;
  const list = row.parentNode;
  const rows = Array.from(list.children);
  const deletedPos = rows.indexOf(row) + 1;
  const mapping = {};
  rows.forEach((_, i) => {
    const oldPos = i + 1;
    if (oldPos === deletedPos) return; // dropped
    mapping[oldPos] = oldPos < deletedPos ? oldPos : oldPos - 1;
  });
  row.remove();
  _applyAffMapping(list, mapping);
}

function _reorderAffiliationByDrop(srcRow, tgtRow, above) {
  const list = srcRow.parentNode;
  // Tag current positions so we can compute new ones after the DOM move.
  Array.from(list.children).forEach((r, i) => { r.dataset.oldPos = String(i + 1); });
  list.insertBefore(srcRow, above ? tgtRow : tgtRow.nextSibling);
  const mapping = {};
  Array.from(list.children).forEach((r, i) => {
    const oldPos = parseInt(r.dataset.oldPos, 10);
    if (Number.isFinite(oldPos)) mapping[oldPos] = i + 1;
    delete r.dataset.oldPos;
  });
  _applyAffMapping(list, mapping);
  markDirty();
}

// Read affiliation texts from a list element, preserving order. Trailing
// empties are trimmed so a fresh blank "+ Kurum Ekle" row doesn't leave a
// stray "; " on the saved string.
function _collectAffList(listEl, textSel) {
  if (!listEl) return [];
  const arr = Array.from(listEl.querySelectorAll(textSel)).map((i) => i.value.trim());
  while (arr.length && !arr[arr.length - 1]) arr.pop();
  return arr;
}

function _edReorderMemberByDrop(srcRow, tgtRow, above) {
  const si = Number(srcRow.dataset.sec);
  if (si !== Number(tgtRow.dataset.sec)) return;
  if (typeof _edModel === 'undefined' || !_edModel || !_edModel.sections[si]) return;
  edSyncModel();
  const arr = _edModel.sections[si].members || [];
  const from = Number(srcRow.dataset.mem);
  let to = Number(tgtRow.dataset.mem);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
  const [item] = arr.splice(from, 1);
  // After splice, indices above `from` shift down by one.
  if (to > from) to -= 1;
  if (!above) to += 1;
  arr.splice(to, 0, item);
  renderEditorialForm();
  markDirty();
}
document.addEventListener('dragend', () => {
  _dndClearIndicators();
  if (_dndSrc) {
    _dndSrc.classList.remove('row-dragging');
    _dndSrc.removeAttribute('draggable');
  }
  _dndSrc = null;
});
// If the user mousedowns on the grip but releases without dragging, the
// row keeps draggable=true; later, dragging inside an <input> would move
// the row instead of selecting text. Clean any stray flags on mouseup.
document.addEventListener('mouseup', () => {
  if (_dndSrc) return; // active drag, dragend will handle cleanup
  document.querySelectorAll('.author-row[draggable="true"], .aipf-author-row[draggable="true"], .aip-list-row[draggable="true"], .ed-mrow[draggable="true"], .aff-row[draggable="true"], .aipf-aff-row[draggable="true"]').forEach((r) => {
    r.removeAttribute('draggable');
  });
});

// --- Register routes ---

// Dashboard
route('/', async (el) => {
  const [stats, homepage, topArticles, mediaStats, aipList] = await Promise.all([
    API.get('/stats'),
    API.get('/homepage').catch(() => ({})),
    API.get('/stats/top-articles?limit=5').catch(() => ({ topViewed: [], topDownloaded: [], totals: { views: 0, downloads: 0 } })),
    API.get('/media/stats').catch(() => ({ pdfCount: 0, withoutPdf: 0 })),
    API.get('/articles-in-press').catch(() => []),
  ]);
  // System health derived after cur is computed below
  const aipWithoutPdf = aipList.filter(a => !a.pdfUrl).length;
  const aipWithoutFullText = aipList.filter(a => !a.hasFullText).length;

  const cur = homepage?.currentIssue || {};

  // Build the "Yapılacaklar" health checklist
  const todoItems = [];
  if (!cur.volume) {
    todoItems.push({ tone: 'warning', title: 'Henüz güncel sayı atanmamış', hint: 'Bir sayıyı güncel olarak işaretleyin', hash: '#/issues' });
  }
  if ((mediaStats.withoutPdf || 0) > 0) {
    todoItems.push({ tone: 'warning', title: `${mediaStats.withoutPdf} makalede PDF eksik`, hint: 'Dosya Yönetimi → Toplu PDF Yükle', hash: '#/media' });
  }
  if (aipWithoutPdf > 0) {
    todoItems.push({ tone: 'info', title: `${aipWithoutPdf} baskıda makalede PDF eksik`, hint: 'AIP listesinde durum sütununu kontrol edin', hash: '#/articles-in-press' });
  }
  if (aipWithoutFullText > 0) {
    todoItems.push({ tone: 'info', title: `${aipWithoutFullText} baskıda makalede tam metin yok`, hint: 'Tam metin yükleyin veya manuel girin', hash: '#/articles-in-press' });
  }
  if (todoItems.length === 0) {
    todoItems.push({ tone: 'success', title: 'Sistem tamam', hint: 'Tüm temel kontroller geçti', hash: null });
  }
  function todoRow(t) {
    const palette = {
      warning: { bg: 'var(--warning-soft)', border: 'var(--warning-soft-2)', fg: 'var(--warning-text)' },
      info:    { bg: 'var(--info-soft)',    border: 'var(--info-soft-2)',    fg: 'var(--info-text)' },
      success: { bg: 'var(--success-soft)', border: 'var(--success-soft-2)', fg: 'var(--success-text)' },
    };
    const c = palette[t.tone] || palette.info;
    const dotSvg = t.tone === 'success'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    const Tag = t.hash ? 'a' : 'div';
    const hrefAttr = t.hash ? `href="${t.hash}"` : '';
    return `<${Tag} ${hrefAttr} class="flex items-start gap-3 px-3 py-2.5 rounded-md transition-colors" style="background:${c.bg};border:1px solid ${c.border};text-decoration:none">
      <span style="color:${c.fg};flex-shrink:0;margin-top:1px">${dotSvg}</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium" style="color:${c.fg}">${esc(t.title)}</div>
        <div class="text-xs mt-0.5" style="color:${c.fg};opacity:.85">${esc(t.hint)}</div>
      </div>
      ${t.hash ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:${c.fg};opacity:.6;flex-shrink:0;margin-top:3px"><polyline points="9 18 15 12 9 6" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
    </${Tag}>`;
  }

  const typeEntries = Object.entries(stats.typeCounts || {}).sort((a, b) => b[1] - a[1]);
  const maxTypeCount = typeEntries.length ? typeEntries[0][1] : 1;
  const typeRows = typeEntries.map(([t, c]) => {
    const pct = Math.round((c / maxTypeCount) * 100);
    return `<tr>
      <td class="py-2.5 pr-3" style="color:var(--text)">${esc(t)}</td>
      <td class="py-2.5 w-1/2">
        <div class="h-1.5 rounded-full overflow-hidden" style="background:var(--bg-subtle)">
          <div style="width:${pct}%;height:100%;background:var(--brand);border-radius:999px"></div>
        </div>
      </td>
      <td class="py-2.5 pl-3 text-right tabular-nums font-semibold" style="color:var(--text-strong)">${c}</td>
    </tr>`;
  }).join('');

  function _topRankChip(i, accent) {
    const colors = {
      view: ['var(--info-soft)', 'var(--info-text)'],
      dl:   ['var(--success-soft)', 'var(--success-text)'],
    };
    const [bg, fg] = colors[accent] || colors.view;
    return `<span class="flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold flex-shrink-0 tabular" style="background:${bg};color:${fg}">${i + 1}</span>`;
  }
  function dashTopList(items) {
    if (!items.length) return '<div class="py-8 text-center text-sm" style="color:var(--text-faint)">Henüz veri yok</div>';
    return items.map((a, i) => `
      <button type="button" onclick="navigate('#/articles/${a.id}')" class="w-full flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-md text-left hover:bg-slate-50 transition-colors">
        ${_topRankChip(i, 'view')}
        <span class="flex-1 text-sm truncate" style="color:var(--text-strong)">${esc(a.title)}</span>
        <span class="text-sm font-semibold tabular" style="color:var(--info)">${(a.views || 0).toLocaleString()}</span>
      </button>`).join('');
  }
  function dashTopListDownloads(items) {
    if (!items.length) return '<div class="py-8 text-center text-sm" style="color:var(--text-faint)">Henüz veri yok</div>';
    return items.map((a, i) => `
      <button type="button" onclick="navigate('#/articles/${a.id}')" class="w-full flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-md text-left hover:bg-slate-50 transition-colors">
        ${_topRankChip(i, 'dl')}
        <span class="flex-1 text-sm truncate" style="color:var(--text-strong)">${esc(a.title)}</span>
        <span class="text-sm font-semibold tabular" style="color:var(--success)">${(a.downloads || 0).toLocaleString()}</span>
      </button>`).join('');
  }

  // Stat card builder — subtle colored accent strip (top border) per category
  function statCard(label, value, hint, accent = 'brand') {
    const colors = {
      brand:   ['var(--brand)',          'var(--brand-soft)'],
      info:    ['var(--info)',           'var(--info-soft)'],
      success: ['var(--success)',        'var(--success-soft)'],
      warning: ['var(--warning)',        'var(--warning-soft)'],
      violet:  ['var(--accent-violet)',  'var(--accent-violet-soft)'],
      sky:     ['var(--accent-sky)',     'var(--accent-sky-soft)'],
    };
    const [fg, bg] = colors[accent] || colors.brand;
    return `
      <div class="card card-padded relative overflow-hidden">
        <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${fg}"></div>
        <div class="flex items-center gap-2">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:${bg};color:${fg};font-weight:700;font-size:13px">${esc(label.charAt(0))}</span>
          <div class="text-xs font-semibold" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:.07em">${esc(label)}</div>
        </div>
        <div class="text-3xl font-bold mt-3 tabular" style="color:var(--text-strong);letter-spacing:-0.025em">${value.toLocaleString()}</div>
        ${hint ? `<div class="text-xs mt-0.5" style="color:var(--text-faint)">${esc(hint)}</div>` : ''}
      </div>`;
  }

  // Quick action tile with subtle category accent
  function actionTile(href, icon, label, hint, onclick, accent = 'brand') {
    const colors = {
      brand:   ['var(--brand-soft)',          'var(--brand)'],
      info:    ['var(--info-soft)',           'var(--info)'],
      success: ['var(--success-soft)',        'var(--success)'],
      violet:  ['var(--accent-violet-soft)',  'var(--accent-violet)'],
      sky:     ['var(--accent-sky-soft)',     'var(--accent-sky)'],
    };
    const [bg, fg] = colors[accent] || colors.brand;
    const open = href ? `<a href="${href}"` : `<button type="button" onclick="${onclick}"`;
    const close = href ? `</a>` : `</button>`;
    return `${open} class="card card-padded text-left transition-all hover:-translate-y-0.5 hover:shadow-md" style="text-decoration:none">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:${bg};color:${fg}">${icon}</div>
        <div class="font-semibold text-sm" style="color:var(--text-strong)">${esc(label)}</div>
      </div>
      <div class="text-xs leading-relaxed" style="color:var(--text-muted)">${esc(hint)}</div>
    ${close}`;
  }

  el.innerHTML = `
    ${pageHeader({ eyebrow: 'Genel Bakış', title: 'Dashboard', subtitle: 'Sitenin güncel durumu ve hızlı erişim' })}

    <!-- Current Issue hero -->
    <div class="card-hero card-padded mb-6 flex items-center justify-between flex-wrap gap-3">
      <div>
        <div class="text-xs font-semibold tracking-wider uppercase" style="color:var(--brand)">Güncel Sayı</div>
        ${cur.volume
          ? `<div class="text-xl font-semibold mt-1.5" style="color:var(--text-strong);letter-spacing:-0.02em">Volume ${esc(cur.volume)}, Issue ${esc(cur.issue)}${cur.year ? ` <span class="text-base font-normal" style="color:var(--text-muted)">(${esc(cur.year)})</span>` : ''}</div>
             <div class="text-xs mt-1" style="color:var(--text-muted)">${(homepage.featuredArticles || []).length} öne çıkan · ${(homepage.imageCornerArticles || []).length} görsel köşesi · ${(homepage.latestArticles || []).length} son makale${homepage.generatedAt ? ` · ${esc(homepage.generatedAt)}` : ''}</div>`
          : '<div class="text-base mt-1.5" style="color:var(--text-strong)">Henüz güncel sayı atanmamış.</div>'}
      </div>
      <div class="flex gap-2">
        ${cur.volume ? `<a href="#/issues/${esc(cur.volume)}/${encodeURIComponent(cur.issue)}" class="btn btn-secondary">Yönet</a>` : ''}
        <a href="#/issues" class="btn btn-primary">Tüm Sayılar</a>
      </div>
    </div>

    <!-- KPI cards (unified style — single brand accent, no rainbow) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${statCard('Makale', stats.articleCount, 'Yayınlanmış', 'brand')}
      ${statCard('Baskıda', stats.articlesInPressCount, 'Yayını bekleyen', 'brand')}
      ${statCard('Sayı', stats.issueCount, 'Tüm zaman', 'brand')}
      ${statCard('Haber', stats.newsCount, 'Yayınlanmış', 'brand')}
    </div>

    <!-- System health / Yapılacaklar -->
    <div class="card card-padded mb-6">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="text-base font-semibold" style="color:var(--text-strong)">Yapılacaklar</h2>
          <div class="text-xs" style="color:var(--text-muted)">Sistem sağlığı ve önerilen ilk adımlar</div>
        </div>
        <span class="badge ${todoItems[0].tone === 'success' ? 'badge-success' : 'badge-warning'}">${todoItems.filter(t => t.tone !== 'success').length || 'tamam'}</span>
      </div>
      <div class="space-y-2">
        ${todoItems.map(todoRow).join('')}
      </div>
    </div>

    <!-- Top articles -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="card card-padded">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h2 class="text-base font-semibold" style="color:var(--text-strong)">En Çok Görüntülenen</h2>
            <div class="text-xs" style="color:var(--text-muted)">Son 30 günde toplam görüntülenmeye göre</div>
          </div>
          <a href="#/article-stats" class="text-xs font-medium" style="color:var(--brand)">Tümü &rarr;</a>
        </div>
        ${dashTopList(topArticles.topViewed)}
      </div>
      <div class="card card-padded">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h2 class="text-base font-semibold" style="color:var(--text-strong)">En Çok İndirilen</h2>
            <div class="text-xs" style="color:var(--text-muted)">PDF indirme sayısına göre</div>
          </div>
          <a href="#/article-stats" class="text-xs font-medium" style="color:var(--brand)">Tümü &rarr;</a>
        </div>
        ${dashTopListDownloads(topArticles.topDownloaded)}
      </div>
    </div>

    <!-- Lower split: article types + quick actions -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="card card-padded">
        <h2 class="text-base font-semibold mb-3" style="color:var(--text-strong)">Makale Türleri</h2>
        <table class="w-full text-sm">${typeRows}</table>
      </div>
      <div>
        <h2 class="text-base font-semibold mb-3" style="color:var(--text-strong)">Hızlı İşlemler</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${actionTile('#/zip-import',
            '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>',
            'ZIP Aktar', 'Tüm sayıyı tek seferde içe aktar', null, 'brand')}
          ${actionTile('#/jats-import',
            '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>',
            'JATS XML', 'Tek makale XML\'inden aktar', null, 'brand')}
          ${actionTile('#/issues',
            '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>',
            'Yeni Sayı', 'Boş sayı oluştur', null, 'brand')}
          ${actionTile(null,
            '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>',
            'Yedek Al', 'Tüm verileri yedekle', 'showBackupPanel()', 'brand')}
        </div>
      </div>
    </div>`;
});

async function doBackup() {
  try {
    const result = await API.post('/backup');
    toast(`Yedek alındı: ${result.fileCount} dosya`);
    // If backup panel is open, refresh it
    if (document.getElementById('backup-history')) showBackupPanel();
  } catch (err) { toast(err.message, 'error'); }
}

// Download a stored backup as a ZIP (the server bundles the data files plus a
// README.txt manifest describing the archive's contents and scope).
function downloadBackup(name) {
  const a = document.createElement('a');
  a.href = `/api/backups/${encodeURIComponent(name)}/download`;
  a.download = `bmj-backup-${name}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('Yedek indiriliyor…');
}

const BACKUP_FILE_LABELS = {
  'articles.js': { label: 'Makaleler', desc: 'Tüm makale verileri (başlık, yazar, DOI, özet vb.)' },
  'articles-in-press.js': { label: 'Baskıda Makaleler', desc: 'Henüz sayıya atanmamış kabul edilmiş makaleler' },
  'archive-issues.js': { label: 'Arşiv / Sayılar', desc: 'Tüm cilt ve sayı tanımları' },
  'editorial-board.js': { label: 'Yayın Kurulu', desc: 'Editör ve kurul üyeleri listesi' },
  'editorial-extended.js': { label: 'Yayın Kurulu (Detay)', desc: 'Kurul üyelerinin detaylı bilgileri' },
  'news.js': { label: 'Haberler', desc: 'Site haberleri ve duyuruları' },
  'homepage-articles.js': { label: 'Anasayfa Makaleleri', desc: 'Anasayfada öne çıkan makaleler' },
  'author-metadata.js': { label: 'Yazar Metadata', desc: 'Yazar bilgileri ve ORCID verileri' },
};

async function showBackupPanel() {
  let backups = [];
  try { backups = await API.get('/backups'); } catch {}

  const mainContent = document.getElementById('main-content');
  const existing = document.getElementById('backup-panel-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'backup-panel-overlay';
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const fileList = Object.entries(BACKUP_FILE_LABELS).map(([file, info]) =>
    `<div class="flex items-start gap-3 py-2 ${file !== 'author-metadata.js' ? 'border-b border-gray-100' : ''}">
      <div class="w-8 h-8 rounded bg-teal-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg class="w-4 h-4 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-gray-900">${info.label}</div>
        <div class="text-xs text-gray-500">${info.desc}</div>
        <div class="text-xs text-gray-400 font-mono mt-0.5">${file}</div>
      </div>
    </div>`
  ).join('');

  const historyRows = backups.length > 0
    ? backups.map((b, i) => {
        const d = b.name.replace(/T/, ' ').replace(/-/g, (m, offset) => offset > 9 ? ':' : '-').slice(0, 19);
        return `<div class="flex items-center justify-between gap-3 py-2.5 ${i < backups.length - 1 ? 'border-b border-gray-100' : ''}">
          <div class="min-w-0">
            <div class="text-sm text-gray-900">${d}</div>
            <div class="text-xs text-gray-500">${b.fileCount} veri dosyası</div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="text-xs px-2 py-0.5 rounded-full ${i === 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">${i === 0 ? 'En son' : '#' + (i + 1)}</span>
            <button onclick="downloadBackup('${b.name}')" title="Bu yedeği ZIP olarak indir" class="px-3 py-1.5 text-xs font-medium rounded-lg border border-teal-200 text-teal-700 hover:bg-teal-50 inline-flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>
              İndir
            </button>
          </div>
        </div>`;
      }).join('')
    : '<p class="text-sm text-gray-400 py-4 text-center">Henüz yedek alınmamış</p>';

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xl max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto">
      <div class="sticky top-0 bg-white border-b px-6 py-4 rounded-t-2xl flex items-center justify-between">
        <h2 class="text-lg font-bold text-gray-900">Yedekleme</h2>
        <button onclick="this.closest('#backup-panel-overlay').remove()" class="text-gray-400 hover:text-gray-700 p-1">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="px-6 py-5 space-y-6">
        <!-- How it works -->
        <div>
          <h3 class="text-sm font-semibold text-gray-900 mb-2">Yedekleme Nasıl Çalışır?</h3>
          <div class="bg-slate-50 rounded-lg p-4 text-sm text-slate-800 space-y-2">
            <p>Yedekleme sistemi, sitenin tüm veri dosyalarının anlık bir kopyasını <code class="bg-slate-100 px-1 rounded text-xs">admin/backups/</code> klasörüne zaman damgalı bir alt klasör olarak kaydeder.</p>
            <ul class="text-xs space-y-1 ml-4 list-disc">
              <li>Her değişiklik yapıldığında (makale ekleme, silme, düzenleme vb.) sistem otomatik olarak yedek alır</li>
              <li>Ayrıca "Yedek Al" butonuyla istediğiniz zaman manuel yedek oluşturabilirsiniz</li>
              <li>Her yedek <strong>ZIP olarak indirilebilir</strong> — arşivin içinde hangi dosyaların bulunduğunu ve neyin kapsam dışı olduğunu açıklayan bir <code class="bg-slate-100 px-1 rounded">README.txt</code> yer alır</li>
              <li>En fazla <strong>10 yedek</strong> saklanır; eski yedekler otomatik silinir</li>
              <li>Yedekler yalnızca veri dosyalarını içerir (PDF, görsel gibi büyük dosyalar dahil değildir)</li>
            </ul>
          </div>
        </div>

        <!-- What gets backed up -->
        <div>
          <h3 class="text-sm font-semibold text-gray-900 mb-2">Yedeklenen Dosyalar (${Object.keys(BACKUP_FILE_LABELS).length} dosya)</h3>
          <div class="bg-white border rounded-lg px-4 py-2">
            ${fileList}
          </div>
          <p class="text-xs text-gray-400 mt-2">İndirdiğiniz ZIP bu ${Object.keys(BACKUP_FILE_LABELS).length} dosyayı ve içeriklerini açıklayan bir <code class="bg-gray-100 px-1 rounded">README.txt</code> dosyasını içerir.</p>
        </div>

        <!-- Backup history -->
        <div id="backup-history">
          <h3 class="text-sm font-semibold text-gray-900 mb-2">Yedek Geçmişi</h3>
          <div class="bg-white border rounded-lg px-4 py-1">
            ${historyRows}
          </div>
        </div>
      </div>

      <div class="sticky bottom-0 bg-gray-50 border-t px-6 py-4 rounded-b-2xl flex justify-between items-center">
        <p class="text-xs text-gray-400">Yedek konumu: <code class="bg-gray-200 px-1 rounded">admin/backups/</code></p>
        <button onclick="doBackup()" class="px-5 py-2.5 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Şimdi Yedek Al</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
}

// Articles list
async function renderPublishedArticles(el) {
  const page = parseInt(new URLSearchParams(window.location.hash.split('?')[1]).get('page')) || 1;
  const data = await API.get(`/articles?page=${page}&limit=50`);

  el.innerHTML = `
    <div class="flex items-center gap-3 mb-4">
      <input id="article-search" type="text" placeholder="Ara (başlık, DOI, yazar)..." class="input flex-1">
      <span class="text-sm whitespace-nowrap" style="color:var(--text-muted)">${data.total} makale</span>
      <a href="#/articles/new" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium whitespace-nowrap">Yeni Makale</a>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>ID</th>
          <th>Başlık</th>
          <th>Tür</th>
          <th>Cilt/Sayı</th>
          <th>Tarih</th>
          <th class="px-4 py-3"></th>
        </tr></thead>
        <tbody id="articles-tbody">
          ${data.articles.map((a) => `
            <tr class="cursor-pointer" onclick="navigate('#/articles/${a.id}')">
              <td class="px-4 py-3 tabular" style="color:var(--text-faint)">${a.id}</td>
              <td class="px-4 py-3 max-w-md">
                <div class="truncate" style="color:var(--text-strong);font-weight:500">${esc(a.title)}</div>
                ${a.featured || a.imageCorner ? `<div class="mt-1 flex gap-1">${a.featured ? '<span class="badge badge-brand"><span class="badge-dot"></span>Öne çıkan</span>' : ''}${a.imageCorner ? '<span class="badge badge-sky"><span class="badge-dot"></span>Görsel köşesi</span>' : ''}</div>` : ''}
              </td>
              <td class="px-4 py-3">${typeBadge(a.type)}</td>
              <td class="px-4 py-3 tabular" style="color:var(--text-muted)">${a.volume || '—'} / ${a.issue || '—'}</td>
              <td class="px-4 py-3 tabular" style="color:var(--text-muted)">${a.published || '—'}</td>
              <td class="px-4 py-3 whitespace-nowrap text-right">
                <a href="/site/article.html?id=${a.id}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" onclick="event.stopPropagation()">Önizle</a>
                <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="event.stopPropagation(); deleteArticle(${a.id})">Sil</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="flex justify-between items-center mt-4 text-sm text-gray-500">
      <span>Sayfa ${data.page} / ${Math.ceil(data.total / data.limit)}</span>
      <div class="flex gap-2">
        ${data.page > 1 ? `<a href="#/articles?page=${data.page - 1}" class="btn btn-secondary btn-sm">Önceki</a>` : ''}
        ${data.page * data.limit < data.total ? `<a href="#/articles?page=${data.page + 1}" class="btn btn-secondary btn-sm">Sonraki</a>` : ''}
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
      <tr class="cursor-pointer" onclick="navigate('#/articles/${Number(a.id)}')">
        <td class="px-4 py-3 tabular" style="color:var(--text-faint)">${Number(a.id)}</td>
        <td class="px-4 py-3 max-w-md">
          <div class="truncate" style="color:var(--text-strong);font-weight:500">${esc(a.title)}</div>
          ${a.featured || a.imageCorner ? `<div class="mt-1 flex gap-1">${a.featured ? '<span class="badge badge-brand"><span class="badge-dot"></span>Öne çıkan</span>' : ''}${a.imageCorner ? '<span class="badge badge-sky"><span class="badge-dot"></span>Görsel köşesi</span>' : ''}</div>` : ''}
        </td>
        <td class="px-4 py-3">${typeBadge(a.type)}</td>
        <td class="px-4 py-3 tabular" style="color:var(--text-muted)">${esc(a.volume) || '—'} / ${esc(a.issue) || '—'}</td>
        <td class="px-4 py-3 tabular" style="color:var(--text-muted)">${esc(a.published) || '—'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-right">
          <a href="/site/article.html?id=${Number(a.id)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" onclick="event.stopPropagation()">Önizle</a>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="event.stopPropagation(); deleteArticle(${Number(a.id)})">Sil</button>
        </td>
      </tr>`).join('');
  }, 300));
}

// Article browsing is split into two independent top-level areas: Sayılar (the
// archive — years → issues → articles, with the current issue highlighted) and
// e-Pub Makaleler (articles not yet assigned to an issue). JATS XML import has
// its own page. The legacy #/articles entry redirects to Sayılar so existing
// links keep working.
route('/articles', () => { window.location.hash = '#/issues'; });

route('/articles-in-press', async (el) => {
  el.innerHTML = `<div class="page-header"><h1 class="page-title">e-Pub Makaleler</h1></div><div id="aip-host"></div>`;
  try { await renderAipArticles(document.getElementById('aip-host')); }
  catch (err) { document.getElementById('aip-host').innerHTML = `<div class="banner banner-danger">Yüklenemedi: ${esc(err.message)}</div>`; }
});

route('/jats-import', async (el) => {
  el.innerHTML = `<div class="page-header"><h1 class="page-title">JATS XML Aktar</h1></div><div id="jats-host"></div>`;
  try { await renderJatsImport(document.getElementById('jats-host')); }
  catch (err) { document.getElementById('jats-host').innerHTML = `<div class="banner banner-danger">Yüklenemedi: ${esc(err.message)}</div>`; }
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
route('/articles/new', (el, { query } = {}) => renderArticleForm(el, null, {
  // Pre-fill Cilt/Sayı when launched from an issue's "Manuel Makale Ekle".
  volume: query?.get('volume') || '',
  issue: query?.get('issue') || '',
}));
route('/articles/:id', async (el, { id }) => {
  const article = await API.get(`/articles/${id}`);
  renderArticleForm(el, article);
});

async function renderArticleForm(el, article, prefill = {}) {
  const isNew = !article;
  const a = article || { id: '', type: '', title: '', authors: [], abstract: '', abstractHtml: '', previewText: '', keywords: [], doi: '', received: '', accepted: '', published: '', volume: prefill.volume || '', issue: prefill.issue || '', pages: '', pmid: '', featured: false, imageCorner: false, relatedArticles: [] };

  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${isNew ? 'Yeni Makale' : `Makale #${a.id}`}</h1>
      <div class="flex gap-2">
        <a href="#/articles" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm">Geri</a>
        ${isNew ? `<label class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm font-medium shadow-sm cursor-pointer" title="Galenos şablonundaki Word dosyasından metadata + tam metin yükle">Word'den İçe Aktar<input type="file" accept=".docx" id="f-import-docx" class="hidden"></label>` : ''}
        ${!isNew ? `<a href="/site/article.html?id=${a.id}" target="_blank" rel="noopener" class="px-4 py-2 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 text-sm font-medium">Önizle</a>` : ''}
        <button onclick="saveArticle(${isNew ? 'true' : 'false'})" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Kaydet<span data-dirty-indicator class="text-amber-200"></span></button>
      </div>
    </div>

    <div class="card">
      <!-- Tabs -->
      <div class="flex border-b overflow-x-auto">
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-teal-600 text-teal-700" data-tab="general">Genel</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="authors">Yazarlar</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="abstract">Özet</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="issue">Sayı</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="fulltext">Tam Metin</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="media">Dosyalar</button>
        <button class="tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="links">Bağlantılar</button>
      </div>

      <!-- General tab -->
      <div class="tab-panel p-6" data-tab="general">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="label">Tür</label>
            <input id="f-type" value="${esc(a.type)}" class="input" list="type-list">
            <datalist id="type-list"></datalist>
          </div>
          <div><label class="label">DOI</label><input id="f-doi" value="${esc(a.doi)}" class="input"></div>
        </div>
        <div class="mt-4"><label class="label">Başlık</label><input id="f-title" value="${esc(a.title)}" class="input"></div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div><label class="label">Alındığı Tarih</label><input id="f-received" type="date" value="${dateInputValue(a.received)}" class="input"></div>
          <div><label class="label">Kabul Tarihi</label><input id="f-accepted" type="date" value="${dateInputValue(a.accepted)}" class="input"></div>
          <div><label class="label">Yayın Tarihi</label><input id="f-published" type="date" value="${dateInputValue(a.published || a.publishedOnline)}" class="input"></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div><label class="label">PMID</label><input id="f-pmid" value="${esc(a.pmid || '')}" class="input"></div>
          <div class="flex items-end gap-4">
            <label class="flex items-center gap-2 text-sm" title="Anasayfa bannerındaki Featured in This Issue kartında gösterilir. Aynı sayıda yalnızca bir makale öne çıkabilir."><input id="f-featured" type="checkbox" ${a.featured ? 'checked' : ''} class="rounded"> Öne Çıkan</label>
            <label class="flex items-center gap-2 text-sm"><input id="f-imageCorner" type="checkbox" ${a.imageCorner ? 'checked' : ''} class="rounded"> Görsel Köşesi</label>
          </div>
        </div>
        <div class="mt-4">
          <label class="label">Görsel</label>
          <div class="flex items-center gap-3">
            <input id="f-imageUrl" value="${esc(a.imageUrl || '')}" placeholder="images/... veya dosya yükleyin" class="flex-1 px-3 py-2 border rounded-lg text-sm">
            <label class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm cursor-pointer">
              Yükle <input id="f-imageFile" type="file" accept="image/*" class="hidden">
            </label>
          </div>
          ${a.imageUrl ? `<img src="/site/${esc(a.imageUrl)}" class="mt-2 h-20 rounded border object-cover" onerror="this.style.display='none'">` : ''}
        </div>
        ${!isNew ? `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div><label class="label">Görüntülenme</label><input id="f-views" type="number" min="0" value="${a.views || 0}" class="input" oninput="markDirty()"></div>
          <div><label class="label">İndirme</label><input id="f-downloads" type="number" min="0" value="${a.downloads || 0}" class="input" oninput="markDirty()"></div>
          <div><label class="label">Atıf</label><input id="f-citations" type="number" min="0" value="${a.citations || 0}" class="input" oninput="markDirty()"></div>
        </div>` : ''}
      </div>

      <!-- Authors tab -->
      <div class="tab-panel p-6 hidden" data-tab="authors">
        ${(() => {
          const { affiliations: _affList, authorIdx: _authorIdx } = buildAffiliationsFromAuthors(a.authors);
          const _authorsWithIdx = (a.authors || []).map((au, i) => Object.assign({}, au, { _affIdx: _authorIdx[i] }));
          return `
        <div class="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div class="flex items-baseline justify-between mb-3">
            <label class="text-sm font-semibold text-gray-700">Kurumlar</label>
            <span class="text-xs text-gray-500">Yazar satırına ilgili numarayı yazın (ör. <code class="bg-white px-1 rounded">1</code> veya <code class="bg-white px-1 rounded">1,2</code>)</span>
          </div>
          <div id="affiliations-list" class="space-y-2">${_affList.map((t, i) => affRow(t, i + 1)).join('')}</div>
          <button onclick="addAffiliation()" class="mt-2 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-xs font-medium">+ Kurum Ekle</button>
        </div>

        <label class="text-sm font-semibold text-gray-700 block mb-2">Yazarlar</label>
        <div id="authors-list" class="space-y-3">${_authorsWithIdx.map((au, i) => authorRow(au, i)).join('')}</div>
        <button onclick="addAuthor()" class="mt-3 px-4 py-2 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 text-sm font-medium">+ Yazar Ekle</button>
        `;
        })()}
      </div>

      <!-- Abstract tab -->
      <div class="tab-panel p-6 hidden" data-tab="abstract">
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-medium text-gray-700">Özet</label>
            <div id="f-abstract-modeswitch" class="inline-flex items-center bg-gray-100 rounded-lg p-0.5 text-xs font-medium select-none" role="tablist" aria-label="Düzenleme modu">
              <button type="button" data-mode="visual" onclick="setAbstractEditorMode('visual')" role="tab" aria-selected="true"
                class="mode-btn mode-visual px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all bg-white shadow-sm text-teal-700">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h10M4 18h16"/></svg>
                <span>Görsel</span>
              </button>
              <button type="button" data-mode="source" onclick="setAbstractEditorMode('source')" role="tab" aria-selected="false"
                class="mode-btn mode-source px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all text-gray-500 hover:text-gray-800">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l-4-4 4-4M14 4l4 4-4 4"/></svg>
                <span>HTML</span>
              </button>
            </div>
          </div>
          <div id="f-abstract-toolbar" class="flex flex-wrap gap-0.5 border border-b-0 rounded-t-lg bg-gray-50 px-2 py-1.5">
            <button type="button" onclick="abstractCmd('bold')" title="Kalın" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></svg></button>
            <button type="button" onclick="abstractCmd('italic')" title="İtalik" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 4h4m-2 0l-4 16m0 0h4"/></svg></button>
            <button type="button" onclick="abstractCmd('underline')" title="Altı Çizili" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 3v7a6 6 0 0012 0V3M3.5 21h17"/></svg></button>
            <div class="w-px bg-gray-300 mx-1"></div>
            <button type="button" onclick="abstractCmd('formatBlock','<p>')" title="Paragraf" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-bold">P</button>
            <button type="button" onclick="abstractCmd('insertUnorderedList')" title="Liste" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button>
            <button type="button" onclick="abstractCmd('removeFormat')" title="Formatı Temizle" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17 10L3 3m0 0l7 14 2-5 5-2M3 3l18 18"/></svg></button>
          </div>
          <div id="f-abstractHtml-visual" contenteditable="true" class="w-full px-4 py-3 border rounded-b-lg text-sm min-h-[160px] focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 max-w-none overflow-auto bg-white">${a.abstractHtml || ''}</div>
          <textarea id="f-abstractHtml" rows="8" class="w-full px-3 py-2 border rounded-b-lg text-sm font-mono hidden">${esc(a.abstractHtml)}</textarea>
        </div>
        <div class="mt-4"><label class="label">Anahtar Kelimeler (virgül ile)</label>
          <input id="f-keywords" value="${esc((a.keywords || []).join(', '))}" class="input">
        </div>
      </div>

      <!-- Full Text tab -->
      <div class="tab-panel p-6 hidden" data-tab="fulltext">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-gray-700">Tam Metin</h3>
          <div class="flex gap-2">
            <label class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-xs cursor-pointer">
              HTML Dosyadan Yükle <input id="f-fulltext-file" type="file" accept=".html,.htm" class="hidden">
            </label>
            ${!isNew ? `<button type="button" onclick="saveArticleFullText(${a.id})" class="px-4 py-1.5 bg-teal-600 text-white rounded hover:bg-teal-700 text-xs font-medium">Tam Metni Kaydet</button>` : ''}
          </div>
        </div>
        ${isNew ? `<div class="banner banner-info mb-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <div class="banner-body" style="margin-top:0">Yeni makale oluşturulurken tam metin de buradan yüklenebilir. Sayfa üstündeki <strong>Kaydet</strong> butonuna basıldığında makale ile birlikte otomatik kaydedilir.</div>
        </div>` : ''}
        <p class="text-xs text-gray-500 mb-2">Makalenin tam metnini görsel olarak düzenleyin. İleri kullanım için sağ üstteki "HTML" sekmesine geçin. Figür placeholder'lar (<code>src="fig1"</code>) "Dosyalar → Tam Metne Uygula" ile gerçek görsel URL'leri ile eşlenir.</p>
        ${htmlEditor({ prefix: 'ft', initialHtml: '', rows: 20, placeholder: 'Tam metin henüz yüklü değil. Doğrudan yazın, yapıştırın veya yukarıdaki "HTML Dosyadan Yükle" ile bir .html dosyası seçin.', variant: 'full', minHeight: '400px' })}
        <div id="f-fulltext-status" class="text-xs text-gray-500 mt-2"></div>
      </div>

      <!-- Issue tab -->
      <div class="tab-panel p-6 hidden" data-tab="issue">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label class="label">Cilt</label><input id="f-volume" type="number" value="${a.volume || ''}" class="input"></div>
          <div><label class="label">Sayı</label><input id="f-issue" value="${esc(a.issue)}" class="input"></div>
          <div><label class="label">Sayfalar</label><input id="f-pages" value="${esc(a.pages)}" class="input"></div>
        </div>
      </div>

      <!-- Media tab (compact + premium) -->
      <div class="tab-panel p-6 hidden" data-tab="media">
        ${!isNew ? `
        <div class="space-y-5">

          <!-- PDF: single-line row -->
          <section class="flex items-center gap-3 flex-wrap" style="padding:10px 12px;background:var(--bg-page);border:1px solid var(--border-soft);border-radius:var(--radius)">
            <div class="text-sm font-semibold" style="color:var(--text-strong);min-width:32px">PDF</div>
            ${a.pdfUrl
              ? `<span class="badge badge-success"><span class="badge-dot"></span>Mevcut</span>
                 <code class="text-xs px-2 py-1 rounded truncate" style="background:var(--bg-card);color:var(--text-muted);flex:1;min-width:0">${esc(a.pdfUrl)}</code>`
              : `<span class="badge badge-warning"><span class="badge-dot"></span>Yüklenmemiş</span>
                 <span class="text-xs" style="color:var(--text-muted);flex:1">PDF dosyası eklenmemiş.</span>`}
            <label class="btn btn-secondary btn-sm cursor-pointer flex-shrink-0">
              ${a.pdfUrl ? 'Değiştir' : 'PDF Yükle'} <input id="f-pdf-file" type="file" accept=".pdf" class="hidden">
            </label>
          </section>
          <div id="f-pdf-results"></div>
          <!-- Hidden legacy counter targets (kept for backwards-compat with loadArticleAssets) -->
          <span id="f-pdf-count" class="hidden"></span>
          <span id="f-fig-count" class="hidden"></span>
          <span id="f-supp-count" class="hidden"></span>

          <!-- Figures: title row with inline stats, then wizard grid -->
          <section>
            <div class="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <div class="flex items-baseline gap-3">
                <h3 class="text-sm font-semibold" style="color:var(--text-strong)">Figürler</h3>
                <span id="f-fig-inline-stats" class="text-xs" style="color:var(--text-muted)">yükleniyor…</span>
              </div>
              <div class="flex gap-2 flex-shrink-0">
                <label class="btn btn-secondary btn-sm cursor-pointer">
                  Çoklu Yükle <input id="f-fig-files" type="file" accept="image/*,.tif,.tiff" multiple class="hidden">
                </label>
                <button type="button" onclick="applyExistingFigures(${a.id})" class="btn btn-primary btn-sm" title="Yüklü figürleri tam metindeki placeholder'lar ile eşler">Tam Metne Uygula</button>
              </div>
            </div>
            <div id="f-fig-results" class="mb-2"></div>
            <div id="f-fig-wizard">
              <div class="flex items-center justify-center py-6" style="color:var(--text-faint)">
                <svg class="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                <span class="text-xs">Figür durumu yükleniyor…</span>
              </div>
            </div>
          </section>

          <!-- Ek Materyaller (Dosyalar + Linkler tek panelde) -->
          <section>
            <div class="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <h3 class="text-sm font-semibold" style="color:var(--text-strong)">Ek Materyaller (Supplementary Materials)</h3>
              <div class="flex gap-2 flex-shrink-0">
                <label class="btn btn-secondary btn-sm cursor-pointer">
                  Dosya Yükle <input id="f-supp-files" type="file" multiple class="hidden">
                </label>
                <button type="button" onclick="addSuppLinkRow()" class="btn btn-secondary btn-sm">+ URL Ekle</button>
              </div>
            </div>
            <div class="banner banner-info mb-2" style="padding:8px 10px;font-size:12px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <div class="banner-body" style="margin-top:0;line-height:1.5">
                Bu makaleye ait ek materyalleri (tablolar, veri setleri, ek PDF'ler vb.) buradan yönetin.
                <strong>Dosya Yükle</strong> ile sunucuya yükleyin veya <strong>+ URL Ekle</strong> ile harici bir bağlantı ekleyin.
                Her satırın yanındaki <strong>kopyala</strong> ikonuyla dosyanın paylaşılabilir tam URL'sini panoya alıp grafik ekibine iletebilirsiniz.
                Eklenen materyaller makalenin sitedeki "Supplementary Materials" bölümünde otomatik listelenir.
              </div>
            </div>
            <div id="f-supp-results" class="mb-2"></div>
            <div id="f-supp-links" class="space-y-2">
              ${(a.supplementary || []).map((sm) => suppLinkRow(sm)).join('')}
            </div>
            ${!(a.supplementary || []).length ? `<div id="f-supp-empty" class="text-xs text-center py-3" style="color:var(--text-faint)">Henüz ek materyal yok. Dosya yükleyin veya harici bir URL ekleyin.</div>` : ''}
          </section>
        </div>
        ` : '<p class="text-gray-400 text-sm">Makaleyi kaydettikten sonra dosya yükleyebilirsiniz.</p>'}
      </div>

      <!-- Links tab -->
      <div class="tab-panel p-6 hidden" data-tab="links">
        <div id="links-list" class="space-y-2 mb-4">
          ${(a.relatedArticles || []).map((r) => `
            <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div><span class="badge badge-info">${esc(r.type)}</span>
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

        <!-- External URL links -->
        <div class="border-t pt-6 mt-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-semibold text-gray-700">Harici Bağlantılar</h3>
            <button type="button" onclick="addExternalLinkRow()" class="text-xs px-3 py-1.5 bg-teal-600 text-white rounded hover:bg-teal-700">+ URL Ekle</button>
          </div>
          <p class="text-xs text-gray-500 mb-3">Veri seti, kod deposu, preprint veya diğer dış kaynak bağlantıları.</p>
          <div id="f-external-links" class="space-y-2">
            ${(a.externalLinks || []).map((l) => externalLinkRow(l)).join('')}
          </div>
        </div>
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
        const file = pdfInput.files[0];
        const prog = renderUploadProgress('f-pdf-results', [file], 'PDF yükleniyor');
        try {
          const result = await API.uploadFileWithProgress('/media/upload/pdf', file, 'pdf', { articleId: String(a.id) }, prog.update);
          prog.complete(`<div class="bg-green-50 border border-green-200 text-green-700 p-3 rounded-lg text-sm">PDF yüklendi: <code>${esc(result.pdfUrl || '')}</code></div>`);
          toast('PDF yüklendi');
          await API.put(`/articles/${a.id}`, { pdfUrl: result.pdfUrl, localPdfUrl: result.pdfUrl });
          handleRoute();
        } catch (err) {
          prog.fail(err.message);
          toast(err.message, 'error');
        }
      });
    }

    const figInput = document.getElementById('f-fig-files');
    if (figInput) {
      figInput.addEventListener('change', async () => {
        if (!figInput.files.length) return;
        const figResults = document.getElementById('f-fig-results');
        const prog = renderUploadProgress(figResults, figInput.files, 'Figürler yükleniyor');
        try {
          const result = await API.uploadFilesWithProgress(`/media/upload/figures/${a.id}`, figInput.files, 'figures', {}, prog.update);
          prog.complete(`<div class="banner banner-success" style="padding:10px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><div><div class="banner-title">${result.uploaded.length} figür yüklendi</div><div class="banner-body">Otomatik eşleştirme deneniyor…</div></div></div>`);
          window._articleFigureUpload = result;
          // Auto-apply + refresh wizard
          await applyExistingFigures(a.id);
          loadArticleAssets(a.id, a);
        } catch (err) {
          prog.fail(err.message);
          toast(err.message, 'error');
        }
      });
    }

    const suppInput = document.getElementById('f-supp-files');
    if (suppInput) {
      suppInput.addEventListener('change', async () => {
        if (!suppInput.files.length) return;
        const suppResults = document.getElementById('f-supp-results');
        const prog = renderUploadProgress(suppResults, suppInput.files, 'Ek materyaller yükleniyor');
        try {
          const result = await API.uploadFilesWithProgress(`/media/upload/supplementary/${a.id}`, suppInput.files, 'files', {}, prog.update);
          prog.complete(`
            <div class="bg-green-50 border border-green-200 rounded-lg p-3">
              <div class="text-sm font-medium text-green-700">${result.uploaded.length} dosya yüklendi${(result.added || []).length ? ' ve ek materyal listesine eklendi' : ''}</div>
              ${result.uploaded.map((f) => `<div class="text-xs text-gray-500 mt-1"><code>${esc(f.url)}</code></div>`).join('')}
            </div>`);
          appendSuppRows(result.added);
          loadArticleAssets(a.id, a);
        } catch (err) {
          prog.fail(err.message);
          toast(err.message, 'error');
        }
      });
    }

    // Initial load: asset summary + existing full text (existing articles only)
    loadArticleAssets(a.id, a);
    loadFullTextIntoEditor(a.id);
  }

  // Full-text: read from local .html file into editor (works for both new & existing)
  const ftFileInput = document.getElementById('f-fulltext-file');
  if (ftFileInput) {
    ftFileInput.addEventListener('change', async () => {
      const f = ftFileInput.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const cleaned = sanitizeUploadedHtml(text);
        // Force visual mode so the user sees rendered content, not raw HTML
        setHtmlEditorMode('ft', 'visual');
        setHtmlEditorContent('ft', cleaned);
        markDirty();
        const status = document.getElementById('f-fulltext-status');
        if (status) status.textContent = `"${f.name}" yüklendi (${cleaned.length.toLocaleString('tr-TR')} karakter). Kaydetmeyi unutmayın.`;
        toast(isNew
          ? 'Tam metin okundu. Sayfa üstündeki "Kaydet" butonuna basın.'
          : 'Tam metin dosyadan okundu. Lütfen "Tam Metni Kaydet" butonuna basın.');
      } catch (err) { toast(`Dosya okunamadı: ${err.message}`, 'error'); }
    });
  }

  // ── Word'den İçe Aktar (Galenos şablonu) — only on new manual articles ──
  // Same flow as the AIP form: parse-docx → metadata + Tam Metin, applied to the
  // article form's fields. Lets "Sayılar → Manuel Makale Ekle" import from Word.
  const importDocx = document.getElementById('f-import-docx');
  if (importDocx) {
    importDocx.addEventListener('change', async () => {
      const file = importDocx.files && importDocx.files[0];
      if (!file) return;
      const hasManualData = ['f-type', 'f-doi', 'f-title'].some((id) => (document.getElementById(id)?.value || '').trim().length > 0);
      if (hasManualData) {
        const ok = await confirmAction('Form alanları dolu. Word\'den İçe Aktar mevcut verilerin üzerine yazacak. Devam edilsin mi?');
        if (!ok) { importDocx.value = ''; return; }
      }
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/articles-in-press/parse-docx', { method: 'POST', body: fd });
        const meta = await res.json();
        if (!res.ok) throw new Error(meta.error || 'Word dosyası ayrıştırılamadı');
        _applyArticleDocxMetadata(meta);
        const warn = (meta.warnings || []).filter(Boolean);
        const ftNote = meta.fullTextHtml ? ' Tam Metin sekmesi dolduruldu.' : '';
        toast(warn.length
          ? `Word içe aktarıldı.${ftNote} ${warn.length} uyarı: ${warn.join('; ')}`
          : `Word dosyası başarıyla içe aktarıldı.${ftNote}`, warn.length ? 'warning' : 'success');
        if (meta.headingCheckReminder) {
          toast('Başlık seviyeleri otomatik belirlendi (H3 ana / H4 alt bölüm). Tam Metin sekmesinde "Başlıklar" aracıyla kontrol edin.', 'warning');
        }
        markDirty();
      } catch (err) {
        toast(`İçe aktarma hatası: ${err.message}`, 'error');
      } finally {
        importDocx.value = '';
      }
    });
  }

  // Load article types from API
  API.get('/article-types').then((types) => {
    const dl = document.getElementById('type-list');
    if (dl) dl.innerHTML = types.map((t) => `<option value="${esc(t.name)}">`).join('');
  }).catch(() => {});

  // Reset abstract editor mode
  _abstractEditorMode = 'visual';

  // Track unsaved changes
  clearDirty();
  el.addEventListener('input', markDirty);
}

// Apply Word-parsed metadata to the regular Article form (mirrors
// _applyAipDocxMetadata but maps to the f-* field IDs and the article form's
// custom abstract editor + 'ft' full-text editor).
function _applyArticleDocxMetadata(meta) {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : String(v); };
  setVal('f-type', meta.type);
  setVal('f-doi', meta.doi);
  setVal('f-title', meta.title);
  setVal('f-received', dateInputValue(meta.received));
  setVal('f-accepted', dateInputValue(meta.accepted));
  setVal('f-published', dateInputValue(meta.published || meta.publishedOnline));
  // Keywords are intentionally NOT imported (no keyword feature) — left untouched.

  // Authors + Kurumlar: rebuild both lists from the parsed authors.
  const affList = document.getElementById('affiliations-list');
  const authorsList = document.getElementById('authors-list');
  if (affList && authorsList) {
    const { affiliations, authorIdx } = buildAffiliationsFromAuthors(meta.authors || []);
    affList.innerHTML = affiliations.map((t, i) => affRow(t, i + 1)).join('');
    authorsList.innerHTML = (meta.authors || []).map((au, i) => authorRow(Object.assign({}, au, { _affIdx: authorIdx[i] }), i)).join('');
  }

  // Abstract → the article form's custom editor (visual div + source textarea).
  const abstractHtml = String(meta.abstract || '')
    .split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`).join('');
  if (abstractHtml) {
    const av = document.getElementById('f-abstractHtml-visual');
    const at = document.getElementById('f-abstractHtml');
    if (av) av.innerHTML = abstractHtml;
    if (at) at.value = abstractHtml;
  }

  // Full text → 'ft' editor, then cross-link <sup>N</sup> citations to refs.
  if (meta.fullTextHtml) {
    setHtmlEditorContent('ft', meta.fullTextHtml);
    const ftVisual = document.getElementById('ft-visual');
    if (ftVisual && typeof _autoLinkInEditor === 'function') {
      try { _autoLinkInEditor(ftVisual); } catch (_) { /* non-fatal */ }
    }
    const st = document.getElementById('f-fulltext-status');
    if (st) {
      st.textContent = meta.headingCheckReminder
        ? 'Tam metin içe aktarıldı. Başlık seviyelerini (H3 ana / H4 alt) "Başlıklar" aracıyla kontrol edip Kaydet\'e basın.'
        : 'Tam metin Word\'den içe aktarıldı — gözden geçirip Kaydet\'e basın.';
    }
  }
}

// --- Supplementary link rows ---
function suppLinkRow(sm = {}) {
  // Carry the existing id through data-supp-id so saveArticle / saveAip can
  // preserve it. Previously every save renumbered supp1, supp2, … from the
  // row order — deleting a middle row shifted the IDs and silently broke
  // any in-text "#supp2" anchors that pointed at the original IDs.
  const existingId = sm.id ? String(sm.id) : '';
  return `<div class="supp-link-row grid grid-cols-1 md:grid-cols-12 gap-2 items-center" data-supp-id="${esc(existingId)}" style="padding:8px;background:var(--bg-page);border:1px solid var(--border-soft);border-radius:8px">
    <input class="sl-label input md:col-span-3" style="padding:6px 10px;font-size:12.5px" placeholder="Etiket (ör. Tablo S1)" value="${esc(sm.label || '')}">
    <div class="md:col-span-4 flex gap-1">
      <input class="sl-href input flex-1" style="padding:6px 10px;font-size:12.5px;min-width:0" placeholder="URL veya dosya yolu" value="${esc(sm.href || '')}">
      <button type="button" onclick="copySuppUrl(this)" class="btn btn-ghost btn-sm" style="color:var(--brand);padding:4px 8px;flex-shrink:0" title="Paylaşılabilir tam URL'yi panoya kopyala (grafik ekibine iletmek için)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    </div>
    <input class="sl-caption input md:col-span-3" style="padding:6px 10px;font-size:12.5px" placeholder="Açıklama (opsiyonel)" value="${esc(sm.caption || '')}">
    <button type="button" onclick="insertSuppRowIntoFullText(this)" class="md:col-span-1 btn btn-ghost btn-sm" style="color:var(--brand);padding:4px" title="Tam metne ekle">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
    </button>
    <button type="button" onclick="this.closest('.supp-link-row').remove(); markDirty();" class="md:col-span-1 btn btn-ghost btn-sm" style="color:var(--danger);padding:4px;font-size:18px;line-height:1" title="Sil">&times;</button>
  </div>`;
}

// Copy the supplementary material's public, shareable URL to the clipboard so
// it can be sent to the graphic team (who embeds the link inside the article PDF).
function copySuppUrl(btn) {
  const row = btn.closest('.supp-link-row');
  if (!row) return;
  let url = (row.querySelector('.sl-href')?.value || '').trim();
  if (!url) { toast('Önce dosya yükleyin veya URL girin', 'warning'); return; }
  // Relative paths → prepend current origin to produce a full shareable URL.
  if (!/^https?:\/\//i.test(url)) {
    url = location.origin.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
  }
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('URL panoya kopyalandı'); }
    catch { toast('Kopyalanamadı', 'error'); }
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => toast('URL panoya kopyalandı: ' + url)).catch(fallback);
  } else {
    fallback();
  }
}

// One-click insert of a supplementary row's file into the full-text editor —
// no need to open the toolbar picker. Media (image/video/audio) is embedded,
// everything else is inserted as a download link.
function insertSuppRowIntoFullText(btn) {
  const row = btn.closest('.supp-link-row');
  if (!row) return;
  const url = (row.querySelector('.sl-href')?.value || '').trim();
  if (!url) { toast('Önce bu satıra dosya yolu / URL girin', 'warning'); return; }
  const label = (row.querySelector('.sl-label')?.value || '').trim() || url.split('/').pop();
  const caption = (row.querySelector('.sl-caption')?.value || '').trim();
  // Switch to the Tam Metin tab so the result is visible (article or AIP form)
  const ftBtn = document.querySelector('.tab-btn[data-tab="fulltext"]')
             || document.querySelector('.aip-tab-btn[data-tab="fulltext"]');
  if (ftBtn) ftBtn.click();
  const prefix = document.getElementById('ft-visual') ? 'ft'
               : document.getElementById('aip-ft-visual') ? 'aip-ft' : null;
  if (!prefix) { toast('Tam metin editörü bulunamadı', 'warning'); return; }
  const kind = detectSuppKind(url);
  const mode = (kind === 'image' || kind === 'video' || kind === 'audio') ? 'embed' : 'link';
  const html = buildSupplementaryInsertHtml({ url, label, caption, kind }, mode, label);
  htmlEditorInsertHtml(prefix, html);
  toast(`"${label}" tam metne eklendi`);
}
function addSuppLinkRow() {
  const list = document.getElementById('f-supp-links');
  if (!list) return;
  const empty = document.getElementById('f-supp-empty');
  if (empty) empty.remove();
  list.insertAdjacentHTML('beforeend', suppLinkRow());
  markDirty();
}

// Insert auto-linked supplementary rows into the edit form after an upload, so
// the form's DOM stays in sync with the supplementary[] the server just persisted.
function appendSuppRows(added) {
  const list = document.getElementById('f-supp-links');
  if (!list || !added || !added.length) return;
  const empty = document.getElementById('f-supp-empty');
  if (empty) empty.remove();
  added.forEach((sm) => list.insertAdjacentHTML('beforeend', suppLinkRow(sm)));
}

// --- External link rows ---
function externalLinkRow(l = {}) {
  return `<div class="external-link-row grid grid-cols-1 md:grid-cols-12 gap-2 p-2 bg-gray-50 rounded-lg">
    <input class="el-label md:col-span-3 px-2 py-1.5 border rounded text-sm" placeholder="Etiket" value="${esc(l.label || '')}">
    <input class="el-url md:col-span-8 px-2 py-1.5 border rounded text-sm" placeholder="https://..." value="${esc(l.url || '')}">
    <button type="button" onclick="this.closest('.external-link-row').remove(); markDirty();" class="md:col-span-1 text-red-500 hover:text-red-700 text-lg">&times;</button>
  </div>`;
}
function addExternalLinkRow() {
  const list = document.getElementById('f-external-links');
  if (!list) return;
  list.insertAdjacentHTML('beforeend', externalLinkRow());
  markDirty();
}

function authorRow(au, idx) {
  const isCorr = !!(au.corresponding || au.isCorresponding || au.correspondence);
  const email = au.email || au.mail || '';
  return `<div class="flex gap-2 items-start p-3 bg-gray-50 rounded-lg author-row" ondragend="this.removeAttribute('draggable')">
    <span class="row-grip" title="Sıralamak için tutup sürükleyin" aria-label="Sürükle" onmousedown="this.closest('.author-row').setAttribute('draggable','true')">${ROW_GRIP_SVG}</span>
    <div class="flex-1 space-y-2">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input class="au-name md:col-span-2 px-2 py-1.5 border rounded text-sm" placeholder="Ad Soyad" value="${esc(au.name)}" oninput="markDirty()">
        <input class="au-aff-idx px-2 py-1.5 border rounded text-sm" placeholder="Kurum no (1 veya 1,2)" value="${esc(au._affIdx || '')}" oninput="markDirty()">
        <input class="au-orcid md:col-span-2 px-2 py-1.5 border rounded text-sm" placeholder="ORCID" value="${esc(au.orcid)}" oninput="markDirty()">
      </div>
      <div class="corr-wrap flex items-center gap-2 flex-wrap">
        <label class="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none" title="Birden fazla sorumlu yazar seçilebilir">
          <input type="checkbox" class="au-corr" ${isCorr ? 'checked' : ''} onchange="_toggleCorrEmail(this)">
          Sorumlu yazar ise tıklayınız
        </label>
        <input class="au-email js-corr-email flex-1 px-2 py-1.5 border rounded text-sm" type="email" placeholder="Sorumlu yazar e-posta adresi" value="${esc(email)}" style="min-width:200px;${isCorr ? '' : 'display:none'}" oninput="markDirty()">
      </div>
    </div>
    <button onclick="this.closest('.author-row').remove(); markDirty();" class="text-red-400 hover:text-red-600 text-lg px-1">&times;</button>
  </div>`;
}

function addAuthor() {
  const list = document.getElementById('authors-list');
  list.insertAdjacentHTML('beforeend', authorRow({ name: '', _affIdx: '', orcid: '' }, list.children.length));
  markDirty();
}

async function saveArticle(isNew) {
  const getVal = (id) => document.getElementById(id)?.value?.trim() || '';
  const affList = _collectAffList(document.getElementById('affiliations-list'), '.aff-text');
  const authors = [];
  document.querySelectorAll('.author-row').forEach((row) => {
    const corresponding = !!row.querySelector('.au-corr')?.checked;
    const email = corresponding ? (row.querySelector('.au-email')?.value.trim() || '') : '';
    const author = {
      name: row.querySelector('.au-name').value.trim(),
      affiliation: joinAffiliationsByIdx(row.querySelector('.au-aff-idx').value, affList),
      orcid: row.querySelector('.au-orcid').value.trim(),
    };
    if (corresponding) author.corresponding = true;
    if (email) author.email = email;
    authors.push(author);
  });

  // Collect supplementary URL entries. Preserve each row's original id (carried
  // via data-supp-id) so in-text anchors keep resolving — only assign fresh
  // supp{N} ids to rows that don't already have one.
  const supplementary = [];
  const _suppUsedIds = new Set();
  document.querySelectorAll('.supp-link-row').forEach((row) => {
    const existing = (row.getAttribute('data-supp-id') || '').trim();
    if (existing) _suppUsedIds.add(existing);
  });
  let _suppCounter = 0;
  const _suppNextId = () => {
    while (true) {
      _suppCounter += 1;
      const candidate = `supp${_suppCounter}`;
      if (!_suppUsedIds.has(candidate)) {
        _suppUsedIds.add(candidate);
        return candidate;
      }
    }
  };
  document.querySelectorAll('.supp-link-row').forEach((row) => {
    const label = row.querySelector('.sl-label').value.trim();
    const href = row.querySelector('.sl-href').value.trim();
    const caption = row.querySelector('.sl-caption').value.trim();
    if (!label && !href) return;
    const existing = (row.getAttribute('data-supp-id') || '').trim();
    const id = existing || _suppNextId();
    if (!existing) row.setAttribute('data-supp-id', id);
    supplementary.push({ id, label, href, caption, mimeType: '' });
  });

  // Collect external link entries
  const externalLinks = [];
  document.querySelectorAll('.external-link-row').forEach((row) => {
    const label = row.querySelector('.el-label').value.trim();
    const url = row.querySelector('.el-url').value.trim();
    if (!label && !url) return;
    externalLinks.push({ label, url });
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
    abstractHtml: getAbstractContent(),
    abstract: getAbstractContent().replace(/<[^>]+>/g, '').trim(),
    keywords: getVal('f-keywords').split(',').map((k) => k.trim()).filter(Boolean),
    volume: parseInt(getVal('f-volume')) || null,
    issue: getVal('f-issue'),
    pages: getVal('f-pages'),
    imageUrl: getVal('f-imageUrl'),
    authors,
    supplementary,
    externalLinks,
  };

  // Include metrics if editing an existing article
  if (!isNew) {
    data.views = parseInt(document.getElementById('f-views')?.value) || 0;
    data.downloads = parseInt(document.getElementById('f-downloads')?.value) || 0;
    data.citations = parseInt(document.getElementById('f-citations')?.value) || 0;
  }

  data.previewText = data.abstract.slice(0, 360);

  if (!data.title) { toast('Başlık zorunludur', 'error'); return; }
  if (!data.type) { toast('Makale türü zorunludur', 'error'); return; }
  const dateError = articleDateSequenceError(data);
  if (dateError) { toast(dateError, 'error'); return; }

  try {
    if (isNew) {
      const result = await API.post('/articles', data);
      // If a Full Text was entered while creating, persist it under the new ID
      const ftHtml = document.getElementById('ft-visual') ? getHtmlEditorContent('ft') : '';
      if (result?.id && ftHtml) {
        try {
          await API.put(`/articles/${result.id}/fulltext`, { html: ftHtml });
        } catch (ftErr) {
          toast(`Makale oluşturuldu ama tam metin kaydedilemedi: ${ftErr.message}`, 'error');
        }
      }
      clearDirty();
      toast(`Makale oluşturuldu${data.featured ? ' · Anasayfa banner güncellendi' : ''}`);
      navigate(`#/articles/${result.id}`);
    } else {
      const id = window.location.hash.match(/#\/articles\/(\d+)/)?.[1];
      await API.put(`/articles/${id}`, data);
      // Also persist full-text if the editor exists on this form
      if (document.getElementById('ft-visual') && id) {
        const ftHtml = getHtmlEditorContent('ft');
        try {
          await API.put(`/articles/${id}/fulltext`, { html: ftHtml });
          const status = document.getElementById('f-fulltext-status');
          if (status) status.textContent = `Kaydedildi (${ftHtml.length.toLocaleString('tr-TR')} karakter).`;
        } catch (ftErr) {
          toast(`Genel veriler kaydedildi ama tam metin kaydedilemedi: ${ftErr.message}`, 'error');
        }
      }
      clearDirty();
      toast(`Makale güncellendi${data.featured ? ' · Anasayfa banner güncellendi' : ''}`);
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
    <div class="card card-padded mb-6">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="text-base font-semibold" style="color:var(--text-strong)">Sunucudaki ZIP Dosyaları</h2>
          <div class="text-xs" style="color:var(--text-muted)">FTP ile <code>admin/imports/</code> altına yüklenmiş paketler</div>
        </div>
        <button onclick="handleRoute()" class="btn btn-ghost btn-sm">Yenile</button>
      </div>
      <div class="divide-y" style="border-color:var(--border-soft)">
        ${serverFiles.map((f) => `
          <div class="flex items-center justify-between py-3">
            <div class="min-w-0">
              <div class="font-medium text-sm" style="color:var(--text-strong)">${esc(f.filename)}</div>
              <div class="text-xs mt-0.5" style="color:var(--text-faint)">${esc(f.sizeHuman)} · ${esc(f.modified.slice(0, 10))}</div>
            </div>
            <div class="flex gap-2 flex-shrink-0">
              <button onclick="previewServerZip('${esc(f.filename)}')" class="btn btn-secondary btn-sm">Önizle</button>
              <button onclick="deleteServerZip('${esc(f.filename)}')" class="btn btn-ghost btn-sm" style="color:var(--danger)">Sil</button>
            </div>
          </div>`).join('')}
      </div>
    </div>` : `
    <div class="bg-gray-50 border border-gray-200 rounded-xl p-5 mb-6 text-center">
      <p class="text-gray-500 text-sm">Sunucuda bekleyen ZIP dosyası yok.</p>
      <p class="text-xs text-gray-400 mt-1">FTP ile <code>admin/imports/</code> klasörüne ZIP yükleyebilirsiniz.</p>
    </div>`}

    <!-- Upload ZIP -->
    <div class="card mb-6" style="padding:24px">
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

// Small stat tile used in the ZIP preview summary strip.
function zipStat(label, value, tone) {
  const palette = {
    success: { fg: 'var(--success-text)', bg: 'var(--success-soft)' },
    warning: { fg: 'var(--warning-text)', bg: 'var(--warning-soft)' },
    info:    { fg: 'var(--info-text)',    bg: 'var(--info-soft)' },
    neutral: { fg: 'var(--text)',         bg: 'var(--bg-card)' },
  };
  const c = palette[tone] || palette.neutral;
  return `<div style="background:${c.bg};padding:12px 14px;text-align:center">
    <div class="text-xl font-bold tabular" style="color:${c.fg};line-height:1.1">${esc(String(value))}</div>
    <div class="text-xs font-medium mt-0.5" style="color:${c.fg};opacity:.85">${esc(label)}</div>
  </div>`;
}

// Render a single article row in the ZIP preview, with an expandable figure-match section.
function renderZipPreviewArticle(a, index) {
  const figureBadge = a.figureCount === 0
    ? '<span class="badge badge-neutral">Figür yok</span>'
    : (a.figuresMissing === 0
      ? `<span class="badge badge-success"><span class="badge-dot"></span>${a.figuresMatched}/${a.figureCount} figür</span>`
      : `<span class="badge badge-warning"><span class="badge-dot"></span>${a.figuresMatched}/${a.figureCount} figür</span>`);
  const pdfBadge = a.matchedPdf
    ? '<span class="badge badge-success"><span class="badge-dot"></span>PDF</span>'
    : '<span class="badge badge-warning"><span class="badge-dot"></span>PDF yok</span>';

  // Import-status badge: classify each XML against existing data so the user
  // can see at a glance whether it's a new article, an AIP entry that will
  // be promoted (moved from "in press" into the issue), or a true duplicate.
  let statusBadge = '';
  if (a.importStatus === 'promote' && a.aipMatch) {
    statusBadge = `<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a" title="Baskıda #${a.aipMatch.id} olarak mevcut — bu sayıya geçirilecek"><span class="badge-dot" style="background:#92400e"></span>Baskıdan geçecek (#${a.aipMatch.id})</span>`;
  } else if (a.importStatus === 'duplicate' && a.publishedMatch) {
    statusBadge = `<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca" title="Yayınlanmış #${a.publishedMatch.id} ile aynı DOI — &quot;Mevcut makaleleri güncelle&quot; kapalıysa atlanır, açıksa güncellenir"><span class="badge-dot" style="background:#b91c1c"></span>Duplicate (#${a.publishedMatch.id})</span>`;
  } else {
    statusBadge = '<span class="badge" style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0"><span class="badge-dot" style="background:#15803d"></span>Yeni</span>';
  }

  const hasMissing = a.figuresMissing > 0;
  const detailId = `zip-detail-${index}`;

  return `
    <div class="card-flat" data-zip-article="${index}">
      <button type="button" onclick="toggleZipDetail('${detailId}', this)"
        class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
        style="background:transparent;border:0">
        <svg class="w-4 h-4 transition-transform flex-shrink-0" data-chev fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="color:var(--text-faint)"><polyline points="9 18 15 12 9 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate" style="color:var(--text-strong)">${esc(a.title)}</div>
          <div class="text-xs mt-0.5" style="color:var(--text-muted)">
            ${esc(a.authors.slice(0, 3).join(', '))}${a.authors.length > 3 ? ' et al.' : ''}
          </div>
        </div>
        <div class="flex gap-1.5 flex-shrink-0 items-center">
          ${statusBadge}
          ${typeBadge(a.type)}
          ${pdfBadge}
          ${figureBadge}
        </div>
      </button>
      <div id="${detailId}" class="hidden px-4 pb-4 pt-1" style="border-top:1px solid var(--border-soft)">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          <div>
            <div class="text-xs font-semibold mb-2" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">Genel Bilgi</div>
            <dl class="text-xs space-y-1" style="color:var(--text)">
              <div class="flex gap-2"><dt style="color:var(--text-muted);min-width:60px">XML</dt><dd><code>${esc(a.xmlFile)}</code></dd></div>
              ${a.doi ? `<div class="flex gap-2"><dt style="color:var(--text-muted);min-width:60px">DOI</dt><dd>${esc(a.doi)}</dd></div>` : ''}
              ${a.aipMatch ? `<div class="flex gap-2"><dt style="color:var(--text-muted);min-width:60px">Baskıda</dt><dd><a href="#/articles-in-press/${a.aipMatch.id}" style="color:#92400e">#${a.aipMatch.id}</a> — bu sayıya taşınacak</dd></div>` : ''}
              ${a.publishedMatch ? `<div class="flex gap-2"><dt style="color:var(--text-muted);min-width:60px">Mevcut</dt><dd><a href="#/articles/${a.publishedMatch.id}" style="color:#b91c1c">#${a.publishedMatch.id}</a> — aynı DOI (güncelle seçili değilse atlanır)</dd></div>` : ''}
              ${a.pages ? `<div class="flex gap-2"><dt style="color:var(--text-muted);min-width:60px">Sayfa</dt><dd>${esc(a.pages)}</dd></div>` : ''}
              <div class="flex gap-2"><dt style="color:var(--text-muted);min-width:60px">PDF</dt><dd>${a.matchedPdf ? `<code style="color:var(--success-text)">${esc(a.matchedPdf)}</code>` : '<span style="color:var(--warning-text)">eşleşmedi</span>'}</dd></div>
            </dl>
          </div>
          <div>
            <div class="text-xs font-semibold mb-2" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">Figür Eşleşmesi (${a.figuresMatched}/${a.figureCount})</div>
            ${a.figureCount === 0
              ? '<div class="text-xs" style="color:var(--text-faint)">Bu makalede figür yok.</div>'
              : `<div class="space-y-1">${(a.figures || []).map((f) => zipFigureRow(f)).join('')}</div>`}
            ${hasMissing ? `<div class="banner banner-warning mt-3" style="padding:8px 10px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <div class="banner-body" style="margin-top:0;font-size:11.5px">Aktarımdan sonra eksik figürleri "Makale → Dosyalar → Figürler" sekmesinden tek tek yükleyebilirsiniz.</div>
            </div>` : ''}
            ${a.existingAssets ? `<div class="banner banner-warning mt-3" style="padding:8px 10px;background:#fef3c7;border-color:#fde68a">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#92400e"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              <div class="banner-body" style="margin-top:0;font-size:11.5px;color:#78350f">
                <strong>Önceki import'tan kalan dosyalar temizlenecek</strong> (#${a.aipMatch ? a.aipMatch.id : a.publishedMatch && a.publishedMatch.id}):
                ${a.existingAssets.figures.length ? a.existingAssets.figures.length + ' figür' : ''}${a.existingAssets.figures.length && (a.existingAssets.supplementary.length || a.existingAssets.fullText) ? ', ' : ''}${a.existingAssets.supplementary.length ? a.existingAssets.supplementary.length + ' ek materyal' : ''}${(a.existingAssets.figures.length || a.existingAssets.supplementary.length) && a.existingAssets.fullText ? ', ' : ''}${a.existingAssets.fullText ? 'tam metin' : ''} silinip yenisiyle değiştirilecek.
              </div>
            </div>` : ''}
          </div>
        </div>
      </div>
    </div>`;
}

function zipFigureRow(f) {
  if (f.status === 'matched') {
    return `<div class="flex items-center gap-2 text-xs py-1">
      <span class="badge badge-success" style="min-width:48px;justify-content:center">${esc(f.label || f.id || 'fig')}</span>
      <code style="color:var(--text-muted);flex-shrink:0">${esc(f.originalRef)}</code>
      <span style="color:var(--text-faint)">→</span>
      <code style="color:var(--success-text)">${esc(f.matchedFile)}</code>
    </div>`;
  }
  if (f.status === 'missing') {
    return `<div class="flex items-center gap-2 text-xs py-1">
      <span class="badge badge-warning" style="min-width:48px;justify-content:center">${esc(f.label || f.id || 'fig')}</span>
      <code style="color:var(--warning-text)">${esc(f.originalRef)}</code>
      <span style="color:var(--text-faint)">→ eşleşmedi</span>
    </div>`;
  }
  return `<div class="text-xs py-1" style="color:var(--text-faint)">
    <span class="badge badge-neutral">${esc(f.label || f.id || 'fig')}</span> JATS'te dosya referansı yok
  </div>`;
}

function toggleZipDetail(detailId, btn) {
  const el = document.getElementById(detailId);
  if (!el) return;
  el.classList.toggle('hidden');
  const chev = btn.querySelector('[data-chev]');
  if (chev) chev.style.transform = el.classList.contains('hidden') ? '' : 'rotate(90deg)';
}

async function uploadAndPreviewZip(file) {
  if (!file || !file.name.toLowerCase().endsWith('.zip')) {
    return toast('Lütfen ZIP dosyası seçin', 'warning');
  }

  const area = document.getElementById('zip-preview-area');
  const totalHuman = formatBytes(file.size);
  area.innerHTML = `
    <div class="card card-padded mb-6">
      <div class="flex items-center justify-between mb-2">
        <div class="min-w-0">
          <div class="font-medium text-gray-900 truncate">${esc(file.name)}</div>
          <div class="text-xs text-gray-500 mt-0.5" id="zip-progress-label">Yükleniyor... 0%</div>
        </div>
        <div class="text-sm text-gray-500 flex-shrink-0 ml-3" id="zip-progress-bytes">0 B / ${esc(totalHuman)}</div>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div id="zip-progress-bar" class="h-full bg-teal-600 transition-all duration-150" style="width: 0%"></div>
      </div>
    </div>`;

  try {
    const uploadResult = await API.uploadFileWithProgress('/imports/upload', file, 'zip', {}, (pct, loaded, total) => {
      const bar = document.getElementById('zip-progress-bar');
      const label = document.getElementById('zip-progress-label');
      const bytes = document.getElementById('zip-progress-bytes');
      if (bar) bar.style.width = pct + '%';
      if (bytes) bytes.textContent = `${formatBytes(loaded)} / ${formatBytes(total)}`;
      if (label) {
        label.textContent = pct < 100 ? `Yükleniyor... ${pct}%` : 'Sunucu ZIP\'i alıyor...';
      }
    });

    // Upload complete — now analysing on the server (no byte progress available).
    const label = document.getElementById('zip-progress-label');
    const bar = document.getElementById('zip-progress-bar');
    if (bar) { bar.classList.remove('bg-teal-600'); bar.classList.add('bg-teal-500', 'animate-pulse'); bar.style.width = '100%'; }
    if (label) label.textContent = 'ZIP analiz ediliyor...';

    if (!uploadResult || !uploadResult.filename) {
      throw new Error('Yükleme tamamlandı fakat sunucu dosya adı döndürmedi');
    }
    await showZipPreview(uploadResult.filename);
  } catch (err) {
    console.error('[uploadAndPreviewZip] failed:', err);
    area.innerHTML = `
      <div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
        <div class="font-semibold mb-1">ZIP yükleme/analiz hatası</div>
        <div class="text-sm">${esc(err.message || String(err))}</div>
        <div class="text-xs text-red-500 mt-2">Ayrıntılar için tarayıcı konsolunu (F12) kontrol edin.</div>
      </div>`;
  }
}

async function previewServerZip(filename) {
  const area = document.getElementById('zip-preview-area');
  area.innerHTML = '<div class="flex items-center justify-center py-8"><div class="animate-spin w-6 h-6 border-3 border-teal-600 border-t-transparent rounded-full mr-3"></div><span class="text-gray-500">Analiz ediliyor...</span></div>';
  await showZipPreview(filename);
}

async function showZipPreview(filename) {
  const area = document.getElementById('zip-preview-area');
  // Always show an explicit analyzing state so users know the server is working.
  area.innerHTML = `
    <div class="card mb-6 flex items-center justify-center gap-3" style="padding:24px">
      <div class="animate-spin w-6 h-6 border-4 border-teal-600 border-t-transparent rounded-full"></div>
      <div>
        <div class="font-medium text-gray-900">ZIP analiz ediliyor...</div>
        <div class="text-xs text-gray-500 mt-0.5">${esc(filename)} — XML'ler ayrıştırılıyor</div>
      </div>
    </div>`;
  try {
    const preview = await API.get(`/imports/preview/${encodeURIComponent(filename)}`);
    if (!preview || !Array.isArray(preview.articles)) {
      throw new Error('Sunucudan geçersiz yanıt alındı');
    }
    const issueOptions = window._zipIssueOptions || [];

    // Detect volume/issue from first article
    const firstArticle = preview.articles[0];
    const detectedVol = firstArticle?.volume || '';
    const detectedIss = firstArticle?.issue || '';

    if (preview.articles.length === 0 && preview.errors.length === 0) {
      area.innerHTML = `<div class="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl">ZIP içinde XML dosyası bulunamadı. (${preview.analysis.pdfFiles.length} PDF, ${preview.analysis.imageFiles.length} görsel, ${preview.analysis.otherFiles.length} diğer)</div>`;
      return;
    }

    const allOk = preview.summary.parsedOk === preview.summary.totalXml
      && preview.summary.pdfsMatched === preview.summary.parsedOk
      && preview.summary.imagesMissing === 0;

    area.innerHTML = `
      <div class="card mb-6">
        <div class="px-6 py-4" style="border-bottom:1px solid var(--border-soft);background:var(--bg-page);border-radius:var(--radius) var(--radius) 0 0">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="min-w-0">
              <h2 class="text-base font-semibold truncate" style="color:var(--text-strong)">${esc(filename)}</h2>
              <div class="flex gap-3 mt-1 text-xs" style="color:var(--text-muted)">
                <span><strong style="color:var(--text-strong)">${preview.summary.totalXml}</strong> XML</span>
                <span>·</span>
                <span><strong style="color:var(--text-strong)">${preview.analysis.pdfFiles.length}</strong> PDF</span>
                <span>·</span>
                <span><strong style="color:var(--text-strong)">${preview.analysis.imageFiles.length}</strong> Görsel</span>
                <span>·</span>
                <span><strong style="color:var(--text-strong)">${preview.analysis.otherFiles.length}</strong> Diğer</span>
              </div>
            </div>
            ${allOk
              ? '<div class="badge badge-success"><span class="badge-dot"></span>Tüm eşleşmeler tamam</div>'
              : '<div class="badge badge-warning"><span class="badge-dot"></span>Eksik eşleşmeler var</div>'}
          </div>
        </div>

        <!-- Summary stat strip -->
        <div class="grid grid-cols-3 md:grid-cols-6 gap-px" style="background:var(--border-soft)">
          ${zipStat('Yeni', preview.summary.newArticles ?? preview.summary.parsedOk, 'success')}
          ${zipStat('Baskıdan', preview.summary.promotedFromAip ?? 0, (preview.summary.promotedFromAip ?? 0) > 0 ? 'warning' : 'neutral')}
          ${zipStat('Duplicate', preview.summary.duplicates ?? 0, (preview.summary.duplicates ?? 0) > 0 ? 'warning' : 'neutral')}
          ${zipStat('PDF', preview.summary.pdfsMatched + '/' + preview.summary.parsedOk, preview.summary.pdfsMatched === preview.summary.parsedOk ? 'success' : 'warning')}
          ${zipStat('Figür', preview.summary.imagesMatched + '/' + (preview.summary.imagesMatched + preview.summary.imagesMissing), preview.summary.imagesMissing === 0 ? 'success' : 'warning')}
          ${zipStat('Orphan', preview.summary.orphanImages || 0, (preview.summary.orphanImages || 0) === 0 ? 'neutral' : 'info')}
        </div>
        ${(preview.summary.promotedFromAip ?? 0) > 0 ? `
        <div class="px-6 py-3" style="background:#fffbeb;border-bottom:1px solid #fde68a;color:#92400e;font-size:13px;line-height:1.5">
          <strong>ℹ Baskıdan geçecek makaleler:</strong> ${preview.summary.promotedFromAip} makale şu anda <em>Baskıda</em> statüsünde — aktarım sırasında bu sayıya taşınacak ve "Baskıda" listesinden otomatik kaldırılacak. Görüntüleme/indirme sayıları korunur.
        </div>` : ''}
        ${(preview.summary.duplicates ?? 0) > 0 ? `
        <div id="zip-dup-banner" class="px-6 py-3" style="background:#fee2e2;border-bottom:1px solid #fecaca;color:#b91c1c;font-size:13px;line-height:1.5">
          <strong data-dup-title>⚠ Duplicate makaleler:</strong> <span data-dup-msg>${preview.summary.duplicates} makalenin DOI'si zaten yayınlanmış. Bunlar atlanacak.</span>
        </div>` : ''}

        <!-- Import settings -->
        <div class="px-6 py-4" style="border-bottom:1px solid var(--border-soft);background:var(--bg-page)">
          <h3 class="section-title mb-3">Aktarma Ayarları</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label class="label" style="font-size:11px">Hedef Sayı</label>
              <select id="zip-target" class="input">
                <option value="auto">XML'den oku</option>
                ${issueOptions.map((o) => `<option value="${o.volume}|${o.issue}|${o.year}" ${o.volume == detectedVol && String(o.issue) === String(detectedIss) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
                <option value="new">Yeni sayı oluştur</option>
              </select>
            </div>
            <div id="zip-new-issue-fields" class="hidden col-span-2">
              <div class="grid grid-cols-3 gap-2">
                <div><label class="label" style="font-size:11px">Yıl</label><input id="zip-year" type="number" value="${new Date().getFullYear()}" class="input"></div>
                <div><label class="label" style="font-size:11px">Cilt</label><input id="zip-vol" type="number" value="${detectedVol}" class="input"></div>
                <div><label class="label" style="font-size:11px">Sayı</label><input id="zip-iss" value="${detectedIss}" class="input"></div>
              </div>
            </div>
            <div class="flex items-end gap-4 flex-wrap">
              <label class="flex items-center gap-2 text-sm cursor-pointer" style="color:var(--text)"><input id="zip-set-current" type="checkbox" class="rounded"> Güncel sayı yap</label>
              <label class="flex items-center gap-2 text-sm cursor-pointer" title="DOI'si eşleşen mevcut makaleleri XML verileriyle güncelle — hangi cilt/sayıda olursa olsun, makale id'si korunarak üzerine yazılır (hata vermez)" style="color:var(--text)"><input id="zip-overwrite" type="checkbox" class="rounded"> Mevcut makaleleri güncelle</label>
            </div>
          </div>
        </div>

        <!-- Articles list -->
        <div class="px-6 py-4">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h3 class="section-title">Makaleler · ${preview.summary.parsedOk}</h3>
              <div class="text-xs mt-0.5" style="color:var(--text-muted)">Satıra tıklayın → figür eşleşme detaylarını gör</div>
            </div>
            <button onclick="processZipImport('${esc(filename)}')" class="btn btn-primary">Tümünü Aktar</button>
          </div>

          ${preview.errors.length ? `
          <div class="banner banner-danger mb-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <div>
              <div class="banner-title">${preview.errors.length} XML parse edilemedi</div>
              <div class="banner-body">${preview.errors.map((e) => `${esc(e.xmlFile)}: ${esc(e.error)}`).join('<br>')}</div>
            </div>
          </div>` : ''}

          <div class="space-y-2">
            ${preview.articles.map((a, i) => renderZipPreviewArticle(a, i)).join('')}
          </div>

          ${(preview.orphanImages || []).length ? `
          <details class="mt-4">
            <summary class="cursor-pointer text-sm font-medium" style="color:var(--info)">
              ${preview.orphanImages.length} görsel ZIP'te var ama hiçbir makale referans vermiyor →
            </summary>
            <div class="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              ${preview.orphanImages.map((img) => `<div class="card-flat" style="padding:6px 10px"><code>${esc(img.name)}</code><div style="color:var(--text-faint);font-size:11px">${esc(img.sizeHuman)}</div></div>`).join('')}
            </div>
          </details>` : ''}
        </div>
      </div>`;

    // Toggle new issue fields
    document.getElementById('zip-target').addEventListener('change', function () {
      document.getElementById('zip-new-issue-fields').classList.toggle('hidden', this.value !== 'new');
    });

    // Keep the duplicate banner truthful about what "Mevcut makaleleri güncelle"
    // will actually do: skip (off) vs update-in-place (on). The summary is
    // computed at preview time without knowing the checkbox, so reconcile it
    // live whenever the toggle changes.
    const dupCount = preview.summary.duplicates ?? 0;
    const ovEl = document.getElementById('zip-overwrite');
    const dupBanner = document.getElementById('zip-dup-banner');
    if (dupCount > 0 && ovEl && dupBanner) {
      const titleEl = dupBanner.querySelector('[data-dup-title]');
      const msgEl = dupBanner.querySelector('[data-dup-msg]');
      const refreshDupBanner = () => {
        if (ovEl.checked) {
          titleEl.textContent = '✓ Güncellenecek makaleler:';
          msgEl.textContent = `${dupCount} makalenin DOI'si zaten yayınlanmış. "Mevcut makaleleri güncelle" seçili — bunlar atlanmayacak, mevcut kayıtlar (id korunarak) XML verileriyle güncellenecek.`;
          dupBanner.style.background = '#ecfdf5';
          dupBanner.style.borderBottom = '1px solid #a7f3d0';
          dupBanner.style.color = '#065f46';
        } else {
          titleEl.textContent = '⚠ Duplicate makaleler:';
          msgEl.textContent = `${dupCount} makalenin DOI'si zaten yayınlanmış. Bunlar atlanacak. (Güncellemek için "Mevcut makaleleri güncelle" seçeneğini işaretleyin.)`;
          dupBanner.style.background = '#fee2e2';
          dupBanner.style.borderBottom = '1px solid #fecaca';
          dupBanner.style.color = '#b91c1c';
        }
      };
      ovEl.addEventListener('change', refreshDupBanner);
      refreshDupBanner();
    }

  } catch (err) {
    console.error('[showZipPreview] failed:', err);
    area.innerHTML = `
      <div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
        <div class="font-semibold mb-1">ZIP önizleme başarısız</div>
        <div class="text-sm">${esc(err.message || String(err))}</div>
        <div class="text-xs text-red-500 mt-2">Ayrıntılar için tarayıcı konsolunu (F12) kontrol edin.</div>
      </div>`;
  }
}

async function processZipImport(filename) {
  const target = document.getElementById('zip-target').value;
  const setCurrent = document.getElementById('zip-set-current').checked;
  const overwrite = document.getElementById('zip-overwrite')?.checked || false;

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
      overwrite,
    });

    const totalPromoted = result.totalPromoted || 0;
    const totalNew = result.totalImported - totalPromoted;
    let html = `<div class="card" style="padding:24px">
      <h2 class="text-xl font-bold text-green-700 mb-4">Import Tamamlandı</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-green-50 rounded-lg p-4 text-center">
          <div class="text-3xl font-bold text-green-700">${result.totalImported}</div>
          <div class="text-sm text-green-600">Toplam Aktarılan</div>
        </div>
        <div class="rounded-lg p-4 text-center" style="background:#dcfce7">
          <div class="text-3xl font-bold" style="color:#15803d">${totalNew}</div>
          <div class="text-sm" style="color:#166534">Yeni Makale</div>
        </div>
        <div class="rounded-lg p-4 text-center" style="background:${totalPromoted > 0 ? '#fef3c7' : '#f3f4f6'}">
          <div class="text-3xl font-bold" style="color:${totalPromoted > 0 ? '#92400e' : '#6b7280'}">${totalPromoted}</div>
          <div class="text-sm" style="color:${totalPromoted > 0 ? '#854d0e' : '#6b7280'}">Baskıdan Geçti</div>
        </div>
        ${result.totalErrors ? `<div class="bg-red-50 rounded-lg p-4 text-center">
          <div class="text-3xl font-bold text-red-700">${result.totalErrors}</div>
          <div class="text-sm text-red-600">Hata</div>
        </div>` : `<div class="bg-gray-50 rounded-lg p-4 text-center">
          <div class="text-3xl font-bold text-gray-700">0</div>
          <div class="text-sm text-gray-600">Hata</div>
        </div>`}
      </div>
      ${totalPromoted > 0 ? `<div class="mb-4 p-3 rounded-lg" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:13px;line-height:1.5">
        <strong>✓ ${totalPromoted} makale Baskıdan bu sayıya geçirildi</strong> — "Baskıda" listesinden otomatik kaldırıldı; görüntüleme/indirme sayıları korundu.
      </div>` : ''}`;

    if (result.imported.length) {
      html += `<h3 class="font-semibold text-gray-700 mb-2">Aktarılan Makaleler</h3>
        <div class="space-y-1 mb-4">${result.imported.map((a) => `
          <div class="flex items-center gap-2 text-sm p-2 rounded hover:bg-gray-50">
            <a href="#/articles/${Number(a.id)}" class="text-teal-600 hover:underline font-medium">#${Number(a.id)}</a>
            <span class="flex-1 truncate">${esc(a.title)}</span>
            ${a.promotedFromAip ? '<span class="badge" style="background:#fef3c7;color:#92400e;font-size:11px;padding:2px 6px">Baskıdan</span>' : ''}
            ${a.overwritten ? '<span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:11px;padding:2px 6px">Güncellendi</span>' : ''}
            ${a.cleanedStaleFiles ? `<span class="badge" style="background:#e0f2fe;color:#075985;font-size:11px;padding:2px 6px" title="${esc(a.cleanedStaleFiles.figures.concat(a.cleanedStaleFiles.supplementary).join(', '))}">${a.cleanedStaleFiles.count} eski dosya temizlendi</span>` : ''}
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
      ${result.volume ? `<a href="#/issues/${encodeURIComponent(result.volume)}/${encodeURIComponent(result.issue)}" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Sayıyı Görüntüle</a>` : ''}
      <a href="#/zip-import" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm">Başka ZIP Aktar</a>
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
async function renderJatsImport(el) {
  const archive = await API.get('/issues');
  const issueOptions = [];
  for (const y of archive) {
    for (const iss of y.issues) {
      issueOptions.push({ label: `${y.year} — Vol ${iss.volume}, Issue ${iss.issue}`, volume: iss.volume, issue: iss.issue });
    }
  }
  window._aipIssueOptions = issueOptions;

  el.innerHTML = `
    <div class="card mb-6" style="padding:24px">
      <div class="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Hedef</label>
          <select id="import-target" class="input">
            <option value="auto">XML'den oku (otomatik)</option>
            <option value="in-press">Baskıda olarak ekle</option>
            ${issueOptions.map((o) => `<option value="${o.volume}|${o.issue}">Vol ${o.volume}, Issue ${o.issue} (${esc(o.label.split(' — ')[0])})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Sayı yoksa</label>
          <label class="flex items-center gap-2 text-sm h-9 px-3 border rounded-lg bg-gray-50">
            <input id="import-create-issue" type="checkbox" checked class="rounded">
            <span>Otomatik oluştur</span>
          </label>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Yeni sayı yılı</label>
          <input id="import-year" type="number" value="${new Date().getFullYear()}" class="input">
        </div>
      </div>
      <p class="text-xs text-gray-500 mb-4">Otomatik modda makaleler XML'deki cilt/sayı bilgisine atanır. Eğer arşivde bu sayı yoksa ve "Otomatik oluştur" işaretliyse arşive yeni bir kayıt eklenir.</p>
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
}

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
        <button onclick="importAllParsed()" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Tümünü Aktar</button>
      </div>`;
    }

    html += parsed.map((r, i) => {
      if (!r.success) {
        return `<div class="bg-red-50 border border-red-200 rounded-xl p-4"><strong class="text-red-700">${esc(r.filename)}</strong>: ${esc(r.error)}</div>`;
      }
      const a = r.article;
      return `
        <div class="card card-padded" id="parsed-${i}">
          <div class="flex items-start justify-between mb-3">
            <div>
              ${typeBadge(a.type)}
              <span class="text-xs text-gray-400 ml-2">${esc(r.filename)}</span>
            </div>
            <button onclick="importParsed(${i})" class="px-4 py-1.5 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Aktar</button>
          </div>
          <h3 class="font-semibold text-gray-900 mb-2">${esc(a.title)}</h3>
          <div class="text-sm text-gray-600 mb-2">${(a.authors || []).map((au) => esc(au.name)).join(', ')}</div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-500">
            <div><strong>DOI:</strong> ${esc(a.doi)}</div>
            <div><strong>Cilt:</strong> ${esc(a.volume) || '-'} / ${esc(a.issue) || '-'}</div>
            <div><strong>Sayfa:</strong> ${esc(a.pages)}</div>
            <div><strong>Tarih:</strong> ${esc(a.published)}</div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            ${(() => {
              // Surface what's actually inside this XML so the operator can
              // spot abstract-only payloads (a known gotcha for AIP imports —
              // see project_aip_fulltext_abstract.md). The badges turn
              // amber/red when something is missing so issues don't sneak
              // through unnoticed.
              const ftLen = (a.fullTextHtml || '').length;
              const figureCount = (a.figures || []).length;
              const suppCount = (a.supplementary || []).length;
              const ftBadge = ftLen > 2000
                ? `<span class="badge badge-success" title="${ftLen.toLocaleString('tr-TR')} karakter"><span class="badge-dot"></span>Tam metin</span>`
                : ftLen > 0
                  ? `<span class="badge badge-warning" title="Sadece ${ftLen.toLocaleString('tr-TR')} karakter — büyük olasılıkla yalnız özet"><span class="badge-dot"></span>Kısa metin (${ftLen} kr)</span>`
                  : `<span class="badge" style="background:#fee2e2;color:#991b1b" title="XML'de hiç tam metin yok"><span class="badge-dot" style="background:#991b1b"></span>Tam metin yok</span>`;
              const figBadge = figureCount > 0
                ? `<span class="badge badge-info"><span class="badge-dot"></span>${figureCount} figür</span>`
                : '';
              const suppBadge = suppCount > 0
                ? `<span class="badge badge-info"><span class="badge-dot"></span>${suppCount} ek materyal</span>`
                : '';
              const pmidBadge = a.pmid
                ? `<span class="badge badge-neutral" title="PMID: ${esc(a.pmid)}">PMID</span>`
                : '';
              return [ftBadge, figBadge, suppBadge, pmidBadge].filter(Boolean).join('');
            })()}
            ${a.relatedArticles?.length ? `<span class="badge badge-info">Bağlantı · ${a.relatedArticles.map((r) => esc(r.type)).join(', ')}</span>` : ''}
          </div>
          ${(a.figures || []).length > 0 ? `
            <div class="mt-2 text-xs" style="color:var(--text-faint)">
              <span style="color:var(--warning, #b45309)">⚠</span>
              "Baskıda olarak ekle" seçilirse JATS figürleri diske yazılmaz — yalnız ZIP içe aktarımı figür dosyalarını taşır. Bu makaleyi figürlerle birlikte yayınlamak için ZIP import kullanın veya figürleri manuel yükleyin.
            </div>` : ''}
        </div>`;
    }).join('');

    results.innerHTML = html;
    window._parsedArticles = parsed;
  } catch (err) {
    results.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded-xl">${esc(err.message)}</div>`;
  }
}

function getJatsImportOptions() {
  return {
    createIssue: document.getElementById('import-create-issue')?.checked !== false,
    year: document.getElementById('import-year')?.value || String(new Date().getFullYear()),
  };
}

async function importParsed(index) {
  const parsed = window._parsedArticles?.[index];
  if (!parsed?.success) return;

  const target = document.getElementById('import-target')?.value || 'auto';
  const opts = getJatsImportOptions();

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
        ...opts,
      });
      toast(`Makale aktarıldı: Vol ${vol}, Issue ${iss}`);
    } else {
      const result = await API.post('/jats/import', {
        parsedArticle: parsed.article,
        fullTextHtml: parsed.article.fullTextHtml || '',
        ...opts,
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
  const opts = getJatsImportOptions();

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
        ...opts,
      });
      if (result.totalImported) toast(`${result.totalImported} makale aktarıldı (Vol ${vol}, Issue ${iss})`);
      if (result.totalErrors) toast(`${result.totalErrors} hata`, 'warning');
    } else {
      const result = await API.post('/jats/import-batch', { parsedArticles: toImport, ...opts });
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
  const [archive, homepage] = await Promise.all([
    API.get('/issues'),
    API.get('/homepage').catch(() => ({})),
  ]);
  const cur = homepage?.currentIssue || {};
  const isCurrent = (vol, iss) => Number(cur.volume) === Number(vol) && String(cur.issue) === String(iss);
  const featuredCount = (homepage?.featuredArticles || []).length;
  const imageCornerCount = (homepage?.imageCornerArticles || []).length;
  const latestCount = (homepage?.latestArticles || []).length;

  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Sayılar</h1>
      <div class="flex gap-2">
        <button onclick="checkServerImports()" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Sunucudan Kontrol Et</button>
        <button onclick="showNewIssueForm()" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Yeni Sayı</button>
      </div>
    </div>

    <!-- Current issue control panel -->
    <div class="card-hero card-padded mb-6">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="text-xs font-semibold uppercase tracking-wider" style="color:var(--brand)">Güncel Sayı</div>
          ${cur.volume ? `
            <div class="text-xl font-bold text-gray-900 mt-1">Volume ${esc(cur.volume)}, Issue ${esc(cur.issue)}${cur.year ? ` <span class="text-base font-normal text-gray-500">(${esc(cur.year)})</span>` : ''}</div>
            <div class="flex gap-4 mt-2 text-xs text-gray-600">
              <span>${featuredCount} öne çıkan</span>
              <span>${imageCornerCount} görsel köşesi</span>
              <span>${latestCount} son makale</span>
              ${homepage.generatedAt ? `<span class="text-gray-400">Son güncelleme: ${esc(homepage.generatedAt)}</span>` : ''}
            </div>
          ` : `
            <div class="text-base text-gray-700 mt-1">Henüz güncel sayı atanmamış.</div>
            <div class="text-xs text-gray-500 mt-1">Aşağıdaki listeden bir sayıyı seçip "Güncel Yap" butonuna basın.</div>
          `}
        </div>
        ${cur.volume ? `
        <div class="flex gap-2">
          <a href="#/issues/${esc(cur.volume)}/${encodeURIComponent(cur.issue)}" class="btn btn-secondary btn-sm">Sayıyı Düzenle</a>
          <a href="/site/current-issue.html?volume=${encodeURIComponent(cur.volume)}&issue=${encodeURIComponent(cur.issue)}" target="_blank" rel="noopener" class="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded text-xs font-medium hover:bg-slate-50">Sitede Önizle</a>
          <button onclick="rebuildCurrentHomepage()" class="px-3 py-1.5 bg-teal-700 text-white rounded text-xs font-medium hover:bg-teal-800" title="Anasayfa verisini güncel sayıdan yeniden oluştur">Anasayfayı Yenile</button>
        </div>` : ''}
      </div>
    </div>

    <div id="new-issue-form" class="hidden card card-padded mb-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input id="ni-year" type="number" placeholder="Yil (2026)" class="px-3 py-2 border rounded-lg text-sm">
        <input id="ni-volume" type="number" placeholder="Cilt (43)" class="px-3 py-2 border rounded-lg text-sm">
        <input id="ni-issue" placeholder="Sayı (3)" class="px-3 py-2 border rounded-lg text-sm">
        <button onclick="createIssue()" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Oluştur</button>
      </div>
    </div>
    <div class="space-y-4">
      ${archive.map((y) => `
        <div class="card">
          <div class="px-5 py-3 rounded-t-xl font-semibold" style="background:var(--bg-page);color:var(--text-strong);border-bottom:1px solid var(--border-soft)">${esc(y.year)} — Volume ${y.volume}</div>
          <div class="divide-y">
            ${y.issues.map((iss) => {
              const cur_ = isCurrent(iss.volume, iss.issue);
              return `
              <div class="flex items-center justify-between px-5 py-3 hover:bg-slate-50 cursor-pointer ${cur_ ? 'bg-teal-50/40' : ''}" onclick="navigate('#/issues/${iss.volume}/${iss.issue}')">
                <div class="flex items-center gap-3">
                  <span class="font-medium" style="color:var(--text-strong)">${esc(iss.label)}</span>
                  <span class="text-sm" style="color:var(--text-faint)">${iss.articleCount} makale</span>
                  ${cur_ ? '<span class="badge badge-info">GÜNCEL</span>' : ''}
                </div>
                <div class="flex gap-2 items-center">
                  <a href="/site/current-issue.html?year=${encodeURIComponent(y.year)}&volume=${iss.volume}&issue=${encodeURIComponent(iss.issue)}" target="_blank" rel="noopener" class="text-xs font-medium" style="color:var(--text-muted)" onclick="event.stopPropagation()" onmouseover="this.style.color='var(--text-strong)'" onmouseout="this.style.color='var(--text-muted)'">Önizle</a>
                  ${cur_
                    ? ''
                    : `<button onclick="event.stopPropagation(); setCurrentIssue(${iss.volume}, '${iss.issue}')" class="btn btn-secondary btn-sm">Güncel Yap</button>`}
                  <button onclick="event.stopPropagation(); rebuildIssue(${iss.volume}, '${iss.issue}')" class="btn btn-ghost btn-sm">Yeniden Oluştur</button>
                  <button onclick="event.stopPropagation(); deleteIssue('${y.year}', ${iss.volume}, '${iss.issue}')" class="btn btn-ghost btn-sm" style="color:var(--danger)">Sil</button>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`).join('')}
    </div>`;
});

async function rebuildCurrentHomepage() {
  try {
    const homepage = await API.get('/homepage');
    const cur = homepage?.currentIssue;
    if (!cur?.volume) {
      toast('Önce bir güncel sayı atayın', 'warning');
      return;
    }
    const result = await API.post(`/issues/${cur.volume}/${encodeURIComponent(cur.issue)}/set-current`);
    toast(`Anasayfa yenilendi (${result.articleCount} makale)`);
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

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
  // Fetch article count for this issue so the confirmation is informative
  let articleCount = 0;
  try { articleCount = (await API.get(`/issues/${volume}/${issue}/articles`)).length; } catch (_) {}

  const articleNote = articleCount > 0
    ? `Bu sayıya ait <strong>${articleCount} makale</strong> de kalıcı olarak silinecek (tam metin dosyaları dahil).`
    : 'Bu sayıda makale yok.';

  const confirmed = await confirmAction(
    `Vol ${volume}, Issue ${issue} silinsin mi?\n\n${articleNote}\n\nBu işlem geri alınamaz.`
  );
  if (!confirmed) return;

  try {
    await API.del(`/issues/${year}/${volume}/${issue}?deleteArticles=true`);
    toast(`Sayı silindi${articleCount > 0 ? ` · ${articleCount} makale kaldırıldı` : ''}`);
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// Issue detail
route('/issues/:volume/:issue', async (el, { volume, issue }) => {
  const [articles, homepage, issueFiles] = await Promise.all([
    API.get(`/issues/${volume}/${issue}/articles`),
    API.get('/homepage').catch(() => ({})),
    loadIssuePdfFiles(volume, issue),
  ]);
  const cur = homepage?.currentIssue || {};
  const isCurrent = Number(cur.volume) === Number(volume) && String(cur.issue) === String(issue);
  const featuredArticle = articles.find((a) => a.featured) || null;
  const featuredCount = articles.filter((a) => a.featured).length;
  const imageCornerCount = articles.filter((a) => a.imageCorner).length;
  const pdfCount = articles.filter((a) => a.pdfUrl).length;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <a href="#/issues" class="text-sm text-teal-600 hover:text-teal-800">&larr; Tüm Sayılar</a>
        <div class="flex items-center gap-3 mt-1">
          <h1 class="page-title">Volume ${esc(volume)}, Issue ${esc(issue)}</h1>
          ${isCurrent ? '<span class="badge badge-info">GÜNCEL SAYI</span>' : ''}
        </div>
        <p class="text-sm text-gray-500">${articles.length} makale · ${pdfCount} PDF · ${imageCornerCount} görsel köşesi</p>
      </div>
      <div class="flex gap-2">
        <a href="/site/current-issue.html?volume=${encodeURIComponent(volume)}&issue=${encodeURIComponent(issue)}" target="_blank" rel="noopener" class="px-4 py-2 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 text-sm font-medium">Önizle</a>
        ${isCurrent
          ? `<button onclick="setCurrentIssue(${volume}, '${issue}')" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 shadow-sm text-sm font-medium" title="Anasayfa verisini bu sayıdan yeniden hesaplar">Anasayfayı Yenile</button>`
          : `<button onclick="setCurrentIssue(${volume}, '${issue}')" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Güncel Sayı Yap</button>`}
        <button onclick="rebuildIssue(${volume}, '${issue}')" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm">Yeniden Oluştur</button>
      </div>
    </div>

    ${isCurrent ? `
    <div class="card card-padded mb-6 flex items-start gap-3" style="background:var(--brand-soft);border-color:var(--brand-soft-2)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--brand);flex-shrink:0;margin-top:2px"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <div>
        <div class="font-semibold text-sm" style="color:var(--brand)">Bu sayı şu anda anasayfada "Güncel Sayı" olarak görünüyor.</div>
        <div class="text-xs mt-1" style="color:var(--text-muted)">Öne çıkan makale kaydedildiğinde anasayfa hero banner'ı otomatik güncellenir. Her sayıda yalnızca bir makale öne çıkan olabilir.</div>
      </div>
    </div>` : ''}

    <!-- Featured article banner preview -->
    <div class="card card-padded mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-gray-900">Öne Çıkan Makale <span class="text-xs font-normal text-gray-400 ml-1">— Hero Banner</span></h2>
        ${!featuredArticle ? `<a href="#/articles/new?volume=${encodeURIComponent(volume)}&issue=${encodeURIComponent(issue)}" class="text-xs text-teal-600 hover:text-teal-800">+ Makale ekle</a>` : ''}
      </div>
      ${featuredArticle ? `
        <div class="flex items-start gap-3 p-3 rounded-lg" style="background:var(--bg-subtle);border:1px solid var(--border)">
          <div style="flex-shrink:0;width:28px;height:28px;background:var(--brand);border-radius:6px;display:flex;align-items:center;justify-content:center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-900 truncate">${esc(featuredArticle.title)}</div>
            <div class="text-xs text-gray-500 mt-0.5">${(featuredArticle.authors || []).map((a) => esc(a.name)).join(', ')}</div>
            <div class="text-xs text-gray-400 mt-0.5">ID ${featuredArticle.id} · ${esc(featuredArticle.type || '')}</div>
          </div>
          <a href="#/articles/${featuredArticle.id}" class="text-xs text-teal-600 hover:text-teal-800 whitespace-nowrap flex-shrink-0">Düzenle →</a>
        </div>
        <p class="text-xs text-gray-400 mt-2">Bu makale anasayfa hero slider'ındaki "Current Issue Highlights" kartında görünür. Değiştirmek için başka bir makalenin "Genel" sekmesinde "Öne Çıkan" kutusunu işaretleyin.</p>
      ` : `
        <div class="text-center py-6" style="border:1px dashed var(--border);border-radius:8px">
          <svg class="mx-auto mb-2" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-faint)"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <p class="text-sm text-gray-500">Bu sayıda öne çıkan makale seçilmemiş.</p>
          <p class="text-xs text-gray-400 mt-1">Bir makalenin "Genel" sekmesinden "Öne Çıkan" kutusunu işaretleyin — hero banner otomatik güncellenir.</p>
        </div>
      `}
    </div>

    <!-- Issue-level PDFs -->
    <div class="card card-padded mb-6">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 class="font-semibold text-gray-900">Sayı PDF Dosyaları</h2>
          <p class="text-xs text-gray-400 mt-1">Sayının tamamını ve kapak sayfasını ayrı PDF dosyaları olarak yönetin.</p>
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        ${issuePdfUploadCard('full', 'Full PDF', 'Sayının tüm sayfalarını içeren birleşik PDF', issueFiles.fullPdf)}
        ${issuePdfUploadCard('cover', 'Cover PDF', 'Sayının yalnızca kapak sayfasını içeren PDF', issueFiles.coverPdf)}
      </div>
    </div>

    <!-- Batch JATS upload for this issue -->
    <div class="card card-padded mb-6">
      <h2 class="font-semibold text-gray-900 mb-3">Bu Sayıya JATS XML Aktar</h2>
      <div id="issue-drop-zone" class="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-teal-400 transition-colors cursor-pointer">
        <p class="text-gray-600 font-medium">XML dosyalarını sürükleyin veya tıklayın</p>
        <p class="text-xs text-gray-400 mt-1">Tüm makaleler Volume ${esc(volume)}, Issue ${esc(issue)} olarak atanır</p>
        <input id="issue-xml-input" type="file" accept=".xml" multiple class="hidden">
      </div>
      <div id="issue-parsed-results" class="mt-4 space-y-3"></div>
    </div>

    <!-- Batch PDF upload for this issue -->
    <div class="card card-padded mb-6">
      <h2 class="font-semibold text-gray-900 mb-3">Bu Sayıya Toplu PDF Yükle</h2>
      <div id="issue-pdf-drop" class="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:border-teal-400 transition-colors cursor-pointer">
        <p class="text-gray-600 text-sm">PDF dosyalarını sürükleyin (dosya adı = makale ID)</p>
        <input id="issue-pdf-input" type="file" accept=".pdf" multiple class="hidden">
      </div>
      <div id="issue-pdf-results" class="mt-3"></div>
    </div>

    <!-- Manual article entry for this issue (for articles that don't arrive as ePub/XML) -->
    <div class="card card-padded mb-6">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 class="font-semibold text-gray-900">Manuel Makale Ekle</h2>
          <p class="text-xs text-gray-400 mt-1">ePub/XML olarak gelmeyen makaleler için boş bir makale formu açar — Cilt ${esc(volume)}, Sayı ${esc(issue)} otomatik atanır. Kaydedince makale bu sayıya eklenir.</p>
        </div>
        <a href="#/articles/new?volume=${encodeURIComponent(volume)}&issue=${encodeURIComponent(issue)}" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium whitespace-nowrap">+ Manuel Makale</a>
      </div>
    </div>

    <!-- Move toolbar (hidden until selection) -->
    <div id="move-toolbar" class="hidden bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 flex items-center gap-3 flex-wrap">
      <span class="text-sm font-medium text-slate-800"><span id="move-count">0</span> makale secildi</span>
      <span class="text-gray-300">|</span>
      <span class="text-sm text-gray-600">Hedef:</span>
      <input id="move-vol" type="number" placeholder="Cilt" class="w-20 px-2 py-1.5 border rounded-lg text-sm">
      <input id="move-iss" placeholder="Sayı" class="w-20 px-2 py-1.5 border rounded-lg text-sm">
      <button onclick="moveSelectedArticles()" class="px-4 py-1.5 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Taşı</button>
      <button onclick="clearMoveSelection()" class="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-sm">Vazgeç</button>
    </div>

    <!-- Articles in this issue -->
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th class="px-3 py-3 w-8"><input type="checkbox" id="move-select-all" class="rounded" onchange="toggleAllMoveCheckboxes(this.checked)"></th>
          <th>ID</th>
          <th>Sayfa</th>
          <th>Başlık</th>
          <th>Tür</th>
          <th>DOI</th>
          <th>PDF</th>
          <th class="px-4 py-3"></th>
        </tr></thead>
        <tbody>${articles.map((a) => `
          <tr class="cursor-pointer" onclick="navigate('#/articles/${a.id}')">
            <td class="px-3 py-3" onclick="event.stopPropagation()"><input type="checkbox" class="move-cb rounded" value="${a.id}" onchange="updateMoveToolbar()"></td>
            <td class="px-4 py-3 text-gray-400">${a.id}</td>
            <td class="px-4 py-3 text-gray-500">${esc(a.pages || '-')}</td>
            <td class="px-4 py-3 max-w-sm truncate">${esc(a.title)}</td>
            <td class="px-4 py-3">${typeBadge(a.type)}</td>
            <td class="px-4 py-3 text-xs text-gray-400">${esc(a.doi || '-')}</td>
            <td class="px-4 py-3 text-center">${a.pdfUrl ? '<span class="text-green-500" title="PDF mevcut">&#10003;</span>' : '<span class="text-gray-300" title="PDF yok">&#8212;</span>'}</td>
            <td class="px-4 py-3 whitespace-nowrap">
              <a href="/site/article.html?id=${a.id}" target="_blank" rel="noopener" class="text-slate-600 hover:text-slate-800 text-xs mr-3" onclick="event.stopPropagation()">Önizle</a>
              <button class="text-amber-700 hover:text-amber-900 text-xs mr-3" title="Makaleyi dosyalarıyla birlikte e-Pub Makaleler bölümüne geri al" onclick="event.stopPropagation(); returnArticleToAip(${a.id})">e-Pub'a Geri Al</button>
              <button class="text-red-500 hover:text-red-700 text-xs" onclick="event.stopPropagation(); deleteArticle(${a.id})">Sil</button>
            </td>
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

  setupIssuePdfUpload('full', volume, issue);
  setupIssuePdfUpload('cover', volume, issue);

  // PDF drop zone for this issue
  const pdfDrop = document.getElementById('issue-pdf-drop');
  const pdfInput = document.getElementById('issue-pdf-input');
  pdfDrop.onclick = () => pdfInput.click();
  pdfDrop.ondragover = (e) => { e.preventDefault(); pdfDrop.classList.add('border-teal-400', 'bg-teal-50'); };
  pdfDrop.ondragleave = () => pdfDrop.classList.remove('border-teal-400', 'bg-teal-50');
  pdfDrop.ondrop = (e) => { e.preventDefault(); pdfDrop.classList.remove('border-teal-400', 'bg-teal-50'); handleIssuePdfUpload(e.dataTransfer.files); };
  pdfInput.onchange = () => handleIssuePdfUpload(pdfInput.files);
});

function issuePdfUploadCard(type, title, description, file) {
  const hasFile = !!file?.url;
  const uploadedAt = file?.uploadedAt
    ? new Date(file.uploadedAt).toLocaleString('tr-TR')
    : '';
  return `
    <section id="issue-${type}-pdf-card" class="rounded-xl p-4" style="border:1px solid var(--border);background:var(--bg-subtle)">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 class="font-semibold text-gray-900">${esc(title)}</h3>
          <p class="text-xs text-gray-500 mt-1">${esc(description)}</p>
        </div>
        <span class="badge ${hasFile ? 'badge-success' : 'badge-neutral'}">${hasFile ? 'Yüklendi' : 'Eksik'}</span>
      </div>
      ${hasFile ? `
        <div class="bg-white rounded-lg p-3 mb-3" style="border:1px solid var(--border-soft)">
          <div class="text-sm font-medium text-gray-900 truncate" title="${esc(file.originalName || '')}">${esc(file.originalName || `${title}.pdf`)}</div>
          <div class="text-xs text-gray-400 mt-1">${esc(formatBytes(file.size || 0))}${uploadedAt ? ` · ${esc(uploadedAt)}` : ''}</div>
          <div class="flex items-center gap-3 mt-2">
            <a href="/site/${esc(file.url)}" target="_blank" rel="noopener" class="text-xs text-teal-700 hover:text-teal-900">Görüntüle</a>
            <button type="button" class="text-xs text-red-500 hover:text-red-700" onclick="deleteIssuePdf('${type}')">Kaldır</button>
          </div>
        </div>
      ` : ''}
      <div id="issue-${type}-pdf-drop" class="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-teal-400 transition-colors cursor-pointer bg-white">
        <p class="text-sm text-gray-600 font-medium">${hasFile ? 'PDF dosyasını değiştir' : 'PDF yükle'}</p>
        <p class="text-xs text-gray-400 mt-1">Dosyayı sürükleyin veya seçmek için tıklayın</p>
        <input id="issue-${type}-pdf-input" type="file" accept="application/pdf,.pdf" class="hidden">
      </div>
      <div id="issue-${type}-pdf-result" class="mt-3"></div>
    </section>`;
}

function legacyIssuePdfId(type, volume, issue) {
  const clean = (value) => String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `issue-vol${clean(volume)}-${clean(issue)}-${type}`;
}

async function probeLegacyIssuePdf(type, volume, issue) {
  const url = `js/data/pdfs/${legacyIssuePdfId(type, volume, issue)}.pdf`;
  try {
    const response = await fetch(`/site/${url}`, { method: 'HEAD', cache: 'no-store' });
    if (!response.ok) return null;
    return {
      url,
      originalName: type === 'full' ? 'Full PDF.pdf' : 'Cover PDF.pdf',
      size: Number(response.headers.get('content-length')) || 0,
      uploadedAt: '',
      legacy: true,
    };
  } catch (_) {
    return null;
  }
}

async function loadIssuePdfFiles(volume, issue) {
  let files = { fullPdf: null, coverPdf: null };
  try {
    files = await API.get(`/issues/${volume}/${issue}/files`);
  } catch (_) {
    // Older running server versions do not have the issue-files endpoint.
  }
  const [legacyFull, legacyCover] = await Promise.all([
    files.fullPdf ? null : probeLegacyIssuePdf('full', volume, issue),
    files.coverPdf ? null : probeLegacyIssuePdf('cover', volume, issue),
  ]);
  return {
    fullPdf: files.fullPdf || legacyFull,
    coverPdf: files.coverPdf || legacyCover,
  };
}

function setupIssuePdfUpload(type, volume, issue) {
  const drop = document.getElementById(`issue-${type}-pdf-drop`);
  const input = document.getElementById(`issue-${type}-pdf-input`);
  if (!drop || !input) return;

  const upload = (files) => {
    const file = files && files[0];
    if (file) uploadIssuePdf(type, volume, issue, file);
  };
  drop.onclick = () => input.click();
  drop.ondragover = (event) => {
    event.preventDefault();
    drop.classList.add('border-teal-400', 'bg-teal-50');
  };
  drop.ondragleave = () => drop.classList.remove('border-teal-400', 'bg-teal-50');
  drop.ondrop = (event) => {
    event.preventDefault();
    drop.classList.remove('border-teal-400', 'bg-teal-50');
    upload(event.dataTransfer.files);
  };
  input.onchange = () => upload(input.files);
}

async function uploadIssuePdf(type, volume, issue, file) {
  if (!/\.pdf$/i.test(file.name || '')) {
    toast('Yalnızca PDF dosyası yüklenebilir', 'error');
    return;
  }
  const label = type === 'full' ? 'Full PDF' : 'Cover PDF';
  const progress = renderUploadProgress(`issue-${type}-pdf-result`, [file], `${label} yükleniyor`);
  try {
    try {
      await API.uploadFileWithProgress(
        `/issues/${encodeURIComponent(volume)}/${encodeURIComponent(issue)}/files/${type}`,
        file,
        'pdf',
        {},
        progress.update
      );
    } catch (err) {
      if (!/(not found|404|rotası bulunamadı)/i.test(String(err.message || ''))) throw err;
      await API.uploadFileWithProgress(
        '/media/upload/pdf',
        file,
        'pdf',
        { articleId: legacyIssuePdfId(type, volume, issue) },
        progress.update
      );
    }
    toast(`${label} kaydedildi`);
    handleRoute();
  } catch (err) {
    progress.fail(err.message);
  }
}

async function deleteIssuePdf(type) {
  const match = location.hash.match(/^#\/issues\/([^/]+)\/([^/]+)/);
  if (!match) return;
  const label = type === 'full' ? 'Full PDF' : 'Cover PDF';
  if (!await confirmAction(`${label} kaldırılsın mı?`)) return;
  try {
    await API.del(`/issues/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/files/${type}`);
    toast(`${label} kaldırıldı`);
    handleRoute();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// --- Article move functions ---
function toggleAllMoveCheckboxes(checked) {
  document.querySelectorAll('.move-cb').forEach((cb) => { cb.checked = checked; });
  updateMoveToolbar();
}

function updateMoveToolbar() {
  const checked = document.querySelectorAll('.move-cb:checked');
  const toolbar = document.getElementById('move-toolbar');
  const countEl = document.getElementById('move-count');
  if (checked.length > 0) {
    toolbar.classList.remove('hidden');
    countEl.textContent = checked.length;
  } else {
    toolbar.classList.add('hidden');
  }
}

function clearMoveSelection() {
  document.querySelectorAll('.move-cb').forEach((cb) => { cb.checked = false; });
  const selectAll = document.getElementById('move-select-all');
  if (selectAll) selectAll.checked = false;
  updateMoveToolbar();
}

async function moveSelectedArticles() {
  const checked = document.querySelectorAll('.move-cb:checked');
  if (!checked.length) { toast('Makale seçin', 'warning'); return; }

  const targetVolume = parseInt(document.getElementById('move-vol')?.value);
  const targetIssue = document.getElementById('move-iss')?.value?.trim();
  if (!targetVolume || !targetIssue) { toast('Hedef cilt ve sayı girin', 'error'); return; }

  const ids = Array.from(checked).map((cb) => Number(cb.value));
  if (!await confirmAction(`${ids.length} makale Volume ${targetVolume}, Issue ${targetIssue} sayısına taşınacak. Devam?`)) return;

  try {
    const result = await API.post('/articles/move', { articleIds: ids, targetVolume, targetIssue });
    toast(`${result.moved} makale taşındı → Vol ${result.targetVolume}, Issue ${result.targetIssue}`);
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

async function returnArticleToAip(id) {
  const confirmed = await confirmAction(
    'Bu makale sayıdan çıkarılıp e-Pub Makaleler bölümüne geri alınacak. PDF, tam metin, görseller ve ek dosyalar korunacak. Devam edilsin mi?'
  );
  if (!confirmed) return;

  try {
    await API.post(`/articles/${id}/return-to-in-press`, {});
    toast('Makale e-Pub Makaleler bölümüne geri alındı');
    handleRoute();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleIssuePdfUpload(files) {
  if (!files || !files.length) return;
  const prog = renderUploadProgress('issue-pdf-results', files, 'PDF\'ler yükleniyor');
  try {
    const result = await API.uploadFilesWithProgress('/media/upload/pdf-batch', files, 'pdf', {}, prog.update);
    let html = '';
    if (result.totalMatched) html += `<div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 mb-2">${result.totalMatched} PDF eşleştirildi</div>`;
    if (result.totalUnmatched) html += `<div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">${result.totalUnmatched} PDF eşleştirilemedi (yine de yüklendi)</div>`;
    if (!html) html = '<div class="bg-gray-50 border text-gray-700 p-3 rounded-lg text-sm">Yükleme tamamlandı.</div>';
    prog.complete(html);
  } catch (err) {
    prog.fail(err.message);
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
          <button onclick="importBatchToIssue(${volume}, '${issue}')" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Tümünü Aktar</button>
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
  if (!await confirmAction(`Volume ${volume}, Issue ${issue} güncel sayı olarak ayarlanacak ve anasayfa verisi bu sayıdan yeniden oluşturulacak. Devam?`)) return;
  try {
    const result = await API.post(`/issues/${volume}/${encodeURIComponent(issue)}/set-current`);
    toast(`Güncel sayı ayarlandı (${result.articleCount} makale)`);
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// Articles in Press
async function renderAipArticles(el) {
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
    <div class="flex items-center gap-3 mb-4">
      <span class="text-sm flex-1" style="color:var(--text-muted)">${aip.length} baskıda makale</span>
      <a href="#/articles-in-press/new" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium whitespace-nowrap">+ Manuel Ekle</a>
      ${aip.length ? `<button onclick="publishSelectedAip()" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium whitespace-nowrap">Seçilenleri Sayıya Taşı</button>` : ''}
    </div>
    ${aip.length > 1 ? `<p class="text-xs mb-3" style="color:var(--text-faint)">Sıralamayı değiştirmek için satırın solundaki tutamacı sürükleyip istediğiniz konuma bırakın.</p>` : ''}

    ${aip.length ? `
    <!-- Publish controls -->
    <div id="aip-publish-bar" class="hidden card card-padded mb-6" style="background:var(--brand-soft);border-color:var(--brand-soft-2)">
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-sm font-semibold" style="color:var(--brand)" id="aip-selected-count">0 makale seçili</span>
        <select id="aip-target-issue" class="input flex-1" style="min-width:200px">
          <option value="">Hedef sayı seçin...</option>
          ${issueOptions.map((o) => `<option value="${o.volume}|${o.issue}">${esc(o.label)}</option>`).join('')}
        </select>
        <button onclick="doPublishAip()" class="btn btn-primary">Sayıya Taşı</button>
      </div>
    </div>` : ''}

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th class="px-2 py-3 w-10" aria-label="Sıralama"></th>
          <th class="px-4 py-3 w-8"><input type="checkbox" id="aip-select-all" class="rounded"></th>
          <th>ID</th>
          <th>Başlık / Kabul Tarihi</th>
          <th>Tür</th>
          <th>Durum</th>
          <th>DOI</th>
          <th class="px-4 py-3"></th>
        </tr></thead>
        <tbody id="aip-list-body">${aip.map((a, _aipIdx) => `
          <tr class="aip-list-row" data-id="${a.id}" ondragend="this.removeAttribute('draggable')">
            <td class="px-2 py-3">
              <span class="row-grip" title="Sıralamak için tutup sürükleyin" aria-label="Sürükle" onmousedown="this.closest('.aip-list-row').setAttribute('draggable','true')">${ROW_GRIP_SVG}</span>
            </td>
            <td class="px-4 py-3"><input type="checkbox" class="aip-check rounded" data-id="${a.id}"></td>
            <td class="px-4 py-3 tabular" style="color:var(--text-faint)">${a.id}</td>
            <td class="px-4 py-3 max-w-sm">
              <a href="#/articles-in-press/${a.id}/edit" class="hover:underline block" style="color:var(--brand-strong);font-weight:500;white-space:normal;line-height:1.35" title="${esc(a.title)}">${esc(a.title)}</a>
              ${a.accepted ? `<span class="text-xs mt-0.5 block" style="color:var(--text-faint)">Kabul: ${esc(a.accepted)}</span>` : ''}
            </td>
            <td class="px-4 py-3">${typeBadge(a.type)}</td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap gap-1">
                ${a.pdfUrl
                  ? '<span class="badge badge-success" title="PDF dosyası yüklü"><span class="badge-dot"></span>PDF</span>'
                  : '<span class="badge badge-warning" title="PDF yüklenmemiş"><span class="badge-dot"></span>PDF yok</span>'}
                ${a.hasFullText
                  ? '<span class="badge badge-info" title="HTML tam metin yüklü"><span class="badge-dot"></span>Tam metin</span>'
                  : '<span class="badge badge-warning" title="Tam metin yüklenmemiş — Tam Metin sekmesinden ekleyin"><span class="badge-dot"></span>Tam metin yok</span>'}
              </div>
            </td>
            <td class="px-4 py-3 text-xs">
              ${a.doi
                ? `<a href="https://doi.org/${esc(a.doi)}" target="_blank" class="hover:underline break-all" style="color:var(--brand)" title="${esc(a.doi)}">${esc(a.doi)}</a>`
                : `<span style="color:var(--text-faint)">—</span>`}
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              ${_aipIdx > 0 ? `<button class="btn btn-ghost btn-sm" title="Yukarı taşı" onclick="moveAip(${a.id},'up')">↑</button>` : `<span class="btn btn-ghost btn-sm invisible">↑</span>`}
              ${_aipIdx < aip.length - 1 ? `<button class="btn btn-ghost btn-sm" title="Aşağı taşı" onclick="moveAip(${a.id},'down')">↓</button>` : `<span class="btn btn-ghost btn-sm invisible">↓</span>`}
              <button class="btn btn-primary btn-sm" title="Bu makaleyi seçilecek sayıya taşı" onclick="moveSingleAipToIssue(${a.id})">Sayıya Taşı</button>
              <a href="#/articles-in-press/${a.id}/edit?tab=fulltext" class="btn btn-ghost btn-sm" title="Doğrudan Tam Metin sekmesini aç">Tam Metin</a>
              <a href="#/articles-in-press/${a.id}/edit" class="btn btn-ghost btn-sm">Düzenle</a>
              <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteAip(${a.id})">Sil</button>
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
}

async function _aipReorderByDrop(srcRow, tgtRow, above) {
  const body = srcRow && srcRow.parentNode;
  if (!body || body !== tgtRow.parentNode || body.id !== 'aip-list-body') return;

  body.insertBefore(srcRow, above ? tgtRow : tgtRow.nextSibling);
  const ids = Array.from(body.querySelectorAll('.aip-list-row'))
    .map((row) => Number(row.dataset.id))
    .filter(Number.isFinite);

  try {
    await API.post('/articles-in-press/reorder', { ids });
    toast('e-Pub makale sırası güncellendi');
    handleRoute();
  } catch (err) {
    toast(err.message, 'error');
    handleRoute();
  }
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

  if (!await confirmAction(`${ids.length} makale Volume ${volume}, Issue ${issue} sayısına taşınacak. Devam?`)) return;

  try {
    const result = await API.post('/articles-in-press/publish', { articleIds: ids, volume: Number(volume), issue });
    toast(`${result.count} makale sayıya taşındı`);
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

async function moveSingleAipToIssue(id) {
  let options = Array.isArray(window._aipIssueOptions) ? window._aipIssueOptions : [];
  if (!options.length) {
    const archive = await API.get('/issues');
    options = archive.flatMap((yearGroup) =>
      (yearGroup.issues || []).map((issue) => ({
        label: `${yearGroup.year} — Vol ${issue.volume}, Issue ${issue.issue}`,
        volume: issue.volume,
        issue: issue.issue,
      }))
    );
  }
  if (!options.length) {
    toast('Önce bir sayı oluşturun', 'warning');
    return;
  }

  window._singleAipTarget = `${options[0].volume}|${options[0].issue}`;
  const action = await modal('Makaleyi Sayıya Taşı', `
    <p class="text-sm mb-4" style="color:var(--text-muted)">Makalenin taşınacağı sayıyı seçin. PDF, tam metin ve diğer dosyalar korunur.</p>
    <label class="label" for="single-aip-target">Hedef Sayı</label>
    <select id="single-aip-target" class="input" onchange="window._singleAipTarget=this.value">
      ${options.map((option) => `<option value="${option.volume}|${esc(option.issue)}">${esc(option.label)}</option>`).join('')}
    </select>
  `, [
    { label: 'İptal', value: 'cancel', class: 'btn-secondary' },
    { label: 'Sayıya Taşı', value: 'move', class: 'btn-primary' },
  ]);
  if (action !== 'move') return;

  const [volume, issue] = String(window._singleAipTarget || '').split('|');
  if (!volume || !issue) {
    toast('Hedef sayı seçilmedi', 'warning');
    return;
  }

  try {
    await API.post('/articles-in-press/publish', {
      articleIds: [Number(id)],
      volume: Number(volume),
      issue,
    });
    toast(`Makale Volume ${volume}, Issue ${issue} sayısına taşındı`);
    handleRoute();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    delete window._singleAipTarget;
  }
}

async function deleteAip(id) {
  if (!await confirmAction('Bu baskıda makaleyi silmek istediğinizden emin misiniz?')) return;
  try {
    await API.del(`/articles-in-press/${id}`);
    toast('Makale silindi');
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// Move an AIP article up or down in the display order
async function moveAip(id, direction) {
  try {
    const aip = await API.get('/articles-in-press');
    const idx = aip.findIndex((a) => a.id === id);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === aip.length - 1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const ids = aip.map((a) => a.id);
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
    await API.post('/articles-in-press/reorder', { ids });
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// --- Manuel AIP (baskıda makale) ekleme/düzenleme ---
route('/articles-in-press/new', (el, { query } = {}) => renderAipForm(el, null, { defaultTab: query?.get('tab') }));
route('/articles-in-press/:id/edit', async (el, { id, query }) => {
  try {
    const article = await API.get(`/articles-in-press/${id}`);
    renderAipForm(el, article, { defaultTab: query?.get('tab') });
  } catch (err) {
    el.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded-lg">${esc(err.message)}</div>`;
  }
});

let _aipFullTextLoadToken = 0;

function renderAipForm(el, article, opts = {}) {
  // Invalidate requests started by the previously open AIP form. A slow
  // response must never populate the editor after navigation to another item.
  _aipFullTextLoadToken += 1;
  const defaultTab = ['general', 'authors', 'abstract', 'fulltext', 'media'].includes(opts.defaultTab) ? opts.defaultTab : 'general';
  const isNew = !article;
  const a = article || { id: '', type: '', title: '', authors: [], abstract: '', abstractHtml: '', keywords: [], doi: '', received: '', accepted: '', publishedOnline: '', published: '', pmid: '', pdfUrl: '' };

  el.innerHTML = `
    ${pageHeader({
      eyebrow: 'Baskıda Makaleler',
      title: isNew ? 'Yeni Baskıda Makale' : `Baskıda Makale #${a.id}`,
      subtitle: isNew ? 'Manuel olarak ekleniyor — yayına alındığında ana listeye geçecek.' : (a.title ? esc(a.title) : ''),
      actions: `
        <a href="#/articles-in-press" class="btn btn-secondary">Geri</a>
        ${isNew ? `
          <label class="btn btn-secondary cursor-pointer" title="Galenos şablonundaki Word dosyasından metadata yükle">
            Word'den İçe Aktar
            <input type="file" accept=".docx" id="aipf-import-docx" class="hidden">
          </label>
        ` : ''}
        ${!isNew ? `<a href="/site/article.html?id=${a.id}&source=aip" target="_blank" rel="noopener" class="btn btn-secondary" title="Public sitedeki halini yeni sekmede aç">Önizleme ↗</a>` : ''}
        <button onclick="saveAip(${isNew ? 'true' : 'false'})" class="btn btn-primary">Kaydet<span data-dirty-indicator class="text-amber-200"></span></button>
      `,
    })}

    <div class="card">
      <!-- Tabs -->
      <div class="flex border-b overflow-x-auto" style="border-color:var(--border-soft)">
        <button class="aip-tab-btn px-5 py-3 text-sm font-medium border-b-2 transition-colors" data-tab="general">Genel</button>
        <button class="aip-tab-btn px-5 py-3 text-sm font-medium border-b-2 transition-colors" data-tab="abstract">Özet</button>
        <button class="aip-tab-btn px-5 py-3 text-sm font-medium border-b-2 transition-colors" data-tab="authors">Yazarlar</button>
        <button class="aip-tab-btn px-5 py-3 text-sm font-medium border-b-2 transition-colors" data-tab="fulltext">Tam Metin</button>
        ${!isNew ? `<button class="aip-tab-btn px-5 py-3 text-sm font-medium border-b-2 transition-colors" data-tab="media">Dosyalar</button>` : ''}
      </div>

      <!-- General -->
      <div class="aip-tab-panel p-6" data-tab="general">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="label">Tür <span style="color:var(--danger)">*</span></label>
            <input id="aipf-type" value="${esc(a.type)}" class="input" list="aipf-type-list">
            <datalist id="aipf-type-list"></datalist>
          </div>
          <div><label class="label">DOI</label>
            <input id="aipf-doi" value="${esc(a.doi)}" class="input">
          </div>
        </div>
        <div class="mt-4"><label class="label">Başlık <span style="color:var(--danger)">*</span></label>
          <input id="aipf-title" value="${esc(a.title)}" class="input">
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div><label class="label">Alındığı Tarih</label>
            <input id="aipf-received" type="date" value="${dateInputValue(a.received)}" class="input"></div>
          <div><label class="label">Kabul Tarihi</label>
            <input id="aipf-accepted" type="date" value="${dateInputValue(a.accepted)}" class="input"></div>
          <div><label class="label">PMID</label>
            <input id="aipf-pmid" value="${esc(a.pmid || '')}" class="input"></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div><label class="label">Epub Tarihi <span class="font-normal" style="color:var(--text-faint)">(çevrimiçi yayın)</span></label>
            <input id="aipf-published-online" type="date" value="${dateInputValue(a.publishedOnline)}" class="input"></div>
          <div><label class="label">Makale Yayın Tarihi</label>
            <input id="aipf-published" type="date" value="${dateInputValue(a.published)}" class="input"></div>
        </div>
      </div>

      <!-- Authors -->
      <div class="aip-tab-panel p-6 hidden" data-tab="authors">
        ${(() => {
          const { affiliations: _affList, authorIdx: _authorIdx } = buildAffiliationsFromAuthors(a.authors);
          const _authorsWithIdx = (a.authors || []).map((au, i) => Object.assign({}, au, { _affIdx: _authorIdx[i] }));
          return `
        <div class="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div class="flex items-baseline justify-between mb-3">
            <label class="text-sm font-semibold text-gray-700">Kurumlar</label>
            <span class="text-xs text-gray-500">Yazar satırına ilgili numarayı yazın (ör. <code class="bg-white px-1 rounded">1</code> veya <code class="bg-white px-1 rounded">1,2</code>)</span>
          </div>
          <div id="aipf-affiliations-list" class="space-y-2">${_affList.map((t, i) => aipfAffRow(t, i + 1)).join('')}</div>
          <button type="button" onclick="addAipAffiliation()" class="mt-2 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-xs font-medium">+ Kurum Ekle</button>
        </div>

        <label class="text-sm font-semibold text-gray-700 block mb-2">Yazarlar</label>
        <div id="aipf-authors" class="space-y-2">${_authorsWithIdx.map((au) => aipAuthorRow(au)).join('')}</div>
        <button type="button" onclick="addAipAuthor()" class="btn btn-secondary btn-sm mt-3">+ Yazar Ekle</button>
        `;
        })()}
      </div>

      <!-- Abstract -->
      <div class="aip-tab-panel p-6 hidden" data-tab="abstract">
        <label class="label">Özet</label>
        ${htmlEditor({ prefix: 'aip-abs', initialHtml: a.abstractHtml || a.abstract || '', rows: 8, placeholder: 'Özet metnini buraya girin', variant: 'compact', minHeight: '180px' })}
        <div class="mt-4"><label class="label">Anahtar Kelimeler <span class="font-normal" style="color:var(--text-faint)">(virgül ile)</span></label>
          <input id="aipf-keywords" value="${esc((a.keywords || []).join(', '))}" class="input">
        </div>
      </div>

      <!-- Full Text -->
      <div class="aip-tab-panel p-6 hidden" data-tab="fulltext">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 class="text-sm font-semibold" style="color:var(--text-strong)">Tam Metin</h3>
            <p class="text-xs mt-0.5" style="color:var(--text-muted)">Makale yayınlandığında aynı ID ile ana listeye aktarılır.</p>
            ${!isNew ? `<label class="text-xs mt-2 inline-flex items-center gap-1.5 cursor-pointer" style="color:var(--text-muted)">
              <input type="checkbox" id="aipf-has-fulltext" class="rounded" ${a.hasFullText ? 'checked' : ''} onchange="markDirty()">
              <span>Tam metin görünür</span>
              <span class="text-xs" style="color:var(--text-faint)">(işaretlenmezse makale sayfasında sadece özet gösterilir)</span>
            </label>` : ''}
          </div>
          <div class="flex gap-2 flex-wrap">
            <label class="btn btn-secondary btn-sm cursor-pointer">
              HTML Dosyadan Yükle <input id="aipf-fulltext-file" type="file" accept=".html,.htm" class="hidden">
            </label>
            ${!isNew ? `<a href="/site/article.html?id=${a.id}&source=aip" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" title="Tam metnin canlı sitedeki halini yeni sekmede aç">Önizleme ↗</a>` : ''}
            ${!isNew ? `<button type="button" onclick="saveAipFullText(${a.id})" class="btn btn-primary btn-sm">Tam Metni Kaydet</button>` : ''}
          </div>
        </div>
        ${isNew ? `<div class="card card-padded mb-3 flex items-start gap-2" style="background:var(--brand-soft);border-color:var(--brand-soft-2)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--brand);flex-shrink:0;margin-top:2px"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="text-xs" style="color:var(--text-strong)">Yeni makale oluşturulurken tam metin de buradan yüklenebilir. Sayfa üstündeki <strong>Kaydet</strong> butonuna basıldığında makale ile birlikte otomatik kaydedilir.</div>
        </div>` : ''}
        ${htmlEditor({ prefix: 'aip-ft', initialHtml: '', rows: 20, placeholder: 'Tam metin henüz yüklü değil. Doğrudan yazın, yapıştırın veya yukarıdaki "HTML Dosyadan Yükle" ile bir .html dosyası seçin.', variant: 'full', minHeight: '400px' })}
        <div id="aipf-fulltext-status" class="text-xs mt-2" style="color:var(--text-muted)"></div>
      </div>

      ${!isNew ? `
      <!-- Files tab (compact + premium, mirrors Article Edit Files tab) -->
      <div class="aip-tab-panel p-6 hidden" data-tab="media">
        <div class="space-y-5">

          <!-- PDF: single-line row -->
          <section class="flex items-center gap-3 flex-wrap" style="padding:10px 12px;background:var(--bg-page);border:1px solid var(--border-soft);border-radius:var(--radius)">
            <div class="text-sm font-semibold" style="color:var(--text-strong);min-width:32px">PDF</div>
            ${a.pdfUrl
              ? `<span class="badge badge-success"><span class="badge-dot"></span>Mevcut</span>
                 <code class="text-xs px-2 py-1 rounded truncate" style="background:var(--bg-card);color:var(--text-muted);flex:1;min-width:0">${esc(a.pdfUrl)}</code>`
              : `<span class="badge badge-warning"><span class="badge-dot"></span>Yüklenmemiş</span>
                 <span class="text-xs" style="color:var(--text-muted);flex:1">PDF dosyası eklenmemiş.</span>`}
            <label class="btn btn-secondary btn-sm cursor-pointer flex-shrink-0">
              ${a.pdfUrl ? 'Değiştir' : 'PDF Yükle'} <input id="f-pdf-file" type="file" accept=".pdf" class="hidden">
            </label>
          </section>
          <div id="f-pdf-results"></div>
          <span id="f-pdf-count" class="hidden"></span>
          <span id="f-fig-count" class="hidden"></span>
          <span id="f-supp-count" class="hidden"></span>

          <!-- Figures wizard -->
          <section>
            <div class="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <div class="flex items-baseline gap-3">
                <h3 class="text-sm font-semibold" style="color:var(--text-strong)">Figürler</h3>
                <span id="f-fig-inline-stats" class="text-xs" style="color:var(--text-muted)">yükleniyor…</span>
              </div>
              <div class="flex gap-2 flex-shrink-0">
                <label class="btn btn-secondary btn-sm cursor-pointer">
                  Çoklu Yükle <input id="f-fig-files" type="file" accept="image/*,.tif,.tiff" multiple class="hidden">
                </label>
                <button type="button" onclick="applyExistingFigures(${a.id})" class="btn btn-primary btn-sm" title="Yüklü figürleri tam metindeki placeholder'lar ile eşler">Tam Metne Uygula</button>
              </div>
            </div>
            <div id="f-fig-results" class="mb-2"></div>
            <div id="f-fig-wizard">
              <div class="flex items-center justify-center py-6" style="color:var(--text-faint)">
                <svg class="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
                <span class="text-xs">Figür durumu yükleniyor…</span>
              </div>
            </div>
          </section>

          <!-- Ek Materyaller (Dosyalar + Linkler tek panelde) -->
          <section>
            <div class="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <h3 class="text-sm font-semibold" style="color:var(--text-strong)">Ek Materyaller (Supplementary Materials)</h3>
              <div class="flex gap-2 flex-shrink-0">
                <label class="btn btn-secondary btn-sm cursor-pointer">
                  Dosya Yükle <input id="f-supp-files" type="file" multiple class="hidden">
                </label>
                <button type="button" onclick="addSuppLinkRow()" class="btn btn-secondary btn-sm">+ URL Ekle</button>
              </div>
            </div>
            <div class="banner banner-info mb-2" style="padding:8px 10px;font-size:12px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <div class="banner-body" style="margin-top:0;line-height:1.5">
                Bu makaleye ait ek materyalleri (tablolar, veri setleri, ek PDF'ler vb.) buradan yönetin.
                <strong>Dosya Yükle</strong> ile sunucuya yükleyin veya <strong>+ URL Ekle</strong> ile harici bir bağlantı ekleyin.
                Her satırın yanındaki <strong>kopyala</strong> ikonuyla dosyanın paylaşılabilir tam URL'sini panoya alıp grafik ekibine iletebilirsiniz.
                Eklenen materyaller makalenin sitedeki "Supplementary Materials" bölümünde otomatik listelenir.
              </div>
            </div>
            <div id="f-supp-results" class="mb-2"></div>
            <div id="f-supp-links" class="space-y-2">
              ${(a.supplementary || []).map((sm) => suppLinkRow(sm)).join('')}
            </div>
            ${!(a.supplementary || []).length ? `<div id="f-supp-empty" class="text-xs text-center py-3" style="color:var(--text-faint)">Henüz ek materyal yok. Dosya yükleyin veya harici bir URL ekleyin.</div>` : ''}
          </section>
        </div>
      </div>` : ''}
    </div>`;

  // AIP tabs interaction (scoped — does not conflict with article tabs)
  const aipTabBtns = el.querySelectorAll('.aip-tab-btn');
  function setActiveTab(name) {
    aipTabBtns.forEach((btn) => {
      const active = btn.dataset.tab === name;
      btn.style.borderColor = active ? 'var(--brand)' : 'transparent';
      btn.style.color = active ? 'var(--brand)' : 'var(--text-muted)';
    });
    el.querySelectorAll('.aip-tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.tab !== name));
  }
  aipTabBtns.forEach((btn) => btn.addEventListener('click', () => setActiveTab(btn.dataset.tab)));
  // Fall back to 'general' if the requested tab doesn't exist on this form (e.g. 'media' is not
  // rendered for new AIPs)
  const tabExists = !!el.querySelector(`.aip-tab-btn[data-tab="${defaultTab}"]`);
  setActiveTab(tabExists ? defaultTab : 'general');

  API.get('/article-types').then((types) => {
    const dl = document.getElementById('aipf-type-list');
    if (dl) dl.innerHTML = types.map((t) => `<option value="${esc(t.name)}">`).join('');
  }).catch(() => {});

  if (!isNew) {
    // ── PDF upload (Files tab) ──
    const pdfInput = document.getElementById('f-pdf-file');
    if (pdfInput) {
      pdfInput.addEventListener('change', async () => {
        if (!pdfInput.files[0]) return;
        const file = pdfInput.files[0];
        const prog = renderUploadProgress('f-pdf-results', [file], 'PDF yükleniyor');
        try {
          const result = await API.uploadFileWithProgress('/media/upload/pdf', file, 'pdf', { articleId: String(a.id) }, prog.update);
          prog.complete(`<div class="banner banner-success" style="padding:10px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><div class="banner-body" style="margin-top:0">PDF yüklendi: <code>${esc(result.pdfUrl || '')}</code></div></div>`);
          toast('PDF yüklendi');
          await API.put(`/articles-in-press/${a.id}`, { pdfUrl: result.pdfUrl, localPdfUrl: result.pdfUrl });
          handleRoute();
        } catch (err) {
          prog.fail(err.message);
          toast(err.message, 'error');
        }
      });
    }

    // ── Figure batch upload (auto-apply after upload) ──
    const figInput = document.getElementById('f-fig-files');
    if (figInput) {
      figInput.addEventListener('change', async () => {
        if (!figInput.files.length) return;
        const figResults = document.getElementById('f-fig-results');
        const prog = renderUploadProgress(figResults, figInput.files, 'Figürler yükleniyor');
        try {
          const result = await API.uploadFilesWithProgress(`/media/upload/figures/${a.id}`, figInput.files, 'figures', {}, prog.update);
          prog.complete(`<div class="banner banner-success" style="padding:10px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><div><div class="banner-title">${result.uploaded.length} figür yüklendi</div><div class="banner-body">Otomatik eşleştirme deneniyor…</div></div></div>`);
          window._articleFigureUpload = result;
          await applyExistingFigures(a.id);
          loadArticleAssets(a.id, a);
        } catch (err) {
          prog.fail(err.message);
          toast(err.message, 'error');
        }
      });
    }

    // ── Per-placeholder single-file upload (called by wizard "Dosya seç" buttons) ──
    // Uses same global uploadFigureForPlaceholder function as Article Edit

    // ── Supplementary upload ──
    const suppInput = document.getElementById('f-supp-files');
    if (suppInput) {
      suppInput.addEventListener('change', async () => {
        if (!suppInput.files.length) return;
        const suppResults = document.getElementById('f-supp-results');
        const prog = renderUploadProgress(suppResults, suppInput.files, 'Ek materyaller yükleniyor');
        try {
          const result = await API.uploadFilesWithProgress(`/media/upload/supplementary/${a.id}`, suppInput.files, 'files', {}, prog.update);
          prog.complete(`<div class="banner banner-success" style="padding:10px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><div><div class="banner-title">${result.uploaded.length} dosya yüklendi${(result.added || []).length ? ' ve ek materyal listesine eklendi' : ''}</div><div class="banner-body">${result.uploaded.map((f) => `<code>${esc(f.url)}</code>`).join('<br>')}</div></div></div>`);
          appendSuppRows(result.added);
          loadArticleAssets(a.id, a);
        } catch (err) {
          prog.fail(err.message);
          toast(err.message, 'error');
        }
      });
    }

    // Load asset summary + full text + figure wizard
    loadArticleAssets(a.id, a);
    loadAipFullTextIntoEditor(a.id);
  }

  // Full-text: read from local .html file into AIP editor (works for new & existing)
  const ftFileInput = document.getElementById('aipf-fulltext-file');
  if (ftFileInput) {
    ftFileInput.addEventListener('change', async () => {
      const f = ftFileInput.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const cleaned = sanitizeUploadedHtml(text);
        setHtmlEditorMode('aip-ft', 'visual');
        setHtmlEditorContent('aip-ft', cleaned);
        markDirty();
        const status = document.getElementById('aipf-fulltext-status');
        if (status) status.textContent = `"${f.name}" yüklendi (${cleaned.length.toLocaleString('tr-TR')} karakter). Kaydetmeyi unutmayın.`;
        toast(isNew
          ? 'Tam metin okundu. Sayfa üstündeki "Kaydet" butonuna basın.'
          : 'Tam metin dosyadan okundu. Lütfen "Tam Metni Kaydet" butonuna basın.');
      } catch (err) { toast(`Dosya okunamadı: ${err.message}`, 'error'); }
    });
  }

  // ── Word'den İçe Aktar (Galenos şablonu) ──
  // Only rendered on new AIPs. Uploads the .docx to /api/articles-in-press/
  // parse-docx and pre-fills General/Authors/Abstract fields AND the Tam Metin
  // editor (section headings, paragraphs with sup/bold/italic, reference list).
  // Dosyalar (figür/tablo) sekmesi kapsam dışı — gömülü görsel ayrı yüklenir.
  const importInput = document.getElementById('aipf-import-docx');
  if (importInput) {
    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      // Manual entries on the form take precedence: warn before clobbering.
      const hasManualData = ['aipf-type', 'aipf-doi', 'aipf-title'].some((id) => {
        const v = document.getElementById(id)?.value || '';
        return v.trim().length > 0;
      });
      if (hasManualData) {
        const ok = await confirmAction('Form alanları dolu. Word\'den İçe Aktar mevcut verilerin üzerine yazacak. Devam edilsin mi?');
        if (!ok) { importInput.value = ''; return; }
      }
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/articles-in-press/parse-docx', { method: 'POST', body: fd });
        const meta = await res.json();
        if (!res.ok) throw new Error(meta.error || 'Word dosyası ayrıştırılamadı');
        _applyAipDocxMetadata(meta);
        const warn = (meta.warnings || []).filter(Boolean);
        const ftNote = meta.fullTextHtml ? ' Tam Metin sekmesi dolduruldu.' : '';
        toast(warn.length
          ? `Word içe aktarıldı.${ftNote} ${warn.length} uyarı: ${warn.join('; ')}`
          : `Word dosyası başarıyla içe aktarıldı.${ftNote}`, warn.length ? 'warning' : 'success');
        // Heading levels are an automated first pass — nudge the editor to verify.
        if (meta.headingCheckReminder) {
          toast('Başlık seviyeleri otomatik belirlendi (H3 ana / H4 alt bölüm). Tam Metin sekmesinde "Başlıklar" aracıyla kontrol edin.', 'warning');
        }
        markDirty();
      } catch (err) {
        toast(`İçe aktarma hatası: ${err.message}`, 'error');
      } finally {
        importInput.value = ''; // allow re-selecting the same file
      }
    });
  }

  clearDirty();
  el.addEventListener('input', markDirty);
}

// Replace AIP form values with metadata extracted from a Word submission.
// Re-renders the Yazarlar lists from scratch (using the same helpers the
// initial form render uses) so the Kurumlar editor stays in sync.
function _applyAipDocxMetadata(meta) {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : String(v); };
  setVal('aipf-type', meta.type);
  setVal('aipf-doi', meta.doi);
  setVal('aipf-title', meta.title);
  setVal('aipf-received', dateInputValue(meta.received));
  setVal('aipf-accepted', dateInputValue(meta.accepted));
  setVal('aipf-published-online', dateInputValue(meta.publishedOnline));
  setVal('aipf-published', dateInputValue(meta.published));
  // Keywords are intentionally NOT imported (no keyword feature) — the field is
  // left untouched.

  // Authors + Kurumlar: rebuild both lists from the parsed authors.
  const affList = document.getElementById('aipf-affiliations-list');
  const authorsList = document.getElementById('aipf-authors');
  if (affList && authorsList) {
    const { affiliations, authorIdx } = buildAffiliationsFromAuthors(meta.authors || []);
    affList.innerHTML = affiliations.map((t, i) => aipfAffRow(t, i + 1)).join('');
    authorsList.innerHTML = (meta.authors || []).map((au, i) => aipAuthorRow(Object.assign({}, au, { _affIdx: authorIdx[i] }))).join('');
  }

  // Abstract — feed plain paragraphs into the WYSIWYG editor as <p>...</p>.
  const abstractHtml = String(meta.abstract || '')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
  if (abstractHtml) setHtmlEditorContent('aip-abs', abstractHtml);

  // Tam Metin — load the extracted body HTML into the full-text editor, then run
  // the same cross-linking pass used when opening an existing article so the
  // <sup>N</sup> markers become #ref-N citations with bidirectional backlinks.
  if (meta.fullTextHtml) {
    setHtmlEditorContent('aip-ft', meta.fullTextHtml);
    const ftVisual = document.getElementById('aip-ft-visual');
    if (ftVisual && typeof _autoLinkInEditor === 'function') {
      try { _autoLinkInEditor(ftVisual); } catch (_) { /* non-fatal */ }
    }
    const ftStatus = document.getElementById('aipf-fulltext-status');
    if (ftStatus) {
      ftStatus.textContent = meta.headingCheckReminder
        ? 'Tam metin içe aktarıldı. Başlık seviyeleri (H3 ana bölüm / H4 alt bölüm) otomatik belirlendi — araç çubuğundaki "Başlıklar" ile kontrol edip "Tam Metni Kaydet" ile kaydedin.'
        : 'Tam metin Word\'den içe aktarıldı — gözden geçirip "Tam Metni Kaydet" ile kaydedin.';
    }
  }
}

// Remove placed figure/table blocks whose backing image file no longer exists
// on disk — orphans left behind when a figure was deleted from Dosyalar before
// the server learned to strip the block (older data), or via any path that
// didn't reach the editor. Only touches <img> living under THIS article's image
// dir whose basename is absent from a freshly-fetched asset list, so external
// images and live figures are never removed. Marks dirty (not auto-saved) so
// the user persists the cleanup with the normal "Tam Metni Kaydet". Returns the
// number of orphan blocks removed.
async function _pruneOrphanArticleMedia(visual, articleId) {
  if (!visual || !articleId) return 0;
  let known;
  try {
    const data = await API.get(`/media/article/${articleId}/assets`);
    known = new Set((data.figures || []).map((f) => String(f.filename || '').toLowerCase()));
  } catch (_) {
    return 0; // couldn't verify what's on disk → never remove anything
  }
  const marker = (`images/articles/${articleId}/`).toLowerCase();
  let removed = 0;
  visual.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (src.toLowerCase().indexOf(marker) === -1) return; // not this article's figure dir
    const base = src.split('/').pop().toLowerCase();
    if (!base || known.has(base)) return; // file still exists → keep
    const block = img.closest('figure, .article-figure, .article-table-wrap, [id^="figure-"], [id^="table-"], [id^="fig-"], [id^="tab-"]');
    if (block) { img.remove(); if (!block.querySelector('img')) block.remove(); }
    else img.remove();
    removed += 1;
  });
  if (removed && typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(visual);
  return removed;
}

// Load existing full-text HTML into the AIP editor (prefix 'aip-ft')
async function loadAipFullTextIntoEditor(articleId) {
  const visual = document.getElementById('aip-ft-visual');
  const status = document.getElementById('aipf-fulltext-status');
  const loadToken = _aipFullTextLoadToken;
  if (!visual) return;
  try {
    const data = await API.get(`/articles-in-press/${articleId}/fulltext`);
    const activeId = window.location.hash.match(/^#\/articles-in-press\/(\d+)\/edit/)?.[1];
    if (
      loadToken !== _aipFullTextLoadToken ||
      String(activeId || '') !== String(articleId) ||
      visual !== document.getElementById('aip-ft-visual')
    ) return;
    setHtmlEditorContent('aip-ft', data.html || '');
    // Normalise Word-export references and stamp media IDs RIGHT after the
    // content lands in the editor — otherwise the user has to open the
    // Atıf picker before the bubble's lazy normalisation runs, and the
    // references look like clipped MsoListParagraph junk in the meantime.
    // We suppress dirty marking during this phase because the user hasn't
    // edited anything yet; only their own edits should produce "unsaved
    // changes" prompts.
    if (data.html) {
      _suppressDirty = true;
      try {
        _normalizeMsoReferenceList(visual);
        _promoteMsoHeadings(visual);
        _ensureMediaIds(visual);
        _normalizeMediaCaptions(visual);
        _autoLinkInEditor(visual);
        _initMediaBlockControls();
        _initToolbarStateSync();
      } finally {
        _suppressDirty = false;
      }
    }
    let prunedNote = '';
    if (data.html) {
      const pruned = await _pruneOrphanArticleMedia(visual, articleId);
      if (pruned) { markDirty(); prunedNote = ` — ${pruned} kullanılmayan (silinmiş) figür kaldırıldı, kaydedin`; }
    }
    if (status) {
      status.textContent = data.html
        ? `Yüklü tam metin uzunluğu: ${data.html.length.toLocaleString('tr-TR')} karakter.${prunedNote}`
        : 'Tam metin henüz mevcut değil.';
    }
    _setupFtAutosave('aip-ft', articleId);
    await _maybeOfferDraftRecovery('aip-ft', articleId, data.html || '');
  } catch (err) {
    if (status) status.textContent = `Tam metin okunamadı: ${err.message}`;
  }
}

// Manual save for AIP full text. The dedicated endpoint validates AIP
// membership and updates only that record's hasFullText state.
async function saveAipFullText(articleId) {
  const visual = document.getElementById('aip-ft-visual');
  const status = document.getElementById('aipf-fulltext-status');
  if (!visual) return;
  const html = getHtmlEditorContent('aip-ft');
  if (!html.trim()) {
    if (!await confirmAction('Tam metin boş. Yine de kaydetmek istiyor musunuz?')) return;
  }
  try {
    await API.put(`/articles-in-press/${articleId}/fulltext`, { html });
    clearDirty();
    _clearFtDraft('aip-ft', articleId);
    if (status) status.textContent = `Kaydedildi (${html.length.toLocaleString('tr-TR')} karakter).`;
    toast('Tam metin kaydedildi');
  } catch (err) {
    if (status) status.textContent = `Kaydetme hatası: ${err.message}`;
    toast(err.message, 'error');
  }
}

// Toggle the corresponding-author email field on/off when its checkbox flips.
// Shared by both the published-article and AIP author rows. Each author can be
// flagged independently, so more than one corresponding author is supported.
function _toggleCorrEmail(cb) {
  const wrap = cb.closest('.corr-wrap');
  if (wrap) {
    const email = wrap.querySelector('.js-corr-email');
    if (email) {
      email.style.display = cb.checked ? '' : 'none';
      if (cb.checked) { try { email.focus(); } catch (_) {} }
    }
  }
  markDirty();
}

function aipAuthorRow(au = {}) {
  const isCorr = !!(au.corresponding || au.isCorresponding || au.correspondence);
  const email = au.email || au.mail || '';
  return `<div class="aipf-author-row flex gap-2 items-start p-2 bg-gray-50 rounded-lg" ondragend="this.removeAttribute('draggable')">
    <span class="row-grip" title="Sıralamak için tutup sürükleyin" aria-label="Sürükle" onmousedown="this.closest('.aipf-author-row').setAttribute('draggable','true')">${ROW_GRIP_SVG}</span>
    <div class="flex-1 space-y-2">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input class="aipf-au-name md:col-span-2 px-2 py-1.5 border rounded text-sm" placeholder="Ad Soyad" value="${esc(au.name || '')}" oninput="markDirty()">
        <input class="aipf-au-aff-idx px-2 py-1.5 border rounded text-sm" placeholder="Kurum no (1 veya 1,2)" value="${esc(au._affIdx || '')}" oninput="markDirty()">
        <input class="aipf-au-orcid md:col-span-2 px-2 py-1.5 border rounded text-sm" placeholder="ORCID" value="${esc(au.orcid || '')}" oninput="markDirty()">
      </div>
      <div class="corr-wrap flex items-center gap-2 flex-wrap">
        <label class="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none" title="Birden fazla sorumlu yazar seçilebilir">
          <input type="checkbox" class="aipf-au-corr" ${isCorr ? 'checked' : ''} onchange="_toggleCorrEmail(this)">
          Sorumlu yazar ise tıklayınız
        </label>
        <input class="aipf-au-email js-corr-email flex-1 px-2 py-1.5 border rounded text-sm" type="email" placeholder="Sorumlu yazar e-posta adresi" value="${esc(email)}" style="min-width:200px;${isCorr ? '' : 'display:none'}" oninput="markDirty()">
      </div>
    </div>
    <button type="button" onclick="this.closest('.aipf-author-row').remove(); markDirty();" class="text-red-400 hover:text-red-600 text-lg px-1">&times;</button>
  </div>`;
}

function addAipAuthor() {
  const list = document.getElementById('aipf-authors');
  if (!list) return;
  list.insertAdjacentHTML('beforeend', aipAuthorRow());
  markDirty();
}

async function saveAip(isNew) {
  const getVal = (id) => document.getElementById(id)?.value?.trim() || '';
  const affList = _collectAffList(document.getElementById('aipf-affiliations-list'), '.aipf-aff-text');
  const authors = [];
  document.querySelectorAll('.aipf-author-row').forEach((row) => {
    const name = row.querySelector('.aipf-au-name').value.trim();
    const affIdx = row.querySelector('.aipf-au-aff-idx').value.trim();
    const orcid = row.querySelector('.aipf-au-orcid').value.trim();
    const corresponding = !!row.querySelector('.aipf-au-corr')?.checked;
    const email = corresponding ? (row.querySelector('.aipf-au-email')?.value.trim() || '') : '';
    const affiliation = joinAffiliationsByIdx(affIdx, affList);
    if (!name && !affiliation && !orcid) return;
    const author = { name, affiliation, orcid };
    // Only persist the corresponding flag / email when set, so non-corresponding
    // authors stay clean and the public site (which reads a.corresponding /
    // a.email and supports multiple) renders the * + mailto only where intended.
    if (corresponding) author.corresponding = true;
    if (email) author.email = email;
    authors.push(author);
  });

  const abstractHtml = getHtmlEditorContent('aip-abs');
  const abstract = abstractHtml.replace(/<[^>]+>/g, '').trim();

  // Collect supplementary URL entries from the Files tab (same as Article Edit).
  // Preserve each row's existing id (carried via data-supp-id) so in-text anchors
  // (#supp2, etc.) keep pointing at the right file when a middle row gets deleted.
  const supplementary = [];
  const _suppUsedIds = new Set();
  document.querySelectorAll('.supp-link-row').forEach((row) => {
    const existing = (row.getAttribute('data-supp-id') || '').trim();
    if (existing) _suppUsedIds.add(existing);
  });
  let _suppCounter = 0;
  const _suppNextId = () => {
    while (true) {
      _suppCounter += 1;
      const candidate = `supp${_suppCounter}`;
      if (!_suppUsedIds.has(candidate)) {
        _suppUsedIds.add(candidate);
        return candidate;
      }
    }
  };
  document.querySelectorAll('.supp-link-row').forEach((row) => {
    const label = row.querySelector('.sl-label').value.trim();
    const href = row.querySelector('.sl-href').value.trim();
    const caption = row.querySelector('.sl-caption').value.trim();
    if (!label && !href) return;
    const existing = (row.getAttribute('data-supp-id') || '').trim();
    const id = existing || _suppNextId();
    if (!existing) row.setAttribute('data-supp-id', id);
    supplementary.push({ id, label, href, caption, mimeType: '' });
  });

  const data = {
    type: getVal('aipf-type'),
    title: getVal('aipf-title'),
    doi: getVal('aipf-doi'),
    received: getVal('aipf-received'),
    accepted: getVal('aipf-accepted'),
    publishedOnline: getVal('aipf-published-online'),
    published: getVal('aipf-published'),
    pmid: getVal('aipf-pmid'),
    abstractHtml,
    abstract,
    previewText: abstract.slice(0, 360),
    keywords: getVal('aipf-keywords').split(',').map((k) => k.trim()).filter(Boolean),
    authors,
    supplementary,
  };

  // Honour the user's "Tam metin görünür" toggle. Without this, the checkbox
  // would only affect the inline indicator and reset to whatever the server
  // last knew on the next save. The toggle is absent in the "new article"
  // form (there's nothing to toggle yet), so we only read it when present.
  const ftToggle = document.getElementById('aipf-has-fulltext');
  if (ftToggle) data.hasFullText = ftToggle.checked;

  if (!data.title) { toast('Başlık zorunludur', 'error'); return; }
  if (!data.type) { toast('Makale türü zorunludur', 'error'); return; }
  const dateError = articleDateSequenceError(data);
  if (dateError) { toast(dateError, 'error'); return; }
  // Authors aren't strictly required by the data model, but an article with
  // zero authors is almost always an oversight — warn before silently saving
  // a record that will display "by (no authors)" on the public page.
  if (!authors.length) {
    if (!await confirmAction('Bu makalede hiç yazar yok. Yine de kaydetmek istiyor musunuz?')) return;
  }

  try {
    if (isNew) {
      const result = await API.post('/articles-in-press', data);
      // Persist full text under the new AIP id if entered
      const ftHtml = document.getElementById('aip-ft-visual') ? getHtmlEditorContent('aip-ft') : '';
      if (result?.id && ftHtml) {
        try {
          await API.put(`/articles-in-press/${result.id}/fulltext`, { html: ftHtml });
        } catch (ftErr) {
          toast(`Makale oluşturuldu ama tam metin kaydedilemedi: ${ftErr.message}`, 'error');
        }
      }
      clearDirty();
      toast('Baskıda makale oluşturuldu');
      navigate(`#/articles-in-press/${result.id}/edit`);
    } else {
      const id = window.location.hash.match(/#\/articles-in-press\/(\d+)\/edit/)?.[1];
      await API.put(`/articles-in-press/${id}`, data);
      // Also persist full text via shared endpoint — but ONLY if the editor
      // actually has content. Skipping when empty prevents the race condition
      // where loadAipFullTextIntoEditor() hasn't resolved yet by the time the
      // user clicks Kaydet on the Genel/Yazarlar tab, which would otherwise
      // overwrite the stored HTML with an empty string.
      if (document.getElementById('aip-ft-visual') && id) {
        const ftHtml = getHtmlEditorContent('aip-ft');
        if (ftHtml.trim()) {
          try {
            await API.put(`/articles-in-press/${id}/fulltext`, { html: ftHtml });
            const status = document.getElementById('aipf-fulltext-status');
            if (status) status.textContent = `Kaydedildi (${ftHtml.length.toLocaleString('tr-TR')} karakter).`;
          } catch (ftErr) {
            toast(`Genel veriler kaydedildi ama tam metin kaydedilemedi: ${ftErr.message}`, 'error');
          }
        }
      }
      clearDirty();
      toast('Baskıda makale güncellendi');
    }
  } catch (err) { toast(err.message, 'error'); }
}

// News
const NEWS_PLACEHOLDER_IMAGE = 'images/placeholder-news.jpg';

route('/news', async (el) => {
  const news = await API.get('/news');
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Haberler <span class="text-gray-400 text-lg font-normal">(${news.length})</span></h1>
      <a href="#/news/new" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Yeni Haber</a>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>ID</th>
          <th>Başlık</th>
          <th>Kategori</th>
          <th>Öne Çıkan</th>
          <th class="px-4 py-3"></th>
        </tr></thead>
        <tbody>${news.map((n) => `
          <tr class="cursor-pointer" onclick="navigate('#/news/${n.id}')">
            <td class="px-4 py-3 text-gray-400">${n.id}</td>
            <td class="px-4 py-3 max-w-md truncate">${esc(n.title)}</td>
            <td class="px-4 py-3">${n.category ? `<span class="badge ${badgeColorFor(n.category)}">${esc(n.category)}</span>` : '<span class="text-xs" style="color:var(--text-faint)">—</span>'}</td>
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
  // Default new news to today's date so it ends up at the top of homepage/news list
  // (renderNews falls back to id-desc only when date is missing — but real dates
  // sort properly across items, so we set a sensible default).
  const todayIso = new Date().toISOString().slice(0, 10);
  const n = item || { title: '', excerpt: '', content: '', category: 'News', image: '', date: todayIso, featured: false };

  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${isNew ? 'Yeni Haber' : `Haber #${n.id}`}</h1>
      <div class="flex gap-2">
        <a href="#/news" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm">Geri</a>
        ${!isNew ? `<a href="/site/news-article.html?id=${n.id}" target="_blank" rel="noopener" class="px-4 py-2 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 text-sm font-medium">Önizle</a>` : ''}
        <button onclick="saveNews(${isNew ? 'null' : n.id})" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Kaydet<span data-dirty-indicator class="text-amber-200"></span></button>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Main form -->
      <div class="lg:col-span-2 space-y-4">
        <div class="card space-y-4" style="padding:24px">
          <div><label class="label">Başlık</label><input id="fn-title" value="${esc(n.title)}" class="input"></div>
          <div><label class="label">Özet</label><textarea id="fn-excerpt" rows="3" class="input">${esc(n.excerpt)}</textarea></div>
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-gray-700">İçerik</label>
              <div id="fn-content-modeswitch" class="inline-flex items-center bg-gray-100 rounded-lg p-0.5 text-xs font-medium select-none" role="tablist" aria-label="Düzenleme modu">
                <button type="button" data-mode="visual" onclick="setNewsEditorMode('visual')" role="tab" aria-selected="true"
                  class="mode-btn mode-visual px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all bg-white shadow-sm text-teal-700">
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h10M4 18h16"/></svg>
                  <span>Görsel</span>
                </button>
                <button type="button" data-mode="source" onclick="setNewsEditorMode('source')" role="tab" aria-selected="false"
                  class="mode-btn mode-source px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all text-gray-500 hover:text-gray-800">
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l-4-4 4-4M14 4l4 4-4 4"/></svg>
                  <span>HTML</span>
                </button>
              </div>
            </div>
            <!-- Toolbar -->
            <div id="fn-content-toolbar" class="flex flex-wrap gap-0.5 border border-b-0 rounded-t-lg bg-gray-50 px-2 py-1.5">
              <button type="button" onclick="newsEditorCmd('bold')" title="Kalın" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></svg></button>
              <button type="button" onclick="newsEditorCmd('italic')" title="İtalik" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 4h4m-2 0l-4 16m0 0h4"/></svg></button>
              <button type="button" onclick="newsEditorCmd('underline')" title="Altı Çizili" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 3v7a6 6 0 0012 0V3M3.5 21h17"/></svg></button>
              <div class="w-px bg-gray-300 mx-1"></div>
              <button type="button" onclick="newsEditorCmd('formatBlock','<h2>')" title="Başlık 2" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-bold">H2</button>
              <button type="button" onclick="newsEditorCmd('formatBlock','<h3>')" title="Başlık 3" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-bold">H3</button>
              <button type="button" onclick="newsEditorCmd('formatBlock','<p>')" title="Paragraf" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-bold">P</button>
              <div class="w-px bg-gray-300 mx-1"></div>
              <button type="button" onclick="newsEditorCmd('insertUnorderedList')" title="Madde Listesi" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button>
              <button type="button" onclick="newsEditorCmd('insertOrderedList')" title="Numaralı Liste" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 6h11M10 12h11M10 18h11"/><text x="3" y="8" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="3" y="14" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="3" y="20" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg></button>
              <div class="w-px bg-gray-300 mx-1"></div>
              <button type="button" onclick="newsEditorLink()" title="Link Ekle" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg></button>
              <button type="button" onclick="newsEditorCmd('removeFormat')" title="Formatı Temizle" class="p-1.5 rounded hover:bg-gray-200 text-gray-600"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17 10L3 3m0 0l7 14 2-5 5-2M3 3l18 18"/></svg></button>
            </div>
            <!-- Visual editor -->
            <div id="fn-content-visual" contenteditable="true" class="w-full px-4 py-3 border rounded-b-lg text-sm min-h-[240px] focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 prose prose-sm max-w-none overflow-auto bg-white">${n.content}</div>
            <!-- HTML source (hidden by default) -->
            <textarea id="fn-content-source" rows="12" class="w-full px-3 py-2 border rounded-b-lg text-sm font-mono hidden">${esc(n.content)}</textarea>
          </div>
        </div>
      </div>

      <!-- Sidebar: image + meta -->
      <div class="space-y-4">
        <!-- Image -->
        <div class="card card-padded">
          <label class="block text-sm font-medium text-gray-700 mb-2">Görsel</label>
          <div id="fn-image-preview" class="mb-3 rounded-lg overflow-hidden bg-gray-100">
            <img id="fn-image-preview-img" src="../${esc(n.image || NEWS_PLACEHOLDER_IMAGE)}" alt="" class="w-full h-40 object-cover" onerror="this.onerror=null;this.src='../${NEWS_PLACEHOLDER_IMAGE}'">
          </div>
          <div class="flex items-center gap-2">
            <input id="fn-image" value="${esc(n.image || '')}" placeholder="images/..." class="flex-1 px-3 py-2 border rounded-lg text-sm" oninput="updateNewsImagePreview()">
            <label class="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm cursor-pointer whitespace-nowrap">
              Yükle <input id="fn-image-file" type="file" accept="image/*" class="hidden">
            </label>
          </div>
          <button id="fn-image-remove" onclick="document.getElementById('fn-image').value=''; updateNewsImagePreview(); markDirty();" class="mt-2 text-xs text-red-500 hover:text-red-700 ${n.image ? '' : 'hidden'}">Görseli Kaldır</button>
        </div>

        <!-- Meta -->
        <div class="card card-padded space-y-4">
          <div><label class="label">Kategori</label><input id="fn-category" value="${esc(n.category)}" class="input"></div>
          <div><label class="label">Tarih</label><input id="fn-date" type="date" value="${n.date}" class="input"></div>
          <div><label class="flex items-center gap-2 text-sm"><input id="fn-featured" type="checkbox" ${n.featured ? 'checked' : ''} class="rounded"> Öne Çıkan</label></div>
        </div>
      </div>
    </div>`;

  // Reset editor mode
  _newsEditorMode = 'visual';

  // Image file upload handler
  const fileInput = document.getElementById('fn-image-file');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const result = await API.uploadFile('/media/upload/image', file, 'image');
        document.getElementById('fn-image').value = result.url;
        updateNewsImagePreview();
        markDirty();
        toast('Görsel yüklendi');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // Track unsaved changes
  clearDirty();
  el.addEventListener('input', markDirty);
}

// Clean a raw HTML file/clipboard payload before it is fed into a WYSIWYG editor.
// Handles three common shapes:
//   1) Full document <!DOCTYPE><html>…<body>X</body></html> → keep only X
//   2) Escaped HTML (&lt;p&gt;Lorem&lt;/p&gt;) → decoded to real tags
//   3) <script>/<style>/<link>/<meta>/<base> tags or onXxx attributes → stripped
function sanitizeUploadedHtml(raw) {
  if (!raw) return '';
  let s = String(raw).trim();

  // (2) If the text is entity-escaped HTML (looks like &lt;tag&gt; with no real angle brackets),
  // decode it once via a textarea.
  const hasRealTags = /<[a-z!\/][\s\S]*?>/i.test(s);
  const hasEntities = /&(lt|gt|amp|quot|#x?\d+);/i.test(s);
  if (!hasRealTags && hasEntities) {
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    s = ta.value;
  }

  // (1) If a full document, extract just <body>…</body> content.
  const bodyMatch = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) s = bodyMatch[1];
  // Also strip leading DOCTYPE/html/head leftovers if there's no <body>.
  s = s.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  s = s.replace(/<\/?(html|head|body|meta|link|base|title)[^>]*>/gi, '');

  // (3) Strip dangerous tags
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // Strip on* event handlers and javascript: URLs from any tag
  s = s.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"');
  s = s.replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");

  return s.trim();
}

// ── Generic WYSIWYG HTML editor helpers ──
// Renders an HTML editor with: toolbar + contenteditable visual + hidden textarea source + toggle button.
// IDs: {prefix}-toolbar, {prefix}-visual, {prefix}-source, {prefix}-toggle
// Modes are tracked per-prefix so multiple editors can coexist.
const _htmlEditorModes = {};

function htmlEditorToolbar(prefix, variant = 'full') {
  const cmd = (c, v, label, title, body) =>
    `<button type="button" data-cmd="${c}" data-val="${v ? esc(v) : ''}" onclick="htmlEditorCmd('${prefix}','${c}'${v ? `,'${v.replace(/'/g, "\\'")}'` : ''})" title="${title}" class="${label ? 'px-2 py-1' : 'p-1.5'} rounded hover:bg-gray-200 text-gray-600 ${label ? 'text-xs font-bold' : ''}">${body}</button>`;
  const sep = '<div class="w-px bg-gray-300 mx-1"></div>';
  const boldIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></svg>';
  const italicIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 4h4m-2 0l-4 16m0 0h4"/></svg>';
  const underlineIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 3v7a6 6 0 0012 0V3M3.5 21h17"/></svg>';
  const ulIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';
  const olIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 6h11M10 12h11M10 18h11M4 4v4h2v1H3v1h3v1H4v1h3M4 14h3v1H5v1h2v1H4M5 19h2"/></svg>';
  const linkIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
  const clearIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17 10L3 3m0 0l7 14 2-5 5-2M3 3l18 18"/></svg>';
  const undoIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/></svg>';
  const redoIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"/></svg>';
  const headingIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 5v14M18 5v14M6 12h12"/></svg>';

  // ── Simplified, fully-labelled toolbar for non-technical editors (Sayfalar) ──
  // Icon + Turkish word on every button; only the essentials; no underline,
  // no H4, no ordered list. Raw HTML is reachable via the separate "Gelişmiş
  // (HTML)" toggle rendered by htmlEditor(), not from this toolbar.
  if (variant === 'simple') {
    const dis = 'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
    const lbl = 'px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5';
    const sBtn = (onclick, title, icon, label, extra = '') =>
      `<button type="button" onclick="${onclick}" title="${title}" class="${lbl} ${extra}">${icon}<span>${label}</span></button>`;
    const simpleParts = [
      `<button type="button" id="${prefix}-undo" onclick="htmlEditorUndo('${prefix}')" title="Geri Al (Ctrl+Z)" class="${lbl} ${dis}" disabled>${undoIcon}<span>Geri Al</span></button>`,
      `<button type="button" id="${prefix}-redo" onclick="htmlEditorRedo('${prefix}')" title="İleri Al (Ctrl+Shift+Z)" class="${lbl} ${dis}" disabled>${redoIcon}<span>İleri Al</span></button>`,
      sep,
      sBtn(`htmlEditorCmd('${prefix}','bold')`, 'Kalın (Ctrl+B)', boldIcon, 'Kalın'),
      sBtn(`htmlEditorCmd('${prefix}','italic')`, 'İtalik (Ctrl+I)', italicIcon, 'İtalik'),
      sep,
      sBtn(`htmlEditorHeadingToggle('${prefix}')`, 'Seçili satırı başlık yap / başlığı kaldır', headingIcon, 'Başlık'),
      sBtn(`htmlEditorCmd('${prefix}','insertUnorderedList')`, 'Madde işaretli liste', ulIcon, 'Liste'),
      sBtn(`htmlEditorLink('${prefix}')`, 'Bağlantı (link) ekle', linkIcon, 'Bağlantı'),
      sep,
      sBtn(`htmlEditorInsertImage('${prefix}')`, 'Resim ekle (bilgisayardan yükle veya URL)', _mediaImageIcon, 'Resim'),
      sBtn(`htmlEditorInsertVideo('${prefix}')`, 'Video ekle (bilgisayardan yükle veya URL)', _mediaVideoIcon, 'Video'),
      sBtn(`htmlEditorInsertYouTube('${prefix}')`, 'YouTube videosu ekle (bağlantı yapıştır)', _mediaYouTubeIcon, 'YouTube'),
      sep,
      sBtn(`htmlEditorCmd('${prefix}','removeFormat')`, 'Seçili metnin biçimini temizle', clearIcon, 'Biçimi Temizle'),
    ];
    return `<div id="${prefix}-toolbar" class="flex flex-wrap items-center gap-1 border border-b-0 rounded-t-lg bg-gray-50 px-2 py-1.5">${simpleParts.join('')}</div>`;
  }

  const btnCls = 'rounded hover:bg-gray-200 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
  const parts = [
    `<button type="button" id="${prefix}-undo" onclick="htmlEditorUndo('${prefix}')" title="Geri Al (Ctrl+Z)" class="px-2 py-1 ${btnCls} text-xs font-medium flex items-center gap-1.5" disabled>${undoIcon}<span>Geri Al</span></button>`,
    `<button type="button" id="${prefix}-redo" onclick="htmlEditorRedo('${prefix}')" title="İleri Al (Ctrl+Shift+Z)" class="p-1.5 ${btnCls}" disabled>${redoIcon}</button>`,
    sep,
    cmd('bold', null, false, 'Kalın (Ctrl+B)', boldIcon),
    cmd('italic', null, false, 'İtalik (Ctrl+I)', italicIcon),
    cmd('underline', null, false, 'Altı Çizili (Ctrl+U)', underlineIcon),
    sep,
  ];
  if (variant === 'full') {
    // This site styles .article-body h3 (main section) + h4 (subsection); h2 is
    // NOT styled (renders as body text on the public page), so the heading
    // buttons map to h3/h4 — the levels that actually render.
    parts.push(cmd('formatBlock', '<h3>', true, 'Ana başlık (bölüm)', 'H3'));
    parts.push(cmd('formatBlock', '<h4>', true, 'Alt başlık', 'H4'));
  }
  parts.push(cmd('formatBlock', '<p>', true, 'Paragraf', 'P'));
  parts.push(cmd('insertUnorderedList', null, false, 'Madde Listesi', ulIcon));
  if (variant === 'full') parts.push(cmd('insertOrderedList', null, false, 'Numaralı Liste', olIcon));
  parts.push(`<button type="button" onclick="htmlEditorLink('${prefix}')" title="Link Ekle" class="p-1.5 rounded hover:bg-gray-200 text-gray-600">${linkIcon}</button>`);

  // Article full-text editors get a one-click "Ek Materyal" picker so the
  // user can drop a link or embed for an uploaded supplementary file into
  // the prose without writing HTML by hand. Other editors (sections,
  // abstracts) don't need it.
  if (prefix === 'ft' || prefix === 'aip-ft') {
    const suppIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>';
    const tableIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14"/></svg>';
    const figIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21"/></svg>';
    parts.push(sep);
    parts.push(`<button type="button" onclick="htmlEditorInsertTable('${prefix}')" title="Tablo ekle (kod yazmadan satır/sütun seç)" class="px-2 py-1 rounded hover:bg-teal-50 text-teal-700 text-xs font-medium flex items-center gap-1.5">${tableIcon}<span>Tablo Ekle</span></button>`);
    parts.push(`<button type="button" onclick="openFigurePicker('${prefix}')" title="Yüklü figürlerden tam metne ekle" class="px-2 py-1 rounded hover:bg-teal-50 text-teal-700 text-xs font-medium flex items-center gap-1.5">${figIcon}<span>Figür</span></button>`);
    parts.push(`<button type="button" onclick="openSupplementaryPicker('${prefix}')" title="Ek materyal ekle (yüklü dosyalardan seç)" class="px-2 py-1 rounded hover:bg-teal-50 text-teal-700 text-xs font-medium flex items-center gap-1.5">${suppIcon}<span>Ek Materyal</span></button>`);
    const crIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path stroke-linecap="round" stroke-linejoin="round" d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
    parts.push(`<button type="button" onmousedown="event.preventDefault()" onclick="openCrossRefMenu('${prefix}')" title="Atıf/bağlantı ekle — figür, tablo veya kaynak ekle/bağla (metin seçince de açılır)" class="px-2 py-1 rounded hover:bg-teal-50 text-teal-700 text-xs font-medium flex items-center gap-1.5">${crIcon}<span>Atıf / Bağlantı</span></button>`);
    const autoIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>';
    parts.push(`<button type="button" onclick="_autoArrangeFullText('${prefix}')" title="Dosyalar bölümündeki figür/tabloları metin içine yerleştir, kaynak atıflarını otomatik bağla" class="px-2 py-1 rounded hover:bg-amber-50 text-amber-700 text-xs font-semibold flex items-center gap-1.5" style="border:1px solid color-mix(in oklab, #f59e0b 30%, transparent);background:color-mix(in oklab, #f59e0b 8%, transparent)">${autoIcon}<span>Otomatik Düzenle</span></button>`);
    parts.push(sep);
    const outlineIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h10M4 12h7M4 18h13"/><circle cx="19" cy="6" r="1.4"/><circle cx="16" cy="12" r="1.4"/></svg>';
    parts.push(`<button type="button" onclick="_toggleHeadingOutline('${prefix}')" title="Başlık taslağı: başlıkları izle, H3/H4 doğruluğunu kontrol et, tıkla→editörde vurgula, seviyeyi düzelt" class="px-2 py-1 rounded hover:bg-teal-50 text-teal-700 text-xs font-medium flex items-center gap-1.5">${outlineIcon}<span>Başlıklar</span></button>`);
    const mediaIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M3 9h18"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 4v16"/></svg>';
    parts.push(`<button type="button" onclick="_openMediaManager('${prefix}')" title="Tüm figür/tabloları tek ekranda yönet: etiket, başlık, durum" class="px-2 py-1 rounded hover:bg-teal-50 text-teal-700 text-xs font-medium flex items-center gap-1.5">${mediaIcon}<span>Medya</span></button>`);
    const checkIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>';
    parts.push(`<button type="button" onclick="_runPreflight('${prefix}')" title="Yayın öncesi kontrol: kırık atıf, yerleştirilmemiş/atıfsız figür, atıfsız kaynak, boş başlık" class="px-2 py-1 rounded hover:bg-teal-50 text-teal-700 text-xs font-medium flex items-center gap-1.5">${checkIcon}<span>Kontrol</span></button>`);
    const eyeIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    parts.push(`<button type="button" onclick="_openReaderPreview('${prefix}')" title="Okuyucu önizlemesi — yayındaki görünümü göster" class="px-2 py-1 rounded hover:bg-teal-50 text-teal-700 text-xs font-medium flex items-center gap-1.5">${eyeIcon}<span>Önizleme</span></button>`);
  }

  parts.push(sep);
  parts.push(cmd('removeFormat', null, false, 'Formatı Temizle', clearIcon));

  return `<div id="${prefix}-toolbar" class="flex flex-wrap gap-0.5 border border-b-0 rounded-t-lg bg-gray-50 px-2 py-1.5">${parts.join('')}</div>`;
}

function htmlEditorModeSwitch(prefix) {
  // Segmented control: Görsel | HTML  (active option has white bg + shadow + teal text)
  const visualIcon = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h10M4 18h16"/></svg>';
  const codeIcon = '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l-4-4 4-4M14 4l4 4-4 4"/></svg>';
  return `
    <div id="${prefix}-modeswitch" class="inline-flex items-center bg-gray-100 rounded-lg p-0.5 text-xs font-medium select-none" role="tablist" aria-label="Düzenleme modu">
      <button type="button" data-mode="visual" onclick="setHtmlEditorMode('${prefix}','visual')" role="tab" aria-selected="true"
        class="mode-btn mode-visual px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all bg-white shadow-sm text-teal-700">
        ${visualIcon}<span>Görsel</span>
      </button>
      <button type="button" data-mode="source" onclick="setHtmlEditorMode('${prefix}','source')" role="tab" aria-selected="false"
        class="mode-btn mode-source px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all text-gray-500 hover:text-gray-800">
        ${codeIcon}<span>HTML</span>
      </button>
    </div>`;
}

function htmlEditor({ prefix, initialHtml = '', rows = 12, placeholder = '', variant = 'full', minHeight = '160px', visualClass = '' }) {
  _htmlEditorModes[prefix] = 'visual';
  const safePlaceholder = (placeholder || '').replace(/"/g, '&quot;');
  // For the full-variant editor (Tam Metin), constrain the height so the
  // editor scrolls internally. The toolbar (rendered above this div) stays
  // visible in the same position regardless of how long the article is.
  // calc() leaves room for the page header, tabs, toolbar, and bottom margin.
  const visualMaxHeight = variant === 'full' ? 'max-height:calc(100vh - 320px);' : '';
  // Simple variant (Sayfalar): hide the Görsel|HTML segmented switch and offer a
  // single, subtle "Gelişmiş (HTML)" toggle instead — raw HTML stays reachable
  // but out of the way for non-technical editors.
  const modeControl = variant === 'simple'
    ? `<button type="button" id="${prefix}-advanced" onclick="htmlEditorToggleSource('${prefix}', this)" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Sayfanın HTML kodunu düzenle (ileri düzey — gerekmedikçe kullanmayın)">
         <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l-4-4 4-4M14 4l4 4-4 4"/></svg><span>Gelişmiş (HTML)</span>
       </button>`
    : htmlEditorModeSwitch(prefix);
  return `
    <div class="html-editor" data-html-editor="${prefix}">
      <div class="flex items-center justify-end mb-2">
        ${modeControl}
      </div>
      ${htmlEditorToolbar(prefix, variant)}
      <div id="${prefix}-visual" contenteditable="true" class="w-full px-4 py-3 border rounded-b-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 max-w-none overflow-y-auto bg-white ${visualClass}" style="min-height:${minHeight};${visualMaxHeight}" data-placeholder="${safePlaceholder}">${initialHtml || ''}</div>
      <textarea id="${prefix}-source" rows="${rows}" class="w-full px-3 py-2 border rounded-lg text-xs font-mono hidden" placeholder="${safePlaceholder}">${esc(initialHtml || '')}</textarea>
    </div>`;
}

function htmlEditorCmd(prefix, command, value) {
  const visual = document.getElementById(`${prefix}-visual`);
  if (!visual) return;
  visual.focus();
  document.execCommand(command, false, value || null);
  // formatBlock (H2/H3/P) on Word-pasted text leaves the original inline font
  // styling (font-size/weight/family/color, mso-*) baked onto the block and its
  // inner <span>/<b>, which OVERRIDES the semantic tag's CSS — so the heading
  // looks identical no matter which level you pick. Strip those conflicting
  // declarations from the blocks the selection just converted so H2/H3/P render
  // at their real level.
  if (command === 'formatBlock' && value) {
    try { _cleanFormattedBlocks(visual, value); } catch (_) { /* non-fatal */ }
  }
  _updateHtmlEditorToolbarState(visual);
  markDirty();
}

// The block-level tag the caret currently sits in (p/h3/li/…), or '' if none.
function _selectionBlockTag(root) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return '';
  let n = sel.getRangeAt(0).startContainer;
  if (n && n.nodeType === 3) n = n.parentNode;
  while (n && n !== root && n.nodeType === 1) {
    if (/^(P|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE)$/.test(n.tagName)) return n.tagName.toLowerCase();
    n = n.parentNode;
  }
  return '';
}

// Simple-toolbar "Başlık" button: toggle the caret's line between a heading
// (h3 — the level the public pages actually style) and a normal paragraph, so
// a non-technical editor turns headings on/off without picking a level.
function htmlEditorHeadingToggle(prefix) {
  const visual = document.getElementById(`${prefix}-visual`);
  if (!visual) return;
  visual.focus();
  const tag = _selectionBlockTag(visual) === 'h3' ? '<p>' : '<h3>';
  document.execCommand('formatBlock', false, tag);
  try { _cleanFormattedBlocks(visual, tag); } catch (_) { /* non-fatal */ }
  _updateHtmlEditorToolbarState(visual);
  markDirty();
}

// "Gelişmiş (HTML)" toggle for the simple-variant editor: flip between the
// visual editor and the raw-HTML source, relabelling the button. The button
// lives OUTSIDE the toolbar (htmlEditor renders it), so it stays reachable even
// while the formatting toolbar is hidden in source mode.
function htmlEditorToggleSource(prefix, btn) {
  const cur = _htmlEditorModes[prefix] || 'visual';
  const next = cur === 'visual' ? 'source' : 'visual';
  setHtmlEditorMode(prefix, next);
  const span = btn && btn.querySelector('span');
  if (span) span.textContent = next === 'source' ? 'Görsel düzenleyiciye dön' : 'Gelişmiş (HTML)';
}

// Reflect the current selection's formatting in the toolbar: highlight B/I/U
// when the selection is bold/italic/underlined, and highlight the H3/H4/P button
// matching the block the caret sits in — so the editor sees the active style.
function _updateHtmlEditorToolbarState(visual) {
  if (!visual) return;
  const prefix = (visual.id || '').replace(/-visual$/, '');
  const toolbar = document.getElementById(prefix + '-toolbar');
  if (!toolbar) return;
  const inline = {};
  ['bold', 'italic', 'underline'].forEach((c) => { try { inline[c] = document.queryCommandState(c); } catch (_) { inline[c] = false; } });
  // Block tag the caret/selection is inside.
  let blockTag = '';
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    let n = sel.getRangeAt(0).startContainer;
    if (n && n.nodeType === 3) n = n.parentNode;
    while (n && n !== visual && n.nodeType === 1) {
      if (/^(P|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE)$/.test(n.tagName)) { blockTag = n.tagName.toLowerCase(); break; }
      n = n.parentNode;
    }
  }
  toolbar.querySelectorAll('button[data-cmd]').forEach((b) => {
    const c = b.dataset.cmd;
    let active = false;
    if (c === 'bold' || c === 'italic' || c === 'underline') active = !!inline[c];
    else if (c === 'formatBlock') active = (b.dataset.val || '').replace(/[<>]/g, '').toLowerCase() === blockTag;
    b.classList.toggle('is-active', active);
  });
}

// Bind once: keep every full-text/abstract editor's toolbar in sync with the
// current selection's formatting.
let _toolbarStateBound = false;
function _initToolbarStateSync() {
  if (_toolbarStateBound) return;
  _toolbarStateBound = true;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let n = sel.anchorNode;
    if (n && n.nodeType === 3) n = n.parentNode;
    const visual = (n && n.closest) ? n.closest('[id$="-visual"][contenteditable="true"]') : null;
    if (visual) _updateHtmlEditorToolbarState(visual);
  });
}

// Parse a human-typed/pasted date string into the `yyyy-mm-dd` value that a
// native <input type="date"> requires. Day-first (Turkish gg.aa.yyyy) is the
// default for ambiguous separators; ISO yyyy-mm-dd is recognised explicitly.
// Returns null when the text can't be read as a date.
function _parsePastedDateToISO(raw) {
  if (!raw) return null;
  // Normalise: drop bidi marks, collapse inner whitespace, strip surrounding
  // punctuation (e.g. a trailing "." when the date ended a sentence).
  let s = String(raw).replace(/[‎‏]/g, '').trim();
  s = s.replace(/^[\s.,;:]+|[\s.,;:]+$/g, '').replace(/\s+/g, ' ');
  if (!s) return null;
  const iso = (y, mo, d) => {
    y = Number(y); mo = Number(mo); d = Number(d);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (y < 100) y += 2000; // 2-digit year → 20yy
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };
  let m;
  // ISO-ish: yyyy-mm-dd / yyyy.mm.dd / yyyy/mm/dd (spaces around separators OK)
  m = s.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})$/);
  if (m) return iso(m[1], m[2], m[3]);
  // Day-first: dd.mm.yyyy / dd-mm-yyyy / dd/mm/yyyy (also 2-digit year)
  m = s.match(/^(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{2,4})$/);
  if (m) return iso(m[3], m[2], m[1]);
  // Month names — English + Turkish — matched on an ASCII-folded 3-letter prefix
  // so case and Turkish diacritics (ş/ğ/ı/İ/ö/ü/ç) don't matter:
  // "1 Haziran 2026", "Haziran 1, 2026", "1 June 2026", "June 1, 2026".
  const fold = (t) => t
    .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
    .toLowerCase();
  const MON = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    oca: 1, sub: 2, nis: 4, haz: 6, tem: 7, agu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
  };
  const sf = fold(s);
  m = sf.match(/^(\d{1,2})\s+([a-z]{3,})\.?\s*,?\s*(\d{4})$/);
  if (m && MON[m[2].slice(0, 3)]) return iso(m[3], MON[m[2].slice(0, 3)], m[1]);
  m = sf.match(/^([a-z]{3,})\.?\s+(\d{1,2})\s*,?\s*(\d{4})$/);
  if (m && MON[m[1].slice(0, 3)]) return iso(m[3], MON[m[1].slice(0, 3)], m[2]);
  // Bare yyyymmdd
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(m[1], m[2], m[3]);
  return null;
}

// Let editors copy-paste dates into native date inputs (which otherwise reject
// arbitrary text). One delegated capture-phase listener covers every current
// and future <input type="date"> on the page; we parse the clipboard text and
// set the ISO value ourselves. No-op (native behaviour) when the paste isn't a
// recognisable date, so nothing regresses.
let _datePasteBound = false;
function _initDatePasteSupport() {
  if (_datePasteBound) return;
  _datePasteBound = true;
  document.addEventListener('paste', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT' || (el.type !== 'date' && el.type !== 'datetime-local')) return;
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    const text = cd.getData('text');
    if (!text) return;
    const isoVal = _parsePastedDateToISO(text);
    if (!isoVal) {
      e.preventDefault();
      if (typeof toast === 'function') toast('Tarih anlaşılamadı. Örn: 01.06.2026 veya 2026-06-01', 'warn');
      return;
    }
    e.preventDefault();
    el.value = isoVal;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, true);
}

// Remove inline font declarations that fight a semantic block tag, from a style
// attribute string. Keeps non-font declarations (e.g. text-align) intact.
function _stripFontDecls(el) {
  if (!el || !el.getAttribute) return;
  const s = el.getAttribute('style');
  if (!s) return;
  const kept = s.split(';').map((d) => d.trim()).filter((d) => {
    if (!d) return false;
    const prop = d.split(':')[0].trim().toLowerCase();
    return !/^(font|font-size|font-weight|font-family|font-style|line-height|color|mso-[\w-]*)$/.test(prop);
  });
  if (kept.length) el.setAttribute('style', kept.join('; '));
  else el.removeAttribute('style');
}

// After formatBlock, clean every block of the new tag that the current selection
// touches: drop conflicting inline font styling and unwrap now-style-less Word
// <span>/<font> wrappers so the tag's own CSS governs the look.
function _cleanFormattedBlocks(visual, tagValue) {
  const tagName = String(tagValue).replace(/[<>]/g, '').toUpperCase();
  if (!/^(H[1-6]|P|DIV)$/.test(tagName)) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const blocks = [];
  const walker = document.createTreeWalker(visual, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (el) => (el.tagName === tagName && range.intersectsNode(el))
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) blocks.push(n);
  // Fallback: if the walker found nothing (collapsed caret edge cases), use the
  // nearest matching-tag ancestor of the caret.
  if (!blocks.length) {
    let e = range.startContainer;
    if (e && e.nodeType === 3) e = e.parentNode;
    while (e && e !== visual) { if (e.tagName === tagName) { blocks.push(e); break; } e = e.parentNode; }
  }
  blocks.forEach((block) => {
    _stripFontDecls(block);
    block.removeAttribute('align');
    block.querySelectorAll('[style]').forEach(_stripFontDecls);
    // Unwrap leftover styling-only <span>/<font> (no attributes after the strip).
    block.querySelectorAll('span, font').forEach((sp) => {
      if (!sp.attributes.length) {
        while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp);
        sp.remove();
      }
    });
  });
}

function htmlEditorLink(prefix) {
  const url = prompt('Link URL:');
  if (!url) return;
  htmlEditorCmd(prefix, 'createLink', url);
}

// ── Insert a table into the full-text editor without writing HTML by hand ──
function buildEditorTableHtml(rows, cols, hasHeader) {
  const R = Math.max(1, Math.min(30, Number(rows) || 1));
  const C = Math.max(1, Math.min(12, Number(cols) || 1));
  const cellRow = (tag) => `<tr>${Array.from({ length: C }, () => `<${tag}><br></${tag}>`).join('')}</tr>`;
  let html = '<table class="article-table">';
  let bodyRows = R;
  if (hasHeader) { html += `<thead>${cellRow('th')}</thead>`; bodyRows = R - 1; }
  html += '<tbody>';
  for (let i = 0; i < Math.max(bodyRows, hasHeader ? 0 : 1); i++) html += cellRow('td');
  html += '</tbody></table>';
  return html;
}

function htmlEditorInsertTable(prefix) {
  const visual = document.getElementById(prefix + '-visual');
  // Capture the editor caret NOW — opening the dialog moves focus and would
  // otherwise lose the insertion point.
  let stashRange = null;
  const sel0 = window.getSelection();
  if (visual && sel0 && sel0.rangeCount) {
    const r0 = sel0.getRangeAt(0);
    if (visual.contains(r0.commonAncestorContainer)) stashRange = r0.cloneRange();
  }

  // Pre-compute the AUTO default label ("Table N") from existing tables so the
  // Etiket field shows the number this table would get automatically.
  let dlgNextNum = 1;
  try {
    const t0 = _scanCrossRefTargets(prefix);
    dlgNextNum = (t0.tables && t0.tables.length) ? Math.max(...t0.tables.map((t) => t.num)) + 1 : 1;
  } catch { dlgNextNum = 1; }
  const tblAutoDefault = `Table ${dlgNextNum}`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:380px">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">Tablo Ekle</h3>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="px-6 py-4 space-y-3">
        <p class="text-xs" style="color:var(--text-muted)">Satır ve sütun sayısını seçin; tablo imlecin bulunduğu yere eklenir. Hücreleri doğrudan tıklayarak düzenleyebilirsiniz.</p>
        <div><label class="label">Etiket</label>
          <input id="tbl-label" class="input" placeholder="Table 1" value="${esc(tblAutoDefault)}" data-auto-default="${esc(tblAutoDefault)}">
          <p class="text-xs mt-1" style="color:var(--text-faint)">Başlığın başında <strong>kalın</strong> görünür (ör. <strong>Tablo 1a</strong>). Değiştirmezseniz otomatik numaralanır.</p></div>
        <div><label class="label">Tablo başlığı <span class="font-normal" style="color:var(--text-faint)">(opsiyonel)</span></label>
          <input id="tbl-caption" class="input" placeholder="Örn. Hastaların temel özellikleri"></div>
        <div class="flex gap-3">
          <div class="flex-1"><label class="label">Satır</label><input id="tbl-rows" type="number" min="1" max="30" value="3" class="input"></div>
          <div class="flex-1"><label class="label">Sütun</label><input id="tbl-cols" type="number" min="1" max="12" value="3" class="input"></div>
        </div>
        <label class="flex items-center gap-2 text-sm" style="color:var(--text)"><input id="tbl-header" type="checkbox" checked class="rounded"> İlk satır başlık satırı olsun</label>
      </div>
      <div class="flex justify-end gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
        <button data-action="cancel" class="btn btn-secondary">İptal</button>
        <button data-action="insert" class="btn btn-primary">Ekle</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('[data-action="cancel"]').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-action="insert"]').onclick = () => {
    const rows = Number(overlay.querySelector('#tbl-rows').value) || 3;
    const cols = Number(overlay.querySelector('#tbl-cols').value) || 3;
    const hasHeader = overlay.querySelector('#tbl-header').checked;
    const caption = (overlay.querySelector('#tbl-caption').value || '').trim();
    // B rule: lock the label only if changed from the auto default.
    const labelEl = overlay.querySelector('#tbl-label');
    const labelVal = labelEl ? labelEl.value.trim() : '';
    const autoDef  = labelEl ? (labelEl.dataset.autoDefault || '') : '';
    const manualLabel = (labelVal && labelVal !== autoDef) ? labelVal : '';
    // Re-derive the number at insert time (the editor may have changed).
    let nextNum = dlgNextNum;
    try {
      const t = _scanCrossRefTargets(prefix);
      nextNum = (t.tables && t.tables.length) ? Math.max(...t.tables.map((x) => x.num)) + 1 : 1;
    } catch { /* keep dlgNextNum */ }
    close();
    // Wrap the empty grid as a numbered #table-N block so it participates in
    // cross-referencing/numbering like every other table (the bare-table output
    // had no wrap/label and was invisible to cross-refs). Build it as a DOM node
    // and insert it directly — execCommand('insertHTML') mangles a wrap <div>
    // with a nested <p> + <table> (it drops the <p class="table-label">).
    const blockNode = document.createElement('div');
    blockNode.className = 'article-table-wrap';
    blockNode.id = `table-${nextNum}`;
    if (manualLabel) blockNode.setAttribute('data-label', manualLabel.replace(/[.\s]+$/, ''));
    blockNode.innerHTML =
      `<p class="table-label" contenteditable="false">${_tableLabelHtml(nextNum, esc(caption), manualLabel)}</p>` +
      buildEditorTableHtml(rows, cols, hasHeader);

    if (!visual) { toast('Editör bulunamadı', 'warning'); return; }
    visual.focus();
    let hostBlock = null;
    if (stashRange) {
      let node = stashRange.startContainer;
      if (node && node.nodeType === 3) node = node.parentNode;
      hostBlock = node && node.closest ? node.closest('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, figure, table') : null;
      while (hostBlock && hostBlock.parentNode && hostBlock.parentNode !== visual) hostBlock = hostBlock.parentNode;
    }
    if (hostBlock && hostBlock.parentNode === visual) {
      const isEmptyHost = /^(P|DIV)$/.test(hostBlock.tagName)
        && !(hostBlock.textContent || '').trim()
        && !hostBlock.querySelector('img, table');
      if (isEmptyHost) hostBlock.parentNode.replaceChild(blockNode, hostBlock);
      else hostBlock.parentNode.insertBefore(blockNode, hostBlock.nextSibling);
    } else {
      visual.appendChild(blockNode);
    }
    markDirty();
    if (typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(visual);
    if (typeof _autoLinkInEditor === 'function') _autoLinkInEditor(visual);
    toast('Tablo eklendi');
  };
}

// ── Supplementary picker — insert uploaded/linked supplementary materials
//    into the full-text editor without writing HTML. ──

const SUPP_IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|tiff?|bmp)$/i;
const SUPP_VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const SUPP_AUDIO_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const SUPP_PDF_EXT   = /\.pdf$/i;

function detectSuppKind(url) {
  const u = String(url || '');
  if (SUPP_IMAGE_EXT.test(u)) return 'image';
  if (SUPP_VIDEO_EXT.test(u)) return 'video';
  if (SUPP_AUDIO_EXT.test(u)) return 'audio';
  if (SUPP_PDF_EXT.test(u))   return 'pdf';
  return 'file';
}

function suppKindIcon(kind) {
  const stroke = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  switch (kind) {
    case 'image': return stroke + '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    case 'video': return stroke + '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
    case 'audio': return stroke + '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    case 'pdf':   return stroke + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    default:      return stroke + '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
  }
}

function suppKindLabel(kind) {
  return { image: 'Görsel', video: 'Video', audio: 'Ses', pdf: 'PDF', file: 'Dosya' }[kind] || 'Dosya';
}

// Read the article id from the current URL hash. Works for /articles/:id and
// /articles-in-press/:id. Returns null when called from a context that has no
// article (e.g. new-article form where the article hasn't been saved yet).
function currentArticleIdFromHash() {
  const h = window.location.hash || '';
  const m = h.match(/^#\/(?:articles|articles-in-press)\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Figure picker — insert an already-uploaded figure into the full-text editor
// without leaving the Tam Metin tab.
async function openFigurePicker(prefix) {
  const articleId = currentArticleIdFromHash();
  if (!articleId) {
    toast('Makaleyi önce kaydedin — kayıtlı bir makale için figür eklenebilir.', 'warning');
    return;
  }
  let figures = [];
  try {
    const assets = await API.get(`/media/article/${articleId}/assets`);
    figures = assets.figures || [];
  } catch { /* ignore — empty state shown */ }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:680px">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">Figür Ekle</h3>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="px-6 py-4">
        <p class="text-sm mb-3" style="color:var(--text)">Bu makaleye yüklü figürler. Birine tıklayın — tam metinde imlecinizin olduğu yere otomatik eklenir.</p>
        ${figures.length === 0 ? `
          <div class="text-center py-8" style="color:var(--text-muted)">
            <p class="text-sm">Bu makale için yüklü figür yok.</p>
            <p class="text-xs mt-1"><strong>Dosyalar</strong> sekmesinden figür yükleyin.</p>
          </div>
        ` : `
          <div class="grid grid-cols-3 gap-3" style="max-height:380px;overflow-y:auto;padding:2px">
            ${figures.map((f) => `
              <button type="button" class="fig-pick" data-url="${esc(f.url)}" data-name="${esc(f.filename)}"
                style="border:1px solid var(--border-soft);border-radius:8px;overflow:hidden;background:#f4f3f0;cursor:pointer;text-align:left">
                <div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;overflow:hidden">
                  <img src="/site/${esc(f.url)}" alt="${esc(f.filename)}" style="max-width:100%;max-height:100%;object-fit:contain" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                  <div style="display:none;color:var(--text-faint);font-size:11px;width:100%;height:100%;align-items:center;justify-content:center">önizleme yok</div>
                </div>
                <div class="truncate text-xs px-2 py-1.5" style="color:var(--text-strong)" title="${esc(f.filename)}">${esc(f.filename)}</div>
              </button>`).join('')}
          </div>
        `}
      </div>
      <div class="flex justify-end px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
        <button data-action="cancel" class="btn btn-secondary">Kapat</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('[data-action="cancel"]').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('.fig-pick').forEach((btn) => {
    btn.onclick = () => {
      close();
      openFigureInsertDialog(btn.dataset.url, btn.dataset.name);
    };
  });
}

// ── Helper: convert a caption's citation tokens to HTML ──
// ONLY the [[N]] token (double brackets) — inserted exclusively by the
// "Kaynakçadan atıf ekle" picker — becomes a linked superscript citation
// (rendered as the bare number, Vancouver style). A single-bracket [N] that the
// user TYPES by hand is intentionally left as literal text and is NEVER turned
// into a citation, here or by the auto-link pass. Multi-number tokens
// ([[5,7]], [[5-9]]) link each number. Everything else is HTML-escaped.
function _captionToHtml(rawCaption) {
  if (!rawCaption) return '';
  return esc(rawCaption).replace(/\[\[\s*(\d+(?:\s*[,\-–]\s*\d+)*)\s*\]\]/g, (_, inside) => {
    const links = inside.replace(/\d+/g, (n) =>
      `<a href="#ref-${n}" class="article-ref-citation">${n}</a>`);
    return `<sup>${links}</sup>`;
  });
}

// ── Figure insert dialog: single caption field that supports inline [N] refs ──
async function openFigureInsertDialog(url, filename) {
  const prefix = document.getElementById('ft-visual') ? 'ft'
               : document.getElementById('aip-ft-visual') ? 'aip-ft'
               : null;

  let refCount = 0;
  if (prefix) {
    try { refCount = _scanCrossRefTargets(prefix).refCount || 0; } catch { /* ignore */ }
  }

  // Extract article ID from url — handles both "images/articles/ID/file" and "/images/articles/ID/file"
  const articleIdMatch = (url || '').match(/images\/articles\/([^/]+)\//i);
  const articleId = articleIdMatch ? articleIdMatch[1] : null;
  if (!articleId) console.warn('[figureDialog] articleId could not be extracted from url:', url);

  // Load previously saved caption (and migrate legacy source field into it)
  let savedMeta = {};
  if (articleId) {
    try {
      const allMeta = await API.get(`/media/article/${articleId}/figure-meta`);
      savedMeta = allMeta[filename] || {};
    } catch { /* ignore — first time or no metadata yet */ }
  }

  // Legacy migration: older saved entries stored "source" separately. Merge it
  // back into the caption so the user sees everything in one place.
  let defaultCaption;
  if (savedMeta.caption || savedMeta.source) {
    const c = (savedMeta.caption || '').trim();
    const s = (savedMeta.source  || '').trim();
    defaultCaption = c && s ? `${c} ${s}` : (c || s);
  } else {
    defaultCaption = (filename || '').replace(/\.[^.]+$/, '');
  }

  // Manual label support: pre-compute the AUTO default ("Figure N" / "Table N")
  // exactly as insertFigureIntoFullText would derive the number, so the Etiket
  // field shows the same value the block would get automatically. The user can
  // overwrite it ("Figür 2a", "Graphic 3") — that locks the label (B rule).
  const isTableFile = /(?:^|[-_])tab(?:le)?[-_]?\d+/i.test(filename || '');
  const labelKind = isTableFile ? 'table' : 'figure';
  let autoNum = null;
  // If this figure/table is ALREADY placed in the editor, use that block's
  // number for the default label (we're editing it, not adding a new one).
  if (prefix) {
    const ftV = document.getElementById(prefix + '-visual');
    const placed = ftV ? _findMediaBlockByFilename(ftV, filename) : null;
    if (placed) { const pm = placed.id.match(/-(\d+)$/); if (pm) autoNum = Number(pm[1]); }
  }
  const numMeta = _extractMediaNum(filename, labelKind);
  if (!autoNum && numMeta && numMeta.num) autoNum = numMeta.num;
  if (!autoNum && prefix) {
    try {
      const t = _scanCrossRefTargets(prefix);
      const ex = (labelKind === 'figure' ? t.figures : t.tables) || [];
      autoNum = ex.length ? Math.max(...ex.map((x) => x.num)) + 1 : 1;
    } catch { autoNum = 1; }
  }
  if (!autoNum) autoNum = 1;
  const autoDefaultLabel = (isTableFile ? 'Table ' : 'FIG. ') + autoNum;
  const hadSavedLabel = typeof savedMeta.label === 'string' && savedMeta.label.trim() !== '';
  const defaultLabel = hadSavedLabel ? savedMeta.label.trim() : autoDefaultLabel;

  // Size preference: 'auto' (system decides at insert time from image natural
  // dimensions), 'small' / 'medium' / 'large' / 'full' (manual override).
  // The dialog UI keeps live state in `currentSize` and surfaces what 'auto'
  // resolves to once the preview image loads.
  let currentSize = savedMeta.size || 'auto';
  let autoResolvedSize = 'medium'; // updated when the preview image loads

  // Build chip grid — all refs in a scrollable container
  const chipRows = refCount > 0
    ? `<div style="display:flex;flex-wrap:wrap;gap:4px;max-height:96px;overflow-y:auto;padding:2px">
        ${Array.from({ length: refCount }, (_, i) => i + 1)
          .map((n) => `<button type="button" class="fig-ref-chip" data-num="${n}"
            style="min-width:36px;padding:3px 7px;border-radius:5px;border:1px solid var(--border);background:#fff;color:var(--text-strong);font-size:11.5px;font-weight:500;cursor:pointer;line-height:1.4">[${n}]</button>`)
          .join('')}
       </div>`
    : `<p class="text-xs py-2" style="color:var(--text-faint)">Tam metinde henüz kaynakça yok. Kaynak numarasını aşağıdan elle ekleyin.</p>`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:520px">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <div>
          <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">Figür Ekle</h3>
          <p class="text-xs mt-0.5" style="color:var(--text-muted)">${esc(filename)}</p>
        </div>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="px-6 py-5 space-y-4">
        <!-- Thumbnail + caption textarea -->
        <div style="display:flex;gap:14px;align-items:flex-start">
          <div style="flex-shrink:0;width:96px;height:80px;background:#f4f3f0;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center">
            <img src="/site/${esc(url)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain" onerror="this.parentNode.style.background='var(--bg-subtle)'">
          </div>
          <div style="flex:1;min-width:0">
            <label class="block text-xs font-semibold mb-1.5" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Etiket</label>
            <input id="fig-dlg-label" class="input w-full" style="font-family:inherit" placeholder="Figure 1" autocomplete="off"
              value="${esc(defaultLabel)}" data-auto-default="${esc(autoDefaultLabel)}">
            <p class="text-xs mt-1 mb-2.5" style="color:var(--text-faint)">Açıklamanın başında <strong>kalın</strong> görünecek etiket (ör. <strong>Figür 2a</strong>, <strong>Graphic 3</strong>). Değiştirmezseniz otomatik numaralanır.</p>
            <label class="block text-xs font-semibold mb-1.5" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Figür Açıklaması</label>
            <textarea id="fig-dlg-caption" class="input w-full" rows="3" style="resize:vertical;font-family:inherit" placeholder="Açıklama metni (etiketi yukarıdaki kutuya yazın). Kaynak eklemek için aşağıdaki “Kaynakçadan atıf ekle” bölümünü kullanın." autocomplete="off">${esc(defaultCaption)}</textarea>
            <p class="text-xs mt-1" style="color:var(--text-faint)">Kaynak atfı <strong>yalnızca</strong> aşağıdaki “Kaynakçadan atıf ekle” bölümünden eklendiğinde bağlanır (<strong>[[3]]</strong> olarak görünür). Elle yazdığınız <strong>[3]</strong> düz metin olarak kalır, atıf olmaz.</p>
          </div>
        </div>

        <!-- Reference chips block (appends the [[N]] citation token into caption) -->
        <div style="background:var(--bg-subtle);border:1px solid var(--border-soft);border-radius:8px;padding:10px 12px">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium" style="color:var(--text-muted)">
              ${refCount > 0 ? `Kaynakçadan atıf ekle (${refCount} kaynak)` : 'Kaynakça (boş)'}
            </span>
            <div class="flex items-center gap-1.5">
              <input id="fig-dlg-manual-n" type="number" min="1" class="input" placeholder="N"
                style="width:60px;font-size:12px;padding:3px 8px;text-align:center">
              <button type="button" id="fig-dlg-manual-add" class="btn btn-secondary btn-sm" style="font-size:12px;padding:4px 10px">Ekle</button>
            </div>
          </div>
          ${chipRows}
        </div>

        <!-- Figure size selector -->
        <div>
          <label class="block text-xs font-semibold mb-1.5" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">
            Görsel Boyutu
            <span id="fig-dlg-auto-hint" style="font-weight:400;text-transform:none;color:var(--text-faint);margin-left:6px"></span>
          </label>
          <div id="fig-dlg-size-group" style="display:flex;gap:6px;flex-wrap:wrap">
            <button type="button" class="fig-size-btn" data-size="auto"   style="flex:1;min-width:80px;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-strong);cursor:pointer;transition:all .12s">Otomatik</button>
            <button type="button" class="fig-size-btn" data-size="small"  style="flex:1;min-width:60px;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-strong);cursor:pointer;transition:all .12s">Küçük</button>
            <button type="button" class="fig-size-btn" data-size="medium" style="flex:1;min-width:60px;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-strong);cursor:pointer;transition:all .12s">Orta</button>
            <button type="button" class="fig-size-btn" data-size="large"  style="flex:1;min-width:60px;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-strong);cursor:pointer;transition:all .12s">Büyük</button>
            <button type="button" class="fig-size-btn" data-size="full"   style="flex:1;min-width:80px;padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:#fff;color:var(--text-strong);cursor:pointer;transition:all .12s">Tam Genişlik</button>
          </div>
          <p class="text-xs mt-1" style="color:var(--text-faint)"><strong>Otomatik</strong>: görselin doğal boyutuna göre sistem karar verir. Diğer seçenekler boyutu sabitler.</p>
        </div>
      </div>

      <div class="flex items-center justify-between px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
        <button data-action="cancel" class="btn btn-secondary">İptal</button>
        <div class="flex gap-2">
          <button data-action="save" class="btn btn-secondary" title="Açıklamayı kaydet (tam metne eklemez). Otomatik Düzenle ile metne yansır.">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Kaydet
          </button>
          <button data-action="insert" class="btn btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Tam Metne Ekle
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const captionInput = overlay.querySelector('#fig-dlg-caption');
  const labelInput   = overlay.querySelector('#fig-dlg-label');
  const manualN      = overlay.querySelector('#fig-dlg-manual-n');

  // Helper: insert the picker citation token [[N]] at the cursor. The double
  // brackets are what make it a REAL citation (see _captionToHtml) — typing a
  // single-bracket [N] by hand stays literal text and is never linked.
  function insertRefTag(n) {
    const tag = `[[${n}]]`;
    const start = captionInput.selectionStart ?? captionInput.value.length;
    const end   = captionInput.selectionEnd   ?? start;
    captionInput.value = captionInput.value.slice(0, start) + tag + captionInput.value.slice(end);
    captionInput.setSelectionRange(start + tag.length, start + tag.length);
    captionInput.focus();
  }

  overlay.querySelectorAll('.fig-ref-chip').forEach((btn) => {
    btn.onclick = () => insertRefTag(btn.dataset.num);
  });

  overlay.querySelector('#fig-dlg-manual-add').onclick = () => {
    const n = parseInt(manualN.value, 10);
    if (!n || n < 1) { manualN.focus(); manualN.select(); return; }
    insertRefTag(n);
    manualN.value = '';
    captionInput.focus();
  };
  manualN.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); overlay.querySelector('#fig-dlg-manual-add').click(); }
  });

  // ── Size selector ──
  const sizeButtons = overlay.querySelectorAll('.fig-size-btn');
  const autoHint    = overlay.querySelector('#fig-dlg-auto-hint');
  const previewImg  = overlay.querySelector('.modal-dialog > div:nth-child(2) img');

  function paintSizeButtons() {
    sizeButtons.forEach((b) => {
      const isActive = b.dataset.size === currentSize;
      b.style.background = isActive ? 'var(--brand)' : '#fff';
      b.style.color      = isActive ? '#fff'         : 'var(--text-strong)';
      b.style.borderColor = isActive ? 'var(--brand)' : 'var(--border)';
      b.style.fontWeight  = isActive ? '600'          : '400';
    });
  }
  sizeButtons.forEach((b) => {
    b.onclick = () => { currentSize = b.dataset.size; paintSizeButtons(); };
  });
  paintSizeButtons();

  // Auto-detect size from the preview image's natural width once it loads.
  //   <600px  → small  (icon-like, fits a column)
  //   600-1200 → medium (default for typical illustrations)
  //   >1200   → large  (wide diagrams / multi-panel)
  function _computeAutoSize(naturalW) {
    if (!naturalW || naturalW <= 0) return 'medium';
    if (naturalW < 600)  return 'small';
    if (naturalW < 1200) return 'medium';
    return 'large';
  }
  if (previewImg) {
    const applyAuto = () => {
      autoResolvedSize = _computeAutoSize(previewImg.naturalWidth);
      const label = { small: 'Küçük', medium: 'Orta', large: 'Büyük' }[autoResolvedSize] || 'Orta';
      if (autoHint) autoHint.textContent = `(otomatik → ${label}, ${previewImg.naturalWidth || '?'}px)`;
    };
    if (previewImg.complete && previewImg.naturalWidth) applyAuto();
    else previewImg.addEventListener('load', applyAuto, { once: true });
  }

  return new Promise((resolve) => {
    const close = async (action) => {
      // Read values BEFORE removing the overlay (detached inputs may clear)
      const captionVal = captionInput.value.trim();
      // B rule: treat the label as LOCKED (manual) only when the user changed it
      // from the prefilled auto default — OR when a manual label was already saved
      // before (so re-opening and re-saving keeps the lock). Empty / unchanged
      // default ⇒ AUTO (sent as '' to clear any previous lock).
      const labelVal = labelInput ? labelInput.value.trim() : '';
      const autoDef  = labelInput ? (labelInput.dataset.autoDefault || '') : '';
      const manualLabel = (labelVal && (labelVal !== autoDef || hadSavedLabel)) ? labelVal : '';

      if (action !== 'cancel') {
        const btn = overlay.querySelector(`[data-action="${action}"]`);
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
      }

      overlay.remove();
      document.removeEventListener('keydown', onKey);

      if (action === 'cancel') { resolve(false); return; }

      // Resolve "auto" to the concrete size detected from the image's natural
      // dimensions. Stored as the literal selection ("auto" / "small" / …) so
      // the dialog can show the user's intent on next open; the resolved
      // concrete size is passed into the editor for rendering.
      const concreteSize = currentSize === 'auto' ? autoResolvedSize : currentSize;

      // Persist metadata — source is empty now (merged into caption)
      if (articleId) {
        try {
          await API.put(`/media/article/${articleId}/figure-meta`, {
            filename,
            caption: captionVal,
            source:  '',
            size:    currentSize,
            label:   manualLabel,
          });
        } catch (err) {
          toast(`Kayıt hatası: ${err.message}`, 'error');
          if (action === 'save') { resolve(false); return; }
        }
      } else if (action === 'save') {
        toast('Makale ID bulunamadı — açıklama kaydedilemedi', 'warning');
        resolve(false);
        return;
      }

      if (action === 'save') {
        // Auto-sync: if this figure/table is ALREADY placed in the full-text
        // editor, update its label/caption/size in place right away so the user
        // doesn't have to run "Otomatik Düzenle" for an edit. Only the block's
        // caption is touched (image + position kept).
        let synced = false;
        const ftVisual = document.getElementById('ft-visual') || document.getElementById('aip-ft-visual');
        const block = ftVisual ? _findMediaBlockByFilename(ftVisual, filename) : null;
        if (block) {
          const bKind = block.tagName === 'FIGURE' ? 'figure' : 'table';
          const bm = block.id.match(/-(\d+)$/);
          const bNum = bm ? Number(bm[1]) : (autoNum || 1);
          if (manualLabel) block.setAttribute('data-label', manualLabel.replace(/[.\s]+$/, ''));
          else block.removeAttribute('data-label');
          const stripped = captionVal.replace(
            new RegExp(`^\\s*(?:figure|fig\\.?|şekil|sekil|tablo|table)\\s*${bNum}[a-z]?\\s*[.:\\-—–]?\\s*`, 'i'),
            ''
          ).trim();
          const inner = _captionToHtml(stripped);
          const concrete = (currentSize === 'auto') ? autoResolvedSize : currentSize;
          _updateExistingMediaCaption(block, bKind, bNum, inner, concrete);
          if (typeof _autoLinkInEditor === 'function') _autoLinkInEditor(ftVisual);
          if (typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(ftVisual);
          markDirty();
          synced = true;
        }
        // Refresh the asset cache + Dosyalar "Yüklü Figürler" thumbnails so the
        // new caption/label shows everywhere (incl. the Medya manager, which
        // reads this cache for unplaced figures). Non-blocking.
        if (articleId && typeof loadArticleAssets === 'function') { loadArticleAssets(articleId).catch(() => {}); }
        toast(synced
          ? 'Figür kaydedildi ve tam metindeki başlık/açıklama otomatik güncellendi.'
          : 'Figür açıklaması kaydedildi. Tam Metin sekmesinden "Otomatik Düzenle" ile metne yansıtın.');
        resolve('saved');
        return;
      }

      // action === 'insert'
      insertFigureIntoFullText(url, filename, captionVal, concreteSize, manualLabel);
      resolve(true);
    };

    const onKey = (e) => { if (e.key === 'Escape') close('cancel'); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.modal-close').onclick           = () => close('cancel');
    overlay.querySelector('[data-action="cancel"]').onclick = () => close('cancel');
    overlay.querySelector('[data-action="save"]').onclick   = () => close('save');
    overlay.querySelector('[data-action="insert"]').onclick = () => close('insert');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close('cancel'); });
    setTimeout(() => { captionInput.focus(); captionInput.select(); }, 50);
  });
}

// ── Cross-reference picker: wrap selected text in <a href="#figure-N"> etc. ──
//
// The visual editor uses contenteditable; opening a modal moves focus out of
// it and the user's selection is lost. We stash the live range on mousedown
// (which fires BEFORE focus moves to the toolbar button) so the eventual
// insert command can place the anchor exactly where the editor cursor was.
const _crossRefSelection = {}; // prefix → { range, text }

function saveCrossRefSelection(prefix) {
  const sel = window.getSelection();
  const visual = document.getElementById(prefix + '-visual');
  if (!sel || !sel.rangeCount || !visual) { _crossRefSelection[prefix] = null; return; }
  const range = sel.getRangeAt(0);
  if (!visual.contains(range.commonAncestorContainer)) { _crossRefSelection[prefix] = null; return; }
  _crossRefSelection[prefix] = { range: range.cloneRange(), text: range.toString() };
}

// Many legacy / mirrored articles (e.g. content imported from balkanmedicaljournal.org
// HTML rather than JATS) ship <figure class="article-figure"> blocks WITHOUT
// id="figure-N" anchors — so the bubble scanner, the runtime relocator and
// the auto-linker all fail to bind references. Walk the editor DOM once and
// stamp sequential figure-N / table-N IDs on every untagged block. Cheap to
// run repeatedly because tagged blocks are skipped.
function _ensureMediaIds(visualEl) {
  if (!visualEl) return false;
  let mutated = false;

  // ── Step 0: clean up "fake figures" ──
  // Word paste / accidental insertion can produce a <figure> element that has
  // NO <img>, just bold heading text inside (e.g. <figure><b>INTRODUCTION</b></figure>).
  // The site renders these as bordered cards, breaking the layout. Detect them
  // and unwrap to a plain bold paragraph so they look like normal section
  // headings ("MATERIALS AND METHODS", etc.).
  visualEl.querySelectorAll('figure').forEach((f) => {
    if (f.querySelector('img, picture, svg, video, iframe')) return; // real figure
    const text = (f.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      // Empty figure — drop it entirely
      f.remove();
      mutated = true;
      return;
    }
    // Short, heading-like content (no real paragraphs): convert to bold <p>
    const hasParagraph = f.querySelector('p, ol, ul');
    if (!hasParagraph && text.length < 120) {
      const p = document.createElement('p');
      p.className = 'MsoNormal';
      const b = document.createElement('b');
      b.textContent = text;
      p.appendChild(b);
      f.replaceWith(p);
      mutated = true;
    }
  });

  // Figures
  const figs = visualEl.querySelectorAll('figure');
  const usedFig = new Set();
  figs.forEach((f) => {
    const m = (f.id || '').match(/^(?:figure|fig)-(\d+)$/i);
    if (m) usedFig.add(Number(m[1]));
  });
  let fn = 1;
  figs.forEach((f) => {
    if (f.id && /^(?:figure|fig)-\d+$/i.test(f.id)) return;
    while (usedFig.has(fn)) fn++;
    f.id = 'figure-' + fn;
    usedFig.add(fn);
    fn++;
    mutated = true;
  });
  // Tables: explicit table-wraps OR bare <table class="article-table">
  const tabs = visualEl.querySelectorAll('.article-table-wrap, .article-table');
  const usedTab = new Set();
  tabs.forEach((t) => {
    const m = (t.id || '').match(/^(?:table|tab)-(\d+)$/i);
    if (m) usedTab.add(Number(m[1]));
  });
  let tn = 1;
  tabs.forEach((t) => {
    if (t.id && /^(?:table|tab)-\d+$/i.test(t.id)) return;
    // Skip <table> elements that live inside an .article-table-wrap whose
    // wrap already has the ID — the outer wrap is the canonical anchor.
    if (t.tagName === 'TABLE' && t.closest('.article-table-wrap')) return;
    while (usedTab.has(tn)) tn++;
    t.id = 'table-' + tn;
    usedTab.add(tn);
    tn++;
    mutated = true;
  });
  // Mark the editor dirty so the Save button is enabled — without this the
  // newly-stamped IDs would silently vanish when the user navigates away.
  if (mutated && typeof markDirty === 'function') markDirty();
  return mutated;
}

// Word "Save as HTML" exports references as a sequence of <p class="MsoListParagraph…">
// elements, each with the number baked in as literal text inside a
// <span style="mso-list:Ignore">. The Atıf picker can't see them as a list
// and the citation anchors don't work. Convert the whole sequence to a
// proper <ol><li id="ref-N">.
// Heading text variants we accept as a "references" header. Covers English,
// Turkish, and ALL CAPS / mixed-case forms commonly produced by Word exports.
const _REF_HEADING_RE = /^\s*(references?|bibliography|kaynaklar|kaynakça|referanslar|kaynak\s*listesi)\s*$/i;

// Locate the "REFERENCES" heading in the visual editor. Word-pasted articles
// frequently style this as a plain bold <p> rather than a real <h*>, so we
// fall back to any <p>/<div> whose normalised text matches the heading
// regex — preferring bold paragraphs but accepting short standalone matches
// too (a <p>REFERENCES</p> with no other content is unambiguous).
function _findRefHeading(visualEl) {
  if (!visualEl) return null;
  // 1) Real heading elements first.
  for (const h of visualEl.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (_REF_HEADING_RE.test(h.textContent || '')) return h;
  }
  // 2) Bold-paragraph fallback for Word-paste / plain-html articles.
  const candidates = visualEl.querySelectorAll('p, div');
  for (const p of candidates) {
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || !_REF_HEADING_RE.test(text)) continue;
    // Inline bold marker — Word's pasted REFERENCES line is <b>/<strong>.
    if (p.querySelector('b, strong')) return p;
    // Inline-style fallback: font-weight via attribute.
    const sty = (p.getAttribute('style') || '') + ' ' +
                Array.from(p.querySelectorAll('[style]'))
                  .map((s) => s.getAttribute('style') || '').join(' ');
    if (/font-weight\s*:\s*(bold|[6-9]\d\d)/i.test(sty)) return p;
    // Final fallback: a short standalone "REFERENCES" paragraph is also
    // unambiguous even without bold styling (textually it can't be anything
    // else, and false positives are rare given the strict regex).
    if (text.length <= 16) return p;
  }
  return null;
}

// Promote Word-style "<p class='MsoNormal'><b>INTRODUCTION</b></p>" into a
// Convert a heading string to Title Case, keeping short function words lowercase
// unless they start the heading. Handles Turkish conjunctions too.
function _toTitleCase(str) {
  const small = new Set(['a','an','the','and','but','or','for','nor','on','at',
    'to','by','of','in','up','as','if','so','vs','ve','ile','da','de','ya','ki']);
  return str.split(/\s+/).map(function(word, i) {
    if (!word) return word;
    const lower = word.toLowerCase();
    if (i > 0 && small.has(lower)) return lower;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// proper <h3>INTRODUCTION</h3> so the editor preview, the saved HTML, and the
// public-site TOC ("In This Article") all see real headings — matching the
// look-and-feel of articles whose source HTML was migrated to clean <h3>s.
// Mirrors the runtime promoter in article.html (cleanupReferenceListItems'
// sibling) so the editor and reader views never disagree.
// Largest inline font-size (in pt; px converted ≈ ×0.75) found on a heading
// paragraph or its bold/span children — Word's heading STYLES carry this, which
// lets us tell main sections (bigger) from subsections (smaller).
function _headingFontPt(p) {
  let max = null;
  const check = (el) => {
    if (!el || !el.getAttribute) return;
    const m = (el.getAttribute('style') || '').match(/font-size\s*:\s*([\d.]+)\s*(pt|px)/i);
    if (!m) return;
    let v = parseFloat(m[1]);
    if (m[2].toLowerCase() === 'px') v *= 0.75;
    if (max == null || v > max) max = v;
  };
  check(p);
  check(p.firstElementChild);
  p.querySelectorAll('[style]').forEach(check);
  return max;
}

function _promoteMsoHeadings(visualEl) {
  if (!visualEl) return false;

  // ── Pass 1: collect heading-like paragraphs (same strict gating as before) ──
  const cands = [];
  visualEl.querySelectorAll('p').forEach((p) => {
    if (p.closest('.article-references, .article-acknowledgments, .article-footnotes, .article-supplementary, figure, .article-figure, .article-table-wrap, table')) return;
    const first = p.firstElementChild;
    if (!first || (first.tagName !== 'B' && first.tagName !== 'STRONG')) return;
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 100) return;
    const boldText = (first.textContent || '').replace(/\s+/g, ' ').trim();
    if (boldText !== text) return;
    const isUpper = text === text.toUpperCase() && /[A-ZÇĞİŞÜÖ]/.test(text);
    const isTitleCase = /^[A-ZÇĞİŞÜÖ]/.test(text) && text.length < 50;
    if (!isUpper && !isTitleCase) return;
    if (/^(references?|bibliography|kaynaklar|kaynakça|referanslar|kaynak\s*listesi)$/i.test(text)) return;
    if (/^\s*(?:tables?|tablolar?|tablo|tab|figures?|figs?|şekiller?|şekil|sekil|fig)\b\s*\.?\s*\d+/i.test(text)) return;
    cands.push({ p, text, isUpper, sizePt: _headingFontPt(p) });
  });
  if (!cands.length) return false;

  // ── Pass 2: assign H3 (main) → H4 (sub) → H5 → H6 by depth ──
  // This site styles .article-body h3–h6 (progressively smaller); h1/h2 are NOT
  // styled, so we never emit them. Signal priority: (1) inline font-size — the
  // distinct sizes are ranked biggest→smallest and mapped to H3,H4,H5,H6 so a
  // 3rd/4th heading level is honored, not flattened; (2) UPPERCASE-vs-TitleCase
  // split when there is no size signal; (3) uniform set with no signal → all H3.
  const sizes = cands.map((c) => c.sizePt).filter((v) => v != null);
  const distinctDesc = Array.from(new Set(sizes)).sort((a, b) => b - a);
  const hasSizeSignal = distinctDesc.length >= 2;
  const upperCount = cands.filter((c) => c.isUpper).length;
  const capsSplit = upperCount > 0 && upperCount < cands.length;

  // size → level: rank among distinct sizes (≤0.5pt tolerance), H3 + rank, cap H6.
  const tierOf = (sz) => {
    if (sz == null) return null;
    let idx = distinctDesc.findIndex((s) => Math.abs(s - sz) <= 0.5);
    if (idx < 0) idx = distinctDesc.length - 1;
    return Math.min(3 + idx, 6);
  };

  const levelFor = (c) => {
    if (hasSizeSignal) {
      if (c.sizePt != null) return tierOf(c.sizePt);
      return c.isUpper ? 3 : 4; // no size on this one — fall back to caps
    }
    if (capsSplit) return c.isUpper ? 3 : 4;
    return 3; // uniform set, no signal → legacy main-heading behavior
  };

  let mutated = false;
  cands.forEach((c) => {
    const h = document.createElement('h' + levelFor(c));
    h.textContent = _toTitleCase(c.text);
    c.p.parentNode.replaceChild(h, c.p);
    mutated = true;
  });
  if (mutated && typeof markDirty === 'function') markDirty();
  return mutated;
}

// Strip the redundant inline "N." prefix from each <li> inside the references
// list. Word exports embed the literal "1.", "2." numbers as text at the
// start of each MsoListParagraph; once those become <li>s, the <ol> already
// auto-numbers them, so the inline numbers create the duplicate "1.  1. ..."
// effect seen in the editor and on the live site.
// Strip only the font-IDENTITY declarations (family/size/line-height + the
// `font` shorthand + mso-*) from a reference element, KEEPING font-weight,
// font-style and color so a journal name's italic/bold emphasis survives.
// References must render in one fixed list font (CSS), regardless of whether
// they were pasted from Word (carry inline fonts) or typed in by hand (plain).
function _stripRefFontDecls(el) {
  if (!el || !el.getAttribute) return;
  const s = el.getAttribute('style');
  if (!s) return;
  const kept = s.split(';').map((d) => d.trim()).filter((d) => {
    if (!d) return false;
    const prop = d.split(':')[0].trim().toLowerCase();
    return !/^(font|font-size|font-family|line-height|mso-[\w-]*)$/.test(prop);
  });
  if (kept.length) el.setAttribute('style', kept.join('; '));
  else el.removeAttribute('style');
}

// Make every reference list item share the list's CSS font: drop inline
// font-family/size from each <li> and its descendants, then unwrap any
// <span>/<font> left with no attributes. Idempotent.
function _normalizeReferenceFonts(ol) {
  if (!ol) return false;
  let mutated = false;
  ol.querySelectorAll(':scope > li').forEach((li) => {
    const before = (li.getAttribute('style') || '') + '|' + li.innerHTML;
    _stripRefFontDecls(li);
    li.querySelectorAll('[style]').forEach(_stripRefFontDecls);
    li.querySelectorAll('span, font').forEach((sp) => {
      if (!sp.attributes.length) {
        while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp);
        sp.remove();
      }
    });
    if (((li.getAttribute('style') || '') + '|' + li.innerHTML) !== before) mutated = true;
  });
  return mutated;
}

function _cleanupReferenceListItems(visualEl) {
  if (!visualEl) return false;
  const ol = visualEl.querySelector('.article-references ol, ol.article-references-ol');
  if (!ol) return false;
  let mutated = false;
  ol.querySelectorAll(':scope > li').forEach((li) => {
    const before = li.innerHTML;
    let html = before;
    // Number-containing leading span (Word's "<span>1.&nbsp;&nbsp;</span>Author…"):
    // remove the whole span if its visible text is just "N." plus whitespace.
    html = html.replace(/^\s*<span\b[^>]*>\s*\d+\.\s*(?:&nbsp;|\s)*<\/span>\s*/i, '');
    // Bare leading "N." text optionally followed by nbsp/whitespace.
    html = html.replace(/^(?:\s|&nbsp;)*\d+\.(?:\s|&nbsp;)*/, '');
    // Leading whitespace-only span (the spacer left over from Word).
    html = html.replace(/^\s*<span\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/span>\s*/i, '');
    // Repeat once in case the number sat inside a span we just removed.
    html = html.replace(/^(?:\s|&nbsp;)*\d+\.(?:\s|&nbsp;)*/, '');
    if (html !== before) {
      li.innerHTML = html;
      mutated = true;
    }
  });
  // Unify the list font: Word-pasted refs carry inline font-family/size that
  // diverges from hand-typed refs (which inherit the list CSS). Strip those so
  // every item renders in one fixed font.
  if (_normalizeReferenceFonts(ol)) mutated = true;
  if (mutated && typeof markDirty === 'function') markDirty();
  return mutated;
}

function _normalizeMsoReferenceList(visualEl) {
  if (!visualEl) return false;
  // Always clean up any existing reference <li>s — this catches articles where
  // a previous run wrapped the list in <ol> but left the inline numbers behind.
  _cleanupReferenceListItems(visualEl);
  const h = _findRefHeading(visualEl);
  if (!h) return false;
  const items = [];
  // Walk past Word's stray empty paragraphs / spacers and pick up consecutive
  // MsoListParagraph siblings even if a non-Mso filler sits between them.
  // We tolerate up to a few non-Mso elements before giving up — Word exports
  // sometimes wedge a <br>, an empty <p>, or an <o:p> tag between refs.
  let n = h.nextElementSibling;
  let skipped = 0;
  while (n) {
    if (n.tagName === 'P' && /MsoListParagraph/.test(n.className || '')) {
      items.push(n);
      skipped = 0;
      n = n.nextElementSibling;
    } else if (skipped < 2 && (
      // Tolerable filler: empty <p>, <br>, <o:p>, comments
      (n.tagName === 'P' && !(n.textContent || '').trim()) ||
      n.tagName === 'BR' ||
      n.tagName.toLowerCase() === 'o:p'
    )) {
      skipped += 1;
      n = n.nextElementSibling;
    } else {
      break;
    }
  }
  // Tail-absorb: authors frequently type the LAST reference as a plain
  // MsoNormal/normal <p> (different run formatting — e.g. a Calibri paragraph)
  // instead of continuing the auto-numbered MsoListParagraph list, so the walk
  // above stops one short. Pull in trailing siblings that unmistakably read as
  // a reference (a "YEAR;volume:page" citation tail) so the final entry isn't
  // dropped. The gate is deliberately reference-specific to avoid swallowing a
  // following acknowledgments / conflict-of-interest paragraph; we also bail at
  // any heading or already-structured section.
  const _looksLikeRef = (el) => {
    if (!el || el.tagName !== 'P') return false;
    if (el.closest && el.closest('.article-references, .article-acknowledgments, .article-footnotes, figure, table, .article-table-wrap')) return false;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length < 12 || t.length > 1000) return false;
    // Volume;issue:page tail: "2025;42:386-387." / "2025;13:e30-e31." — very
    // reference-specific (a year immediately followed by ";<digits|eNN>").
    return /(?:19|20)\d\d\s*;\s*[a-z]?\d/i.test(t);
  };
  let tailSkipped = 0;
  while (n) {
    if (_looksLikeRef(n)) {
      items.push(n);
      tailSkipped = 0;
      n = n.nextElementSibling;
    } else if (tailSkipped < 2 && (
      (n.tagName === 'P' && !(n.textContent || '').trim()) ||
      n.tagName === 'BR' || n.tagName.toLowerCase() === 'o:p'
    )) {
      tailSkipped += 1;
      n = n.nextElementSibling;
    } else {
      break;
    }
  }
  if (items.length < 2) return false;
  const ol = document.createElement('ol');
  ol.className = 'article-references-ol';
  items.forEach((p, i) => {
    const li = document.createElement('li');
    li.id = 'ref-' + (i + 1);
    const clone = p.cloneNode(true);
    clone.querySelectorAll('span[style*="mso-list"], o\\:p').forEach((s) => s.remove());
    let html = clone.innerHTML
      .replace(/^[\s ]*\d+\.[\s ]+/, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
    li.innerHTML = html;
    ol.appendChild(li);
  });
  // Unify the list font now that the <ol> exists (the cleanup pass at the top
  // ran before any <li> existed) — strips any Calibri/Times the tail-absorbed
  // MsoNormal paragraph carried in, so the new entry matches the rest.
  _normalizeReferenceFonts(ol);
  let wrapper = h.parentNode && h.parentNode.classList && h.parentNode.classList.contains('article-references')
    ? h.parentNode : null;
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'article-references';
    h.parentNode.insertBefore(wrapper, h);
    wrapper.appendChild(h);
  }
  wrapper.appendChild(ol);
  items.forEach((p) => p.remove());
  if (typeof markDirty === 'function') markDirty();
  return true;
}

// A block-level paragraph that READS as a figure/table caption: its text starts
// with "Figure 1.", "Table 2:", "Şekil 3 -", "Suppl. Fig. 1a)", etc. The
// punctuation right after the number is what distinguishes a caption from a body
// sentence that merely mentions a figure ("Figure 1 shows…", "Table 1, 2 and 3").
const _CAPTION_PREFIX_RE = /^\s*(?:supplementary\s+|suppl\.?\s+|ek\s+|online\s+)?(?:figure|fig\.?|table|tbl\.?|şekil|sekil|tablo|graph|chart|scheme|plate|resim|grafik|görsel|gorsel)\s*\d+[a-z]?\s*[.:)–—-]/i;

// Nearest block-level ancestor of a node, stopping at `root`.
function _nearestBlockEl(node, root) {
  let p = node && node.nodeType === 1 ? node : (node && node.parentNode);
  while (p && p !== root) {
    if (p.nodeType === 1 && /^(P|DIV|LI|FIGCAPTION|TD|TH|H1|H2|H3|H4|H5|H6)$/.test(p.tagName)) return p;
    p = p.parentNode;
  }
  return null;
}

// True when a node lives inside a figure/table caption — either a structural
// caption (<figcaption>, <p class="table-label">, inside a <figure>/.article-figure)
// or a plain "Figure N. …" paragraph. Bracketed/superscript numbers there are
// almost always values (counts, ages, ranges, panel sizes), NOT reference
// citations, so the auto-citation passes must skip them. (Citations a user
// deliberately added via the Figür dialog are already <a> anchors and stay.)
function _inMediaCaption(node, root) {
  let p = node && node.nodeType === 1 ? node : (node && node.parentNode);
  while (p && p !== root) {
    if (p.tagName === 'FIGURE' || p.tagName === 'FIGCAPTION') return true;
    if (p.classList && (p.classList.contains('table-label') || p.classList.contains('article-figure'))) return true;
    p = p.parentNode;
  }
  const block = _nearestBlockEl(node, root);
  if (block && _CAPTION_PREFIX_RE.test(block.textContent || '')) return true;
  return false;
}

// Heal partially-linked sub-figure references: an <a class="article-media-ref-link">
// whose text ends in a digit (e.g. "Table 1"), immediately followed by a plain-text
// node beginning with a single sub-figure letter that is NOT part of a word
// ("a)", "b,", "c " — but never "are"), gets that letter absorbed into the anchor
// → "Table 1a". Fixes manually-inserted refs and links made before the block got
// its sub-letter. Idempotent (anchors already ending in a letter are skipped).
function _extendMediaRefSubletters(root) {
  if (!root || !root.querySelectorAll) return false;
  let changed = false;
  root.querySelectorAll('a.article-media-ref-link').forEach((a) => {
    const txt = a.textContent || '';
    if (!/\d$/.test(txt)) return;                 // anchor must end in a digit
    const sib = a.nextSibling;
    if (!sib || sib.nodeType !== 3) return;       // next node must be plain text
    const val = sib.nodeValue || '';
    const m = val.match(/^([A-Za-z])(?![A-Za-z])/); // single letter, not a word start
    if (!m) return;
    a.textContent = txt + m[1];
    sib.nodeValue = val.slice(1);
    changed = true;
  });
  return changed;
}

// Walk the editor body and auto-link any plain-text mentions of figures,
// tables, or references that aren't already wrapped in anchors. Mirrors the
// public-site enhancers (autoLinkPlainMediaMentions + enhanceReferenceCitations)
// so the editor preview shows the same teal cross-references the reader will
// see. Idempotent: re-running finds nothing new to wrap.
function _autoLinkInEditor(visualEl) {
  if (!visualEl) return false;
  let mutated = false;

  // Build a set of available figure / table IDs (already stamped by
  // _ensureMediaIds). Counter for refs comes from the <ol> length.
  const figIds = new Set();
  visualEl.querySelectorAll('figure[id^="figure-"], figure[id^="fig-"]').forEach((f) => {
    const m = f.id.match(/^(?:figure|fig)-(\d+)$/i);
    if (m) figIds.add(Number(m[1]));
  });
  const tabIds = new Set();
  visualEl.querySelectorAll('[id^="table-"], [id^="tab-"]').forEach((t) => {
    if (t.tagName === 'A') return;
    const m = t.id.match(/^(?:table|tab)-(\d+)$/i);
    if (m) tabIds.add(Number(m[1]));
  });
  let refOl = visualEl.querySelector('.article-references ol');
  if (!refOl) {
    // Heading-then-list fallback for articles that didn't go through Mso
    // normalisation (e.g. plain `<p><b>REFERENCES</b></p><ol>…</ol>` typed
    // by the editor directly). Uses the same broad heading detector so a
    // bold paragraph is recognised, not just real <h*> elements.
    const h = _findRefHeading(visualEl);
    if (h) {
      let n = h.nextElementSibling;
      while (n && !/^(OL|UL)$/.test(n.tagName)) n = n.nextElementSibling;
      if (n) refOl = n;
    }
  }
  const refCount = refOl ? refOl.querySelectorAll(':scope > li').length : 0;

  // Pass 1 — auto-link plain-text "Figure N" / "Table N" / "Şekil N" / "Tablo N"
  // including multi-number sequences ("Figures 1, 2, and 3", "Figs. 4-6") and
  // subfigure letters ("Figure 1A", "Fig. 2b").
  const insideSkip = (node) => {
    let p = node.parentNode;
    while (p && p !== visualEl) {
      if (p.tagName === 'A') return true;
      if (p.tagName === 'FIGURE' || p.tagName === 'FIGCAPTION') return true;
      if (p.classList && (
        p.classList.contains('article-references') ||
        p.classList.contains('article-acknowledgments') ||
        p.classList.contains('article-footnotes') ||
        p.classList.contains('article-supplementary') ||
        p.classList.contains('article-table-wrap') ||
        p.classList.contains('article-figure') ||
        p.classList.contains('table-label') ||
        p.classList.contains('table-footnote')
      )) return true;
      p = p.parentNode;
    }
    return false;
  };

  // Single regex captures: kind-word + whitespace + a sequence of numbers
  // (each optionally with a subfigure letter, joined by , - – "and" "ve").
  // We then walk the sequence and wrap each number with its own anchor so
  // every individual reference is clickable.
  const seqPattern = /(?<![A-Za-z])(figures?|figs?\.?|şekiller?|şekil|sekil|tables?|tablolar?|tablo)(\s+)((?:\d+[a-z]?)(?:\s*(?:,|-|–|\sand\s|\sve\s)\s*\d+[a-z]?)*)/gi;
  const isFigWord = (w) => /^(fig|figure|şekil|sekil|şekiller)/i.test(w);

  const textNodes = [];
  const walker = document.createTreeWalker(visualEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (!n.nodeValue || !/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      if (insideSkip(n)) return NodeFilter.FILTER_REJECT;
      // Pre-filter MUST match the same alternations as seqPattern below —
      // otherwise plural forms ("Figures") fail the gate and the
      // multi-number splitter never runs.
      return /(?<![A-Za-z])(figures?|figs?\.?|şekiller?|şekil|sekil|tables?|tablolar?|tablo)\s+\d+/i.test(n.nodeValue)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n);

  textNodes.forEach((textNode) => {
    const raw = textNode.nodeValue;
    seqPattern.lastIndex = 0;
    let match, lastIdx = 0;
    const frag = document.createDocumentFragment();
    let wrappedAny = false;
    while ((match = seqPattern.exec(raw)) !== null) {
      const kindWord = match[1];
      const ws = match[2];
      const numSeq = match[3];
      const kind = isFigWord(kindWord) ? 'figure' : 'table';
      const ids = kind === 'figure' ? figIds : tabIds;

      // Tokenise the number sequence into alternating num / sep tokens so we
      // can wrap each numeric span with its own anchor while preserving the
      // original separators ("," " and " " ve " etc).
      const tokens = [];
      const tokenRe = /(\d+[a-z]?)|(\s*(?:,|-|–|\sand\s|\sve\s)\s*)/gi;
      let t;
      while ((t = tokenRe.exec(numSeq)) !== null) {
        tokens.push(t[1] ? { kind: 'num', val: t[1] } : { kind: 'sep', val: t[2] });
      }
      const baseNum = parseInt((tokens.find((x) => x.kind === 'num') || {}).val || '0', 10);
      if (!ids.has(baseNum)) continue;

      // Emit pre-text first.
      if (match.index > lastIdx) frag.appendChild(document.createTextNode(raw.slice(lastIdx, match.index)));
      // First number gets wrapped along with the kind word ("Figure 1");
      // subsequent numbers are wrapped individually.
      let firstSeen = false;
      tokens.forEach((tk) => {
        if (tk.kind === 'sep') {
          frag.appendChild(document.createTextNode(tk.val));
          return;
        }
        const numericPart = parseInt(tk.val, 10);
        if (!firstSeen) {
          firstSeen = true;
          const a = document.createElement('a');
          a.href = '#' + kind + '-' + baseNum;
          a.className = 'article-media-ref-link';
          a.textContent = kindWord + ws + tk.val;
          frag.appendChild(a);
          return;
        }
        if (ids.has(numericPart)) {
          const a = document.createElement('a');
          a.href = '#' + kind + '-' + numericPart;
          a.className = 'article-media-ref-link';
          a.textContent = tk.val;
          frag.appendChild(a);
        } else {
          // Target doesn't exist — keep as plain text so the link doesn't
          // dead-end. The first one (baseNum) already passed the ids.has check.
          frag.appendChild(document.createTextNode(tk.val));
        }
      });
      lastIdx = match.index + match[0].length;
      wrappedAny = true;
    }
    if (!wrappedAny) return;
    if (lastIdx < raw.length) frag.appendChild(document.createTextNode(raw.slice(lastIdx)));
    textNode.parentNode.replaceChild(frag, textNode);
    mutated = true;
  });

  // Pass 1b — heal PARTIAL media links: an anchor whose text ends in a digit
  // ("Table 1") immediately followed by a stray sub-figure letter in plain text
  // ("a)" → the "a" wasn't linked). Absorb the trailing letter into the anchor
  // so the whole "Table 1a" is clickable. Covers manually-inserted refs and
  // links created before a table/figure gained its sub-letter.
  if (_extendMediaRefSubletters(visualEl)) mutated = true;

  // Pass 2 — wrap bare-digit <sup>N</sup> citations in ref-N anchors.
  if (refCount) {
    // Make sure each <li> has an id so the anchor target exists.
    refOl.querySelectorAll(':scope > li').forEach((li, i) => {
      if (!li.id) li.id = 'ref-' + (i + 1);
    });
    const citationPattern = /^[\s\d,\-–— ]+$/;
    visualEl.querySelectorAll('sup').forEach((sup) => {
      if (sup.closest('.article-references, .article-footnotes, .article-acknowledgments')) return;
      if (_inMediaCaption(sup, visualEl)) return; // figure/table caption → not a citation
      if (sup.querySelector('a')) return;
      const text = (sup.textContent || '').trim();
      if (!text || !citationPattern.test(text) || !/\d/.test(text)) return;
      // Rebuild from textContent so Word's <span lang=…> wrappers inside
      // sup don't hide digits from the digit replacer. Vancouver-style sup
      // contents are just numbers + separators — losing inner styling is
      // an upgrade, not a regression.
      const rebuilt = text.replace(/(\d+)/g, (m, n) => {
        const idx = parseInt(n, 10);
        if (!idx || idx > refCount) return m;
        return `<a href="#ref-${idx}" class="article-ref-citation">${m}</a>`;
      });
      if (/article-ref-citation/.test(rebuilt) && rebuilt !== sup.innerHTML) {
        sup.innerHTML = rebuilt;
        mutated = true;
      }
    });

    // Pass 2b — bracketed plain-text citations: [1], [1,2], [1-5], [1, 2, 3].
    // IEEE / on-baseline citation style. Walk text nodes outside skip
    // regions and wrap each digit inside the brackets (brackets stay).
    const refSkip = (node) => {
      let p = node.parentNode;
      while (p && p !== visualEl) {
        if (p.tagName === 'A') return true;
        if (p.classList && (
          p.classList.contains('article-references') ||
          p.classList.contains('article-footnotes') ||
          p.classList.contains('article-acknowledgments')
        )) return true;
        p = p.parentNode;
      }
      // Figure/table captions (structural or "Figure N. …" paragraphs): bracketed
      // numbers there are values, not citations — never auto-link them.
      if (_inMediaCaption(node, visualEl)) return true;
      return false;
    };
    const bracketPattern = /\[\s*(\d+(?:\s*(?:,|-|–|;)\s*\d+)*)\s*\]/g;
    const refTextNodes = [];
    const refWalker = document.createTreeWalker(visualEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n.nodeValue || !/\[\s*\d/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (refSkip(n)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = refWalker.nextNode(); n; n = refWalker.nextNode()) refTextNodes.push(n);

    refTextNodes.forEach((textNode) => {
      const raw = textNode.nodeValue;
      bracketPattern.lastIndex = 0;
      let match, lastIdx = 0;
      const frag = document.createDocumentFragment();
      let wrappedAny = false;
      while ((match = bracketPattern.exec(raw)) !== null) {
        const inside = match[1];
        // Plausibility gate: every cited number must be in range. A digit
        // out of range usually means this is a measurement, not a citation
        // (e.g. "[10 mg]" when refCount=8) — skip wholesale.
        const nums = (inside.match(/\d+/g) || []).map(Number);
        if (!nums.length || nums.some((n) => n < 1 || n > refCount)) continue;

        if (match.index > lastIdx) frag.appendChild(document.createTextNode(raw.slice(lastIdx, match.index)));
        // Reconstruct the bracketed payload with each digit wrapped. Use a
        // detached span as a parser sandbox, then move children into frag.
        const sandbox = document.createElement('span');
        sandbox.innerHTML = match[0].replace(/(\d+)/g, (m, n) => {
          const idx = parseInt(n, 10);
          return `<a href="#ref-${idx}" class="article-ref-citation">${m}</a>`;
        });
        while (sandbox.firstChild) frag.appendChild(sandbox.firstChild);
        lastIdx = match.index + match[0].length;
        wrappedAny = true;
      }
      if (!wrappedAny) return;
      if (lastIdx < raw.length) frag.appendChild(document.createTextNode(raw.slice(lastIdx)));
      textNode.parentNode.replaceChild(frag, textNode);
      mutated = true;
    });

    // Pass 3 — bidirectional links: each <li id="ref-N"> gets a back-arrow
    // pointing at the in-text citations of that reference, so readers in
    // the References section can jump back to where it was cited.
    // Citations get unique IDs (`cite-ref-N-i`) so multiple citations of
    // the same reference each get their own back-arrow ("↩¹ ↩² ↩³").
    if (refOl) {
      const supDigit = (n) => String(n).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]).join('');
      const citCounts = {};
      visualEl.querySelectorAll('a.article-ref-citation[href^="#ref-"]').forEach((a) => {
        const m = (a.getAttribute('href') || '').match(/^#ref-(\d+)$/);
        if (!m) return;
        const n = Number(m[1]);
        citCounts[n] = (citCounts[n] || 0) + 1;
        a.id = `cite-ref-${n}-${citCounts[n]}`;
      });
      refOl.querySelectorAll(':scope > li').forEach((li, i) => {
        const n = i + 1;
        if (!li.id) li.id = 'ref-' + n;
        // Idempotent re-run: drop stale backlink container first.
        const stale = li.querySelector(':scope > .article-ref-backlinks');
        if (stale) stale.remove();
        const total = citCounts[n] || 0;
        if (!total) return; // ref never cited inline → no back-arrow needed
        const span = document.createElement('span');
        span.className = 'article-ref-backlinks';
        if (total === 1) {
          span.innerHTML = ` <a href="#cite-ref-${n}-1" class="article-ref-backlink" title="Metne dön" aria-label="Metne dön">↩</a>`;
        } else {
          const links = [];
          for (let j = 1; j <= total; j += 1) {
            links.push(`<a href="#cite-ref-${n}-${j}" class="article-ref-backlink" title="Atıf ${j}'e dön" aria-label="Atıf ${j}'e dön">↩${supDigit(j)}</a>`);
          }
          span.innerHTML = ' ' + links.join(' ');
        }
        li.appendChild(span);
        mutated = true;
      });
    }
  }

  if (mutated && typeof markDirty === 'function') markDirty();
  return mutated;
}

// Walk every cross-ref anchor in the editor and refresh its broken/healthy
// state. Called after each insert / upload / Yeni Kaynak so that links that
// pointed at a not-yet-existing target light up correctly the moment the
// target is added.
function _validateCrossRefAnchors(visualEl) {
  if (!visualEl) return { total: 0, broken: 0 };
  const targets = new Set();
  visualEl.querySelectorAll('figure[id^="figure-"], figure[id^="fig-"], [id^="table-"], [id^="tab-"]').forEach((el) => {
    if (el.id) targets.add(el.id);
  });
  // Build the set of valid #ref-N anchors from the ol > li sequence.
  const refOl = visualEl.querySelector('.article-references ol, ol.article-references-ol');
  if (refOl) {
    refOl.querySelectorAll(':scope > li').forEach((li, i) => {
      if (!li.id) li.id = 'ref-' + (i + 1);
      targets.add(li.id);
    });
  }
  // Supplementary targets live in the metadata "Ek Materyal" rows, not the body.
  document.querySelectorAll('.supp-link-row[data-supp-id]').forEach((row) => {
    const id = (row.getAttribute('data-supp-id') || '').trim();
    if (id) targets.add(id);
  });
  let broken = 0, total = 0;
  visualEl.querySelectorAll('a[href^="#figure-"], a[href^="#fig-"], a[href^="#table-"], a[href^="#tab-"], a[href^="#ref-"], a[href^="#supp"]').forEach((a) => {
    total += 1;
    const href = (a.getAttribute('href') || '').replace(/^#/, '');
    if (!href) return;
    const ok = targets.has(href);
    if (ok) {
      a.classList.remove('article-ref-broken');
      a.removeAttribute('data-broken-ref');
      if (a.title === 'Bu hedef henüz makalede yok') a.removeAttribute('title');
    } else {
      broken += 1;
      a.classList.add('article-ref-broken');
      a.setAttribute('data-broken-ref', href);
      if (!a.title) a.title = 'Bu hedef henüz makalede yok';
    }
  });
  return { total, broken };
}

function _scanCrossRefTargets(prefix) {
  // Inspect the visual editor's current DOM to find existing figure / table
  // anchors and the references list. The Galenos-style picker shows the
  // actual figure thumbnail + caption (not just a number) so the editor
  // can pick the right one without remembering which #N maps to what.
  const visual = document.getElementById(prefix + '-visual');
  // First-time visit might find figures without IDs (legacy / mirrored
  // content). Auto-stamp sequential IDs so the rest of the scanner — and
  // every inserted cross-reference — has a real anchor to point at.
  // Also collapse Word's MsoListParagraph references into a real <ol> so
  // the bubble can show a chip per ref and citation anchors work.
  // Finally run the auto-linker so plain-text "Figure 1" / "[2]" mentions
  // turn into clickable refs in the editor preview too.
  _ensureMediaIds(visual);
  _normalizeMsoReferenceList(visual);
  _promoteMsoHeadings(visual);
  _normalizeMediaCaptions(visual);
  _autoLinkInEditor(visual);
  // Re-validate any previously-inserted cross-refs: a link that was
  // "broken" because the target hadn't been created yet should now light
  // up if the user just added the matching figure/table/ref.
  _validateCrossRefAnchors(visual);
  const root = visual ? visual : document.createElement('div');

  // ── Figures: collect num, thumbnail URL, caption snippet ──
  const figMap = new Map();
  root.querySelectorAll('figure[id^="figure-"], figure[id^="fig-"]').forEach((el) => {
    const m = el.id.match(/^(?:figure|fig)-(\d+)$/i);
    if (!m) return;
    const num = Number(m[1]);
    if (figMap.has(num)) return;
    const img = el.querySelector('img');
    // Caption is the first non-empty <p> or <figcaption>; we trim hard since
    // the bubble is constrained.
    let caption = '';
    const capCandidates = el.querySelectorAll(':scope > p, :scope > figcaption');
    for (const c of capCandidates) {
      const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) { caption = t; break; }
    }
    figMap.set(num, {
      num,
      id: el.id,
      thumbnail: img ? img.getAttribute('src') : '',
      caption,
    });
  });

  // ── Tables: collect num + label (no usable thumbnail) ──
  const tabMap = new Map();
  root.querySelectorAll('[id^="table-"], [id^="tab-"]').forEach((el) => {
    if (el.tagName === 'A') return;
    const m = el.id.match(/^(?:table|tab)-(\d+)$/i);
    if (!m) return;
    // Skip phantom wraps with no actual <table>/<img>: they're usually a section
    // heading absorbed into a table-wrap and must NOT inflate the next-table
    // number or appear in the cross-ref picker.
    if (!el.querySelector('table, img')) return;
    const num = Number(m[1]);
    if (tabMap.has(num)) return;
    // Prefer an explicit .table-label, fall back to first <p> with bold text.
    let label = '';
    const lblEl = el.querySelector('.table-label, caption');
    if (lblEl) label = (lblEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (!label) {
      const firstP = el.querySelector(':scope > p');
      if (firstP) label = (firstP.textContent || '').replace(/\s+/g, ' ').trim();
    }
    tabMap.set(num, { num, id: el.id, label });
  });

  // ── References: collect count + per-item text snippet for hover tooltip ──
  const refs = [];
  let refOl = root.querySelector('.article-references ol');
  if (!refOl) {
    // Same broad heading detector as the editor's auto-link/normaliser —
    // a bold <p>REFERENCES</p> counts even when it isn't a real <h*>.
    const h = (typeof _findRefHeading === 'function') ? _findRefHeading(root) : null;
    if (h) {
      let n = h.nextElementSibling;
      while (n && !/^(OL|UL)$/.test(n.tagName)) n = n.nextElementSibling;
      if (n) refOl = n;
    }
  }
  if (refOl) {
    refOl.querySelectorAll(':scope > li').forEach((li, i) => {
      refs.push({
        num: i + 1,
        snippet: (li.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      });
    });
  }

  // ── Merge in disk-uploaded assets that aren't yet in the body ─────────
  // The Dosyalar tab uploads figure/table files to images/articles/<id>/
  // before they're placed in the editor body. The editor should still see
  // them as cross-ref targets (the picker shows them with a "pending" hint
  // and the inserted anchor remains valid — the file already exists at the
  // referenced URL once Otomatik Düzenle places the block). This way the
  // bubble reflects "what's available", not just "what's been placed".
  const cached = (typeof window !== 'undefined') ? window._articleAssets : null;
  if (cached && Array.isArray(cached.figures)) {
    // Resolve the uploaded files into ordered, distinctly-numbered blocks using
    // the SAME logic Otomatik Düzenle uses — so every uploaded figure shows up,
    // in upload order, and the number shown here matches the block that will be
    // placed. (Previously this parsed numbers straight from filenames, which
    // silently dropped unparseable files and collided same-numbered ones — the
    // "only the first figure shows / wrong order" bug.)
    // Basenames of images already rendered by a body figure/table block — so a
    // disk file that is ALREADY placed (possibly under a different number, e.g.
    // via the inline "Yeni Figür" upload which numbers by editor position while
    // the resolver numbers by disk upload order) is never surfaced a second
    // time as a ghost chip.
    const placedSrcs = new Set();
    root.querySelectorAll('figure img, [id^="table-"] img, [id^="tab-"] img').forEach((img) => {
      const base = (img.getAttribute('src') || '').split('/').pop();
      if (base) placedSrcs.add(base.toLowerCase());
    });
    const anyPanelPlaced = (blk) => (blk.panels || []).some((p) => {
      const base = (p.filename || '').toLowerCase();
      return base && placedSrcs.has(base);
    });

    const resolved = _resolveMediaSequence(cached.figures);
    resolved.figure.forEach((blk) => {
      if (figMap.has(blk.num)) return; // already placed in the body (by number)
      if (anyPanelPlaced(blk)) return; // already placed in the body (by file)
      const first = blk.panels[0] || {};
      const captionExtra = blk.panels.length > 1 ? ` (${blk.panels.length} panel)` : '';
      figMap.set(blk.num, {
        num: blk.num,
        id: `figure-${blk.num}`,
        thumbnail: first.url || '',
        caption: (first.filename || '') + captionExtra,
        pending: true,
      });
    });
    resolved.table.forEach((blk) => {
      if (tabMap.has(blk.num)) return;
      if (anyPanelPlaced(blk)) return;
      const first = blk.panels[0] || {};
      const captionExtra = blk.panels.length > 1 ? ` (${blk.panels.length} panel)` : '';
      tabMap.set(blk.num, {
        num: blk.num,
        id: `table-${blk.num}`,
        label: (first.filename || '') + captionExtra,
        pending: true,
      });
    });
  }

  // ── Supplementary materials: sourced from the metadata "Ek Materyal" rows
  //    (.supp-link-row), NOT the body, since the supp section is rendered from
  //    article.supplementary[]. Each row has a stable data-supp-id ("supp1"…);
  //    assign one to id-less rows using the SAME scheme as save (so the anchor
  //    the bubble inserts matches the id persisted on save) and write it back.
  const supp = [];
  const suppRows = document.querySelectorAll('.supp-link-row');
  if (suppRows.length) {
    const usedIds = new Set();
    suppRows.forEach((row) => {
      const ex = (row.getAttribute('data-supp-id') || '').trim();
      if (ex) usedIds.add(ex);
    });
    let counter = 0;
    const nextId = () => {
      while (true) {
        counter += 1;
        const cand = 'supp' + counter;
        if (!usedIds.has(cand)) { usedIds.add(cand); return cand; }
      }
    };
    suppRows.forEach((row) => {
      const label = (row.querySelector('.sl-label')?.value || '').trim();
      const href = (row.querySelector('.sl-href')?.value || '').trim();
      if (!label && !href) return;
      let id = (row.getAttribute('data-supp-id') || '').trim();
      if (!id) { id = nextId(); row.setAttribute('data-supp-id', id); }
      supp.push({ id, label, href });
    });
  }

  return {
    figures: [...figMap.values()].sort((a, b) => a.num - b.num),
    tables: [...tabMap.values()].sort((a, b) => a.num - b.num),
    refs,
    refCount: refs.length,
    supp,
  };
}

function openCrossRefPicker(prefix) {
  // saveCrossRefSelection was already invoked on the button's mousedown.
  const stash = _crossRefSelection[prefix] || null;
  const targets = _scanCrossRefTargets(prefix);
  const selText = stash && stash.text ? stash.text.trim() : '';

  const chip = (kind, num) => `<button type="button" class="cr-pick px-3 py-1.5 rounded border text-sm font-medium" style="background:#fff;border-color:var(--border);color:var(--text-strong);min-width:64px"
    data-kind="${kind}" data-num="${num}">${kind === 'ref' ? num : kind === 'figure' ? 'Figür ' + num : 'Tablo ' + num}</button>`;

  const list = (label, kind, nums) => `
    <div class="mb-4">
      <div class="text-xs font-semibold mb-2" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">${label}</div>
      ${nums.length
        ? `<div class="flex flex-wrap gap-1.5">${nums.map((n) => chip(kind, n)).join('')}</div>`
        : `<p class="text-xs" style="color:var(--text-faint)">Bu makalede henüz ${kind === 'figure' ? 'figür' : kind === 'table' ? 'tablo' : 'kaynak'} yok.</p>`}
      <div class="flex items-center gap-2 mt-2">
        <span class="text-xs" style="color:var(--text-muted)">Veya numara gir:</span>
        <input type="number" min="1" class="input cr-manual" data-kind="${kind}" style="width:80px;font-size:13px;padding:4px 8px" placeholder="N">
        <button type="button" class="cr-manual-go btn btn-secondary btn-sm" data-kind="${kind}">Ekle</button>
      </div>
    </div>`;

  const refList = targets.refCount
    ? list('Kaynakça (#ref-N)', 'ref', Array.from({ length: targets.refCount }, (_, i) => i + 1).slice(0, 25))
    : list('Kaynakça (#ref-N)', 'ref', []);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:580px">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <div>
          <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">Atıf / Bağlantı Ekle</h3>
          <p class="text-xs mt-0.5" style="color:var(--text-muted)">
            ${selText ? `Seçili metin: <strong style="color:var(--text-strong)">"${esc(selText.length > 40 ? selText.slice(0, 40) + '…' : selText)}"</strong> → bağlantıya dönüştürülecek` : 'Metin seçili değil — varsayılan etiket eklenecek ("Figure N" / "Table N" / "[N]")'}
          </p>
        </div>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="px-6 py-4">
        ${list('Figürler', 'figure', targets.figures.map((f) => f.num))}
        ${list('Tablolar', 'table', targets.tables.map((t) => t.num))}
        ${refList}
        <div class="banner banner-info" style="padding:8px 10px;font-size:11.5px;margin-top:8px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <div class="banner-body" style="margin-top:0">Eklenen bağlantılar <code>article-media-ref-link</code> / <code>article-ref-citation</code> sınıfını taşır — sitede teal renkli ve tıklanabilir görünür. Hedef bloğun henüz yok olması sorun değil; sonradan eklediğinizde aynı link çalışmaya başlar.</div>
        </div>
      </div>
      <div class="flex justify-end px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
        <button data-action="cancel" class="btn btn-secondary">Kapat</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('[data-action="cancel"]').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelectorAll('.cr-pick').forEach((btn) => {
    btn.onclick = () => { insertCrossRef(prefix, btn.dataset.kind, Number(btn.dataset.num)); close(); };
  });
  overlay.querySelectorAll('.cr-manual-go').forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.kind;
      const input = overlay.querySelector(`.cr-manual[data-kind="${kind}"]`);
      const num = Number(input && input.value);
      if (!Number.isInteger(num) || num <= 0) {
        toast('Geçerli bir numara girin', 'warning');
        return;
      }
      insertCrossRef(prefix, kind, num);
      close();
    };
  });
  // Enter on manual input → submit
  overlay.querySelectorAll('.cr-manual').forEach((input) => {
    input.onkeydown = (e) => {
      if (e.key === 'Enter') overlay.querySelector(`.cr-manual-go[data-kind="${input.dataset.kind}"]`).click();
    };
  });
}

function insertCrossRef(prefix, kind, num) {
  const stash = _crossRefSelection[prefix];
  const sel = window.getSelection();
  // Restore saved range so insertHTML lands where the cursor was, not at
  // the end of the editor (where focus drifted while the modal was open).
  const visual = document.getElementById(prefix + '-visual');
  if (visual) {
    visual.focus();
    if (stash && stash.range) {
      sel.removeAllRanges();
      sel.addRange(stash.range);
    }
  }
  const selectedText = stash && stash.text ? stash.text : '';
  // Check whether the target actually exists in the editor right now — if
  // not, we tag the anchor as "broken" so the editor sees a visual warning
  // (red dashed underline) and a tooltip rather than a silent dead link.
  let exists = false;
  if (kind === 'supp') {
    // Supplementary targets live in the metadata "Ek Materyal" rows (rendered
    // as a section on the public page), not in the editor body — so validate
    // against the row whose data-supp-id matches.
    exists = !!document.querySelector(`.supp-link-row[data-supp-id="${(window.CSS && CSS.escape) ? CSS.escape(String(num)) : num}"]`);
  } else if (visual) {
    if (kind === 'ref') {
      const refOl = visual.querySelector('.article-references ol, ol.article-references-ol');
      exists = !!(refOl && refOl.querySelectorAll(':scope > li').length >= num);
    } else {
      exists = !!visual.querySelector('#' + kind + '-' + num);
    }
  }
  const brokenAttrs = exists
    ? ''
    : ` data-broken-ref="${kind === 'supp' ? num : kind + '-' + num}" title="Bu hedef henüz makalede yok"`;
  let html;
  if (kind === 'supp') {
    // num is the stable supp id ("supp1"); the public section renders <li id="supp1">.
    const row = document.querySelector(`.supp-link-row[data-supp-id="${(window.CSS && CSS.escape) ? CSS.escape(String(num)) : num}"]`);
    const rowLabel = row ? (row.querySelector('.sl-label')?.value || '').trim() : '';
    const inner = selectedText.trim() || rowLabel || 'Ek Materyal';
    html = `<a href="#${num}" class="article-supp-ref-link${exists ? '' : ' article-ref-broken'}"${brokenAttrs}>${inner}</a>`;
  } else if (kind === 'ref') {
    const inner = selectedText.trim() || String(num);
    html = `<sup><a href="#ref-${num}" class="article-ref-citation${exists ? '' : ' article-ref-broken'}"${brokenAttrs}>${inner}</a></sup>`;
  } else {
    const targetId = kind === 'figure' ? `figure-${num}` : `table-${num}`;
    // Default reference text mirrors the TARGET's visible label so a sub-lettered
    // block ("Table 1a", "Graphic 3") inserts as the full label, not "Table 1".
    let defaultLabel = kind === 'figure' ? `FIG. ${num}` : `Table ${num}`;
    const targetBlock = visual ? visual.querySelector('#' + (kind === 'figure' ? 'figure-' : 'table-') + num) : null;
    const targetManual = _blockManualLabel(targetBlock);
    if (targetManual) defaultLabel = targetManual;
    const inner = selectedText.trim() || defaultLabel;
    html = `<a href="#${targetId}" class="article-media-ref-link${exists ? '' : ' article-ref-broken'}"${brokenAttrs}>${inner}</a>`;
  }
  // execCommand insertHTML replaces the selection (or inserts at cursor).
  // It's the simplest cross-browser way to inject HTML into contenteditable.
  document.execCommand('insertHTML', false, html);
  markDirty();
  _crossRefSelection[prefix] = null;
  hideCrossRefBubble();
}

// ── Floating bubble: Galenos-style inline picker that appears right above
// the user's text selection so they don't have to scroll back up to the
// toolbar. Triggered automatically by selectionchange whenever a non-empty
// selection lives inside a full-text visual editor.

function ensureCrossRefBubble() {
  let bubble = document.getElementById('cr-bubble');
  if (bubble) return bubble;
  bubble = document.createElement('div');
  bubble.id = 'cr-bubble';
  bubble.className = 'cr-bubble hidden';
  // Prevent the bubble from stealing the editor's selection on mousedown —
  // otherwise clicking a chip would collapse the saved range before insert.
  // EXCEPTION: form controls and their labels need their native click flow
  // so manual-input typing and the "Yeni Figür/Tablo" file picker both work.
  // The saved range survives any focus shift because insertCrossRef
  // restores it before insertHTML.
  bubble.addEventListener('mousedown', (e) => {
    if (e.target.closest('input, textarea, select, label')) return;
    e.preventDefault();
  });
  document.body.appendChild(bubble);
  return bubble;
}

// When the cross-ref bubble is opened from the toolbar button (not from a text
// selection) we "pin" it so the selectionchange listener's collapsed-selection
// auto-hide doesn't immediately close it. Any real dismiss clears the pin.
let _crossRefBubblePinned = false;

function hideCrossRefBubble() {
  _crossRefBubblePinned = false;
  const bubble = document.getElementById('cr-bubble');
  if (bubble) {
    bubble.classList.add('hidden');
    bubble.removeAttribute('data-prefix');
  }
}

// ── Manual figure/table label support ──
// The visible caption prefix ("Figure N." / "Table N.") is normally auto-built
// from the integer index. When the editor types a custom label in the dialog
// (e.g. "Figür 2a", "Graphic 3") the block is marked LOCKED via a `data-label`
// attribute and the prefix is rendered verbatim instead of auto-numbered.
//   • data-label PRESENT  ⇒ LOCKED (manual): use the verbatim text, never renumber.
//   • data-label ABSENT   ⇒ AUTO: keep the dynamic "Figure N." / "Table N." behavior.

// Render a verbatim manual label as the bold caption prefix. Strips any trailing
// dots/spaces and adds exactly one "." so "Graphic 3" and "Graphic 3." both yield
// "Graphic 3." (idempotent — no "3.." on re-render).
function _renderLabelPrefix(rawLabel) {
  const t = String(rawLabel || '').trim().replace(/[.\s]+$/, '');
  return t ? `<strong>${esc(t)}.</strong>` : '';
}

// Return a block's locked manual label, or null when the block is AUTO.
function _blockManualLabel(block) {
  if (!block || !block.hasAttribute || !block.hasAttribute('data-label')) return null;
  const v = (block.getAttribute('data-label') || '').trim();
  return v || null;
}

// Find the placed figure/table block in an editor whose image matches a given
// uploaded filename (by basename) — used to auto-sync the full text when a
// figure's label/caption is edited in the Dosyalar pop-up.
function _findMediaBlockByFilename(visual, filename) {
  if (!visual || !filename) return null;
  const base = String(filename).split('/').pop().toLowerCase();
  if (!base) return null;
  const imgs = visual.querySelectorAll(
    'figure[id^="figure-"] img, figure[id^="fig-"] img, ' +
    '.article-table-wrap[id^="table-"] img, .article-table-wrap[id^="tab-"] img'
  );
  for (const img of imgs) {
    const src = (img.getAttribute('src') || '').split('/').pop().toLowerCase();
    if (src === base) return img.closest('figure, .article-table-wrap');
  }
  return null;
}

// Build the "Table N." caption label shared by every table block creator.
// Matches the FIGURE caption convention: ONLY the "Table N." prefix is bold
// (wrapped in <strong>), the caption text after it stays normal weight — and the
// .table-label CSS gives it the same small/grey, sans-serif size+style as figure
// captions. The prefix is plain text (never an anchor) so it isn't a link.
// When `manualLabel` is supplied (a LOCKED table) its verbatim text replaces the
// auto "Table N." prefix; the redundant-prefix strip on `cap` still runs.
function _tableLabelHtml(num, captionInnerHtml, manualLabel) {
  let cap = (captionInnerHtml == null ? '' : String(captionInnerHtml)).trim();
  // Defensively strip any leading "Table N." the caption ALREADY carries so the
  // prefix is never doubled ("Table 1. Table 1. …"). This happens when a caption
  // that already includes its label is passed in — e.g. the user typed it into
  // the popup, or Otomatik Düzenle re-labels a block whose text starts with the
  // number. Tolerates an optional leading <strong>/<b>/<span> wrapper.
  cap = cap.replace(
    /^\s*(?:<(?:strong|b|span)\b[^>]*>\s*)?(?:tables?|tablolar?|tablo|tab)\b\s*\.?\s*\d+[a-z]?\s*[.:\-–—]?\s*(?:<\/(?:strong|b|span)>\s*)?/i,
    ''
  ).trim();
  const manual = (manualLabel != null && String(manualLabel).trim()) ? String(manualLabel).trim().replace(/[.\s]+$/, '') : '';
  // For a LOCKED table also strip a leading copy of the verbatim manual label
  // (e.g. "Çizelge 5.") the caption may already carry — otherwise re-processing
  // a locked block (normalize / refresh) doubles the prefix. The auto "Table N."
  // strip above only matches recognised keywords, not free-form labels.
  if (manual) {
    const reManual = new RegExp(
      '^\\s*(?:<(?:strong|b|span)\\b[^>]*>\\s*)?' +
      manual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\s*[.:\\-–—]?\\s*(?:<\\/(?:strong|b|span)>\\s*)?',
      'i'
    );
    cap = cap.replace(reManual, '').trim();
  }
  const prefix = manual ? _renderLabelPrefix(manual) : `<strong>Table ${num}.</strong>`;
  return cap ? `${prefix} ${cap}` : prefix;
}

function _renderCrossRefBubble(prefix) {
  const bubble = ensureCrossRefBubble();
  const targets = _scanCrossRefTargets(prefix);
  bubble.dataset.prefix = prefix;

  // Thumbnails come from the public-site mount (`/site/`) so relative paths
  // like `images/articles/2849/figure-1.png` resolve through the admin server.
  const thumbUrl = (raw) => {
    if (!raw) return '';
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    return '/site/' + String(raw).replace(/^\//, '');
  };
  const truncate = (s, n) => {
    s = (s || '').replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '…';
  };

  // Figure tile = thumbnail + #N badge + truncated caption (Galenos-style).
  // `pending` items live on disk (Dosyalar tab) but haven't been placed in
  // the body yet — show them with a small "diskte" badge so the editor
  // knows the cross-ref will only become live after Otomatik Düzenle.
  const pendingBadge = '<span class="cr-pending-badge" title="Dosya yüklü ama metne henüz yerleştirilmedi — Otomatik Düzenle çalıştırın">diskte</span>';
  const figTile = (f) => `
    <button type="button" class="cr-fig-tile${f.pending ? ' cr-tile-pending' : ''}" data-kind="figure" data-num="${f.num}"
      title="Figure ${f.num}${f.caption ? ' — ' + esc(f.caption) : ''}${f.pending ? ' (henüz metne yerleştirilmedi)' : ''}">
      <span class="cr-fig-thumb">
        ${f.thumbnail
          ? `<img src="${esc(thumbUrl(f.thumbnail))}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
             <span class="cr-fig-placeholder" style="display:none">no preview</span>`
          : `<span class="cr-fig-placeholder">no preview</span>`}
        <span class="cr-fig-num">#${f.num}</span>
        ${f.pending ? pendingBadge : ''}
      </span>
      <span class="cr-fig-caption">${esc(truncate(f.caption, 36) || 'Figure ' + f.num)}</span>
    </button>`;

  // Tables don't have a usable thumbnail; show an icon + label. In-body tables
  // (not "pending" disk uploads) also get a trash button to delete the block.
  const tabTile = (t) => `
    <div class="cr-tab-row">
      <button type="button" class="cr-tab-tile${t.pending ? ' cr-tile-pending' : ''}" data-kind="table" data-num="${t.num}"
        title="Table ${t.num}${t.label ? ' — ' + esc(t.label) : ''}${t.pending ? ' (henüz metne yerleştirilmedi)' : ''}">
        <span class="cr-tab-icon">▦</span>
        <span class="cr-tab-text">
          <span class="cr-tab-num">Table ${t.num}${t.pending ? ' ' + pendingBadge : ''}</span>
          <span class="cr-tab-label">${esc(truncate(t.label || '—', 56))}</span>
        </span>
      </button>
      ${t.pending ? '' : `<button type="button" class="cr-tab-edit" data-edit-table="${t.num}" title="Bu tabloyu düzenle" aria-label="Tablo ${t.num} düzenle">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button type="button" class="cr-tab-delete" data-delete-table="${t.num}" title="Bu tabloyu sil" aria-label="Tablo ${t.num} sil">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>`}
    </div>`;

  // References get a searchable row list instead of chips — with 50+ refs
  // common in review articles, a chip strip overflows the bubble. Each row
  // shows "N. <text snippet>" and is clickable; the search input filters
  // by number or any text in the citation.
  const refRow = (r) => `
    <button type="button" class="cr-ref-row" data-kind="ref" data-num="${r.num}">
      <span class="cr-ref-row-num">${r.num}.</span>
      <span class="cr-ref-row-text">${esc(r.snippet || 'Reference ' + r.num)}</span>
    </button>`;

  // Header action varies by kind. All three are "+ Yeni X" buttons now,
  // matching the Galenos layout: figure/table upload an image, ref opens
  // a small inline form to type the citation text. The actual file input
  // sits outside the visible button (display:none) and gets click()ed
  // programmatically — wrapping it inside a <label> was unreliable when the
  // bubble's mousedown handler interfered.
  const sectionAction = (manualKind) => {
    if (manualKind === 'figure') {
      return `<button type="button" class="cr-upload-btn" data-upload-kind="figure">+ Yeni Figür</button>
        <input type="file" accept="image/*,.tif,.tiff" data-upload-input="figure" style="display:none">`;
    }
    if (manualKind === 'table') {
      // Tables are tabular data — open a paste dialog (Word/Excel → real
      // <table>) rather than a file picker. Image upload remains available as a
      // fallback inside that dialog.
      return `<button type="button" class="cr-upload-btn" data-insert-table>+ Yeni Tablo</button>`;
    }
    // Supplementary materials are added on the Dosyalar/metadata tab (the
    // "Ek Materyal" rows), so there's no inline "+ Yeni" action here.
    if (manualKind === 'supp') return '';
    // ref → "+ Yeni Kaynak" opens the inline form below.
    return `<button type="button" class="cr-upload-btn" data-newref-toggle>+ Yeni Kaynak</button>`;
  };

  // Supplementary material tile (icon + label) — clicking inserts an in-text
  // cross-reference to the matching #suppN entry in the public Supplementary
  // Materials section, just like figure/table cross-refs.
  const suppTile = (s) => `
    <button type="button" class="cr-tab-tile" data-kind="supp" data-id="${esc(s.id)}"
      title="${esc(s.label || s.id)}${s.href ? ' — ' + esc(s.href) : ''}">
      <span class="cr-tab-icon">📎</span>
      <span class="cr-tab-text">
        <span class="cr-tab-num">${esc(s.label || s.id)}</span>
        <span class="cr-tab-label">${esc(truncate(s.href || '—', 56))}</span>
      </span>
    </button>`;
  const section = (label, body, manualKind) => `
    <div class="cr-bubble-section">
      <div class="cr-bubble-section-head">
        <span class="cr-bubble-label">${label}</span>
        ${sectionAction(manualKind)}
      </div>
      <div class="cr-bubble-section-body">${body}</div>
    </div>`;

  const figBody = targets.figures.length
    ? `<div class="cr-fig-grid">${targets.figures.map(figTile).join('')}</div>`
    : `<span class="cr-bubble-empty">Bu makalede henüz figür yok — manuel numara girip yine de bağlantı verebilirsiniz.</span>`;
  const tabBody = targets.tables.length
    ? `<div class="cr-tab-list">${targets.tables.map(tabTile).join('')}</div>`
    : `<span class="cr-bubble-empty">Bu makalede henüz tablo yok.</span>`;
  const refBody = ((targets.refs || []).length
    ? `<div class="cr-ref-search-wrap">
         <input type="text" class="cr-ref-search" placeholder="Numara veya kaynak metni ara…">
         <span class="cr-ref-count">${targets.refCount} kaynak</span>
       </div>
       <div class="cr-ref-list" data-ref-list>
         ${targets.refs.map(refRow).join('')}
       </div>`
    : `<span class="cr-bubble-empty">Bu makalede henüz kaynakça yok.</span>`) +
    // Inline form for "+ Yeni Kaynak". Hidden by default — toggled by the
    // header button. Lets the editor add a new reference and link to it in
    // one shot, paralleling the figure/table upload UX.
    `<div class="cr-newref-form" data-newref-form hidden>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input type="text" class="cr-newref-doi" placeholder="DOI yapıştırın (ör. 10.4274/...) — otomatik doldur" style="flex:1;min-width:0;font-size:12px;padding:4px 8px;border:1px solid var(--border-soft);border-radius:5px">
        <button type="button" class="cr-newref-fetch" style="font-size:12px;padding:4px 10px;white-space:nowrap">DOI'den getir</button>
      </div>
      <textarea class="cr-newref-text" rows="2" placeholder="Kaynak metni — örn. Smith J, Doe R, et al. Title… JAMA. 2026;1:1-10. (veya yukarıya DOI yapıştırın)"></textarea>
      <div class="cr-newref-actions">
        <button type="button" class="cr-newref-cancel">İptal</button>
        <button type="button" class="cr-newref-go">Ekle</button>
      </div>
    </div>`;

  const suppBody = (targets.supp || []).length
    ? `<div class="cr-tab-list">${targets.supp.map(suppTile).join('')}</div>`
    : `<span class="cr-bubble-empty">Bu makalede ek materyal yok — "Dosyalar / Ek Materyal" bölümünden ekleyin.</span>`;

  bubble.innerHTML =
    '<button type="button" class="cr-bubble-close" aria-label="Kapat" title="Kapat">×</button>' +
    section('Figürler', figBody, 'figure') +
    section('Tablolar', tabBody, 'table') +
    section('Ek Materyal', suppBody, 'supp') +
    section('Kaynaklar', refBody, 'ref');

  // Does the requested target actually exist in the article? Used both for
  // live input hints and post-insert toasts so the operator gets clear
  // feedback ("Figure 3 henüz yok — link şimdi açılmaz, eklendiğinde otomatik
  // çalışır") instead of silent underline.
  const targetExists = (kind, num) => {
    if (!Number.isInteger(num) || num <= 0) return false;
    if (kind === 'figure') return targets.figures.some((f) => f.num === num);
    if (kind === 'table')  return targets.tables.some((t) => t.num === num);
    if (kind === 'ref')    return num <= targets.refCount;
    return false;
  };
  const kindLabel = (kind) => kind === 'figure' ? 'Figure' : kind === 'table' ? 'Table' : 'Reference';
  const announceInsert = (kind, num) => {
    const label = `${kindLabel(kind)} ${num}`;
    if (targetExists(kind, num)) {
      toast(`${label} bağlandı`, 'success');
    } else {
      toast(`${label} henüz makalede yok — link eklendi. ${kindLabel(kind).toLowerCase()} eklenince otomatik çalışacak.`, 'warning');
    }
  };

  // Wire chip + figure-tile + table-tile + manual handlers. Each click reads
  // the saved range out of _crossRefSelection (filled by the selectionchange
  // listener) before execCommand, so the anchor lands exactly on the
  // highlighted text.
  bubble.querySelectorAll('[data-kind][data-num]').forEach((b) => {
    b.onclick = () => {
      const kind = b.dataset.kind;
      const num = Number(b.dataset.num);
      insertCrossRef(prefix, kind, num);
      announceInsert(kind, num);
    };
  });
  // Supplementary tiles use a string id (data-id), not a numeric data-num.
  bubble.querySelectorAll('[data-kind="supp"][data-id]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.id;
      insertCrossRef(prefix, 'supp', id);
      toast('Ek materyal atfı eklendi');
    };
  });
  // Trash button on each in-body table tile → confirm, then remove the block,
  // renumber the rest, and refresh the bubble. Stops propagation so it doesn't
  // also trigger the tile's "insert cross-ref" click.
  // Pencil button on each in-body table tile → open the table dialog in EDIT
  // mode (pre-filled label + caption + current table) so the block can be
  // re-arranged in place. Stops propagation so it doesn't also fire the tile's
  // "insert cross-ref" click.
  bubble.querySelectorAll('[data-edit-table]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const num = Number(b.dataset.editTable);
      _insertInlineTable(prefix, num);
    };
  });
  bubble.querySelectorAll('[data-delete-table]').forEach((b) => {
    b.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const num = Number(b.dataset.deleteTable);
      const visual = document.getElementById(prefix + '-visual');
      const block = visual ? visual.querySelector('#table-' + num) : null;
      if (!block) { toast('Tablo bulunamadı', 'warning'); return; }
      const ok = await confirmAction(`Tablo ${num} silinecek. Emin misiniz?`);
      if (!ok) return;
      block.remove();
      // Renumber remaining tables + their in-text references so there's no gap,
      // then re-validate/auto-link and rebuild the bubble.
      if (typeof _renumberTablesByMention === 'function') _renumberTablesByMention(visual);
      if (typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(visual);
      if (typeof _autoLinkInEditor === 'function') _autoLinkInEditor(visual);
      markDirty();
      _renderCrossRefBubble(prefix);
      toast(`Tablo ${num} silindi`, 'success');
    };
  });
  bubble.querySelectorAll('[data-manual-go]').forEach((b) => {
    b.onclick = () => {
      const kind = b.dataset.manualGo;
      const input = bubble.querySelector(`[data-manual-kind="${kind}"]`);
      const n = Number(input && input.value);
      if (!Number.isInteger(n) || n <= 0) { toast('Geçerli bir numara girin', 'warning'); return; }
      insertCrossRef(prefix, kind, n);
      announceInsert(kind, n);
    };
  });
  // Live input hint — as the user types, indicate whether that number maps
  // to an existing block ("✓ var" green) or not ("⚠ yok" amber). Saves the
  // editor from inserting a dead link by mistake.
  bubble.querySelectorAll('[data-manual-kind]').forEach((input) => {
    const updateHint = () => {
      const kind = input.dataset.manualKind;
      const hint = bubble.querySelector(`[data-hint-kind="${kind}"]`);
      if (!hint) return;
      const n = Number(input.value);
      if (!input.value || !Number.isInteger(n) || n <= 0) {
        hint.textContent = '';
        hint.className = 'cr-manual-hint';
        return;
      }
      if (targetExists(kind, n)) {
        hint.textContent = '✓ var';
        hint.className = 'cr-manual-hint is-ok';
      } else {
        hint.textContent = '⚠ yok';
        hint.className = 'cr-manual-hint is-warn';
      }
    };
    input.oninput = updateHint;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        bubble.querySelector(`[data-manual-go="${input.dataset.manualKind}"]`).click();
      }
    };
  });
  // Reference search filter — hides rows whose number or text doesn't
  // match. Lets the editor find ref #57 by typing "Yopes" or "2024" or
  // "Circ Cardiovasc Imaging" instead of scrolling through 76 entries.
  const refSearch = bubble.querySelector('.cr-ref-search');
  const refList = bubble.querySelector('[data-ref-list]');
  if (refSearch && refList) {
    refSearch.oninput = () => {
      const q = (refSearch.value || '').toLowerCase().trim();
      let shown = 0;
      refList.querySelectorAll('.cr-ref-row').forEach((row) => {
        if (!q) { row.style.display = ''; shown++; return; }
        const num = row.dataset.num;
        const text = (row.textContent || '').toLowerCase();
        const match = num === q || text.includes(q);
        row.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      // Hint when nothing matches.
      let empty = refList.querySelector('.cr-ref-empty');
      if (!shown && !empty) {
        empty = document.createElement('div');
        empty.className = 'cr-ref-empty cr-bubble-empty';
        empty.textContent = 'Eşleşen kaynak yok';
        refList.appendChild(empty);
      } else if (shown && empty) {
        empty.remove();
      }
    };
  }

  // "Yeni Figür / Yeni Tablo" buttons → trigger the hidden <input type="file">
  // programmatically. We avoid the <label><input></label> pattern because
  // the bubble's mousedown preventDefault sometimes raced the label click
  // and the file picker simply never opened.
  bubble.querySelectorAll('[data-upload-kind]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const kind = btn.dataset.uploadKind;
      const fileInput = bubble.querySelector(`[data-upload-input="${kind}"]`);
      if (fileInput) fileInput.click();
    };
  });
  bubble.querySelectorAll('[data-upload-input]').forEach((input) => {
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      _uploadInlineMedia(prefix, input.dataset.uploadInput, file);
      input.value = ''; // allow re-picking the same file
    };
  });

  // "+ Yeni Tablo" → paste-a-table dialog (not a file picker).
  const insertTableBtn = bubble.querySelector('[data-insert-table]');
  if (insertTableBtn) {
    insertTableBtn.onclick = (e) => {
      e.preventDefault();
      _insertInlineTable(prefix);
    };
  }

  // "+ Yeni Kaynak" — toggles the inline form that captures a single
  // reference's text + appends it to the article's <ol> + inserts ref-N.
  const newRefBtn = bubble.querySelector('[data-newref-toggle]');
  const newRefForm = bubble.querySelector('[data-newref-form]');
  if (newRefBtn && newRefForm) {
    newRefBtn.onclick = () => {
      newRefForm.hidden = !newRefForm.hidden;
      if (!newRefForm.hidden) {
        const ta = newRefForm.querySelector('.cr-newref-text');
        if (ta) ta.focus();
      }
    };
    newRefForm.querySelector('.cr-newref-cancel').onclick = () => {
      newRefForm.hidden = true;
      newRefForm.querySelector('.cr-newref-text').value = '';
    };
    newRefForm.querySelector('.cr-newref-go').onclick = () => {
      const ta = newRefForm.querySelector('.cr-newref-text');
      const text = (ta.value || '').trim();
      if (!text) { toast('Kaynak metni boş olamaz', 'warning'); return; }
      _addInlineReference(prefix, text);
      ta.value = '';
      newRefForm.hidden = true;
    };
    newRefForm.querySelector('.cr-newref-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        newRefForm.querySelector('.cr-newref-go').click();
      }
    });
    // DOI → auto-fill the reference text from Crossref.
    const fetchBtn = newRefForm.querySelector('.cr-newref-fetch');
    const doiInput = newRefForm.querySelector('.cr-newref-doi');
    if (fetchBtn && doiInput) {
      const doFetch = async () => {
        const doi = (doiInput.value || '').trim();
        if (!doi) { toast('Önce DOI girin', 'warning'); return; }
        fetchBtn.disabled = true; const old = fetchBtn.textContent; fetchBtn.textContent = '...';
        try {
          const cite = await _fetchCrossrefCitation(doi);
          newRefForm.querySelector('.cr-newref-text').value = cite;
          toast('Kaynak DOI\'den dolduruldu — kontrol edip "Ekle" deyin');
        } catch (err) {
          toast('DOI bulunamadı: ' + (err.message || err), 'error');
        } finally {
          fetchBtn.disabled = false; fetchBtn.textContent = old;
        }
      };
      fetchBtn.onclick = doFetch;
      doiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doFetch(); } });
    }
  }

  bubble.querySelector('.cr-bubble-close').onclick = hideCrossRefBubble;
}

// Fetch a work's metadata from Crossref (CORS-enabled public API) and format a
// Vancouver-style reference string. Used by the "+ Yeni Kaynak" DOI auto-fill.
async function _fetchCrossrefCitation(rawDoi) {
  const doi = String(rawDoi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  if (!/^10\.\d{3,}\//.test(doi)) throw new Error('Geçersiz DOI biçimi');
  const res = await fetch('https://api.crossref.org/works/' + encodeURIComponent(doi), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const w = data && data.message;
  if (!w) throw new Error('Boş yanıt');
  return _formatVancouver(w, doi);
}

// Format a Crossref work object into a Vancouver-style citation.
function _formatVancouver(w, doi) {
  const authorsArr = Array.isArray(w.author) ? w.author : [];
  const names = authorsArr.map((a) => {
    const family = (a.family || '').trim();
    const given = (a.given || '').trim();
    if (!family) return (a.name || '').trim();
    const initials = given.split(/[\s.\-]+/).filter(Boolean).map((p) => p[0].toUpperCase()).join('');
    return initials ? `${family} ${initials}` : family;
  }).filter(Boolean);
  let authorStr = '';
  if (names.length === 0) authorStr = '';
  else if (names.length <= 6) authorStr = names.join(', ');
  else authorStr = names.slice(0, 6).join(', ') + ', et al';

  const title = (Array.isArray(w.title) && w.title[0] ? w.title[0] : '').replace(/\s+/g, ' ').trim();
  const journal = (Array.isArray(w['container-title']) && w['container-title'][0]) ? w['container-title'][0] : (w.publisher || '');
  const dateParts = (w.issued && w.issued['date-parts'] && w.issued['date-parts'][0]) || [];
  const year = dateParts[0] || '';
  const vol = w.volume || '';
  const issue = w.issue || '';
  const pages = w.page || '';

  let out = '';
  if (authorStr) out += authorStr + '. ';
  if (title) out += title.replace(/\.+$/, '') + '. ';
  if (journal) out += journal + '. ';
  if (year) {
    out += year;
    if (vol) out += ';' + vol;
    if (issue) out += '(' + issue + ')';
    if (pages) out += ':' + pages;
    out += '. ';
  }
  out += 'doi:' + doi + '.';
  return out.replace(/\s+/g, ' ').trim();
}

// Append a reference to the article's <ol> of references, creating the
// <div class="article-references"><h3>References</h3><ol> wrapper if it
// doesn't exist yet. Then insert a <sup><a href="#ref-N"> cross-reference
// at the saved selection.
function _addInlineReference(prefix, text) {
  const visual = document.getElementById(prefix + '-visual');
  if (!visual) return;
  // Find or create the references list.
  let refsDiv = visual.querySelector('.article-references');
  let ol;
  if (refsDiv) {
    ol = refsDiv.querySelector('ol');
    if (!ol) {
      ol = document.createElement('ol');
      refsDiv.appendChild(ol);
    }
  } else {
    refsDiv = document.createElement('div');
    refsDiv.className = 'article-references';
    refsDiv.innerHTML = '<h3>References</h3><ol></ol>';
    visual.appendChild(refsDiv);
    ol = refsDiv.querySelector('ol');
  }
  const nextNum = ol.querySelectorAll(':scope > li').length + 1;
  const li = document.createElement('li');
  li.id = `ref-${nextNum}`;
  li.textContent = text;
  ol.appendChild(li);
  // Strip any inline font from existing (Word-pasted) items so the whole list —
  // old refs and this new plain one — renders in one fixed list font.
  _normalizeReferenceFonts(ol);

  // Insert cross-ref at saved selection.
  insertCrossRef(prefix, 'ref', nextNum);
  markDirty();
  toast(`Kaynak ${nextNum} eklendi ve bağlandı`, 'success');
  // Newly-added ref can heal any previously broken citation anchors.
  _validateCrossRefAnchors(visual);
  // Re-link bare <sup>N</sup> in the body now that ref-N exists as a target.
  _autoLinkInEditor(visual);
  _renderCrossRefBubble(prefix);
}

// Parse a figure/table number out of a media filename. Handles BMJ-style
// "BalkanMedJ-43-4-196-figure-1.png", manuscript-style "297-308-f1.png",
// generic "figure-1.png" / "Fig_01.jpg" / "fig1.tiff", and "table-2.png".
// Returns the integer or null when nothing matches.
function _extractMediaNum(filename, kind) {
  // Returns `{ num, panel }` so `figure-1.png`, `figure-1a.png`, `t2b.png`,
  // `BalkanMedJ-43-2-figure-3B.png` all carry their panel letter forward.
  // Sub-panels (1a, 1b, 1c) belong to the same parent figure-N block — the
  // auto-arrange flow stacks them as labelled panels under one <figure>.
  if (!filename) return null;
  const lower = String(filename).toLowerCase().replace(/\.[a-z0-9]+$/, '');
  // The trailing (?![\da-z]) guard makes sure we don't half-match "figure-12"
  // out of "figure-12abc"; we want a clean "N" or "N<letter>" capture.
  if (kind === 'table') {
    let m = lower.match(/(?:^|[-_])table[-_]?(\d+)([a-z])?(?![\da-z])/);
    if (m) return { num: Number(m[1]), panel: m[2] || null };
    m = lower.match(/(?:^|[-_])t[-_]?(\d+)([a-z])?(?:$|[-_])/);
    if (m) return { num: Number(m[1]), panel: m[2] || null };
    return null;
  }
  let m = lower.match(/(?:^|[-_])figure[-_]?(\d+)([a-z])?(?![\da-z])/);
  if (m) return { num: Number(m[1]), panel: m[2] || null };
  m = lower.match(/(?:^|[-_])fig[-_]?(\d+)([a-z])?(?![\da-z])/);
  if (m) return { num: Number(m[1]), panel: m[2] || null };
  m = lower.match(/(?:^|[-_])f[-_]?(\d+)([a-z])?(?:$|[-_])/);
  if (m) return { num: Number(m[1]), panel: m[2] || null };
  return null;
}

// Resolve an uploaded asset list (the `figures` array from
// GET /media/article/:id/assets, already in upload order) into ORDERED blocks
// with STABLE, DISTINCT numbers — one block per figure / table, panels (1a,1b)
// collapsed onto their parent number.
//
// Numbering rule (the heart of the fix): a filename-encoded number is honoured
// only when it's unambiguous (exactly one block claims it). Files with no
// parseable number, or whose number collides with another file's, fall back to
// the next free integer assigned in upload order. This guarantees:
//   • every uploaded figure shows up (no silent drop on collision),
//   • the order matches the order they were uploaded / appear in Dosyalar,
//   • well-named JATS sets (figure-1, figure-2, …) keep their exact numbers.
//
// BOTH the cross-ref picker and Otomatik Düzenle call this, so the #figure-N
// anchor the picker inserts always points at the block auto-arrange builds.
// Files that live in the article images dir but are NOT article figures —
// covers, logos, test artifacts. They're excluded ONLY when their name doesn't
// also carry a figure/table number, so a legitimately-named figure is never
// dropped (e.g. "covering-membrane" won't match, "cover.jpg" will).
const _NON_FIGURE_FILE = /^(cover|kapak|logo|banner|favicon|thumbnail|thumb|inline-upload-test)\b/i;

function _resolveMediaSequence(figures) {
  const out = { figure: [], table: [] };
  if (!Array.isArray(figures)) return out;

  const items = [];
  figures.forEach((f, idx) => {
    const name = String(f.filename || '');
    const isTable = /(?:^|[-_])tab(?:le)?[-_]?\d+/i.test(name);
    const kind = isTable ? 'table' : 'figure';
    const meta = _extractMediaNum(name, kind) || {};
    const parsedNum = Number.isFinite(meta.num) ? meta.num : null;
    // Unparseable AND on the non-figure denylist → drop ONLY if it was never
    // curated as a figure. Every file the editor uploads via Dosyalar gets an
    // upload-order index in _figure-meta, so a deliberately uploaded "cover.jpg"
    // (order set) still shows in the picker / auto-arrange; a stray cover/logo
    // that merely sits in the images dir (no order) is still excluded.
    const curated = f && Number.isFinite(f.order);
    if (parsedNum == null && _NON_FIGURE_FILE.test(name) && !curated) return;
    items.push({ idx, kind, parsedNum, panel: meta.panel || null, f });
  });

  for (const kind of ['figure', 'table']) {
    const group = items.filter((it) => it.kind === kind);

    // Group into parent blocks. Files that share a parsed number are panels of
    // the same block ONLY when they occupy different panel slots (1a, 1b, …).
    // Two files claiming the same number AND the same slot (e.g. both bare
    // "figure-1" with no panel letter, or "fig1.png" + "fig1_alt.png") cannot
    // be panels of one figure — that's a collision, so the second one spills
    // out as its own block and gets the next free number. Unparseable files
    // each get their own block too (keyed by idx so they never merge).
    const byNum = new Map();      // parsed number → parent block
    const orphans = [];           // own-block files (unparseable OR collided)
    for (const it of group) {
      if (it.parsedNum == null) { orphans.push(it); continue; }
      let parent = byNum.get(it.parsedNum);
      if (!parent) {
        parent = { parsedNum: it.parsedNum, firstIdx: it.idx, panels: [], slots: new Set() };
        byNum.set(it.parsedNum, parent);
      }
      const slot = it.panel || '∅';
      if (parent.slots.has(slot)) { orphans.push(it); continue; } // collision → own block
      parent.slots.add(slot);
      parent.panels.push(it);
    }
    for (const it of orphans) {
      byNum.set(`u${it.idx}`, { parsedNum: null, firstIdx: it.idx, panels: [it], slots: new Set() });
    }

    const parents = [...byNum.values()].sort((a, b) => a.firstIdx - b.firstIdx);

    // How many parent blocks claim each parsed number — a number is only
    // trustworthy if exactly one block claims it.
    const claims = {};
    parents.forEach((p) => { if (p.parsedNum != null) claims[p.parsedNum] = (claims[p.parsedNum] || 0) + 1; });

    const used = new Set();
    parents.forEach((p) => {
      if (p.parsedNum != null && claims[p.parsedNum] === 1) {
        p.finalNum = p.parsedNum;
        used.add(p.parsedNum);
      }
    });
    let next = 1;
    parents.forEach((p) => {
      if (p.finalNum != null) return;
      while (used.has(next)) next += 1;
      p.finalNum = next;
      used.add(next);
    });

    out[kind] = parents
      .map((p) => ({
        num: p.finalNum,
        firstIdx: p.firstIdx,
        panels: p.panels.map((it) => ({
          panel: it.panel,
          url: it.f.url,
          filename: it.f.filename,
          caption: it.f.caption || '',
          source: it.f.source || '',
          size: it.f.size || 'auto',
          label: it.f.label || '',
        })),
      }))
      .sort((a, b) => a.num - b.num);
  }
  return out;
}

// Build a map  num → first paragraph element  that mentions a given figure
// or table. Crucially it understands multi-number sequences like
// "Figures 2, 3 and 4" / "Figs. 2-4" / "Şekiller 1 ve 2" — every number
// inside a sequence is treated as mentioned by the SAME paragraph, which is
// the natural reading layout. Ranges ("2-4") are expanded to fill the gap.
function _buildMentionMap(visualEl, kind) {
  const map = new Map();
  if (!visualEl) return map;
  const wordAlt = kind === 'table'
    ? 'tables?|tablolar?|tablo'
    : 'figures?|figs?\\.?|şekiller?|şekil|sekil';
  const seqPattern = new RegExp(
    `(?<![A-Za-z])(${wordAlt})\\s+((?:\\d+[a-z]?)(?:\\s*(?:,|-|–|\\sand\\s|\\sve\\s)\\s*\\d+[a-z]?)*)`,
    'gi'
  );
  const candidates = visualEl.querySelectorAll('p, li, blockquote, td, h1, h2, h3, h4');
  for (const el of candidates) {
    if (el.closest('.article-references, .article-acknowledgments, .article-footnotes, .article-supplementary, .article-figure, .article-table-wrap, figure')) continue;
    const text = el.textContent || '';
    let m;
    seqPattern.lastIndex = 0;
    while ((m = seqPattern.exec(text)) !== null) {
      const seq = m[2];
      // 1) Each explicit number in the sequence gets mapped here.
      const explicit = (seq.match(/\d+/g) || []).map(Number);
      for (const n of explicit) {
        if (!map.has(n)) map.set(n, el);
      }
      // 2) A bare "A-B" / "A–B" range expands the gap: "Figs. 2-4" → 2,3,4.
      const rangeMatch = seq.match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
      if (rangeMatch) {
        const lo = Number(rangeMatch[1]);
        const hi = Number(rangeMatch[2]);
        if (lo <= hi && hi - lo < 30) {
          for (let i = lo + 1; i < hi; i += 1) if (!map.has(i)) map.set(i, el);
        }
      }
    }
  }
  return map;
}

// Build a fresh figure / table block matching the modern JATS structure,
// styled the same way the public site renders. Reused by Yeni Figür/Tablo
// upload (which produces a single block) and the auto-arrange flow (which
// places many blocks at once).
function _buildMediaBlock(kind, num, panelsOrUrl) {
  // Accepts either a single URL string (legacy single-image block) or an
  // array of `{ panel, url, caption?, source? }` so multi-panel figures
  // (1A, 1B, 1C) render as one labelled <figure> with stacked <img>s.
  let panels;
  if (typeof panelsOrUrl === 'string' || panelsOrUrl == null) {
    panels = [{ panel: null, url: panelsOrUrl || '' }];
  } else if (Array.isArray(panelsOrUrl)) {
    panels = panelsOrUrl.length ? panelsOrUrl : [{ panel: null, url: '' }];
  } else {
    panels = [{ panel: null, url: '' }];
  }
  const isMulti = panels.length > 1 || (panels[0] && panels[0].panel);
  const panelHtml = (kind, num, p, i) => {
    const letter = (p.panel || String.fromCharCode(97 + i)).toUpperCase();
    const safeUrl = String(p.url || '').replace(/^\//, '');
    const altLabel = kind === 'figure' ? `Figure ${num}${letter}` : `Table ${num}${letter}`;
    return `<div class="article-${kind}-panel" data-panel="${letter}">` +
           `<img src="${esc(safeUrl)}" alt="${altLabel}" loading="lazy">` +
           `<span class="article-${kind}-panel-label">(${letter})</span>` +
           `</div>`;
  };

  // Caption resolution: prefer the no-panel entry (main file); fall back to
  // first entry that has any caption text. Source is the legacy storage field,
  // merged into the caption for forward-compat with older saved metadata.
  const pickCaption = (arr) => {
    const noPanel = arr.find((p) => !p.panel && (p.caption || p.source));
    const pick    = noPanel || arr.find((p) => p.caption || p.source);
    if (!pick) return '';
    const c = (pick.caption || '').trim();
    const s = (pick.source  || '').trim();
    return c && s ? `${c} ${s}` : (c || s);
  };
  const rawCap = pickCaption(panels);
  // Strip a leading "Figure N." / "Şekil N." / "Tablo N." so we don't double
  // up next to the auto-added "FIG. N." / "TABLE N." label.
  const stripped = rawCap.replace(new RegExp(`^\\s*(?:figure|fig\\.?|şekil|sekil|tablo|table)\\s*${num}[a-z]?\\s*[\\.:\\-—–]?\\s*`, 'i'), '').trim();
  const captionInner = _captionToHtml(stripped);

  // Manual label (LOCKED): the editor typed a custom prefix in the dialog. When
  // present it is rendered verbatim and the block is marked with data-label so
  // auto-arrange / normalization never renumber or re-prefix it.
  const manualPick = panels.find((p) => p.label != null && String(p.label).trim() !== '');
  const manualLabel = manualPick ? String(manualPick.label).trim() : null;

  // Size: prefer the entry that has a non-default size; fall back to 'medium'.
  // Multi-panel figures always go full width regardless of stored hint.
  const sizePick = panels.find((p) => p.size && p.size !== 'auto') || panels[0];
  let blockSize = (sizePick && sizePick.size) || 'medium';
  if (blockSize === 'auto') blockSize = 'medium';
  if (isMulti) blockSize = 'large';

  if (kind === 'figure') {
    const fig = document.createElement('figure');
    fig.id = `figure-${num}`;
    fig.className = 'article-figure';
    fig.setAttribute('data-size', blockSize);
    if (manualLabel) fig.setAttribute('data-label', manualLabel.replace(/[.\s]+$/, ''));
    else fig.removeAttribute('data-label');
    // AUTO label renders as "FIG. N." — matching the Etiket field default
    // ("FIG. N"). The caption is locked (contenteditable="false") so the label
    // can't be edited inline; all changes go through the dialogs.
    const figPrefix = manualLabel ? _renderLabelPrefix(manualLabel) : `<strong>FIG. ${num}.</strong>`;
    const captionP = `<p contenteditable="false">${figPrefix} ${captionInner}</p>`;
    if (!isMulti) {
      const safeUrl = String(panels[0].url || '').replace(/^\//, '');
      fig.innerHTML =
        `<img src="${esc(safeUrl)}" alt="Figure ${num}" loading="lazy">` + captionP;
    } else {
      fig.innerHTML =
        panels.map((p, i) => panelHtml('figure', num, p, i)).join('') + captionP;
    }
    return fig;
  }
  const wrap = document.createElement('div');
  wrap.id = `table-${num}`;
  wrap.className = 'article-table-wrap';
  wrap.setAttribute('data-size', blockSize);
  if (manualLabel) wrap.setAttribute('data-label', manualLabel.replace(/[.\s]+$/, ''));
  else wrap.removeAttribute('data-label');
  const tableCaption = `<p class="table-label" contenteditable="false">${_tableLabelHtml(num, captionInner, manualLabel)}</p>`;
  if (!isMulti) {
    const safeUrl = String(panels[0].url || '').replace(/^\//, '');
    wrap.innerHTML = tableCaption + `<img src="${esc(safeUrl)}" alt="Table ${num}" loading="lazy">`;
  } else {
    wrap.innerHTML = tableCaption + panels.map((p, i) => panelHtml('table', num, p, i)).join('');
  }
  return wrap;
}

// Update an existing figure/table block's caption in-place without replacing
// the whole block (so images, sub-panels, IDs, and document position are kept).
// Used by Otomatik Düzenle when re-running over a full text where the block
// already exists but its caption metadata has been edited.
function _updateExistingMediaCaption(block, kind, num, captionInnerHtml, size) {
  // Refresh data-size attribute too so users can change a figure's display
  // size via the dialog → "Otomatik Düzenle" path without re-inserting.
  if (size && size !== 'auto') block.setAttribute('data-size', size);
  // LOCKED label: render the verbatim manual prefix instead of "FIG. N."/"Table N.".
  const manual = _blockManualLabel(block);
  if (kind === 'figure') {
    // AUTO label renders as "FIG. N." (matches the Etiket field default).
    const figPrefix = manual ? _renderLabelPrefix(manual) : `<strong>FIG. ${num}.</strong>`;
    // Modern dialog-inserted figures use <figcaption>
    const fc = block.querySelector(':scope > figcaption');
    if (fc) {
      fc.setAttribute('contenteditable', 'false');
      fc.innerHTML = captionInnerHtml
        ? `${figPrefix} ${captionInnerHtml}`
        : (manual ? _renderLabelPrefix(manual) : `<strong>FIG. ${num}</strong>`);
      return true;
    }
    // Auto-arranged figures use <p><strong>FIG. N.</strong>...</p>. A LOCKED
    // figure's prefix is a free-form word ("Graphic 3") that won't match the
    // FIG/Figure keyword test, so for manual blocks accept any <p> that simply
    // begins with a <strong>/<b> label — otherwise we'd append a duplicate.
    const ps = block.querySelectorAll(':scope > p');
    for (const p of ps) {
      const strongEl = p.querySelector(':scope > strong, :scope > b');
      const t = (strongEl?.textContent || '').trim();
      const leadsWithStrong = !!(p.firstElementChild && /^(?:STRONG|B)$/.test(p.firstElementChild.tagName));
      if ((manual && leadsWithStrong) || /^(?:FIG\.?|Figure|Şekil|Sekil)\b/i.test(t)) {
        p.setAttribute('contenteditable', 'false');
        p.innerHTML = `${figPrefix} ${captionInnerHtml}`;
        return true;
      }
    }
    // No caption element found — append one
    const newP = document.createElement('p');
    newP.setAttribute('contenteditable', 'false');
    newP.innerHTML = `${figPrefix} ${captionInnerHtml}`;
    block.appendChild(newP);
    return true;
  }

  // Tables
  const labelP = block.querySelector(':scope > p.table-label');
  if (labelP) {
    labelP.setAttribute('contenteditable', 'false');
    labelP.innerHTML = _tableLabelHtml(num, captionInnerHtml, manual);
    return true;
  }
  const ps = block.querySelectorAll(':scope > p');
  for (const p of ps) {
    const t = (p.querySelector(':scope > strong, :scope > b')?.textContent || '').trim();
    if (/^(?:TABLE|Tablo|Tab\.?)\b/i.test(t)) {
      p.classList.add('table-label');
      p.setAttribute('contenteditable', 'false');
      p.innerHTML = _tableLabelHtml(num, captionInnerHtml, manual);
      return true;
    }
  }
  const newP = document.createElement('p');
  newP.className = 'table-label';
  newP.setAttribute('contenteditable', 'false');
  newP.innerHTML = _tableLabelHtml(num, captionInnerHtml, manual);
  block.insertBefore(newP, block.firstChild);
  return true;
}

// Refresh a table block's label to the canonical bold "Table N." form, keeping
// any caption text (and citation links) after the prefix. Normalises legacy
// "TABLE N." all-caps labels too.
function _refreshTableLabel(block, num) {
  const labelP = block.querySelector(':scope > p.table-label')
    || Array.from(block.querySelectorAll(':scope > p')).find((p) => {
      const t = (p.querySelector(':scope > strong, :scope > b')?.textContent || p.textContent || '').trim();
      return /^(?:TABLE|Tablo|Tab\.?)\b/i.test(t);
    });
  if (!labelP) return;
  labelP.classList.add('table-label');
  // Strip existing <strong> wrappers (whole label is re-bolded) then drop the
  // leading "Table/TABLE/Tablo N." prefix, preserving the caption HTML.
  let inner = labelP.innerHTML.replace(/<\/?strong>/gi, '').trim();
  inner = inner.replace(/^\s*(?:tables?|tablolar?|tablo|tab\.?)\s*\d+[a-z]?\s*[.:\-–—]?\s*/i, '').trim();
  // LOCKED tables keep their verbatim manual prefix even as the integer id renumbers.
  labelP.innerHTML = _tableLabelHtml(num, inner, _blockManualLabel(block));
}

// Unwrap any figure/table self-reference links (<a href="#table-N">…</a>) inside
// a caption fragment, keeping their inner text. Captions must never link to
// themselves — that's what makes "Table 1" render teal + underlined like a
// cross-reference when it's actually the title. Returns cleaned innerHTML.
function _stripSelfMediaLinks(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html == null ? '' : String(html);
  tmp.querySelectorAll('a[href^="#table-"], a[href^="#tab-"], a[href^="#figure-"], a[href^="#fig-"]').forEach((a) => {
    while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a);
    a.remove();
  });
  return tmp.innerHTML;
}

// Normalise table/figure captions so the "Table N." / "Figure N." title renders
// as plain bold body-sized text — never an oversized <h3> heading, never a
// self-referential teal link. Handles two cases per media block:
//   1) An adjacent heading/paragraph caption (e.g. a Word-pasted "Table 1. …"
//      that slipped through as <h3> or <p>) sitting right before/after the block
//      → adopted INTO the block as the canonical label.
//   2) A caption already inside the block that still carries a self-link or a
//      non-canonical prefix → de-linked and re-bolded.
// Tables become <p class="table-label"><strong>Table N. …</strong></p>; figures
// keep their small/grey <figcaption> design, just de-linked + de-headinged.
// Idempotent: re-running finds nothing left to change.
function _normalizeMediaCaptions(visualEl) {
  if (!visualEl) return false;
  let mutated = false;
  const blocks = visualEl.querySelectorAll(
    '.article-table-wrap[id^="table-"], figure[id^="figure-"], figure[id^="fig-"]'
  );
  blocks.forEach((block) => {
    const m = block.id.match(/^(table|tab|figure|fig)-(\d+)$/i);
    if (!m) return;
    const isTable = /^(table|tab)$/i.test(m[1]);
    const num = Number(m[2]);
    const labelRe = isTable
      ? /^\s*(?:tables?|tablolar?|tablo|tab)\b\s*\.?\s*0*(\d+)\b/i
      : /^\s*(?:figures?|figs?|şekiller?|şekil|sekil|fig)\b\s*\.?\s*0*(\d+)\b/i;
    const prefixRe = isTable
      ? /^\s*(?:tables?|tablolar?|tablo|tab)\b\s*\.?\s*\d+[a-z]?\s*[.:\-–—]?\s*/i
      : /^\s*(?:figures?|figs?|şekiller?|şekil|sekil|fig)\b\s*\.?\s*\d+[a-z]?\s*[.:\-–—]?\s*/i;

    // 0) Heal a PHANTOM media wrap: a table-wrap with no <table>/<img> (or a
    //    figure with no <img>) is not a real media block — it's typically a
    //    section heading that got wrapped by a botched paste/normalise. Such a
    //    phantom shows up as a bogus "Table N. <heading>" (the labeller prepends
    //    the number to the heading text) AND inflates the next real table to N+1.
    //    Unwrap it: restore the inner text as a heading/paragraph before the wrap
    //    and drop the empty wrap so numbering and headings are correct again.
    const hasRealContent = isTable
      ? !!block.querySelector('table, img')
      : !!block.querySelector('img');
    if (!hasRealContent) {
      const cap = block.querySelector(
        ':scope > p.table-label, :scope > figcaption, :scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6'
      );
      let html = cap ? _stripSelfMediaLinks(cap.innerHTML) : '';
      html = html.replace(/<\/?(?:strong|b)>/gi, '').replace(prefixRe, '').trim();
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const text = (tmp.textContent || '').trim();
      if (text) {
        // A single bold/large inline wrapper (the inlined styles of a former
        // <h3>) means it was a heading — restore it as one; else a paragraph.
        const onlyChild = (tmp.children.length === 1 && tmp.childNodes.length === 1) ? tmp.children[0] : null;
        const looksHeading = !!onlyChild && /font-weight:\s*(?:[6-9]\d\d|bold)/i.test(onlyChild.getAttribute('style') || '');
        const restored = document.createElement(looksHeading ? 'h3' : 'p');
        restored.textContent = text;
        block.parentNode.insertBefore(restored, block);
      }
      block.remove();
      mutated = true;
      return;
    }

    // 1) Adopt a heading/paragraph caption sitting next to the block — TOLERATING
    //    Word's empty filler elements (<p>&nbsp;</p>, <br>, <o:p>) that paste
    //    between a caption line and its table. Without this tolerance the caption
    //    stays a stray <p> outside the skip-zone, and _autoLinkInEditor turns its
    //    "Table N" into a self-referential teal/underlined link (and an oversized
    //    <h3> if it was promoted). We scan up to 3 filler hops in each direction.
    const isFiller = (el) => !!el && (
      (el.tagName === 'P' && !(el.textContent || '').replace(/ /g, ' ').trim() && !el.querySelector('img,table')) ||
      el.tagName === 'BR' ||
      (el.tagName && el.tagName.toLowerCase() === 'o:p')
    );
    const findCaptionSibling = (dir) => {
      const fillers = [];
      let el = dir === 'prev' ? block.previousElementSibling : block.nextElementSibling;
      let hops = 0;
      while (el && isFiller(el) && hops < 3) {
        fillers.push(el);
        el = dir === 'prev' ? el.previousElementSibling : el.nextElementSibling;
        hops += 1;
      }
      if (!el || !/^(H[1-6]|P)$/.test(el.tagName)) return null;
      if (el.classList && el.classList.contains('table-label')) return null;
      if (el.closest && el.closest(
        '.article-references, .article-acknowledgments, .article-footnotes, .article-supplementary'
      )) return null;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const mm = t.match(labelRe);
      if (!mm || Number(mm[1]) !== num) return null;
      return { el, fillers };
    };
    const found = findCaptionSibling('prev') || findCaptionSibling('next');
    if (found) {
      const innerHtml = _stripSelfMediaLinks(found.el.innerHTML);
      if (isTable) {
        const p = document.createElement('p');
        p.className = 'table-label';
        p.innerHTML = innerHtml; // _refreshTableLabel below re-bolds + strips prefix
        block.insertBefore(p, block.firstChild);
      } else {
        const inner = innerHtml.replace(prefixRe, '').trim();
        let fc = block.querySelector(':scope > figcaption');
        if (!fc) { fc = document.createElement('figcaption'); block.appendChild(fc); }
        // LOCKED figures keep their verbatim manual prefix.
        const manual = _blockManualLabel(block);
        const figPrefix = manual ? _renderLabelPrefix(manual) : `<strong>Figure ${num}.</strong>`;
        fc.innerHTML = inner ? `${figPrefix} ${inner}` : figPrefix;
      }
      found.el.remove();
      found.fillers.forEach((f) => f.remove());
      mutated = true;
    }

    // 1b) Collapse duplicate table labels (an adopted caption stacked on top of an
    //     empty popup "Table N." label): keep the one with the most caption text.
    if (isTable) {
      const labels = Array.from(block.querySelectorAll(':scope > p.table-label'));
      if (labels.length > 1) {
        labels.sort((a, b) => (b.textContent || '').trim().length - (a.textContent || '').trim().length);
        labels.slice(1).forEach((l) => l.remove());
        mutated = true;
      }
    }

    // 2) Canonicalise the in-block caption (strip self-links, fix prefix/bold/size).
    if (isTable) {
      const lbl = block.querySelector(':scope > p.table-label')
        || Array.from(block.querySelectorAll(':scope > p')).find((p) => {
          const t = (p.querySelector(':scope > strong, :scope > b')?.textContent || p.textContent || '').trim();
          return /^(?:tables?|tablolar?|tablo|tab)\b/i.test(t);
        });
      if (lbl) {
        const before = lbl.innerHTML;
        const delinked = _stripSelfMediaLinks(before);
        if (delinked !== before) lbl.innerHTML = delinked;
        _refreshTableLabel(block, num);
        if (lbl.innerHTML !== before) mutated = true;
      }
    } else {
      const fc = block.querySelector(':scope > figcaption');
      if (fc && /href=["']#(?:figure|fig|table|tab)-/i.test(fc.innerHTML)) {
        fc.innerHTML = _stripSelfMediaLinks(fc.innerHTML);
        mutated = true;
      }
    }

    // 3) Drop an empty spacer paragraph (<p><br></p>, <p>&nbsp;</p>, <o:p>)
    //    sitting IMMEDIATELY before/after the block — it renders as an ugly
    //    extra blank line between the prose and the caption. Word paste + the
    //    old "insert below the caret" behaviour left these behind.
    const isSpacer = (el) => !!el && (
      (el.tagName === 'P' && !(el.textContent || '').trim() && !el.querySelector('img,table')) ||
      el.tagName === 'BR' ||
      (el.tagName && el.tagName.toLowerCase() === 'o:p')
    );
    while (isSpacer(block.previousElementSibling)) { block.previousElementSibling.remove(); mutated = true; }
    while (isSpacer(block.nextElementSibling)) { block.nextElementSibling.remove(); mutated = true; }
  });
  // Lock every media caption label against inline editing — figure/table names
  // (and captions) must ONLY be changed via the table dialogs / figure (Dosyalar)
  // pop-up. Done as a stamping pass (no `mutated`/dirty) so merely opening an
  // article doesn't flag unsaved changes; the attribute serialises on next save.
  _lockMediaCaptionEditing(visualEl);
  if (mutated && typeof markDirty === 'function') markDirty();
  return mutated;
}

// Stamp contenteditable="false" on every figure/table caption label so the
// names/titles can't be altered by typing in the body. Idempotent.
function _lockMediaCaptionEditing(visualEl) {
  if (!visualEl || !visualEl.querySelectorAll) return;
  visualEl.querySelectorAll(
    '.article-table-wrap[id^="table-"] > p.table-label, ' +
    '.article-table-wrap[id^="tab-"] > p.table-label, ' +
    'figure[id^="figure-"] > figcaption, figure[id^="figure-"] > p, ' +
    'figure[id^="fig-"] > figcaption, figure[id^="fig-"] > p'
  ).forEach((el) => {
    if (el.getAttribute('contenteditable') !== 'false') el.setAttribute('contenteditable', 'false');
  });
}

// ── In-editor media block controls ───────────────────────────────────────────
// Because figure/table captions are now non-editable, the editor needs an
// explicit, reliable way to MOVE, DELETE, or EDIT a placed figure/table block.
// A small floating toolbar appears at the top-right of whichever media block the
// cursor hovers, with: move up / move down / edit / delete. Bound once at the
// document level so it works for any editor (ft / aip-ft) and survives re-renders.
let _mediaCtl = null;          // the toolbar element
let _mediaCtlTarget = null;    // the block it currently acts on
let _mediaCtlPrefix = null;    // owning editor prefix ('ft' / 'aip-ft')
let _mediaCtlHideTimer = null;
let _mediaCtlBound = false;

function _initMediaBlockControls() {
  if (_mediaCtlBound) return;
  _mediaCtlBound = true;
  const MEDIA_SEL = 'figure[id^="figure-"], figure[id^="fig-"], .article-table-wrap[id^="table-"], .article-table-wrap[id^="tab-"]';
  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const visual = t.closest('[id$="-visual"][contenteditable="true"]');
    if (!visual) return;
    const block = t.closest(MEDIA_SEL);
    if (!block || !visual.contains(block)) return;
    _showMediaCtl(block, visual);
  });
  document.addEventListener('mouseout', (e) => {
    if (!_mediaCtlTarget) return;
    const to = e.relatedTarget;
    if (to && to.nodeType === 1 && (_mediaCtlTarget.contains(to) || (_mediaCtl && _mediaCtl.contains(to)))) return;
    _scheduleHideMediaCtl();
  });
  window.addEventListener('scroll', () => { if (_mediaCtlTarget) _positionMediaCtl(); }, true);
  window.addEventListener('resize', () => { if (_mediaCtlTarget) _positionMediaCtl(); });
}

function _ensureMediaCtlEl() {
  if (_mediaCtl) return _mediaCtl;
  const tb = document.createElement('div');
  tb.id = 'media-block-ctl';
  tb.className = 'media-block-ctl hidden';
  tb.innerHTML =
    '<select class="mbc-size" title="Görsel boyutu (genişlik)">' +
      '<option value="small">Küçük</option>' +
      '<option value="medium">Orta</option>' +
      '<option value="large">Büyük</option>' +
      '<option value="full">Tam</option>' +
    '</select>' +
    '<span class="mbc-divider"></span>' +
    '<button type="button" data-mbc="up" title="Yukarı taşı" aria-label="Yukarı taşı">▲</button>' +
    '<button type="button" data-mbc="down" title="Aşağı taşı" aria-label="Aşağı taşı">▼</button>' +
    '<button type="button" data-mbc="edit" title="Düzenle" aria-label="Düzenle">✎</button>' +
    '<button type="button" data-mbc="delete" title="Sil" aria-label="Sil">🗑</button>';
  tb.addEventListener('mouseenter', () => clearTimeout(_mediaCtlHideTimer));
  tb.addEventListener('mouseleave', () => _scheduleHideMediaCtl());
  // Keep the editor selection/caret on toolbar mousedown — EXCEPT for the size
  // <select>, which needs its native click flow to open the dropdown.
  tb.addEventListener('mousedown', (e) => { if (e.target.closest('select, option')) return; e.preventDefault(); });
  tb.addEventListener('click', _onMediaCtlClick);
  // Size selector → set data-size on the hovered block (CSS scales it live).
  tb.querySelector('.mbc-size').addEventListener('change', (e) => {
    if (!_mediaCtlTarget) return;
    _mediaCtlTarget.setAttribute('data-size', e.target.value);
    markDirty();
    _positionMediaCtl();
  });
  document.body.appendChild(tb);
  _mediaCtl = tb;
  return tb;
}

function _showMediaCtl(block, visual) {
  clearTimeout(_mediaCtlHideTimer);
  _mediaCtlTarget = block;
  _mediaCtlPrefix = (visual.id || '').replace(/-visual$/, '');
  const tb = _ensureMediaCtlEl();
  // Reflect the block's current size in the selector (default to Orta).
  const sel = tb.querySelector('.mbc-size');
  if (sel) {
    const sz = block.getAttribute('data-size');
    sel.value = ['small', 'medium', 'large', 'full'].indexOf(sz) >= 0 ? sz : 'medium';
  }
  tb.classList.remove('hidden');
  _positionMediaCtl();
}

function _positionMediaCtl() {
  if (!_mediaCtl || !_mediaCtlTarget) return;
  const r = _mediaCtlTarget.getBoundingClientRect();
  const top = r.top + window.scrollY + 6;
  const left = r.right + window.scrollX - _mediaCtl.offsetWidth - 6;
  _mediaCtl.style.top = top + 'px';
  _mediaCtl.style.left = Math.max(8, left) + 'px';
}

function _scheduleHideMediaCtl() {
  clearTimeout(_mediaCtlHideTimer);
  _mediaCtlHideTimer = setTimeout(() => {
    if (_mediaCtl) _mediaCtl.classList.add('hidden');
    _mediaCtlTarget = null;
  }, 220);
}

async function _onMediaCtlClick(e) {
  const btn = e.target.closest('[data-mbc]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const action = btn.dataset.mbc;
  const block = _mediaCtlTarget;
  const prefix = _mediaCtlPrefix;
  if (!block) return;
  const visual = document.getElementById(prefix + '-visual');
  if (!visual || !visual.contains(block)) return;
  const isFigure = block.tagName === 'FIGURE';
  const m = block.id.match(/-(\d+)$/);
  const num = m ? Number(m[1]) : null;

  if (action === 'up') {
    const prev = block.previousElementSibling;
    if (prev) { block.parentNode.insertBefore(block, prev); markDirty(); _positionMediaCtl(); }
    return;
  }
  if (action === 'down') {
    const next = block.nextElementSibling;
    if (next) { block.parentNode.insertBefore(next, block); markDirty(); _positionMediaCtl(); }
    return;
  }
  if (action === 'edit') {
    if (isFigure) {
      const img = block.querySelector('img');
      const src = img ? img.getAttribute('src') : '';
      if (src) openFigureInsertDialog(src, src.split('/').pop());
      else toast('Bu figür bir görsel içermiyor — Dosyalar sekmesinden düzenleyin', 'warning');
    } else if (num != null) {
      _insertInlineTable(prefix, num);
    }
    return;
  }
  if (action === 'delete') {
    const label = isFigure ? `Figür ${num}` : `Tablo ${num}`;
    const ok = await confirmAction(`${label} silinecek. Emin misiniz?`);
    if (!ok) return;
    block.remove();
    if (!isFigure && typeof _renumberTablesByMention === 'function') _renumberTablesByMention(visual);
    if (typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(visual);
    if (typeof _autoLinkInEditor === 'function') _autoLinkInEditor(visual);
    markDirty();
    if (_mediaCtl) _mediaCtl.classList.add('hidden');
    _mediaCtlTarget = null;
    toast(`${label} silindi`, 'success');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SMART EDITOR TOOLS — autosave/recovery, preflight check, reader preview
// ════════════════════════════════════════════════════════════════════════════

// ── Autosave / draft recovery ────────────────────────────────────────────────
// Periodically mirror the full-text editor to localStorage so a crash / closed
// tab doesn't lose work. On load we offer to restore a newer unsaved draft.
function _ftDraftKey(prefix, articleId) { return `bmj_ftdraft_${prefix}_${articleId}`; }

function _setupFtAutosave(prefix, articleId) {
  const visual = document.getElementById(prefix + '-visual');
  if (!visual || !articleId) return;
  visual.dataset.articleId = String(articleId);
  if (visual.dataset.autosaveBound === '1') return;
  visual.dataset.autosaveBound = '1';
  let timer = null;
  // 'input' fires only on real user edits, not programmatic innerHTML changes,
  // so system normalisation passes never pollute the draft.
  visual.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(
          _ftDraftKey(prefix, visual.dataset.articleId),
          JSON.stringify({ html: visual.innerHTML, ts: Date.now() })
        );
        const st = document.getElementById(prefix === 'aip-ft' ? 'aipf-fulltext-status' : 'f-fulltext-status');
        if (st) {
          let badge = st.querySelector('.ft-autosave-badge');
          if (!badge) { badge = document.createElement('span'); badge.className = 'ft-autosave-badge'; badge.style.cssText = 'margin-left:8px;color:var(--text-faint)'; st.appendChild(badge); }
          try { badge.textContent = '• taslak kaydedildi ' + new Date().toLocaleTimeString('tr-TR'); } catch { badge.textContent = '• taslak kaydedildi'; }
        }
      } catch (_) { /* storage full / disabled — non-fatal */ }
    }, 1500);
  });
}

function _clearFtDraft(prefix, articleId) {
  try { localStorage.removeItem(_ftDraftKey(prefix, articleId)); } catch (_) {}
}

// Offer to restore a saved draft that differs from the just-loaded server copy.
async function _maybeOfferDraftRecovery(prefix, articleId, serverHtml) {
  let raw;
  try { raw = localStorage.getItem(_ftDraftKey(prefix, articleId)); } catch (_) { return; }
  if (!raw) return;
  let draft;
  try { draft = JSON.parse(raw); } catch (_) { _clearFtDraft(prefix, articleId); return; }
  if (!draft || typeof draft.html !== 'string') { _clearFtDraft(prefix, articleId); return; }
  if (draft.html.trim() === (serverHtml || '').trim()) { _clearFtDraft(prefix, articleId); return; }
  let when = '';
  try { when = new Date(draft.ts).toLocaleString('tr-TR'); } catch (_) {}
  const ok = await confirmAction(
    `Bu makale için kaydedilmemiş bir taslak bulundu${when ? ' (' + when + ')' : ''}.\n\n` +
    `Tarayıcı kapanmış veya kaydedilmemiş olabilir. Taslağı editöre geri yüklemek ister misiniz?\n\n` +
    `Evet: taslağı yükler (henüz sunucuya KAYDETMEZ — kontrol edip kaydedin).\n` +
    `İptal: taslağı yok sayar ve siler.`
  );
  if (!ok) { _clearFtDraft(prefix, articleId); return; }
  setHtmlEditorContent(prefix, draft.html);
  const visual = document.getElementById(prefix + '-visual');
  if (visual) {
    _suppressDirty = true;
    try { _ensureMediaIds(visual); _normalizeMediaCaptions(visual); _autoLinkInEditor(visual); } finally { _suppressDirty = false; }
  }
  markDirty();
  toast('Taslak geri yüklendi — kontrol edip "Kaydet" deyin');
}

// ── Preflight: pre-publish check ─────────────────────────────────────────────
// Scans the full text for the errors that most often slip into a published
// article: broken cross-refs, figures/tables uploaded-but-unplaced or
// defined-but-never-referenced, dead/uncited references, empty captions.
function _collectPreflightIssues(visual) {
  const issues = [];
  if (!visual) return issues;
  const add = (level, msg, el) => issues.push({ level, msg, el: el || null });

  const figIds = new Set(), tabIds = new Set();
  visual.querySelectorAll('figure[id^="figure-"], figure[id^="fig-"]').forEach((f) => { const m = f.id.match(/-(\d+)$/); if (m) figIds.add(Number(m[1])); });
  visual.querySelectorAll('.article-table-wrap[id^="table-"], .article-table-wrap[id^="tab-"]').forEach((t) => { const m = t.id.match(/-(\d+)$/); if (m) tabIds.add(Number(m[1])); });

  const refOl = visual.querySelector('.article-references ol, ol.article-references-ol');
  const refCount = refOl ? refOl.querySelectorAll(':scope > li').length : 0;

  // 1) Broken cross-references (anchor target missing).
  visual.querySelectorAll('a[href^="#figure-"],a[href^="#fig-"],a[href^="#table-"],a[href^="#tab-"],a[href^="#ref-"]').forEach((a) => {
    const id = (a.getAttribute('href') || '').slice(1);
    let exists;
    if (/^ref-/.test(id)) { const n = Number(id.replace('ref-', '')); exists = n >= 1 && n <= refCount; }
    else { try { exists = !!visual.querySelector('#' + CSS.escape(id)); } catch { exists = false; } }
    if (!exists) add('error', `Kırık atıf: "${(a.textContent || '').trim().slice(0, 40)}" → #${id} (hedef yok)`, a);
  });

  // 2) Defined media never referenced in the prose.
  const refFig = new Set(), refTab = new Set();
  visual.querySelectorAll('a.article-media-ref-link[href]').forEach((a) => {
    const m = (a.getAttribute('href') || '').match(/^#(figure|fig|table|tab)-(\d+)$/i);
    if (!m) return;
    if (/fig/i.test(m[1])) refFig.add(Number(m[2])); else refTab.add(Number(m[2]));
  });
  figIds.forEach((n) => { if (!refFig.has(n)) add('warn', `Figür ${n} tanımlı ama metinde hiç atıf yok`, visual.querySelector('#figure-' + n)); });
  tabIds.forEach((n) => { if (!refTab.has(n)) add('warn', `Tablo ${n} tanımlı ama metinde hiç atıf yok`, visual.querySelector('#table-' + n)); });

  // 3) Uploaded but not placed in the body.
  try {
    const cached = window._articleAssets;
    if (cached && Array.isArray(cached.figures)) {
      const resolved = _resolveMediaSequence(cached.figures);
      ['figure', 'table'].forEach((kind) => {
        (resolved[kind] || []).forEach((blk) => {
          if (!visual.querySelector('#' + kind + '-' + blk.num)) {
            add('warn', `${kind === 'figure' ? 'Figür' : 'Tablo'} ${blk.num} yüklü ama metne yerleştirilmemiş ("Otomatik Düzenle")`, null);
          }
        });
      });
    }
  } catch (_) {}

  // 4) References in the list that are never cited.
  if (refCount) {
    const cited = new Set();
    visual.querySelectorAll('a[href^="#ref-"]').forEach((a) => { const n = Number((a.getAttribute('href') || '').replace('#ref-', '')); if (n) cited.add(n); });
    for (let i = 1; i <= refCount; i += 1) {
      if (!cited.has(i)) add('warn', `Kaynak ${i} listede var ama metinde atıf yok`, refOl ? refOl.querySelector(':scope > li:nth-child(' + i + ')') : null);
    }
  }

  // 5) Empty captions / labels.
  visual.querySelectorAll('figure[id^="figure-"], figure[id^="fig-"]').forEach((f) => {
    const cap = f.querySelector(':scope > figcaption, :scope > p');
    const txt = cap ? (cap.textContent || '').replace(/^\s*(FIG\.?|Figure|Şekil|Sekil)\s*\d+[a-z]?\.?\s*/i, '').trim() : '';
    if (!txt) add('warn', `${f.id} açıklaması boş`, f);
  });
  visual.querySelectorAll('.article-table-wrap[id^="table-"], .article-table-wrap[id^="tab-"]').forEach((t) => {
    const cap = t.querySelector(':scope > p.table-label');
    const txt = cap ? (cap.textContent || '').replace(/^\s*(Table|Tablo|Tab\.?|[^\s.]+)\s*\d+[a-z]?\.?\s*/i, '').trim() : '';
    if (!txt) add('warn', `${t.id} başlığı boş`, t);
  });

  return issues;
}

// Publish-readiness checks on the article METADATA form (title, DOI, authors,
// ORCID/affiliation, abstract, keywords, and — for published articles — volume/
// issue/pages/date). Reads the live edit-form fields; skips any field/form not
// currently in the DOM so it never false-flags a form that isn't open.
function _collectMetadataIssues(prefix) {
  const issues = [];
  const fp = prefix === 'aip-ft' ? 'aipf' : 'f';
  const isAip = prefix === 'aip-ft';
  const titleEl = document.getElementById(fp + '-title');
  if (!titleEl) return issues; // metadata form not present — skip
  const add = (level, msg) => issues.push({ level, msg: 'Künye: ' + msg, el: null });
  const chk = (id, level, msg) => { const el = document.getElementById(id); if (el && !(el.value || '').trim()) add(level, msg); };

  chk(fp + '-title', 'error', 'Başlık boş');
  chk(fp + '-doi', 'warn', 'DOI girilmemiş');
  const abs = document.getElementById(fp + '-abstractHtml-visual') || document.getElementById(fp + '-abstractHtml');
  if (abs && !((abs.textContent || abs.value || '').trim())) add('warn', 'Öz (abstract) boş');
  chk(fp + '-keywords', 'warn', 'Anahtar kelimeler boş');

  const rows = Array.from(document.querySelectorAll(isAip ? '.aipf-author-row' : '.author-row'));
  const named = rows.filter((r) => ((r.querySelector('.au-name') || {}).value || '').trim());
  if (rows.length && named.length === 0) add('error', 'Hiç yazar adı girilmemiş');
  let noOrcid = 0, noAff = 0;
  named.forEach((r) => {
    if (!(((r.querySelector('.au-orcid') || {}).value || '').trim())) noOrcid += 1;
    if (!(((r.querySelector('.au-aff-idx') || {}).value || '').trim())) noAff += 1;
  });
  if (noOrcid) add('warn', `${noOrcid} yazarın ORCID'i yok`);
  if (noAff) add('warn', `${noAff} yazarın kurum numarası yok`);

  if (!isAip) {
    chk(fp + '-published', 'warn', 'Yayın tarihi boş');
    chk(fp + '-volume', 'warn', 'Cilt (volume) boş');
    chk(fp + '-issue', 'warn', 'Sayı (issue) boş');
    const pagesEl = document.getElementById(fp + '-pages');
    if (pagesEl) {
      const pages = (pagesEl.value || '').trim();
      if (!pages) add('warn', 'Sayfa aralığı boş');
      else if (!/^\d+\s*[-–]?\s*\d*$/.test(pages)) add('warn', 'Sayfa aralığı biçimi olağandışı (ör. 351-354)');
    }
  }
  return issues;
}

function _runPreflight(prefix) {
  const visual = document.getElementById(prefix + '-visual');
  if (!visual) { toast('Editör bulunamadı', 'warning'); return; }
  const issues = _collectPreflightIssues(visual).concat(_collectMetadataIssues(prefix));
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:620px">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <h3 class="text-base font-semibold" style="color:var(--text-strong)">Yayın Öncesi Kontrol</h3>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="px-6 py-4" style="max-height:60vh;overflow:auto">
        <div class="text-sm mb-3" style="color:var(--text-muted)">
          ${issues.length === 0
            ? '✓ Sorun bulunamadı — figür/tablo atıfları, kaynaklar ve başlıklar tutarlı görünüyor.'
            : `<strong style="color:#dc2626">${errors.length}</strong> hata, <strong style="color:#b45309">${warns.length}</strong> uyarı bulundu. Bir satıra tıklayınca ilgili yere gider.`}
        </div>
        <div id="pf-list" class="space-y-1.5"></div>
      </div>
      <div class="flex justify-end gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
        <button data-action="reload" class="btn btn-secondary">Yeniden Tara</button>
        <button data-action="close" class="btn btn-primary">Kapat</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('[data-action="close"]').onclick = close;
  overlay.querySelector('[data-action="reload"]').onclick = () => { close(); _runPreflight(prefix); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const list = overlay.querySelector('#pf-list');
  issues.forEach((iss) => {
    const row = document.createElement('div');
    const isErr = iss.level === 'error';
    row.style.cssText = `display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border-radius:7px;border:1px solid ${isErr ? '#fecaca' : '#fde68a'};background:${isErr ? '#fef2f2' : '#fffbeb'};font-size:12.5px;${iss.el ? 'cursor:pointer' : ''}`;
    row.innerHTML = `<span style="flex-shrink:0">${isErr ? '⛔' : '⚠️'}</span><span style="color:var(--text-strong)">${esc(iss.msg)}</span>`;
    if (iss.el) {
      row.addEventListener('click', () => {
        close();
        try {
          iss.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const prev = iss.el.style.outline;
          iss.el.style.outline = '2px solid #f59e0b';
          iss.el.style.outlineOffset = '2px';
          setTimeout(() => { iss.el.style.outline = prev; iss.el.style.outlineOffset = ''; }, 2200);
        } catch (_) {}
      });
    }
    list.appendChild(row);
  });
}

// ── Reader preview: render the draft with the public article's own styles ────
let _readerPreviewCss = null;
async function _openReaderPreview(prefix) {
  const html = getHtmlEditorContent(prefix);
  if (_readerPreviewCss === null) {
    // Borrow the public article page's inline <style> blocks (the .article-body
    // typography/figure/table rules live there, not in style.css) so the preview
    // matches the reader's view. Cached after first fetch.
    try {
      const txt = await (await fetch('/site/article.html')).text();
      _readerPreviewCss = (txt.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');
    } catch (_) { _readerPreviewCss = ''; }
  }
  const srcdoc = '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<link rel="stylesheet" href="/site/css/style.css">' +
    _readerPreviewCss +
    '<style>html,body{margin:0;background:#eef0f2}.bmj-pv{max-width:860px;margin:0 auto;padding:36px 28px;background:#fff;min-height:100vh;box-shadow:0 0 0 1px rgba(0,0,0,.06)}</style>' +
    '</head><body><div class="bmj-pv"><div class="article-body">' + html + '</div></div></body></html>';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:920px;width:94vw;height:88vh;display:flex;flex-direction:column">
      <div class="flex items-center justify-between px-6 py-3" style="border-bottom:1px solid var(--border-soft)">
        <h3 class="text-base font-semibold" style="color:var(--text-strong)">Okuyucu Önizlemesi <span class="text-xs font-normal" style="color:var(--text-faint)">— yayındaki görünüm</span></h3>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <iframe id="reader-pv-frame" style="flex:1;width:100%;border:0;background:#fff"></iframe>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#reader-pv-frame').srcdoc = srcdoc;
}

// ── Media manager: edit every figure/table label + caption in one place ──────
// Plain-text caption of a figure block (label prefix stripped). Mirrors
// _tableCaptionText for the table side.
function _figureCaptionText(fig) {
  const cap = fig.querySelector(':scope > figcaption, :scope > p');
  if (!cap) return '';
  const clone = cap.cloneNode(true);
  const s = clone.querySelector(':scope > strong, :scope > b');
  if (s) s.remove();
  let t = (clone.textContent || '').replace(/\s+/g, ' ').trim();
  if (!s) t = t.replace(/^\s*(FIG\.?|Figure|Şekil|Sekil)\s*\d+[a-z]?\s*[.:\-–—]?\s*/i, '').trim();
  return t.replace(/^\s*[.:\-–—]\s*/, '').trim();
}

async function _openMediaManager(prefix) {
  const visual = document.getElementById(prefix + '-visual');
  if (!visual) { toast('Editör bulunamadı', 'warning'); return; }
  const articleId = visual.dataset.articleId || null;

  // Pull the latest figure-meta-backed asset list so captions/labels edited in
  // the Dosyalar tab are reflected here as soon as the manager opens (placed
  // blocks read their caption from the live editor DOM, which Dosyalar already
  // syncs; this refresh covers the uploaded-but-unplaced figures).
  if (articleId) {
    try { window._articleAssets = await API.get(`/media/article/${articleId}/assets`); } catch (_) { /* keep cache */ }
  }

  // Collect placed blocks.
  const rows = [];
  visual.querySelectorAll('figure[id^="figure-"], figure[id^="fig-"]').forEach((f) => {
    const m = f.id.match(/-(\d+)$/); if (!m) return;
    const num = Number(m[1]);
    const img = f.querySelector('img');
    rows.push({ kind: 'figure', num, el: f, placed: true,
      label: _blockManualLabel(f) || ('FIG. ' + num),
      caption: _figureCaptionText(f),
      thumb: img ? img.getAttribute('src') : '',
      filename: img ? (img.getAttribute('src') || '').split('/').pop() : '' });
  });
  visual.querySelectorAll('.article-table-wrap[id^="table-"], .article-table-wrap[id^="tab-"]').forEach((t) => {
    const m = t.id.match(/-(\d+)$/); if (!m) return;
    const num = Number(m[1]);
    rows.push({ kind: 'table', num, el: t, placed: true,
      label: _blockManualLabel(t) || ('Table ' + num),
      caption: _tableCaptionText(t), thumb: '', filename: '' });
  });

  // Collect uploaded-but-unplaced assets.
  try {
    const cached = window._articleAssets;
    if (cached && Array.isArray(cached.figures)) {
      const resolved = _resolveMediaSequence(cached.figures);
      ['figure', 'table'].forEach((kind) => {
        (resolved[kind] || []).forEach((blk) => {
          if (visual.querySelector('#' + kind + '-' + blk.num)) return;
          const first = blk.panels[0] || {};
          rows.push({ kind, num: blk.num, el: null, placed: false,
            label: first.label || ((kind === 'figure' ? 'FIG. ' : 'Table ') + blk.num),
            caption: first.caption || '', thumb: first.url || '', filename: first.filename || '' });
        });
      });
    }
  } catch (_) {}

  rows.sort((a, b) => (a.kind === b.kind ? a.num - b.num : (a.kind < b.kind ? -1 : 1)));

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:880px;width:94vw;display:flex;flex-direction:column;max-height:88vh">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <h3 class="text-base font-semibold" style="color:var(--text-strong)">Medya Yöneticisi <span class="text-xs font-normal" style="color:var(--text-faint)">— figür & tablo etiketleri/başlıkları</span></h3>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="px-5 py-3" style="overflow:auto">
        ${rows.length === 0 ? '<p class="text-sm py-6 text-center" style="color:var(--text-faint)">Henüz figür/tablo yok.</p>' : `<div id="mm-rows" class="space-y-2"></div>`}
      </div>
      <div class="flex justify-end gap-2 px-6 py-3" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle)">
        <button data-action="close" class="btn btn-primary">Kapat</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('[data-action="close"]').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const host = overlay.querySelector('#mm-rows');
  if (!host) return;
  rows.forEach((r, i) => {
    const kindLabel = r.kind === 'figure' ? 'Figür' : 'Tablo';
    const statusBadge = r.placed
      ? '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:#dcfce7;color:#166534">yerleştirildi</span>'
      : '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:#fef3c7;color:#92400e">diskte</span>';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1px solid var(--border-soft);border-radius:9px;background:#fff';
    row.innerHTML = `
      <div style="flex-shrink:0;width:56px;height:46px;border-radius:6px;overflow:hidden;background:#f4f3f0;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-faint)">
        ${r.thumb ? `<img src="/site/${esc(String(r.thumb).replace(/^\//, ''))}" alt="" style="max-width:100%;max-height:100%;object-fit:contain" onerror="this.style.display='none';this.parentNode.textContent='${r.kind === 'table' ? 'tablo' : '—'}'">` : (r.kind === 'table' ? 'tablo' : '—')}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <span style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">${kindLabel} ${r.num}</span>
          ${statusBadge}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="input mm-label" data-idx="${i}" placeholder="Etiket" value="${esc(r.label)}" style="flex:0 0 150px;font-size:12.5px;padding:5px 8px">
          <input class="input mm-caption" data-idx="${i}" placeholder="Başlık / açıklama" value="${esc(r.caption)}" style="flex:1;min-width:160px;font-size:12.5px;padding:5px 8px">
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        ${r.placed
          ? `<button class="btn btn-primary btn-sm mm-apply" data-idx="${i}" style="font-size:11.5px;padding:4px 10px">Uygula</button>
             <div style="display:flex;gap:4px">
               <button class="btn btn-secondary btn-sm mm-go" data-idx="${i}" style="font-size:11.5px;padding:4px 8px" title="Metinde göster">Git</button>
               <button class="btn btn-secondary btn-sm mm-del" data-idx="${i}" style="font-size:11.5px;padding:4px 8px" title="Sil">Sil</button>
             </div>`
          : `<button class="btn btn-primary btn-sm mm-place" data-idx="${i}" style="font-size:11.5px;padding:4px 10px" title="Metne yerleştir">Yerleştir</button>`}
      </div>`;
    host.appendChild(row);
  });

  const idx = (e) => Number(e.currentTarget.dataset.idx);
  const readRow = (i) => ({
    label: overlay.querySelector(`.mm-label[data-idx="${i}"]`).value.trim(),
    caption: overlay.querySelector(`.mm-caption[data-idx="${i}"]`).value.trim(),
  });

  host.querySelectorAll('.mm-apply').forEach((b) => b.onclick = async (e) => {
    const r = rows[idx(e)];
    const { label, caption } = readRow(idx(e));
    const autoDef = (r.kind === 'figure' ? 'FIG. ' : 'Table ') + r.num;
    const manual = (label && label !== autoDef) ? label : '';
    if (manual) r.el.setAttribute('data-label', manual.replace(/[.\s]+$/, '')); else r.el.removeAttribute('data-label');
    _updateExistingMediaCaption(r.el, r.kind, r.num, _captionToHtml(caption), null);
    if (typeof _autoLinkInEditor === 'function') _autoLinkInEditor(visual);
    if (typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(visual);
    markDirty();
    // Persist figure caption/label so it survives Otomatik Düzenle re-runs.
    if (r.kind === 'figure' && articleId && r.filename) {
      try {
        const all = await API.get(`/media/article/${articleId}/figure-meta`).catch(() => ({}));
        const prev = (all && all[r.filename]) || {};
        await API.put(`/media/article/${articleId}/figure-meta`, {
          filename: r.filename, caption, source: '', size: prev.size || 'auto', label: manual,
        });
        // Reverse sync: refresh the Dosyalar cache + "Yüklü Figürler" thumbnails
        // so the caption/label edited here shows there too. Non-blocking.
        if (typeof loadArticleAssets === 'function') loadArticleAssets(articleId).catch(() => {});
      } catch (_) { /* non-fatal */ }
    }
    toast(`${r.kind === 'figure' ? 'Figür' : 'Tablo'} ${r.num} güncellendi`);
  });

  host.querySelectorAll('.mm-go').forEach((b) => b.onclick = (e) => {
    const r = rows[idx(e)];
    close();
    try {
      r.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prev = r.el.style.outline;
      r.el.style.outline = '2px solid #0d9488'; r.el.style.outlineOffset = '2px';
      setTimeout(() => { r.el.style.outline = prev; r.el.style.outlineOffset = ''; }, 2200);
    } catch (_) {}
  });

  host.querySelectorAll('.mm-del').forEach((b) => b.onclick = async (e) => {
    const r = rows[idx(e)];
    const lbl = (r.kind === 'figure' ? 'Figür ' : 'Tablo ') + r.num;
    if (!await confirmAction(`${lbl} metinden silinecek. Emin misiniz? (Dosya diskte kalır.)`)) return;
    r.el.remove();
    if (r.kind === 'table' && typeof _renumberTablesByMention === 'function') _renumberTablesByMention(visual);
    if (typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(visual);
    if (typeof _autoLinkInEditor === 'function') _autoLinkInEditor(visual);
    markDirty();
    close();
    toast(`${lbl} silindi`, 'success');
  });

  host.querySelectorAll('.mm-place').forEach((b) => b.onclick = (e) => {
    const r = rows[idx(e)];
    const { label, caption } = readRow(idx(e));
    const autoDef = (r.kind === 'figure' ? 'FIG. ' : 'Table ') + r.num;
    const manual = (label && label !== autoDef) ? label : '';
    close();
    if (r.url || r.thumb) insertFigureIntoFullText(r.thumb || r.url, r.filename, caption, 'medium', manual);
    else toast('Bu öğenin dosya yolu bulunamadı', 'warning');
  });
}

// ── Heading outline / TOC for the full-text editor ───────────────────────────
// A live floating panel that lists the editor's headings, shows whether each is
// the right level (this site uses H3 = main section, H4 = subsection), lets the
// editor click to jump+highlight the heading in the editor, and fix a wrong
// level (e.g. after a Word paste) to H3/H4 in one click.
let _headingOutlineObserver = null;
let _headingOutlineHeads = [];

function _toggleHeadingOutline(prefix) {
  const panel = document.getElementById('heading-outline');
  if (panel && !panel.classList.contains('hidden') && panel.dataset.prefix === prefix) {
    _closeHeadingOutline();
    return;
  }
  _openHeadingOutline(prefix);
}

function _ensureHeadingOutlinePanel() {
  let panel = document.getElementById('heading-outline');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'heading-outline';
  panel.className = 'heading-outline hidden';
  document.body.appendChild(panel);
  return panel;
}

function _closeHeadingOutline() {
  const panel = document.getElementById('heading-outline');
  if (panel) panel.classList.add('hidden');
  if (_headingOutlineObserver) { _headingOutlineObserver.disconnect(); _headingOutlineObserver = null; }
}

function _openHeadingOutline(prefix) {
  const visual = document.getElementById(prefix + '-visual');
  if (!visual) { toast('Tam metin editörü bulunamadı', 'warning'); return; }
  const panel = _ensureHeadingOutlinePanel();
  panel.dataset.prefix = prefix;
  panel.classList.remove('hidden');
  _renderHeadingOutline(prefix);
  // Track edits live (typing, paste, Otomatik Düzenle) so the outline stays current.
  if (_headingOutlineObserver) _headingOutlineObserver.disconnect();
  let t = null;
  _headingOutlineObserver = new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => { if (!panel.classList.contains('hidden')) _renderHeadingOutline(prefix); }, 250);
  });
  _headingOutlineObserver.observe(visual, { childList: true, subtree: true, characterData: true });
}

// Briefly highlight a heading inside the editor so the user sees which one a TOC
// row maps to. Uses a transient class removed after the flash.
function _flashHeading(visual, h) {
  if (!h) return;
  try { h.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
  h.classList.add('outline-flash');
  setTimeout(() => { try { h.classList.remove('outline-flash'); } catch (_) {} }, 1800);
}

// Convert a heading element to a new level (h3/h4) in place, stripping the Word
// inline font styling that would otherwise override the semantic level.
function _setOutlineHeadingLevel(prefix, idx, level) {
  const visual = document.getElementById(prefix + '-visual');
  const h = _headingOutlineHeads[idx];
  if (!visual || !h || !visual.contains(h)) return;
  if (h.tagName === 'H' + level) { _flashHeading(visual, h); return; }
  const nh = document.createElement('h' + level);
  nh.innerHTML = h.innerHTML;
  h.replaceWith(nh);
  _stripFontDecls(nh);
  nh.querySelectorAll('[style]').forEach(_stripFontDecls);
  markDirty();
  _renderHeadingOutline(prefix);
  _flashHeading(visual, nh);
}

function _renderHeadingOutline(prefix) {
  const panel = document.getElementById('heading-outline');
  const visual = document.getElementById(prefix + '-visual');
  if (!panel || !visual) return;
  const heads = Array.from(visual.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter((h) =>
    !h.closest('.article-references, .article-acknowledgments, .article-footnotes, .article-supplementary, figure, .article-figure, .article-table-wrap, table'));
  _headingOutlineHeads = heads;

  // Level check. Valid article heading levels are H3 (main) → H4 → H5 → H6
  // (this site styles all four). Flag: H1/H2 (too high — use H3+), and a level
  // that skips a step (e.g. H3 then H5 with no H4 between) so the hierarchy stays
  // consistent. The per-row selector lets the editor set the correct level.
  let issues = 0;
  let prevLvl = 0;
  const LEVELS = [3, 4, 5, 6];
  const palette = { 3: '#0d9488', 4: '#0369a1', 5: '#7c3aed', 6: '#9d174d' };
  const rows = heads.map((h, i) => {
    const lvl = Number(h.tagName.slice(1));
    const text = (h.textContent || '').replace(/\s+/g, ' ').trim() || '(boş başlık)';
    let warn = '';
    if (lvl < 3 || lvl > 6) warn = 'Başlıklar H3 (ana) → H6 arası olmalı (H1/H2 stillenmez)';
    else if (prevLvl && lvl > prevLvl + 1) warn = 'Düzey atlandı — bir üst seviye (H' + (prevLvl + 1) + ') yokken H' + lvl;
    else if (!prevLvl && lvl !== 3) warn = 'İlk başlık ana bölüm (H3) olmalı';
    prevLvl = (lvl >= 3 && lvl <= 6) ? lvl : prevLvl;
    if (warn) issues += 1;
    const indent = Math.max(0, (Math.min(Math.max(lvl, 3), 6) - 3)) * 14;
    const badgeColor = warn ? '#dc2626' : (palette[lvl] || '#dc2626');
    const opts = LEVELS.map((L) => `<option value="${L}"${lvl === L ? ' selected' : ''}>H${L}</option>`).join('');
    return `<div class="ho-row" data-idx="${i}" style="padding-left:${indent}px">
      <button type="button" class="ho-go" data-idx="${i}" title="${esc(warn || 'Editörde göster')}">
        <span class="ho-badge" style="color:${badgeColor};border-color:${badgeColor}">${esc(h.tagName)}</span>
        <span class="ho-text">${warn ? '⚠ ' : ''}${esc(text.length > 44 ? text.slice(0, 43) + '…' : text)}</span>
      </button>
      <select class="ho-sel" data-idx="${i}" title="Başlık düzeyini değiştir">${opts}</select>
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="ho-head">
      <span class="ho-title">Başlıklar (${heads.length})</span>
      <button type="button" class="ho-close" aria-label="Kapat" title="Kapat">×</button>
    </div>
    <div class="ho-summary">${heads.length === 0
      ? 'Editörde başlık bulunamadı. Bir paragrafı seçip <b>H3/H4</b> ile başlık yapın.'
      : (issues
        ? `<span style="color:#b45309">⚠ ${issues} olası düzey sorunu</span> — H3 (ana) → H6 düzeyleri, atlamadan.`
        : '✓ Başlık düzeyleri tutarlı (H3 → H6).')}</div>
    <div class="ho-list">${rows}</div>`;

  panel.querySelector('.ho-close').onclick = _closeHeadingOutline;
  panel.querySelectorAll('.ho-go').forEach((b) => {
    b.onclick = () => _flashHeading(visual, _headingOutlineHeads[Number(b.dataset.idx)]);
  });
  panel.querySelectorAll('.ho-sel').forEach((sel) => {
    sel.onchange = () => _setOutlineHeadingLevel(prefix, Number(sel.dataset.idx), Number(sel.value));
  });
}

// Renumber table blocks so they read Table 1, Table 2, … in the order each is
// FIRST mentioned in the prose, updating block ids + bold labels AND every
// in-text reference (linked anchors and plain text) to match. Tables that are
// never mentioned keep trailing numbers in document order. Labels are always
// normalised to the bold "Table N." form even when the number is unchanged.
// Returns the count of tables whose number changed.
function _renumberTablesByMention(visual) {
  if (!visual) return 0;
  const blocks = Array.from(visual.querySelectorAll('[id^="table-"]'))
    // Real tables only — a wrap with no <table>/<img> is a phantom (e.g. a
    // section heading wrapped by a botched paste); counting it would mis-number
    // the real tables. _normalizeMediaCaptions unwraps such phantoms separately.
    .filter((el) => el.tagName !== 'A' && /^table-\d+$/i.test(el.id) && el.querySelector('table, img'));
  if (!blocks.length) return 0;
  const oldNums = blocks.map((b) => Number(b.id.replace(/^table-/i, '')));
  // Ambiguous if duplicate ids exist — only normalise labels, don't remap.
  if (new Set(oldNums).size !== oldNums.length) {
    blocks.forEach((b, i) => _refreshTableLabel(b, oldNums[i]));
    return 0;
  }

  const skipZone = (el) => !!(el && el.closest && el.closest(
    '.article-references, .article-acknowledgments, .article-footnotes, .article-supplementary, .article-figure, .article-table-wrap, figure'
  ));

  // First-mention order: walk the editor in document order, recording table
  // numbers from linked anchors (href) and plain-text "Table N" mentions.
  const seen = new Set();
  const mentionOrder = [];
  const push = (n) => { if (oldNums.includes(n) && !seen.has(n)) { seen.add(n); mentionOrder.push(n); } };
  const walker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) {
      if (node.tagName === 'A' && !skipZone(node)) {
        const m = (node.getAttribute('href') || '').match(/^#table-(\d+)$/i);
        if (m) push(Number(m[1]));
      }
      continue;
    }
    if (skipZone(node.parentNode)) continue;
    if (node.parentNode && node.parentNode.closest && node.parentNode.closest('a')) continue;
    const re = /(?<![A-Za-z])(?:tables?|tablolar?|tablo)\s+(\d+)/gi;
    let mm;
    while ((mm = re.exec(node.nodeValue)) !== null) push(Number(mm[1]));
  }

  const finalOrder = mentionOrder.concat(oldNums.filter((n) => !seen.has(n)));
  const map = {};
  finalOrder.forEach((oldN, i) => { map[oldN] = i + 1; });
  const changed = oldNums.filter((n) => map[n] !== n).length;

  // Apply: renumber + (re)normalise every table block's label.
  blocks.forEach((b) => {
    const oldN = Number(b.id.replace(/^table-/i, ''));
    const newN = map[oldN];
    if (newN !== oldN) b.id = `table-${newN}`;
    _refreshTableLabel(b, newN);
  });

  if (changed) {
    // Remap linked references.
    visual.querySelectorAll('a[href^="#table-"]').forEach((a) => {
      if (skipZone(a)) return;
      const m = (a.getAttribute('href') || '').match(/^#table-(\d+)$/i);
      if (!m) return;
      const newN = map[Number(m[1])];
      if (!newN) return;
      a.setAttribute('href', `#table-${newN}`);
      a.textContent = a.textContent.replace(/\d+/, String(newN));
    });
    // Remap plain-text mentions (single-pass replace per node → each occurrence
    // maps exactly once, so swaps like 1↔2 don't cancel out).
    const tWalker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n.nodeValue || !/(?:table|tablo)\s+\d/i.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (skipZone(n.parentNode)) return NodeFilter.FILTER_REJECT;
        if (n.parentNode && n.parentNode.closest && n.parentNode.closest('a')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const tNodes = [];
    for (let n = tWalker.nextNode(); n; n = tWalker.nextNode()) tNodes.push(n);
    tNodes.forEach((n) => {
      n.nodeValue = n.nodeValue.replace(/((?:tables?|tablolar?|tablo)\s+)(\d+)/gi, (full, w, d) => {
        const newN = map[Number(d)];
        return newN ? w + newN : full;
      });
    });
  }
  return changed;
}

// One-shot "Otomatik Düzenle": fetches every uploaded figure / table from
// Dosyalar, drops each one under the paragraph that mentions it, then runs
// the full normalisation chain so references and inline mentions get wired
// up. If the article has no figures/tables, only the reference auto-linking
// runs — which is exactly what the editor asks for ("varsa figür/tablo, yoksa
// sadece kaynaklar bağlansın").
async function _autoArrangeFullText(prefix) {
  const articleId = currentArticleIdFromHash();
  if (!articleId) { toast('Makaleyi önce kaydedin — otomatik düzenleme için makale ID gerekir.', 'warning'); return; }
  const visual = document.getElementById(prefix + '-visual');
  if (!visual) return;
  const status = document.getElementById(prefix === 'aip-ft' ? 'aipf-fulltext-status' : 'f-fulltext-status');
  if (status) status.textContent = 'Otomatik düzenleme çalışıyor…';

  let assets = { figures: [], supplementary: [] };
  try {
    assets = await API.get(`/media/article/${articleId}/assets`);
  } catch (_) { /* if endpoint fails, proceed with empty assets — refs still get linked */ }

  // Map each uploaded file to its detected number AND panel letter. Two
  // files for the same N (e.g. figure-1a.png + figure-1b.png) collapse
  // into one composite <figure id="figure-1"> with labelled panels.
  // Each entry also carries caption + source (saved via Figür Ekle dialog)
  // so _buildMediaBlock can render them into the caption.
  // Resolve uploaded files into ordered, distinctly-numbered blocks. This is
  // the SAME resolver the cross-ref picker uses, so the #figure-N anchor a user
  // inserted from the picker always lands on the block we build here — even for
  // arbitrarily-named or same-numbered uploads.
  const buckets = { figure: new Map(), table: new Map() };
  const resolvedSeq = _resolveMediaSequence(assets.figures || []);
  for (const kind of ['figure', 'table']) {
    resolvedSeq[kind].forEach((blk) => {
      buckets[kind].set(blk.num, blk.panels.map((p) => ({
        panel: p.panel,
        url: p.url,
        filename: p.filename,
        caption: p.caption || '',
        source:  p.source  || '',
        size:    p.size    || 'auto',
        label:   p.label   || '',
      })));
    });
  }
  // Sort panels A → B → C inside each bucket; null-panel entries come first
  // so a "figure-1.png" + "figure-1a.png" pair keeps the bare version on top.
  const sortPanels = (a, b) => {
    if (!a.panel && b.panel) return -1;
    if (a.panel && !b.panel) return 1;
    return (a.panel || '').localeCompare(b.panel || '');
  };
  buckets.figure.forEach((arr) => arr.sort(sortPanels));
  buckets.table.forEach((arr) => arr.sort(sortPanels));

  let placed = 0;
  let updated = 0;
  _suppressDirty = true;
  try {
    for (const kind of ['figure', 'table']) {
      // Pre-build a mention map that understands multi-number sequences so
      // "Figures 2, 3 and 4" puts every one of those numbers under the same
      // host paragraph (instead of only figure-2 landing there).
      const mentionMap = _buildMentionMap(visual, kind);
      const sorted = [...buckets[kind].entries()].sort((a, b) => a[0] - b[0]);
      // Walk in REVERSE numerical order so multiple blocks sharing one host
      // paragraph end up in ascending order after consecutive insertBefore
      // calls (same trick as relocateFiguresAndTables).
      for (const [num, panels] of sorted.reverse()) {
        const id = `${kind}-${num}`;
        const existing = visual.querySelector('#' + CSS.escape(id));

        // Resolve the latest caption (with embedded [N] citations) so we can
        // either insert a fresh block or refresh an existing one in-place.
        const pick = panels.find((p) => !p.panel && (p.caption || p.source))
                  || panels.find((p) => p.caption || p.source);
        const rawCap = pick
          ? (() => {
              const c = (pick.caption || '').trim();
              const s = (pick.source  || '').trim();
              return c && s ? `${c} ${s}` : (c || s);
            })()
          : '';
        const stripped = rawCap.replace(new RegExp(`^\\s*(?:figure|fig\\.?|şekil|sekil|tablo|table)\\s*${num}[a-z]?\\s*[\\.:\\-—–]?\\s*`, 'i'), '').trim();
        const captionInner = _captionToHtml(stripped);

        // Sync the saved manual-label LOCK from figure-meta onto the block so a
        // label set/cleared AFTER first insertion takes effect on re-arrange.
        const manualPick = panels.find((p) => p.label != null && String(p.label).trim() !== '');
        const manualLabel = manualPick ? String(manualPick.label).trim() : '';

        if (existing) {
          // Refresh the caption AND the data-size — keep image src and
          // document position intact.
          if (manualLabel) existing.setAttribute('data-label', manualLabel.replace(/[.\s]+$/, ''));
          else existing.removeAttribute('data-label');
          const sizePick = panels.find((p) => p.size && p.size !== 'auto') || panels[0];
          const blockSize = (sizePick && sizePick.size && sizePick.size !== 'auto') ? sizePick.size : null;
          _updateExistingMediaCaption(existing, kind, num, captionInner, blockSize);
          updated += 1;
          continue;
        }

        // Insert a brand-new block under the most relevant mention.
        const host = mentionMap.get(num) || null;
        const block = _buildMediaBlock(kind, num, panels);
        if (host && host.parentNode) {
          host.parentNode.insertBefore(block, host.nextSibling);
        } else {
          visual.appendChild(block); // no mention found — append to end
        }
        placed += 1;
      }
    }

    // Now run the standard normalisation chain so anchors, IDs, caption
    // prefixes, and references all line up. _autoLinkInEditor also re-wires
    // any plain-text citations the user may have typed into captions.
    _normalizeMsoReferenceList(visual);
    _promoteMsoHeadings(visual);
    _ensureMediaIds(visual);
    // Renumber tables by first-mention order (Table 1, Table 2, …) and rewrite
    // their labels + in-text references to match — BEFORE auto-linking so plain
    // mentions get linked against the final numbers.
    _renumberTablesByMention(visual);
    _normalizeMediaCaptions(visual);
    _autoLinkInEditor(visual);
    _validateCrossRefAnchors(visual);
  } finally {
    _suppressDirty = false;
  }

  // Count what got wired so the user sees a meaningful summary.
  const linkedFigTab = visual.querySelectorAll('a.article-media-ref-link').length;
  const linkedRefs = visual.querySelectorAll('a.article-ref-citation').length;
  const refCount = (visual.querySelector('.article-references ol, ol.article-references-ol') || { children: [] }).children.length;

  markDirty();
  const msgParts = [];
  if (placed)  msgParts.push(`${placed} figür/tablo yerleştirildi`);
  if (updated) msgParts.push(`${updated} açıklama güncellendi`);
  if (linkedFigTab) msgParts.push(`${linkedFigTab} figür/tablo atfı bağlandı`);
  if (linkedRefs)   msgParts.push(`${linkedRefs} kaynak atfı bağlandı`);
  if (refCount)     msgParts.push(`${refCount} kaynakça maddesi tanındı`);
  if (!msgParts.length) msgParts.push('Düzenlenecek bir şey bulunamadı');
  if (status) status.textContent = msgParts.join(' · ');
  // Use 'warning' tone when figures already in the text were refreshed instead
  // of inserted — surfaces the "Tam Metne Ekle ile zaten eklenmişti" case so
  // the user knows updates (not duplicates) happened.
  let tone = 'info';
  if (placed || linkedFigTab || linkedRefs) tone = 'success';
  if (updated && !placed) tone = 'warning';
  toast(msgParts.join(', '), tone);
  if (updated) {
    toast(`Uyarı: ${updated} figür/tablo zaten tam metindeydi — yeni kopya eklenmedi, sadece açıklamaları güncellendi.`, 'warning');
  }
}

async function _uploadInlineMedia(prefix, kind, file) {
  const articleId = currentArticleIdFromHash();
  if (!articleId) {
    toast('Makaleyi önce kaydedin; ondan sonra figür/tablo yüklenebilir.', 'warning');
    return;
  }
  const visual = document.getElementById(prefix + '-visual');
  if (!visual) return;

  // Determine the next free number from existing blocks IN THE EDITOR. This
  // is critical because we want consecutive numbering (figure-1, figure-2,
  // figure-3, …) regardless of what's already on disk in /images/articles/.
  const targets = _scanCrossRefTargets(prefix);
  const existing = (kind === 'figure' ? targets.figures : targets.tables) || [];
  const nextNum = existing.length
    ? (Math.max(...existing.map((x) => x.num)) + 1)
    : 1;

  toast(`${file.name} yükleniyor…`, 'info');
  try {
    const fd = new FormData();
    fd.append('figures', file, file.name);
    const res = await fetch(`/api/media/upload/figures/${articleId}`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Yükleme hatası');
    const uploaded = data.uploaded && data.uploaded[0];
    if (!uploaded || !uploaded.url) throw new Error('Sunucu URL döndürmedi');

    // Build the inline block matching the modern JATS structure so the
    // public-site enhancers (caption normalize, relocate, link styling)
    // pick it up automatically once saved.
    let block;
    if (kind === 'figure') {
      block = document.createElement('figure');
      block.id = `figure-${nextNum}`;
      block.className = 'article-figure';
      block.innerHTML =
        `<img src="${esc(uploaded.url)}" alt="Figure ${nextNum}" loading="lazy">` +
        `<p contenteditable="false"><strong>FIG. ${nextNum}.</strong> </p>`;
    } else {
      block = document.createElement('div');
      block.id = `table-${nextNum}`;
      block.className = 'article-table-wrap';
      block.innerHTML =
        `<p class="table-label" contenteditable="false">${_tableLabelHtml(nextNum, '')}</p>` +
        `<img src="${esc(uploaded.url)}" alt="Table ${nextNum}" loading="lazy">`;
    }
    visual.appendChild(block);

    // Insert the cross-reference at the user's saved selection AND announce.
    insertCrossRef(prefix, kind, nextNum);
    markDirty();
    toast(`${kind === 'figure' ? 'Figure' : 'Table'} ${nextNum} eklendi ve bağlandı`, 'success');
    // Newly-added block can heal any previously broken anchors that pointed
    // at this ID — re-validate so the red dashed underline disappears.
    _validateCrossRefAnchors(visual);
    // Also re-run plain-text auto-link so existing "Figure N" mentions to
    // this new figure become clickable now that the target exists.
    _autoLinkInEditor(visual);
    // Re-render the bubble so the newly-uploaded block appears as a chip
    // even before the user saves the article.
    _renderCrossRefBubble(prefix);
  } catch (err) {
    toast('Yükleme başarısız: ' + (err.message || err), 'error');
  }
}

// Sanitize a table pasted from Word/Excel into clean, portable HTML: drop
// Word's mso namespaced tags (o:p…), unwrap styled <span>/<font> wrappers, and
// strip every presentational attribute except the structural colspan/rowspan/
// scope. Returns an <table class="article-table"> string matching the editor's
// own tables so the public-site styling applies uniformly.
function _cleanPastedTable(srcTable) {
  const table = srcTable.cloneNode(true);
  // 1) Remove namespaced junk elements (e.g. <o:p>, <w:…>).
  table.querySelectorAll('*').forEach((el) => {
    if (el.tagName && el.tagName.indexOf(':') !== -1) el.remove();
  });
  // 2) Unwrap span/font wrappers (Word wraps cell text in styled spans). Loop
  //    until none remain so nested wrappers collapse too.
  let wrap;
  let guard = 0;
  while ((wrap = table.querySelector('span, font')) && guard++ < 5000) {
    const parent = wrap.parentNode;
    while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
    parent.removeChild(wrap);
  }
  // 3) Strip presentational attributes; keep table structure semantics.
  //    querySelectorAll('*') only returns DESCENDANTS, so clean the root
  //    <table>'s own Word attributes (border/cellspacing/style/mso…) separately.
  const stripAttrs = (el) => {
    Array.from(el.attributes).forEach((a) => {
      const n = a.name.toLowerCase();
      if (n !== 'colspan' && n !== 'rowspan' && n !== 'scope') el.removeAttribute(a.name);
    });
  };
  stripAttrs(table);
  table.querySelectorAll('*').forEach(stripAttrs);
  // 4) Drop Word width hints.
  table.querySelectorAll('colgroup, col').forEach((e) => e.remove());
  table.className = 'article-table';
  return table.outerHTML;
}

// Derive the plain-text caption of a table block (the label text after the bold
// "Table N." / manual prefix). Used to pre-fill the edit dialog.
function _tableCaptionText(block) {
  if (!block) return '';
  const lp = block.querySelector(':scope > p.table-label') || block.querySelector(':scope > p');
  if (!lp) return '';
  const clone = lp.cloneNode(true);
  const s = clone.querySelector(':scope > strong, :scope > b');
  if (s) s.remove(); // drop the bold "Table N." / manual prefix
  let txt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
  // If there was no bold wrapper, defensively strip a leading "Table N." prefix.
  if (!s) txt = txt.replace(/^\s*(?:tables?|tablolar?|tablo|tab\.?)\s*\d+[a-z]?\s*[.:\-–—]?\s*/i, '').trim();
  return txt.replace(/^\s*[.:\-–—]\s*/, '').trim();
}

// Bubble action: add a NEW table — or, when `editNum` is given, EDIT the existing
// `#table-${editNum}` block in place — by PASTING Word/Excel content (not by
// uploading an image). Opens a dialog with a paste target + label + optional
// caption. In INSERT mode it wraps the pasted <table> as a numbered `#table-N`
// block at the cursor; in EDIT mode it updates the existing block's label,
// caption, and (if a table is pasted/edited) its content, keeping the same id
// and document position. Falls back to image upload (insert mode only).
function _insertInlineTable(prefix, editNum) {
  const visual = document.getElementById(prefix + '-visual');
  if (!visual) return;
  const editing = Number.isInteger(editNum) && editNum > 0;
  const editBlock = editing ? visual.querySelector('#table-' + editNum) : null;
  if (editing && !editBlock) { toast('Düzenlenecek tablo bulunamadı', 'warning'); return; }

  // Capture the editor caret NOW — interacting with the dialog's paste area
  // moves the document selection and would otherwise lose the insertion point.
  const stashRange = (_crossRefSelection[prefix] && _crossRefSelection[prefix].range)
    ? _crossRefSelection[prefix].range.cloneRange() : null;

  // Pre-compute the AUTO default label so the Etiket field shows the number the
  // table would get automatically. Editing it locks the label (B rule). In edit
  // mode the number is fixed to the block being edited.
  let dlgNextNum;
  if (editing) {
    dlgNextNum = editNum;
  } else {
    try {
      const t0 = _scanCrossRefTargets(prefix);
      dlgNextNum = (t0.tables && t0.tables.length) ? Math.max(...t0.tables.map((t) => t.num)) + 1 : 1;
    } catch { dlgNextNum = 1; }
  }
  const tblAutoDefault = `Table ${dlgNextNum}`;
  // Edit-mode prefills: existing manual label (or auto default), caption text,
  // and the current <table> HTML so the user sees what they're editing.
  const prefillLabel = editing ? (_blockManualLabel(editBlock) || tblAutoDefault) : tblAutoDefault;
  const prefillCaption = editing ? _tableCaptionText(editBlock) : '';
  const prefillTableHtml = editing ? (editBlock.querySelector('table') ? editBlock.querySelector('table').outerHTML : '') : '';
  const isImageTable = editing && !editBlock.querySelector('table') && !!editBlock.querySelector('img');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:640px">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <div>
          <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">${editing ? 'Tabloyu Düzenle' : "Yeni Tablo (Word'den yapıştır)"}</h3>
          <p class="text-xs mt-0.5" style="color:var(--text-muted)">${editing
            ? 'Etiketi/başlığı değiştirin; tablo içeriğini aşağıdaki alanda doğrudan düzenleyebilir veya Word/Excel\'den yeniden yapıştırabilirsiniz.'
            : "Word/Excel'deki tabloyu seçip kopyalayın, aşağıdaki alana <strong>Ctrl+V</strong> ile yapıştırın. Tablo gerçek bir tablo olarak (resim değil) eklenir."}</p>
        </div>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="px-6 py-4 space-y-3">
        <div><label class="label">Etiket</label>
          <input id="itbl-label" class="input" placeholder="Table 1" value="${esc(prefillLabel)}" data-auto-default="${esc(tblAutoDefault)}">
          <p class="text-xs mt-1" style="color:var(--text-faint)">Başlığın başında <strong>kalın</strong> görünür (ör. <strong>Tablo 1a</strong>). Değiştirmezseniz otomatik numaralanır.</p></div>
        <div><label class="label">Tablo başlığı <span class="font-normal" style="color:var(--text-faint)">(opsiyonel)</span></label>
          <input id="itbl-caption" class="input" placeholder="Örn. Hastaların temel özellikleri" value="${esc(prefillCaption)}"></div>
        <div${isImageTable ? ' style="display:none"' : ''}>
          <label class="label">${editing ? 'Tablo içeriği (düzenleyin veya yeniden yapıştırın)' : 'Tabloyu buraya yapıştırın'}</label>
          <div id="itbl-paste" contenteditable="true" class="input" style="min-height:140px;max-height:300px;overflow:auto;background:#fff" data-placeholder="Word/Excel tablosunu buraya yapıştırın (Ctrl+V)…">${prefillTableHtml}</div>
          <p id="itbl-hint" class="text-xs mt-1" style="color:var(--text-faint)">${editing ? 'Hücreleri doğrudan tıklayıp düzenleyebilirsiniz.' : 'Yapıştırdıktan sonra önizleme burada görünür.'}</p>
        </div>
        ${isImageTable ? '<p class="text-xs" style="color:var(--text-faint)">Bu tablo bir görsel olarak eklenmiş — burada yalnızca etiket ve başlığı düzenleyebilirsiniz.</p>' : ''}
      </div>
      <div class="flex items-center justify-between gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
        ${editing ? '<span></span>' : `<label class="btn btn-secondary btn-sm cursor-pointer" title="Tablo bir resimse, görsel olarak yükleyin">
          Bunun yerine görsel yükle
          <input id="itbl-img" type="file" accept="image/*,.tif,.tiff" class="hidden">
        </label>`}
        <div class="flex gap-2">
          <button data-action="cancel" class="btn btn-secondary">İptal</button>
          <button data-action="insert" class="btn btn-primary">${editing ? 'Kaydet' : 'Tabloyu Ekle'}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const pasteEl = overlay.querySelector('#itbl-paste');
  const hintEl = overlay.querySelector('#itbl-hint');
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('[data-action="cancel"]').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  setTimeout(() => { try { pasteEl.focus(); } catch (_) {} }, 30);

  // Live feedback: show how many rows/cols were detected after a paste.
  pasteEl.addEventListener('input', () => {
    const t = pasteEl.querySelector('table');
    if (t) {
      const rows = t.querySelectorAll('tr').length;
      const cols = t.querySelector('tr') ? t.querySelector('tr').children.length : 0;
      hintEl.textContent = `Tablo algılandı: ${rows} satır × ${cols} sütun.`;
      hintEl.style.color = 'var(--success-text)';
    } else if ((pasteEl.textContent || '').trim()) {
      hintEl.textContent = 'Henüz tablo algılanmadı — Word/Excel\'den bir tablo seçip kopyaladığınızdan emin olun.';
      hintEl.style.color = 'var(--warning-text)';
    }
  });

  // Fallback: upload a table image instead (insert mode only — the input is not
  // rendered in edit mode).
  const imgInput = overlay.querySelector('#itbl-img');
  if (imgInput) {
    imgInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      close();
      _crossRefSelection[prefix] = stashRange ? { range: stashRange, text: '' } : null;
      _uploadInlineMedia(prefix, 'table', file);
    };
  }

  overlay.querySelector('[data-action="insert"]').onclick = () => {
    const tableEl = pasteEl ? pasteEl.querySelector('table') : null;
    // A table is required when CREATING, and when editing a real (non-image)
    // table. An image-based table can be saved with only label/caption changes.
    if (!tableEl && !(editing && isImageTable)) {
      toast('Yapıştırılan içerikte tablo bulunamadı. Word/Excel\'de tabloyu seçip kopyalayın.', 'warning');
      return;
    }
    const caption = (overlay.querySelector('#itbl-caption').value || '').trim();
    // B rule: lock the label only if the user changed it from the auto default.
    const labelEl = overlay.querySelector('#itbl-label');
    const labelVal = labelEl ? labelEl.value.trim() : '';
    const autoDef  = labelEl ? (labelEl.dataset.autoDefault || '') : '';
    const manualLabel = (labelVal && labelVal !== autoDef) ? labelVal : '';

    // ── EDIT MODE: update the existing block in place (keep id + position) ──
    if (editing) {
      const block = visual.querySelector('#table-' + editNum);
      if (!block) { toast('Tablo bulunamadı', 'warning'); close(); return; }
      if (manualLabel) block.setAttribute('data-label', manualLabel.replace(/[.\s]+$/, ''));
      else block.removeAttribute('data-label');
      // Refresh the label line.
      let labelP = block.querySelector(':scope > p.table-label');
      if (!labelP) {
        labelP = document.createElement('p');
        labelP.className = 'table-label';
        block.insertBefore(labelP, block.firstChild);
      }
      labelP.setAttribute('contenteditable', 'false');
      labelP.innerHTML = _tableLabelHtml(editNum, esc(caption), manualLabel);
      // Replace the table content if the user pasted/edited one.
      if (tableEl) {
        const tmp = document.createElement('div');
        tmp.innerHTML = _cleanPastedTable(tableEl);
        const newTable = tmp.firstElementChild;
        const oldTable = block.querySelector(':scope > table');
        if (oldTable && newTable) oldTable.replaceWith(newTable);
        else if (newTable) block.appendChild(newTable);
      }
      close();
      markDirty();
      if (typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(visual);
      if (typeof _autoLinkInEditor === 'function') _autoLinkInEditor(visual);
      _renderCrossRefBubble(prefix);
      toast(`Tablo ${editNum} güncellendi`, 'success');
      return;
    }

    // ── INSERT MODE ──
    const targets = _scanCrossRefTargets(prefix);
    const nextNum = (targets.tables && targets.tables.length)
      ? Math.max(...targets.tables.map((t) => t.num)) + 1 : 1;
    const cleanTable = _cleanPastedTable(tableEl);
    close();

    // Build the block as a DOM node and insert it as a direct child of the
    // editor, right AFTER the paragraph holding the caret. We avoid
    // execCommand('insertHTML') here because it mangles a block (<div> with a
    // nested <p> + <table>) when the caret sits inside a <p> — it was dropping
    // the <p class="table-label"> caption line.
    const blockNode = document.createElement('div');
    blockNode.className = 'article-table-wrap';
    blockNode.id = `table-${nextNum}`;
    if (manualLabel) blockNode.setAttribute('data-label', manualLabel.replace(/[.\s]+$/, ''));
    blockNode.innerHTML =
      `<p class="table-label" contenteditable="false">${_tableLabelHtml(nextNum, esc(caption), manualLabel)}</p>` + cleanTable;

    visual.focus();
    let hostBlock = null;
    if (stashRange) {
      let node = stashRange.startContainer;
      if (node && node.nodeType === 3) node = node.parentNode;
      hostBlock = node && node.closest ? node.closest('p, div, li, h1, h2, h3, h4, h5, h6, blockquote, figure, table') : null;
      while (hostBlock && hostBlock.parentNode && hostBlock.parentNode !== visual) hostBlock = hostBlock.parentNode;
    }
    if (hostBlock && hostBlock.parentNode === visual) {
      // If the caret sits on an EMPTY line (a blank <p> the user made to place
      // the table), insert the table IN PLACE of it — replacing the empty line
      // rather than dropping the table one row BELOW it, which would leave an
      // extra blank line. Otherwise (caret inside a real paragraph) insert right
      // after that block, since a table can't live inside a text paragraph.
      const isEmptyHost = /^(P|DIV)$/.test(hostBlock.tagName)
        && !(hostBlock.textContent || '').trim()
        && !hostBlock.querySelector('img, table');
      if (isEmptyHost) {
        hostBlock.parentNode.replaceChild(blockNode, hostBlock);
      } else {
        hostBlock.parentNode.insertBefore(blockNode, hostBlock.nextSibling);
      }
    } else {
      visual.appendChild(blockNode);
    }
    markDirty();
    if (typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(visual);
    if (typeof _autoLinkInEditor === 'function') _autoLinkInEditor(visual);
    _renderCrossRefBubble(prefix);
    toast(`Tablo ${nextNum} eklendi`, 'success');
  };
}

function _positionCrossRefBubble(range) {
  const bubble = ensureCrossRefBubble();
  bubble.classList.remove('hidden');
  // Measure after render so we know the bubble's height.
  const rect = range.getBoundingClientRect();
  const bubbleRect = bubble.getBoundingClientRect();
  const margin = 8;
  // Always place the bubble BELOW the selection — never above. (Requested:
  // the pop-up should consistently appear under the selected text.)
  const top = rect.bottom + window.scrollY + margin;
  const flip = 'below';
  let left = rect.left + window.scrollX + (rect.width / 2) - (bubbleRect.width / 2);
  // Keep inside viewport horizontally.
  const minLeft = window.scrollX + 8;
  const maxLeft = window.scrollX + window.innerWidth - bubbleRect.width - 8;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;
  bubble.style.top = top + 'px';
  bubble.style.left = left + 'px';
  if (flip) bubble.dataset.flip = flip;
  else bubble.removeAttribute('data-flip');
}

// Toolbar entry point for the cross-ref pop-up. Opens the SAME bubble that
// appears on text selection, anchored to the current caret/selection — so the
// user can add/link a figure, table (incl. paste-a-table) or reference without
// first selecting text. Pinned so the collapsed-selection auto-hide doesn't
// close it immediately; dismissed by outside click, Escape, or a chip insert.
function openCrossRefMenu(prefix) {
  const visual = document.getElementById(prefix + '-visual');
  if (!visual) { toast('Önce Tam Metin sekmesini açın.', 'warning'); return; }
  // Capture the user's caret/selection BEFORE focus(): calling focus() on a
  // contenteditable that has no current caret moves it to the START, which would
  // make a "+ Yeni Tablo" insert land at the TOP instead of where the user is.
  // The toolbar button's onmousedown→preventDefault keeps the live selection
  // intact, so reading it here gives the real caret.
  const sel = window.getSelection();
  let range = null;
  if (sel && sel.rangeCount && visual.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0).cloneRange();
  }
  visual.focus();
  if (!range) {
    // No caret in the editor → default to the END of the document (a sensible
    // place to append a new table/figure), never the start.
    range = document.createRange();
    range.selectNodeContents(visual);
    range.collapse(false);
    try { sel.removeAllRanges(); sel.addRange(range); } catch (_) { /* ignore */ }
  }
  _crossRefSelection[prefix] = { range: range.cloneRange(), text: range.toString() };
  _crossRefBubblePinned = true;
  _renderCrossRefBubble(prefix);
  // Anchor to the caret rect; fall back to the editor's top-left when the rect
  // is degenerate (e.g. caret in an empty block reports a 0×0 rect at 0,0).
  const r = range.getBoundingClientRect();
  const anchor = (r && (r.height || r.width || r.top || r.left))
    ? range
    : { getBoundingClientRect: () => {
        const v = visual.getBoundingClientRect();
        return { top: v.top + 8, bottom: v.top + 32, left: v.left + 16, right: v.left + 40, width: 24, height: 24 };
      } };
  _positionCrossRefBubble(anchor);
  requestAnimationFrame(() => _positionCrossRefBubble(anchor));
}

// Global selectionchange listener — one per page, finds whichever FT visual
// editor (article or AIP) currently has the user's selection and shows the
// bubble. Hides the bubble when selection collapses or moves elsewhere.
let _crossRefBubbleWired = false;
function _wireCrossRefBubbleOnce() {
  if (_crossRefBubbleWired) return;
  _crossRefBubbleWired = true;

  document.addEventListener('selectionchange', () => {
    // While the user is typing into the bubble's manual number input, focus
    // (and therefore window.getSelection()) is inside the bubble — don't
    // dismiss the bubble it lives in.
    const bubbleEl = document.getElementById('cr-bubble');
    if (bubbleEl && !bubbleEl.classList.contains('hidden')
        && document.activeElement && bubbleEl.contains(document.activeElement)) {
      return;
    }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { if (!_crossRefBubblePinned) hideCrossRefBubble(); return; }
    const range = sel.getRangeAt(0);
    // Detect which FT editor (if any) contains the selection.
    let node = range.commonAncestorContainer;
    if (node && node.nodeType !== 1) node = node.parentNode;
    let prefix = null;
    while (node) {
      if (node.id === 'ft-visual') { prefix = 'ft'; break; }
      if (node.id === 'aip-ft-visual') { prefix = 'aip-ft'; break; }
      node = node.parentNode;
    }
    if (!prefix) { hideCrossRefBubble(); return; }
    if (!range.toString().trim()) { hideCrossRefBubble(); return; }
    // Save selection so chip clicks restore the exact range.
    _crossRefSelection[prefix] = { range: range.cloneRange(), text: range.toString() };
    _renderCrossRefBubble(prefix);
    // Re-position twice: once immediately (best guess) and once after a
    // layout tick (now that the bubble has its real height).
    _positionCrossRefBubble(range);
    requestAnimationFrame(() => _positionCrossRefBubble(range));
  });

  // Hide on outside click (but not on bubble clicks — those would have
  // already inserted via the chip handler).
  document.addEventListener('mousedown', (e) => {
    const bubble = document.getElementById('cr-bubble');
    if (!bubble || bubble.classList.contains('hidden')) return;
    if (bubble.contains(e.target)) return;
    const visual = document.getElementById('ft-visual') || document.getElementById('aip-ft-visual');
    if (visual && visual.contains(e.target)) return;
    hideCrossRefBubble();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCrossRefBubble();
  });
}
// Wire on first script load so the bubble works before any editor renders.
_wireCrossRefBubbleOnce();

async function openSupplementaryPicker(prefix) {
  const articleId = currentArticleIdFromHash();
  if (!articleId) {
    toast('Makaleyi önce kaydedin — kayıtlı bir makale için ek materyal eklenebilir.', 'warning');
    return;
  }

  // Build the candidate list from two sources:
  // 1) Uploaded files on disk (GET /api/media/article/:id/assets)
  // 2) URL rows added in the "Ek Materyaller" panel (live DOM state)
  //
  // The user-defined title for a supplement lives in the "Ek Materyaller"
  // panel rows, not on disk. Pre-build a URL→{label,caption} map from those
  // rows so the file-based candidates inherit the user's title (e.g.
  // "Supplement 3") instead of falling back to the raw filename.
  const userMeta = {};
  document.querySelectorAll('.supp-link-row').forEach((r) => {
    const url = (r.querySelector('.sl-href')?.value || '').trim();
    if (!url) return;
    userMeta[url.toLowerCase()] = {
      label: (r.querySelector('.sl-label')?.value || '').trim(),
      caption: (r.querySelector('.sl-caption')?.value || '').trim(),
    };
  });

  const candidates = [];
  try {
    const assets = await API.get(`/media/article/${articleId}/assets`);
    for (const f of (assets.supplementary || [])) {
      const meta = userMeta[String(f.url || '').toLowerCase()] || {};
      candidates.push({
        source: 'file',
        url: f.url,
        label: meta.label || f.filename,
        caption: meta.caption || '',
        kind: detectSuppKind(f.filename),
      });
    }
  } catch { /* ignore — section just stays empty */ }

  // Live URL rows
  const rows = document.querySelectorAll('.supp-link-row');
  for (const r of rows) {
    const url = (r.querySelector('.sl-href')?.value || '').trim();
    if (!url) continue;
    const label = (r.querySelector('.sl-label')?.value || '').trim() || url.split('/').pop();
    const caption = (r.querySelector('.sl-caption')?.value || '').trim();
    candidates.push({ source: 'url', url, label, caption, kind: detectSuppKind(url) });
  }

  // De-duplicate by URL — uploaded file may also be referenced as a URL row
  const seen = new Set();
  const items = [];
  for (const c of candidates) {
    const key = c.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(c);
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:680px">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">Ek Materyal Ekle</h3>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="px-6 py-4">
        <p class="text-sm mb-3" style="color:var(--text)">
          Yüklediğiniz ek materyaller. Bir dosya seçin, ne şekilde ekleneceğini belirleyin ve <strong>Ekle</strong> butonuna basın — tam metin imlecinizin olduğu yere otomatik yerleşir.
        </p>
        ${items.length === 0 ? `
          <div class="text-center py-8" style="color:var(--text-muted)">
            <p class="text-sm">Bu makale için yüklü ek materyal yok.</p>
            <p class="text-xs mt-1">Önce <strong>Dosyalar</strong> sekmesinden dosya yükleyin veya URL ekleyin.</p>
          </div>
        ` : `
          <div class="space-y-2" style="max-height:360px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:var(--radius-md);padding:8px">
            ${items.map((it, i) => `
              <label class="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-gray-50" style="border:1px solid transparent" data-supp-row="${i}">
                <input type="radio" name="supp-pick" value="${i}" class="text-teal-600" ${i === 0 ? 'checked' : ''}>
                <span style="flex-shrink:0;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:#f0fdfa;color:#0f766e">
                  ${suppKindIcon(it.kind)}
                </span>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium truncate" style="color:var(--text-strong)">${esc(it.label)}</div>
                  <div class="text-xs flex items-center gap-2 mt-0.5">
                    <span class="badge" style="background:#f3f4f6;color:#6b7280;font-size:10px;padding:1px 6px">${suppKindLabel(it.kind)}</span>
                    <code style="color:var(--text-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.url)}</code>
                  </div>
                </div>
              </label>
            `).join('')}
          </div>

          <div class="mt-4 pt-3" style="border-top:1px solid var(--border-soft)">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium" style="color:var(--text-strong)">Nasıl eklensin?</span>
                <div class="inline-flex items-center bg-gray-100 rounded-lg p-0.5 text-xs font-medium select-none" id="supp-mode">
                  <button type="button" data-mode="link"  class="mode-btn px-3 py-1.5 rounded-md bg-white shadow-sm text-teal-700">Link</button>
                  <button type="button" data-mode="embed" class="mode-btn px-3 py-1.5 rounded-md text-gray-500 hover:text-gray-800">Göm (görsel/video)</button>
                </div>
              </div>
              <div class="flex-1 min-w-[200px]">
                <input id="supp-custom-label" type="text" placeholder="Görünen metin (boşsa dosya adı)" class="w-full px-3 py-1.5 text-sm rounded-lg" style="border:1px solid var(--border)">
              </div>
            </div>
          </div>
        `}
      </div>
      <div class="flex justify-end gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
        <button data-action="cancel" class="btn btn-secondary">İptal</button>
        ${items.length > 0 ? '<button data-action="insert" class="btn btn-primary">Editöre Ekle</button>' : ''}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Mode switch
  let mode = 'link';
  overlay.querySelectorAll('#supp-mode .mode-btn').forEach(btn => {
    btn.onclick = () => {
      mode = btn.dataset.mode;
      overlay.querySelectorAll('#supp-mode .mode-btn').forEach(b => {
        b.classList.toggle('bg-white', b === btn);
        b.classList.toggle('shadow-sm', b === btn);
        b.classList.toggle('text-teal-700', b === btn);
        b.classList.toggle('text-gray-500', b !== btn);
      });
    };
  });

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  overlay.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  overlay.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.action !== 'insert') { close(); return; }
      const picked = overlay.querySelector('input[name="supp-pick"]:checked');
      if (!picked) { toast('Bir dosya seçin', 'warning'); return; }
      const it = items[Number(picked.value)];
      const customLabel = overlay.querySelector('#supp-custom-label')?.value.trim() || it.label;
      const html = buildSupplementaryInsertHtml(it, mode, customLabel);
      close();
      htmlEditorInsertHtml(prefix, html);
      toast(`"${customLabel}" tam metne eklendi`);
    };
  });
}

function buildSupplementaryInsertHtml(item, mode, label) {
  const url = item.url;
  const safeLabel = esc(label || item.label || 'Ek Materyal');
  const caption = item.caption ? `<figcaption style="font-size:0.875rem;color:#6b7280;margin-top:0.5rem">${esc(item.caption)}</figcaption>` : '';
  // Image / video embed only valid for the matching kind
  if (mode === 'embed' && item.kind === 'image') {
    return `<figure><img src="${esc(url)}" alt="${safeLabel}" style="max-width:100%;height:auto" />${caption}</figure>`;
  }
  if (mode === 'embed' && item.kind === 'video') {
    return `<figure><video controls preload="metadata" style="max-width:100%"><source src="${esc(url)}"></video>${caption}</figure>`;
  }
  if (mode === 'embed' && item.kind === 'audio') {
    return `<figure><audio controls preload="metadata" style="width:100%"><source src="${esc(url)}"></audio>${caption}</figure>`;
  }
  // Default → link (also fallback when "embed" requested on non-media)
  const kindHint = item.kind !== 'file' ? ` <span style="color:#6b7280;font-size:0.85em">(${suppKindLabel(item.kind)})</span>` : '';
  return `<p><a href="${esc(url)}" target="_blank" rel="noopener">${safeLabel}</a>${kindHint}</p>`;
}

function htmlEditorInsertHtml(prefix, html) {
  const visual = document.getElementById(`${prefix}-visual`);
  if (!visual) return;
  // If user is in source mode, append to textarea instead
  const mode = _htmlEditorModes[prefix];
  if (mode === 'source') {
    const source = document.getElementById(`${prefix}-source`);
    if (source) { source.value += (source.value.endsWith('\n') ? '' : '\n') + html + '\n'; markDirty(); }
    return;
  }
  visual.focus();
  // Restore cursor to end if there's no selection inside the editor
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !visual.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(visual);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  document.execCommand('insertHTML', false, html);
  markDirty();
}

// ═══════════════════════════════════════════════════════════════════════════
//  RICH MEDIA INSERTION — image / video / YouTube
//  Shared by the page editor (htmlEditor 'simple' variant) and the section
//  editor (pageSectionBlock). Each opens a small dialog (upload-or-URL) and
//  inserts responsive, self-contained HTML at the caret. The builders below
//  are also valid in the public site's prose (plain <figure>/<img>/<video>/
//  <iframe>), so saved pages render with no extra CSS.
// ═══════════════════════════════════════════════════════════════════════════
const _mediaImageIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21"/></svg>';
const _mediaVideoIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="14" height="14" rx="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M16 10l6-3v10l-6-3"/></svg>';
const _mediaYouTubeIcon = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>';

// Extract the 11-char video id from any common YouTube URL form (watch?v=,
// youtu.be/, /embed/, /shorts/, /v/) or accept a bare id. Returns '' if none.
function _youTubeId(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) { const m = s.match(re); if (m) return m[1]; }
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return '';
}

function _mediaCaptionHtml(caption) {
  return caption ? `<figcaption style="margin-top:8px;font-size:0.875rem;color:#475569;text-align:center">${esc(caption)}</figcaption>` : '';
}
function _buildImageHtml(url, alt, caption, widthPct) {
  const wp = Math.max(10, Math.min(100, Number(widthPct) || 100));
  return `<figure class="page-media" style="margin:1.5rem auto;max-width:${wp}%">`
    + `<img src="${esc(url)}" alt="${esc(alt || '')}" loading="lazy" style="width:100%;height:auto;display:block;border-radius:8px">`
    + `${_mediaCaptionHtml(caption)}</figure>`;
}
function _buildVideoHtml(url, caption) {
  return `<figure class="page-media" style="margin:1.5rem auto;max-width:100%">`
    + `<video controls preload="metadata" playsinline style="width:100%;height:auto;display:block;border-radius:8px;background:#000">`
    + `<source src="${esc(url)}">Tarayıcınız gömülü videoyu desteklemiyor.</video>`
    + `${_mediaCaptionHtml(caption)}</figure>`;
}
function _buildYouTubeHtml(id, caption) {
  const title = caption ? esc(caption) : 'YouTube video';
  return `<figure class="page-media page-embed" style="margin:1.5rem auto;max-width:720px">`
    + `<div style="position:relative;width:100%;padding-top:56.25%;border-radius:8px;overflow:hidden;background:#000">`
    + `<iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${title}" loading="lazy" `
    + `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen `
    + `style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>`
    + `${_mediaCaptionHtml(caption)}</figure>`;
}

// Capture the caret inside `el` NOW (before a modal steals focus) and return an
// inserter that restores it and drops `html` at that point — falling back to the
// end of the editor if the selection was lost. Works for any contenteditable
// (htmlEditor visual surface or a section's .ps-content).
function _mediaInserterForEl(el) {
  let saved = null;
  const sel = window.getSelection();
  if (el && sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    if (el.contains(r.commonAncestorContainer)) saved = r.cloneRange();
  }
  return (html) => {
    if (!el) return;
    el.focus();
    const s = window.getSelection();
    if (saved) { s.removeAllRanges(); s.addRange(saved); }
    else if (!s.rangeCount || !el.contains(s.anchorNode)) {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      s.removeAllRanges(); s.addRange(r);
    }
    document.execCommand('insertHTML', false, html);
    markDirty();
  };
}

// Generic modal shell for the three media dialogs. `bodyHtml` is the form; the
// onInsert callback receives the overlay element and an async-safe `done()` to
// close it. Returns nothing; manages its own lifecycle.
function _openMediaDialog(title, bodyHtml, onInsert) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:460px">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">${esc(title)}</h3>
        <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="px-6 py-4 space-y-3">${bodyHtml}</div>
      <div class="flex justify-end gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
        <button data-action="cancel" class="btn btn-secondary">İptal</button>
        <button data-action="insert" class="btn btn-primary">Ekle</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('[data-action="cancel"]').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-action="insert"]').onclick = () => onInsert(overlay, close);
  // Convenience: a "Dosya seç" trigger button maps to a hidden file input.
  const trigger = overlay.querySelector('[data-file-trigger]');
  const fileInput = overlay.querySelector('input[type="file"]');
  if (trigger && fileInput) {
    trigger.onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const nameEl = overlay.querySelector('[data-file-name]');
      if (nameEl) nameEl.textContent = fileInput.files[0] ? fileInput.files[0].name : 'Dosya seçilmedi';
    };
  }
  setTimeout(() => { const f = overlay.querySelector('input:not([type=file]), textarea'); if (f) f.focus(); }, 30);
  return overlay;
}

// ── Image ───────────────────────────────────────────────────────────────────
function openMediaImageDialog(inserter) {
  const body = `
    <p class="text-xs" style="color:var(--text-muted)">Bilgisayardan resim yükleyin <strong>veya</strong> bir resim URL'si yapıştırın.</p>
    <div>
      <input type="file" accept="image/*" class="hidden">
      <div class="flex items-center gap-2">
        <button type="button" data-file-trigger class="btn btn-secondary">Dosya seç</button>
        <span data-file-name class="text-xs" style="color:var(--text-faint)">Dosya seçilmedi</span>
      </div>
    </div>
    <div><label class="label">veya Resim URL'si</label><input id="md-img-url" class="input" placeholder="https://… veya images/foto.jpg"></div>
    <div><label class="label">Alternatif metin <span class="font-normal" style="color:var(--text-faint)">(erişilebilirlik / SEO)</span></label><input id="md-img-alt" class="input" placeholder="Resmi kısaca tanımlayın"></div>
    <div><label class="label">Açıklama <span class="font-normal" style="color:var(--text-faint)">(opsiyonel)</span></label><input id="md-img-cap" class="input" placeholder="Resmin altında görünür"></div>
    <div><label class="label">Genişlik: <span id="md-img-wv">100</span>%</label><input id="md-img-w" type="range" min="20" max="100" value="100" step="5" class="w-full" oninput="document.getElementById('md-img-wv').textContent=this.value"></div>`;
  _openMediaDialog('Resim Ekle', body, async (overlay, close) => {
    const fileInput = overlay.querySelector('input[type="file"]');
    const url = overlay.querySelector('#md-img-url').value.trim();
    const alt = overlay.querySelector('#md-img-alt').value.trim();
    const cap = overlay.querySelector('#md-img-cap').value.trim();
    const w = overlay.querySelector('#md-img-w').value;
    let finalUrl = url;
    if (fileInput.files[0]) {
      const btn = overlay.querySelector('[data-action="insert"]');
      btn.disabled = true; btn.textContent = 'Yükleniyor…';
      try {
        const result = await API.uploadFile('/media/upload/image', fileInput.files[0], 'image');
        finalUrl = result.url;
      } catch (err) { toast('Resim yüklenemedi: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Ekle'; return; }
    }
    if (!finalUrl) { toast('Bir dosya seçin veya URL girin', 'warning'); return; }
    close();
    inserter(_buildImageHtml(finalUrl, alt, cap, w));
  });
}

// ── Video (self-hosted file or direct URL) ───────────────────────────────────
function openMediaVideoDialog(inserter) {
  const body = `
    <p class="text-xs" style="color:var(--text-muted)">Bir video dosyası yükleyin (mp4/webm) <strong>veya</strong> doğrudan video URL'si girin. YouTube için "YouTube" butonunu kullanın.</p>
    <div>
      <input type="file" accept="video/*" class="hidden">
      <div class="flex items-center gap-2">
        <button type="button" data-file-trigger class="btn btn-secondary">Dosya seç</button>
        <span data-file-name class="text-xs" style="color:var(--text-faint)">Dosya seçilmedi</span>
      </div>
    </div>
    <div><label class="label">veya Video URL'si</label><input id="md-vid-url" class="input" placeholder="https://… .mp4"></div>
    <div><label class="label">Açıklama <span class="font-normal" style="color:var(--text-faint)">(opsiyonel)</span></label><input id="md-vid-cap" class="input" placeholder="Videonun altında görünür"></div>`;
  _openMediaDialog('Video Ekle', body, async (overlay, close) => {
    const fileInput = overlay.querySelector('input[type="file"]');
    const url = overlay.querySelector('#md-vid-url').value.trim();
    const cap = overlay.querySelector('#md-vid-cap').value.trim();
    let finalUrl = url;
    if (fileInput.files[0]) {
      const btn = overlay.querySelector('[data-action="insert"]');
      btn.disabled = true; btn.textContent = 'Yükleniyor…';
      try {
        const result = await API.uploadFile('/media/upload/video', fileInput.files[0], 'video');
        finalUrl = result.url;
      } catch (err) { toast('Video yüklenemedi: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Ekle'; return; }
    }
    if (!finalUrl) { toast('Bir dosya seçin veya URL girin', 'warning'); return; }
    close();
    inserter(_buildVideoHtml(finalUrl, cap));
  });
}

// ── YouTube embed ────────────────────────────────────────────────────────────
function openMediaYouTubeDialog(inserter) {
  const body = `
    <p class="text-xs" style="color:var(--text-muted)">YouTube video bağlantısını yapıştırın — otomatik olarak duyarlı (responsive) bir oynatıcıya dönüştürülür.</p>
    <div><label class="label">YouTube bağlantısı</label><input id="md-yt-url" class="input" placeholder="https://www.youtube.com/watch?v=… veya https://youtu.be/…"></div>
    <div><label class="label">Açıklama <span class="font-normal" style="color:var(--text-faint)">(opsiyonel)</span></label><input id="md-yt-cap" class="input" placeholder="Videonun altında görünür"></div>`;
  _openMediaDialog('YouTube Videosu Ekle', body, (overlay, close) => {
    const url = overlay.querySelector('#md-yt-url').value.trim();
    const cap = overlay.querySelector('#md-yt-cap').value.trim();
    const id = _youTubeId(url);
    if (!id) { toast('Geçerli bir YouTube bağlantısı girin', 'warning'); return; }
    close();
    inserter(_buildYouTubeHtml(id, cap));
  });
}

// ── Thin wrappers: page editor (htmlEditor) ──────────────────────────────────
function htmlEditorInsertImage(prefix) { openMediaImageDialog((html) => htmlEditorInsertHtml(prefix, html)); }
function htmlEditorInsertVideo(prefix) { openMediaVideoDialog((html) => htmlEditorInsertHtml(prefix, html)); }
function htmlEditorInsertYouTube(prefix) { openMediaYouTubeDialog((html) => htmlEditorInsertHtml(prefix, html)); }

// ── Thin wrappers: section editor (pageSectionBlock) ─────────────────────────
function sectionInsertMedia(btn, kind) {
  const content = btn.closest('.page-section')?.querySelector('.ps-content');
  if (!content) return;
  const inserter = _mediaInserterForEl(content);
  if (kind === 'image') openMediaImageDialog(inserter);
  else if (kind === 'video') openMediaVideoDialog(inserter);
  else if (kind === 'youtube') openMediaYouTubeDialog(inserter);
}

function setHtmlEditorMode(prefix, mode) {
  const visual = document.getElementById(`${prefix}-visual`);
  const source = document.getElementById(`${prefix}-source`);
  const toolbar = document.getElementById(`${prefix}-toolbar`);
  const sw = document.getElementById(`${prefix}-modeswitch`);
  if (!visual || !source) return;
  if (mode === _htmlEditorModes[prefix]) return; // no-op
  if (mode === 'source') {
    // Visual → Source: sync innerHTML into textarea
    source.value = visual.innerHTML;
    visual.classList.add('hidden');
    if (toolbar) toolbar.classList.add('hidden');
    source.classList.remove('hidden');
  } else {
    // Source → Visual: sync textarea into innerHTML
    visual.innerHTML = source.value;
    source.classList.add('hidden');
    visual.classList.remove('hidden');
    if (toolbar) toolbar.classList.remove('hidden');
  }
  _htmlEditorModes[prefix] = mode;
  // Update segmented-control active styles
  if (sw) {
    sw.querySelectorAll('.mode-btn').forEach((btn) => {
      const isActive = btn.dataset.mode === mode;
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) {
        btn.classList.add('bg-white', 'shadow-sm', mode === 'visual' ? 'text-teal-700' : 'text-gray-900');
        btn.classList.remove('text-gray-500', 'hover:text-gray-800');
      } else {
        btn.classList.remove('bg-white', 'shadow-sm', 'text-teal-700', 'text-gray-900');
        btn.classList.add('text-gray-500', 'hover:text-gray-800');
      }
    });
  }
}

// Backwards-compatible toggle (kept in case any caller still references it)
function toggleHtmlEditor(prefix) {
  const next = _htmlEditorModes[prefix] === 'visual' ? 'source' : 'visual';
  setHtmlEditorMode(prefix, next);
}

function getHtmlEditorContent(prefix) {
  const mode = _htmlEditorModes[prefix] || 'visual';
  if (mode === 'visual') {
    return (document.getElementById(`${prefix}-visual`)?.innerHTML || '').trim();
  }
  return (document.getElementById(`${prefix}-source`)?.value || '').trim();
}

function setHtmlEditorContent(prefix, html) {
  const visual = document.getElementById(`${prefix}-visual`);
  const source = document.getElementById(`${prefix}-source`);
  if (visual) visual.innerHTML = html || '';
  if (source) source.value = html || '';
  // Wholesale content load (initial fetch, file/ZIP import, draft recovery) is a
  // NEW baseline, not an undoable edit — reset history so the first Ctrl+Z can't
  // wipe freshly-loaded content back to the empty pre-load state.
  if (visual && _editorHistory[prefix]) _initEditorHistory(prefix, visual);
}

// Attach a paste handler to all WYSIWYG visual editors so pasted content is
// always interpreted as HTML (clipboard HTML if available, else plain text
// promoted to <p> blocks). This prevents the case where a user pastes raw HTML
// markup and sees the tags as literal text.
function attachWysiwygPasteHandler(visualEl) {
  if (!visualEl || visualEl._pasteAttached) return;
  visualEl._pasteAttached = true;
  visualEl.addEventListener('paste', (e) => {
    if (!e.clipboardData) return;
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    // If the clipboard has rich HTML, sanitize and insert it directly.
    if (html && html.trim()) {
      e.preventDefault();
      const cleaned = sanitizeUploadedHtml(html);
      document.execCommand('insertHTML', false, cleaned);
      _afterRichPaste(visualEl);
      return;
    }
    // If only plain text, check whether the user pasted *raw HTML markup*
    // (typical case for users who copy from a code editor). Detect tags and
    // insert as HTML instead of literal text. Otherwise let the browser do
    // its default plain-text paste.
    if (text && /<[a-z][\s\S]*?>/i.test(text)) {
      e.preventDefault();
      const cleaned = sanitizeUploadedHtml(text);
      document.execCommand('insertHTML', false, cleaned);
      _afterRichPaste(visualEl);
    }
    // else: fall through, default plain-text paste
  });
}

// Right after a rich (Word/HTML) paste, promote bold heading paragraphs to real
// H2/H3 — with level detection by font size / caps — so the editor reflects the
// final structure immediately instead of only after "Otomatik Düzenle" or reload.
// Idempotent and gated, so a stray inline-bold paste won't become a heading.
// Mirror of article.html's unifyBodyFont: strip inline font-family (+ the
// `font` shorthand, line-height and mso-* leftovers) from every element in the
// editor body so pasted Word/Office faces (Calibri, Cambria, Times New Roman…)
// can never override the site typeface. font-SIZE, weight, style and color are
// KEPT (sizing/emphasis untouched; the public render uses the same rule). Must
// run AFTER _promoteMsoHeadings, which reads inline font-size to detect headings.
function _unifyBodyFont(visualEl) {
  if (!visualEl || !visualEl.querySelectorAll) return false;
  const FACE = /^(font|font-family|line-height|mso-[\w-]*)$/;
  let changed = false;
  const strip = (el) => {
    if (!el || !el.getAttribute) return;
    const s = el.getAttribute('style');
    if (!s) return;
    const kept = s.split(';').map((d) => d.trim()).filter((d) => {
      if (!d) return false;
      return !FACE.test(d.split(':')[0].trim().toLowerCase());
    });
    const next = kept.length ? kept.join('; ') : null;
    if (next) { if (next !== s) { el.setAttribute('style', next); changed = true; } }
    else { el.removeAttribute('style'); changed = true; }
  };
  strip(visualEl);
  visualEl.querySelectorAll('[style]').forEach(strip);
  visualEl.querySelectorAll('span, font').forEach((sp) => {
    if (!sp.attributes.length) {
      while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp);
      sp.remove();
      changed = true;
    }
  });
  return changed;
}

function _afterRichPaste(visualEl) {
  if (!visualEl) return;
  try { _promoteMsoHeadings(visualEl); } catch (_) { /* non-fatal */ }
  try { if (_unifyBodyFont(visualEl) && typeof markDirty === 'function') markDirty(); } catch (_) { /* non-fatal */ }
}

// ── Undo/redo history + keyboard shortcuts for htmlEditor() editors ──────────
// The native contenteditable undo stack only covers edits the browser makes
// itself (typing, native Ctrl+B). The full-text editor also mutates the DOM
// programmatically (figür/tablo ekleme, Otomatik Düzenle, normalize, atıf
// bağlama) which the browser does NOT record — and that can corrupt its native
// undo. So we keep our own snapshot history (innerHTML strings) fed by a
// MutationObserver, which captures BOTH typing and programmatic changes
// uniformly. One entry per change-burst (debounced). Restores are flagged so
// they don't record themselves.
const _editorHistory = {};

function _initEditorHistory(prefix, visual) {
  const old = _editorHistory[prefix];
  if (old && old._observer) { try { old._observer.disconnect(); } catch (_) {} }
  const h = { undo: [], redo: [], last: visual.innerHTML, suppress: false, timer: null, _observer: null };
  _editorHistory[prefix] = h;
  const obs = new MutationObserver(() => _historyRecord(prefix));
  // childList + characterData capture every real edit (typing, bold/italic
  // wrapping, formatBlock, figür/tablo ekleme, removeFormat). We deliberately
  // do NOT watch `attributes`, so transient UI flashes inside the editor
  // (preflight outline highlight, article-ref-broken class) don't pollute undo.
  obs.observe(visual, { childList: true, subtree: true, characterData: true });
  h._observer = obs;
  _updateUndoButtons(prefix);
}

// Debounced: fold the latest content into the undo stack as one step.
function _historyRecord(prefix) {
  const h = _editorHistory[prefix];
  if (!h || h.suppress) return;
  clearTimeout(h.timer);
  h.timer = setTimeout(() => {
    h.timer = null;
    const visual = document.getElementById(prefix + '-visual');
    if (!visual) return;
    const cur = visual.innerHTML;
    if (cur === h.last) return;
    h.undo.push(h.last);
    if (h.undo.length > 100) h.undo.shift();
    h.redo = [];
    h.last = cur;
    _updateUndoButtons(prefix);
  }, 350);
}

// Commit any pending (debounced) change synchronously — call before reading the
// stack so an in-flight typing burst becomes an undoable step.
function _historyFlush(prefix) {
  const h = _editorHistory[prefix];
  if (!h) return;
  if (h.timer) { clearTimeout(h.timer); h.timer = null; }
  const visual = document.getElementById(prefix + '-visual');
  if (!visual) return;
  const cur = visual.innerHTML;
  if (cur !== h.last) {
    h.undo.push(h.last);
    if (h.undo.length > 100) h.undo.shift();
    h.redo = [];
    h.last = cur;
  }
}

function _historyRestore(prefix, html) {
  const h = _editorHistory[prefix];
  const visual = document.getElementById(prefix + '-visual');
  if (!h || !visual) return;
  h.suppress = true; // ignore the mutations our own restore triggers
  visual.innerHTML = html;
  const source = document.getElementById(prefix + '-source');
  if (source) source.value = html;
  h.last = html;
  // Clear suppression after the observer's microtask has drained.
  setTimeout(() => { h.suppress = false; }, 0);
  markDirty();
  _updateUndoButtons(prefix);
  try { visual.focus(); } catch (_) {}
  try { _updateHtmlEditorToolbarState(visual); } catch (_) {}
}

function htmlEditorUndo(prefix) {
  const h = _editorHistory[prefix];
  if (!h) return;
  _historyFlush(prefix);
  if (!h.undo.length) return;
  const prev = h.undo.pop();
  h.redo.push(h.last);
  _historyRestore(prefix, prev);
}

function htmlEditorRedo(prefix) {
  const h = _editorHistory[prefix];
  if (!h) return;
  _historyFlush(prefix);
  if (!h.redo.length) return;
  const next = h.redo.pop();
  h.undo.push(h.last);
  _historyRestore(prefix, next);
}

function _updateUndoButtons(prefix) {
  const h = _editorHistory[prefix];
  if (!h) return;
  const u = document.getElementById(prefix + '-undo');
  const r = document.getElementById(prefix + '-redo');
  if (u) u.disabled = h.undo.length === 0;
  if (r) r.disabled = h.redo.length === 0;
}

// Wire keyboard shortcuts (Ctrl+B/I/U format, Ctrl+Z undo, Ctrl+Shift+Z/Ctrl+Y
// redo) + the snapshot history onto an htmlEditor()-built visual. Scoped to
// editors inside [data-html-editor] so hand-rolled editors keep native behaviour.
function attachEditorShortcuts(visualEl) {
  if (!visualEl || visualEl._editorKbAttached) return;
  if (!visualEl.closest || !visualEl.closest('[data-html-editor]')) return;
  visualEl._editorKbAttached = true;
  const prefix = (visualEl.id || '').replace(/-visual$/, '');
  _initEditorHistory(prefix, visualEl);
  visualEl.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'b' || k === 'i' || k === 'u') {
      // Run our command (toolbar state + markDirty stay in sync) and stop the
      // event so the global Ctrl+B sidebar shortcut never fires.
      e.preventDefault(); e.stopPropagation();
      htmlEditorCmd(prefix, k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
    } else if (k === 'z' && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation(); htmlEditorUndo(prefix);
    } else if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault(); e.stopPropagation(); htmlEditorRedo(prefix);
    }
  });
}

// Wire up paste handlers on all existing visual editors on the page.
// Called from setHtmlEditorMode and after route changes.
function wireAllWysiwygPasteHandlers() {
  document.querySelectorAll('[id$="-visual"][contenteditable="true"]').forEach((v) => {
    attachWysiwygPasteHandler(v);
    attachEditorShortcuts(v);
  });
}

// ── Abstract WYSIWYG editor helpers ──
let _abstractEditorMode = 'visual';

function abstractCmd(command, value) {
  document.getElementById('f-abstractHtml-visual').focus();
  document.execCommand(command, false, value || null);
  markDirty();
}

function setAbstractEditorMode(mode) {
  const visual = document.getElementById('f-abstractHtml-visual');
  const source = document.getElementById('f-abstractHtml');
  const toolbar = document.getElementById('f-abstract-toolbar');
  const sw = document.getElementById('f-abstract-modeswitch');
  if (!visual || !source) return;
  if (mode === _abstractEditorMode) return;
  if (mode === 'source') {
    source.value = visual.innerHTML;
    visual.classList.add('hidden');
    if (toolbar) toolbar.classList.add('hidden');
    source.classList.remove('hidden');
    source.classList.remove('rounded-b-lg');
    source.classList.add('rounded-lg');
  } else {
    visual.innerHTML = source.value;
    source.classList.add('hidden');
    visual.classList.remove('hidden');
    if (toolbar) toolbar.classList.remove('hidden');
    source.classList.add('rounded-b-lg');
    source.classList.remove('rounded-lg');
  }
  _abstractEditorMode = mode;
  if (sw) {
    sw.querySelectorAll('.mode-btn').forEach((btn) => {
      const isActive = btn.dataset.mode === mode;
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) {
        btn.classList.add('bg-white', 'shadow-sm', mode === 'visual' ? 'text-teal-700' : 'text-gray-900');
        btn.classList.remove('text-gray-500', 'hover:text-gray-800');
      } else {
        btn.classList.remove('bg-white', 'shadow-sm', 'text-teal-700', 'text-gray-900');
        btn.classList.add('text-gray-500', 'hover:text-gray-800');
      }
    });
  }
}

function toggleAbstractEditor() {
  setAbstractEditorMode(_abstractEditorMode === 'visual' ? 'source' : 'visual');
}

function getAbstractContent() {
  if (_abstractEditorMode === 'visual') {
    return (document.getElementById('f-abstractHtml-visual')?.innerHTML || '').trim();
  }
  return (document.getElementById('f-abstractHtml')?.value || '').trim();
}

// ── News WYSIWYG editor helpers ──
let _newsEditorMode = 'visual'; // 'visual' | 'source'

function newsEditorCmd(command, value) {
  document.getElementById('fn-content-visual').focus();
  document.execCommand(command, false, value || null);
  markDirty();
}

function newsEditorLink() {
  const url = prompt('Link URL:');
  if (url) {
    document.getElementById('fn-content-visual').focus();
    document.execCommand('createLink', false, url);
    markDirty();
  }
}

function setNewsEditorMode(mode) {
  const visual = document.getElementById('fn-content-visual');
  const source = document.getElementById('fn-content-source');
  const toolbar = document.getElementById('fn-content-toolbar');
  const sw = document.getElementById('fn-content-modeswitch');
  if (!visual || !source) return;
  if (mode === _newsEditorMode) return;
  if (mode === 'source') {
    source.value = visual.innerHTML;
    visual.classList.add('hidden');
    if (toolbar) toolbar.classList.add('hidden');
    source.classList.remove('hidden');
    source.classList.remove('rounded-b-lg');
    source.classList.add('rounded-lg');
  } else {
    visual.innerHTML = source.value;
    source.classList.add('hidden');
    visual.classList.remove('hidden');
    if (toolbar) toolbar.classList.remove('hidden');
    source.classList.add('rounded-b-lg');
    source.classList.remove('rounded-lg');
  }
  _newsEditorMode = mode;
  if (sw) {
    sw.querySelectorAll('.mode-btn').forEach((btn) => {
      const isActive = btn.dataset.mode === mode;
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) {
        btn.classList.add('bg-white', 'shadow-sm', mode === 'visual' ? 'text-teal-700' : 'text-gray-900');
        btn.classList.remove('text-gray-500', 'hover:text-gray-800');
      } else {
        btn.classList.remove('bg-white', 'shadow-sm', 'text-teal-700', 'text-gray-900');
        btn.classList.add('text-gray-500', 'hover:text-gray-800');
      }
    });
  }
}

function toggleNewsEditor() {
  setNewsEditorMode(_newsEditorMode === 'visual' ? 'source' : 'visual');
}

function getNewsContent() {
  const visual = document.getElementById('fn-content-visual');
  const source = document.getElementById('fn-content-source');
  if (_newsEditorMode === 'visual') {
    return (visual ? visual.innerHTML : '').trim();
  }
  return (source ? source.value : '').trim();
}

function updateNewsImagePreview() {
  const url = (document.getElementById('fn-image')?.value || '').trim();
  const preview = document.getElementById('fn-image-preview');
  const img = document.getElementById('fn-image-preview-img');
  const removeBtn = document.getElementById('fn-image-remove');
  if (!preview || !img) return;
  if (url) {
    img.src = '../' + url;
    preview.classList.remove('hidden');
    if (removeBtn) removeBtn.classList.remove('hidden');
  } else {
    img.src = '../' + NEWS_PLACEHOLDER_IMAGE;
    preview.classList.remove('hidden');
    if (removeBtn) removeBtn.classList.add('hidden');
  }
}

async function saveNews(id) {
  const data = {
    title: document.getElementById('fn-title').value.trim(),
    excerpt: document.getElementById('fn-excerpt').value.trim(),
    content: getNewsContent(),
    category: document.getElementById('fn-category').value.trim(),
    date: document.getElementById('fn-date').value,
    featured: document.getElementById('fn-featured').checked,
    image: document.getElementById('fn-image').value.trim() || NEWS_PLACEHOLDER_IMAGE,
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
    ${pageHeader({
      eyebrow: 'Yayın',
      title: 'Dosya Yönetimi',
      subtitle: 'Dergi geneli toplu PDF yüklemesi ve eksik PDF tespiti için. Tek makaleye ait figür/ek materyal yüklemek için makale içindeki Dosyalar sekmesini kullanın.',
      actions: `<a href="#/articles" class="btn btn-secondary btn-sm">Makaleler →</a>`,
    })}

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="card card-padded">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center"><svg class="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg></div>
          <div><div class="text-2xl font-bold text-teal-700">${stats.pdfCount}</div><div class="text-xs text-gray-500">PDF Dosyası</div></div>
        </div>
      </div>
      <div class="card card-padded">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg ${stats.withoutPdf ? 'bg-red-50' : 'bg-green-50'} flex items-center justify-center"><svg class="w-5 h-5 ${stats.withoutPdf ? 'text-red-500' : 'text-green-500'}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="${stats.withoutPdf ? 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' : 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'}"/></svg></div>
          <div><div class="text-2xl font-bold ${stats.withoutPdf ? 'text-red-600' : 'text-green-600'}">${stats.withoutPdf}</div><div class="text-xs text-gray-500">PDF'siz Makale</div></div>
        </div>
      </div>
      <div class="card card-padded">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center"><svg class="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>
          <div><div class="text-2xl font-bold text-slate-600">${stats.figureCount}</div><div class="text-xs text-gray-500">Figür Dosyası</div></div>
        </div>
      </div>
      <div class="card card-padded">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center"><svg class="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg></div>
          <div><div class="text-2xl font-bold text-slate-600">${stats.suppCount}</div><div class="text-xs text-gray-500">Ek Materyal</div></div>
        </div>
      </div>
    </div>

    <!-- Batch PDF Upload -->
    <div class="card card-padded mb-6">
      <div class="flex items-start gap-3 mb-3">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:var(--brand-soft);color:var(--brand)"><svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg></div>
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2 flex-wrap">
            <h2 class="text-base font-semibold" style="color:var(--text-strong)">Toplu PDF Yükle</h2>
            <span class="badge badge-neutral" style="font-size:10px">Otomatik eşleştirme</span>
          </div>
          <p class="text-xs mt-0.5" style="color:var(--text-muted)">Dosya adındaki sayı (ör. <code>2805.pdf</code>) makale ID olarak tanınır, tüm PDF'ler tek seferde bağlanır. <a href="#" class="media-help" data-target="pdf-help" style="color:var(--info);font-weight:500">Detaylar →</a></p>
        </div>
      </div>
      <details id="pdf-help" class="mb-3" style="background:var(--bg-page);border-radius:8px">
        <summary style="padding:8px 12px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text-strong);user-select:none">Ne zaman & nasıl çalışır?</summary>
        <div style="padding:0 12px 12px;font-size:12px;color:var(--text-muted);line-height:1.55">
          <p class="mb-2"><strong>Ne zaman:</strong> Bir sayı yayınlandıktan sonra PDF üretici sistemden gelen tüm dosyaları tek hamlede yüklemek için. Eksik PDF'leri "PDF'siz Makaleler" listesinden takip edin.</p>
          <ol class="list-decimal list-inside space-y-0.5">
            <li>PDF'leri makale ID'si ile adlandırın (ör. <code style="background:var(--bg-card);padding:1px 6px;border-radius:4px;color:var(--text-strong)">2805.pdf</code>)</li>
            <li>Alana sürükleyin veya tıklayarak seçin</li>
            <li>Sistem <code style="background:var(--bg-card);padding:1px 6px;border-radius:4px;color:var(--text-strong)">js/data/pdfs/{id}.pdf</code> olarak kaydeder</li>
            <li>Sitede "PDF İndir" butonu otomatik aktif olur</li>
          </ol>
          <p class="mt-2" style="font-size:11.5px"><strong>Not:</strong> Dosya adı bir makale ID'si değilse dosya yine yüklenir, ancak hiçbir makaleye bağlanmaz — sonuç ekranında "eşleştirilemedi" olarak listelenir.</p>
        </div>
      </details>
      <div id="pdf-drop-zone" class="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-teal-400 transition-colors cursor-pointer">
        <svg class="w-10 h-10 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
        <p class="text-gray-600 font-medium">PDF dosyalarını sürükleyin veya tıklayarak seçin</p>
        <p class="text-xs text-gray-400 mt-1">Birden fazla dosya aynı anda yüklenebilir</p>
        <input id="pdf-batch-input" type="file" accept=".pdf" multiple class="hidden">
      </div>
      <div id="pdf-batch-results" class="mt-4"></div>
    </div>

    <!-- Missing PDFs (compact one-liner) -->
    ${stats.withoutPdf > 0 ? `
    <div class="card mb-6" style="padding:12px 16px">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style="background:var(--warning-soft);color:var(--warning)">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        </div>
        <div class="flex items-baseline gap-2 flex-1 min-w-0">
          <span class="text-sm font-semibold" style="color:var(--text-strong)">PDF'siz Makaleler</span>
          <span class="badge badge-warning">${stats.withoutPdf}</span>
          <span class="text-xs hidden sm:inline" style="color:var(--text-muted)">— eksik dosya denetim listesi</span>
        </div>
        <button onclick="loadMissingPdfs()" class="btn btn-secondary btn-sm flex-shrink-0">Listele</button>
      </div>
      <div id="missing-pdfs-list" class="mt-3"></div>
    </div>` : ''}

    <!-- Where to go for per-article uploads -->
    <div class="card card-padded" style="background:var(--bg-page)">
      <div class="flex items-start gap-3">
        <div style="color:var(--text-muted);font-size:18px;line-height:1">ℹ︎</div>
        <div class="text-sm" style="color:var(--text-muted);line-height:1.6">
          <strong style="color:var(--text-strong)">Tek bir makaleye figür / ek materyal yüklemek için bu sayfayı kullanmayın.</strong>
          Daha pratik iki yol var:
          <ul style="margin-top:6px;padding-left:18px;list-style:disc">
            <li><a href="#/articles" style="color:var(--brand);font-weight:500">Makaleler</a> → ilgili makaleyi düzenle → <strong>Dosyalar</strong> sekmesi (manuel yükleme)</li>
            <li><a href="#/zip-import" style="color:var(--brand);font-weight:500">ZIP Aktar</a> veya <a href="#/jats-import" style="color:var(--brand);font-weight:500">JATS XML Aktar</a> — makale ve dosyaları tek hamlede import eder</li>
            <li>Hangi makaleye ait olduğu bilinmeyen ek materyal için <a href="#/supp-library" style="color:var(--brand);font-weight:500">Ek Materyal (Bağımsız)</a> sayfası</li>
          </ul>
          Bu sayfa yalnızca <strong>tüm dergi geneli</strong> toplu PDF yüklemesi ve eksik PDF tespiti için kullanılır.
        </div>
      </div>
    </div>`;

  // Wire "Detaylar →" inline links to toggle their corresponding <details> panel
  el.querySelectorAll('.media-help').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(a.dataset.target);
      if (target) {
        target.open = !target.open;
        if (target.open) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  // PDF batch upload
  const pdfDrop = document.getElementById('pdf-drop-zone');
  const pdfInput = document.getElementById('pdf-batch-input');
  pdfDrop.onclick = () => pdfInput.click();
  pdfDrop.ondragover = (e) => { e.preventDefault(); pdfDrop.classList.add('border-teal-400', 'bg-teal-50'); };
  pdfDrop.ondragleave = () => pdfDrop.classList.remove('border-teal-400', 'bg-teal-50');
  pdfDrop.ondrop = (e) => { e.preventDefault(); pdfDrop.classList.remove('border-teal-400', 'bg-teal-50'); handleBatchPdfUpload(e.dataTransfer.files); };
  pdfInput.onchange = () => handleBatchPdfUpload(pdfInput.files);

  // Figure & supplementary uploads were previously offered here behind a
  // manual "Makale ID" input — removed (2026-05-21) because per-article
  // upload happens via the article-edit "Dosyalar" tab and ZIP/JATS imports
  // already attach files automatically. The /api/media/upload/figures/:id
  // and /api/media/upload/supplementary/:id endpoints remain and are still
  // used by the article/AIP edit forms and the figure wizard.
});

async function handleBatchPdfUpload(files) {
  if (!files || !files.length) return;
  const prog = renderUploadProgress('pdf-batch-results', files, 'PDF\'ler yükleniyor');

  try {
    const result = await API.uploadFilesWithProgress('/media/upload/pdf-batch', files, 'pdf', {}, prog.update);
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
    if (!html) html = '<div class="bg-gray-50 border text-gray-700 p-3 rounded-lg text-sm">Yükleme tamamlandı.</div>';
    prog.complete(html);
  } catch (err) {
    prog.fail(err.message);
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

// Load asset summary (PDF / figures / supplementary) for an article into the Media tab
async function loadArticleAssets(articleId, article) {
  const pdfEl = document.getElementById('f-pdf-count');
  const figEl = document.getElementById('f-fig-count');
  const suppEl = document.getElementById('f-supp-count');
  // Even when none of the Dosyalar UI is mounted (e.g. the user is on the
  // Tam Metin tab), still prefetch the asset list so the cross-ref bubble
  // can show disk-uploaded figures/tables without first visiting Dosyalar.
  const hasDosyaUi = pdfEl || figEl || suppEl || document.getElementById('f-fig-wizard');
  try {
    const data = await API.get(`/media/article/${articleId}/assets`);
    window._articleAssets = data;
    // Keep the cross-ref bubble in sync with Dosyalar add/delete: if it's
    // currently open, re-render it from the fresh cache + live editor DOM so
    // uploaded figures appear and deleted ones disappear 1:1, with no stale
    // tiles. (Hidden bubbles re-render on the next selection anyway.)
    const _bubble = document.getElementById('cr-bubble');
    if (_bubble && !_bubble.classList.contains('hidden') && typeof _renderCrossRefBubble === 'function') {
      const _pfx = document.getElementById('ft-visual') ? 'ft'
        : document.getElementById('aip-ft-visual') ? 'aip-ft' : null;
      if (_pfx) _renderCrossRefBubble(_pfx);
    }
    if (!hasDosyaUi) return; // cache populated — nothing else to render
    if (pdfEl) pdfEl.textContent = article?.pdfUrl ? '1 dosya' : '0';
    if (figEl) figEl.textContent = `${data.figures.length} dosya`;
    if (suppEl) suppEl.textContent = `${data.supplementary.length} dosya`;
    // Render the figure-match wizard
    renderFigureWizard(articleId).catch(() => {});
  } catch (err) {
    if (pdfEl) pdfEl.textContent = '?';
    if (figEl) figEl.textContent = '?';
    if (suppEl) suppEl.textContent = '?';
    const wiz = document.getElementById('f-fig-wizard');
    if (wiz) wiz.innerHTML = `<div class="banner banner-danger">Varlıklar yüklenemedi: ${esc(err.message)}</div>`;
  }
}

// Build the figure-match wizard: shows full-text placeholders and uploaded figure thumbnails side by side
async function renderFigureWizard(articleId) {
  const wiz = document.getElementById('f-fig-wizard');
  if (!wiz) return;
  let status;
  try {
    status = await API.get(`/media/article/${articleId}/figure-status`);
  } catch (err) {
    wiz.innerHTML = `<div class="banner banner-danger" style="padding:10px"><div class="banner-body" style="margin-top:0">Durum okunamadı: ${esc(err.message)}</div></div>`;
    return;
  }
  window._articleFigureStatus = status;

  const { placeholders, figures, stats, hasFullText } = status;
  if (!hasFullText && figures.length === 0) {
    wiz.innerHTML = `<div class="banner banner-info" style="padding:10px"><div class="banner-body" style="margin-top:0">Henüz tam metin veya figür yok. Tam Metin sekmesinden HTML yükleyin, ardından figür dosyalarını buradan yükleyin.</div></div>`;
    return;
  }

  // Inline stats — written into the header's inline span (next to "Figürler" title)
  const inlineStats = document.getElementById('f-fig-inline-stats');
  if (inlineStats) {
    const parts = [];
    parts.push(`<span style="color:var(--text-strong);font-weight:600">${placeholders.length}</span> placeholder`);
    if (stats.resolved + stats.fuzzyMatch > 0) parts.push(`<span style="color:var(--success-text);font-weight:600">${stats.resolved + stats.fuzzyMatch}</span> eşlendi`);
    if (stats.missing > 0) parts.push(`<span style="color:var(--warning-text);font-weight:600">${stats.missing}</span> bekliyor`);
    parts.push(`<span style="color:var(--text-strong);font-weight:600">${figures.length}</span> yüklü figür`);
    if ((stats.legacyCount || 0) > 0) parts.push(`<span style="color:var(--info-text);font-weight:600">${stats.legacyCount}</span> eski format`);
    inlineStats.innerHTML = parts.join(' · ');
  }

  // Compact legacy notice (one line)
  const summary = (stats.legacyCount || 0) > 0
    ? `<div class="banner banner-info mb-3" style="padding:8px 12px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <div class="banner-body" style="margin-top:0;font-size:12px">Bu makale eski sistemden geliyor — "eski" rozetli satırlardaki dosyaları yükleyin, sonra <strong>Tam Metne Uygula</strong> ile modern <code>&lt;img&gt;</code> etiketlerine dönüşür.</div>
      </div>`
    : '';

  // Placeholders panel
  const placeholdersHtml = !hasFullText
    ? `<div class="text-xs" style="color:var(--text-faint);padding:12px;text-align:center">Tam metin yok — placeholder listesi gösterilemiyor.</div>`
    : placeholders.length === 0
      ? `<div class="text-xs" style="color:var(--text-faint);padding:12px;text-align:center">Tam metinde figür referansı yok.</div>`
      : placeholders.map((p) => wizPlaceholderRow(p, articleId)).join('');

  // Figures: thumbnail grid OR an empty hint embedded at bottom (no separate column)
  if (figures.length === 0) {
    // Single-column layout when no figures — placeholders take full width
    wiz.innerHTML = `
      ${summary}
      <div class="card-flat" style="padding:4px">${placeholdersHtml}</div>
      ${hasFullText && placeholders.length > 0 ? `
        <div class="text-xs text-center mt-3" style="color:var(--text-faint)">
          Henüz figür yüklenmedi. Yukarıdaki <strong>Çoklu Yükle</strong> veya satırlardaki <strong>Dosya seç</strong> butonunu kullanın.
        </div>` : ''}`;
  } else {
    // Two-column layout when there are uploaded figures
    wiz.innerHTML = `
      ${summary}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div class="text-xs font-semibold mb-2" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">Placeholder'lar</div>
          <div class="card-flat" style="padding:4px">${placeholdersHtml}</div>
        </div>
        <div>
          <div class="text-xs font-semibold mb-2" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em">Yüklü Figürler (${figures.length})</div>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${figures.map((f) => wizFigureThumb(f, articleId)).join('')}</div>
        </div>
      </div>`;
  }
}

function wizStat(label, value, tone, tooltip) {
  const palette = {
    success: { fg: 'var(--success-text)', bg: 'var(--success-soft)' },
    warning: { fg: 'var(--warning-text)', bg: 'var(--warning-soft)' },
    info:    { fg: 'var(--info-text)',    bg: 'var(--info-soft)' },
    neutral: { fg: 'var(--text)',         bg: 'var(--bg-subtle)' },
  };
  const c = palette[tone] || palette.neutral;
  const tip = tooltip ? ` title="${esc(tooltip)}"` : '';
  return `<div${tip} style="background:${c.bg};border-radius:8px;padding:8px 12px;text-align:center;cursor:${tooltip ? 'help' : 'default'}">
    <div class="text-lg font-bold tabular" style="color:${c.fg};line-height:1.1">${esc(String(value))}</div>
    <div class="text-xs" style="color:${c.fg};opacity:.85">${esc(label)}</div>
  </div>`;
}

function wizPlaceholderRow(p, articleId) {
  const isLegacy = p.format === 'legacy';
  const displayRef = isLegacy ? (p.suggestedName || p.ref) : p.ref;
  const targetName = isLegacy ? (p.suggestedName || displayRef) : p.ref;
  const targetEsc = String(targetName).replace(/'/g, "\\'").replace(/"/g, '&quot;');

  // Two-badge approach: format badge (left) + status badge (right). Avoids the
  // earlier confusion where a single "eski" badge looked like it conflicted with
  // the "Eksik" counter at the top.
  const fmtBadge = isLegacy
    ? '<span class="badge badge-neutral" title="Eski sistemden gelen javascript:openWin() formatı" style="min-width:46px;justify-content:center">eski</span>'
    : '<span class="badge badge-neutral" title="Modern <img src=…> formatı" style="min-width:46px;justify-content:center">yeni</span>';

  if (p.status === 'resolved') {
    return `<div class="flex items-center gap-2 px-2 py-1.5 text-xs">
      ${fmtBadge}
      <span class="badge badge-success" title="Bu placeholder yayınlanmış URL'ye işaret ediyor" style="min-width:64px;justify-content:center">tamam</span>
      <code class="truncate" style="flex:1;min-width:0;color:var(--text-muted)">${esc(displayRef)}</code>
    </div>`;
  }
  if (p.status === 'fuzzy-match') {
    return `<div class="flex items-center gap-2 px-2 py-1.5 text-xs">
      ${fmtBadge}
      <span class="badge badge-info" title="Yüklü bir figürle eşleşti — 'Tam Metne Uygula' ile yaz" style="min-width:64px;justify-content:center">eşlendi</span>
      <code style="color:var(--text-strong);flex-shrink:0;min-width:0;overflow:hidden;text-overflow:ellipsis;max-width:50%">${esc(displayRef)}</code>
      <span style="color:var(--text-faint)">→</span>
      <code class="truncate" style="color:var(--info-text);flex:1;min-width:0">${esc(p.suggestedFile)}</code>
    </div>`;
  }
  // missing — dosya henüz yüklenmemiş, "Dosya seç" göster
  return `<div class="flex items-center gap-2 px-2 py-1.5 text-xs" style="background:var(--warning-soft);border-radius:6px;margin:2px 0">
    ${fmtBadge}
    <span class="badge badge-warning" title="Bu placeholder için dosya henüz yüklenmedi" style="min-width:64px;justify-content:center">bekliyor</span>
    <code style="color:var(--warning-text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(displayRef)}</code>
    <label class="btn btn-secondary btn-sm cursor-pointer" style="flex-shrink:0;padding:3px 8px;font-size:11px">
      Dosya seç
      <input type="file" accept="image/*,.tif,.tiff" class="hidden" onchange="uploadFigureForPlaceholder(${articleId}, '${targetEsc}', this.files[0])">
    </label>
  </div>`;
}

function wizFigureThumb(f, articleId) {
  const matched = f.matchedTo;
  const fileEsc = String(f.filename).replace(/'/g, "\\'");
  const urlEsc  = String(f.url).replace(/'/g, "\\'");
  return `<div class="card-flat overflow-hidden" style="background:var(--bg-card);position:relative">
    <!-- Delete button: top-right corner, visible on hover -->
    <button type="button" class="wiz-thumb-delete"
            onclick="event.stopPropagation(); deleteUploadedFigure(${articleId}, '${fileEsc}')"
            title="Bu figürü sil"
            style="position:absolute;top:6px;right:6px;z-index:2;width:26px;height:26px;border-radius:50%;border:none;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s,background .15s"
            onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='rgba(0,0,0,.55)'">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    </button>
    <!-- Thumbnail container is the hover trigger -->
    <div class="wiz-thumb" style="background:#f4f3f0;aspect-ratio:1;display:flex;align-items:center;justify-content:center;overflow:hidden"
         onclick="openFigureInsertDialog('${urlEsc}','${fileEsc}')"
         title="Tam metne ekle">
      <img src="/site/${esc(f.url)}" alt="${esc(f.filename)}" style="max-width:100%;max-height:100%;object-fit:contain;pointer-events:none" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div style="display:none;color:var(--text-faint);font-size:11px;align-items:center;justify-content:center;width:100%;height:100%;pointer-events:none">önizleme yok</div>
      <!-- Hover overlay (toggled by .wiz-thumb:hover in CSS) -->
      <button type="button" class="wiz-thumb-overlay"
              onclick="event.stopPropagation(); openFigureInsertDialog('${urlEsc}','${fileEsc}')"
              aria-label="Tam metne ekle">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Metne Ekle
      </button>
    </div>
    <div style="padding:6px 8px">
      <div class="truncate text-xs font-medium" style="color:var(--text-strong)" title="${esc(f.filename)}">${esc(f.filename)}</div>
      ${f.caption ? `<div class="truncate text-xs mt-0.5" style="color:var(--text-muted)" title="${esc(f.caption)}">${esc(f.caption)}</div>` : ''}
      ${matched
        ? `<div class="text-xs mt-0.5" style="color:var(--info-text)">→ <code>${esc(matched)}</code> ile bağlı</div>`
        : `<div class="text-xs mt-0.5 flex items-center justify-between gap-2">
            <span style="color:var(--text-faint)">tam metinde yok</span>
            <button type="button" onclick="openFigureInsertDialog('${urlEsc}','${fileEsc}')"
              class="btn btn-secondary btn-sm" style="padding:2px 8px;font-size:11px">+ Ekle</button>
          </div>`}
    </div>
  </div>`;
}

// Remove any figure/table block placed in the full-text editor(s) whose image
// points at `filename`. Deleting a file from the Dosyalar tab must also pull
// its placed block out of the body — otherwise the block (and its caption)
// lingers with a broken image and keeps showing up in the cross-ref picker /
// bubble. Returns the number of blocks/images removed. Also handles multi-panel
// figures: a panel image is removed, and the parent <figure> is dropped only
// once it has no images left.
function _removePlacedMediaByFile(filename) {
  const base = String(filename || '').split('/').pop().toLowerCase();
  if (!base) return 0;
  let removed = 0;
  ['ft-visual', 'aip-ft-visual'].forEach((vid) => {
    const visual = document.getElementById(vid);
    if (!visual) return;
    let touched = false;
    visual.querySelectorAll('img').forEach((img) => {
      const src = (img.getAttribute('src') || '').split('/').pop().toLowerCase();
      if (src !== base) return;
      const block = img.closest('figure, .article-figure, .article-table-wrap, [id^="figure-"], [id^="table-"], [id^="fig-"], [id^="tab-"]');
      if (block) {
        img.remove();
        // Drop the whole block only when no images remain (keeps multi-panel
        // figures intact when just one panel file is deleted).
        if (!block.querySelector('img')) block.remove();
      } else {
        img.remove();
      }
      removed += 1;
      touched = true;
    });
    // A removed target turns its in-text cross-refs into broken links — flag
    // them so the editor shows the red "hedef yok" state instead of a dead anchor.
    if (touched && typeof _validateCrossRefAnchors === 'function') _validateCrossRefAnchors(visual);
  });
  return removed;
}

// Delete an uploaded figure file (and its caption metadata). Shows a confirm
// dialog, hits DELETE on the server, removes the placed block from the full
// text, then refreshes the wizard, asset cache and cross-ref bubble so the
// Dosyalar deletion is reflected 1:1 in the Tam Metin picker.
async function deleteUploadedFigure(articleId, filename) {
  const ok = await confirmAction(`"${filename}" figürünü silmek istediğinize emin misiniz? Tam metinde yerleştirilmişse oradan da kaldırılır. Bu işlem geri alınamaz.`);
  if (!ok) return;
  try {
    await API.del(`/media/article/${articleId}/figures/${encodeURIComponent(filename)}`);
    // Pull the placed block out of the full-text editor (if any).
    const removedFromBody = _removePlacedMediaByFile(filename);
    if (removedFromBody) {
      if (typeof markDirty === 'function') markDirty();
      toast(`${filename} silindi — tam metinden de ${removedFromBody} blok kaldırıldı (kaydetmeyi unutmayın)`);
    } else {
      toast(`${filename} silindi`);
    }
    // Refresh the asset cache + Dosyalar wizard. loadArticleAssets also
    // re-renders an open cross-ref bubble from the fresh cache + live DOM, so
    // the deleted figure disappears from the Tam Metin pop-up immediately.
    if (typeof loadArticleAssets === 'function') {
      await loadArticleAssets(articleId);
    } else {
      handleRoute();
    }
  } catch (err) {
    toast(`Silme hatası: ${err.message}`, 'error');
  }
}

// Persistent cursor tracker per editor. Without this, switching to the
// "Dosyalar" tab and back loses the user's editor cursor — figures would
// silently land at the end of the article.
const _lastEditorRange = {}; // prefix → cloned Range
(function _installEditorCursorTracker() {
  if (window._editorCursorTrackerInstalled) return;
  window._editorCursorTrackerInstalled = true;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    // Walk up from the range's anchor to find an "<id>-visual" contenteditable.
    let n = range.commonAncestorContainer;
    if (n && n.nodeType === 3) n = n.parentNode;
    while (n && n.nodeType === 1) {
      if (n.id && /-visual$/.test(n.id) && n.contentEditable === 'true') {
        const prefix = n.id.replace(/-visual$/, '');
        _lastEditorRange[prefix] = range.cloneRange();
        return;
      }
      n = n.parentNode;
    }
  });
})();

// Find the block-level ancestor of `node` that is a direct child of `visual`.
// Used so figure insertion happens BETWEEN top-level blocks instead of inside
// inline formatting (which would cause the figure caption to inherit the
// parent's <b>/<strong> styling).
function _topLevelBlockOf(node, visual) {
  while (node && node !== visual && node.parentNode !== visual) {
    node = node.parentNode;
  }
  return (node && node !== visual && node.parentNode === visual) ? node : null;
}

// Insert a figure/table block into the full text editor. Produces the SAME
// HTML structure as Otomatik Düzenle (_buildMediaBlock) so manually inserted
// and auto-arranged figures render identically:
//   <figure id="figure-N" class="article-figure">
//     <img src="..." alt="Figure N" loading="lazy">
//     <p><strong>FIG. N.</strong> caption…</p>
//   </figure>
// If a block with the same ID already exists in the editor (e.g. previously
// placed by Otomatik Düzenle or a manual insert), the user is asked whether
// to refresh the caption or cancel — preventing silent duplicate inserts.
async function insertFigureIntoFullText(url, filename, caption, size, label) {
  // Switch to the Tam Metin tab
  const ftBtn = document.querySelector('.tab-btn[data-tab="fulltext"]') ||
                document.querySelector('.aip-tab-btn[data-tab="fulltext"]');
  if (ftBtn) ftBtn.click();

  const prefix = document.getElementById('ft-visual') ? 'ft'
               : document.getElementById('aip-ft-visual') ? 'aip-ft'
               : null;
  if (!prefix) {
    toast('Tam metin editörü bulunamadı', 'warning');
    return;
  }
  const visual = document.getElementById(`${prefix}-visual`);

  // Classify the file as figure or table from filename. Matches the same
  // detection auto-arrange uses, so a "table-1.png" goes through as a table.
  const isTable = /(?:^|[-_])tab(?:le)?[-_]?\d+/i.test(filename || '');
  const kind = isTable ? 'table' : 'figure';

  // Determine the figure/table number. Prefer the number embedded in the
  // filename (so 297-308-f1.png → 1, BalkanMedJ-43-2-figure-3B.png → 3).
  // Fall back to "next available" derived from existing IDs in the editor.
  let num = null;
  const meta = _extractMediaNum(filename, kind);
  if (meta && meta.num) num = meta.num;
  if (!num) {
    const targets = _scanCrossRefTargets(prefix);
    const existing = (kind === 'figure' ? targets.figures : targets.tables) || [];
    num = existing.length ? Math.max(...existing.map((x) => x.num)) + 1 : 1;
  }

  // Caption inherits the same [N] → <sup><a> conversion as auto-arrange,
  // plus the same "Figure N." prefix stripping (so user-typed "Figure 1. Foo"
  // doesn't double up with the auto-added "FIG. 1." label). Size becomes a
  // `data-size` attribute on the figure block so CSS can scale it.
  const manualLabel = typeof label === 'string' ? label.trim() : '';
  const panels = [{ panel: meta?.panel || null, url, filename, caption: caption || '', source: '', size: size || 'medium', label: manualLabel }];
  const block = _buildMediaBlock(kind, num, panels);

  const mode = _htmlEditorModes[prefix] || 'visual';

  if (mode === 'visual') {
    if (!visual) return;

    // If a block with this ID already exists, warn the user — they may have
    // run Otomatik Düzenle earlier (or manually inserted) and forgotten.
    // Offer to refresh the existing caption instead of silently duplicating.
    const existing = visual.querySelector('#' + CSS.escape(`${kind}-${num}`));
    if (existing) {
      const label = kind === 'figure' ? `Figür ${num}` : `Tablo ${num}`;
      const ok = await confirmAction(
        `${label} zaten tam metinde mevcut — daha önce "Otomatik Düzenle" ile veya elle eklenmiş olabilir.\n\n` +
        `Onaylarsanız mevcut bloğun açıklaması yeni metinle güncellenir. Yeni bir kopya EKLENMEZ.`
      );
      if (!ok) {
        toast(`${label} zaten metinde — ekleme iptal edildi`, 'warning');
        return;
      }
      // Pull the caption inner HTML from the freshly-built block so we keep
      // the EXACT same formatting rules as Otomatik Düzenle.
      const newCap = block.querySelector(kind === 'figure' ? 'p, figcaption' : 'p.table-label, p');
      const inner = newCap ? newCap.innerHTML.replace(/^<strong>[^<]+<\/strong>\s*/i, '') : '';
      // Sync the manual-label LOCK state onto the existing block so the in-place
      // caption refresh below renders the locked label (or reverts to AUTO).
      if (block.hasAttribute('data-label')) existing.setAttribute('data-label', block.getAttribute('data-label'));
      else existing.removeAttribute('data-label');
      // block carries the latest data-size from _buildMediaBlock — push it
      // through so changing the size in the dialog updates the existing block.
      _updateExistingMediaCaption(existing, kind, num, inner, block.getAttribute('data-size'));
      // Scroll the updated block into view so the user can see what changed
      try { existing.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      markDirty();
      toast(`${label} açıklaması güncellendi`);
      _autoLinkInEditor(visual);
      _validateCrossRefAnchors(visual);
      return;
    }

    // Fresh insert. Pick a range in this priority order:
    //   1) The cursor position last saved while the user was editing (this
    //      survives tab switches to Dosyalar and back).
    //   2) The current selection, if it happens to still be inside the editor.
    //   3) None — append to the end.
    let range = _lastEditorRange[prefix] || null;
    if (range && !visual.contains(range.commonAncestorContainer)) range = null;
    if (!range) {
      const sel = window.getSelection();
      const r = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (r && visual.contains(r.commonAncestorContainer)) range = r;
    }

    if (range) {
      // Insert AFTER the cursor's block-level ancestor so the figure isn't
      // nested inside <strong>/<b> (which would make the caption inherit bold).
      const blockParent = _topLevelBlockOf(range.startContainer, visual);
      if (blockParent) {
        blockParent.parentNode.insertBefore(block, blockParent.nextSibling);
      } else {
        // Cursor is directly in visual root with no wrapping block — insert at
        // the range and let the browser handle it.
        range.insertNode(block);
      }
    } else {
      visual.appendChild(block);
    }

    // Move cursor to just after the inserted block so subsequent typing
    // continues below the figure, not before it.
    try {
      const sel = window.getSelection();
      const after = document.createRange();
      after.setStartAfter(block);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      _lastEditorRange[prefix] = after.cloneRange();
    } catch { /* non-fatal */ }

    markDirty();
    toast(`${kind === 'figure' ? 'Figür' : 'Tablo'} ${num} tam metne eklendi`);
    // Re-link plain-text mentions and validate cross-refs now that this block exists.
    _autoLinkInEditor(visual);
    _validateCrossRefAnchors(visual);
  } else {
    // Source mode → insert outerHTML at textarea caret
    const ta = document.getElementById(`${prefix}-source`);
    if (!ta) return;
    const label = kind === 'figure' ? `Figür ${num}` : `Tablo ${num}`;
    // Detect duplicate by searching for the same id="figure-N" / id="table-N"
    // in the raw source. Same warning UX as visual mode.
    const idRegex = new RegExp(`id\\s*=\\s*["']${kind}-${num}["']`, 'i');
    if (idRegex.test(ta.value)) {
      const ok = await confirmAction(
        `${label} zaten tam metinde mevcut — daha önce "Otomatik Düzenle" ile veya elle eklenmiş olabilir.\n\n` +
        `Source modda mevcut bloğun otomatik olarak güncellenmesi desteklenmiyor; lütfen önce Görsel moda geçin veya ekleme işlemini iptal edin.`
      );
      if (!ok) {
        toast(`${label} zaten metinde — ekleme iptal edildi`, 'warning');
        return;
      }
    }
    const html = block.outerHTML;
    ta.focus();
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + html + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + html.length;
    markDirty();
    toast(`${label} tam metne eklendi`);
  }
}

// Upload a single figure file targeted at a specific placeholder. The file is renamed
// to match the placeholder ref so the normalize-and-apply step picks it up.
async function uploadFigureForPlaceholder(articleId, placeholderRef, file) {
  if (!file) return;
  try {
    // Compute the target filename.
    // - If placeholderRef already has an extension (legacy: "figure_BMJ_2780_0.jpg"),
    //   use it verbatim so basename-based matching works.
    // - Otherwise append the original file's extension (modern bare ref: "fig1" → "fig1.png").
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(placeholderRef);
    const ext = file.name.match(/\.[^.]+$/)?.[0] || '';
    const targetName = hasExt ? placeholderRef : (placeholderRef + ext);
    const renamed = new File([file], targetName, { type: file.type });
    const result = await API.uploadFiles(`/media/upload/figures/${articleId}`, [renamed], 'figures');
    toast(`${result.uploaded.length} figür yüklendi`);
    // Auto-apply (handles both modern and legacy refs) + refresh
    await applyExistingFigures(articleId);
    await renderFigureWizard(articleId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Load existing full-text HTML into the article full-text editor (prefix 'ft')
async function loadFullTextIntoEditor(articleId) {
  const visual = document.getElementById('ft-visual');
  const status = document.getElementById('f-fulltext-status');
  if (!visual) return;
  try {
    const data = await API.get(`/articles/${articleId}/fulltext`);
    setHtmlEditorContent('ft', data.html || '');
    // Same as the AIP loader: collapse Word's MsoListParagraph refs into
    // <ol>, stamp figure/table IDs, and auto-link plain mentions so the
    // editor preview matches what readers will see on the public site.
    // Suppress dirty marking — these mutations come from the system, not
    // the user, so they shouldn't trip the "unsaved changes" prompt.
    if (data.html) {
      _suppressDirty = true;
      try {
        _normalizeMsoReferenceList(visual);
        _promoteMsoHeadings(visual);
        _ensureMediaIds(visual);
        _normalizeMediaCaptions(visual);
        _autoLinkInEditor(visual);
        _initMediaBlockControls();
        _initToolbarStateSync();
      } finally {
        _suppressDirty = false;
      }
    }
    let prunedNote = '';
    if (data.html) {
      const pruned = await _pruneOrphanArticleMedia(visual, articleId);
      if (pruned) { markDirty(); prunedNote = ` — ${pruned} kullanılmayan (silinmiş) figür kaldırıldı, kaydedin`; }
    }
    if (status) {
      status.textContent = data.html
        ? `Yüklü tam metin uzunluğu: ${data.html.length.toLocaleString('tr-TR')} karakter.${prunedNote}`
        : 'Tam metin henüz mevcut değil.';
    }
    _setupFtAutosave('ft', articleId);
    await _maybeOfferDraftRecovery('ft', articleId, data.html || '');
  } catch (err) {
    if (status) status.textContent = `Tam metin okunamadı: ${err.message}`;
  }
}

// Save the full-text editor contents
async function saveArticleFullText(articleId) {
  const visual = document.getElementById('ft-visual');
  const status = document.getElementById('f-fulltext-status');
  if (!visual) return;
  const html = getHtmlEditorContent('ft');
  if (!html.trim()) {
    if (!await confirmAction('Tam metin boş. Yine de kaydetmek istiyor musunuz?')) return;
  }
  try {
    await API.put(`/articles/${articleId}/fulltext`, { html });
    clearDirty();
    _clearFtDraft('ft', articleId);
    if (status) status.textContent = `Kaydedildi (${html.length.toLocaleString('tr-TR')} karakter).`;
    toast('Tam metin kaydedildi');
  } catch (err) {
    if (status) status.textContent = `Kaydetme hatası: ${err.message}`;
    toast(err.message, 'error');
  }
}

// Apply all existing uploaded figures to the article full text by filename → placeholder match
// Apply uploaded figures to the full text. Server uses fuzzy match (fig1 ~ figure1
// ~ fig_01 ~ Figure 1), so the client just triggers the run with an empty body.
async function applyExistingFigures(articleId) {
  try {
    const data = window._articleAssets || await API.get(`/media/article/${articleId}/assets`);
    if (!data.figures?.length) {
      toast('Önce figür yükleyin', 'warning');
      return;
    }
    const result = await API.post(`/media/figures/${articleId}/apply`, {});
    if (result.replaced > 0) {
      toast(`${result.replaced} figür referansı eşlendi`);
    } else {
      toast('Eşleşen placeholder bulunamadı', 'warning');
    }
    // Refresh the wizard so the new resolved placeholders show up
    await renderFigureWizard(articleId).catch(() => {});
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Editorial Board — data-driven section editor ──
let _edModel = null;
let _edActiveTab = null;

function edSectionBadge(layout) {
  return layout === 'featured' ? 'Öne çıkan' : layout === 'names' ? 'İsim listesi' : 'Liste';
}

function edLinkRow(si, mi, li, lk) {
  return `<div class="flex gap-2 items-center" style="margin-bottom:4px">
    <input data-sec="${si}" data-mem="${mi}" data-link="${li}" data-f="linklabel" class="input" style="flex:1;padding:5px 8px;font-size:12px" placeholder="Etiket (ör. ORCID, CV)" value="${esc(lk.label || '')}">
    <input data-sec="${si}" data-mem="${mi}" data-link="${li}" data-f="linkurl" class="input" style="flex:2;padding:5px 8px;font-size:12px;min-width:0" placeholder="https://... veya dosya yükleyin" value="${esc(lk.url || '')}">
    <label class="btn btn-ghost btn-sm" style="cursor:pointer;color:var(--brand);padding:3px 8px;font-size:11px;font-weight:500;white-space:nowrap;flex-shrink:0" title="Dosya yükle (PDF, JPG, PNG, WebP)">
      Dosya
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" class="ed-cv-file hidden" data-sec="${si}" data-mem="${mi}" data-link="${li}">
    </label>
    <button type="button" onclick="edRemoveLink(${si},${mi},${li})" class="nf-iconbtn nf-del" title="Bağlantıyı sil">${NF_ICONS.x}</button>
  </div>`;
}

function edMemberRow(si, mi, mem, total) {
  const links = (mem.links || []).map((lk, li) => edLinkRow(si, mi, li, lk)).join('');
  return `<div class="ed-mrow" data-sec="${si}" data-mem="${mi}" ondragend="this.removeAttribute('draggable')">
    <div class="ed-mrow-num">#${mi + 1}</div>
    <div class="flex gap-3">
      <div class="flex flex-col items-center gap-1" style="flex-shrink:0">
        <span class="row-grip ed-mrow-grip" title="Sıralamak için tutup sürükleyin" aria-label="Sürükle" onmousedown="this.closest('.ed-mrow').setAttribute('draggable','true')">${ROW_GRIP_SVG}</span>
        <img src="${mem.photo ? '/site/' + esc(mem.photo) : ''}" onerror="this.style.visibility='hidden'" style="width:46px;height:46px;border-radius:50%;object-fit:cover;border:1px solid var(--border);background:#fff" alt="">
        <div class="flex">
          <button type="button" onclick="edMoveMember(${si},${mi},-1)" ${mi === 0 ? 'disabled' : ''} class="nf-iconbtn" title="Yukarı">${NF_ICONS.up}</button>
          <button type="button" onclick="edMoveMember(${si},${mi},1)" ${mi === total - 1 ? 'disabled' : ''} class="nf-iconbtn" title="Aşağı">${NF_ICONS.down}</button>
        </div>
      </div>
      <div class="flex-1" style="min-width:0">
        <div class="flex gap-2 mb-2">
          <input data-sec="${si}" data-mem="${mi}" data-f="name" class="input" style="flex:2" placeholder="Ad Soyad" value="${esc(mem.name || '')}">
          <input data-sec="${si}" data-mem="${mi}" data-f="title" class="input" style="flex:1" placeholder="Ünvan (MD/PhD)" value="${esc(mem.title || '')}">
          <button type="button" onclick="edRemoveMember(${si},${mi})" class="nf-iconbtn nf-del" title="Üyeyi sil">${NF_ICONS.x}</button>
        </div>
        <input data-sec="${si}" data-mem="${mi}" data-f="aff" class="input" style="width:100%;margin-bottom:8px" placeholder="Kurum / Bölüm" value="${esc(mem.affiliation || '')}">
        <div class="flex gap-2 mb-2">
          <input data-sec="${si}" data-mem="${mi}" data-f="email" class="input" style="flex:1" placeholder="E-posta (opsiyonel)" value="${esc(mem.email || '')}">
          <input data-sec="${si}" data-mem="${mi}" data-f="photo" class="input" style="flex:1" placeholder="images/editorial-board/..." value="${esc(mem.photo || '')}">
          <label class="btn btn-secondary btn-sm" style="cursor:pointer;white-space:nowrap">Fotoğraf<input type="file" accept="image/*" class="ed-photo-file hidden" data-sec="${si}" data-mem="${mi}"></label>
        </div>
        <div style="border-left:2px solid var(--border-soft);padding-left:10px">
          <div class="text-xs" style="color:var(--text-muted);margin-bottom:3px">Bağlantılar — ORCID, CV, profil vb.</div>
          ${links}
          <button type="button" onclick="edAddLink(${si},${mi})" class="nf-addlink">+ Bağlantı</button>
        </div>
      </div>
    </div>
  </div>`;
}

function edSectionCard(sec, si, total) {
  let body;
  if (sec.layout === 'names') {
    body = `<textarea data-sec="${si}" data-f="names" rows="10" class="input" style="width:100%;font-size:13px" placeholder="Her satıra bir isim">${esc((sec.names || []).join('\n'))}</textarea>
      <p class="text-xs mt-1" style="color:var(--text-faint)">Her satıra bir isim yazın. Şu an ${(sec.names || []).length} isim.</p>`;
  } else {
    const members = sec.members || [];
    body = `<div>${members.map((mem, mi) => edMemberRow(si, mi, mem, members.length)).join('')}</div>
      <button type="button" onclick="edAddMember(${si})" class="btn btn-secondary btn-sm mt-2">+ Üye Ekle</button>`;
  }
  const count = sec.layout === 'names' ? (sec.names || []).length : (sec.members || []).length;
  return `<div class="card card-padded">
    <div class="flex items-center gap-2 mb-3">
      <span class="badge badge-neutral" style="font-size:10px">${edSectionBadge(sec.layout)}</span>
      <input data-sec="${si}" data-f="seclabel" class="input" style="flex:1;font-weight:600" value="${esc(sec.label || '')}" placeholder="Bölüm adı">
      <span class="text-sm" style="color:var(--text-faint)">(${count})</span>
      <button type="button" onclick="edMoveSection(${si},-1)" ${si === 0 ? 'disabled' : ''} class="nf-iconbtn" title="Yukarı">${NF_ICONS.up}</button>
      <button type="button" onclick="edMoveSection(${si},1)" ${si === total - 1 ? 'disabled' : ''} class="nf-iconbtn" title="Aşağı">${NF_ICONS.down}</button>
      <button type="button" onclick="edRemoveSection(${si})" class="nf-iconbtn nf-del" title="Bölümü sil">${NF_ICONS.x}</button>
    </div>
    ${body}
  </div>`;
}

function renderEditorialForm() {
  const c = document.getElementById('ed-sections');
  if (!c || !_edModel) return;
  // Keep the active tab valid; default to the first section.
  if (!_edActiveTab || !_edModel.sections.find((s) => s.id === _edActiveTab)) {
    _edActiveTab = (_edModel.sections[0] || {}).id || null;
  }
  const tabs = _edModel.sections.map((s) => {
    const count = s.layout === 'names' ? (s.names || []).length : (s.members || []).length;
    const active = s.id === _edActiveTab;
    return `<button type="button" onclick="edSelectTab('${esc(s.id)}')" class="ed-tab-btn ${active ? 'ed-tab-active' : ''}" data-ed-tab="${esc(s.id)}">${esc(s.label || 'Adsız')}<span class="ed-tab-count">${count}</span></button>`;
  }).join('');
  const sections = _edModel.sections.map((s, i) => {
    const display = s.id === _edActiveTab ? '' : 'display:none;';
    return `<div data-ed-section="${esc(s.id)}" style="${display}">${edSectionCard(s, i, _edModel.sections.length)}</div>`;
  }).join('');
  c.innerHTML = `
    <div class="ed-tabs flex flex-wrap items-center gap-1 mb-4" style="border-bottom:1px solid var(--border-soft)">
      ${tabs}
      <button type="button" onclick="edAddSection()" class="btn btn-primary btn-sm" style="margin-left:auto;margin-bottom:6px;white-space:nowrap">+ Yeni Bölüm Ekle</button>
    </div>
    ${sections}`;
}

function edSelectTab(id) {
  edSyncModel();
  _edActiveTab = id;
  renderEditorialForm();
}

// Read every form input back into the in-memory model.
function edSyncModel() {
  if (!_edModel) return;
  _edModel.sections.forEach((sec, si) => {
    const lbl = document.querySelector(`[data-sec="${si}"][data-f="seclabel"]`);
    if (lbl) sec.label = lbl.value;
    if (sec.layout === 'names') {
      const ta = document.querySelector(`[data-sec="${si}"][data-f="names"]`);
      if (ta) sec.names = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
      return;
    }
    (sec.members || []).forEach((mem, mi) => {
      const g = (f) => document.querySelector(`[data-sec="${si}"][data-mem="${mi}"][data-f="${f}"]`);
      let e;
      if ((e = g('name'))) mem.name = e.value;
      if ((e = g('title'))) mem.title = e.value;
      if ((e = g('aff'))) mem.affiliation = e.value;
      if ((e = g('email'))) mem.email = e.value;
      if ((e = g('photo'))) mem.photo = e.value;
      (mem.links || []).forEach((lk, li) => {
        const ll = document.querySelector(`[data-sec="${si}"][data-mem="${mi}"][data-link="${li}"][data-f="linklabel"]`);
        const lu = document.querySelector(`[data-sec="${si}"][data-mem="${mi}"][data-link="${li}"][data-f="linkurl"]`);
        if (ll) lk.label = ll.value;
        if (lu) lk.url = lu.value;
      });
    });
  });
}

// Mutation handlers — sync form → model, mutate, re-render.
function edAddSection() {
  edSyncModel();
  const newSec = { id: 'section-' + Date.now(), label: 'Yeni Bölüm', layout: 'grid', members: [{ name: '', title: '', affiliation: '', links: [] }] };
  _edModel.sections.push(newSec);
  _edActiveTab = newSec.id; // switch focus to the new section so the user sees it immediately
  renderEditorialForm();
  markDirty();
}
async function edRemoveSection(si) {
  edSyncModel();
  const sec = _edModel.sections[si];
  if (!sec) return;
  const count = sec.layout === 'names' ? (sec.names || []).length : (sec.members || []).length;
  const label = sec.label || 'Bu bölüm';
  const detail = count > 0
    ? `"${label}" bölümünü ve içindeki ${count} kayıt da silinecek. Bu işlem geri alınamaz. Devam edilsin mi?`
    : `"${label}" bölümü silinecek. Devam edilsin mi?`;
  if (!await confirmAction(detail)) return;
  _edModel.sections.splice(si, 1);
  if (_edActiveTab === sec.id) {
    _edActiveTab = (_edModel.sections[Math.max(0, si - 1)] || {}).id || null;
  }
  renderEditorialForm();
  markDirty();
}
function edMoveSection(si, d) { edSyncModel(); const a = _edModel.sections, j = si + d; if (j < 0 || j >= a.length) return; const t = a[si]; a[si] = a[j]; a[j] = t; renderEditorialForm(); markDirty(); }
function edAddMember(si) { edSyncModel(); const s = _edModel.sections[si]; s.members = s.members || []; s.members.push({ name: '', title: '', affiliation: '', links: [] }); renderEditorialForm(); markDirty(); }
async function edRemoveMember(si, mi) {
  edSyncModel();
  const m = _edModel.sections[si] && _edModel.sections[si].members && _edModel.sections[si].members[mi];
  if (!m) return;
  // Only ask if the row has any content worth losing.
  const hasData = (m.name && m.name.trim()) || (m.affiliation && m.affiliation.trim()) || (m.photo) || (m.links && m.links.some((l) => l && (l.url || l.label)));
  if (hasData) {
    const who = (m.name || '').trim() || `#${mi + 1}`;
    if (!await confirmAction(`"${who}" satırı silinecek. Devam edilsin mi?`)) return;
  }
  _edModel.sections[si].members.splice(mi, 1);
  renderEditorialForm();
  markDirty();
}
function edMoveMember(si, mi, d) { edSyncModel(); const a = _edModel.sections[si].members, j = mi + d; if (j < 0 || j >= a.length) return; const t = a[mi]; a[mi] = a[j]; a[j] = t; renderEditorialForm(); markDirty(); }
function edAddLink(si, mi) { edSyncModel(); const m = _edModel.sections[si].members[mi]; m.links = m.links || []; m.links.push({ label: '', url: '' }); renderEditorialForm(); markDirty(); }
function edRemoveLink(si, mi, li) { edSyncModel(); _edModel.sections[si].members[mi].links.splice(li, 1); renderEditorialForm(); markDirty(); }

async function edEditorialPhotoUpload(input) {
  if (!input.files || !input.files[0]) return;
  const si = Number(input.dataset.sec), mi = Number(input.dataset.mem);
  try {
    edSyncModel();
    const result = await API.uploadFile('/media/upload/editorial-photo', input.files[0], 'image');
    _edModel.sections[si].members[mi].photo = result.url;
    renderEditorialForm();
    markDirty();
    toast('Fotoğraf yüklendi');
  } catch (err) { toast(err.message, 'error'); }
}

// Upload a member's CV (PDF/JPG/PNG…) and set it as the link URL. If the
// link has no label yet, default to "CV". The link row's URL field is the
// public path under images/editorial-board/cv/ — site renders an image-CV
// link in a modal, a PDF link opens in a new tab.
async function edEditorialCvUpload(input) {
  if (!input.files || !input.files[0]) return;
  const si = Number(input.dataset.sec);
  const mi = Number(input.dataset.mem);
  const li = Number(input.dataset.link);
  try {
    edSyncModel();
    const result = await API.uploadFile('/media/upload/editorial-cv', input.files[0], 'file');
    const mem = _edModel.sections[si].members[mi];
    mem.links = mem.links || [];
    const lk = mem.links[li];
    if (!lk) return;
    lk.url = result.url;
    if (!lk.label || !lk.label.trim()) lk.label = 'CV';
    renderEditorialForm();
    markDirty();
    toast('Dosya yüklendi: ' + result.url);
  } catch (err) { toast(err.message, 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supplementary Library — standalone supplementary uploader that produces a
// permanent public URL for each file. The URL stays the same when content is
// replaced; renaming or deleting breaks any link already embedded in a PDF.
// ─────────────────────────────────────────────────────────────────────────────

// Build the public (production) URL for a supp-library file. When running
// against localhost we still want to display the production link, since that
// is what gets pasted into the article PDF.
function suppLibPublicUrl(filename) {
  const origin = window.location.origin.replace(/^http:\/\/localhost(?::\d+)?\/?$/, 'https://balkanmedicaljournal.org');
  return `${origin}/img/files/${encodeURIComponent(filename)}`;
}
function suppLibFmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function suppLibFmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch (_) { return iso; }
}

// Track which scope ("standalone" | "linked") the current page is showing so
// reloadTable knows what to fetch. Set by each route handler on entry.
let _suppLibScope = 'standalone';

async function suppLibReloadTable() {
  try {
    const data = await API.get('/supp-library?scope=' + encodeURIComponent(_suppLibScope));
    const tbody = document.getElementById('supp-lib-tbody');
    if (!tbody) return;
    const files = Array.isArray(data.files) ? data.files : [];
    const countEl = document.getElementById('supp-lib-count');
    if (countEl) countEl.textContent = String(files.length);
    const isLinked = _suppLibScope === 'linked';
    const colCount = isLinked ? 4 : 3;
    if (!files.length) {
      const emptyMsg = isLinked
        ? 'Henüz bir makaleye bağlı ek materyal yok. Yukarıdaki alandan bir makale ID girip dosya yükleyebilirsiniz.'
        : 'Henüz bağımsız ek materyal yok. Yukarıdaki alandan PDF veya başka bir dosya yükleyin.';
      tbody.innerHTML = `<tr><td colspan="${colCount}" class="text-center" style="padding:32px;color:var(--text-faint)">${emptyMsg}</td></tr>`;
      return;
    }
    tbody.innerHTML = files.map((f) => {
      const pubUrl = suppLibPublicUrl(f.name);
      // Build the "Bağlı Makale" cell only on the linked page.
      const refsCell = isLinked ? `
        <td style="padding:10px 12px;vertical-align:top">
          ${(f.references || []).map((r) => {
            const route = r.isAip ? '#/articles-in-press/' + esc(r.articleId) + '/edit' : '#/articles/' + esc(r.articleId);
            const tag = r.isAip ? 'AIP' : '';
            return `<div style="margin-bottom:4px"><a href="${route}" style="color:var(--brand);font-weight:500">#${esc(r.articleId)}</a> ${tag ? `<span class="badge badge-neutral" style="font-size:10px;margin-left:4px">${tag}</span>` : ''}<div class="text-xs" style="color:var(--text-muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.title)}">${esc(r.title)}</div></div>`;
          }).join('')}
        </td>` : '';
      return `<tr data-file="${esc(f.name)}">
        <td style="padding:10px 12px;vertical-align:top">
          <div style="font-weight:500;color:var(--text-strong);word-break:break-all">${esc(f.name)}</div>
          <div class="text-xs mt-1" style="color:var(--text-muted)">${suppLibFmtSize(f.size)} • ${suppLibFmtDate(f.mtime)}</div>
        </td>
        ${refsCell}
        <td style="padding:10px 12px;vertical-align:top">
          <div class="flex items-center gap-1.5">
            <input readonly value="${esc(pubUrl)}" class="input" style="font-size:12px;flex:1;background:var(--bg-page);font-family:ui-monospace,monospace" onclick="this.select()">
            <button type="button" onclick="suppLibCopyUrl('${esc(f.name)}', this)" class="btn btn-secondary btn-sm" title="URL'yi kopyala">Kopyala</button>
            <a href="/site${esc(f.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" title="Yüklenen dosyayı yerel olarak aç">Önizle</a>
          </div>
        </td>
        <td style="padding:10px 12px;vertical-align:top;white-space:nowrap">
          <label class="btn btn-ghost btn-sm" style="cursor:pointer" title="Aynı URL'yi koru, sadece dosyanın içeriğini güncelle">
            İçeriği Değiştir
            <input type="file" class="hidden" onchange="suppLibReplaceContent('${esc(f.name)}', this)">
          </label>
          <button type="button" onclick="suppLibRename('${esc(f.name)}')" class="btn btn-ghost btn-sm" title="Dosya adını değiştir — bu, mevcut linki bozar!">Yeniden Adlandır</button>
          <button type="button" onclick="suppLibDelete('${esc(f.name)}')" class="btn btn-ghost btn-sm" style="color:var(--danger)" title="Dosyayı sil — mevcut linki bozar!">Sil</button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    toast('Liste yüklenemedi: ' + err.message, 'error');
  }
}

async function suppLibCopyUrl(name, btn) {
  const url = suppLibPublicUrl(name);
  try {
    await navigator.clipboard.writeText(url);
    if (btn) {
      const original = btn.textContent;
      btn.textContent = '✓ Kopyalandı';
      setTimeout(() => { btn.textContent = original; }, 1200);
    }
  } catch (_) {
    // Older browsers / non-secure contexts: fall back to a transient textarea.
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
    toast('URL kopyalandı', 'success');
  }
}

async function suppLibUploadFiles(files, opts = {}) {
  if (!files || !files.length) return;
  const status = document.getElementById('supp-lib-upload-status');
  const renameInput = document.getElementById('supp-lib-rename');
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  if (files.length === 1 && renameInput && renameInput.value.trim()) {
    fd.append('rename', renameInput.value.trim());
  }
  if (opts.articleId) fd.append('articleId', String(opts.articleId).trim());
  const q = opts.overwrite ? '?overwrite=true' : '';
  if (status) status.textContent = `${files.length} dosya yükleniyor…`;
  try {
    const res = await fetch('/api/supp-library/upload' + q, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Yükleme hatası');
    if (data.conflicts && data.conflicts.length) {
      const names = data.conflicts.map((c) => c.name).join(', ');
      const ok = await confirmAction(`Bu dosyalar zaten var ve aynı linki koruyarak içerikleri değiştirilecek:\n\n${names}\n\nDevam edilsin mi?`);
      if (ok) {
        // Re-send with overwrite, but only the conflicting files this time.
        const conflictSet = new Set(data.conflicts.map((c) => c.name));
        const toReupload = Array.from(files).filter((f) => {
          const safe = (renameInput && renameInput.value.trim()) || f.name;
          return conflictSet.has(safe.replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '-'));
        });
        if (toReupload.length) await suppLibUploadFiles(toReupload, { overwrite: true, articleId: opts.articleId });
      }
    }
    if (status) status.textContent = `${(data.uploaded || []).length} dosya yüklendi.`;
    if (renameInput) renameInput.value = '';
    await suppLibReloadTable();
    if ((data.uploaded || []).length) {
      toast(`${data.uploaded.length} dosya yüklendi`, 'success');
    }
    // Surface what happened on the article side, if any.
    if (data.articleLinked) {
      if (data.articleLinked.error) {
        toast(`Makale bulunamadı (ID: ${opts.articleId}). Dosya bağımsız olarak yüklendi; linki manuel olarak makaleye eklemeniz gerekir.`, 'error');
      } else if (data.articleLinked.added && data.articleLinked.added.length) {
        const tag = data.articleLinked.isAip ? 'AIP' : 'makale';
        toast(`${data.articleLinked.added.length} dosya ${tag} #${opts.articleId} listesine eklendi`, 'success');
      }
    }
  } catch (err) {
    if (status) status.textContent = 'Hata: ' + err.message;
    toast(err.message, 'error');
  }
}

async function suppLibReplaceContent(name, input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const ok = await confirmAction(`"${name}" dosyasının içeriği güncellenecek. URL aynı kalır, sadece içerik değişir. Devam edilsin mi?`);
  if (!ok) { input.value = ''; return; }
  const fd = new FormData(); fd.append('file', file);
  try {
    const res = await fetch(`/api/supp-library/${encodeURIComponent(name)}/replace`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');
    toast(`İçerik güncellendi: ${name}`, 'success');
    await suppLibReloadTable();
  } catch (err) {
    toast(err.message, 'error');
  } finally { input.value = ''; }
}

async function suppLibRename(name) {
  const ok = await confirmAction(`Dikkat: Yeniden adlandırma, "${name}" için daha önce verilmiş olan tüm linkleri bozar. Yalnızca link henüz hiçbir PDF'e gömülmediyse güvenlidir.\n\nDevam edilsin mi?`);
  if (!ok) return;
  const to = window.prompt('Yeni dosya adı (uzantı dahil):', name);
  if (!to || to === name) return;
  try {
    const res = await fetch(`/api/supp-library/${encodeURIComponent(name)}/rename`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');
    toast(`Yeniden adlandırıldı: ${name} → ${data.file && data.file.name}`, 'success');
    await suppLibReloadTable();
  } catch (err) { toast(err.message, 'error'); }
}

async function suppLibDelete(name) {
  const ok = await confirmAction(`"${name}" silinecek. Bu linki kullanan mevcut PDF'lerin bağlantıları kırılır. Devam edilsin mi?`);
  if (!ok) return;
  try {
    const res = await fetch(`/api/supp-library/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');
    toast(`Silindi: ${name}`, 'success');
    await suppLibReloadTable();
  } catch (err) { toast(err.message, 'error'); }
}

// Shared upload-card wiring used by both supp-library routes. The opts builder
// returns either the options object for suppLibUploadFiles, or null if a
// validation step (like "you must enter an article ID") failed.
function suppLibWireUploadCard(dropId, inputId, getOpts) {
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  if (!drop || !input) return;
  input.addEventListener('change', () => {
    if (!input.files || !input.files.length) return;
    const opts = getOpts();
    if (opts === null) { input.value = ''; return; }
    suppLibUploadFiles(Array.from(input.files), opts || {});
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault(); drop.style.borderColor = 'var(--brand)'; drop.style.background = 'var(--brand-soft)';
  }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault(); drop.style.borderColor = ''; drop.style.background = 'var(--bg-page)';
  }));
  drop.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const opts = getOpts();
    if (opts === null) return;
    suppLibUploadFiles(Array.from(files), opts || {});
  });
}

function suppLibTableSection(scope) {
  const isLinked = scope === 'linked';
  const refCol = isLinked
    ? '<th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);font-weight:600;width:25%">Bağlı Makale</th>'
    : '';
  return `
    <div class="card">
      <div class="card-padded" style="border-bottom:1px solid var(--border-soft);padding-bottom:12px">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="text-base font-semibold" style="color:var(--text-strong)">${isLinked ? 'Makaleye Bağlı Dosyalar' : 'Bağımsız Dosyalar'} (<span id="supp-lib-count">0</span>)</h2>
          <button type="button" onclick="suppLibReloadTable()" class="btn btn-ghost btn-sm">Listeyi Yenile</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="w-full" style="border-collapse:separate;border-spacing:0">
          <thead>
            <tr style="background:var(--bg-page)">
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);font-weight:600;width:${isLinked ? '25' : '30'}%">Dosya</th>
              ${refCol}
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);font-weight:600">Kalıcı URL</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);font-weight:600;white-space:nowrap">İşlemler</th>
            </tr>
          </thead>
          <tbody id="supp-lib-tbody" style="font-size:13px"></tbody>
        </table>
      </div>
    </div>`;
}

// ── Page 1: standalone supplementary files (no article context) ──────────────
route('/supp-library', async (el) => {
  _suppLibScope = 'standalone';
  el.innerHTML = `
    ${pageHeader({
      eyebrow: 'Yayın',
      title: 'Ek Materyal — Bağımsız',
      subtitle: 'Henüz hangi makaleye ait olduğu bilinmeyen ek materyal dosyaları. Sadece kalıcı bir URL üretilir; sisteme makale bilgisi girmenize gerek yoktur.',
      actions: '<a href="#/supp-library-linked" class="btn btn-secondary btn-sm">Makaleye Bağlı Dosyalar →</a>',
    })}

    <div class="card card-padded mb-4" style="background:#fffbeb;border-color:#fbd38d">
      <div class="flex items-start gap-3">
        <div style="color:#b45309;font-size:18px;line-height:1">ℹ︎</div>
        <div class="text-sm" style="color:#78350f;line-height:1.6">
          Üretilen link <code style="background:#fef3c7;padding:1px 4px;border-radius:3px">https://balkanmedicaljournal.org/img/files/<em>dosyaadı</em></code> formatındadır ve dosya adı değişmedikçe sabit kalır.
          Daha sonra dosya güncellenirse <strong>İçeriği Değiştir</strong> kullanın — link aynı kalır, PDF'lere gömülü bağlantılar bozulmaz.
          Bir dosyanın aslında bir makaleye ait olduğu sonradan anlaşılırsa <a href="#/supp-library-linked" style="color:#92400e;text-decoration:underline">Makaleye Bağlı sayfasına</a> geçip aynı isimle makale ID'si ile yeniden yükleyin — link değişmez, makale Supplementary listesine eklenir.
        </div>
      </div>
    </div>

    <div class="card card-padded mb-6">
      <div class="flex items-baseline gap-2 mb-3">
        <h2 class="text-base font-semibold" style="color:var(--text-strong)">Yeni Bağımsız Dosya Yükle</h2>
        <span class="text-xs" style="color:var(--text-faint)">PDF, ZIP, görsel, video, ses, ofis dosyaları</span>
      </div>
      <div class="flex items-center gap-2 mb-3 text-xs" style="color:var(--text-muted)">
        <label for="supp-lib-rename" style="white-space:nowrap">Tercih edilen dosya adı (opsiyonel, tek dosya için):</label>
        <input id="supp-lib-rename" class="input" style="flex:1;max-width:520px;font-size:12px" placeholder="ör. BalkanMedJ-2026.2026-3-213-supplement-tables.pdf">
      </div>
      <div id="supp-lib-drop-standalone" class="rounded-lg" style="border:2px dashed var(--border);padding:24px;text-align:center;background:var(--bg-page)">
        <p class="text-sm mb-2" style="color:var(--text-muted)">Dosyaları buraya sürükleyin <span style="color:var(--text-faint)">veya</span></p>
        <label class="btn btn-primary btn-sm" style="cursor:pointer">
          📄 Dosya Seç
          <input type="file" id="supp-lib-file-input" multiple class="hidden">
        </label>
      </div>
      <div id="supp-lib-upload-status" class="mt-3 text-xs" style="color:var(--text-faint)"></div>
    </div>

    ${suppLibTableSection('standalone')}
  `;

  suppLibWireUploadCard('supp-lib-drop-standalone', 'supp-lib-file-input', () => ({}));
  await suppLibReloadTable();
});

// ── Page 2: article-attached supplementary files ─────────────────────────────
route('/supp-library-linked', async (el) => {
  _suppLibScope = 'linked';
  el.innerHTML = `
    ${pageHeader({
      eyebrow: 'Yayın',
      title: 'Ek Materyal — Makaleye Bağlı',
      subtitle: 'Belirli bir makaleye ait olduğu bilinen ek materyaller. Kalıcı bir link üretilir ve dosya, seçilen makalenin Supplementary Materials listesine otomatik eklenir.',
      actions: '<a href="#/supp-library" class="btn btn-secondary btn-sm">Bağımsız Dosyalar →</a>',
    })}

    <div class="card card-padded mb-4" style="background:#fffbeb;border-color:#fbd38d">
      <div class="flex items-start gap-3">
        <div style="color:#b45309;font-size:18px;line-height:1">ℹ︎</div>
        <div class="text-sm" style="color:#78350f;line-height:1.6">
          Üretilen link <code style="background:#fef3c7;padding:1px 4px;border-radius:3px">https://balkanmedicaljournal.org/img/files/<em>dosyaadı</em></code> formatındadır ve dosya adı değişmedikçe sabit kalır.
          Yükleme sırasında girdiğiniz <strong>Makale ID</strong>'nin Supplementary Materials listesine bu dosya otomatik eklenir.
          İçerik güncellemek için <strong>İçeriği Değiştir</strong> kullanın — link aynı kalır, PDF'lere gömülü bağlantılar bozulmaz.
        </div>
      </div>
    </div>

    <div class="card card-padded mb-6">
      <div class="flex items-baseline gap-2 mb-3">
        <h2 class="text-base font-semibold" style="color:var(--text-strong)">Bir Makaleye Bağlı Yeni Dosya Yükle</h2>
        <span class="text-xs" style="color:var(--text-faint)">PDF, ZIP, görsel, video, ses, ofis dosyaları</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3 text-xs" style="color:var(--text-muted)">
        <div>
          <label for="supp-lib-article-id" style="white-space:nowrap;font-weight:500;color:var(--text-strong);display:block;margin-bottom:4px">Makale ID <span style="color:var(--danger)">*</span></label>
          <input id="supp-lib-article-id" class="input" style="width:100%;font-size:12px" placeholder="ör. 2811">
        </div>
        <div class="md:col-span-2">
          <label for="supp-lib-rename" style="white-space:nowrap;font-weight:500;color:var(--text-strong);display:block;margin-bottom:4px">Tercih edilen dosya adı (opsiyonel)</label>
          <input id="supp-lib-rename" class="input" style="width:100%;font-size:12px" placeholder="ör. BalkanMedJ-2026.2026-3-213-supplement-tables.pdf">
        </div>
      </div>
      <div id="supp-lib-drop-article" class="rounded-lg" style="border:2px dashed var(--border);padding:24px;text-align:center;background:var(--bg-page)">
        <p class="text-sm mb-2" style="color:var(--text-muted)">Dosyaları buraya sürükleyin <span style="color:var(--text-faint)">veya</span></p>
        <label class="btn btn-primary btn-sm" style="cursor:pointer">
          📄 Dosya Seç ve Makaleye Bağla
          <input type="file" id="supp-lib-file-input-article" multiple class="hidden">
        </label>
      </div>
      <div id="supp-lib-upload-status" class="mt-3 text-xs" style="color:var(--text-faint)"></div>
    </div>

    ${suppLibTableSection('linked')}
  `;

  suppLibWireUploadCard('supp-lib-drop-article', 'supp-lib-file-input-article', () => {
    const idEl = document.getElementById('supp-lib-article-id');
    const articleId = (idEl && idEl.value || '').trim();
    if (!articleId) {
      toast("Önce yukarıdaki kutuya makale ID'sini girin.", 'error');
      return null;
    }
    return { articleId };
  });
  await suppLibReloadTable();
});

route('/editorial', async (el) => {
  const board = await API.get('/editorial');
  _edModel = { sections: Array.isArray(board.sections) ? board.sections : [] };
  _edModel.sections.forEach((s) => {
    if (s.layout === 'names') { s.names = s.names || []; }
    else { s.members = (s.members || []).map((m) => ({ ...m, links: m.links || [] })); }
  });
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Yayın Kurulu</h1>
      <button onclick="saveEditorial()" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Kaydet</button>
    </div>
    <div class="banner banner-info mb-4">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <div class="banner-body" style="margin-top:0">Her bölüm bağımsız düzenlenir. <strong>+ Yeni Bölüm Ekle</strong> ile yeni başlık (ör. Konu Editörü) açabilir, ▲▼ ile sıralayabilir, her kişiye ORCID/CV gibi birden çok bağlantı ekleyebilirsiniz. Değişiklikler <strong>Kaydet</strong> ile sitenin yayın kurulu sayfasına yansır.</div>
    </div>
    <div id="ed-sections" class="space-y-5"></div>`;
  renderEditorialForm();
  el.addEventListener('input', markDirty);
  el.addEventListener('change', (e) => {
    if (e.target && e.target.classList) {
      if (e.target.classList.contains('ed-photo-file')) edEditorialPhotoUpload(e.target);
      else if (e.target.classList.contains('ed-cv-file')) edEditorialCvUpload(e.target);
    }
  });
  clearDirty();
});

async function saveEditorial() {
  edSyncModel();
  const sections = _edModel.sections.map((s) => {
    if (s.layout === 'names') {
      return { id: s.id, label: (s.label || '').trim(), layout: 'names', names: (s.names || []).filter(Boolean) };
    }
    const members = (s.members || []).filter((m) => (m.name || '').trim()).map((m) => {
      const o = { name: m.name.trim(), title: (m.title || '').trim(), affiliation: (m.affiliation || '').trim() };
      if ((m.email || '').trim()) o.email = m.email.trim();
      if ((m.photo || '').trim()) o.photo = m.photo.trim();
      if (m.period) o.period = m.period;
      o.links = (m.links || []).filter((l) => (l.url || '').trim())
        .map((l) => ({ label: (l.label || '').trim() || 'Bağlantı', url: l.url.trim() }));
      return o;
    });
    return { id: s.id, label: (s.label || '').trim(), layout: s.layout || 'grid', members };
  });
  try {
    await API.put('/editorial', { sections });
    clearDirty();
    toast('Yayın kurulu kaydedildi');
  } catch (err) { toast(err.message, 'error'); }
}

// Pages
route('/pages', async (el) => {
  const pages = await API.get('/pages');
  const withShort = pages.filter(p => p.shortCode).length;
  el.innerHTML = `
    <div class="page-header">
      <div class="min-w-0">
        <h1 class="page-title">Sayfalar <span style="font-weight:400;color:var(--text-muted);font-size:18px">(${pages.length})</span></h1>
        <p class="page-subtitle">Sistem ve özel sayfaları yönetin. Her sayfaya akılda kalıcı bir <strong>kısa link</strong> atayabilirsiniz — paylaşılabilir, otomatik olarak asıl sayfaya yönlendirir.</p>
      </div>
      <button onclick="showNewPageModal()" class="btn btn-primary text-sm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Yeni Sayfa
      </button>
    </div>

    <div class="card card-padded mb-5" style="background:#f0f9ff;border-color:#bae6fd;padding:14px 16px">
      <div class="flex items-start gap-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0369a1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        <div class="text-sm" style="color:#0c4a6e;line-height:1.55">
          <strong>Kısa link nasıl çalışır?</strong> Bir sayfaya kısa link kodu atadığınızda <code>balkanmedicaljournal.org/s/<em>kod</em></code> URL'si oluşturulur ve otomatik olarak asıl sayfaya yönlendirir. ${withShort} sayfa için kısa link tanımlı.
        </div>
      </div>
    </div>

    <div class="card overflow-hidden">
      <div class="divide-y" style="border-color:var(--border-soft)">
        ${pages.map((p) => `
          <div class="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-gray-50" style="border-bottom:1px solid var(--border-soft)">
            <a href="#/pages/${p.slug}" class="flex-1 min-w-0 flex items-center gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium" style="color:var(--text-strong)">${esc(p.title)}</span>
                  <code class="text-xs" style="color:var(--text-muted)">${esc(p.file)}</code>
                  ${p.custom ? '<span class="badge" style="background:#ccfbf1;color:#0f766e;font-size:11px;padding:2px 6px">Özel</span>' : ''}
                </div>
              </div>
            </a>
            <div class="flex items-center gap-2 flex-shrink-0" style="min-width:0">
              ${p.shortCode
                ? `<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style="background:#f0fdfa;border:1px solid #99f6e4">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                     <code class="text-xs font-medium" style="color:#0f766e">/s/${esc(p.shortCode)}</code>
                     <button onclick="event.stopPropagation(); copyShortLink('${esc(p.shortCode)}', this)" title="Kopyala" style="background:transparent;border:0;padding:0 2px;cursor:pointer;color:#0f766e">
                       <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                     </button>
                     <button onclick="event.stopPropagation(); editShortLink('${p.slug}', '${esc(p.title).replace(/'/g, "\\'")}', '${esc(p.shortCode)}')" title="Düzenle" style="background:transparent;border:0;padding:0 2px;cursor:pointer;color:#0f766e">
                       <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                     </button>
                     <button onclick="event.stopPropagation(); removeShortLink('${p.slug}', '${esc(p.shortCode)}')" title="Kaldır" style="background:transparent;border:0;padding:0 2px;cursor:pointer;color:#b91c1c">
                       <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                     </button>
                   </div>`
                : `<button onclick="event.stopPropagation(); editShortLink('${p.slug}', '${esc(p.title).replace(/'/g, "\\'")}', '')" class="text-xs font-medium" style="color:var(--text-muted);padding:5px 10px;border:1px dashed var(--border);border-radius:8px" onmouseover="this.style.color='var(--brand)'; this.style.borderColor='var(--brand)'" onmouseout="this.style.color='var(--text-muted)'; this.style.borderColor='var(--border)'">
                     + Kısa link ekle
                   </button>`}
              ${p.custom ? `<button onclick="event.stopPropagation(); deleteCustomPage('${p.slug}', '${esc(p.title).replace(/'/g, "\\'")}')" class="text-red-500 hover:text-red-700 text-xs px-2 py-1" title="Sil">Sil</button>` : ''}
              <a href="#/pages/${p.slug}" class="text-gray-400 hover:text-gray-600">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
              </a>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
});

function copyShortLink(code, btn) {
  // Build the full URL using the current site origin
  const origin = window.location.origin.replace(/^http:\/\/localhost(?::\d+)?\/?$/, 'https://balkanmedicaljournal.org');
  const url = `${origin}/s/${code}`;
  navigator.clipboard?.writeText(url).then(() => {
    toast(`Kopyalandı: ${url}`);
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => { btn.innerHTML = orig; }, 1200);
    }
  }).catch(() => toast(url));
}

async function editShortLink(slug, title, currentCode) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-dialog">
        <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
          <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">${currentCode ? 'Kısa Linki Düzenle' : 'Kısa Link Ekle'}</h3>
          <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="px-6 py-5">
          <p class="text-sm mb-3" style="color:var(--text)">Sayfa: <strong>${esc(title)}</strong></p>
          <label class="label" for="sl-code">Kısa link kodu</label>
          <div class="flex items-center gap-2">
            <span class="text-sm font-mono" style="color:var(--text-muted);white-space:nowrap">…/s/</span>
            <input id="sl-code" type="text" class="flex-1 px-3 py-2 rounded-lg text-sm font-mono" style="border:1px solid var(--border)" maxlength="30" autocomplete="off" value="${esc(currentCode)}" placeholder="örn. auth">
          </div>
          <p class="text-xs mt-2" style="color:var(--text-muted)">Yalnızca küçük harf, rakam ve tire (2-30 karakter). Örnek: <code>auth</code>, <code>guidelines-2026</code></p>
          <div id="sl-preview" class="mt-3 text-xs"></div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
          <button data-action="cancel" class="btn btn-secondary">İptal</button>
          <button data-action="save" class="btn btn-primary">Kaydet</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#sl-code');
    const previewEl = overlay.querySelector('#sl-preview');

    function updatePreview() {
      const v = (input.value || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
      if (input.value !== v) input.value = v;
      const origin = 'balkanmedicaljournal.org';
      previewEl.innerHTML = v ? `Önizleme: <code style="color:var(--brand);background:#f0fdfa;padding:2px 6px;border-radius:4px">${origin}/s/${v}</code>` : '';
    }
    input.addEventListener('input', updatePreview);
    updatePreview();
    setTimeout(() => { input.focus(); input.select(); }, 50);

    const finish = async (action) => {
      const code = (input.value || '').trim();
      if (action === 'save') {
        if (!code) { toast('Kısa link kodu boş olamaz', 'error'); return; }
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        try {
          await API.put(`/pages/${slug}/short-code`, { code });
          toast(`Kısa link kaydedildi: /s/${code}`);
          handleRoute();
        } catch (err) { toast(err.message, 'error'); }
        resolve();
      } else {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve();
      }
    };
    overlay.querySelector('.modal-close').onclick = () => finish('cancel');
    overlay.querySelectorAll('[data-action]').forEach(b => b.onclick = () => finish(b.dataset.action));
    overlay.addEventListener('click', e => { if (e.target === overlay) finish('cancel'); });
    const onKey = (e) => {
      if (e.key === 'Escape') finish('cancel');
      else if (e.key === 'Enter' && document.activeElement === input) finish('save');
    };
    document.addEventListener('keydown', onKey);
  });
}

async function removeShortLink(slug, code) {
  if (!await confirmAction(`/s/${code} kısa linki kaldırılacak — bu URL'yi paylaşan içeriklerden bağlantı koparılacak. Devam edilsin mi?`)) return;
  try {
    await API.del(`/pages/${slug}/short-code`);
    toast('Kısa link kaldırıldı');
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

function showNewPageModal() {
  const existing = document.getElementById('new-page-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'new-page-overlay';
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4">
      <div class="border-b px-6 py-4 flex items-center justify-between">
        <h2 class="text-lg font-bold text-gray-900">Yeni Sayfa Oluştur</h2>
        <button onclick="this.closest('#new-page-overlay').remove()" class="text-gray-400 hover:text-gray-700 p-1">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="px-6 py-5 space-y-4">
        <div>
          <label class="label">Başlık <span class="text-red-500">*</span></label>
          <input id="np-title" type="text" placeholder="Örn: Open Access" class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
        </div>
        <div>
          <label class="label">Slug (URL) <span class="text-red-500">*</span></label>
          <div class="flex items-center">
            <input id="np-slug" type="text" placeholder="open-access" class="flex-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
            <span class="text-sm text-gray-400 ml-2">.html</span>
          </div>
          <p class="text-xs text-gray-500 mt-1">Yalnızca küçük harf, rakam ve tire (-). Başlıktan otomatik oluşturulur.</p>
        </div>
        <div>
          <label class="label">SEO Açıklaması</label>
          <textarea id="np-description" rows="2" placeholder="Arama motorları ve sosyal medyada görünecek kısa açıklama" class="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"></textarea>
        </div>
        <div>
          <label class="label">Kısa link kodu <span class="text-gray-400 font-normal">(opsiyonel)</span></label>
          <div class="flex items-center gap-2">
            <span class="text-sm font-mono text-gray-500" style="white-space:nowrap">…/s/</span>
            <input id="np-short-code" type="text" placeholder="örn. auth" maxlength="30" class="flex-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
          </div>
          <p class="text-xs text-gray-500 mt-1">Akılda kalıcı kısa bir URL. Boş bırakırsanız sonra ekleyebilirsiniz.</p>
        </div>
        <div class="bg-slate-50 rounded-lg p-3 text-xs text-slate-800">
          <strong>Not:</strong> Yeni sayfa nav/footer ile birlikte oluşturulur. Ancak menü bağlantısını eklemek için <em>Nav & Footer</em> bölümünden sayfayı manuel eklemeniz gerekir.
        </div>
      </div>
      <div class="bg-gray-50 border-t px-6 py-4 rounded-b-2xl flex justify-end gap-2">
        <button onclick="this.closest('#new-page-overlay').remove()" class="px-4 py-2 bg-white border text-gray-700 rounded-lg hover:bg-gray-50 text-sm">İptal</button>
        <button onclick="submitNewPage()" class="px-5 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Oluştur</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Auto-generate slug from title
  const titleEl = document.getElementById('np-title');
  const slugEl = document.getElementById('np-slug');
  let slugEdited = false;
  slugEl.addEventListener('input', () => { slugEdited = true; });
  titleEl.addEventListener('input', () => {
    if (!slugEdited) {
      slugEl.value = titleEl.value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }
  });
  setTimeout(() => titleEl.focus(), 50);
}

async function submitNewPage() {
  const title = document.getElementById('np-title').value.trim();
  const slug = document.getElementById('np-slug').value.trim();
  const description = document.getElementById('np-description').value.trim();
  const shortCode = document.getElementById('np-short-code').value.trim();

  if (!title) { toast('Başlık gerekli', 'error'); return; }
  if (!slug) { toast('Slug gerekli', 'error'); return; }

  try {
    const result = await API.post('/pages', { title, slug, description });
    // If user provided a short code, set it as a follow-up call (page must
    // exist before the short-code endpoint can attach to it).
    if (shortCode) {
      try { await API.put(`/pages/${result.slug}/short-code`, { code: shortCode }); }
      catch (err) { toast(`Sayfa oluşturuldu fakat kısa link atanamadı: ${err.message}`, 'warning'); }
    }
    toast(`"${result.title}" sayfası oluşturuldu${shortCode ? ' (/s/' + shortCode + ')' : ''}`);
    document.getElementById('new-page-overlay')?.remove();
    location.hash = `#/pages/${result.slug}`;
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteCustomPage(slug, title) {
  if (!await confirmAction(`"${title}" sayfası ve HTML dosyası silinecek. Bu işlem geri alınamaz. Devam?`)) return;
  try {
    await API.del(`/pages/${slug}`);
    toast('Sayfa silindi');
    if (location.hash !== '#/pages') location.hash = '#/pages';
    else handleRoute();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Pages that use the new "edit the live view" visual editor. These are the
// design-rich static pages where editing raw HTML/sections is error-prone for
// non-technical editors. Any other page keeps the classic editor below.
const VISUAL_PAGE_SLUGS = new Set([
  'index', 'about', 'for-authors', 'for-reviewers', 'policies', 'contact', 'forms', 'journal-metrics',
]);

route('/pages/:slug', async (el, { slug }) => {
  const page = await API.get(`/pages/${slug}`);
  if (VISUAL_PAGE_SLUGS.has(slug)) { renderVisualPageEditor(el, page, slug); return; }
  const hasSections = page.sections && page.sections.length > 0;

  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${esc(page.title)}</h1>
      <div class="flex gap-2">
        <a href="#/pages" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm">Geri</a>
        <a href="/site/${esc(page.file)}" target="_blank" rel="noopener" class="px-4 py-2 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 text-sm font-medium">Önizle</a>
        <button id="toggle-editor-mode" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm" title="Bölümlere ayrılmış düzen ile tek parça düzen arasında geçiş yapın">${hasSections ? 'Tek Parça' : 'Bölümler'}</button>
        <button onclick="savePage('${slug}')" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Kaydet</button>
      </div>
    </div>

    <!-- Visual editor (section-based) -->
    <div id="page-visual-editor" ${hasSections ? '' : 'class="hidden"'}>
      <p class="text-sm text-gray-500 mb-4">Her bölümü ayrı ayrı düzenleyebilirsiniz. Araç çubuğundaki butonlarla metni biçimlendirebilirsiniz.</p>
      <div id="page-sections" class="space-y-4">
        ${(page.sections || []).map((s, i) => pageSectionBlock(s, i)).join('')}
      </div>
      <button onclick="addPageSection()" class="mt-4 px-4 py-2 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 text-sm font-medium">+ Bölüm Ekle</button>
    </div>

    <!-- Raw HTML editor (fallback) -->
    <div id="page-html-editor" ${hasSections ? 'class="hidden"' : ''}>
      <p class="text-sm text-gray-500 mb-4">Tüm sayfa içeriğini görsel olarak düzenleyin. Araç çubuğundaki butonlarla metni biçimlendirebilirsiniz.</p>
      <div class="card" style="padding:24px">
        ${htmlEditor({ prefix: 'pg-content', initialHtml: page.content || '', rows: 30, placeholder: 'Sayfa içeriği', variant: 'simple', minHeight: '500px' })}
      </div>
    </div>`;

  // Toggle mode button
  let visualMode = hasSections;
  document.getElementById('toggle-editor-mode').addEventListener('click', () => {
    visualMode = !visualMode;
    document.getElementById('page-visual-editor').classList.toggle('hidden', !visualMode);
    document.getElementById('page-html-editor').classList.toggle('hidden', visualMode);
    document.getElementById('toggle-editor-mode').textContent = visualMode ? 'Tek Parça' : 'Bölümler';
    if (!visualMode) {
      // Sync sections -> page HTML editor
      setHtmlEditorContent('pg-content', buildPageHtmlFromSections());
    }
  });
});

// ── "Edit the live view" visual page editor ─────────────────────────────────
// Renders the page's real content (with the site's own CSS) inside a same-origin
// iframe and makes only the TEXT editable in place — structure/layout is locked,
// so a non-technical editor changes wording/values without breaking the design.
// On save we serialise the (structure-identical) HTML back, so the live site is
// preserved byte-for-byte except for the text that was actually changed.
function renderVisualPageEditor(el, page, slug) {
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${esc(page.title)}</h1>
      <div class="flex gap-2">
        <a href="#/pages" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm">Geri</a>
        <a href="/site/${esc(page.file)}" target="_blank" rel="noopener" class="px-4 py-2 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 text-sm font-medium">Önizle</a>
        <button id="pg-undo" onclick="_pgUndo()" disabled class="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5" title="Geri Al (Ctrl+Z)">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/></svg>Geri Al</button>
        <button id="pg-redo" onclick="_pgRedo()" disabled class="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center" title="İleri Al (Ctrl+Shift+Z)">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"/></svg></button>
        <button id="pg-advanced-toggle" onclick="toggleVisualPageRaw('${slug}')" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm" title="Sayfanın HTML kodunu düzenle (ileri düzey — gerekmedikçe kullanmayın)">Gelişmiş (HTML)</button>
        <button onclick="saveVisualPage('${slug}')" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Kaydet<span data-dirty-indicator class="text-amber-200"></span></button>
      </div>
    </div>

    <div class="card card-padded mb-4 flex items-start gap-3" style="background:var(--brand-soft);border-color:var(--brand-soft-2)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--brand);flex-shrink:0;margin-top:2px"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
      <div class="text-sm" style="color:var(--text-strong)">
        Aşağıda sayfanın <strong>gerçek görünümü</strong> var. Değiştirmek istediğiniz <strong>herhangi bir yazıya tıklayıp</strong> yazın — başlıklar, kartlardaki sayılar, tablo değerleri, bağlantı metinleri. Yazıyı <strong>seçtiğinizde</strong> kalın/italik/başlık/renk araç çubuğu otomatik çıkar.
        <span style="color:var(--text-muted)">Tasarım ve düzen kilitlidir; yanlışlıkla bozamazsınız. Bitince <strong>Kaydet</strong>'e basın.</span>
      </div>
    </div>

    <div id="pg-insert-bar" class="flex flex-wrap items-center gap-1.5 mb-3 px-3 py-2 rounded-lg" style="background:var(--bg-subtle);border:1px solid var(--border-soft)">
      <span class="text-xs font-semibold mr-1" style="color:var(--text-muted)">Ekle:</span>
      <button type="button" onclick="pgInsertMedia('image')" title="Resim ekle — imlecin bulunduğu yerden sonra eklenir" class="px-2.5 py-1.5 rounded-md hover:bg-white border border-transparent hover:border-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1.5">${_mediaImageIcon}<span>Resim</span></button>
      <button type="button" onclick="pgInsertMedia('video')" title="Video ekle (yükle veya URL)" class="px-2.5 py-1.5 rounded-md hover:bg-white border border-transparent hover:border-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1.5">${_mediaVideoIcon}<span>Video</span></button>
      <button type="button" onclick="pgInsertMedia('youtube')" title="YouTube videosu ekle (bağlantı yapıştır)" class="px-2.5 py-1.5 rounded-md hover:bg-white border border-transparent hover:border-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1.5">${_mediaYouTubeIcon}<span>YouTube</span></button>
      <span class="text-xs ml-1" style="color:var(--text-faint)">Eklemek istediğiniz yere önce tıklayın, sonra bir düğme seçin.</span>
    </div>

    <iframe id="pg-frame" title="Sayfa düzenleyici" style="width:100%;min-height:600px;border:1px solid var(--border-soft);border-radius:12px;background:#fff;display:block"></iframe>
    <textarea id="pg-raw" class="hidden w-full px-3 py-2 border rounded-lg text-xs font-mono" style="min-height:600px;border-color:var(--border-soft)" spellcheck="false"></textarea>`;

  const frame = document.getElementById('pg-frame');
  frame.onload = () => _wireVisualPageEditor(frame);
  frame.srcdoc = _visualPageSrcdoc(page.content || '');
  clearDirty();
  _visualRawMode = false;
}

let _visualRawMode = false;

// Persistent "Ekle" toolbar handler for the visual page editor. Captures the
// caret inside the iframe NOW (before the modal steals focus), opens the shared
// media dialog, and inserts the built <figure> at that caret. Falls back to the
// raw textarea when the editor is in "Gelişmiş (HTML)" mode.
function pgInsertMedia(kind) {
  if (_visualRawMode) {
    const raw = document.getElementById('pg-raw');
    const inserter = (html) => {
      if (!raw) return;
      const s = raw.selectionStart != null ? raw.selectionStart : raw.value.length;
      raw.value = raw.value.slice(0, s) + '\n' + html + '\n' + raw.value.slice(s);
      markDirty();
    };
    if (kind === 'image') openMediaImageDialog(inserter);
    else if (kind === 'video') openMediaVideoDialog(inserter);
    else openMediaYouTubeDialog(inserter);
    return;
  }
  const frame = document.getElementById('pg-frame');
  const doc = frame && frame.contentDocument;
  const root = doc && doc.getElementById('pg-edit-root');
  if (!root) { toast('Editör henüz hazır değil, sayfa yüklenince tekrar deneyin', 'warning'); return; }
  // Snapshot the caret position inside the iframe (survives modal focus change).
  let savedRange = null;
  const s = doc.getSelection();
  if (s && s.rangeCount) {
    const r = s.getRangeAt(0);
    if (root.contains(r.startContainer)) savedRange = r.cloneRange();
  }
  const inserter = (html) => _pgInsertMediaHtml(html, savedRange);
  if (kind === 'image') openMediaImageDialog(inserter);
  else if (kind === 'video') openMediaVideoDialog(inserter);
  else openMediaYouTubeDialog(inserter);
}

// Insert a media <figure> into the visual editor's iframe. Placed right after the
// caret's nearest block (so it lands in-flow within the same content column);
// appended to the end if there is no caret. Marks the new caption editable, locks
// the media element itself, and fires `input` so undo-history + dirty + autofit
// all pick it up — same path the rest of the visual editor uses.
function _pgInsertMediaHtml(html, savedRange) {
  const frame = document.getElementById('pg-frame');
  const doc = frame && frame.contentDocument;
  const root = doc && doc.getElementById('pg-edit-root');
  if (!root) return;
  const tmp = doc.createElement('div');
  tmp.innerHTML = html;
  const node = tmp.firstElementChild;
  if (!node) return;

  let inserted = false;
  const range = savedRange || ((doc.getSelection() && doc.getSelection().rangeCount) ? doc.getSelection().getRangeAt(0) : null);
  if (range && root.contains(range.startContainer)) {
    let ref = range.startContainer;
    if (ref.nodeType !== 1) ref = ref.parentNode;
    const BLOCKISH = /^(P|DIV|LI|SECTION|ARTICLE|ASIDE|H1|H2|H3|H4|H5|H6|FIGURE|UL|OL|BLOCKQUOTE|TABLE|TD|TH)$/;
    while (ref && ref !== root && !(ref.nodeType === 1 && BLOCKISH.test(ref.tagName))) ref = ref.parentNode;
    if (ref && ref !== root && ref.parentNode && root.contains(ref)) { ref.after(node); inserted = true; }
  }
  if (!inserted) root.appendChild(node);

  // New caption text becomes editable; the media element itself must not be
  // treated as deletable text.
  try { _pgMarkEditableLeaves(node); } catch (_) {}
  node.querySelectorAll('svg, img, iframe, video').forEach((n) => n.setAttribute('contenteditable', 'false'));
  // Drive history/dirty/refit through the same `input` event the editor listens for.
  try { root.dispatchEvent(new (doc.defaultView).Event('input', { bubbles: true })); } catch (_) { markDirty(); }
  // Bring the freshly inserted media into view.
  try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
}

// Build the iframe document for the visual editor. Same-origin srcdoc with a
// <base> pointing at the live site so the page's own css/style.css, images and
// links resolve exactly as on the public site. The injected <style> is
// EDITOR-ONLY (never saved): edit affordances, neutralised form fields, and —
// crucially — collapsible accordion panels forced OPEN so their text is visible
// and editable here, while the live site keeps its normal collapse behaviour.
function _visualPageSrcdoc(content) {
  const head = '<!doctype html><html lang="tr"><head><meta charset="utf-8">'
    + '<base href="/site/"><link rel="stylesheet" href="css/style.css">'
    + '<style>'
    + 'html,body{margin:0;background:#fff}'
    + '#pgw{padding:0}'
    + '[data-ce="1"]{transition:outline-color .12s,background-color .12s}'
    + '[data-ce="1"]:hover{outline:2px dashed rgba(13,148,136,.55);outline-offset:2px;cursor:text;border-radius:3px}'
    + '[data-ce="1"]:focus{outline:2px solid #0d9488;outline-offset:2px;background:rgba(13,148,136,.05)}'
    + '#pgw input,#pgw select,#pgw textarea,#pgw button{pointer-events:none}'
    // Reveal collapsible accordion panels (live keeps max-height:0 + JS toggle).
    + '#pgw .accordion-content{max-height:none !important;overflow:visible !important}'
    + '#pgw .accordion-chevron{transform:rotate(180deg)}'
    // Reveal ALL hero carousel banners stacked vertically. On the live site the
    // carousel JS shows one slide at a time; that JS doesn't run in the editor,
    // so without this only the first (is-active) banner would be visible/editable.
    // Editor-only — the saved HTML keeps the original carousel markup untouched.
    + '#pgw .hero-carousel-track{height:auto !important;display:flex !important;flex-direction:column;gap:18px}'
    + '#pgw .hero-slide{position:relative !important;inset:auto !important;opacity:1 !important;visibility:visible !important;pointer-events:auto !important}'
    + '#pgw .hero-carousel-controls,#pgw .hero-carousel-indicators{display:none !important}'
    + '</style></head><body><div id="pgw"><div id="pg-edit-root">';
  return head + content + '</div></div></body></html>';
}

// After the iframe loads, mark every maximal inline-only (text-bearing) element
// editable, lock structure, and neutralise navigation/form interaction.
function _wireVisualPageEditor(frame) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const root = doc.getElementById('pg-edit-root');
  if (!root) return;
  _pgMarkEditableLeaves(root);
  // Icons/images inside an editable region must not be deletable as "text".
  root.querySelectorAll('svg, img').forEach((n) => n.setAttribute('contenteditable', 'false'));
  // In the editor, links/buttons must not navigate or submit.
  doc.addEventListener('click', (e) => { if (e.target.closest('a, button')) e.preventDefault(); }, true);
  // Paste as PLAIN TEXT only. The visual editor edits text inside a LOCKED
  // structure, so pasting rich HTML (e.g. from ChatGPT, which carries
  // <li>/<ul> + data-section-id/data-start artifacts) would inject block
  // elements into inline text leaves and shred the layout. Inserting the
  // clipboard's plain text keeps the design intact; formatting is added via
  // the floating toolbar instead.
  doc.addEventListener('paste', (e) => {
    e.preventDefault();
    const cd = e.clipboardData || (doc.defaultView && doc.defaultView.clipboardData);
    const text = cd ? cd.getData('text/plain') : '';
    if (text) doc.execCommand('insertText', false, text);
  });
  // Enter inserts a soft line break instead of spawning new block elements
  // (keeps the locked structure intact); lists keep their native behaviour.
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !(e.target.closest && e.target.closest('li'))) {
      e.preventDefault();
      doc.execCommand('insertLineBreak');
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const k = (e.key || '').toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); _pgUndo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); _pgRedo(); }
    }
  });
  const fit = () => { try { frame.style.height = (doc.body.scrollHeight + 24) + 'px'; } catch (_) {} };
  doc.addEventListener('input', () => { markDirty(); fit(); });
  fit();
  setTimeout(fit, 400);
  // Floating, design-system-aware formatting toolbar (appears on text selection).
  _installFormatToolbar(doc, root, fit);
  // Snapshot-based undo/redo. The native contenteditable undo only covers the
  // browser's own edits; the format toolbar mutates the DOM directly
  // (surroundContents), which native undo misses — so we keep our own history
  // fed by a MutationObserver, and drive both the Ctrl+Z keys and the header
  // Geri Al / İleri Al buttons from it.
  _pgHistInit(doc, root, fit);
  // Block-level editing: select a section/card → move, duplicate, delete,
  // change background, or rewrite its HTML. (History observer above captures
  // every structural change, so all of it is undoable.)
  _installBlockEditor(doc, root, fit);
  // Banner controls shown directly on each homepage hero slide.
  _initHeroBannerPanel(frame);
}

// ═══════════════════════════════════════════════════════════════════════════
//  HERO CAROUSEL (banner) MANAGEMENT — visual page editor
//  Pages with #home-hero-carousel (the homepage) get an editor-only toolbar
//  directly on every visible banner. The controls live outside #pg-edit-root,
//  so they are never saved into the public page. All actual edits still mutate
//  the banner DOM inside #pg-edit-root and are persisted by the normal save.
// ═══════════════════════════════════════════════════════════════════════════
function _heroFrame() { return document.getElementById('pg-frame'); }
function _heroDoc() { const f = _heroFrame(); return f && f.contentDocument; }
function _heroSlides(doc) {
  const track = doc && doc.querySelector('#home-hero-carousel .hero-carousel-track');
  return track ? Array.from(track.querySelectorAll(':scope > .hero-slide')) : [];
}

function _initHeroBannerPanel(frame) {
  const doc = frame && frame.contentDocument;
  if (!doc || !doc.getElementById('home-hero-carousel')) return;
  _renderHeroBannerPanel();
  const win = doc.defaultView;
  if (win && !win._bmjHeroToolsResizeBound) {
    win._bmjHeroToolsResizeBound = true;
    let resizeTimer;
    win.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(_renderHeroBannerPanel, 40);
    });
  }
}

function _renderHeroBannerPanel() {
  const doc = _heroDoc();
  if (!doc) return;
  doc.querySelectorAll('[data-bmj-hero-editor-ui]').forEach((node) => node.remove());
  const slides = _heroSlides(doc);

  if (!slides.length) return;
  if (!doc.getElementById('bmj-hero-tools-style')) {
    const style = doc.createElement('style');
    style.id = 'bmj-hero-tools-style';
    style.textContent = [
      '#pgw .hero-carousel-track{gap:0 !important}',
      '#pgw .hero-slide[data-bmj-hero-collapsed="1"]{display:none !important}',
      '.bmj-hero-manager{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px;padding:12px 14px;background:linear-gradient(135deg,#78350f,#92400e);border:1px solid #652b0b;border-radius:10px;box-shadow:0 5px 16px rgba(69,26,3,.24);font:600 12px Inter,system-ui,sans-serif;line-height:1;user-select:none;color:#fff}',
      '.bmj-hero-manager-title{display:flex;align-items:baseline;gap:7px}',
      '.bmj-hero-manager-count{color:#fde68a;font-size:11px;font-weight:500}',
      '.bmj-hero-manager button{appearance:none;border:1px solid #fcd34d;border-radius:7px;background:#fbbf24;color:#451a03;padding:7px 11px;font:700 11px Inter,system-ui,sans-serif;line-height:1;cursor:pointer;white-space:nowrap;pointer-events:auto !important}',
      '.bmj-hero-manager button:hover{background:#fcd34d;border-color:#fde68a}',
      '.bmj-hero-editor-panel{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin:18px 0 8px;padding:9px 10px;background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #d97706;border-radius:10px;box-shadow:0 4px 14px rgba(146,64,14,.2);font:600 11px Inter,system-ui,sans-serif;line-height:1;user-select:none}',
      '.bmj-hero-editor-panel:first-child{margin-top:0}',
      '.bmj-hero-editor-panel.is-dragging{opacity:.45}',
      '.bmj-hero-editor-panel.is-drop-target{border-color:#0d9488;box-shadow:0 0 0 3px rgba(13,148,136,.16)}',
      '.bmj-hero-editor-grip{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;color:#92400e;border-radius:6px;cursor:grab;font-size:18px;line-height:1;pointer-events:auto !important}',
      '.bmj-hero-editor-grip:hover{background:rgba(255,255,255,.58);color:#78350f}',
      '.bmj-hero-editor-grip:active{cursor:grabbing}',
      '.bmj-hero-tools-label{color:#0f172a;padding:0 4px;white-space:nowrap}',
      '.bmj-hero-tools-state{color:#92400e;font-weight:500;margin-right:auto;white-space:nowrap}',
      '.bmj-hero-tools-sep{width:1px;height:20px;background:#d6a93a;margin:0 2px}',
      '.bmj-hero-editor-panel button{appearance:none;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#334155;padding:6px 8px;font:600 11px Inter,system-ui,sans-serif;line-height:1;cursor:pointer;white-space:nowrap;pointer-events:auto !important}',
      '.bmj-hero-editor-panel button:hover{border-color:#94a3b8;background:#f1f5f9;color:#0f172a}',
      '.bmj-hero-editor-panel button:disabled{opacity:.35;cursor:not-allowed}',
      '.bmj-hero-editor-panel button.is-primary{border-color:#0d9488;background:#0d9488;color:#fff}',
      '.bmj-hero-editor-panel button.is-primary:hover{background:#0f766e}',
      '.bmj-hero-editor-panel button.is-danger{border-color:#fecaca;color:#b91c1c}',
      '.bmj-hero-editor-panel button.is-danger:hover{border-color:#b91c1c;background:#b91c1c;color:#fff}',
    ].join('');
    doc.head.appendChild(style);
  }

  const track = doc.querySelector('#home-hero-carousel .hero-carousel-track');
  const manager = doc.createElement('div');
  manager.className = 'bmj-hero-manager';
  manager.setAttribute('data-bmj-hero-editor-ui', '1');
  manager.innerHTML =
    `<span class="bmj-hero-manager-title">Banner Yönetimi <span class="bmj-hero-manager-count">${slides.length} banner</span></span>`
    + '<button type="button" data-act="add">＋ Yeni Banner</button>';
  track.insertBefore(manager, slides[0]);
  manager.querySelector('button[data-act="add"]').addEventListener('click', _heroBannerAdd);

  slides.forEach((slide, i) => {
    const image = slide.querySelector('.hero-cover-figure img') || slide.querySelector('img');
    const hasImg = !!image;
    const imageWidth = hasImg ? (parseInt(image.style.width, 10) || 290) : null;
    const imageHeight = hasImg && image.style.height && image.style.height !== 'auto'
      ? parseInt(image.style.height, 10) || null : null;
    const imageSizeLabel = hasImg ? `${imageWidth}×${imageHeight || 'auto'}` : '';
    const collapsed = slide.getAttribute('data-bmj-hero-collapsed') === '1';
    const panel = doc.createElement('div');
    panel.className = 'bmj-hero-editor-panel';
    panel.setAttribute('data-bmj-hero-editor-ui', '1');
    panel.innerHTML =
      '<span class="bmj-hero-editor-grip" draggable="true" title="Sürükleyerek sırala" aria-label="Bannerı sürükle">⋮⋮</span>'
      + `<span class="bmj-hero-tools-label">Banner ${i + 1}</span>`
      + `<span class="bmj-hero-tools-state">${collapsed ? 'Kapalı' : 'Açık'}</span>`
      + `<button type="button" data-act="collapse">${collapsed ? 'Genişlet' : 'Daralt'}</button>`
      + `<span class="bmj-hero-tools-sep"></span>`
      + `<button type="button" data-act="image">${hasImg ? 'Resmi değiştir' : '＋ Resim ekle'}</button>`
      + (hasImg ? `<button type="button" data-act="size" title="${imageSizeLabel} px">Boyut: ${imageSizeLabel}</button>` : '')
      + (hasImg ? '<button type="button" class="is-danger" data-act="remove-image">Resmi kaldır</button>' : '')
      + '<span class="bmj-hero-tools-sep"></span>'
      + '<button type="button" class="is-danger" data-act="delete">Banner’ı sil</button>';
    track.insertBefore(panel, slide);
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-act]');
      if (!button || button.disabled) return;
      const action = button.dataset.act;
      if (action === 'collapse') {
        if (collapsed) slide.removeAttribute('data-bmj-hero-collapsed');
        else slide.setAttribute('data-bmj-hero-collapsed', '1');
        _renderHeroBannerPanel();
        _heroFitFrame();
      }
      else if (action === 'image') _heroBannerImage(i);
      else if (action === 'size') _heroBannerImageSettings(i);
      else if (action === 'remove-image') _heroBannerRemoveImage(i);
      else if (action === 'delete') _heroBannerDelete(i);
    });
    const grip = panel.querySelector('.bmj-hero-editor-grip');
    grip.addEventListener('dragstart', (event) => {
      _heroDraggedSlide = slide;
      panel.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(i));
      }
    });
    grip.addEventListener('dragend', () => {
      _heroDraggedSlide = null;
      doc.querySelectorAll('.bmj-hero-editor-panel').forEach((item) => item.classList.remove('is-dragging', 'is-drop-target'));
    });
    panel.addEventListener('dragover', (event) => {
      if (!_heroDraggedSlide || _heroDraggedSlide === slide) return;
      event.preventDefault();
      doc.querySelectorAll('.bmj-hero-editor-panel').forEach((item) => item.classList.remove('is-drop-target'));
      panel.classList.add('is-drop-target');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    panel.addEventListener('dragleave', () => panel.classList.remove('is-drop-target'));
    panel.addEventListener('drop', (event) => {
      event.preventDefault();
      const source = _heroDraggedSlide;
      if (!source || source === slide) return;
      const targetRect = panel.getBoundingClientRect();
      const placeAfter = event.clientY > targetRect.top + targetRect.height / 2;
      doc.querySelectorAll('[data-bmj-hero-editor-ui]').forEach((node) => node.remove());
      if (placeAfter) slide.after(source);
      else slide.before(source);
      _heroDraggedSlide = null;
      _syncHeroCarousel(doc);
      _afterHeroChange();
      toast('Banner sırası güncellendi. Kalıcılaştırmak için Kaydet’e basın.');
    });
    if (image && !image.complete) image.addEventListener('load', _renderHeroBannerPanel, { once: true });
  });
  _heroFitFrame();
}

let _heroDraggedSlide = null;

function _heroFitFrame() {
  const frame = _heroFrame();
  const doc = frame && frame.contentDocument;
  if (!frame || !doc) return;
  try { frame.style.height = (doc.body.scrollHeight + 24) + 'px'; } catch (_) {}
}

// Re-mark editable leaves on new content, fire input (history/dirty/refit), and
// refresh the panel. Called after every banner/image mutation.
function _afterHeroChange() {
  const frame = _heroFrame();
  const doc = frame && frame.contentDocument;
  const root = doc && doc.getElementById('pg-edit-root');
  if (root) {
    try { _pgMarkEditableLeaves(root); } catch (_) {}
    root.querySelectorAll('svg, img').forEach((n) => n.setAttribute('contenteditable', 'false'));
    try { root.dispatchEvent(new (doc.defaultView).Event('input', { bubbles: true })); } catch (_) { markDirty(); }
  }
  _renderHeroBannerPanel();
}

// Keep slide↔indicator count, slide aria-labels, and active state consistent
// after a banner is added or removed. Existing slide IDs are preserved (the live
// CSS targets #hero-slide-1 for the main banner); only missing IDs are assigned.
function _syncHeroCarousel(doc) {
  const carousel = doc.getElementById('home-hero-carousel');
  if (!carousel) return;
  const slides = _heroSlides(doc);
  const total = slides.length;
  slides.forEach((s, i) => {
    s.setAttribute('aria-label', (i + 1) + ' of ' + total);
    if (i === 0) { s.classList.add('is-active'); s.removeAttribute('aria-hidden'); }
    else { s.classList.remove('is-active'); s.setAttribute('aria-hidden', 'true'); }
  });
  const used = new Set(slides.map((s) => s.id).filter(Boolean));
  let n = 1;
  slides.forEach((s) => { if (!s.id) { while (used.has('hero-slide-' + n)) n++; s.id = 'hero-slide-' + n; used.add(s.id); } });
  const ind = carousel.querySelector('.hero-carousel-indicators');
  if (ind) {
    let html = '';
    for (let i = 0; i < total; i++) {
      html += '<button type="button" class="hero-carousel-indicator' + (i === 0 ? ' is-active' : '')
        + '" data-hero-indicator="' + i + '" aria-label="Go to slide ' + (i + 1) + '"'
        + (i === 0 ? ' aria-current="true"' : '') + '></button>';
    }
    ind.innerHTML = html;
  }
}

async function _heroBannerDelete(i) {
  const doc = _heroDoc();
  if (!doc) return;
  const slides = _heroSlides(doc);
  if (slides.length <= 1) { toast('En az bir banner kalmalı — son banner silinemez.', 'warning'); return; }
  if (!slides[i]) return;
  const ok = await confirmAction(`Banner ${i + 1} silinsin mi? (Kaydet'e basana kadar geri alabilirsiniz.)`);
  if (!ok) return;
  slides[i].remove();
  _syncHeroCarousel(doc);
  _afterHeroChange();
  toast("Banner silindi. Kalıcılaştırmak için Kaydet'e basın.");
}

function _heroBannerAdd() {
  const doc = _heroDoc();
  if (!doc) return;
  const track = doc.querySelector('#home-hero-carousel .hero-carousel-track');
  if (!track) return;
  const tmp = doc.createElement('div');
  tmp.innerHTML = '<article class="hero-slide" role="group" aria-roledescription="slide">'
    + '<div class="hero-slide-shell"><div class="hero-slide-inner"><div class="hero-slide-copy">'
    + '<p class="hero-meta-chip">Yeni</p>'
    + '<h2 class="hero-slide-title">Yeni Banner Başlığı</h2>'
    + '<p class="hero-slide-text">Banner açıklama metnini buraya yazın.</p>'
    + '<div class="hero-actions"><a href="#" class="hero-btn hero-btn-secondary">Buton</a></div>'
    + '</div></div></div></article>';
  track.appendChild(tmp.firstElementChild);
  _syncHeroCarousel(doc);
  _afterHeroChange();
  toast("Yeni banner eklendi (en sona). Metinleri önizlemede düzenleyip Kaydet'e basın.");
}

// Reorder a banner one step up (dir=-1) or down (dir=+1) within the carousel.
function _heroBannerMove(i, dir) {
  const doc = _heroDoc();
  if (!doc) return;
  const slides = _heroSlides(doc);
  const j = i + dir;
  if (j < 0 || j >= slides.length || !slides[i] || !slides[j]) return;
  if (dir < 0) slides[j].before(slides[i]);
  else slides[j].after(slides[i]);
  _syncHeroCarousel(doc);
  _afterHeroChange();
  toast("Banner sırası güncellendi. Kalıcılaştırmak için Kaydet'e basın.");
}

function _heroBannerImage(i) {
  const doc = _heroDoc();
  if (!doc) return;
  const slide = _heroSlides(doc)[i];
  if (!slide) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    let url;
    try { const r = await API.uploadFile('/media/upload/image', file, 'image'); url = r.url; }
    catch (e) { toast('Resim yüklenemedi: ' + e.message, 'error'); return; }
    _heroSetSlideImage(slide, url, file.name);
    _afterHeroChange();
    toast("Resim eklendi/değiştirildi. Kaydet'e basın.");
  };
  input.click();
}

function _heroSetSlideImage(slide, url, alt) {
  const existing = slide.querySelector('.hero-cover-figure img') || slide.querySelector('img');
  if (existing) { existing.setAttribute('src', url); existing.setAttribute('alt', (alt || '').replace(/\.[^.]+$/, '')); return; }
  const doc = slide.ownerDocument;
  const inner = slide.querySelector('.hero-slide-inner');
  if (inner && !/hero-slide-inner-(split|featured)/.test(inner.className)) {
    inner.classList.add('hero-slide-inner-split');
  }
  const fig = doc.createElement('figure');
  fig.className = 'hero-cover-figure';
  fig.setAttribute('aria-hidden', 'true');
  const img = doc.createElement('img');
  img.setAttribute('src', url);
  img.setAttribute('alt', (alt || '').replace(/\.[^.]+$/, ''));
  img.className = 'hero-cover-image';
  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  fig.appendChild(img);
  (inner || slide.querySelector('.hero-slide-shell') || slide).appendChild(fig);
}

function _heroBannerImageSettings(i) {
  const doc = _heroDoc();
  const slide = doc && _heroSlides(doc)[i];
  const img = slide && (slide.querySelector('.hero-cover-figure img') || slide.querySelector('img'));
  if (!img) { toast('Bu bannerda ayarlanacak bir resim yok', 'warning'); return; }

  const currentWidth = parseInt(img.style.width, 10) || 290;
  const currentHeight = img.style.height && img.style.height !== 'auto'
    ? (parseInt(img.style.height, 10) || '') : '';
  const currentFit = img.style.objectFit || 'contain';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width:520px">
      <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
        <div>
          <h3 class="text-base font-semibold" style="color:var(--text-strong)">Banner ${i + 1} — Resim Boyutu</h3>
          <p class="text-xs mt-1" style="color:var(--text-faint)">Değerler masaüstü ve tablet görünümünde uygulanır.</p>
        </div>
        <button type="button" class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">&times;</button>
      </div>
      <div class="px-6 py-5 space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label" for="hero-image-width">Genişlik (px)</label>
            <input id="hero-image-width" type="number" min="100" max="600" step="10" class="input" value="${currentWidth}">
            <p class="text-xs mt-1" style="color:var(--text-faint)">100–600 px</p>
          </div>
          <div>
            <label class="label" for="hero-image-height">Yükseklik (px)</label>
            <input id="hero-image-height" type="number" min="80" max="600" step="10" class="input" value="${currentHeight}" placeholder="Otomatik">
            <p class="text-xs mt-1" style="color:var(--text-faint)">Boş bırakırsanız oran korunur.</p>
          </div>
        </div>
        <div>
          <label class="label" for="hero-image-fit">Resmi yerleştirme</label>
          <select id="hero-image-fit" class="input">
            <option value="contain" ${currentFit === 'contain' ? 'selected' : ''}>Tamamını göster</option>
            <option value="cover" ${currentFit === 'cover' ? 'selected' : ''}>Alanı doldur (gerekirse kırp)</option>
          </select>
        </div>
        <div>
          <span class="label">Hızlı boyut</span>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-secondary btn-sm" data-width="180">Küçük — 180</button>
            <button type="button" class="btn btn-secondary btn-sm" data-width="240">Orta — 240</button>
            <button type="button" class="btn btn-secondary btn-sm" data-width="290">Standart — 290</button>
            <button type="button" class="btn btn-secondary btn-sm" data-width="380">Büyük — 380</button>
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle)">
        <button type="button" class="btn btn-secondary" data-action="cancel">İptal</button>
        <button type="button" class="btn btn-primary" data-action="save">Uygula</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const widthInput = overlay.querySelector('#hero-image-width');
  const heightInput = overlay.querySelector('#hero-image-height');
  overlay.querySelectorAll('[data-width]').forEach((button) => {
    button.onclick = () => { widthInput.value = button.dataset.width; };
  });
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').onclick = close;
  overlay.querySelector('[data-action="cancel"]').onclick = close;
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  overlay.querySelector('[data-action="save"]').onclick = () => {
    const width = Math.max(100, Math.min(600, Number(widthInput.value) || 290));
    const rawHeight = String(heightInput.value || '').trim();
    const height = rawHeight ? Math.max(80, Math.min(600, Number(rawHeight) || 0)) : 0;
    const fit = overlay.querySelector('#hero-image-fit').value === 'cover' ? 'cover' : 'contain';
    img.style.width = width + 'px';
    img.style.maxWidth = '100%';
    img.style.height = height ? height + 'px' : 'auto';
    img.style.objectFit = height ? fit : '';
    close();
    _afterHeroChange();
    toast(`Banner ${i + 1} resim boyutu güncellendi. Kalıcılaştırmak için Kaydet'e basın.`);
  };
  setTimeout(() => widthInput.focus(), 30);
}

function _heroBannerRemoveImage(i) {
  const doc = _heroDoc();
  if (!doc) return;
  const slide = _heroSlides(doc)[i];
  if (!slide) return;
  const fig = slide.querySelector('.hero-cover-figure');
  if (fig) fig.remove();
  else { const img = slide.querySelector('img'); if (img) img.remove(); }
  _afterHeroChange();
  toast("Resim kaldırıldı. Kaydet'e basın.");
}

// Inline (text-level) tags: an element whose element-children are ALL inline is
// a "text leaf" (editable in place); anything else is a structural container.
const _PG_INLINE = new Set(['A', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUP', 'SUB', 'SMALL', 'CODE', 'MARK', 'ABBR', 'TIME', 'BR', 'SVG', 'IMG', 'WBR', 'LABEL', 'Q', 'CITE', 'BDI', 'BDO', 'DFN', 'KBD', 'SAMP', 'VAR']);
function _pgAllChildrenInline(node) {
  for (const c of node.children) { if (!_PG_INLINE.has(c.tagName)) return false; }
  return true;
}
// Mark each maximal inline-only, text-bearing element editable. Idempotent;
// safe to re-run on a freshly inserted/rewritten block.
function _pgMarkEditableLeaves(rootNode) {
  (function walk(node) {
    if (node.tagName === 'SVG') return;
    if (_pgAllChildrenInline(node)) {
      if ((node.textContent || '').trim()) {
        node.setAttribute('data-ce', '1');
        node.setAttribute('contenteditable', 'true');
      }
      return;
    }
    [...node.children].forEach(walk);
  })(rootNode);
  rootNode.querySelectorAll && rootNode.querySelectorAll('svg, img').forEach((n) => n.setAttribute('contenteditable', 'false'));
}

// ── Visual page editor undo/redo (snapshot history of #pg-edit-root) ──────────
let _pgHist = null;

function _pgHistoryHtml(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('[data-bmj-hero-editor-ui]').forEach((node) => node.remove());
  clone.querySelectorAll('[data-bmj-hero-collapsed]').forEach((node) => node.removeAttribute('data-bmj-hero-collapsed'));
  return clone.innerHTML;
}

function _pgHistInit(doc, root, fit) {
  if (_pgHist && _pgHist.observer) { try { _pgHist.observer.disconnect(); } catch (_) {} }
  _pgHist = { doc, root, fit, undo: [], redo: [], last: _pgHistoryHtml(root), suppress: false, timer: null, observer: null };
  const obs = new doc.defaultView.MutationObserver((records) => {
    const editorOnly = records.every((record) => {
      if (record.type === 'attributes' && record.attributeName === 'data-bmj-hero-collapsed') return true;
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target && target.closest && target.closest('[data-bmj-hero-editor-ui]')) return true;
      if (record.type === 'childList') {
        const changed = [...record.addedNodes, ...record.removedNodes];
        return changed.length > 0 && changed.every((node) =>
          node.nodeType === 1 && node.matches && node.matches('[data-bmj-hero-editor-ui]'));
      }
      return false;
    });
    if (!editorOnly) _pgHistRecord();
  });
  obs.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
  _pgHist.observer = obs;
  _pgUpdateUndoButtons();
}

function _pgHistRecord() {
  const h = _pgHist;
  if (!h || h.suppress) return;
  clearTimeout(h.timer);
  h.timer = setTimeout(() => {
    h.timer = null;
    if (!h.root) return;
    const cur = _pgHistoryHtml(h.root);
    if (cur === h.last) return;
    h.undo.push(h.last);
    if (h.undo.length > 100) h.undo.shift();
    h.redo = [];
    h.last = cur;
    _pgUpdateUndoButtons();
  }, 350);
}

function _pgHistFlush() {
  const h = _pgHist;
  if (!h) return;
  if (h.timer) { clearTimeout(h.timer); h.timer = null; }
  const cur = _pgHistoryHtml(h.root);
  if (cur !== h.last) { h.undo.push(h.last); if (h.undo.length > 100) h.undo.shift(); h.redo = []; h.last = cur; }
}

function _pgHistRestore(html) {
  const h = _pgHist;
  if (!h || !h.root) return;
  h.suppress = true;
  h.root.innerHTML = html;
  h.last = html;
  setTimeout(() => { h.suppress = false; }, 0); // ignore our own restore mutations
  try { markDirty(); } catch (_) {}
  if (h.fit) h.fit();
  _pgUpdateUndoButtons();
  // The floating toolbars/overlays reference now-stale nodes; hide them.
  try { ['bmj-fmt-bar', 'bmj-link-pop'].forEach((id) => { const el = h.doc.getElementById(id); if (el) el.style.display = 'none'; }); } catch (_) {}
  try {
    ['bmj-blk-hover', 'bmj-blk-sel', 'bmj-blk-handle', 'bmj-blk-bar', 'bmj-blk-bgmenu'].forEach((id) => {
      const el = h.doc.getElementById(id); if (el) el.style.display = 'none';
    });
    if (_pgBlock) _pgBlock.selected = null;
  } catch (_) {}
  try { _renderHeroBannerPanel(); } catch (_) {}
}

function _pgUndo() {
  const h = _pgHist;
  if (!h) return;
  _pgHistFlush();
  if (!h.undo.length) return;
  const prev = h.undo.pop();
  h.redo.push(h.last);
  _pgHistRestore(prev);
}

function _pgRedo() {
  const h = _pgHist;
  if (!h) return;
  _pgHistFlush();
  if (!h.redo.length) return;
  const next = h.redo.pop();
  h.undo.push(h.last);
  _pgHistRestore(next);
}

function _pgUpdateUndoButtons() {
  const h = _pgHist;
  const u = document.getElementById('pg-undo');
  const r = document.getElementById('pg-redo');
  if (u) u.disabled = !h || h.undo.length === 0;
  if (r) r.disabled = !h || h.redo.length === 0;
}

// ── Block-level structural editing ───────────────────────────────────────────
// Hover highlights the block under the cursor; clicking its handle SELECTS it
// and shows a block toolbar (⤴ üst blok, ↑↓ taşı, çoğalt, arka plan, HTML, sil).
// Overlays live in the iframe <body> (outside #pg-edit-root) so they're never
// saved; all operations mutate #pg-edit-root and are captured by the undo
// history. Background presets are curated design-system looks (always on-brand).
let _pgBlock = null;
// [label, background value, lightText] — lightText=true forces white text so a
// dark fill stays readable (curated pairing).
const _PG_BG_PRESETS = [
  ['Beyaz', ''],
  ['Açık gri', '#f9fafb'],
  ['Marka açık (teal)', '#f0fdfa'],
  ['Teal gradyan (koyu)', 'linear-gradient(135deg,#134e4a,#0f766e)', true],
  ['Kırmızı (CTA)', 'var(--color-red-700, #b91c1c)', true],
];

function _installBlockEditor(doc, root, fit) {
  if (doc.getElementById('bmj-blk-bar')) return;
  const win = doc.defaultView;

  const style = doc.createElement('style');
  style.textContent = [
    '#bmj-blk-hover,#bmj-blk-sel{position:absolute;z-index:99990;pointer-events:none;border-radius:6px}',
    '#bmj-blk-hover{border:2px dashed rgba(13,148,136,.55)}',
    '#bmj-blk-sel{border:2px solid #0d9488;box-shadow:0 0 0 4px rgba(13,148,136,.12)}',
    '#bmj-blk-handle{position:absolute;z-index:99991;display:none;background:#0d9488;color:#fff;border:0;border-radius:6px;padding:3px 7px;font:600 11px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(2,6,23,.3)}',
    '#bmj-blk-bar{position:absolute;z-index:99996;display:none;background:#0f172a;border-radius:9px;padding:5px;box-shadow:0 10px 30px rgba(2,6,23,.4);white-space:nowrap}',
    '#bmj-blk-bar button{background:transparent;border:0;color:#e2e8f0;padding:6px 9px;border-radius:6px;cursor:pointer;font:600 12.5px Inter,system-ui,sans-serif;line-height:1;vertical-align:middle}',
    '#bmj-blk-bar button:hover{background:rgba(255,255,255,.15);color:#fff}',
    '#bmj-blk-bar button.danger:hover{background:#dc2626;color:#fff}',
    '#bmj-blk-bar .sep{display:inline-block;width:1px;height:18px;background:rgba(255,255,255,.22);margin:0 4px;vertical-align:middle}',
    '#bmj-blk-bgmenu{position:absolute;z-index:99997;display:none;background:#0f172a;border-radius:9px;padding:5px;box-shadow:0 10px 30px rgba(2,6,23,.4);min-width:170px}',
    '#bmj-blk-bgmenu button{display:block;width:100%;text-align:left;background:transparent;border:0;color:#e2e8f0;padding:8px 12px;border-radius:6px;cursor:pointer;font:500 13px Inter,system-ui,sans-serif}',
    '#bmj-blk-bgmenu button:hover{background:rgba(255,255,255,.15);color:#fff}',
    '#bmj-blk-bgmenu .sw{display:inline-block;width:13px;height:13px;border-radius:4px;margin-right:9px;vertical-align:-2px;border:1px solid rgba(255,255,255,.45)}',
  ].join('');
  doc.head.appendChild(style);

  const hover = doc.createElement('div'); hover.id = 'bmj-blk-hover'; hover.style.display = 'none';
  const selBox = doc.createElement('div'); selBox.id = 'bmj-blk-sel'; selBox.style.display = 'none';
  const handle = doc.createElement('button'); handle.id = 'bmj-blk-handle'; handle.type = 'button'; handle.innerHTML = '⠿ Blok seç';
  const bar = doc.createElement('div'); bar.id = 'bmj-blk-bar';
  bar.innerHTML =
    '<button data-act="parent" title="Üst bloğu seç">⤴ Üst</button>'
    + '<span class="sep"></span>'
    + '<button data-act="up" title="Yukarı taşı">↑</button>'
    + '<button data-act="down" title="Aşağı taşı">↓</button>'
    + '<button data-act="dup" title="Çoğalt">⧉ Çoğalt</button>'
    + '<button data-act="bg" title="Arka plan / tema">🎨 Arka plan</button>'
    + '<button data-act="html" title="Bu bloğu HTML olarak yeniden yaz">✎ HTML</button>'
    + '<span class="sep"></span>'
    + '<button data-act="del" class="danger" title="Bu bloğu sil">🗑 Sil</button>';
  const bgmenu = doc.createElement('div'); bgmenu.id = 'bmj-blk-bgmenu';
  bgmenu.innerHTML = _PG_BG_PRESETS.map(([label, val], i) =>
    `<button data-bg="${i}"><span class="sw" style="background:${val || '#ffffff'}"></span>${label}</button>`).join('');
  doc.body.appendChild(hover); doc.body.appendChild(selBox); doc.body.appendChild(handle);
  doc.body.appendChild(bar); doc.body.appendChild(bgmenu);

  _pgBlock = { doc, root, fit, hovered: null, selected: null, hover, selBox, handle, bar, bgmenu };

  const isLeaf = (el) => el.nodeType === 1 && el.tagName !== 'SVG' && _pgAllChildrenInline(el);
  // Pure inline-formatting wrappers are never a block-selection target (selecting
  // a <strong>/<span> inside running text for move/delete is just noise).
  const NONSELECT = new Set(['SVG', 'PATH', 'G', 'USE', 'SPAN', 'SUP', 'SUB', 'B', 'I', 'EM', 'STRONG', 'U', 'S', 'SMALL', 'MARK', 'ABBR', 'CODE', 'TIME', 'WBR', 'BDI', 'BDO', 'DFN', 'KBD', 'SAMP', 'VAR', 'Q', 'CITE', 'BR']);
  const NEVER_SELECT = new Set(['PATH', 'G', 'USE', 'BR', 'WBR']);
  const isDeepBlockZone = (el) => el.closest && (el.closest('#home-hero-carousel') || el.closest('[data-bmj-deep-blocks]'));
  const isBlock = (el) => {
    if (!el || el.nodeType !== 1 || el === root || !root.contains(el)) return false;
    if (isDeepBlockZone(el)) return !NEVER_SELECT.has(el.tagName);
    if (NONSELECT.has(el.tagName)) return false;
    // Everywhere else, keep the container-only rule so text leaves stay edit-only
    // and the other pages' editing experience is unchanged.
    return !isLeaf(el);
  };
  const nearestBlock = (node) => {
    let n = node;
    while (n && n !== root) { if (n.nodeType === 1 && isBlock(n)) return n; n = n.parentNode; }
    return null;
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect(); const de = doc.documentElement;
    return { left: r.left + de.scrollLeft, top: r.top + de.scrollTop, w: r.width, h: r.height };
  };
  const place = (box, el) => { const r = rectOf(el); box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.w + 'px'; box.style.height = r.h + 'px'; box.style.display = 'block'; };

  const hideHover = () => { hover.style.display = 'none'; handle.style.display = 'none'; _pgBlock.hovered = null; };
  const hideBgMenu = () => { bgmenu.style.display = 'none'; };
  const deselect = () => { selBox.style.display = 'none'; bar.style.display = 'none'; hideBgMenu(); _pgBlock.selected = null; };

  const showHandleFor = (el) => {
    place(hover, el); _pgBlock.hovered = el; handle._target = el; // freeze target for the click
    const r = rectOf(el);
    handle.style.display = 'block';
    handle.style.left = Math.max(2, r.left) + 'px';
    handle.style.top = Math.max(2, r.top - 24) + 'px';
  };

  const positionBar = () => {
    const el = _pgBlock.selected; if (!el) return;
    place(selBox, el);
    const r = rectOf(el);
    bar.style.display = 'block';
    const bw = bar.offsetWidth;
    let left = Math.max(4, Math.min(r.left, (doc.documentElement.clientWidth || 1200) - bw - 6));
    let top = r.top - bar.offsetHeight - 8;
    if (top < doc.documentElement.scrollTop + 2) top = r.top + 6;
    bar.style.left = left + 'px'; bar.style.top = top + 'px';
  };

  const select = (el) => {
    if (!el || !isBlock(el)) return;
    _pgBlock.selected = el; hideHover();
    positionBar();
  };

  // Hover tracking. Key rule: once a block is hovered, moving the cursor OUTWARD
  // over its ancestors (e.g. on the way to the handle) must NOT jump the
  // selection up a level — we keep the inner block. We only switch when the
  // cursor enters a genuinely different block (a child to drill into, or a
  // sibling). Climbing up to a parent is done deliberately with the ⤴ Üst button.
  doc.addEventListener('mousemove', (e) => {
    if (_pgBlock.selected) return; // while selected, keep the selection box stable
    if (e.target.closest('#bmj-blk-handle, #bmj-blk-bar, #bmj-blk-bgmenu, #bmj-fmt-bar, .bmj-menu, .bmj-hero-tools, .bmj-hero-editor-panel')) return;
    const cand = nearestBlock(e.target);
    if (!cand) return;                          // empty/gap area → keep current handle (no flicker)
    const cur = _pgBlock.hovered;
    if (cand === cur) return;
    if (cur && cand.contains(cur)) return;      // moving onto an ANCESTOR → keep the inner block
    showHandleFor(cand);
  });
  doc.addEventListener('mouseleave', () => { if (!_pgBlock.selected) hideHover(); });
  handle.addEventListener('mousedown', (e) => e.preventDefault());
  // Select the block the handle was shown for (frozen), not whatever is under the
  // cursor at click time — so a stray mousemove can't change the target.
  handle.addEventListener('click', (e) => { e.preventDefault(); const t = handle._target || _pgBlock.hovered; if (t && isBlock(t)) select(t); });
  // Click on real text / empty area deselects the block (so text editing resumes)
  doc.addEventListener('mousedown', (e) => {
    if (e.target && e.target.closest && e.target.closest('#bmj-blk-bar, #bmj-blk-bgmenu, #bmj-blk-handle, .bmj-hero-tools, .bmj-hero-editor-panel')) return;
    if (_pgBlock.selected) deselect();
  });
  doc.addEventListener('scroll', () => { if (_pgBlock.selected) positionBar(); else hideHover(); }, true);

  const touch = () => { try { root.dispatchEvent(new win.Event('input', { bubbles: true })); } catch (_) { markDirty(); if (fit) fit(); } };

  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bgmenu.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const el = _pgBlock.selected; if (!el) return;
    const act = btn.dataset.act;
    if (act === 'parent') {
      const p = nearestBlock(el.parentNode);
      if (p) { _pgBlock.selected = p; hideBgMenu(); positionBar(); }
      return;
    }
    if (act === 'up') {
      const prev = el.previousElementSibling;
      if (prev) { el.parentNode.insertBefore(el, prev); touch(); positionBar(); }
      return;
    }
    if (act === 'down') {
      const next = el.nextElementSibling;
      if (next) { el.parentNode.insertBefore(next, el); touch(); positionBar(); }
      return;
    }
    if (act === 'dup') {
      const clone = el.cloneNode(true);
      el.parentNode.insertBefore(clone, el.nextSibling);
      touch(); _pgBlock.selected = clone; positionBar();
      return;
    }
    if (act === 'del') {
      if (!win.confirm('Bu blok tamamen silinsin mi? (Geri Al ile geri getirebilirsiniz.)')) return;
      el.remove(); deselect(); touch();
      return;
    }
    if (act === 'bg') {
      const open = bgmenu.style.display === 'block';
      hideBgMenu();
      if (open) return;
      bgmenu.style.display = 'block';
      bgmenu.style.left = btn.getBoundingClientRect().left + doc.documentElement.scrollLeft + 'px';
      bgmenu.style.top = (bar.offsetTop + bar.offsetHeight + 4) + 'px';
      return;
    }
    if (act === 'html') {
      hideBgMenu();
      _pgEditBlockHtml(el);
      return;
    }
  });
  bgmenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    const el = _pgBlock.selected; if (!el) return;
    const [, val, light] = _PG_BG_PRESETS[Number(btn.dataset.bg)];
    if (!val) { el.style.removeProperty('background'); el.style.removeProperty('color'); }
    else {
      el.style.background = val;
      // Dark fills (teal gradient, red CTA) → white text so it stays readable.
      if (light) el.style.color = '#ffffff'; else el.style.removeProperty('color');
    }
    hideBgMenu(); touch(); positionBar();
  });

  _pgBlock.reposition = () => { if (_pgBlock.selected) positionBar(); };
}

// Edit one block's raw HTML (full rewrite). Parent-side overlay so it works even
// though the block lives in the iframe.
function _pgEditBlockHtml(blockEl) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(2,6,23,.55);display:flex;align-items:center;justify-content:center;padding:24px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:min(900px,96vw);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(2,6,23,.4)">
      <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb">
        <h3 style="font:600 16px Inter,system-ui;color:#0f172a;margin:0">Bloğu HTML olarak düzenle</h3>
        <p style="font:400 12.5px Inter,system-ui;color:#64748b;margin:6px 0 0">Bu bloğun tüm içeriğini istediğiniz gibi değiştirin. Tasarım sınıflarını koruyarak düzenlerseniz görünüm bozulmaz. Vazgeçerseniz <strong>Geri Al</strong> ile döndürebilirsiniz.</p>
      </div>
      <textarea id="bmj-blk-html" spellcheck="false" style="flex:1;min-height:340px;margin:0;padding:14px;border:0;border-bottom:1px solid #e5e7eb;font:13px ui-monospace,Menlo,Consolas,monospace;resize:none;outline:none;color:#0f172a"></textarea>
      <div style="padding:14px 20px;display:flex;gap:10px;justify-content:flex-end">
        <button id="bmj-blk-cancel" style="padding:9px 16px;border:1px solid #cbd5e1;background:#fff;border-radius:9px;font:600 13px Inter;cursor:pointer;color:#334155">Vazgeç</button>
        <button id="bmj-blk-apply" style="padding:9px 16px;border:0;background:#0d9488;color:#fff;border-radius:9px;font:600 13px Inter;cursor:pointer">Uygula</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector('#bmj-blk-html');
  ta.value = _pgPrettyHtml(blockEl.outerHTML);
  ta.focus();
  const close = () => overlay.remove();
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#bmj-blk-cancel').onclick = close;
  overlay.querySelector('#bmj-blk-apply').onclick = () => {
    const html = ta.value.trim();
    if (!html) { close(); return; }
    try {
      const doc = blockEl.ownerDocument;
      const tmp = doc.createElement('div');
      tmp.innerHTML = html;
      const replacement = tmp.firstElementChild;
      if (!replacement) { close(); return; }
      blockEl.replaceWith(replacement);
      _pgMarkEditableLeaves(replacement); // make new text editable
      if (_pgBlock) { _pgBlock.selected = null; _pgBlock.bar.style.display = 'none'; _pgBlock.selBox.style.display = 'none'; }
      try { (blockEl.ownerDocument || document).getElementById('pg-edit-root').dispatchEvent(new (doc.defaultView).Event('input', { bubbles: true })); } catch (_) { markDirty(); }
    } catch (err) { toast('HTML uygulanamadı: ' + err.message, 'error'); }
    close();
  };
}

// Light pretty-printer so block HTML is readable in the rewrite box (cosmetic).
function _pgPrettyHtml(html) {
  return String(html).replace(/></g, '>\n<');
}

// A curated, design-safe formatting toolbar that floats above the current text
// selection inside the visual editor. Bold/Italic/Underline, a fixed size scale,
// the brand colour palette and Inter↔Serif — ALL applied as inline styles that
// reference the page's OWN CSS variables (--text-*, --color-*, --font-*). So the
// result always renders and always matches the live design; a non-technical
// editor can't pick an off-brand size or colour. The bar lives outside
// #pg-edit-root, so it is never part of the saved HTML.
function _installFormatToolbar(doc, root, fit) {
  if (doc.getElementById('bmj-fmt-bar')) return;
  const SIZES = [['Küçük', 'var(--text-sm)'], ['Normal', ''], ['Büyük', 'var(--text-xl)'], ['Çok Büyük', 'var(--text-2xl)']];
  const COLORS = [['Normal', ''], ['Teal (vurgu)', 'var(--color-teal-700)'], ['Gri (ikincil)', 'var(--color-gray-500)'], ['Kırmızı (CTA)', 'var(--color-red-700)']];
  const FONTS = [['Normal (Inter)', ''], ['Serif', 'var(--font-serif)']];

  const style = doc.createElement('style');
  style.textContent = [
    '#bmj-fmt-bar{position:absolute;z-index:99999;display:none;background:#0f172a;border-radius:9px;padding:4px;box-shadow:0 10px 30px rgba(2,6,23,.35);white-space:nowrap;user-select:none}',
    '#bmj-fmt-bar button{background:transparent;border:0;color:#e2e8f0;padding:5px 9px;border-radius:6px;cursor:pointer;font:600 13px Inter,system-ui,sans-serif;line-height:1;vertical-align:middle}',
    '#bmj-fmt-bar button:hover{background:rgba(255,255,255,.15);color:#fff}',
    '#bmj-fmt-bar .sep{display:inline-block;width:1px;height:18px;background:rgba(255,255,255,.22);margin:0 5px;vertical-align:middle}',
    '#bmj-fmt-bar .b{font-weight:800}#bmj-fmt-bar .i{font-style:italic}#bmj-fmt-bar .u{text-decoration:underline}',
    '.bmj-menu{position:absolute;z-index:100000;display:none;background:#0f172a;border-radius:9px;padding:5px;box-shadow:0 10px 30px rgba(2,6,23,.35);min-width:150px}',
    '.bmj-menu button{display:block;width:100%;text-align:left;background:transparent;border:0;color:#e2e8f0;padding:8px 12px;border-radius:6px;cursor:pointer;font:500 13px Inter,system-ui,sans-serif}',
    '.bmj-menu button:hover{background:rgba(255,255,255,.15);color:#fff}',
    '.bmj-sw{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:9px;vertical-align:-1px;border:1px solid rgba(255,255,255,.45)}',
    '#bmj-link-pop{position:absolute;z-index:100001;display:none;background:#0f172a;border-radius:10px;padding:10px;box-shadow:0 12px 34px rgba(2,6,23,.4);width:320px;font:13px Inter,system-ui,sans-serif}',
    '#bmj-link-pop label{display:block;color:#94a3b8;font-size:11px;font-weight:600;margin:0 0 3px}',
    '#bmj-link-pop input{width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;color:#fff;border-radius:7px;padding:7px 9px;font:13px Inter,system-ui,sans-serif;margin-bottom:8px;outline:none}',
    '#bmj-link-pop input:focus{border-color:#0d9488}',
    '#bmj-link-pop .row{display:flex;gap:6px;align-items:center}',
    '#bmj-link-pop .row button{flex:0 0 auto;border:0;border-radius:7px;padding:7px 11px;font:600 12.5px Inter,system-ui,sans-serif;cursor:pointer}',
    '#bmj-link-pop .apply{background:#0d9488;color:#fff}#bmj-link-pop .apply:hover{background:#0f766e}',
    '#bmj-link-pop .ghost{background:transparent;color:#cbd5e1}#bmj-link-pop .ghost:hover{background:rgba(255,255,255,.12);color:#fff}',
    '#bmj-link-pop .rm{background:transparent;color:#fca5a5;margin-left:auto}#bmj-link-pop .rm:hover{background:#dc2626;color:#fff}',
  ].join('');
  doc.head.appendChild(style);

  const bar = doc.createElement('div');
  bar.id = 'bmj-fmt-bar';
  bar.innerHTML =
    '<button data-cmd="bold" class="b" title="Kalın">B</button>'
    + '<button data-cmd="italic" class="i" title="İtalik">I</button>'
    + '<button data-cmd="underline" class="u" title="Altı çizili">U</button>'
    + '<span class="sep"></span>'
    + '<button data-menu="size" title="Yazı boyutu">Boyut ▾</button>'
    + '<button data-menu="color" title="Renk">Renk ▾</button>'
    + '<button data-menu="font" title="Yazı tipi">Font ▾</button>'
    + '<span class="sep"></span>'
    + '<button data-cmd="heading" title="Satırı başlık yap / kaldır">Başlık</button>'
    + '<button data-cmd="link" title="Bağlantı ekle">🔗 Bağlantı</button>';
  doc.body.appendChild(bar);

  const menus = {};
  const mkMenu = (key, items, isColor) => {
    const m = doc.createElement('div');
    m.className = 'bmj-menu';
    m.innerHTML = items.map(([label, val]) =>
      `<button data-val="${val}">${isColor && val ? `<span class="bmj-sw" style="background:${val}"></span>` : ''}${label}</button>`).join('');
    doc.body.appendChild(m);
    menus[key] = m;
    return m;
  };
  mkMenu('size', SIZES, false);
  mkMenu('color', COLORS, true);
  mkMenu('font', FONTS, false);

  // Link editor popover: view/change a URL, open it, remove it, or insert a brand
  // new link (with its own text) from scratch.
  const linkPop = doc.createElement('div');
  linkPop.id = 'bmj-link-pop';
  linkPop.innerHTML =
    '<label>Bağlantı adresi (URL)</label>'
    + '<input id="bmj-link-url" type="text" placeholder="https://… veya /sayfa.html veya #bolum">'
    + '<label>Görünen metin</label>'
    + '<input id="bmj-link-text" type="text" placeholder="Bağlantı yazısı">'
    + '<div class="row"><button class="apply">Uygula</button><button class="ghost open">↗ Aç</button><button class="rm">Bağlantıyı kaldır</button></div>';
  doc.body.appendChild(linkPop);

  const win = doc.defaultView;
  const sel = () => doc.getSelection();
  const inEditable = (node) => {
    while (node && node !== root) {
      if (node.nodeType === 1 && node.getAttribute && node.getAttribute('contenteditable') === 'true') return true;
      node = node.parentNode;
    }
    return false;
  };
  const hideMenus = () => Object.values(menus).forEach((m) => { m.style.display = 'none'; });
  const hideBar = () => { bar.style.display = 'none'; hideMenus(); };
  const touch = () => { try { root.dispatchEvent(new win.Event('input', { bubbles: true })); } catch (_) { markDirty(); if (fit) fit(); } };

  // Keep the text selection alive while clicking the toolbar.
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  Object.values(menus).forEach((m) => m.addEventListener('mousedown', (e) => e.preventDefault()));

  const positionBar = () => {
    if (linkPop.style.display === 'block') return; // keep the bar steady while the link editor is open
    const s = sel();
    if (!s || s.rangeCount === 0 || !inEditable(s.anchorNode) || !inEditable(s.focusNode)) { hideBar(); return; }
    // Show on a real selection OR when the caret sits inside an existing link
    // (so its 🔗 button is reachable to view/edit/remove that link).
    const link = currentLink();
    if (s.isCollapsed && !link) { hideBar(); return; }
    let rect = s.getRangeAt(0).getBoundingClientRect();
    if ((!rect || (!rect.width && !rect.height)) && link) rect = link.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { hideBar(); return; }
    bar.style.display = 'block';
    const de = doc.documentElement;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let left = rect.left + de.scrollLeft + rect.width / 2 - bw / 2;
    let top = rect.top + de.scrollTop - bh - 8;
    left = Math.max(6, Math.min(left, (de.clientWidth || 1200) - bw - 6));
    if (top < de.scrollTop + 2) top = rect.bottom + de.scrollTop + 8; // flip below
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
    // NB: do NOT hideMenus() here — a click on a menu button fires mouseup→
    // positionBar right after the menu opens, which would close it instantly.
    // Menus are closed explicitly by their own actions / clicking outside.
  };

  let tmr;
  doc.addEventListener('selectionchange', () => { clearTimeout(tmr); tmr = setTimeout(positionBar, 10); });
  doc.addEventListener('mouseup', () => setTimeout(positionBar, 0));
  doc.addEventListener('scroll', () => { if (bar.style.display === 'block') positionBar(); }, true);
  doc.addEventListener('mousedown', (e) => {
    if (!bar.contains(e.target) && !e.target.closest('.bmj-menu')) hideMenus();
    // Close the link editor when clicking away from it (but not when clicking the
    // toolbar that owns it).
    if (linkPop.style.display === 'block' && !linkPop.contains(e.target) && !bar.contains(e.target)) hideLinkPop();
  });

  const applyStyle = (prop, val) => {
    const s = sel();
    if (!s || s.rangeCount === 0 || s.isCollapsed) return;
    const range = s.getRangeAt(0);
    const span = doc.createElement('span');
    span.style[prop] = val || 'inherit'; // "" (Normal) → revert to design default
    try { range.surroundContents(span); }
    catch (_) { const frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); }
    s.removeAllRanges();
    const r = doc.createRange(); r.selectNodeContents(span); s.addRange(r);
    touch();
    positionBar();
  };
  const exec = (cmd) => { doc.execCommand(cmd, false, null); touch(); positionBar(); };
  const headingToggle = () => {
    const s = sel(); if (!s || s.rangeCount === 0) return;
    let n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentNode;
    let isH = false, p = n;
    while (p && p !== root) { if (/^H[1-6]$/.test(p.tagName)) { isH = true; break; } p = p.parentNode; }
    doc.execCommand('formatBlock', false, isH ? '<p>' : '<h3>');
    touch(); positionBar();
  };
  // The <a> the caret/selection currently sits inside, or null.
  const currentLink = () => {
    const s = sel(); if (!s || s.rangeCount === 0) return null;
    let n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentNode;
    while (n && n !== root) { if (n.tagName === 'A') return n; n = n.parentNode; }
    return null;
  };
  // Give a freshly-made link on-brand styling + safe target for external URLs.
  // Existing links (already classed/styled by the page) are left untouched.
  const styleLink = (a, url) => {
    if (/^https?:\/\//i.test(url)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    else { a.removeAttribute('target'); a.removeAttribute('rel'); }
    if (!a.className && !a.getAttribute('style')) {
      a.style.color = 'var(--color-teal-700)';
      a.style.textDecoration = 'underline';
    }
  };
  let _linkRange = null, _linkEl = null;
  const hideLinkPop = () => { linkPop.style.display = 'none'; _linkRange = null; _linkEl = null; };
  const openLinkPopover = () => {
    const s = sel(); if (!s || s.rangeCount === 0 || !inEditable(s.anchorNode)) return;
    _linkEl = currentLink();
    _linkRange = s.getRangeAt(0).cloneRange(); // survive focus moving to the input
    const urlI = linkPop.querySelector('#bmj-link-url');
    const txtI = linkPop.querySelector('#bmj-link-text');
    urlI.value = _linkEl ? (_linkEl.getAttribute('href') || '') : '';
    txtI.value = _linkEl ? _linkEl.textContent : (s.isCollapsed ? '' : s.toString());
    linkPop.querySelector('.rm').style.display = _linkEl ? '' : 'none';
    // position under the format bar (which is already shown — see positionBar)
    linkPop.style.display = 'block';
    const de = doc.documentElement;
    let left = Math.max(6, Math.min(bar.offsetLeft, (de.clientWidth || 1200) - linkPop.offsetWidth - 6));
    linkPop.style.left = left + 'px';
    linkPop.style.top = (bar.offsetTop + bar.offsetHeight + 6) + 'px';
    setTimeout(() => { urlI.focus(); urlI.select(); }, 10);
  };
  const applyLink = () => {
    const url = linkPop.querySelector('#bmj-link-url').value.trim();
    const text = linkPop.querySelector('#bmj-link-text').value;
    if (!url) { hideLinkPop(); return; }
    if (_linkEl) {
      // Edit existing link in place.
      _linkEl.setAttribute('href', url);
      styleLink(_linkEl, url);
      if (text && text !== _linkEl.textContent) _linkEl.textContent = text;
    } else {
      const s = sel();
      s.removeAllRanges(); s.addRange(_linkRange);
      if (!_linkRange.collapsed) {
        // Wrap the current selection.
        doc.execCommand('createLink', false, url);
        const a = currentLink(); if (a) { styleLink(a, url); if (text && text !== a.textContent) a.textContent = text; }
      } else {
        // Insert a brand-new link with its own text at the caret.
        const a = doc.createElement('a');
        a.setAttribute('href', url);
        a.textContent = text || url;
        styleLink(a, url);
        _linkRange.insertNode(a);
      }
    }
    hideLinkPop(); touch(); positionBar();
  };
  const removeLink = () => {
    if (_linkEl) {
      const p = _linkEl.parentNode;
      while (_linkEl.firstChild) p.insertBefore(_linkEl.firstChild, _linkEl);
      p.removeChild(_linkEl);
      touch();
    }
    hideLinkPop(); positionBar();
  };
  linkPop.querySelector('.apply').addEventListener('click', applyLink);
  linkPop.querySelector('.rm').addEventListener('click', removeLink);
  linkPop.querySelector('.open').addEventListener('click', () => {
    const url = linkPop.querySelector('#bmj-link-url').value.trim();
    if (url) win.open(url, '_blank', 'noopener');
  });
  linkPop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
    else if (e.key === 'Escape') { e.preventDefault(); hideLinkPop(); }
  });

  bar.querySelectorAll('button[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      hideMenus(); // close any open dropdown when a direct action is used
      const c = btn.dataset.cmd;
      if (c === 'bold' || c === 'italic' || c === 'underline') exec(c);
      else if (c === 'heading') headingToggle();
      else if (c === 'link') openLinkPopover();
    });
  });
  bar.querySelectorAll('button[data-menu]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = menus[btn.dataset.menu];
      const wasOpen = m.style.display === 'block';
      hideMenus();
      if (wasOpen) return;
      m.style.display = 'block';
      const de = doc.documentElement;
      m.style.left = (btn.getBoundingClientRect().left + de.scrollLeft) + 'px';
      m.style.top = (bar.offsetTop + bar.offsetHeight + 4) + 'px';
    });
  });
  const PROP = { size: 'fontSize', color: 'color', font: 'fontFamily' };
  Object.keys(menus).forEach((key) => {
    menus[key].querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { applyStyle(PROP[key], b.dataset.val); hideMenus(); });
    });
  });
}

// Strip rich-paste artifacts that corrupt the locked layout. ChatGPT-sourced
// HTML carries data-section-id / data-start / data-end / data-is-*-node markers
// and frequently nests block elements (<li>/<ul>/<p>) INSIDE inline text leaves
// (<span>/<a>/<strong>…), which the browser then renders as broken, split rows.
// We (1) drop those marker attributes everywhere and (2) flatten any inline
// element that wrongly contains block content back to its plain text. Safety net
// for the plain-text paste guard, and it also heals already-corrupted pages on
// the next save.
function _sanitizeVisualPaste(root) {
  root.querySelectorAll('[data-bmj-hero-editor-ui]').forEach((node) => node.remove());
  root.querySelectorAll('[data-bmj-hero-collapsed]').forEach((node) => node.removeAttribute('data-bmj-hero-collapsed'));
  // Browser-extension junk (Grammarly et al.) that gets injected into the live
  // DOM and would otherwise be serialised into the saved page.
  root.querySelectorAll('grammarly-extension, grammarly-extension-vbars, [data-grammarly-shadow-root], [data-gramm], [data-gramm_editor]').forEach((n) => n.remove());
  const ARTIFACTS = ['data-section-id', 'data-start', 'data-end', 'data-is-last-node', 'data-is-only-node'];
  ARTIFACTS.forEach((attr) => {
    root.querySelectorAll('[' + attr + ']').forEach((n) => n.removeAttribute(attr));
  });
  // Inline elements must not contain block/list/table descendants — flatten to text.
  root.querySelectorAll('span, a, strong, b, em, i, u, sup, sub, small, mark, abbr, label, cite').forEach((el) => {
    if (el.querySelector('li, ul, ol, p, div, table, h1, h2, h3, h4, h5, h6')) {
      el.textContent = (el.textContent || '').replace(/ +$/, '').trim();
    }
  });
}

// Serialise the edited content back to clean HTML (drop editor-only attributes).
function _readVisualPageContent() {
  const frame = document.getElementById('pg-frame');
  const doc = frame && frame.contentDocument;
  const root = doc && doc.getElementById('pg-edit-root');
  if (!root) return null;
  const clone = root.cloneNode(true);
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  clone.querySelectorAll('[data-ce]').forEach((n) => n.removeAttribute('data-ce'));
  _sanitizeVisualPaste(clone);
  return clone.innerHTML;
}

// "Gelişmiş (HTML)" escape hatch: swap the visual editor for a raw-HTML textarea
// and back. Power users can hand-edit; non-technical users never need it.
function toggleVisualPageRaw(slug) {
  const frame = document.getElementById('pg-frame');
  const raw = document.getElementById('pg-raw');
  const btn = document.getElementById('pg-advanced-toggle');
  if (!frame || !raw) return;
  if (_visualRawMode) {
    // Raw → visual: re-render the iframe from the edited HTML.
    frame.onload = () => _wireVisualPageEditor(frame);
    frame.srcdoc = _visualPageSrcdoc(raw.value);
    raw.classList.add('hidden');
    frame.classList.remove('hidden');
    btn.textContent = 'Gelişmiş (HTML)';
    _visualRawMode = false;
  } else {
    // Visual → raw: dump current edited HTML into the textarea.
    const content = _readVisualPageContent();
    if (content == null) { toast('Editör henüz hazır değil', 'warning'); return; }
    raw.value = content;
    frame.classList.add('hidden');
    raw.classList.remove('hidden');
    raw.oninput = () => markDirty();
    btn.textContent = 'Görsel düzenleyiciye dön';
    _visualRawMode = true;
  }
}

async function saveVisualPage(slug) {
  const content = _visualRawMode
    ? document.getElementById('pg-raw').value
    : _readVisualPageContent();
  if (content == null) { toast('Editör yüklenemedi, sayfayı yenileyin', 'error'); return; }
  try {
    await API.put(`/pages/${slug}`, { content });
    clearDirty();
    toast('Sayfa kaydedildi. Canlı sitede güncellendi.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function pageSectionBlock(section, index) {
  return `
    <div class="page-section card" data-section-idx="${index}">
      <div class="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-t-xl border-b">
        <div class="flex items-center gap-2 flex-1">
          <svg class="w-4 h-4 text-gray-400 cursor-grab" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/></svg>
          <input class="ps-heading flex-1 px-2 py-1 border rounded text-sm font-semibold text-gray-900" value="${esc(section.heading)}" placeholder="Bölüm başlığı" oninput="markDirty()">
        </div>
        <div class="flex items-center gap-1 ml-2">
          <button onclick="movePageSection(this, -1)" class="text-gray-400 hover:text-gray-700 p-1" title="Yukarı">&#9650;</button>
          <button onclick="movePageSection(this, 1)" class="text-gray-400 hover:text-gray-700 p-1" title="Aşağı">&#9660;</button>
          <button onclick="toggleSectionCollapse(this)" class="text-gray-400 hover:text-gray-700 p-1" title="Daralt/Genişlet">&#9660;</button>
          <button onclick="removePageSection(this)" class="text-red-400 hover:text-red-600 p-1" title="Sil">&times;</button>
        </div>
      </div>
      <div class="ps-body p-4">
        <div class="flex flex-wrap items-center gap-1 border border-b-0 rounded-t-lg bg-gray-50 px-2 py-1.5">
          <button type="button" onclick="sectionCmd(this,'bold')" title="Kalın (Ctrl+B)" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></svg><span>Kalın</span></button>
          <button type="button" onclick="sectionCmd(this,'italic')" title="İtalik (Ctrl+I)" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 4h4m-2 0l-4 16m0 0h4"/></svg><span>İtalik</span></button>
          <div class="w-px bg-gray-300 mx-1 self-stretch"></div>
          <button type="button" onclick="sectionHeadingToggle(this)" title="Seçili satırı başlık yap / başlığı kaldır" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 5v14M18 5v14M6 12h12"/></svg><span>Başlık</span></button>
          <div class="w-px bg-gray-300 mx-1 self-stretch"></div>
          <button type="button" onclick="sectionCmd(this,'insertUnorderedList')" title="Madde işaretli liste" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg><span>Liste</span></button>
          <button type="button" onclick="sectionLink(this)" title="Bağlantı (link) ekle" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg><span>Bağlantı</span></button>
          <div class="w-px bg-gray-300 mx-1 self-stretch"></div>
          <button type="button" onclick="sectionInsertMedia(this,'image')" title="Resim ekle (bilgisayardan yükle veya URL)" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5">${_mediaImageIcon}<span>Resim</span></button>
          <button type="button" onclick="sectionInsertMedia(this,'video')" title="Video ekle (bilgisayardan yükle veya URL)" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5">${_mediaVideoIcon}<span>Video</span></button>
          <button type="button" onclick="sectionInsertMedia(this,'youtube')" title="YouTube videosu ekle (bağlantı yapıştır)" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5">${_mediaYouTubeIcon}<span>YouTube</span></button>
          <div class="w-px bg-gray-300 mx-1 self-stretch"></div>
          <button type="button" onclick="sectionCmd(this,'removeFormat')" title="Seçili metnin biçimini temizle" class="px-2 py-1 rounded hover:bg-gray-200 text-gray-600 text-xs font-medium flex items-center gap-1.5"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17 10L3 3m0 0l7 14 2-5 5-2M3 3l18 18"/></svg><span>Biçimi Temizle</span></button>
        </div>
        <div class="ps-content w-full px-4 py-3 border rounded-b-lg text-sm min-h-[120px] focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 max-w-none overflow-auto bg-white" contenteditable="true" oninput="markDirty()" onfocus="try{document.execCommand('defaultParagraphSeparator',false,'p')}catch(e){}">${section.body || '<p><br></p>'}</div>
      </div>
    </div>`;
}

function addPageSection() {
  const container = document.getElementById('page-sections');
  const idx = container.querySelectorAll('.page-section').length;
  container.insertAdjacentHTML('beforeend', pageSectionBlock({ heading: '', body: '' }, idx));
  markDirty();
}

function removePageSection(btn) {
  btn.closest('.page-section').remove();
  markDirty();
}

function movePageSection(btn, dir) {
  const section = btn.closest('.page-section');
  const container = section.parentElement;
  const sibling = dir === -1 ? section.previousElementSibling : section.nextElementSibling;
  if (!sibling || !sibling.classList.contains('page-section')) return;
  if (dir === -1) container.insertBefore(section, sibling);
  else container.insertBefore(sibling, section);
  markDirty();
}

function toggleSectionCollapse(btn) {
  const body = btn.closest('.page-section').querySelector('.ps-body');
  body.classList.toggle('hidden');
  btn.innerHTML = body.classList.contains('hidden') ? '&#9654;' : '&#9660;';
}

function sectionCmd(btn, command, value) {
  const section = btn.closest('.page-section');
  const editor = section.querySelector('.ps-content[contenteditable]');
  if (editor) { editor.focus(); document.execCommand(command, false, value || null); markDirty(); }
}

function sectionLink(btn) {
  const url = prompt('Link URL:');
  if (url) {
    const section = btn.closest('.page-section');
    const editor = section.querySelector('.ps-content[contenteditable]');
    if (editor) { editor.focus(); document.execCommand('createLink', false, url); markDirty(); }
  }
}

// "Başlık" button in a page section: toggle the caret's line between a heading
// (h3) and a normal paragraph — one labelled button instead of separate H3/P.
function sectionHeadingToggle(btn) {
  const section = btn.closest('.page-section');
  const editor = section && section.querySelector('.ps-content[contenteditable]');
  if (!editor) return;
  editor.focus();
  const tag = _selectionBlockTag(editor) === 'h3' ? '<p>' : '<h3>';
  document.execCommand('formatBlock', false, tag);
  markDirty();
}

// Normalize a contenteditable section body so plain-text input still renders
// correctly inside the public site's `.prose space-y-4` container.
// Wraps bare text nodes and top-level <div>s in <p>, splits <br>-separated
// runs into separate <p>s, and removes empty elements.
function normalizeSectionBodyHtml(html) {
  if (!html || !html.trim()) return '';
  // Already wrapped in block elements? Leave it alone except for empty cleanup.
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;

  const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'FIGURE', 'HR']);

  // Pass 1: split <br><br>... runs in inline contexts into separate paragraphs
  // First, normalize top-level. Walk children; collect inline runs.
  const out = document.createElement('div');
  let currentP = null;
  const flush = () => {
    if (currentP && currentP.innerHTML.trim()) {
      // Trim leading/trailing <br>s
      currentP.innerHTML = currentP.innerHTML.replace(/^(\s*<br\s*\/?>\s*)+/i, '').replace(/(\s*<br\s*\/?>\s*)+$/i, '').trim();
      if (currentP.innerHTML.trim()) out.appendChild(currentP);
    }
    currentP = null;
  };

  const childNodes = [...wrapper.childNodes];
  for (const node of childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (!text.trim()) continue;
      if (!currentP) currentP = document.createElement('p');
      currentP.appendChild(node.cloneNode(true));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName;
    // Top-level block element — flush current paragraph, append as-is
    if (BLOCK_TAGS.has(tag)) {
      flush();
      // Convert <div> wrappers (browser-inserted) to <p>; keep real blocks.
      if (tag === 'DIV' && !node.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, figure')) {
        const p = document.createElement('p');
        p.innerHTML = node.innerHTML;
        if (p.innerHTML.trim()) out.appendChild(p);
      } else {
        out.appendChild(node.cloneNode(true));
      }
      continue;
    }
    if (tag === 'DIV') {
      // Browser-inserted <div> on Enter — convert to <p>
      flush();
      const inner = (node.innerHTML || '').trim();
      if (!inner) continue;
      const p = document.createElement('p');
      p.innerHTML = inner;
      out.appendChild(p);
      continue;
    }
    if (tag === 'BR') {
      // Treat <br><br> as paragraph break: flush current
      flush();
      continue;
    }
    // Inline elements (SPAN/STRONG/EM/A/CODE/SUP/SUB/IMG) — accumulate into currentP
    if (!currentP) currentP = document.createElement('p');
    currentP.appendChild(node.cloneNode(true));
  }
  flush();

  return out.innerHTML;
}

function buildPageHtmlFromSections() {
  const sections = document.querySelectorAll('.page-section');
  if (!sections.length) return document.getElementById('pg-content-visual') ? getHtmlEditorContent('pg-content') : '';
  return Array.from(sections).map((sec) => {
    const heading = sec.querySelector('.ps-heading').value.trim();
    const contentEl = sec.querySelector('.ps-content');
    const rawContent = (contentEl.tagName === 'TEXTAREA' ? contentEl.value : contentEl.innerHTML).trim();
    const content = normalizeSectionBodyHtml(rawContent);
    if (!heading && !content) return '';
    return `            <section>\n              <h2 class="text-2xl font-bold text-gray-900 mb-4">${heading}</h2>\n              <div class="prose prose-gray max-w-none text-gray-700 leading-relaxed space-y-4">\n                ${content}\n              </div>\n            </section>`;
  }).filter(Boolean).join('\n\n');
}

async function savePage(slug) {
  try {
    const visualEditor = document.getElementById('page-visual-editor');
    let content;
    if (visualEditor && !visualEditor.classList.contains('hidden')) {
      content = buildPageHtmlFromSections();
    } else {
      content = getHtmlEditorContent('pg-content');
    }
    await API.put(`/pages/${slug}`, { content });
    clearDirty();
    toast('Sayfa güncellendi');
  } catch (err) { toast(err.message, 'error'); }
}

// Article types
route('/article-types', async (el) => {
  const types = await API.get('/article-types');
  const inUseCount = types.filter(t => t.count > 0).length;
  el.innerHTML = `
    <div class="page-header">
      <div class="min-w-0">
        <h1 class="page-title">Makale Türleri <span style="font-weight:400;color:var(--text-muted);font-size:18px">(${types.length})</span></h1>
        <p class="page-subtitle">Dergide kullanılan makale türlerini yönetin. Yeni bir tür eklediğinizde, makale ekleme/düzenleme formundaki <em>Tür</em> alanında öneri olarak görünür.</p>
      </div>
      <div class="flex gap-2">
        <button onclick="addArticleType()" class="btn btn-primary text-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Yeni Tür Ekle
        </button>
      </div>
    </div>

    <div class="card card-padded mb-5" style="background:#f0f9ff;border-color:#bae6fd;padding:14px 16px">
      <div class="flex items-start gap-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0369a1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <div class="text-sm" style="color:#0c4a6e;line-height:1.55">
          <strong>Tür ekleme nasıl çalışır?</strong> Burada eklediğiniz tür adları, makale formundaki <em>Tür</em> alanının açılır öneri listesine eklenir. Bir tür herhangi bir makalede kullanıldığı sürece otomatik olarak listede görünür — silmek için önce o türü kullanan makaleleri başka bir türe taşıyın.
        </div>
      </div>
    </div>

    <div class="card overflow-hidden" style="max-width:720px">
      <table class="w-full text-sm">
        <thead style="background:var(--bg-subtle)"><tr>
          <th class="text-left px-4 py-2.5 font-medium" style="color:var(--text-muted);font-size:12px;text-transform:uppercase;letter-spacing:0.04em">Tür Adı</th>
          <th class="text-right px-4 py-2.5 font-medium w-24" style="color:var(--text-muted);font-size:12px;text-transform:uppercase;letter-spacing:0.04em">Kullanım</th>
          <th class="text-right px-4 py-2.5 font-medium w-40" style="color:var(--text-muted);font-size:12px;text-transform:uppercase;letter-spacing:0.04em">İşlem</th>
        </tr></thead>
        <tbody>${types.length === 0 ? `
          <tr><td colspan="3" class="px-4 py-8 text-center" style="color:var(--text-muted)">Henüz tür yok. Yukarıdaki <strong>Yeni Tür Ekle</strong> ile başlayın.</td></tr>` : types.map((t) => `
          <tr style="border-top:1px solid var(--border-soft)">
            <td class="px-4 py-2.5 font-medium" style="color:var(--text-strong)">
              ${esc(t.name)}
              ${t.manual && t.count === 0 ? '<span class="badge bg-gray-100 text-gray-600" style="margin-left:8px;font-size:11px;padding:2px 6px">manuel</span>' : ''}
            </td>
            <td class="px-4 py-2.5 text-right tabular-nums" style="color:var(--text-muted)">
              ${t.count === 0 ? '<span style="color:var(--text-muted);font-style:italic">kullanılmıyor</span>' : `${t.count} makale`}
            </td>
            <td class="px-4 py-2.5 text-right">
              <button onclick="renameType('${esc(t.name).replace(/'/g, "\\'")}')" class="text-xs font-medium" style="color:var(--brand);margin-right:12px" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Adlandır</button>
              ${t.count === 0 ? `<button onclick="deleteArticleType('${esc(t.name).replace(/'/g, "\\'")}')" class="text-xs font-medium" style="color:#b91c1c" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Sil</button>` : '<span class="text-xs" style="color:var(--text-muted-soft, #d1d5db)">Sil</span>'}
            </td>
          </tr>`).join('')}</tbody>
      </table>
    </div>

    <p class="text-xs mt-4" style="color:var(--text-muted)">${inUseCount} tür aktif olarak kullanılıyor · ${types.length - inUseCount} kullanılmıyor</p>
  `;
});

async function addArticleType() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-dialog">
        <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
          <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">Yeni Makale Türü Ekle</h3>
          <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="px-6 py-5">
          <label class="label" for="new-type-input">Tür adı</label>
          <input id="new-type-input" type="text" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="örn. Editorial, Brief Report" maxlength="80" autocomplete="off" />
          <p class="text-xs mt-2" style="color:var(--text-muted)">Eklediğiniz tür, makale formundaki <em>Tür</em> alanında öneri olarak görünecektir.</p>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
          <button data-action="cancel" class="btn btn-secondary">İptal</button>
          <button data-action="add" class="btn btn-primary">Ekle</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#new-type-input');
    setTimeout(() => input?.focus(), 50);

    const finish = async (action) => {
      const name = (input?.value || '').trim();
      if (action === 'add') {
        if (!name) { toast('Tür adı boş olamaz', 'error'); return; }
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        try {
          await API.post('/article-types', { name });
          toast(`"${name}" türü eklendi`);
          handleRoute();
        } catch (err) { toast(err.message, 'error'); }
        resolve();
      } else {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve();
      }
    };

    overlay.querySelector('.modal-close').onclick = () => finish('cancel');
    overlay.querySelectorAll('[data-action]').forEach(btn => { btn.onclick = () => finish(btn.dataset.action); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish('cancel'); });
    const onKey = (e) => {
      if (e.key === 'Escape') finish('cancel');
      else if (e.key === 'Enter' && document.activeElement === input) finish('add');
    };
    document.addEventListener('keydown', onKey);
  });
}

async function renameType(oldName) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-dialog">
        <div class="flex items-center justify-between px-6 py-4" style="border-bottom:1px solid var(--border-soft)">
          <h3 class="text-base font-semibold" style="color:var(--text-strong);letter-spacing:-0.01em">Türü Yeniden Adlandır</h3>
          <button class="modal-close p-1.5 rounded-md" style="color:var(--text-muted)" aria-label="Kapat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="px-6 py-5">
          <p class="text-sm mb-3" style="color:var(--text)">Şu anki ad: <strong>${esc(oldName)}</strong></p>
          <label class="label" for="rename-type-input">Yeni ad</label>
          <input id="rename-type-input" type="text" class="w-full px-3 py-2 border rounded-lg text-sm" maxlength="80" autocomplete="off" value="${esc(oldName)}" />
          <p class="text-xs mt-2" style="color:var(--text-muted)">Bu türü kullanan tüm makaleler ve baskıdaki makaleler güncellenecek.</p>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4" style="border-top:1px solid var(--border-soft);background:var(--bg-subtle);border-radius:0 0 var(--radius-lg) var(--radius-lg)">
          <button data-action="cancel" class="btn btn-secondary">İptal</button>
          <button data-action="save" class="btn btn-primary">Kaydet</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#rename-type-input');
    setTimeout(() => { input?.focus(); input?.select(); }, 50);

    const finish = async (action) => {
      const newName = (input?.value || '').trim();
      if (action === 'save') {
        if (!newName) { toast('Yeni ad boş olamaz', 'error'); return; }
        if (newName === oldName) { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(); return; }
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        try {
          const result = await API.put('/article-types/rename', { oldName, newName });
          toast(`${result.renamed} makale güncellendi`);
          handleRoute();
        } catch (err) { toast(err.message, 'error'); }
        resolve();
      } else {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve();
      }
    };

    overlay.querySelector('.modal-close').onclick = () => finish('cancel');
    overlay.querySelectorAll('[data-action]').forEach(btn => { btn.onclick = () => finish(btn.dataset.action); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish('cancel'); });
    const onKey = (e) => {
      if (e.key === 'Escape') finish('cancel');
      else if (e.key === 'Enter' && document.activeElement === input) finish('save');
    };
    document.addEventListener('keydown', onKey);
  });
}

async function deleteArticleType(name) {
  const ok = await confirmAction(`"${name}" türünü silmek istediğinizden emin misiniz? Bu işlem sadece kullanılmayan türler için geçerlidir.`);
  if (!ok) return;
  try {
    await API.del(`/article-types/${encodeURIComponent(name)}`);
    toast(`"${name}" türü silindi`);
    handleRoute();
  } catch (err) { toast(err.message, 'error'); }
}

// Nav/Footer
let _nfModel = null;   // { nav, footer } structured model
let _nfHtml = null;    // { navHtml, footerHtml } last saved/generated HTML
let _nfTab = 'form';

function nfVal(id) { const e = document.getElementById(id); return e ? e.value : ''; }

route('/nav-footer', async (el) => {
  el.innerHTML = `
    <div class="page-header">
      <div class="min-w-0">
        <h1 class="page-title">Menü & Footer</h1>
        <p class="page-subtitle">Sitenin tüm sayfalarında ortak görünen üst menü ve alt bilgiyi kod yazmadan, form alanlarıyla düzenleyin. Değişiklikler yalnızca <strong>Tüm Sayfalara Uygula</strong> ile sayfalara yazılır.</p>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="previewNavFooter()" class="btn btn-secondary text-sm">Önizle</button>
        <button onclick="saveNavFooter()" class="btn btn-secondary text-sm" id="nf-save-btn">Kaydet</button>
        <button onclick="syncNavFooter()" class="btn btn-primary text-sm">Tüm Sayfalara Uygula</button>
      </div>
    </div>

    <div class="card card-padded mb-5" style="background:#f0f9ff;border-color:#bae6fd;padding:14px 16px">
      <div class="flex items-start gap-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0369a1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <div class="text-sm" style="color:#0c4a6e;line-height:1.55">
          <strong>Nasıl çalışır?</strong> Aşağıdaki form alanlarını doldurun. <strong>Kaydet</strong> yaptığınızda panel saklar — siteye henüz yansıtmaz. <strong>Tüm Sayfalara Uygula</strong> 16+ statik sayfaya yazar (otomatik yedek alınır). Sosyal medya ikonları ayrı <em>Sosyal Medya</em> sayfasından yönetilir.
        </div>
      </div>
    </div>

    <div class="flex gap-1 border-b border-gray-200 mb-5">
      <button id="nf-tab-form" onclick="nfTab('form')" class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors border-teal-600 text-teal-700">Form Düzenleyici</button>
      <button id="nf-tab-html" onclick="nfTab('html')" class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors border-transparent text-gray-500 hover:text-gray-700">HTML (gelişmiş)</button>
    </div>
    <div id="nf-form-tab"></div>
    <div id="nf-html-tab" class="hidden"></div>
  `;

  _nfTab = 'form';
  try {
    const data = await API.get('/nav-footer');
    _nfModel = { nav: data.nav, footer: data.footer };
    _nfHtml = { navHtml: data.navHtml || '', footerHtml: data.footerHtml || '' };
    renderNavFooterForm();
    renderNavFooterHtmlTab();
  } catch (err) {
    toast('Menü/footer yüklenemedi: ' + err.message, 'error');
  }
  el.addEventListener('input', markDirty);
  clearDirty();
});

function nfTab(which) {
  _nfTab = which;
  document.getElementById('nf-form-tab').classList.toggle('hidden', which !== 'form');
  document.getElementById('nf-html-tab').classList.toggle('hidden', which !== 'html');
  [['form', 'nf-tab-form'], ['html', 'nf-tab-html']].forEach(([k, id]) => {
    const btn = document.getElementById(id);
    const active = k === which;
    btn.classList.toggle('border-teal-600', active);
    btn.classList.toggle('text-teal-700', active);
    btn.classList.toggle('border-transparent', !active);
    btn.classList.toggle('text-gray-500', !active);
  });
}

// --- Form rendering ---
const NF_ICONS = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
  dropdown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  column: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
};

function nfItemRow(it, i, total) {
  const actions = `<div class="flex items-center" style="gap:1px">
      <button type="button" onclick="nfMoveItem(${i},-1)" ${i === 0 ? 'disabled' : ''} class="nf-iconbtn" title="Yukarı taşı">${NF_ICONS.up}</button>
      <button type="button" onclick="nfMoveItem(${i},1)" ${i === total - 1 ? 'disabled' : ''} class="nf-iconbtn" title="Aşağı taşı">${NF_ICONS.down}</button>
      <button type="button" onclick="nfRemoveItem(${i})" class="nf-iconbtn nf-del" title="Sil">${NF_ICONS.x}</button>
    </div>`;
  if (it.type === 'dropdown') {
    const kids = (it.children || []).map((c, j) => `
        <div class="nf-item flex items-center gap-2" style="padding:7px 0">
          <input data-nav-item="${i}" data-child="${j}" data-field="label" class="input" style="flex:1" placeholder="Alt bağlantı adı" value="${esc(c.label)}">
          <input data-nav-item="${i}" data-child="${j}" data-field="url" class="input" style="flex:1" placeholder="Adres (ör. about.html)" value="${esc(c.url)}">
          <button type="button" onclick="nfRemoveChild(${i},${j})" class="nf-iconbtn nf-del" title="Sil">${NF_ICONS.x}</button>
        </div>`).join('');
    return `<div class="nf-item" style="padding:10px 0">
      <div class="flex items-center gap-2">
        <span class="nf-type" title="Açılır menü">${NF_ICONS.dropdown}</span>
        <input data-nav-item="${i}" data-field="label" class="input" style="flex:1;font-weight:500" placeholder="Menü başlığı (ör. Hakkında)" value="${esc(it.label)}">
        ${actions}
      </div>
      <div class="nf-children" style="margin-top:6px">${kids}
        <button type="button" onclick="nfAddChild(${i})" class="nf-addlink">+ Alt bağlantı</button>
      </div>
    </div>`;
  }
  return `<div class="nf-item flex items-center gap-2" style="padding:10px 0">
    <span class="nf-type" title="Bağlantı">${NF_ICONS.link}</span>
    <input data-nav-item="${i}" data-field="label" class="input" style="flex:1" placeholder="Etiket (ör. Ana Sayfa)" value="${esc(it.label)}">
    <input data-nav-item="${i}" data-field="url" class="input" style="flex:1" placeholder="Adres (ör. about.html)" value="${esc(it.url)}">
    ${actions}
  </div>`;
}

function nfColRow(c, ci) {
  const links = (c.links || []).map((l, j) => `
        <div class="nf-item flex items-center gap-2" style="padding:7px 0">
          <input data-col="${ci}" data-link="${j}" data-field="label" class="input" style="flex:1" placeholder="Bağlantı adı" value="${esc(l.label)}">
          <input data-col="${ci}" data-link="${j}" data-field="url" class="input" style="flex:1" placeholder="Adres" value="${esc(l.url)}">
          <button type="button" onclick="nfRemoveColLink(${ci},${j})" class="nf-iconbtn nf-del" title="Sil">${NF_ICONS.x}</button>
        </div>`).join('');
  return `<div class="nf-item" style="padding:10px 0">
    <div class="flex items-center gap-2">
      <span class="nf-type" title="Bağlantı sütunu">${NF_ICONS.column}</span>
      <input data-col="${ci}" data-field="title" class="input" style="flex:1;font-weight:500" placeholder="Sütun başlığı (ör. Hızlı Bağlantılar)" value="${esc(c.title)}">
      <button type="button" onclick="nfRemoveCol(${ci})" class="nf-iconbtn nf-del" title="Sütunu sil">${NF_ICONS.x}</button>
    </div>
    <div class="nf-children" style="margin-top:6px">${links}
      <button type="button" onclick="nfAddColLink(${ci})" class="nf-addlink">+ Bağlantı</button>
    </div>
  </div>`;
}

function renderNavFooterForm() {
  const m = _nfModel;
  if (!m) return;
  const navItems = m.nav.items.map((it, i) => nfItemRow(it, i, m.nav.items.length)).join('');
  const cols = (m.footer.columns || []).map((c, i) => nfColRow(c, i)).join('');
  document.getElementById('nf-form-tab').innerHTML = `
    <div class="card overflow-hidden mb-5">
      <div class="px-5 py-3" style="border-bottom:1px solid var(--border-soft);background:var(--bg-subtle)">
        <h3 class="font-semibold text-sm" style="color:var(--text-strong)">Üst Menü</h3>
        <span class="text-xs" style="color:var(--text-muted)">Sitenin üstünde görünen menü bağlantıları</span>
      </div>
      <div style="padding:6px 16px 16px">
        <div>${navItems}</div>
        <div class="flex gap-2 mt-3">
          <button type="button" onclick="nfAddLink()" class="btn btn-secondary btn-sm">+ Bağlantı Ekle</button>
          <button type="button" onclick="nfAddDropdown()" class="btn btn-secondary btn-sm">+ Açılır Menü Ekle</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 pt-4" style="border-top:1px solid var(--border-soft)">
          <div><label class="label">"Makale Gönder" buton metni</label><input id="nf-submit-label" class="input" value="${esc(m.nav.submitLabel || '')}"></div>
          <div><label class="label">"Makale Gönder" buton adresi</label><input id="nf-submit-url" class="input" value="${esc(m.nav.submitUrl || '')}"></div>
        </div>
      </div>
    </div>

    <div class="card overflow-hidden">
      <div class="px-5 py-3" style="border-bottom:1px solid var(--border-soft);background:var(--bg-subtle)">
        <h3 class="font-semibold text-sm" style="color:var(--text-strong)">Alt Bilgi (Footer)</h3>
        <span class="text-xs" style="color:var(--text-muted)">Sitenin altında görünen bilgi ve bağlantılar</span>
      </div>
      <div style="padding:16px" class="space-y-5">
        <div>
          <label class="label">Dergi adı</label>
          <input id="nf-brand-title" class="input" value="${esc(m.footer.brandTitle || '')}">
          <label class="label" style="margin-top:8px">Açıklama metni</label>
          <textarea id="nf-brand-text" rows="3" class="input">${esc(m.footer.brandText || '')}</textarea>
        </div>
        <div>
          <label class="label">Bağlantı sütunları</label>
          <div>${cols}</div>
          <button type="button" onclick="nfAddCol()" class="btn btn-secondary btn-sm mt-2">+ Sütun Ekle</button>
        </div>
        <div>
          <label class="label">İletişim başlığı</label>
          <input id="nf-contact-title" class="input" value="${esc(m.footer.contactTitle || '')}">
          <label class="label" style="margin-top:8px">İletişim metni / adres</label>
          <textarea id="nf-contact-text" rows="4" class="input">${esc(m.footer.contactText || '')}</textarea>
          <p class="text-xs mt-1" style="color:var(--text-faint)">Boş satır yeni paragraf, tek satır alt satır olur.</p>
          <label class="label" style="margin-top:8px">E-posta</label>
          <input id="nf-contact-email" class="input" value="${esc(m.footer.contactEmail || '')}">
        </div>
        <div class="grid grid-cols-1 gap-2 pt-4" style="border-top:1px solid var(--border-soft)">
          <div><label class="label">Telif (copyright) metni</label><input id="nf-copyright" class="input" value="${esc(m.footer.copyright || '')}"></div>
          <div><label class="label">Lisans metni</label><input id="nf-license" class="input" value="${esc(m.footer.licenseText || '')}"></div>
        </div>
        <p class="text-xs" style="color:var(--text-muted)">Sosyal medya ikonları (Instagram, X, LinkedIn …) ayrı <strong>Sosyal Medya</strong> sayfasından yönetilir.</p>
      </div>
    </div>
    <div class="mt-4 text-center">
      <button type="button" onclick="resetNavFooterFromSource()" class="text-xs" style="color:var(--text-muted)">Varsayılan menü/footer içeriğine sıfırla</button>
    </div>
  `;
}

function renderNavFooterHtmlTab() {
  if (!_nfHtml) return;
  document.getElementById('nf-html-tab').innerHTML = `
    <div class="card card-padded mb-4" style="background:#fffbeb;border-color:#fde68a;padding:10px 14px">
      <p class="text-xs" style="color:#92400e">Gelişmiş: Bu sekme son <strong>kaydedilen</strong> HTML'i gösterir. Buradan elle düzenleyip kaydederseniz, Form sekmesindeki alanlarla eşleşmeyebilir. Çoğu durumda Form sekmesi yeterlidir.</p>
    </div>
    <div class="card overflow-hidden mb-4">
      <div class="px-5 py-3" style="border-bottom:1px solid var(--border-soft);background:var(--bg-subtle)"><h3 class="font-semibold text-sm" style="color:var(--text-strong)">Üst Menü HTML</h3></div>
      <div style="padding:12px"><textarea id="nf-nav-html" rows="12" class="w-full px-3 py-2 rounded-lg text-xs font-mono" style="border:1px solid var(--border);background:#fafbfc" spellcheck="false">${esc(_nfHtml.navHtml)}</textarea></div>
    </div>
    <div class="card overflow-hidden">
      <div class="px-5 py-3" style="border-bottom:1px solid var(--border-soft);background:var(--bg-subtle)"><h3 class="font-semibold text-sm" style="color:var(--text-strong)">Footer HTML</h3></div>
      <div style="padding:12px"><textarea id="nf-footer-html" rows="12" class="w-full px-3 py-2 rounded-lg text-xs font-mono" style="border:1px solid var(--border);background:#fafbfc" spellcheck="false">${esc(_nfHtml.footerHtml)}</textarea></div>
    </div>
  `;
}

// --- Read the form inputs back into the in-memory model ---
function nfSyncModel() {
  const m = _nfModel;
  if (!m) return;
  m.nav.items.forEach((it, i) => {
    const lbl = document.querySelector(`[data-nav-item="${i}"][data-field="label"]:not([data-child])`);
    if (lbl) it.label = lbl.value;
    if (it.type === 'dropdown') {
      (it.children || []).forEach((c, j) => {
        const cl = document.querySelector(`[data-nav-item="${i}"][data-child="${j}"][data-field="label"]`);
        const cu = document.querySelector(`[data-nav-item="${i}"][data-child="${j}"][data-field="url"]`);
        if (cl) c.label = cl.value;
        if (cu) c.url = cu.value;
      });
    } else {
      const u = document.querySelector(`[data-nav-item="${i}"][data-field="url"]:not([data-child])`);
      if (u) it.url = u.value;
    }
  });
  m.nav.submitLabel = nfVal('nf-submit-label');
  m.nav.submitUrl = nfVal('nf-submit-url');
  m.footer.brandTitle = nfVal('nf-brand-title');
  m.footer.brandText = nfVal('nf-brand-text');
  (m.footer.columns || []).forEach((col, c) => {
    const t = document.querySelector(`[data-col="${c}"][data-field="title"]`);
    if (t) col.title = t.value;
    (col.links || []).forEach((l, j) => {
      const ll = document.querySelector(`[data-col="${c}"][data-link="${j}"][data-field="label"]`);
      const lu = document.querySelector(`[data-col="${c}"][data-link="${j}"][data-field="url"]`);
      if (ll) l.label = ll.value;
      if (lu) l.url = lu.value;
    });
  });
  m.footer.contactTitle = nfVal('nf-contact-title');
  m.footer.contactText = nfVal('nf-contact-text');
  m.footer.contactEmail = nfVal('nf-contact-email');
  m.footer.copyright = nfVal('nf-copyright');
  m.footer.licenseText = nfVal('nf-license');
}

// --- Mutation handlers (sync form -> model, mutate, re-render) ---
function nfAddLink() { nfSyncModel(); _nfModel.nav.items.push({ type: 'link', label: 'Yeni Bağlantı', url: '#' }); renderNavFooterForm(); markDirty(); }
function nfAddDropdown() { nfSyncModel(); _nfModel.nav.items.push({ type: 'dropdown', label: 'Yeni Menü', children: [{ label: 'Alt bağlantı', url: '#' }] }); renderNavFooterForm(); markDirty(); }
function nfRemoveItem(i) { nfSyncModel(); _nfModel.nav.items.splice(i, 1); renderNavFooterForm(); markDirty(); }
function nfMoveItem(i, d) { nfSyncModel(); const a = _nfModel.nav.items, j = i + d; if (j < 0 || j >= a.length) return; const t = a[i]; a[i] = a[j]; a[j] = t; renderNavFooterForm(); markDirty(); }
function nfAddChild(i) { nfSyncModel(); const it = _nfModel.nav.items[i]; it.children = it.children || []; it.children.push({ label: 'Alt bağlantı', url: '#' }); renderNavFooterForm(); markDirty(); }
function nfRemoveChild(i, j) { nfSyncModel(); _nfModel.nav.items[i].children.splice(j, 1); renderNavFooterForm(); markDirty(); }
function nfAddCol() { nfSyncModel(); (_nfModel.footer.columns = _nfModel.footer.columns || []).push({ title: 'Yeni Sütun', links: [{ label: 'Bağlantı', url: '#' }] }); renderNavFooterForm(); markDirty(); }
function nfRemoveCol(c) { nfSyncModel(); _nfModel.footer.columns.splice(c, 1); renderNavFooterForm(); markDirty(); }
function nfAddColLink(c) { nfSyncModel(); const col = _nfModel.footer.columns[c]; col.links = col.links || []; col.links.push({ label: 'Bağlantı', url: '#' }); renderNavFooterForm(); markDirty(); }
function nfRemoveColLink(c, j) { nfSyncModel(); _nfModel.footer.columns[c].links.splice(j, 1); renderNavFooterForm(); markDirty(); }

// Persist current editor state (form model or raw HTML, depending on tab).
async function nfPersist() {
  if (_nfTab === 'html') {
    await API.put('/nav-footer', { navHtml: nfVal('nf-nav-html'), footerHtml: nfVal('nf-footer-html') });
  } else {
    nfSyncModel();
    await API.put('/nav-footer', { nav: _nfModel.nav, footer: _nfModel.footer });
  }
}

async function saveNavFooter() {
  try {
    await nfPersist();
    // refresh the HTML-tab cache from the freshly generated server output
    const d = await API.get('/nav-footer');
    _nfHtml = { navHtml: d.navHtml || '', footerHtml: d.footerHtml || '' };
    renderNavFooterHtmlTab();
    clearDirty();
    toast('Kaydedildi. Siteye uygulamak için "Tüm Sayfalara Uygula" butonunu kullanın.');
  } catch (err) { toast(err.message, 'error'); }
}

async function previewNavFooter() {
  try {
    await nfPersist();
    clearDirty();
    const d = await API.get('/nav-footer');
    _nfHtml = { navHtml: d.navHtml || '', footerHtml: d.footerHtml || '' };
    if (_nfTab === 'html') renderNavFooterHtmlTab();
    const win = window.open('', '_blank');
    if (!win) { toast('Popup engellendi — tarayıcı ayarlarını kontrol edin', 'error'); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Menü & Footer Önizleme</title>
      <script src="https://cdn.tailwindcss.com"><\/script>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f9fafb}.preview-note{padding:10px 20px;background:#fef3c7;color:#92400e;font-size:13px;border-bottom:1px solid #fde68a}</style>
      </head><body>
      <div class="preview-note">⚠️ Önizleme — Tailwind CDN ile gösterilir; gerçek sitede ek stiller olabilir.</div>
      ${d.navHtml || ''}
      <div style="min-height:45vh;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:14px">(sayfa içeriği burada görünür)</div>
      ${d.footerHtml || ''}
      </body></html>`);
    win.document.close();
  } catch (err) { toast(err.message, 'error'); }
}

async function resetNavFooterFromSource() {
  const ok = await confirmAction('Form, sitenin varsayılan menü ve footer içeriğine sıfırlanacak. Kaydedilmemiş değişiklikleriniz kaybolur. Devam edilsin mi?');
  if (!ok) return;
  try {
    const data = await API.post('/nav-footer/reset');
    _nfModel = { nav: data.nav, footer: data.footer };
    _nfHtml = { navHtml: data.navHtml || '', footerHtml: data.footerHtml || '' };
    renderNavFooterForm();
    renderNavFooterHtmlTab();
    clearDirty();
    toast('Varsayılan içeriğe sıfırlandı');
  } catch (err) { toast(err.message, 'error'); }
}

async function syncNavFooter() {
  const ok = await confirmAction('Menü ve footer 16+ statik sayfaya yazılacak ve mevcut bloklarının yerini alacak. Otomatik yedek alınır. Devam edilsin mi?');
  if (!ok) return;
  try {
    await nfPersist();
    clearDirty();
  } catch (err) { toast('Kaydetme başarısız: ' + err.message, 'error'); return; }
  try {
    const result = await API.post('/nav-footer/sync');
    const updated = result.results.filter(r => r.status === 'updated');
    const unchanged = result.results.filter(r => r.status === 'unchanged');
    const skipped = result.results.filter(r => r.status === 'skipped');
    const errors = result.results.filter(r => r.status === 'error');

    const rowHtml = (r) => {
      const color = r.status === 'updated' ? '#15803d' : r.status === 'error' ? '#b91c1c' : r.status === 'skipped' ? '#92400e' : 'var(--text-muted)';
      const label = r.status === 'updated' ? 'Güncellendi' : r.status === 'unchanged' ? 'Değişiklik yok' : r.status === 'skipped' ? 'Atlandı' : 'Hata';
      return `<tr style="border-top:1px solid var(--border-soft)"><td class="px-3 py-1.5 font-mono text-xs" style="color:var(--text)">${esc(r.file)}</td><td class="px-3 py-1.5 text-xs font-medium" style="color:${color}">${label}${r.reason ? ` — ${esc(r.reason)}` : ''}</td></tr>`;
    };

    const summary = `
      <div class="flex items-center gap-3 mb-4 pb-3" style="border-bottom:1px solid var(--border-soft)">
        ${updated.length ? `<span class="badge" style="background:#dcfce7;color:#15803d">${updated.length} güncellendi</span>` : ''}
        ${unchanged.length ? `<span class="badge bg-gray-100 text-gray-600">${unchanged.length} değişmedi</span>` : ''}
        ${skipped.length ? `<span class="badge" style="background:#fef3c7;color:#92400e">${skipped.length} atlandı</span>` : ''}
        ${errors.length ? `<span class="badge" style="background:#fee2e2;color:#b91c1c">${errors.length} hata</span>` : ''}
      </div>
      <div style="max-height:360px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:var(--radius-md)">
        <table class="w-full text-sm">
          <thead style="background:var(--bg-subtle);position:sticky;top:0">
            <tr>
              <th class="text-left px-3 py-2 font-medium" style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.04em">Dosya</th>
              <th class="text-left px-3 py-2 font-medium" style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.04em">Durum</th>
            </tr>
          </thead>
          <tbody>${result.results.map(rowHtml).join('')}</tbody>
        </table>
      </div>
      <p class="text-xs mt-3" style="color:var(--text-muted)">Yedek otomatik alındı: <code>admin/backups/</code> dizinine bakabilirsiniz.</p>
    `;
    await modal(`Senkronizasyon Sonucu`, summary, [{ label: 'Tamam', value: 'ok', class: 'btn-primary' }]);
    toast(`${updated.length} sayfa güncellendi${errors.length ? `, ${errors.length} hata` : ''}`);
  } catch (err) { toast(err.message, 'error'); }
}

// Article Statistics
route('/article-stats', async (el) => {
  const data = await API.get('/stats/top-articles?limit=20');
  const t = data.totals;

  function statTable(rows, highlightCol) {
    if (!rows.length) return '<p class="text-sm text-gray-500 py-4">Henüz veri bulunmuyor.</p>';
    return `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50"><tr>
            <th class="text-left px-4 py-2.5 font-medium text-gray-500 w-10">#</th>
            <th class="text-left px-4 py-2.5 font-medium text-gray-500">Makale</th>
            <th class="text-right px-4 py-2.5 font-medium text-gray-500">Görüntülenme</th>
            <th class="text-right px-4 py-2.5 font-medium text-gray-500">İndirme</th>
            <th class="text-right px-4 py-2.5 font-medium text-gray-500">Atıf</th>
          </tr></thead>
          <tbody>${rows.map((a, i) => `
            <tr class="cursor-pointer" onclick="navigate('#/articles/${a.id}')">
              <td class="px-4 py-2.5 text-gray-400">${i + 1}</td>
              <td class="px-4 py-2.5">
                <div class="font-medium text-gray-900 line-clamp-2">${esc(a.title)}</div>
                <div class="text-xs text-gray-400 mt-0.5">${esc(a.type || '')}${a.volume ? ' · Vol ' + a.volume : ''}${a.issue ? ', Issue ' + esc(a.issue) : ''}</div>
              </td>
              <td class="px-4 py-2.5 text-right tabular-nums ${highlightCol === 'views' ? 'font-bold text-teal-700' : 'text-gray-600'}">${(a.views || 0).toLocaleString()}</td>
              <td class="px-4 py-2.5 text-right tabular-nums ${highlightCol === 'downloads' ? 'font-bold text-slate-700' : 'text-gray-600'}">${(a.downloads || 0).toLocaleString()}</td>
              <td class="px-4 py-2.5 text-right tabular-nums ${highlightCol === 'citations' ? 'font-bold text-slate-700' : 'text-gray-600'}">${(a.citations || 0).toLocaleString()}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Makale İstatistikleri</h1>
      <button onclick="showMetricEditor()" class="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 text-sm font-medium">Metrik Düzenle</button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="card card-padded">
        <div class="text-3xl font-bold text-gray-800">${t.articles.toLocaleString()}</div>
        <div class="text-sm text-gray-500 mt-1">Toplam Makale</div>
      </div>
      <div class="card card-padded">
        <div class="text-3xl font-bold text-teal-700">${t.views.toLocaleString()}</div>
        <div class="text-sm text-gray-500 mt-1">Toplam Görüntülenme</div>
      </div>
      <div class="card card-padded">
        <div class="text-3xl font-bold text-slate-600">${t.downloads.toLocaleString()}</div>
        <div class="text-sm text-gray-500 mt-1">Toplam İndirme</div>
      </div>
      <div class="card card-padded">
        <div class="text-3xl font-bold text-slate-600">${t.citations.toLocaleString()}</div>
        <div class="text-sm text-gray-500 mt-1">Toplam Atıf</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="card overflow-hidden">
      <div class="flex border-b">
        <button class="stat-tab-btn px-5 py-3 text-sm font-medium border-b-2 border-teal-600 text-teal-700" data-stab="viewed">En Çok Görüntülenen</button>
        <button class="stat-tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-stab="downloaded">En Çok İndirilen</button>
        <button class="stat-tab-btn px-5 py-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-stab="cited">En Çok Atıf Alan</button>
      </div>
      <div class="stat-tab-panel" data-stab="viewed">${statTable(data.topViewed, 'views')}</div>
      <div class="stat-tab-panel hidden" data-stab="downloaded">${statTable(data.topDownloaded, 'downloads')}</div>
      <div class="stat-tab-panel hidden" data-stab="cited">${statTable(data.topCited, 'citations')}</div>
    </div>`;

  // Tab switching
  el.querySelectorAll('.stat-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.stat-tab-btn').forEach((b) => { b.classList.remove('border-teal-600', 'text-teal-700'); b.classList.add('border-transparent', 'text-gray-500'); });
      btn.classList.remove('border-transparent', 'text-gray-500'); btn.classList.add('border-teal-600', 'text-teal-700');
      el.querySelectorAll('.stat-tab-panel').forEach((p) => p.classList.add('hidden'));
      el.querySelector(`.stat-tab-panel[data-stab="${btn.dataset.stab}"]`).classList.remove('hidden');
    });
  });
});

// Metric editor modal — search for an article and edit its views/downloads/citations
async function showMetricEditor() {
  const result = await modal('Metrik Düzenle', `
    <div class="space-y-4">
      <div>
        <label class="label">Makale Ara (ID veya başlık)</label>
        <input id="me-search" type="text" placeholder="Makale ID veya başlığının bir kısmı..." class="input">
      </div>
      <div id="me-results" class="max-h-48 overflow-y-auto border rounded-lg hidden"></div>
      <div id="me-fields" class="hidden space-y-3">
        <div class="text-sm font-medium text-gray-900" id="me-title"></div>
        <input type="hidden" id="me-id">
        <div class="grid grid-cols-3 gap-3">
          <div><label class="block text-xs font-medium text-gray-600 mb-1">Görüntülenme</label><input id="me-views" type="number" min="0" class="input"></div>
          <div><label class="block text-xs font-medium text-gray-600 mb-1">İndirme</label><input id="me-downloads" type="number" min="0" class="input"></div>
          <div><label class="block text-xs font-medium text-gray-600 mb-1">Atıf</label><input id="me-citations" type="number" min="0" class="input"></div>
        </div>
      </div>
    </div>`, [{ label: 'Kaydet', action: 'save' }]);

  if (result === 'save') {
    const id = document.getElementById('me-id')?.value;
    if (!id) { toast('Makale seçilmedi', 'error'); return; }
    try {
      await API.put(`/articles/${id}/metrics`, {
        views: parseInt(document.getElementById('me-views').value) || 0,
        downloads: parseInt(document.getElementById('me-downloads').value) || 0,
        citations: parseInt(document.getElementById('me-citations').value) || 0,
      });
      toast('Metrikler güncellendi');
      handleRoute(); // refresh the page
    } catch (err) { toast(err.message, 'error'); }
  }
}

// Wire up the metric editor search after modal renders
const _meSearchObserver = new MutationObserver(() => {
  const searchInput = document.getElementById('me-search');
  if (!searchInput) return;
  let allArticles = null;
  searchInput.addEventListener('input', debounce(async () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) { document.getElementById('me-results').classList.add('hidden'); return; }
    if (!allArticles) {
      try { const d = await API.get('/articles?page=1&limit=9999'); allArticles = d.articles || d; } catch { allArticles = []; }
    }
    const matches = allArticles.filter((a) => {
      if (String(a.id) === query) return true;
      return (a.title || '').toLowerCase().includes(query);
    }).slice(0, 10);
    const resultsEl = document.getElementById('me-results');
    if (!matches.length) { resultsEl.innerHTML = '<div class="p-3 text-sm text-gray-500">Sonuç bulunamadı.</div>'; resultsEl.classList.remove('hidden'); return; }
    resultsEl.innerHTML = matches.map((a) => `
      <div class="px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-0 text-sm" onclick="selectMetricArticle(${a.id}, '${esc(a.title).replace(/'/g, "\\'")}', ${a.views || 0}, ${a.downloads || 0}, ${a.citations || 0})">
        <span class="text-gray-400 mr-1">#${a.id}</span> ${esc(a.title)}
      </div>`).join('');
    resultsEl.classList.remove('hidden');
  }, 300));
});
_meSearchObserver.observe(document.body, { childList: true, subtree: true });

function selectMetricArticle(id, title, views, downloads, citations) {
  document.getElementById('me-id').value = id;
  document.getElementById('me-title').textContent = '#' + id + ' — ' + title;
  document.getElementById('me-views').value = views;
  document.getElementById('me-downloads').value = downloads;
  document.getElementById('me-citations').value = citations;
  document.getElementById('me-fields').classList.remove('hidden');
  document.getElementById('me-results').classList.add('hidden');
}

// Social Media — platform catalog is fetched from the server so adding a new
// platform in social-media-sync.js automatically appears here.
let SOCIAL_PLATFORMS = [];

function smIconHtml(platform, sizePx = 18) {
  return `<svg width="${sizePx}" height="${sizePx}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${platform.svgPath}"/></svg>`;
}

function smValidateUrl(url) {
  if (!url) return { ok: true, empty: true };
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Yalnızca http:// veya https:// destekleniyor' };
    return { ok: true };
  } catch { return { ok: false, reason: 'Geçersiz URL' }; }
}

function smRenderPreview() {
  const previewEl = document.getElementById('sm-preview');
  if (!previewEl) return;
  const used = SOCIAL_PLATFORMS.filter(p => {
    const v = (document.getElementById(`sm-${p.key}`)?.value || '').trim();
    return v && smValidateUrl(v).ok;
  });
  if (!used.length) {
    previewEl.innerHTML = '<span class="text-xs italic" style="color:rgba(255,255,255,0.5)">Henüz hiçbir bağlantı eklenmedi</span>';
    return;
  }
  previewEl.innerHTML = used.map(p => `
    <a href="#" onclick="return false" aria-label="${esc(p.label)}" class="transition-colors" style="color:#5eead4" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#5eead4'" title="${esc(p.label)}">
      ${smIconHtml(p, 20)}
    </a>
  `).join('');
}

function smRefreshRow(key) {
  const input = document.getElementById(`sm-${key}`);
  const status = document.getElementById(`sm-${key}-status`);
  if (!input || !status) return;
  const v = input.value.trim();
  const res = smValidateUrl(v);
  if (!v) {
    status.innerHTML = '<span class="text-xs" style="color:var(--text-muted)">— footer\'dan kaldırılır</span>';
  } else if (!res.ok) {
    status.innerHTML = `<span class="text-xs" style="color:#b91c1c">⚠ ${esc(res.reason)}</span>`;
  } else {
    status.innerHTML = '<span class="text-xs" style="color:#15803d">✓ Geçerli</span>';
  }
  smRenderPreview();
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANASAYFA BÖLÜMLERİ — Latest Published / Articles in Press / Top Cited /
//  Most Downloaded. Her bölüm sitede otomatik hesaplanır; burada bir bölümü
//  "Manuel"e alıp hangi makalelerin hangi sırada görüneceğini tam kontrol
//  edebilirsiniz. HOMEPAGE_DATA.sections'a kaydedilir; homepage.js uygular.
// ═══════════════════════════════════════════════════════════════════════════
const _HS_META = {
  'latest-published': { label: 'Latest Published', desc: 'Geçerli sayıdan yeni yayımlanan makaleler (yayın tarihine göre).', pool: 'articles' },
  'articles-in-press': { label: 'Articles in Press', desc: 'e-Pub (baskıda) makaleler (sıra numarasına göre).', pool: 'aip' },
  'top-cited': { label: 'Top Cited', desc: 'Son 24 ayın en çok atıf alan makaleleri.', pool: 'articles' },
  'most-downloaded': { label: 'Most Downloaded', desc: 'Son 24 ayın en çok indirilen makaleleri.', pool: 'articles' },
  'image-corner': { label: 'Image Corner', desc: 'Son 24 ayın en çok atıflı “Clinical Image” makaleleri (otomatikte 2 adet).', pool: 'articles' },
  'latest-news': { label: 'Latest News', desc: 'En yeni haberler (tarihe göre; otomatikte 3 adet).', pool: 'news' },
};
let _hsState = null;

route('/homepage-sections', async (el) => {
  el.innerHTML = '<div class="page-header"><h1 class="page-title">Anasayfa Bölümleri</h1></div><p class="text-sm text-gray-500">Yükleniyor…</p>';
  let data;
  try { data = await API.get('/homepage/sections'); }
  catch (e) { el.innerHTML = `<div class="page-header"><h1 class="page-title">Anasayfa Bölümleri</h1></div><p class="text-sm" style="color:#b91c1c">Yüklenemedi: ${esc(e.message)}</p>`; return; }
  const lut = { articles: {}, aip: {}, news: {} };
  (data.candidates.articles || []).forEach((a) => { lut.articles[String(a.id)] = a; });
  (data.candidates.aip || []).forEach((a) => { lut.aip[String(a.id)] = a; });
  (data.candidates.news || []).forEach((a) => { lut.news[String(a.id)] = a; });
  const mode = {}; const ids = {};
  Object.keys(_HS_META).forEach((k) => {
    const cur = data.sections[k];
    mode[k] = (Array.isArray(cur) && cur.length) ? 'manual' : 'auto';
    ids[k] = (Array.isArray(cur) ? cur.slice() : []).map(String);
  });
  _hsState = { data, lut, mode, ids, el };
  _hsRender();
});

function _hsRender() {
  const { el } = _hsState;
  el.innerHTML = `
    <div class="page-header">
      <div class="min-w-0">
        <h1 class="page-title">Anasayfa Bölümleri</h1>
        <p class="page-subtitle">Anasayfadaki makale sekmeleri, Image Corner ve Latest News bölümlerini buradan görüntüleyin ve yönetin. <strong>Otomatik</strong>: site metriklere/tarihe göre kendisi seçer. <strong>Manuel</strong>: içeriği siz seçip sıralarsınız (sürükle-bırak veya ▲▼).</p>
      </div>
      <div class="flex gap-2">
        <button onclick="navigate('#/homepage-sections')" class="btn btn-secondary text-sm" title="Sunucudan yeniden yükle (kaydedilmemiş değişiklikler gider)">Yenile</button>
        <button onclick="saveHomepageSections()" class="btn btn-primary text-sm">Kaydet</button>
      </div>
    </div>
    <div class="space-y-4">${Object.keys(_HS_META).map(_hsCard).join('')}</div>`;
}

function _hsCard(key) {
  const { mode, ids, data, lut } = _hsState;
  const meta = _HS_META[key];
  const isManual = mode[key] === 'manual';
  const poolLut = lut[meta.pool];
  const list = isManual
    ? ids[key].map((id) => poolLut[String(id)]).filter(Boolean)
    : (data.auto[key] || []);
  const rows = list.map((a, i) => _hsArticleRow(key, a, i, isManual, list.length)).join('');
  const seg = (m, label) => `<button onclick="hsSetMode('${key}','${m}')" class="px-3 py-1.5 rounded-md ${(mode[key] === m) ? 'bg-white shadow-sm text-teal-700' : 'text-gray-500'}">${label}</button>`;
  return `
    <div class="card card-padded">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="min-w-0">
          <h2 class="text-base font-semibold" style="color:var(--text-strong)">${esc(meta.label)} <span style="color:var(--text-faint);font-weight:400;font-size:13px">(${list.length})</span></h2>
          <p class="text-xs" style="color:var(--text-muted)">${esc(meta.desc)}</p>
        </div>
        <div class="inline-flex items-center bg-gray-100 rounded-lg p-0.5 text-xs font-medium flex-shrink-0">${seg('auto', 'Otomatik')}${seg('manual', 'Manuel')}</div>
      </div>
      ${isManual ? '' : `<p class="text-xs mb-2" style="color:var(--text-faint)">⚙ Otomatik — yeni sayı, e-Pub listesi ve metrik değişiklikleri kendiliğinden uygulanır.${key === 'top-cited' || key === 'most-downloaded' ? ' Canlı site güncel dış metrikleri aldığı için sıralama bu saklı veri önizlemesinden farklılaşabilir.' : ''} Değiştirmek için “Manuel”e geçin.</p>`}
      <div class="border rounded-lg overflow-hidden" style="border-color:var(--border-soft)">
        ${rows || '<p class="text-xs px-4 py-3" style="color:var(--text-faint)">Bu bölümde gösterilecek makale yok.</p>'}
      </div>
      ${isManual ? _hsAddBox(key) : ''}
    </div>`;
}

function _hsArticleRow(key, a, i, isManual, total) {
  const isNews = _HS_META[key].pool === 'news';
  const auth = isNews
    ? [a.category, a.date].filter(Boolean).join(' · ')
    : ((a.authors || []).slice(0, 3).join(', ') + (((a.authors || []).length > 3) ? ' ve diğerleri' : ''));
  const metric = isNews ? ''
    : key === 'top-cited' ? (a.citations + ' atıf')
      : key === 'most-downloaded' ? (a.downloads + ' indirme')
        : (a.volume ? ('C' + a.volume + (a.issue ? ' S' + a.issue : '')) : '');
  const grip = isManual ? `<span class="row-grip" title="Sürükleyerek sırala" aria-label="Sürükle" onmousedown="this.closest('.hs-row').setAttribute('draggable','true')">${ROW_GRIP_SVG}</span>` : '';
  return `
    <div class="flex items-center gap-2 px-3 py-2 ${i > 0 ? 'border-t' : ''}${isManual ? ' hs-row' : ''}"${isManual ? ` data-hs-key="${esc(key)}" data-hs-idx="${i}"` : ''} style="border-color:var(--border-soft)">
      ${grip}
      <span class="text-xs font-semibold" style="min-width:18px;color:var(--text-faint)">${i + 1}</span>
      ${isManual ? `<span class="inline-flex flex-col leading-none">
        <button onclick="hsMove('${key}',${i},-1)" ${i === 0 ? 'disabled' : ''} class="text-[10px] disabled:opacity-30" title="Yukarı">▲</button>
        <button onclick="hsMove('${key}',${i},1)" ${i === total - 1 ? 'disabled' : ''} class="text-[10px] disabled:opacity-30" title="Aşağı">▼</button>
      </span>` : ''}
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium truncate" style="color:var(--text-strong)" title="${esc(a.title)}">${esc(a.title)}</div>
        <div class="text-[11px] truncate" style="color:var(--text-faint)">${esc(auth)}${metric ? ' · ' + esc(metric) : ''}${a.id != null ? ' · #' + esc(String(a.id)) : ''}</div>
      </div>
      ${isManual ? `<button onclick="hsRemove('${key}',${i})" class="text-xs px-2 py-1 rounded hover:bg-red-50" style="color:#b91c1c" title="Listeden çıkar">✕</button>` : ''}
    </div>`;
}

function _hsAddBox(key) {
  const full = _hsState.ids[key].length >= 6;
  if (full) return '<p class="text-xs mt-2" style="color:#b45309">En fazla 6 makale gösterilir. Eklemek için önce birini çıkarın.</p>';
  const ph = _HS_META[key].pool === 'news'
    ? 'Haber ara (başlık, kategori veya ID)…'
    : 'Makale ara (başlık, yazar, DOI veya ID)…';
  return `
    <div class="mt-2">
      <input type="text" placeholder="${ph}" oninput="hsSearch('${key}', this.value)" class="input w-full text-sm" style="margin-bottom:6px">
      <div id="hs-results-${key}" class="border rounded-lg max-h-56 overflow-auto hidden" style="border-color:var(--border-soft)"></div>
    </div>`;
}

function hsSetMode(key, m) {
  if (!_hsState) return;
  _hsState.mode[key] = m;
  // First switch to manual with no curated list → seed from the current auto preview.
  if (m === 'manual' && !_hsState.ids[key].length) {
    _hsState.ids[key] = (_hsState.data.auto[key] || []).map((a) => String(a.id)).slice(0, 6);
  }
  _hsRender();
}
function hsMove(key, i, dir) {
  const arr = _hsState.ids[key]; const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  _hsRender();
}
function hsRemove(key, i) { _hsState.ids[key].splice(i, 1); _hsRender(); }
function hsSearch(key, q) {
  const meta = _HS_META[key];
  const pool = meta.pool === 'aip' ? (_hsState.data.candidates.aip || [])
    : meta.pool === 'news' ? (_hsState.data.candidates.news || [])
      : (_hsState.data.candidates.articles || []);
  const box = document.getElementById('hs-results-' + key);
  if (!box) return;
  q = (q || '').trim().toLowerCase();
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const have = new Set(_hsState.ids[key].map(String));
  const hay = (a) => [a.title, a.id, a.doi, (a.authors || []).join(' '), a.category, a.excerpt].filter(Boolean).join(' ').toLowerCase();
  const subOf = (a) => meta.pool === 'news'
    ? [a.category, a.date].filter(Boolean).join(' · ')
    : [(a.authors || []).slice(0, 3).join(', '), a.doi].filter(Boolean).join(' · ');
  const matches = pool.filter((a) => !have.has(String(a.id)) && hay(a).includes(q)).slice(0, 12);
  box.classList.remove('hidden');
  box.innerHTML = matches.length ? matches.map((a) => `
    <button onclick="hsAdd('${key}','${esc(String(a.id))}')" class="block w-full text-left px-3 py-2 hover:bg-teal-50" style="border-bottom:1px solid var(--border-soft)">
      <div class="text-xs font-medium truncate" style="color:var(--text-strong)">${esc(a.title)}</div>
      <div class="text-[11px] truncate" style="color:var(--text-faint)">${esc(subOf(a))} · #${esc(String(a.id))}</div>
    </button>`).join('') : '<p class="text-xs px-3 py-2" style="color:var(--text-faint)">Eşleşme yok.</p>';
}
function hsAdd(key, id) {
  if (_hsState.ids[key].length >= 6) { toast('En fazla 6 makale gösterilir', 'warning'); return; }
  if (!_hsState.ids[key].map(String).includes(String(id))) _hsState.ids[key].push(String(id));
  _hsRender();
}
async function saveHomepageSections() {
  if (!_hsState) return;
  const sections = {};
  Object.keys(_HS_META).forEach((k) => {
    sections[k] = _hsState.mode[k] === 'manual'
      ? _hsState.ids[k].map((x) => (x !== '' && !isNaN(Number(x))) ? Number(x) : x)
      : [];
  });
  try {
    await API.put('/homepage/sections', { sections });
    // reflect saved state (manual sections keep their ids; auto cleared)
    Object.keys(_HS_META).forEach((k) => { if (_hsState.mode[k] !== 'manual') _hsState.ids[k] = []; });
    toast('Anasayfa bölümleri kaydedildi. Canlı sitede yansıyacak (gerekirse sayfayı yenileyin).');
  } catch (e) { toast('Kaydedilemedi: ' + e.message, 'error'); }
}

// Drag-drop reorder for a homepage-section manual list (mutate _hsState.ids + re-render).
function _hsReorderByDrop(srcRow, targetRow, above) {
  const key = srcRow.getAttribute('data-hs-key');
  if (!_hsState || !key || !Array.isArray(_hsState.ids[key])) return;
  const arr = _hsState.ids[key];
  const from = Number(srcRow.getAttribute('data-hs-idx'));
  let target = Number(targetRow.getAttribute('data-hs-idx'));
  if (isNaN(from) || isNaN(target) || from === target) return;
  const item = arr.splice(from, 1)[0];
  if (from < target) target -= 1;                 // removal shifted target left
  const insertAt = above ? target : target + 1;
  arr.splice(Math.max(0, Math.min(insertAt, arr.length)), 0, item);
  _hsRender();
}

const _HP_POPUP_TYPE_META = {
  announcement: { label: 'Duyuru', desc: 'Metin, görsel ve buton içeren duyuru pop-up\'ı.' },
  video: { label: 'Video', desc: 'Sunucuya yüklenen video dosyasını oynatır.' },
  embed: { label: 'Embed Video', desc: 'YouTube veya Vimeo bağlantısını gömer.' },
};
let _hpPopupState = null;

function _hpPopupDefaultItem(type = 'announcement') {
  return {
    id: 'popup-item-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    active: true,
    type,
    badge: '',
    title: '',
    body: '',
    imageUrl: '',
    videoUrl: '',
    posterUrl: '',
    embedUrl: '',
    buttonText: '',
    buttonUrl: '',
    openInNewTab: true,
    startsAt: '',
    endsAt: '',
  };
}

function _hpPopupNormalize(data) {
  const safe = data && typeof data === 'object' ? data : {};
  return {
    enabled: !!safe.enabled,
    delayMs: Number.isFinite(Number(safe.delayMs)) ? Number(safe.delayMs) : 700,
    frequency: ['always', 'session', 'cooldown'].includes(String(safe.frequency || '')) ? String(safe.frequency) : 'session',
    dismissHours: Number.isFinite(Number(safe.dismissHours)) ? Number(safe.dismissHours) : 24,
    updatedAt: safe.updatedAt || '',
    items: Array.isArray(safe.items) ? safe.items.map((item) => ({
      ..._hpPopupDefaultItem(item && item.type),
      ...(item || {}),
    })) : [],
  };
}

function _hpPopupSafeUrl(value, allowRelative = true) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (allowRelative && !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('//')) return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function _hpPopupEmbedUrl(value) {
  const raw = _hpPopupSafeUrl(value, false);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : '';
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (parsed.pathname.startsWith('/embed/')) return parsed.href;
      const id = parsed.searchParams.get('v') || (parsed.pathname.startsWith('/shorts/') ? parsed.pathname.split('/')[2] : '');
      return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : '';
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      if (host === 'player.vimeo.com') return parsed.href;
      const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : '';
    }
  } catch {
    return '';
  }
  return '';
}

function _hpPopupItemHasContent(item) {
  if (!item) return false;
  if (item.type === 'video') return !!_hpPopupSafeUrl(item.videoUrl);
  if (item.type === 'embed') return !!_hpPopupEmbedUrl(item.embedUrl);
  return !!(String(item.title || '').trim() || String(item.body || '').trim() || _hpPopupSafeUrl(item.imageUrl));
}

function _hpPopupItemStatus(item) {
  if (item.active === false) return { label: 'Pasif', tone: 'neutral' };
  if (!_hpPopupItemHasContent(item)) return { label: 'Eksik içerik', tone: 'danger' };
  const start = item.startsAt ? new Date(item.startsAt).getTime() : 0;
  const end = item.endsAt ? new Date(item.endsAt).getTime() : 0;
  if ((item.startsAt && !start) || (item.endsAt && !end) || (start && end && end <= start)) {
    return { label: 'Tarih hatası', tone: 'danger' };
  }
  const now = Date.now();
  if (start && now < start) return { label: 'Planlandı', tone: 'info' };
  if (end && now > end) return { label: 'Süresi doldu', tone: 'warning' };
  return { label: 'Yayına hazır', tone: 'success' };
}

function _hpPopupStatusStyle(tone) {
  return {
    success: 'background:#ecfdf5;color:#047857',
    info: 'background:#eff6ff;color:#1d4ed8',
    warning: 'background:#fffbeb;color:#b45309',
    danger: 'background:#fef2f2;color:#b91c1c',
    neutral: 'background:var(--bg-subtle);color:var(--text-muted)',
  }[tone] || 'background:var(--bg-subtle);color:var(--text-muted)';
}

function _hpPopupValidation(data) {
  const errors = [];
  const warnings = [];
  const activeItems = (data.items || []).filter((item) => item.active !== false);

  (data.items || []).forEach((item, index) => {
    if (item.active === false) return;
    const label = `Pop-up ${index + 1}`;
    if (!_hpPopupItemHasContent(item)) {
      errors.push(`${label}: seçilen içerik türü için gerekli içerik veya medya eksik.`);
    }
    const start = item.startsAt ? new Date(item.startsAt).getTime() : 0;
    const end = item.endsAt ? new Date(item.endsAt).getTime() : 0;
    if ((item.startsAt && !start) || (item.endsAt && !end)) errors.push(`${label}: tarih formatı geçersiz.`);
    if (start && end && end <= start) errors.push(`${label}: bitiş tarihi başlangıç tarihinden sonra olmalı.`);
    if ((item.buttonText && !item.buttonUrl) || (!item.buttonText && item.buttonUrl)) {
      errors.push(`${label}: buton metni ve bağlantısı birlikte girilmeli.`);
    }
    if (item.buttonUrl && !_hpPopupSafeUrl(item.buttonUrl)) errors.push(`${label}: buton bağlantısı geçersiz.`);
    if (item.type === 'embed' && item.embedUrl && !_hpPopupEmbedUrl(item.embedUrl)) {
      errors.push(`${label}: yalnızca YouTube veya Vimeo bağlantısı kullanılabilir.`);
    }
  });

  if (data.enabled && !activeItems.length) errors.push('Pop-up aktifken en az bir aktif içerik gerekli.');
  const eligibleNow = activeItems.filter((item) => _hpPopupItemStatus(item).label === 'Yayına hazır');
  if (data.enabled && activeItems.length && !eligibleNow.length) {
    warnings.push('Şu anda gösterime uygun içerik yok; pop-up planlanan başlangıç tarihine kadar görünmeyecek.');
  }
  return { errors, warnings };
}

route('/homepage-popup', async (el) => {
  el.innerHTML = `${pageHeader({ title: 'Anasayfa Pop-up', subtitle: 'Yükleniyor…', eyebrow: 'Anasayfa' })}`;
  let data;
  try {
    const homepage = await API.get('/homepage');
    data = homepage && homepage.popup;
  }
  catch (e) {
    el.innerHTML = `${pageHeader({ title: 'Anasayfa Pop-up', subtitle: 'Veri okunamadı', eyebrow: 'Anasayfa' })}<div class="card card-padded" style="border-color:#fecaca;background:#fef2f2;color:#b91c1c">${esc(e.message)}</div>`;
    return;
  }
  _hpPopupState = { el, data: _hpPopupNormalize(data) };
  clearDirty();
  renderHomepagePopupAdmin();
});

function renderHomepagePopupAdmin() {
  if (!_hpPopupState) return;
  const { el, data } = _hpPopupState;
  const items = data.items || [];
  const freqLabel = data.frequency === 'always'
    ? 'Her açılışta göster'
    : data.frequency === 'cooldown'
      ? `${data.dismissHours} saat gizle`
      : 'Oturum başına bir kez göster';

  el.innerHTML = `
    ${pageHeader({
      eyebrow: 'Anasayfa',
      title: 'Anasayfa Pop-up',
      subtitle: `Ana sayfadaki duyuru ve video pop-up'ını yönetin. Durum: <strong>${data.enabled ? 'aktif' : 'pasif'}</strong>. Gösterim kuralı: <strong>${esc(freqLabel)}</strong>.`,
      actions: `
        <button onclick="navigate('#/homepage-popup')" class="btn btn-secondary text-sm">Yenile</button>
        <button onclick="previewHomepagePopupAdmin()" class="btn btn-secondary text-sm">Önizle</button>
        <button onclick="saveHomepagePopupAdmin()" class="btn btn-primary text-sm">Kaydet</button>
      `,
    })}

    <div class="grid gap-5" style="grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr)">
      <div class="space-y-5">
        <div class="card card-padded">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 class="text-base font-semibold" style="color:var(--text-strong)">Genel Ayarlar</h2>
              <p class="text-xs mt-1" style="color:var(--text-muted)">Açılış gecikmesi ve tekrar gösterim davranışı.</p>
            </div>
            <label class="inline-flex items-center gap-2 text-sm font-medium" style="color:var(--text-strong)">
              <input type="checkbox" ${data.enabled ? 'checked' : ''} onchange="setHomepagePopupGlobal('enabled', this.checked, true)">
              Aktif
            </label>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="text-xs font-medium" style="color:var(--text-muted)">Açılış gecikmesi (ms)</span>
              <input type="number" min="0" max="10000" value="${esc(String(data.delayMs))}" oninput="setHomepagePopupGlobal('delayMs', this.value)" class="input w-full mt-1">
            </label>
            <label class="block">
              <span class="text-xs font-medium" style="color:var(--text-muted)">Tekrar gösterim</span>
              <select onchange="setHomepagePopupGlobal('frequency', this.value, true)" class="input w-full mt-1">
                <option value="session" ${data.frequency === 'session' ? 'selected' : ''}>Oturum başına bir kez</option>
                <option value="always" ${data.frequency === 'always' ? 'selected' : ''}>Her açılışta</option>
                <option value="cooldown" ${data.frequency === 'cooldown' ? 'selected' : ''}>Belirli süre gizle</option>
              </select>
            </label>
            ${data.frequency === 'cooldown' ? `
              <label class="block sm:col-span-2">
                <span class="text-xs font-medium" style="color:var(--text-muted)">Tekrar gösterme süresi (saat)</span>
                <input type="number" min="1" max="720" value="${esc(String(data.dismissHours))}" oninput="setHomepagePopupGlobal('dismissHours', this.value)" class="input w-full mt-1">
              </label>` : ''}
          </div>
          <div class="mt-4 text-xs" style="color:var(--text-faint)">Kaydetme sonrası yeni sürüm oluşur; daha önce kapatmış kullanıcıya tekrar gösterilir.</div>
        </div>

        <div class="card card-padded">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 class="text-base font-semibold" style="color:var(--text-strong)">Pop-up Listesi</h2>
              <p class="text-xs mt-1" style="color:var(--text-muted)">Birden fazla aktif pop-up, ziyaretçiye belirlediğiniz sırayla tek bir akış içinde gösterilir.</p>
            </div>
            <button onclick="addHomepagePopupItem()" class="btn btn-primary text-sm">+ Yeni Pop-up Ekle</button>
          </div>
          <div class="space-y-4">
            ${items.length ? items.map((item, idx) => renderHomepagePopupItem(item, idx, items.length)).join('') : `
              <div class="rounded-xl border border-dashed p-7 text-center" style="border-color:var(--border-soft);background:var(--bg-subtle)">
                <div class="text-sm font-semibold" style="color:var(--text-strong)">Henüz pop-up eklenmedi</div>
                <p class="text-xs mt-1 mb-4" style="color:var(--text-muted)">Duyuru, görsel veya video içeren ilk pop-up'ı oluşturun.</p>
                <button onclick="addHomepagePopupItem()" class="btn btn-primary text-sm">+ Yeni Pop-up Ekle</button>
              </div>`}
          </div>
        </div>
      </div>

      <div class="space-y-5">
        <div class="card card-padded">
          <h2 class="text-base font-semibold mb-3" style="color:var(--text-strong)">Özet</h2>
          <div class="space-y-2 text-sm">
            <div class="flex items-center justify-between gap-3"><span style="color:var(--text-muted)">Durum</span><strong style="color:var(--text-strong)">${data.enabled ? 'Aktif' : 'Pasif'}</strong></div>
            <div class="flex items-center justify-between gap-3"><span style="color:var(--text-muted)">Toplam pop-up</span><strong style="color:var(--text-strong)">${items.length}</strong></div>
            <div class="flex items-center justify-between gap-3"><span style="color:var(--text-muted)">Aktif pop-up</span><strong style="color:var(--text-strong)">${items.filter((item) => item.active !== false).length}</strong></div>
            <div class="flex items-center justify-between gap-3"><span style="color:var(--text-muted)">Son kaydetme</span><strong style="color:var(--text-strong)">${data.updatedAt ? esc(new Date(data.updatedAt).toLocaleString('tr-TR')) : 'Henüz yok'}</strong></div>
          </div>
        </div>

        <div class="card card-padded">
          <h2 class="text-base font-semibold mb-3" style="color:var(--text-strong)">Notlar</h2>
          <div class="space-y-3 text-sm" style="color:var(--text-muted);line-height:1.6">
            <p>Başlık, metin ve görsel alanları opsiyoneldir. Pop-up yalnız görselden veya yalnız metinden oluşabilir.</p>
            <p>Yalnız görsel kullanıldığında görsel kırpılmaz; kendi en-boy oranı korunarak gösterilir.</p>
            <p>Video tipi için yerel dosya yükleyin. Embed tipi için YouTube veya Vimeo bağlantısı kullanın.</p>
            <p>Başlangıç ve bitiş tarihlerini boş bırakırsanız öğe sürekli yayında kalır.</p>
          </div>
        </div>
      </div>
    </div>`;
}

function renderHomepagePopupItem(item, idx, total) {
  const meta = _HP_POPUP_TYPE_META[item.type] || _HP_POPUP_TYPE_META.announcement;
  const status = _hpPopupItemStatus(item);
  const displayTitle = String(item.title || '').trim() || `Pop-up ${idx + 1}`;
  const mediaPreview = item.type === 'video' && item.videoUrl
    ? `<video src="${esc(item.videoUrl)}" controls preload="metadata" ${item.posterUrl ? `poster="${esc(item.posterUrl)}"` : ''} class="w-full rounded-lg border mt-2" style="border-color:var(--border-soft);max-height:220px;background:#0f172a"></video>`
    : item.type === 'embed' && item.embedUrl
      ? `<div class="mt-2 rounded-lg border px-3 py-2 text-xs" style="border-color:var(--border-soft);color:var(--text-faint)">Embed URL: ${esc(item.embedUrl)}</div>`
      : item.imageUrl
        ? `<img src="${esc(item.imageUrl)}" alt="" class="mt-2 rounded-lg border" style="border-color:var(--border-soft);max-height:220px;object-fit:cover">`
        : '';

  return `
    <div class="rounded-xl border p-4" data-homepage-popup-card="${idx}" style="border-color:var(--border-soft)">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div>
          <div class="text-xs font-semibold uppercase tracking-wide" style="color:var(--text-faint)">Gösterim sırası ${idx + 1}</div>
          <h3 class="text-sm font-semibold mt-1" style="color:var(--text-strong)">${esc(displayTitle)}</h3>
          <p class="text-xs mt-1" style="color:var(--text-muted)">${esc(meta.label)} · ${esc(meta.desc)}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 justify-end">
          <span data-popup-item-status="${idx}" class="text-xs font-semibold px-2 py-1 rounded-full" style="${_hpPopupStatusStyle(status.tone)}">${esc(status.label)}</span>
          <label class="inline-flex items-center gap-1.5 text-xs" style="color:var(--text-muted)">
            <input type="checkbox" ${item.active !== false ? 'checked' : ''} onchange="setHomepagePopupItem(${idx}, 'active', this.checked)">
            Aktif
          </label>
          <button onclick="previewHomepagePopupAdmin(${idx})" class="btn btn-secondary text-xs">Önizle</button>
          <button onclick="duplicateHomepagePopupItem(${idx})" class="btn btn-secondary text-xs">Kopyala</button>
          <button onclick="moveHomepagePopupItem(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} class="btn btn-secondary text-xs disabled:opacity-40">▲</button>
          <button onclick="moveHomepagePopupItem(${idx}, 1)" ${idx === total - 1 ? 'disabled' : ''} class="btn btn-secondary text-xs disabled:opacity-40">▼</button>
          <button onclick="removeHomepagePopupItem(${idx})" class="btn btn-secondary text-xs" style="color:#b91c1c">Sil</button>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Tür</span>
          <select onchange="setHomepagePopupItem(${idx}, 'type', this.value, true)" class="input w-full mt-1">
            <option value="announcement" ${item.type === 'announcement' ? 'selected' : ''}>Duyuru</option>
            <option value="video" ${item.type === 'video' ? 'selected' : ''}>Video</option>
            <option value="embed" ${item.type === 'embed' ? 'selected' : ''}>Embed Video</option>
          </select>
        </label>
        <label class="block">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Üst etiket <span style="color:var(--text-faint)">(opsiyonel)</span></span>
          <input type="text" value="${esc(item.badge || '')}" oninput="setHomepagePopupItem(${idx}, 'badge', this.value)" class="input w-full mt-1" placeholder="Örn. Webinar">
        </label>
        <label class="block sm:col-span-2">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Başlık <span style="color:var(--text-faint)">(opsiyonel)</span></span>
          <input type="text" value="${esc(item.title || '')}" oninput="setHomepagePopupItem(${idx}, 'title', this.value)" class="input w-full mt-1" placeholder="Pop-up başlığı">
        </label>
        <label class="block sm:col-span-2">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Metin <span style="color:var(--text-faint)">(opsiyonel)</span></span>
          <textarea rows="4" oninput="setHomepagePopupItem(${idx}, 'body', this.value)" class="input w-full mt-1" placeholder="Satır sonları korunur.">${esc(item.body || '')}</textarea>
        </label>
        <label class="block">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Başlangıç tarihi</span>
          <input type="datetime-local" value="${esc(item.startsAt || '')}" onchange="setHomepagePopupItem(${idx}, 'startsAt', this.value)" class="input w-full mt-1">
        </label>
        <label class="block">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Bitiş tarihi</span>
          <input type="datetime-local" value="${esc(item.endsAt || '')}" onchange="setHomepagePopupItem(${idx}, 'endsAt', this.value)" class="input w-full mt-1">
        </label>
      </div>

      ${renderHomepagePopupMediaFields(item, idx)}

      <div class="grid gap-4 sm:grid-cols-2 mt-4">
        <label class="block">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Buton metni</span>
          <input type="text" value="${esc(item.buttonText || '')}" oninput="setHomepagePopupItem(${idx}, 'buttonText', this.value)" class="input w-full mt-1" placeholder="Örn. Detayı Gör">
        </label>
        <label class="block">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Buton bağlantısı</span>
          <input type="text" value="${esc(item.buttonUrl || '')}" oninput="setHomepagePopupItem(${idx}, 'buttonUrl', this.value)" class="input w-full mt-1" placeholder="https://... veya relative URL">
        </label>
      </div>
      <label class="inline-flex items-center gap-2 text-xs mt-3" style="color:var(--text-muted)">
        <input type="checkbox" ${item.openInNewTab !== false ? 'checked' : ''} onchange="setHomepagePopupItem(${idx}, 'openInNewTab', this.checked)">
        Buton yeni sekmede açılsın
      </label>
      ${mediaPreview}
    </div>`;
}

function renderHomepagePopupMediaFields(item, idx) {
  if (item.type === 'video') {
    return `
      <div class="grid gap-4 sm:grid-cols-2 mt-4">
        <label class="block">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Video URL</span>
          <div class="flex gap-2 mt-1">
            <input type="text" value="${esc(item.videoUrl || '')}" oninput="setHomepagePopupItem(${idx}, 'videoUrl', this.value)" class="input flex-1" placeholder="images/videos/...">
            <button onclick="uploadHomepagePopupAsset(${idx}, 'video', 'videoUrl')" class="btn btn-secondary text-xs">Yükle</button>
          </div>
        </label>
        <label class="block">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Poster görseli</span>
          <div class="flex gap-2 mt-1">
            <input type="text" value="${esc(item.posterUrl || '')}" oninput="setHomepagePopupItem(${idx}, 'posterUrl', this.value)" class="input flex-1" placeholder="images/...">
            <button onclick="uploadHomepagePopupAsset(${idx}, 'image', 'posterUrl')" class="btn btn-secondary text-xs">Yükle</button>
          </div>
        </label>
      </div>`;
  }
  if (item.type === 'embed') {
    return `
      <div class="mt-4">
        <label class="block">
          <span class="text-xs font-medium" style="color:var(--text-muted)">Embed bağlantısı</span>
          <input type="text" value="${esc(item.embedUrl || '')}" oninput="setHomepagePopupItem(${idx}, 'embedUrl', this.value)" class="input w-full mt-1" placeholder="YouTube veya Vimeo bağlantısı">
        </label>
      </div>`;
  }
  return `
    <div class="mt-4">
      <label class="block">
        <span class="text-xs font-medium" style="color:var(--text-muted)">Görsel URL <span style="color:var(--text-faint)">(opsiyonel)</span></span>
        <div class="flex gap-2 mt-1">
          <input type="text" value="${esc(item.imageUrl || '')}" oninput="setHomepagePopupItem(${idx}, 'imageUrl', this.value)" class="input flex-1" placeholder="images/...">
          <button onclick="uploadHomepagePopupAsset(${idx}, 'image', 'imageUrl')" class="btn btn-secondary text-xs">Yükle</button>
        </div>
      </label>
    </div>`;
}

function setHomepagePopupGlobal(key, value, rerender = false) {
  if (!_hpPopupState) return;
  if (key === 'delayMs' || key === 'dismissHours') value = Math.max(0, Number(value) || 0);
  _hpPopupState.data[key] = value;
  markDirty();
  if (rerender) renderHomepagePopupAdmin();
}

function setHomepagePopupItem(idx, key, value, rerender = false) {
  if (!_hpPopupState || !_hpPopupState.data.items[idx]) return;
  if (key === 'type') {
    const next = _hpPopupDefaultItem(value);
    _hpPopupState.data.items[idx] = { ...next, ..._hpPopupState.data.items[idx], type: value };
  } else {
    _hpPopupState.data.items[idx][key] = value;
  }
  markDirty();
  if (rerender) {
    renderHomepagePopupAdmin();
  } else {
    const status = _hpPopupItemStatus(_hpPopupState.data.items[idx]);
    const statusEl = document.querySelector(`[data-popup-item-status="${idx}"]`);
    if (statusEl) {
      statusEl.textContent = status.label;
      statusEl.setAttribute('style', _hpPopupStatusStyle(status.tone));
    }
  }
}

function addHomepagePopupItem(type) {
  if (!_hpPopupState) return;
  if (_hpPopupState.data.items.length >= 12) {
    toast('En fazla 12 pop-up eklenebilir.', 'warning');
    return;
  }
  const item = _hpPopupDefaultItem(type || 'announcement');
  _hpPopupState.data.items.push(item);
  const idx = _hpPopupState.data.items.length - 1;
  renderHomepagePopupAdmin();
  markDirty();
  window.setTimeout(() => {
    const card = document.querySelector(`[data-homepage-popup-card="${idx}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const titleInput = card && card.querySelector('input[placeholder="Pop-up başlığı"]');
    if (titleInput) titleInput.focus();
  }, 0);
}

function duplicateHomepagePopupItem(idx) {
  if (!_hpPopupState || !_hpPopupState.data.items[idx]) return;
  if (_hpPopupState.data.items.length >= 12) {
    toast('En fazla 12 pop-up eklenebilir.', 'warning');
    return;
  }
  const source = _hpPopupState.data.items[idx];
  const copy = {
    ...source,
    id: 'popup-item-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    title: source.title ? `${source.title} (Kopya)` : '',
    active: false,
  };
  _hpPopupState.data.items.splice(idx + 1, 0, copy);
  renderHomepagePopupAdmin();
  markDirty();
  toast('Pop-up kopyalandı ve pasif olarak eklendi.');
  window.setTimeout(() => {
    const card = document.querySelector(`[data-homepage-popup-card="${idx + 1}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 0);
}

function moveHomepagePopupItem(idx, dir) {
  if (!_hpPopupState) return;
  const arr = _hpPopupState.data.items;
  const next = idx + dir;
  if (next < 0 || next >= arr.length) return;
  const tmp = arr[idx];
  arr[idx] = arr[next];
  arr[next] = tmp;
  renderHomepagePopupAdmin();
  markDirty();
}

async function removeHomepagePopupItem(idx) {
  if (!_hpPopupState || !_hpPopupState.data.items[idx]) return;
  const title = _hpPopupState.data.items[idx].title || `Pop-up ${idx + 1}`;
  const ok = await confirmAction(`"${title}" silinsin mi?`);
  if (!ok) return;
  _hpPopupState.data.items.splice(idx, 1);
  renderHomepagePopupAdmin();
  markDirty();
}

async function uploadHomepagePopupAsset(idx, kind, field) {
  if (!_hpPopupState || !_hpPopupState.data.items[idx]) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = kind === 'video' ? 'video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogv,.mov' : 'image/*';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const result = await API.uploadFile(kind === 'video' ? '/media/upload/video' : '/media/upload/image', file, kind === 'video' ? 'video' : 'image');
      _hpPopupState.data.items[idx][field] = result.url || '';
      renderHomepagePopupAdmin();
      markDirty();
      toast(kind === 'video' ? 'Video yüklendi' : 'Görsel yüklendi');
    } catch (err) {
      toast('Yükleme hatası: ' + err.message, 'error');
    }
  };
  input.click();
}

let _hpPopupPreviewOverlay = null;
let _hpPopupPreviewItems = [];
let _hpPopupPreviewIndex = 0;

function _hpPopupPreviewMedia(item) {
  const imageUrl = _hpPopupSafeUrl(item.imageUrl);
  const videoUrl = _hpPopupSafeUrl(item.videoUrl);
  const posterUrl = _hpPopupSafeUrl(item.posterUrl);
  const embedUrl = _hpPopupEmbedUrl(item.embedUrl);
  const title = esc(String(item.title || item.badge || 'Pop-up önizleme'));

  if (item.type === 'video' && videoUrl) {
    return `<div class="bmj-home-popup-media"><video controls playsinline preload="metadata" ${posterUrl ? `poster="${esc(posterUrl)}"` : ''} src="${esc(videoUrl)}" aria-label="${title}"></video></div>`;
  }
  if (item.type === 'embed' && embedUrl) {
    return `<div class="bmj-home-popup-media"><div class="bmj-home-popup-embed-shell"><iframe src="${esc(embedUrl)}" title="${title}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div></div>`;
  }
  if (imageUrl) {
    return `<div class="bmj-home-popup-media"><img src="${esc(imageUrl)}" alt="${title}"></div>`;
  }
  return '';
}

function _hpPopupPreviewMarkup(item, index, total) {
  const media = _hpPopupPreviewMedia(item);
  const buttonUrl = _hpPopupSafeUrl(item.buttonUrl);
  const hasCopy = !!(item.title || item.body || (buttonUrl && item.buttonText));
  const nav = total > 1
    ? `<div class="bmj-home-popup-nav">
        <button type="button" class="bmj-home-popup-arrow" data-preview-prev aria-label="Önceki pop-up" ${index === 0 ? 'disabled' : ''}>&#8249;</button>
        <div class="bmj-home-popup-nav-center">
          <span class="bmj-home-popup-counter">${index + 1} / ${total}</span>
          <div class="bmj-home-popup-dots">${_hpPopupPreviewItems.map((_entry, dotIndex) => `<button type="button" class="bmj-home-popup-dot${dotIndex === index ? ' is-active' : ''}" data-preview-dot="${dotIndex}" aria-label="${dotIndex + 1}. pop-up'a git" aria-current="${dotIndex === index ? 'true' : 'false'}"></button>`).join('')}</div>
        </div>
        <button type="button" class="bmj-home-popup-arrow" data-preview-next aria-label="Sonraki pop-up" ${index === total - 1 ? 'disabled' : ''}>&#8250;</button>
      </div>`
    : '';

  return `<div class="bmj-home-popup-overlay" style="position:fixed">
    <div class="bmj-home-popup-backdrop"></div>
    <div class="bmj-home-popup-dialog" role="dialog" aria-modal="true" aria-label="Pop-up önizleme">
      <button type="button" class="bmj-home-popup-close" data-preview-close aria-label="Önizlemeyi kapat">&times;</button>
      <div class="bmj-home-popup-panel bmj-home-popup-panel-enter${media ? ' has-media' : ''}${hasCopy ? ' has-copy' : ''}${media && !hasCopy ? ' media-only' : ''}">
        ${media}
        ${hasCopy ? `<div class="bmj-home-popup-copy">
          ${item.badge ? `<p class="bmj-home-popup-badge">${esc(item.badge)}</p>` : ''}
          ${item.title ? `<h2 class="bmj-home-popup-title">${esc(item.title)}</h2>` : ''}
          ${item.body ? `<div class="bmj-home-popup-body">${esc(item.body).replace(/\n/g, '<br>')}</div>` : ''}
          ${buttonUrl && item.buttonText ? `<a class="bmj-home-popup-cta" href="${esc(buttonUrl)}" onclick="return false">${esc(item.buttonText)}</a>` : ''}
          ${nav}
        </div>` : (nav ? `<div class="bmj-home-popup-media-nav">${nav}</div>` : '')}
      </div>
    </div>
  </div>`;
}

function _renderHomepagePopupPreview() {
  if (!_hpPopupPreviewOverlay || !_hpPopupPreviewItems.length) return;
  const iframe = _hpPopupPreviewOverlay.querySelector('[data-popup-preview-frame]');
  if (!iframe || !iframe.contentDocument) return;
  const doc = iframe.contentDocument;
  doc.body.innerHTML = _hpPopupPreviewMarkup(
    _hpPopupPreviewItems[_hpPopupPreviewIndex],
    _hpPopupPreviewIndex,
    _hpPopupPreviewItems.length
  );
  const closeButton = doc.querySelector('[data-preview-close]');
  if (closeButton) closeButton.onclick = closeHomepagePopupPreview;
  const prev = doc.querySelector('[data-preview-prev]');
  const next = doc.querySelector('[data-preview-next]');
  if (prev) prev.onclick = () => {
    if (_hpPopupPreviewIndex <= 0) return;
    _hpPopupPreviewIndex -= 1;
    _renderHomepagePopupPreview();
  };
  if (next) next.onclick = () => {
    if (_hpPopupPreviewIndex >= _hpPopupPreviewItems.length - 1) return;
    _hpPopupPreviewIndex += 1;
    _renderHomepagePopupPreview();
  };
  doc.querySelectorAll('[data-preview-dot]').forEach((button) => {
    button.onclick = () => {
      _hpPopupPreviewIndex = Number(button.dataset.previewDot) || 0;
      _renderHomepagePopupPreview();
    };
  });
  const dialog = doc.querySelector('.bmj-home-popup-dialog');
  if (dialog && _hpPopupPreviewItems.length > 1) {
    let touchStartX = 0;
    let touchStartY = 0;
    dialog.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }, { passive: true });
    dialog.addEventListener('touchend', (event) => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (Math.abs(deltaX) < 50 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      if (deltaX < 0 && _hpPopupPreviewIndex < _hpPopupPreviewItems.length - 1) _hpPopupPreviewIndex += 1;
      else if (deltaX > 0 && _hpPopupPreviewIndex > 0) _hpPopupPreviewIndex -= 1;
      else return;
      _renderHomepagePopupPreview();
    }, { passive: true });
  }
}

function setHomepagePopupPreviewViewport(viewport) {
  if (!_hpPopupPreviewOverlay) return;
  const shell = _hpPopupPreviewOverlay.querySelector('[data-popup-preview-shell]');
  if (!shell) return;
  shell.style.width = viewport === 'mobile' ? '390px' : 'min(1120px, calc(100vw - 48px))';
  _hpPopupPreviewOverlay.querySelectorAll('[data-popup-preview-viewport]').forEach((button) => {
    const active = button.dataset.popupPreviewViewport === viewport;
    button.classList.toggle('btn-primary', active);
    button.classList.toggle('btn-secondary', !active);
  });
}

function closeHomepagePopupPreview() {
  if (_hpPopupPreviewOverlay) _hpPopupPreviewOverlay.remove();
  _hpPopupPreviewOverlay = null;
  _hpPopupPreviewItems = [];
  document.removeEventListener('keydown', _hpPopupPreviewKeydown);
}

function _hpPopupPreviewKeydown(event) {
  if (event.key === 'Escape') closeHomepagePopupPreview();
}

function previewHomepagePopupAdmin(itemIndex = null) {
  if (!_hpPopupState) return;
  const allItems = _hpPopupState.data.items || [];
  const requestedItem = Number.isInteger(itemIndex) ? allItems[itemIndex] : null;
  const items = requestedItem
    ? (_hpPopupItemHasContent(requestedItem) ? [requestedItem] : [])
    : allItems.filter((item) => item.active !== false && _hpPopupItemHasContent(item));

  if (!items.length) {
    toast('Önizlenecek geçerli ve aktif bir içerik bulunamadı.', 'warning');
    return;
  }

  closeHomepagePopupPreview();
  _hpPopupPreviewItems = items;
  _hpPopupPreviewIndex = 0;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '90';
  overlay.innerHTML = `
    <div data-popup-preview-shell style="width:min(1120px,calc(100vw - 48px));height:min(820px,calc(100vh - 48px));background:var(--bg-card);border:1px solid var(--border-soft);border-radius:18px;box-shadow:var(--shadow-lg);overflow:hidden;display:flex;flex-direction:column;transition:width .2s ease">
      <div class="flex items-center justify-between gap-3 px-4 py-3" style="border-bottom:1px solid var(--border-soft)">
        <div>
          <div class="text-sm font-semibold" style="color:var(--text-strong)">Pop-up Önizleme</div>
          <div class="text-xs mt-0.5" style="color:var(--text-muted)">Kaydedilmemiş değişiklikler dahil gösterilir.</div>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-primary text-xs" data-popup-preview-viewport="desktop" onclick="setHomepagePopupPreviewViewport('desktop')">Masaüstü</button>
          <button class="btn btn-secondary text-xs" data-popup-preview-viewport="mobile" onclick="setHomepagePopupPreviewViewport('mobile')">Mobil</button>
          <button class="btn btn-secondary text-xs" onclick="closeHomepagePopupPreview()">Kapat</button>
        </div>
      </div>
      <iframe data-popup-preview-frame title="Pop-up önizleme" style="width:100%;height:100%;border:0;background:#eef3f5"></iframe>
    </div>`;
  document.body.appendChild(overlay);
  _hpPopupPreviewOverlay = overlay;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeHomepagePopupPreview();
  });
  document.addEventListener('keydown', _hpPopupPreviewKeydown);

  const iframe = overlay.querySelector('[data-popup-preview-frame]');
  iframe.onload = _renderHomepagePopupPreview;
  iframe.srcdoc = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="/site/"><link rel="stylesheet" href="/site/css/style.css?v=20260619-popup-media"><style>html,body{margin:0;min-height:100%;background:#eef3f5}.bmj-home-popup-overlay{position:fixed}</style></head><body></body></html>`;
}

async function saveHomepagePopupAdmin() {
  if (!_hpPopupState) return;
  const validation = _hpPopupValidation(_hpPopupState.data);
  if (_hpPopupState.data.enabled && validation.errors.length) {
    toast(validation.errors[0], 'error');
    return;
  }
  try {
    const homepage = await API.get('/homepage');
    const popup = {
      ..._hpPopupState.data,
      updatedAt: new Date().toISOString(),
    };
    await API.put('/homepage', {
      ...(homepage && typeof homepage === 'object' ? homepage : {}),
      popup,
    });
    _hpPopupState.data = _hpPopupNormalize(popup);
    renderHomepagePopupAdmin();
    clearDirty();
    toast(validation.warnings[0] || 'Anasayfa pop-up ayarları kaydedildi.', validation.warnings.length ? 'warning' : 'success');
  } catch (err) {
    toast('Kaydedilemedi: ' + err.message, 'error');
  }
}

// Drag-drop reorder for the hero banners (move the iframe slide, keep carousel synced).
function _bannerReorderByDrop(srcRow, targetRow, above) {
  const doc = _heroDoc();
  if (!doc) return;
  const from = Number(srcRow.getAttribute('data-banner-idx'));
  const target = Number(targetRow.getAttribute('data-banner-idx'));
  if (isNaN(from) || isNaN(target) || from === target) { _renderHeroBannerPanel(); return; }
  const slides = _heroSlides(doc);
  const moving = slides[from];
  const ref = slides[target];
  if (!moving || !ref || !ref.parentNode) return;
  ref.parentNode.insertBefore(moving, above ? ref : ref.nextSibling);
  _syncHeroCarousel(doc);
  _afterHeroChange();
}

route('/social-media', async (el) => {
  // Fetch platform catalog from server (single source of truth).
  try {
    SOCIAL_PLATFORMS = await API.get('/social-media/platforms');
  } catch (err) {
    el.innerHTML = `<div class="card card-padded" style="border-color:#fecaca;background:#fef2f2"><p>Platform listesi yüklenemedi: ${esc(err.message)}</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="page-header">
      <div class="min-w-0">
        <h1 class="page-title">Sosyal Medya</h1>
        <p class="page-subtitle">Sitenin footer'ında ikon olarak görünen sosyal medya bağlantılarını buradan yönetin. Boş bırakılan platformlar footer'dan kaldırılır. Yeni platformlar eklendikçe burada otomatik görünür.</p>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="saveSocialMedia()" class="btn btn-secondary text-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Kaydet
        </button>
        <button onclick="syncSocialMedia()" class="btn btn-primary text-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Tüm Sayfalara Uygula
        </button>
      </div>
    </div>

    <div class="card card-padded mb-5" style="background:#f0f9ff;border-color:#bae6fd;padding:14px 16px">
      <div class="flex items-start gap-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0369a1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <div class="text-sm" style="color:#0c4a6e;line-height:1.55">
          <strong>İki adımlı işleyiş:</strong> <strong>Kaydet</strong> URL'leri admin panelinde saklar — site değişmez. <strong>Tüm Sayfalara Uygula</strong> ise kayıtlı URL'lerden footer ikonlarını üretip 16 HTML sayfasına yazar. Boş URL'li platformlar footer'dan otomatik kaldırılır. Sayfalarda sosyal blok bulunamazsa modal'da raporlanır.
        </div>
      </div>
    </div>

    <div class="grid gap-5" style="grid-template-columns:minmax(0,1fr) minmax(280px, 360px)">
      <!-- LEFT: Platform inputs -->
      <div class="card overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3" style="border-bottom:1px solid var(--border-soft);background:var(--bg-subtle)">
          <h3 class="font-semibold text-sm" style="color:var(--text-strong)">Platformlar <span style="font-weight:400;color:var(--text-muted)">(${SOCIAL_PLATFORMS.length})</span></h3>
          <span class="text-xs" style="color:var(--text-muted)">Yalnızca dolu olanlar footer'a yansır</span>
        </div>
        <div class="divide-y" style="border-color:var(--border-soft)">
          ${SOCIAL_PLATFORMS.map((p) => `
            <div class="px-5 py-3 flex items-center gap-3" style="border-bottom:1px solid var(--border-soft)">
              <span style="flex-shrink:0;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:${p.color}15;color:${p.color}">
                ${smIconHtml(p, 20)}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2 mb-1">
                  <label for="sm-${p.key}" class="text-sm font-medium" style="color:var(--text-strong)">${esc(p.label)}</label>
                  <span id="sm-${p.key}-status"></span>
                </div>
                <input id="sm-${p.key}" type="url" placeholder="${esc(p.placeholder)}" class="w-full px-3 py-1.5 text-sm rounded-lg" style="border:1px solid var(--border);background:#fafbfc" oninput="smRefreshRow('${p.key}'); markDirty();" autocomplete="off">
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- RIGHT: Live preview -->
      <div class="card overflow-hidden" style="position:sticky;top:24px;align-self:start">
        <div class="px-5 py-3" style="border-bottom:1px solid var(--border-soft);background:var(--bg-subtle)">
          <h3 class="font-semibold text-sm" style="color:var(--text-strong)">Footer Önizleme</h3>
          <p class="text-xs mt-0.5" style="color:var(--text-muted)">Site footer'ında bu şekilde görünecek</p>
        </div>
        <div style="padding:24px 20px;background:#134e4a">
          <p class="text-xs mb-3" style="color:#5eead4">Bizi takip edin</p>
          <div id="sm-preview" class="flex items-center gap-4" style="min-height:28px"></div>
        </div>
        <div style="padding:12px 16px;background:var(--bg-subtle);border-top:1px solid var(--border-soft)">
          <p class="text-xs" style="color:var(--text-muted);line-height:1.5">Önizlemedeki ikonlara tıklamak gerçek bağlantıyı açmaz — yalnızca görsel öndizlemedir.</p>
        </div>
      </div>
    </div>
  `;

  try {
    const data = await API.get('/social-media');
    SOCIAL_PLATFORMS.forEach((p) => {
      const input = document.getElementById(`sm-${p.key}`);
      if (input) input.value = data[p.key] || '';
      smRefreshRow(p.key);
    });
  } catch (err) { toast(err.message, 'error'); }
});

async function saveSocialMedia(silent) {
  // Validate first
  const errors = [];
  const payload = {};
  for (const p of SOCIAL_PLATFORMS) {
    const v = (document.getElementById(`sm-${p.key}`)?.value || '').trim();
    payload[p.key] = v;
    const res = smValidateUrl(v);
    if (!res.ok) errors.push(`${p.label}: ${res.reason}`);
  }
  if (errors.length) {
    toast('Geçersiz URL: ' + errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} daha)` : ''), 'error');
    return false;
  }
  try {
    await API.put('/social-media', payload);
    clearDirty();
    if (!silent) toast('Kaydedildi. Siteye yansıtmak için "Tüm Sayfalara Uygula" butonunu kullanın.');
    return true;
  } catch (err) { toast(err.message, 'error'); return false; }
}

async function syncSocialMedia() {
  if (!await confirmAction('Sosyal medya ikonları 16 HTML sayfasının footer\'ına yazılacak ve mevcut sosyal blokların yerini alacak. Otomatik yedek alınır. Devam edilsin mi?')) return;
  // Save current input values first
  const saved = await saveSocialMedia(true);
  if (!saved) return;
  try {
    const result = await API.post('/social-media/sync');
    const updated = result.results.filter(r => r.status === 'updated');
    const unchanged = result.results.filter(r => r.status === 'unchanged');
    const noBlock = result.results.filter(r => r.status === 'no-block');
    const errors = result.results.filter(r => r.status === 'error');
    const skipped = result.results.filter(r => r.status === 'skipped');

    const rowHtml = (r) => {
      const map = {
        updated:   { label: 'Güncellendi',        color: '#15803d' },
        unchanged: { label: 'Değişiklik yok',     color: 'var(--text-muted)' },
        'no-block':{ label: 'Sosyal blok bulunamadı', color: '#92400e' },
        skipped:   { label: 'Atlandı',            color: '#92400e' },
        error:     { label: 'Hata',               color: '#b91c1c' },
      };
      const m = map[r.status] || { label: r.status, color: 'var(--text)' };
      return `<tr style="border-top:1px solid var(--border-soft)"><td class="px-3 py-1.5 font-mono text-xs" style="color:var(--text)">${esc(r.file)}</td><td class="px-3 py-1.5 text-xs font-medium" style="color:${m.color}">${m.label}${r.reason ? ` — ${esc(r.reason)}` : ''}</td></tr>`;
    };

    const summary = `
      <div class="flex items-center gap-2 flex-wrap mb-4 pb-3" style="border-bottom:1px solid var(--border-soft)">
        ${updated.length ? `<span class="badge" style="background:#dcfce7;color:#15803d">${updated.length} güncellendi</span>` : ''}
        ${unchanged.length ? `<span class="badge bg-gray-100 text-gray-600">${unchanged.length} değişmedi</span>` : ''}
        ${noBlock.length ? `<span class="badge" style="background:#fef3c7;color:#92400e">${noBlock.length} sosyal blok yok</span>` : ''}
        ${skipped.length ? `<span class="badge" style="background:#fef3c7;color:#92400e">${skipped.length} atlandı</span>` : ''}
        ${errors.length ? `<span class="badge" style="background:#fee2e2;color:#b91c1c">${errors.length} hata</span>` : ''}
      </div>
      ${noBlock.length ? `
        <div class="mb-4 p-3 rounded-lg text-xs" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;line-height:1.5">
          <strong>⚠ Dikkat:</strong> ${noBlock.length} sayfada sosyal medya bloğu bulunamadı (eski bir şablona sahip olabilir). Bu sayfalarda bağlantılar yansımayacak. Bu sayfaların footer'ını "Menü &amp; Footer" sayfasından "Tüm Sayfalara Uygula" ile güncelleyebilirsiniz.
        </div>` : ''}
      <div style="max-height:360px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:var(--radius-md)">
        <table class="w-full text-sm">
          <thead style="background:var(--bg-subtle);position:sticky;top:0">
            <tr>
              <th class="text-left px-3 py-2 font-medium" style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.04em">Dosya</th>
              <th class="text-left px-3 py-2 font-medium" style="color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.04em">Durum</th>
            </tr>
          </thead>
          <tbody>${result.results.map(rowHtml).join('')}</tbody>
        </table>
      </div>
    `;
    await modal('Senkronizasyon Sonucu', summary, [{ label: 'Tamam', value: 'ok', class: 'btn-primary' }]);
    toast(`${updated.length} sayfa güncellendi${noBlock.length ? `, ${noBlock.length} sayfada blok yok` : ''}${errors.length ? `, ${errors.length} hata` : ''}`);
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
      <div><label class="label">Mevcut Şifre</label>
        <input id="cp-current" type="password" class="input"></div>
      <div><label class="label">Yeni Şifre</label>
        <input id="cp-new" type="password" class="input"></div>
      <div><label class="label">Yeni Şifre (Tekrar)</label>
        <input id="cp-confirm" type="password" class="input"></div>
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

// ── Command Palette (Ctrl+K / Cmd+K) ──
// A modal that lets the user jump anywhere in the panel by typing — pages,
// articles, news, AIP items. Fuzzy substring match. Arrow keys + Enter to act.
const COMMAND_ITEMS = [
  // Section: navigation (always available)
  { kind: 'nav', section: 'Sayfalar', title: 'Dashboard',          hash: '#/' },
  { kind: 'nav', section: 'Sayfalar', title: 'e-Pub Makaleler',    hash: '#/articles-in-press' },
  { kind: 'nav', section: 'Sayfalar', title: 'Haberler',           hash: '#/news' },
  { kind: 'nav', section: 'Sayfalar', title: 'Sayfalar',           hash: '#/pages' },
  { kind: 'nav', section: 'Sayfalar', title: 'Sayılar',            hash: '#/issues' },
  { kind: 'nav', section: 'Sayfalar', title: 'Sayı Aktar (ZIP)',   hash: '#/zip-import' },
  { kind: 'nav', section: 'Sayfalar', title: 'JATS XML Aktar',     hash: '#/jats-import' },
  { kind: 'nav', section: 'Sayfalar', title: 'Yayın Kurulu',       hash: '#/editorial' },
  { kind: 'nav', section: 'Sayfalar', title: 'Dosyalar',           hash: '#/media' },
  { kind: 'nav', section: 'Sayfalar', title: 'İstatistikler',      hash: '#/article-stats' },
  { kind: 'nav', section: 'Sayfalar', title: 'Anasayfa Pop-up',    hash: '#/homepage-popup' },
  { kind: 'nav', section: 'Sayfalar', title: 'Makale Türleri',     hash: '#/article-types' },
  { kind: 'nav', section: 'Sayfalar', title: 'Menü & Footer',      hash: '#/nav-footer' },
  { kind: 'nav', section: 'Sayfalar', title: 'Sosyal Medya',       hash: '#/social-media' },
  // Section: quick actions
  { kind: 'action', section: 'Eylem', title: 'Yeni Makale',                    hash: '#/articles/new' },
  { kind: 'action', section: 'Eylem', title: 'Yeni Baskıda Makale (Manuel)',  hash: '#/articles-in-press/new' },
  { kind: 'action', section: 'Eylem', title: 'Yeni Haber',                    hash: '#/news/new' },
  { kind: 'action', section: 'Eylem', title: 'Yedek Al',                      onSelect: () => showBackupPanel() },
  { kind: 'action', section: 'Eylem', title: 'Şifre Değiştir',                onSelect: () => showChangePassword() },
];

let _cmdData = null; // cache for /articles, /news, /pages lookups

async function ensureCommandData() {
  if (_cmdData) return _cmdData;
  // Load lightweight lists in parallel
  const [arts, aip, news, pages] = await Promise.all([
    API.get('/articles?limit=200').catch(() => ({ articles: [] })),
    API.get('/articles-in-press').catch(() => []),
    API.get('/news').catch(() => []),
    API.get('/pages').catch(() => []),
  ]);
  _cmdData = {
    articles: (arts.articles || []).map(a => ({
      kind: 'article', section: 'Makale', title: a.title || `#${a.id}`,
      subtitle: `#${a.id}` + (a.doi ? ' · ' + a.doi : ''),
      hash: `#/articles/${a.id}`,
    })),
    aip: (aip || []).map(a => ({
      kind: 'aip', section: 'Baskıda Makale', title: a.title || `#${a.id}`,
      subtitle: `#${a.id}` + (a.doi ? ' · ' + a.doi : ''),
      hash: `#/articles-in-press/${a.id}/edit`,
    })),
    news: (news || []).map(n => ({
      kind: 'news', section: 'Haber', title: n.title || `#${n.id}`,
      subtitle: `#${n.id}` + (n.date ? ' · ' + n.date : ''),
      hash: `#/news/${n.id}`,
    })),
    pages: (pages || []).map(p => ({
      kind: 'page', section: 'Sayfa', title: p.title || p.slug,
      subtitle: p.slug,
      hash: `#/pages/${p.slug}`,
    })),
  };
  return _cmdData;
}

// Returns a numeric score (0 = no match, higher = better).
// 100  = exact substring match, hit earlier in haystack ranks higher
// 50   = in-order character match
// 0    = no match
function fuzzyScore(needle, haystack) {
  if (!needle) return 1;
  const n = needle.toLowerCase().trim();
  const h = (haystack || '').toLowerCase();
  if (!n) return 1;
  // Exact substring (priority by how early the match starts)
  const idx = h.indexOf(n);
  if (idx !== -1) return 100 - Math.min(idx, 50);
  // Fall back to in-order char match
  let hi = 0;
  for (const c of n) {
    const found = h.indexOf(c, hi);
    if (found === -1) return 0;
    hi = found + 1;
  }
  return 50;
}
function fuzzyMatch(needle, haystack) {
  return fuzzyScore(needle, haystack) > 0;
}

function commandIcon(kind) {
  const icons = {
    nav:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
    action:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14"/></svg>',
    article: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
    aip:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    news:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2"/></svg>',
    page:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2z"/></svg>',
  };
  return icons[kind] || icons.nav;
}

let _cmdActiveIndex = 0;
let _cmdItems = [];

async function openCommandPalette() {
  // Already open?
  if (document.getElementById('cmd-overlay')) return;

  // Build overlay scaffold
  const overlay = document.createElement('div');
  overlay.id = 'cmd-overlay';
  overlay.className = 'cmd-overlay';
  overlay.innerHTML = `
    <div class="cmd-dialog" role="dialog" aria-modal="true" aria-label="Komut paleti">
      <div style="position:relative">
        <svg class="cmd-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="cmd-input" class="cmd-search" type="text" placeholder="Aramak için yazın… (sayfa, makale, haber)" autocomplete="off" autofocus>
      </div>
      <div id="cmd-results" class="cmd-results"><div class="cmd-empty">Yükleniyor…</div></div>
      <div class="cmd-footer">
        <div class="flex items-center gap-2"><span class="cmd-kbd">↑↓</span> gezin · <span class="cmd-kbd">↵</span> aç · <span class="cmd-kbd">esc</span> kapat</div>
        <div>${COMMAND_ITEMS.length}+ konum</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = document.getElementById('cmd-input');
  const resultsEl = document.getElementById('cmd-results');

  // Click outside to close
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCommandPalette(); });

  // Load data (cached)
  await ensureCommandData();
  renderCommandResults('');

  input.addEventListener('input', () => renderCommandResults(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCmdActive(_cmdActiveIndex + 1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCmdActive(_cmdActiveIndex - 1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = _cmdItems[_cmdActiveIndex];
      if (item) selectCommandItem(item);
    }
  });
}

function closeCommandPalette() {
  const el = document.getElementById('cmd-overlay');
  if (el) el.remove();
}

function setCmdActive(idx) {
  if (!_cmdItems.length) return;
  _cmdActiveIndex = ((idx % _cmdItems.length) + _cmdItems.length) % _cmdItems.length;
  document.querySelectorAll('.cmd-item').forEach((el, i) => {
    el.classList.toggle('is-active', i === _cmdActiveIndex);
    if (i === _cmdActiveIndex) el.scrollIntoView({ block: 'nearest' });
  });
}

function selectCommandItem(item) {
  closeCommandPalette();
  if (item.onSelect) { item.onSelect(); return; }
  if (item.hash) navigate(item.hash);
}

function renderCommandResults(query) {
  const resultsEl = document.getElementById('cmd-results');
  if (!resultsEl) return;
  const all = [
    ...COMMAND_ITEMS,
    ...(_cmdData ? [..._cmdData.articles, ..._cmdData.aip, ..._cmdData.news, ..._cmdData.pages] : []),
  ];
  const q = query.trim();
  let filtered;
  if (q) {
    // Score every item, then sort by score (desc). This ranks exact substring
    // matches above in-order fuzzy matches, and earlier matches above later ones.
    filtered = all
      .map(i => ({
        item: i,
        score: Math.max(fuzzyScore(q, i.title), fuzzyScore(q, i.subtitle || '') * 0.9),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item);
  } else {
    filtered = all.filter(i => i.kind === 'nav' || i.kind === 'action');
  }
  // Cap to 50 results for snappy UX
  _cmdItems = filtered.slice(0, 50);
  _cmdActiveIndex = 0;

  if (_cmdItems.length === 0) {
    resultsEl.innerHTML = '<div class="cmd-empty">Eşleşen sonuç yok</div>';
    return;
  }

  // Group by section
  const groups = {};
  for (const item of _cmdItems) {
    if (!groups[item.section]) groups[item.section] = [];
    groups[item.section].push(item);
  }
  let html = '';
  for (const [section, items] of Object.entries(groups)) {
    html += `<div class="cmd-section-title">${esc(section)}</div>`;
    for (const item of items) {
      const idx = _cmdItems.indexOf(item);
      html += `<div class="cmd-item${idx === 0 ? ' is-active' : ''}" data-idx="${idx}">
        <span class="cmd-item-icon">${commandIcon(item.kind)}</span>
        <div class="cmd-item-text">
          <div class="cmd-item-title">${esc(item.title)}</div>
          ${item.subtitle ? `<div class="cmd-item-sub">${esc(item.subtitle)}</div>` : ''}
        </div>
        <span class="cmd-kbd">${esc(item.hash || '')}</span>
      </div>`;
    }
  }
  resultsEl.innerHTML = html;
  resultsEl.querySelectorAll('.cmd-item').forEach((el) => {
    el.addEventListener('mouseenter', () => setCmdActive(Number(el.dataset.idx)));
    el.addEventListener('click', () => selectCommandItem(_cmdItems[Number(el.dataset.idx)]));
  });
}

// Global keyboard listener: Ctrl+K / Cmd+K opens palette, Ctrl+B toggles sidebar
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCommandPalette();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    // Don't steal Ctrl+B while the user is editing text — it must stay "bold"
    // inside contenteditable editors (Tam Metin, özet, haber) and form inputs.
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    e.preventDefault();
    toggleSidebarCollapsed();
  }
});

// Sidebar collapse: save preference in localStorage so the choice persists
const SIDEBAR_KEY = 'bmj-admin-sidebar-collapsed';
function toggleSidebarCollapsed() {
  const collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch {}
}
// On first paint, restore preference + wrap link text nodes in a tagged span
// (so CSS can hide them in collapsed mode) + populate data-label for tooltip.
function initSidebarCollapseState() {
  try {
    if (localStorage.getItem(SIDEBAR_KEY) === '1') document.body.classList.add('sidebar-collapsed');
  } catch {}
  document.querySelectorAll('.app-sidebar .sidebar-link').forEach((el) => {
    if (el.dataset.label) return; // already processed
    // Wrap raw text nodes in <span class="sidebar-link-label"> so we can hide them
    const labelParts = [];
    [...el.childNodes].forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) {
          labelParts.push(text);
          const span = document.createElement('span');
          span.className = 'sidebar-link-label';
          span.textContent = text;
          node.parentNode.replaceChild(span, node);
        } else {
          node.remove();
        }
      }
    });
    if (labelParts.length) el.dataset.label = labelParts.join(' ').replace(/\s+/g, ' ');
  });
}

// Invalidate command palette cache after data mutations (best-effort)
function invalidateCommandCache() { _cmdData = null; }

// Init
document.addEventListener('DOMContentLoaded', () => {
  initSidebarCollapseState();
  _initDatePasteSupport();
  handleRoute();
});
