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
  } catch (e) {
    console.error('TEST ERROR:', e.stack || e.message);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
