// Verifies manual (editor-typed) figure/table caption labels:
//  1) _buildMediaBlock renders a verbatim manual label + sets data-label (LOCKED)
//     and falls back to auto "FIG. N." / "Table N." when no label is given.
//  2) _renderLabelPrefix is idempotent on the trailing period ("X 3" == "X 3.").
//  3) _tableLabelHtml honors the optional manual-label arg.
//  4) _insertInlineTable B-rule: changed label ⇒ LOCKED data-label + verbatim
//     render; untouched default ⇒ AUTO "Table N.".
//  5) htmlEditorInsertTable wraps the empty grid as #table-N with the label.
//  6) Lock survives renumber: _refreshTableLabel keeps the verbatim label while
//     the integer id renumbers.
//  7) _updateExistingMediaCaption keeps a locked figure's verbatim prefix.
//
// Requires server with BMJ_TEST_BYPASS_AUTH=1 on BASE_URL.
const puppeteer = require('puppeteer');
const BASE = process.env.BASE_URL || 'http://localhost:3099';

let failures = 0;
function ok(name, cond, detail) {
  console.log((cond ? '✓' : '✗') + ' ' + name + (detail ? '  — ' + detail : ''));
  if (!cond) failures++;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });

  async function buildEditor(innerHtml) {
    return page.evaluate((innerHtml) => {
      window.location.hash = '#/articles/9990050/edit';
      let host = document.getElementById('ft-host');
      if (!host) { host = document.createElement('div'); host.id = 'ft-host'; document.body.appendChild(host); }
      host.innerHTML = htmlEditor({ prefix: 'ft', initialHtml: '', variant: 'full' });
      const v = document.getElementById('ft-visual');
      v.innerHTML = innerHtml;
      window._articleAssets = { figures: [], supplementary: [] };
    }, innerHtml);
  }

  try {
    // ── 2) _renderLabelPrefix period idempotency ──
    const prefixes = await page.evaluate(() => ({
      noDot:   _renderLabelPrefix('Graphic 3'),
      withDot: _renderLabelPrefix('Graphic 3.'),
      spaced:  _renderLabelPrefix('  Figür 2a  '),
      empty:   _renderLabelPrefix(''),
    }));
    ok('_renderLabelPrefix "Graphic 3" → tek nokta', prefixes.noDot === '<strong>Graphic 3.</strong>', prefixes.noDot);
    ok('_renderLabelPrefix "Graphic 3." → çift nokta yok', prefixes.withDot === '<strong>Graphic 3.</strong>', prefixes.withDot);
    ok('_renderLabelPrefix boşlukları kırpar', prefixes.spaced === '<strong>Figür 2a.</strong>', prefixes.spaced);
    ok('_renderLabelPrefix boş → ""', prefixes.empty === '', JSON.stringify(prefixes.empty));

    // ── 1) _buildMediaBlock figure with + without manual label ──
    const fig = await page.evaluate(() => {
      const manual = _buildMediaBlock('figure', 2, [{ panel: null, url: 'images/x/f.png', caption: 'Açıklama metni', label: 'Graphic 3' }]);
      const auto   = _buildMediaBlock('figure', 5, [{ panel: null, url: 'images/x/f.png', caption: 'Açıklama metni', label: '' }]);
      return {
        manualAttr: manual.getAttribute('data-label'),
        manualCap: manual.querySelector('p').innerHTML,
        manualCE: manual.querySelector('p').getAttribute('contenteditable'),
        autoHasAttr: auto.hasAttribute('data-label'),
        autoCap: auto.querySelector('p').innerHTML,
        autoCE: auto.querySelector('p').getAttribute('contenteditable'),
      };
    });
    ok('figür LOCKED: data-label="Graphic 3"', fig.manualAttr === 'Graphic 3', fig.manualAttr);
    ok('figür LOCKED caption: <strong>Graphic 3.</strong> Açıklama', /^<strong>Graphic 3\.<\/strong> Açıklama metni/.test(fig.manualCap), fig.manualCap);
    ok('figür AUTO: data-label yok', fig.autoHasAttr === false);
    ok('figür AUTO caption: <strong>FIG. 5.</strong>', /^<strong>FIG\. 5\.<\/strong>/.test(fig.autoCap), fig.autoCap);
    ok('figür caption düzenlenemez (contenteditable="false")', fig.manualCE === 'false' && fig.autoCE === 'false', fig.manualCE + '/' + fig.autoCE);

    // ── 3) _buildMediaBlock table with manual label + _tableLabelHtml arg ──
    const tbl = await page.evaluate(() => {
      const manual = _buildMediaBlock('table', 4, [{ panel: null, url: 'images/x/t.png', caption: 'Veri', label: 'Tablo 1a' }]);
      return {
        attr: manual.getAttribute('data-label'),
        cap: manual.querySelector('p.table-label').innerHTML,
        helperManual: _tableLabelHtml(9, 'Veri', 'Graphic 9'),
        helperAuto: _tableLabelHtml(9, 'Veri'),
      };
    });
    ok('tablo LOCKED: data-label="Tablo 1a"', tbl.attr === 'Tablo 1a', tbl.attr);
    ok('tablo LOCKED caption: <strong>Tablo 1a.</strong> Veri', /^<strong>Tablo 1a\.<\/strong> Veri/.test(tbl.cap), tbl.cap);
    ok('_tableLabelHtml(manual) → verbatim', tbl.helperManual === '<strong>Graphic 9.</strong> Veri', tbl.helperManual);
    ok('_tableLabelHtml(auto) → "Table 9."', tbl.helperAuto === '<strong>Table 9.</strong> Veri', tbl.helperAuto);

    // ── 4) _insertInlineTable B-rule: changed label locks; unchanged stays AUTO ──
    await buildEditor('<p id="p1">Bir tablo: burada.</p>');
    const locked = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const p = document.getElementById('p1');
      const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      _crossRefSelection['ft'] = { range: r.cloneRange(), text: '' };
      _insertInlineTable('ft');
      const o = document.querySelector('.modal-overlay');
      o.querySelector('#itbl-label').value = 'Tablo 1a';        // CHANGED from "Table 1"
      o.querySelector('#itbl-caption').value = 'Temel özellikler';
      o.querySelector('#itbl-paste').innerHTML = '<table><tbody><tr><td>a</td></tr></tbody></table>';
      o.querySelector('[data-action="insert"]').click();
      const blk = v.querySelector('#table-1');
      return { attr: blk.getAttribute('data-label'), text: blk.querySelector('.table-label').textContent };
    });
    ok('_insertInlineTable değişen etiket → LOCKED data-label', locked.attr === 'Tablo 1a', locked.attr);
    ok('_insertInlineTable LOCKED render "Tablo 1a."', /^Tablo 1a\./.test(locked.text), locked.text);

    await buildEditor('<p id="p1">Bir tablo: burada.</p>');
    const unlocked = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const p = document.getElementById('p1');
      const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      _crossRefSelection['ft'] = { range: r.cloneRange(), text: '' };
      _insertInlineTable('ft');
      const o = document.querySelector('.modal-overlay');
      // Leave #itbl-label at its prefilled default ("Table 1").
      o.querySelector('#itbl-caption').value = 'Temel özellikler';
      o.querySelector('#itbl-paste').innerHTML = '<table><tbody><tr><td>a</td></tr></tbody></table>';
      o.querySelector('[data-action="insert"]').click();
      const blk = v.querySelector('#table-1');
      return { hasAttr: blk.hasAttribute('data-label'), text: blk.querySelector('.table-label').textContent };
    });
    ok('_insertInlineTable dokunulmamış default → AUTO (data-label yok)', unlocked.hasAttr === false);
    ok('_insertInlineTable AUTO render "Table 1."', /^Table 1\./.test(unlocked.text), unlocked.text);

    // ── 5) htmlEditorInsertTable wraps empty grid as #table-N with label ──
    await buildEditor('<p id="p1">Boş tablo buraya.</p>');
    const emptyTbl = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      const p = document.getElementById('p1');
      const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      htmlEditorInsertTable('ft');
      const o = document.querySelector('.modal-overlay');
      o.querySelector('#tbl-label').value = 'Çizelge 1';        // CHANGED
      o.querySelector('#tbl-caption').value = 'Başlık';
      o.querySelector('[data-action="insert"]').click();
      const blk = v.querySelector('.article-table-wrap[id^="table-"]');
      return blk ? { id: blk.id, attr: blk.getAttribute('data-label'), text: blk.querySelector('.table-label').textContent, hasTable: !!blk.querySelector('table.article-table') } : null;
    });
    ok('htmlEditorInsertTable #table-N sarmalayıcı üretti', !!emptyTbl && /^table-\d+$/.test(emptyTbl.id), emptyTbl && emptyTbl.id);
    ok('htmlEditorInsertTable LOCKED data-label="Çizelge 1"', !!emptyTbl && emptyTbl.attr === 'Çizelge 1', emptyTbl && emptyTbl.attr);
    ok('htmlEditorInsertTable render "Çizelge 1."', !!emptyTbl && /^Çizelge 1\./.test(emptyTbl.text), emptyTbl && emptyTbl.text);
    ok('htmlEditorInsertTable boş grid eklendi', !!emptyTbl && emptyTbl.hasTable);

    // ── 6) Lock survives renumber via _refreshTableLabel ──
    const renum = await page.evaluate(() => {
      const wrap = document.createElement('div');
      wrap.className = 'article-table-wrap';
      wrap.id = 'table-1';
      wrap.setAttribute('data-label', 'Tablo 2b');
      wrap.innerHTML = '<p class="table-label"><strong>Tablo 2b.</strong> Veri</p><table class="article-table"><tbody><tr><td>x</td></tr></tbody></table>';
      // Renumber the integer id to 7 and refresh the label.
      wrap.id = 'table-7';
      _refreshTableLabel(wrap, 7);
      return wrap.querySelector('.table-label').textContent;
    });
    ok('renumber sonrası LOCKED etiket korunur ("Tablo 2b." kalır)', /^Tablo 2b\./.test(renum) && !/Table 7/.test(renum), renum);

    // ── 7) _updateExistingMediaCaption keeps locked figure prefix ──
    const upd = await page.evaluate(() => {
      const fig = document.createElement('figure');
      fig.id = 'figure-3';
      fig.className = 'article-figure';
      fig.setAttribute('data-label', 'Graphic 3');
      fig.innerHTML = '<img src="x.png" alt="Figure 3"><p><strong>Graphic 3.</strong> eski</p>';
      _updateExistingMediaCaption(fig, 'figure', 3, 'yeni açıklama', null);
      return fig.querySelector('p').innerHTML;
    });
    ok('_updateExistingMediaCaption LOCKED prefix korunur + metin güncellenir',
      /^<strong>Graphic 3\.<\/strong> yeni açıklama/.test(upd), upd);

    // ── 8) Bubble shows an edit (pencil) button per in-body table ──
    await buildEditor(
      '<p>Bkz. Table 1 verileri.</p>' +
      '<div class="article-table-wrap" id="table-1"><p class="table-label"><strong>Table 1.</strong> Eski başlık</p>' +
      '<table class="article-table"><tbody><tr><td>a</td><td>b</td></tr></tbody></table></div>'
    );
    const hasEditBtn = await page.evaluate(() => {
      _renderCrossRefBubble('ft');
      const b = document.getElementById('cr-bubble');
      return !!(b && b.querySelector('[data-edit-table="1"]'));
    });
    ok('bubble TABLOLAR satırında düzenle butonu var', hasEditBtn);

    // ── 9) Edit dialog pre-fills label + caption + current table ──
    const prefill = await page.evaluate(() => {
      _insertInlineTable('ft', 1);
      const o = document.querySelector('.modal-overlay');
      return {
        label: o.querySelector('#itbl-label').value,
        caption: o.querySelector('#itbl-caption').value,
        hasTable: !!o.querySelector('#itbl-paste table'),
        title: o.querySelector('h3').textContent,
        btn: o.querySelector('[data-action="insert"]').textContent,
      };
    });
    ok('düzenle dialog başlığı "Tabloyu Düzenle"', /Tabloyu Düzenle/.test(prefill.title), prefill.title);
    ok('düzenle dialog etiketi önceden dolu ("Table 1")', prefill.label === 'Table 1', prefill.label);
    ok('düzenle dialog başlığı önceden dolu ("Eski başlık")', prefill.caption === 'Eski başlık', prefill.caption);
    ok('düzenle dialog mevcut tabloyu gösterir', prefill.hasTable === true);
    ok('düzenle dialog butonu "Kaydet"', /Kaydet/.test(prefill.btn), prefill.btn);

    // ── 10) Saving the edit updates the block in place (same id, locked label) ──
    const edited = await page.evaluate(() => {
      const o = document.querySelector('.modal-overlay');
      o.querySelector('#itbl-label').value = 'Çizelge 5';             // CHANGE → lock
      o.querySelector('#itbl-caption').value = 'Yeni başlık';
      // Edit a cell in the pre-filled table.
      const td = o.querySelector('#itbl-paste table td');
      if (td) td.textContent = 'DÜZENLENDİ';
      o.querySelector('[data-action="insert"]').click();
      const v = document.getElementById('ft-visual');
      const blocks = v.querySelectorAll('.article-table-wrap[id^="table-"]');
      const blk = v.querySelector('#table-1');
      return {
        count: blocks.length,
        attr: blk ? blk.getAttribute('data-label') : null,
        labelText: blk ? blk.querySelector('.table-label').textContent : null,
        cell: blk ? (blk.querySelector('table td') ? blk.querySelector('table td').textContent : null) : null,
      };
    });
    ok('düzenleme yeni blok oluşturmaz (tek tablo)', edited.count === 1, 'count=' + edited.count);
    ok('düzenleme LOCKED data-label="Çizelge 5"', edited.attr === 'Çizelge 5', edited.attr);
    ok('düzenleme etiketi "Çizelge 5." render eder', /^Çizelge 5\. Yeni başlık/.test(edited.labelText), edited.labelText);
    ok('düzenleme tablo içeriğini günceller', edited.cell === 'DÜZENLENDİ', edited.cell);

    // ── 11) Editing an AUTO table, leaving label default, stays AUTO ──
    await buildEditor(
      '<div class="article-table-wrap" id="table-1"><p class="table-label"><strong>Table 1.</strong> Başlık</p>' +
      '<table class="article-table"><tbody><tr><td>x</td></tr></tbody></table></div>'
    );
    const stayAuto = await page.evaluate(() => {
      _insertInlineTable('ft', 1);
      const o = document.querySelector('.modal-overlay');
      // Leave #itbl-label at "Table 1"; just change the caption.
      o.querySelector('#itbl-caption').value = 'Değişti';
      o.querySelector('[data-action="insert"]').click();
      const blk = document.getElementById('ft-visual').querySelector('#table-1');
      return { hasAttr: blk.hasAttribute('data-label'), text: blk.querySelector('.table-label').textContent };
    });
    ok('düzenleme: dokunulmamış etiket AUTO kalır (data-label yok)', stayAuto.hasAttr === false);
    ok('düzenleme: AUTO render "Table 1. Değişti"', /^Table 1\. Değişti/.test(stayAuto.text), stayAuto.text);

    // ── 12) Caption labels are non-editable (contenteditable="false") ──
    const ceTable = await page.evaluate(() => {
      const blk = document.getElementById('ft-visual').querySelector('#table-1');
      return blk.querySelector('.table-label').getAttribute('contenteditable');
    });
    ok('tablo etiketi düzenlenemez (contenteditable="false")', ceTable === 'false', ceTable);

    // Legacy blocks (no contenteditable yet) get locked on normalize/load.
    const legacyLocked = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>Metin.</p>' +
        '<figure id="figure-1" class="article-figure"><img src="x.png" alt=""><p><strong>Figure 1.</strong> Açıklama</p></figure>' +
        '<div class="article-table-wrap" id="table-1"><p class="table-label"><strong>Table 1.</strong> Başlık</p><table class="article-table"><tbody><tr><td>a</td></tr></tbody></table></div>';
      _normalizeMediaCaptions(v);
      return {
        fig: v.querySelector('#figure-1 > p').getAttribute('contenteditable'),
        tab: v.querySelector('#table-1 > p.table-label').getAttribute('contenteditable'),
      };
    });
    ok('normalize legacy figür etiketini kilitler', legacyLocked.fig === 'false', legacyLocked.fig);
    ok('normalize legacy tablo etiketini kilitler', legacyLocked.tab === 'false', legacyLocked.tab);

    // ── 13) In-editor media toolbar: move up/down + delete ──
    const toolbar = await page.evaluate(async () => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p id="pA">A</p>' +
        '<figure id="figure-1" class="article-figure"><img src="f.png" alt=""><p contenteditable="false"><strong>FIG. 1.</strong> Cap</p></figure>' +
        '<p id="pB">B</p>' +
        '<div class="article-table-wrap" id="table-1"><p class="table-label" contenteditable="false"><strong>Table 1.</strong> T</p><table class="article-table"><tbody><tr><td>x</td></tr></tbody></table></div>';
      _initMediaBlockControls();
      const fig = v.querySelector('#figure-1');
      // Simulate the toolbar acting on the figure.
      _showMediaCtl(fig, v);
      // Move figure up (above pA).
      document.getElementById('media-block-ctl').querySelector('[data-mbc="up"]').click();
      const orderAfterUp = Array.from(v.children).map((c) => c.id || c.tagName).join(',');
      // Move it back down.
      _showMediaCtl(v.querySelector('#figure-1'), v);
      document.getElementById('media-block-ctl').querySelector('[data-mbc="down"]').click();
      const orderAfterDown = Array.from(v.children).map((c) => c.id || c.tagName).join(',');
      return { orderAfterUp, orderAfterDown };
    });
    ok('toolbar figürü yukarı taşır', /^figure-1,pA,/.test(toolbar.orderAfterUp), toolbar.orderAfterUp);
    ok('toolbar figürü aşağı taşır (geri)', /^pA,figure-1,/.test(toolbar.orderAfterDown), toolbar.orderAfterDown);

    // Delete via toolbar (confirmAction auto-accepted).
    const afterDelete = await page.evaluate(async () => {
      window.confirmAction = async () => true; // auto-confirm
      const v = document.getElementById('ft-visual');
      _showMediaCtl(v.querySelector('#table-1'), v);
      document.getElementById('media-block-ctl').querySelector('[data-mbc="delete"]').click();
      await new Promise((r) => setTimeout(r, 50));
      return { hasTable: !!v.querySelector('#table-1'), hasFig: !!v.querySelector('#figure-1') };
    });
    ok('toolbar tabloyu siler', afterDelete.hasTable === false);
    ok('toolbar silme figüre dokunmaz', afterDelete.hasFig === true);

    // ── 14) Dosyalar figür dialog "Kaydet" auto-syncs the full text ──
    const sync = await page.evaluate(async () => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>x</p>' +
        '<figure id="figure-1" class="article-figure"><img src="images/articles/9990050/test.png" alt="">' +
        '<p contenteditable="false"><strong>FIG. 1.</strong> Eski</p></figure>';
      window._articleAssets = { figures: [], supplementary: [] };
      // Reset any leftover saved meta so the default computes from scratch.
      await fetch('/api/media/article/9990050/figure-meta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'test.png', caption: '', label: '' }) }).catch(() => {});
      openFigureInsertDialog('images/articles/9990050/test.png', 'test.png');
      for (let i = 0; i < 60; i++) { if (document.querySelector('.modal-overlay #fig-dlg-label')) break; await new Promise((r) => setTimeout(r, 40)); }
      const o = document.querySelector('.modal-overlay');
      const dflt = o.querySelector('#fig-dlg-label').value;       // should be "FIG. 1"
      o.querySelector('#fig-dlg-label').value = 'Şekil 9';
      o.querySelector('#fig-dlg-caption').value = 'Yeni açıklama';
      o.querySelector('[data-action="save"]').click();
      for (let i = 0; i < 60; i++) { if (!document.querySelector('.modal-overlay')) break; await new Promise((r) => setTimeout(r, 40)); }
      await new Promise((r) => setTimeout(r, 200));
      const fig = v.querySelector('#figure-1');
      return { dflt, attr: fig.getAttribute('data-label'), cap: fig.querySelector('p').innerHTML };
    });
    ok('Dosyalar figür etiketi varsayılanı "FIG. 1"', sync.dflt === 'FIG. 1', sync.dflt);
    ok('Dosyalar kaydı tam metni otomatik günceller (data-label="Şekil 9")', sync.attr === 'Şekil 9', sync.attr);
    ok('Dosyalar kaydı caption verbatim render eder', /^<strong>Şekil 9\.<\/strong> Yeni açıklama/.test(sync.cap), sync.cap);

    // ── 15) Sub-lettered cross-reference linking ("Table 1a") ──
    // (a) plain prose "Table 1a" auto-links the WHOLE thing to #table-1.
    const al = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>Bkz. (Table 1a) detay.</p>' +
        '<div class="article-table-wrap" id="table-1" data-label="Table 1a"><p class="table-label" contenteditable="false"><strong>Table 1a.</strong> X</p><table class="article-table"><tbody><tr><td>a</td></tr></tbody></table></div>';
      _ensureMediaIds(v); _autoLinkInEditor(v);
      const a = v.querySelector('p a.article-media-ref-link');
      return { text: a ? a.textContent : null, href: a ? a.getAttribute('href') : null };
    });
    ok('auto-link "Table 1a" tümünü sarar → #table-1', al.text === 'Table 1a' && al.href === '#table-1', JSON.stringify(al));

    // (b) a PARTIAL link ("Table 1" + stray "a") is healed into "Table 1a".
    const ext = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>Bkz. (<a href="#table-1" class="article-media-ref-link">Table 1</a>a) detay.</p>' +
        '<div class="article-table-wrap" id="table-1"><p class="table-label" contenteditable="false"><strong>Table 1a.</strong> X</p><table class="article-table"><tbody><tr><td>a</td></tr></tbody></table></div>';
      _autoLinkInEditor(v);
      const a = v.querySelector('p a.article-media-ref-link');
      return { text: a ? a.textContent : null, after: a && a.nextSibling ? a.nextSibling.nodeValue : null };
    });
    ok('kısmi link "Table 1"+"a" → "Table 1a"', ext.text === 'Table 1a', ext.text);
    ok('kısmi link kalan metin ") detay."', /^\) detay\./.test(ext.after || ''), JSON.stringify(ext.after));

    // (c) extension must NOT swallow a real word ("Table 1 are ...").
    const noEat = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p><a href="#table-1" class="article-media-ref-link">Table 1</a> are shown.</p>' +
        '<div class="article-table-wrap" id="table-1"><p class="table-label" contenteditable="false"><strong>Table 1.</strong> X</p><table class="article-table"><tbody><tr><td>a</td></tr></tbody></table></div>';
      _autoLinkInEditor(v);
      const a = v.querySelector('p a.article-media-ref-link');
      return a ? a.textContent : null;
    });
    ok('extension kelimeyi yutmaz ("Table 1" kalır)', noEat === 'Table 1', noEat);

    // (d) insertCrossRef uses the target's manual label as the default text.
    const icr = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p id="pp">yer </p>' +
        '<div class="article-table-wrap" id="table-1" data-label="Table 1a"><p class="table-label" contenteditable="false"><strong>Table 1a.</strong> X</p><table class="article-table"><tbody><tr><td>a</td></tr></tbody></table></div>';
      const pp = document.getElementById('pp');
      const r = document.createRange(); r.selectNodeContents(pp); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      _crossRefSelection['ft'] = { range: r.cloneRange(), text: '' };
      insertCrossRef('ft', 'table', 1);
      const a = v.querySelector('a.article-media-ref-link');
      return { text: a ? a.textContent : null, href: a ? a.getAttribute('href') : null };
    });
    ok('insertCrossRef manuel etiketi kullanır ("Table 1a")', icr.text === 'Table 1a' && icr.href === '#table-1', JSON.stringify(icr));

    // ── 16) Autosave: input writes a localStorage draft; clear removes it ──
    const as = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML = '<p>autosave içerik</p>';
      _setupFtAutosave('ft', 'TESTID');
      v.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise((res) => setTimeout(() => {
        const raw = localStorage.getItem('bmj_ftdraft_ft_TESTID');
        res({ saved: !!raw, hasHtml: raw ? JSON.parse(raw).html.indexOf('autosave içerik') >= 0 : false });
      }, 1700));
    });
    ok('autosave localStorage taslağı yazar', as.saved && as.hasHtml);
    const asClear = await page.evaluate(() => { _clearFtDraft('ft', 'TESTID'); return localStorage.getItem('bmj_ftdraft_ft_TESTID'); });
    ok('autosave temizleme çalışır', asClear === null);

    // ── 17) Preflight detects broken refs, unreferenced figure, empty caption ──
    const pf = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p>Metin (Table 1).</p>' +
        '<p>Kırık: <a href="#figure-9" class="article-media-ref-link">Figure 9</a>.</p>' +
        '<figure id="figure-1" class="article-figure"><img src="f.png" alt=""><p contenteditable="false"><strong>FIG. 1.</strong> </p></figure>' +
        '<div class="article-table-wrap" id="table-1"><p class="table-label" contenteditable="false"><strong>Table 1.</strong> Veri</p><table class="article-table"><tbody><tr><td>x</td></tr></tbody></table></div>';
      window._articleAssets = { figures: [], supplementary: [] };
      _ensureMediaIds(v); _autoLinkInEditor(v);
      const issues = _collectPreflightIssues(v);
      return {
        broken: issues.some((i) => i.level === 'error' && /#figure-9/.test(i.msg)),
        figUnref: issues.some((i) => /Figür 1 tanımlı ama metinde hiç atıf/.test(i.msg)),
        figEmpty: issues.some((i) => /figure-1 açıklaması boş/.test(i.msg)),
        tableNotFlagged: !issues.some((i) => /Tablo 1 tanımlı ama metinde hiç atıf/.test(i.msg)),
      };
    });
    ok('preflight kırık atıfı yakalar', pf.broken);
    ok('preflight atıfsız figürü yakalar', pf.figUnref);
    ok('preflight boş figür açıklamasını yakalar', pf.figEmpty);
    ok('preflight atıf alan tabloyu işaretlemez', pf.tableNotFlagged);

    // ── 18) Reader preview opens an iframe with the draft + public CSS ──
    const rp = await page.evaluate(async () => {
      document.querySelectorAll('.modal-overlay').forEach((o) => o.remove());
      const v = document.getElementById('ft-visual');
      v.innerHTML = '<p>onizleme-icerik-XYZ</p>';
      await _openReaderPreview('ft');
      const frame = document.getElementById('reader-pv-frame');
      return { hasFrame: !!frame, contentIn: frame ? frame.srcdoc.indexOf('onizleme-icerik-XYZ') >= 0 : false, cssIn: frame ? /style\.css/.test(frame.srcdoc) : false };
    });
    ok('okuyucu önizleme iframe açar', rp.hasFrame);
    ok('önizleme içeriği iframe srcdoc içinde', rp.contentIn);
    ok('önizleme public CSS bağlar', rp.cssIn);

    // ── 19) Media manager lists blocks + applies label/caption to a table ──
    const mm = await page.evaluate(async () => {
      document.querySelectorAll('.modal-overlay').forEach((o) => o.remove());
      const v = document.getElementById('ft-visual');
      v.removeAttribute('data-article-id');
      v.innerHTML =
        '<div class="article-table-wrap" id="table-1"><p class="table-label" contenteditable="false"><strong>Table 1.</strong> Eski</p><table class="article-table"><tbody><tr><td>x</td></tr></tbody></table></div>';
      window._articleAssets = { figures: [], supplementary: [] };
      _openMediaManager('ft');
      const o = document.querySelector('.modal-overlay');
      const hasRow = !!o.querySelector('.mm-label');
      o.querySelector('.mm-label[data-idx="0"]').value = 'Tablo 1a';
      o.querySelector('.mm-caption[data-idx="0"]').value = 'Yeni başlık';
      o.querySelector('.mm-apply[data-idx="0"]').click();
      await new Promise((r) => setTimeout(r, 80));
      const blk = v.querySelector('#table-1');
      return { hasRow, attr: blk.getAttribute('data-label'), text: blk.querySelector('.table-label').textContent };
    });
    ok('medya yöneticisi satır listeler', mm.hasRow);
    ok('medya yöneticisi etiketi uygular ("Tablo 1a")', mm.attr === 'Tablo 1a', mm.attr);
    ok('medya yöneticisi başlığı uygular', /^Tablo 1a\. Yeni başlık/.test(mm.text), mm.text);

    // ── 20) Crossref Vancouver formatter ──
    const fv = await page.evaluate(() => {
      const w = { author: [{ family: 'Smith', given: 'John A' }, { family: 'Doe', given: 'R' }], title: ['A Study of Things'], 'container-title': ['JAMA'], issued: { 'date-parts': [[2026, 5, 1]] }, volume: '12', issue: '3', page: '100-110' };
      return _formatVancouver(w, '10.1000/xyz');
    });
    ok('Crossref Vancouver formatı', /^Smith JA, Doe R\. A Study of Things\. JAMA\. 2026;12\(3\):100-110\. doi:10\.1000\/xyz\.$/.test(fv), fv);
    const badDoi = await page.evaluate(async () => { try { await _fetchCrossrefCitation('not-a-doi'); return 'no-throw'; } catch (_) { return 'threw'; } });
    ok('geçersiz DOI hata verir', badDoi === 'threw');

    // ── 21) Metadata preflight reads the edit-form fields ──
    const mp = await page.evaluate(() => {
      let host = document.getElementById('meta-test'); if (host) host.remove();
      host = document.createElement('div'); host.id = 'meta-test'; document.body.appendChild(host);
      host.innerHTML =
        '<input id="f-title" value=""><input id="f-doi" value=""><input id="f-keywords" value="a">' +
        '<input id="f-published" value="2026-06-01"><input id="f-volume" value="43"><input id="f-issue" value="1"><input id="f-pages" value="1-5">' +
        '<div class="author-row"><input class="au-name" value="Jane Doe"><input class="au-orcid" value=""><input class="au-aff-idx" value="1"></div>';
      const issues = _collectMetadataIssues('ft');
      host.remove();
      return {
        titleErr: issues.some((i) => i.level === 'error' && /Başlık boş/.test(i.msg)),
        doiWarn: issues.some((i) => /DOI girilmemiş/.test(i.msg)),
        orcidWarn: issues.some((i) => /ORCID'i yok/.test(i.msg)),
      };
    });
    ok('metadata preflight boş başlığı yakalar', mp.titleErr);
    ok('metadata preflight eksik DOI uyarır', mp.doiWarn);
    ok('metadata preflight eksik ORCID uyarır', mp.orcidWarn);

    // ── 22) Public page emits citation_author_orcid / institution meta ──
    try {
      const pub = await browser.newPage();
      await pub.goto(BASE + '/site/article.html?id=2811', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await new Promise((r) => setTimeout(r, 1500));
      const meta = await pub.evaluate(() => ({
        orcid: document.querySelectorAll('meta[name="citation_author_orcid"]').length,
        inst: document.querySelectorAll('meta[name="citation_author_institution"]').length,
        authors: document.querySelectorAll('meta[name="citation_author"]').length,
      }));
      await pub.close();
      ok('public: citation_author meta üretiliyor', meta.authors > 0, 'authors=' + meta.authors);
      ok('public: citation_author_orcid meta var', meta.orcid > 0, 'orcid=' + meta.orcid);
      ok('public: citation_author_institution meta var', meta.inst > 0, 'inst=' + meta.inst);
    } catch (e2) {
      ok('public ORCID meta testi (sayfa yüklenemedi — atlandı)', false, e2.message);
    }

    // ── 23) Curated (uploaded) deny-listed file still resolves as a figure ──
    const dl = await page.evaluate(() => {
      const r1 = _resolveMediaSequence([
        { filename: '19-25-f1.png', order: 0, caption: '', url: 'images/articles/2869/19-25-f1.png' },
        { filename: 'cover.jpg', order: 1, caption: 'cover', url: 'images/articles/2869/cover.jpg' },
      ]);
      const r2 = _resolveMediaSequence([
        { filename: 'cover.jpg', order: null, caption: '', url: 'x/cover.jpg' }, // stray, never uploaded
      ]);
      return {
        figCount: r1.figure.length,
        files: r1.figure.map((b) => b.panels[0].filename),
        nums: r1.figure.map((b) => b.num),
        strayDropped: r2.figure.length === 0,
      };
    });
    ok('yüklenmiş (order\'lı) cover.jpg figür olarak dahil', dl.figCount === 2 && dl.files.indexOf('cover.jpg') >= 0, JSON.stringify(dl));
    ok('iki figür de numara alır (1 ve 2)', dl.nums.indexOf(1) >= 0 && dl.nums.indexOf(2) >= 0, JSON.stringify(dl.nums));
    ok('order\'sız stray cover hâlâ atılır', dl.strayDropped);

    // ── 24) formatBlock heading strips Word inline font styling so the level applies ──
    const hf = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML = '<p id="hp" style="font-size:16pt;font-weight:bold;text-align:center"><b><span style="font-size:16pt;font-family:Calibri;color:#1f3864">Methods</span></b></p>';
      const p = document.getElementById('hp');
      const r = document.createRange(); r.selectNodeContents(p);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      htmlEditorCmd('ft', 'formatBlock', '<h3>');
      const h = v.querySelector('h3');
      return {
        isH: !!h,
        blockFont: h ? /font-size|font-family|color|font-weight/i.test(h.getAttribute('style') || '') : null,
        keptAlign: h ? /text-align/i.test(h.getAttribute('style') || '') : null,
        descFont: h ? Array.from(h.querySelectorAll('[style]')).some((e) => /font-size|font-family|color/i.test(e.getAttribute('style') || '')) : null,
        text: h ? h.textContent.trim() : null,
      };
    });
    ok('formatBlock H3 uygulanır', hf.isH);
    ok('H3 blokta çakışan inline font stili kalmaz', hf.blockFont === false, JSON.stringify(hf));
    ok('H3 font-olmayan stil (text-align) korunur', hf.keptAlign === true);
    ok('H3 içi span font stilleri temizlenir', hf.descFont === false);
    ok('başlık metni korunur', hf.text === 'Methods');

    // ── 25) Paste-time heading level detection (H3 main / H4 sub) ──
    const ph = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      // (a) font-size signal: 16pt → H3 (main), 13pt → H4 (sub)
      v.innerHTML =
        '<p><b><span style="font-size:16pt">Introduction</span></b></p>' +
        '<p>body</p>' +
        '<p><b><span style="font-size:13pt">Statistical Analysis</span></b></p>';
      _promoteMsoHeadings(v);
      const a = Array.from(v.querySelectorAll('h3,h4')).map((h) => h.tagName + ':' + h.textContent);
      // (b) caps split, no size: ALLCAPS → H3, Title Case → H4
      v.innerHTML = '<p><b>MATERIALS AND METHODS</b></p><p>x</p><p><b>Patient selection</b></p>';
      _promoteMsoHeadings(v);
      const b = Array.from(v.querySelectorAll('h3,h4')).map((h) => h.tagName + ':' + h.textContent);
      // (c) uniform, no signal → legacy all-H3 (no regression)
      v.innerHTML = '<p><b>RESULTS</b></p><p>x</p><p><b>DISCUSSION</b></p>';
      _promoteMsoHeadings(v);
      const c = Array.from(v.querySelectorAll('h3,h4')).map((h) => h.tagName);
      // (d) THREE distinct sizes → H3 / H4 / H5 (3rd level honored)
      v.innerHTML =
        '<p><b><span style="font-size:16pt">Methods</span></b></p>' +
        '<p><b><span style="font-size:13pt">Study Design</span></b></p>' +
        '<p><b><span style="font-size:11pt">Statistics</span></b></p>';
      _promoteMsoHeadings(v);
      const d = Array.from(v.querySelectorAll('h3,h4,h5,h6')).map((h) => h.tagName);
      // (e) never emits an unstyled h2
      const noH2 = v.querySelectorAll('h2').length === 0;
      return { a, b, c, d, noH2 };
    });
    ok('boyut sinyali: 16pt→H3, 13pt→H4', JSON.stringify(ph.a) === JSON.stringify(['H3:Introduction', 'H4:Statistical Analysis']), JSON.stringify(ph.a));
    ok('caps split: ALLCAPS→H3, TitleCase→H4', ph.b[0] === 'H3:Materials and Methods' && ph.b[1] === 'H4:Patient Selection', JSON.stringify(ph.b));
    ok('tekdüze sinyalsiz → hepsi H3 (legacy korunur)', ph.c.join(',') === 'H3,H3', JSON.stringify(ph.c));
    ok('üç boyut → H3/H4/H5 (3. seviye onurlanır)', JSON.stringify(ph.d) === JSON.stringify(['H3', 'H4', 'H5']), JSON.stringify(ph.d));
    ok('asla stilsiz H2 üretilmez', ph.noH2 === true);

    // ── 26) Rich paste immediately promotes headings (_afterRichPaste) ──
    const arp = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML =
        '<p><b><span style="font-size:15pt">Discussion</span></b></p>' +
        '<p>metin</p><p><b><span style="font-size:12pt">Limitations</span></b></p>';
      _afterRichPaste(v); // simulates the post-paste hook
      return Array.from(v.querySelectorAll('h3,h4')).map((h) => h.tagName + ':' + h.textContent);
    });
    ok('paste sonrası başlıklar anında promote olur (H3/H4)', JSON.stringify(arp) === JSON.stringify(['H3:Discussion', 'H4:Limitations']), JSON.stringify(arp));

    // ── 27) Supplementary cross-references (scan + insert) ──
    const supp = await page.evaluate(() => {
      let host = document.getElementById('supp-test'); if (host) host.remove();
      host = document.createElement('div'); host.id = 'supp-test'; document.body.appendChild(host);
      host.innerHTML =
        '<div class="supp-link-row" data-supp-id=""><input class="sl-label" value="Table S1"><input class="sl-href" value="img/files/s1.pdf"><input class="sl-caption" value=""></div>' +
        '<div class="supp-link-row" data-supp-id="supp5"><input class="sl-label" value="Video S2"><input class="sl-href" value="img/files/s2.mp4"><input class="sl-caption" value=""></div>';
      const v = document.getElementById('ft-visual');
      v.innerHTML = '<p id="pp">yer </p>';
      const t = _scanCrossRefTargets('ft');
      const firstId = host.querySelector('.supp-link-row').getAttribute('data-supp-id');
      const pp = document.getElementById('pp');
      const r = document.createRange(); r.selectNodeContents(pp); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      _crossRefSelection['ft'] = { range: r.cloneRange(), text: '' };
      insertCrossRef('ft', 'supp', t.supp[0].id);
      const a = v.querySelector('a.article-supp-ref-link');
      const res = {
        count: t.supp.length, ids: t.supp.map((x) => x.id), labels: t.supp.map((x) => x.label),
        firstId, aHref: a ? a.getAttribute('href') : null, aText: a ? a.textContent : null,
        aClass: a ? a.className : null, broken: a ? a.classList.contains('article-ref-broken') : null,
      };
      host.remove();
      return res;
    });
    ok('scan supp hedefleri döndürür', supp.count === 2 && supp.labels.join(',') === 'Table S1,Video S2', JSON.stringify(supp));
    ok('id-siz satıra supp1 atanır + yazılır', supp.firstId === 'supp1' && supp.ids[0] === 'supp1', JSON.stringify(supp.ids) + ' first=' + supp.firstId);
    ok('mevcut id korunur (supp5)', supp.ids[1] === 'supp5', JSON.stringify(supp.ids));
    ok('insertCrossRef supp → #supp1', supp.aHref === '#supp1' && supp.aText === 'Table S1', JSON.stringify({ h: supp.aHref, t: supp.aText }));
    ok('supp link article-supp-ref-link sınıfı alır', /article-supp-ref-link/.test(supp.aClass || ''), supp.aClass);
    ok('hedef satır mevcut → kırık değil', supp.broken === false);

    // ── 30) Figure size adjustable from the editor (media toolbar size selector) ──
    const szc = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML = '<figure id="figure-1" class="article-figure" data-size="medium"><img src="x.png" alt=""><p contenteditable="false"><strong>FIG. 1.</strong> cap</p></figure>';
      _initMediaBlockControls();
      const fig = v.querySelector('#figure-1');
      _showMediaCtl(fig, v);
      const tb = document.getElementById('media-block-ctl');
      const sel = tb.querySelector('.mbc-size');
      const reflects = sel ? sel.value === 'medium' : null;
      sel.value = 'large'; sel.dispatchEvent(new Event('change'));
      const after = fig.getAttribute('data-size');
      sel.value = 'full'; sel.dispatchEvent(new Event('change'));
      const after2 = fig.getAttribute('data-size');
      return { hasSel: !!sel, reflects, after, after2 };
    });
    ok('blok araç çubuğunda boyut seçici var', szc.hasSel === true);
    ok('seçici mevcut boyutu yansıtır (medium)', szc.reflects === true);
    ok('editörden boyut değişir (large)', szc.after === 'large', szc.after);
    ok('editörden boyut değişir (full)', szc.after2 === 'full', szc.after2);

    // ── 31) Toolbar reflects the selection's style (active state) ──
    const ts = await page.evaluate(() => {
      const v = document.getElementById('ft-visual');
      v.innerHTML = '<h3 id="hh">Methods</h3><p id="pp">body text</p>';
      const tb = document.getElementById('ft-toolbar');
      const hasDataCmd = tb.querySelectorAll('button[data-cmd]').length > 0;
      const fmt = () => Array.from(tb.querySelectorAll('button[data-cmd="formatBlock"]'))
        .map((b) => ({ v: (b.dataset.val || '').replace(/[<>]/g, ''), a: b.classList.contains('is-active') }));
      const caretIn = (id) => { const r = document.createRange(); r.selectNodeContents(document.getElementById(id)); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };
      caretIn('hh'); _updateHtmlEditorToolbarState(v);
      const inH3 = fmt();
      caretIn('pp'); _updateHtmlEditorToolbarState(v);
      const inP = fmt();
      return { hasDataCmd, inH3, inP };
    });
    ok('toolbar butonları data-cmd taşır', ts.hasDataCmd === true);
    ok('H3 içindeyken H3 aktif, H4/P değil', !!ts.inH3.find((x) => x.v === 'h3' && x.a) && !ts.inH3.find((x) => x.v === 'h4' && x.a) && !ts.inH3.find((x) => x.v === 'p' && x.a), JSON.stringify(ts.inH3));
    ok('imleç P\'ye geçince P aktif, H3 pasif', !!ts.inP.find((x) => x.v === 'p' && x.a) && !ts.inP.find((x) => x.v === 'h3' && x.a), JSON.stringify(ts.inP));

    // ── 28) Public page still builds (no JS error) with article.html supp edits ──
    try {
      const pub = await browser.newPage();
      const errs = [];
      pub.on('pageerror', (e) => errs.push(e.message));
      await pub.goto(BASE + '/site/article.html?id=2811', { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2000));
      // Deterministic checks for the supplementary edits: a #suppN element gets the
      // sticky-offset scroll-margin (my CSS rule) so in-text refs land correctly.
      const pubChk = await pub.evaluate(() => {
        const li = document.createElement('li'); li.id = 'supp1'; document.body.appendChild(li);
        const sm = parseFloat(getComputedStyle(li).scrollMarginTop) || 0;
        li.remove();
        return { suppScrollMargin: sm, bodyHas: !!document.querySelector('.article-body') };
      });
      await pub.close();
      ok('public sayfa hatasız yüklenir (article.html düzenlemeleri)', errs.length === 0, errs.join(' | '));
      ok('public gövde render edildi', pubChk.bodyHas === true);
      ok('supp çapasına sticky scroll-margin uygulanır', pubChk.suppScrollMargin > 0, 'sm=' + pubChk.suppScrollMargin);

      // ── 29) Heading outline panel: list, level-check, flash, fix ──
      const ho = await page.evaluate(() => {
        const v = document.getElementById('ft-visual');
        v.innerHTML = '<h2>Intro</h2><p>x</p><h3 style="font-size:16pt">Methods</h3><p>y</p><h4>Sub</h4>';
        _openHeadingOutline('ft');
        const panel = document.getElementById('heading-outline');
        const setLvl = (idx, L) => { const s = panel.querySelector('.ho-row[data-idx="' + idx + '"] .ho-sel'); s.value = String(L); s.dispatchEvent(new Event('change')); };
        const badges = Array.from(panel.querySelectorAll('.ho-badge')).map((b) => b.textContent);
        const warnFirst = panel.querySelector('.ho-row[data-idx="0"] .ho-text').textContent.indexOf('⚠') >= 0;
        const summaryIssue = /sorun/.test(panel.querySelector('.ho-summary').textContent);
        const levelOptions = panel.querySelector('.ho-sel') ? Array.from(panel.querySelector('.ho-sel').options).map((o) => o.value) : [];
        // flash heading idx 2 (Sub)
        panel.querySelector('.ho-row[data-idx="2"] .ho-go').click();
        const flashed = !!v.querySelector('.outline-flash');
        // fix H2(idx0) → H3
        setLvl(0, 3);
        const firstNow = v.children[0].tagName;
        // demote the 16pt H3(Methods, now idx1) → H5 (3rd level) + confirm font stripped
        document.getElementById('heading-outline').querySelector('.ho-row[data-idx="1"] .ho-sel').value = '5';
        document.getElementById('heading-outline').querySelector('.ho-row[data-idx="1"] .ho-sel').dispatchEvent(new Event('change'));
        const methods = Array.from(v.querySelectorAll('h3,h4,h5,h6')).find((h) => /Methods/.test(h.textContent));
        const res = {
          badges, warnFirst, summaryIssue, flashed, firstNow, levelOptions,
          methodsTag: methods ? methods.tagName : null,
          methodsFont: methods ? /font-size/i.test(methods.getAttribute('style') || '') : null,
        };
        _closeHeadingOutline();
        return res;
      });
      ok('outline başlıkları listeler (H2/H3/H4)', JSON.stringify(ho.badges) === JSON.stringify(['H2', 'H3', 'H4']), JSON.stringify(ho.badges));
      ok('düzey seçici H3–H6 sunar', JSON.stringify(ho.levelOptions) === JSON.stringify(['3', '4', '5', '6']), JSON.stringify(ho.levelOptions));
      ok('H2 düzey sorunu işaretlenir', ho.warnFirst === true);
      ok('özet düzey sorunu bildirir', ho.summaryIssue === true);
      ok('satıra tıklayınca editörde vurgulanır (outline-flash)', ho.flashed === true);
      ok('seçiciyle H2→H3 yapılır', ho.firstNow === 'H3', ho.firstNow);
      ok('3. seviye (H5) atanabilir + inline font silinir', ho.methodsTag === 'H5' && ho.methodsFont === false, JSON.stringify({ t: ho.methodsTag, f: ho.methodsFont }));

      // ── 32) Public TOC reflects heading levels (indent + depth) ──
      const tp = await browser.newPage();
      const tErrs = [];
      tp.on('pageerror', (e) => tErrs.push(e.message));
      await tp.goto(BASE + '/site/article.html?id=2869', { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2500));
      const toc = await tp.evaluate(() => {
        const links = Array.from(document.querySelectorAll('#toc-nav a'));
        const depths = links.map((a) => Number(a.getAttribute('data-toc-depth')));
        const indented = links.filter((a) => parseFloat(a.style.paddingLeft || '0') > 0).length;
        return {
          count: links.length,
          firstDepth: depths[0],
          distinct: Array.from(new Set(depths)).sort(),
          indentedCount: indented,
          hasScrollFn: typeof window.scrollToArticleTarget === 'undefined' ? 'n/a' : 'ok',
        };
      });
      await tp.close();
      ok('public TOC çok seviyeli (≥2 derinlik)', toc.distinct.length >= 2, JSON.stringify(toc.distinct));
      ok('TOC ilk giriş üst düzey (depth 0)', toc.firstDepth === 0, 'first=' + toc.firstDepth);
      ok('alt başlıklar girintili', toc.indentedCount > 0, 'indented=' + toc.indentedCount);
      ok('TOC public hatasız', tErrs.length === 0, tErrs.join(' | '));

      // ── 33) Reference list font is unified (Word inline fonts stripped,
      //        italic/color emphasis kept) so hand-typed + pasted refs match ──
      const rf = await page.evaluate(() => {
        const ol = document.createElement('ol');
        ol.className = 'article-references-ol';
        ol.innerHTML =
          '<li style="font-family:\'Times New Roman\';font-size:12pt;line-height:1.5;color:#222">' +
            'A. <i style="font-family:Times;font-size:12pt">J Foo.</i> 2025.</li>' +
          '<li><span style="font-family:Calibri;font-size:11pt">B paste.</span> ' +
            '<em style="font-style:italic">Med J.</em> 2017.</li>' +
          '<li>C plain. <i>Balkan Med J.</i> 2025.</li>';
        const wrap = document.createElement('div');
        wrap.className = 'article-references';
        wrap.appendChild(ol);
        document.body.appendChild(wrap);
        const fn = typeof _normalizeReferenceFonts === 'function';
        if (fn) _normalizeReferenceFonts(ol);
        const out = {
          fn,
          leftoverFont: (ol.innerHTML.toLowerCase().match(/font-family|font-size/g) || []).length,
          italics: ol.querySelectorAll('i, em').length,
          colorKept: /color\s*:/.test(ol.querySelector('li').getAttribute('style') || ''),
        };
        wrap.remove();
        return out;
      });
      ok('kaynak font normalizasyonu mevcut', rf.fn === true);
      ok('inline font-family/size silinir (sabit liste fontu)', rf.leftoverFont === 0, 'leftover=' + rf.leftoverFont);
      ok('italik (i/em) vurgusu korunur', rf.italics === 3, 'italics=' + rf.italics);
      ok('renk (color) korunur', rf.colorKept === true);

      // ── 34) MsoListParagraph tail-absorb: the last reference, typed as a
      //        plain MsoNormal/Calibri <p> (not in the list), is still picked
      //        up; a trailing non-reference paragraph is NOT swallowed ──
      const tr = await page.evaluate(() => {
        const d = document.createElement('div');
        d.id = 'tmp-tail-visual';
        d.innerHTML =
          '<h3 class="MsoNormal"><b>REFERENCES</b></h3>' +
          '<p class="MsoListParagraph"><span style="mso-ansi-language:EN-US">Merton RK. <i>Science</i>. 1968;159:56-63.</span></p>' +
          '<p class="MsoListParagraph"><span style="mso-ansi-language:EN-US">Gomez CJ. <i>Nat Hum Behav</i>. 2022;6:919-929.</span></p>' +
          '<p class="MsoNormal"><span style="font-size:11.0pt;font-family:&quot;Calibri&quot;,sans-serif">Korkmaz S. Statistical rigor. <i>Balkan Med J.</i> 2025;42:386-387.</span></p>' +
          '<p class="MsoNormal">The authors declare no conflict of interest.</p>';
        document.body.appendChild(d);
        const ok2 = _normalizeMsoReferenceList(d);
        const lis = Array.from(d.querySelectorAll('.article-references ol > li'));
        const out = {
          ok2,
          count: lis.length,
          lastText: (lis[lis.length - 1] ? lis[lis.length - 1].textContent : '').slice(0, 20),
          lastHasFont: /font-family|font-size/i.test(lis[lis.length - 1] ? lis[lis.length - 1].innerHTML : ''),
          coiAbsorbed: lis.some((li) => /conflict of interest/i.test(li.textContent || '')),
        };
        d.remove();
        return out;
      });
      ok('MsoNormal son kaynak absorbe edilir (tail-absorb)', tr.ok2 === true && tr.count === 3, JSON.stringify({ ok: tr.ok2, n: tr.count }));
      ok('absorbe edilen son kaynak doğru', /^Korkmaz/.test(tr.lastText), tr.lastText);
      ok('absorbe edilen kaynağın Calibri fontu silinir', tr.lastHasFont === false);
      ok('kaynak-olmayan paragraf absorbe edilmez', tr.coiAbsorbed === false);

      // ── 35) Whole-body typeface is unified: inline font-family stripped,
      //        font-size / weight / style / color kept ──
      const bf = await page.evaluate(() => {
        const fn = typeof _unifyBodyFont === 'function';
        const d = document.createElement('div');
        d.innerHTML =
          '<p>Normal. <span style="font-family:Calibri;font-size:14pt;line-height:2;color:#c00"><b>Bold</b></span> tail.</p>' +
          '<p style="font-family:&quot;Times New Roman&quot;;mso-foo:bar"><i>Para</i></p>';
        if (fn) _unifyBodyFont(d);
        return {
          fn,
          leftoverFamily: (d.innerHTML.toLowerCase().match(/font-family/g) || []).length,
          sizeKept: /font-size\s*:\s*14pt/i.test(d.innerHTML),
          colorKept: /color\s*:\s*#c00/i.test(d.innerHTML),
          boldKept: d.querySelectorAll('b').length,
          italicKept: d.querySelectorAll('i').length,
        };
      });
      ok('_unifyBodyFont mevcut', bf.fn === true);
      ok('gövde inline font-family silinir (sabit typeface)', bf.leftoverFamily === 0, 'leftover=' + bf.leftoverFamily);
      ok('gövde font-size korunur', bf.sizeKept === true);
      ok('gövde color/bold/italic korunur', bf.colorKept && bf.boldKept === 1 && bf.italicKept === 1, JSON.stringify(bf));

      // ── 36) Date fields accept copy-paste: parser + real Ctrl+V into a
      //        native <input type="date"> sets the yyyy-mm-dd value ──
      const dpParse = await page.evaluate(() => {
        const fn = typeof _parsePastedDateToISO === 'function' && _datePasteBound === true;
        return {
          fn,
          ddmmyyyy: _parsePastedDateToISO('01.06.2026'),
          iso: _parsePastedDateToISO('2026-06-01'),
          slash: _parsePastedDateToISO('31/12/2025'),
          twoDigit: _parsePastedDateToISO('15.03.24'),
          monthName: _parsePastedDateToISO('1 June 2026'),
          invalid: _parsePastedDateToISO('13.13.2026'),
          junk: _parsePastedDateToISO('garbage'),
        };
      });
      ok('tarih parser + paste handler bağlı', dpParse.fn === true);
      ok('GG.AA.YYYY → ISO', dpParse.ddmmyyyy === '2026-06-01', dpParse.ddmmyyyy);
      ok('ISO korunur', dpParse.iso === '2026-06-01', dpParse.iso);
      ok('GG/AA/YYYY → ISO', dpParse.slash === '2025-12-31', dpParse.slash);
      ok('2 haneli yıl → 20yy', dpParse.twoDigit === '2024-03-15', dpParse.twoDigit);
      ok('ay adı çözülür', dpParse.monthName === '2026-06-01', dpParse.monthName);
      ok('geçersiz/çöp tarih null döner', dpParse.invalid === null && dpParse.junk === null);
      // Real keyboard paste into a native date input via clipboard copy gesture.
      const realPaste = await page.evaluate(() => {
        const src = document.createElement('input'); src.type = 'text'; src.id = '__dp-src'; src.value = '01.06.2026';
        const dst = document.createElement('input'); dst.type = 'date'; dst.id = '__dp-dst';
        document.body.appendChild(src); document.body.appendChild(dst);
      });
      await page.focus('#__dp-src');
      await page.evaluate(() => document.getElementById('__dp-src').select());
      await page.keyboard.down('Control'); await page.keyboard.press('KeyC'); await page.keyboard.up('Control');
      await page.focus('#__dp-dst');
      await page.keyboard.down('Control'); await page.keyboard.press('KeyV'); await page.keyboard.up('Control');
      await new Promise((r) => setTimeout(r, 150));
      const pastedVal = await page.evaluate(() => {
        const v = document.getElementById('__dp-dst').value;
        document.getElementById('__dp-src').remove(); document.getElementById('__dp-dst').remove();
        return v;
      });
      ok('gerçek Ctrl+V date input değerini set eder', pastedVal === '2026-06-01', 'val=' + pastedVal);

      // ── 37) TOC overflow solved: capped height + internal scroll, long
      //        titles wrap (no horizontal overflow), sections collapse/expand ──
      const tcp = await browser.newPage();
      const tcErrs = [];
      tcp.on('pageerror', (e) => tcErrs.push(e.message));
      await tcp.setViewport({ width: 1280, height: 800 });
      await tcp.goto(BASE + '/site/article.html?id=2869', { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2500));
      const tc = await tcp.evaluate(() => {
        const nav = document.getElementById('toc-nav');
        if (!nav) return { err: 'no nav' };
        const cs = getComputedStyle(nav);
        const links = Array.from(nav.querySelectorAll('a'));
        const groups = Array.from(nav.querySelectorAll('.toc-group'));
        const navRect = nav.getBoundingClientRect();
        const overflowX = links.some((a) => a.getBoundingClientRect().right > navRect.right + 1);
        // Pick a caret group that the scroll-spy hasn't auto-opened (avoid the
        // currently-active first section) so we can verify the default state.
        const g = groups.filter((x) => x.querySelector('.toc-caret')).find((x) => x.classList.contains('collapsed'))
          || groups.find((x) => x.querySelector('.toc-caret'));
        const defaultCollapsed = !!(g && g.classList.contains('collapsed'));
        let expanded = null, reCollapsed = null;
        if (g) {
          const caret = g.querySelector('.toc-caret');
          caret.click(); void g.offsetHeight; expanded = !g.classList.contains('collapsed');
          caret.click(); void g.offsetHeight; reCollapsed = g.classList.contains('collapsed');
        }
        return {
          maxHeightPx: parseFloat(cs.maxHeight),
          overflowY: cs.overflowY,
          scrollable: nav.scrollHeight > nav.clientHeight,
          overflowX,
          hasCaret: !!g,
          defaultCollapsed,
          expanded,
          reCollapsed,
        };
      });
      await tcp.close();
      // Cap + internal-scroll mechanism is in place (actual scrolling only
      // kicks in when expanded content exceeds the cap; default-collapsed fits).
      ok('TOC yüksekliği sınırlı + iç kaydırma', tc.maxHeightPx > 0 && tc.overflowY === 'auto', JSON.stringify({ mh: tc.maxHeightPx, oy: tc.overflowY }));
      ok('TOC yatay taşma yok (başlıklar sarar)', tc.overflowX === false);
      ok('TOC bölümleri varsayılan katlanmış', tc.hasCaret === true && tc.defaultCollapsed === true, JSON.stringify(tc));
      ok('TOC bölümleri açılır/kapanır', tc.expanded === true && tc.reCollapsed === true, JSON.stringify(tc));
      ok('TOC katlama hatasız', tcErrs.length === 0, tcErrs.join(' | '));
    } catch (e3) {
      ok('public smoke testi', false, e3.message);
    }
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
