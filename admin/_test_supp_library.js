// E2E test — Supplementary Library (#/supp-library).
//
// Verifies:
//   - Upload produces a permanent /img/files/<name> URL.
//   - Replace keeps the URL and only swaps file content (mtime changes).
//   - Rename moves the file to a new name.
//   - Delete removes the file.
//   - Public URL shown in the UI uses the production origin.
//
// Server must be running with BMJ_TEST_BYPASS_AUTH=1.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://localhost:3098';
const REPO_ROOT = path.resolve(__dirname, '..');
const SUPP_LIB_DIR = path.join(REPO_ROOT, 'img', 'files');

function pass(name) { console.log('  PASS:', name); }
function fail(name, detail) { console.log('  FAIL:', name, detail ? '— ' + detail : ''); process.exitCode = 1; }

const TEST_NAME = `bmj-test-supp-${Date.now()}.pdf`;
const TMP_DIR = path.join(__dirname, 'test-tmp-supp');
function writeFixture(name, bytes) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const p = path.join(TMP_DIR, name);
  fs.writeFileSync(p, bytes);
  return p;
}
function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

(async () => {
  // Minimal PDF stub — multer's filter checks both MIME and extension.
  // Puppeteer will provide MIME from extension lookup, which gives application/pdf.
  const pdfBytes = Buffer.from('%PDF-1.4\n%TEST FIXTURE\n%%EOF\n');
  const replaceBytes = Buffer.from('%PDF-1.4\n%TEST FIXTURE REPLACED CONTENT\n%%EOF\n');
  const fixtureA = writeFixture('fixture-a.pdf', pdfBytes);
  const fixtureB = writeFixture('fixture-b.pdf', replaceBytes);

  // Pre-clean: make sure the test file isn't lingering from a prior run.
  if (fs.existsSync(path.join(SUPP_LIB_DIR, TEST_NAME))) {
    fs.unlinkSync(path.join(SUPP_LIB_DIR, TEST_NAME));
  }
  const renamedName = TEST_NAME.replace('.pdf', '-renamed.pdf');
  if (fs.existsSync(path.join(SUPP_LIB_DIR, renamedName))) {
    fs.unlinkSync(path.join(SUPP_LIB_DIR, renamedName));
  }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console.error]', m.text()); });

  try {
    // Pre-emptively confirm all modals (used by Replace/Rename/Delete).
    page.on('dialog', async (d) => { try { await d.accept(); } catch (_) {} });

    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 15000 });
    await page.evaluate(() => { window.location.hash = '#/supp-library'; });
    await new Promise((r) => setTimeout(r, 1500));
    await page.waitForSelector('#supp-lib-tbody', { timeout: 8000 });

    // ── T1: Upload via rename input (single file, custom name) ─────────────
    console.log('=== T1: Upload with custom name produces a permanent URL ===');
    await page.type('#supp-lib-rename', TEST_NAME);
    const fileInput = await page.$('#supp-lib-file-input');
    await fileInput.uploadFile(fixtureA);
    // Trigger change manually in case puppeteer's uploadFile doesn't fire it.
    await page.evaluate(() => {
      const el = document.getElementById('supp-lib-file-input');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 1200));

    // The row should now be in the table.
    const rowExists = await page.$(`tr[data-file="${TEST_NAME}"]`) !== null;
    if (rowExists) pass(`row appears in table: ${TEST_NAME}`);
    else fail('uploaded row missing from table');

    // The file must exist on disk at the expected permanent location.
    const filePath = path.join(SUPP_LIB_DIR, TEST_NAME);
    if (fs.existsSync(filePath)) pass(`file written at ${filePath}`);
    else fail('file missing on disk', filePath);

    // The URL shown to the user must be the production URL.
    const shownUrl = await page.$eval(`tr[data-file="${TEST_NAME}"] input[readonly]`, (el) => el.value);
    const expectedUrl = `https://balkanmedicaljournal.org/img/files/${encodeURIComponent(TEST_NAME)}`;
    if (shownUrl === expectedUrl) pass(`URL is production-host based: ${shownUrl}`);
    else fail('URL mismatch', `got=${shownUrl} expected=${expectedUrl}`);

    const initialHash = sha256(filePath);

    // ── T2: Conflict — re-uploading same name (without overwrite) is rejected ──
    console.log('=== T2: Duplicate upload reports a conflict ===');
    const dupForm = new FormData();
    // Use the in-page fetch API to send a single file matching the existing name.
    const conflictResult = await page.evaluate(async (name) => {
      const blob = new Blob(['%PDF-1.4\nDUP\n%%EOF'], { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('files', blob, name); // name preserves extension for MIME check
      const r = await fetch('/api/supp-library/upload', { method: 'POST', body: fd });
      return { status: r.status, body: await r.json() };
    }, TEST_NAME);
    if (conflictResult.body.conflicts && conflictResult.body.conflicts.length === 1
        && conflictResult.body.conflicts[0].name === TEST_NAME) {
      pass('duplicate upload (no overwrite) reports conflict, file untouched');
    } else {
      fail('expected conflict report', JSON.stringify(conflictResult.body));
    }
    // Sanity: bytes on disk must NOT have changed.
    if (sha256(filePath) === initialHash) pass('on-disk content unchanged after rejected duplicate');
    else fail('disk content changed on rejected duplicate');

    // ── T3: Replace — same name, new content, URL preserved ─────────────────
    console.log('=== T3: Replace content keeps URL, swaps bytes ===');
    const replaceResult = await page.evaluate(async (name) => {
      // Different bytes than the original fixture.
      const blob = new Blob(['%PDF-1.4\nREPLACED via /replace endpoint\n%%EOF'], { type: 'application/pdf' });
      const fd = new FormData();
      // The replace endpoint reuses the supplementary uploader which validates
      // by both MIME and extension — give the blob a .pdf filename.
      fd.append('file', blob, name);
      const r = await fetch('/api/supp-library/' + encodeURIComponent(name) + '/replace', { method: 'POST', body: fd });
      return { status: r.status, body: await r.json() };
    }, TEST_NAME);
    if (replaceResult.status === 200 && replaceResult.body.file && replaceResult.body.file.name === TEST_NAME) {
      pass('replace endpoint succeeded, file name preserved');
    } else fail('replace failed', JSON.stringify(replaceResult));

    const newHash = sha256(filePath);
    if (newHash !== initialHash) pass('on-disk content actually changed after replace');
    else fail('replace did not change content');

    // URL in the table must still match exactly.
    await page.evaluate(() => suppLibReloadTable());
    await new Promise((r) => setTimeout(r, 400));
    const afterReplaceUrl = await page.$eval(`tr[data-file="${TEST_NAME}"] input[readonly]`, (el) => el.value);
    if (afterReplaceUrl === expectedUrl) pass('URL unchanged after replace (permanence preserved)');
    else fail('URL changed after replace', `got=${afterReplaceUrl}`);

    // ── T4: Rename — file moves to new name ─────────────────────────────────
    console.log('=== T4: Rename moves the file ===');
    const renameResult = await page.evaluate(async (from, to) => {
      const r = await fetch('/api/supp-library/' + encodeURIComponent(from) + '/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      return { status: r.status, body: await r.json() };
    }, TEST_NAME, renamedName);
    if (renameResult.status === 200 && renameResult.body.file && renameResult.body.file.name === renamedName) {
      pass('rename endpoint returned new name');
    } else fail('rename failed', JSON.stringify(renameResult));
    if (!fs.existsSync(filePath) && fs.existsSync(path.join(SUPP_LIB_DIR, renamedName))) {
      pass('disk file moved old → new');
    } else fail('disk did not reflect rename');

    // ── T5: Delete — file gone from disk ────────────────────────────────────
    console.log('=== T5: Delete removes the file ===');
    const delResult = await page.evaluate(async (name) => {
      const r = await fetch('/api/supp-library/' + encodeURIComponent(name), { method: 'DELETE' });
      return { status: r.status, body: await r.json() };
    }, renamedName);
    if (delResult.status === 200 && delResult.body.deleted === renamedName) pass('delete endpoint reported success');
    else fail('delete failed', JSON.stringify(delResult));
    if (!fs.existsSync(path.join(SUPP_LIB_DIR, renamedName))) pass('disk file removed');
    else fail('file still on disk after delete');

    // ── T6: Filename sanitation — risky inputs are normalized or rejected ──
    console.log('=== T6: Filename sanitation ===');
    const sanResult = await page.evaluate(async () => {
      const out = {};
      // Trailing/leading whitespace + spaces in middle → hyphenated.
      const blob = new Blob(['x'], { type: 'application/pdf' });
      const fd1 = new FormData();
      fd1.append('files', blob, '  My  Awkward  Name (v2).pdf');
      const r1 = await fetch('/api/supp-library/upload?overwrite=true', { method: 'POST', body: fd1 });
      out.spaces = await r1.json();
      // Path traversal attempt — server must basename it.
      const fd2 = new FormData();
      fd2.append('files', blob, '../../../etc/passwd.pdf');
      const r2 = await fetch('/api/supp-library/upload?overwrite=true', { method: 'POST', body: fd2 });
      out.traversal = await r2.json();
      return out;
    });
    const spaceName = sanResult.spaces.uploaded && sanResult.spaces.uploaded[0] && sanResult.spaces.uploaded[0].name;
    if (spaceName && !/[\s()]/.test(spaceName) && /\.pdf$/.test(spaceName)) {
      pass(`spaces sanitized: "${spaceName}"`);
    } else fail('spaces not sanitized', JSON.stringify(sanResult.spaces));

    const traversalName = sanResult.traversal.uploaded && sanResult.traversal.uploaded[0] && sanResult.traversal.uploaded[0].name;
    if (traversalName && !traversalName.includes('/') && !traversalName.includes('..')) {
      pass(`path traversal stripped: "${traversalName}"`);
    } else fail('path traversal not stripped', JSON.stringify(sanResult.traversal));

    // Cleanup: delete the sanitation fixtures we just created.
    for (const n of [spaceName, traversalName].filter(Boolean)) {
      try {
        await page.evaluate(async (name) => fetch('/api/supp-library/' + encodeURIComponent(name), { method: 'DELETE' }), n);
      } catch (_) {}
    }

    // ── T7: Article-attached upload appends to article.supplementary[] ─────
    console.log('=== T7: Article-attached upload (two-button flow) ===');
    // Find an article we can mutate.
    const articleId = await page.evaluate(async () => {
      const r = await fetch('/api/articles?limit=1'); const d = await r.json();
      return d.articles && d.articles[0] ? String(d.articles[0].id) : null;
    });
    if (!articleId) {
      console.log('  SKIP: no article in dataset');
    } else {
      const linkedName = `bmj-test-linked-${Date.now()}.pdf`;
      // Capture initial supplementary[] length so we can verify the append.
      const beforeLen = await page.evaluate(async (id) => {
        const r = await fetch('/api/articles/' + id);
        const a = await r.json();
        return Array.isArray(a.supplementary) ? a.supplementary.length : 0;
      }, articleId);

      const linkResult = await page.evaluate(async ({ id, name }) => {
        const blob = new Blob(['%PDF-1.4\nLINKED\n%%EOF'], { type: 'application/pdf' });
        const fd = new FormData();
        fd.append('files', blob, name);
        fd.append('articleId', id);
        const r = await fetch('/api/supp-library/upload', { method: 'POST', body: fd });
        return { status: r.status, body: await r.json() };
      }, { id: articleId, name: linkedName });

      if (linkResult.status === 200
          && linkResult.body.uploaded && linkResult.body.uploaded[0]
          && linkResult.body.uploaded[0].name === linkedName) {
        pass('article-attached upload: file uploaded with permanent URL');
      } else fail('article-attached upload failed', JSON.stringify(linkResult));

      if (linkResult.body.articleLinked
          && !linkResult.body.articleLinked.error
          && linkResult.body.articleLinked.added && linkResult.body.articleLinked.added.length === 1) {
        const entry = linkResult.body.articleLinked.added[0];
        if (entry.href === `img/files/${linkedName}`) {
          pass(`article-attached upload: href=img/files/${linkedName} appended to article.supplementary[]`);
        } else {
          fail('appended entry href wrong', JSON.stringify(entry));
        }
      } else fail('articleLinked not returned correctly', JSON.stringify(linkResult.body.articleLinked));

      // Verify the append persisted on disk.
      const afterLen = await page.evaluate(async (id) => {
        const r = await fetch('/api/articles/' + id);
        const a = await r.json();
        return Array.isArray(a.supplementary) ? a.supplementary.length : 0;
      }, articleId);
      if (afterLen === beforeLen + 1) pass(`supplementary[] length grew by 1 (${beforeLen} → ${afterLen})`);
      else fail('supplementary[] length unchanged', `before=${beforeLen} after=${afterLen}`);

      // Unknown article ID must return an error in articleLinked without
      // blocking the file upload itself (file still gets a permanent link).
      const unknownResult = await page.evaluate(async () => {
        const blob = new Blob(['%PDF\n'], { type: 'application/pdf' });
        const fd = new FormData();
        fd.append('files', blob, `bmj-test-unknown-${Date.now()}.pdf`);
        fd.append('articleId', '999999999');
        const r = await fetch('/api/supp-library/upload', { method: 'POST', body: fd });
        return { status: r.status, body: await r.json() };
      });
      if (unknownResult.body.articleLinked && unknownResult.body.articleLinked.error === 'Article not found') {
        pass('unknown articleId reported as error in articleLinked');
      } else fail('unknown articleId not surfaced as error', JSON.stringify(unknownResult.body.articleLinked));
      if (unknownResult.body.uploaded && unknownResult.body.uploaded.length === 1) {
        pass('file still uploaded with permanent URL even when article unknown');
      } else fail('file upload blocked by unknown articleId (should not be)');

      // Cleanup: delete the linked file, the unknown-id file, and the appended
      // supplementary entry.
      await page.evaluate(async (n) => fetch('/api/supp-library/' + encodeURIComponent(n), { method: 'DELETE' }), linkedName);
      if (unknownResult.body.uploaded && unknownResult.body.uploaded[0]) {
        await page.evaluate(async (n) => fetch('/api/supp-library/' + encodeURIComponent(n), { method: 'DELETE' }), unknownResult.body.uploaded[0].name);
      }
      // Roll back the article.supplementary append so we leave no test residue.
      await page.evaluate(async ({ id, href }) => {
        const a = await (await fetch('/api/articles/' + id)).json();
        a.supplementary = (a.supplementary || []).filter((s) => s.href !== href);
        await fetch('/api/articles/' + id, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(a),
        });
      }, { id: articleId, href: `img/files/${linkedName}` });
    }

    // ── T8: The two pages are separate and each shows only its own scope ──
    console.log('=== T8: Two separate pages, each scoped correctly ===');

    // Page 1 — Bağımsız (#/supp-library). Has standalone uploader, NO article-id input.
    await page.evaluate(() => { window.location.hash = '#/supp-library'; });
    await new Promise((r) => setTimeout(r, 1200));
    const standalonePage = await page.evaluate(() => ({
      drop: !!document.getElementById('supp-lib-drop-standalone'),
      fileInput: !!document.getElementById('supp-lib-file-input'),
      noArticleIdInput: !document.getElementById('supp-lib-article-id'),
      noLinkedDrop: !document.getElementById('supp-lib-drop-article'),
    }));
    if (standalonePage.drop && standalonePage.fileInput && standalonePage.noArticleIdInput && standalonePage.noLinkedDrop) {
      pass('#/supp-library has standalone uploader only (no article ID input, no linked drop zone)');
    } else fail('#/supp-library structure wrong', JSON.stringify(standalonePage));

    // Page 2 — Makaleye Bağlı (#/supp-library-linked). Has article-id + linked uploader,
    // does NOT have the standalone drop zone.
    await page.evaluate(() => { window.location.hash = '#/supp-library-linked'; });
    await new Promise((r) => setTimeout(r, 1200));
    const linkedPage = await page.evaluate(() => ({
      drop: !!document.getElementById('supp-lib-drop-article'),
      fileInput: !!document.getElementById('supp-lib-file-input-article'),
      articleIdInput: !!document.getElementById('supp-lib-article-id'),
      noStandaloneDrop: !document.getElementById('supp-lib-drop-standalone'),
    }));
    if (linkedPage.drop && linkedPage.fileInput && linkedPage.articleIdInput && linkedPage.noStandaloneDrop) {
      pass('#/supp-library-linked has linked uploader only (article ID required, no standalone drop zone)');
    } else fail('#/supp-library-linked structure wrong', JSON.stringify(linkedPage));

    // Scope filtering: upload a standalone file and a linked file, then verify
    // each only appears on its own page.
    const articleIdForT8 = await page.evaluate(async () => {
      const r = await fetch('/api/articles?limit=1'); const d = await r.json();
      return d.articles && d.articles[0] ? String(d.articles[0].id) : null;
    });
    if (!articleIdForT8) {
      console.log('  SKIP: no article in dataset for scope check');
    } else {
      const standaloneName = `bmj-test-scope-standalone-${Date.now()}.pdf`;
      const linkedName = `bmj-test-scope-linked-${Date.now()}.pdf`;

      // Standalone upload (no articleId).
      await page.evaluate(async (name) => {
        const fd = new FormData();
        fd.append('files', new Blob(['%PDF\nS\n%%EOF'], { type: 'application/pdf' }), name);
        await fetch('/api/supp-library/upload', { method: 'POST', body: fd });
      }, standaloneName);

      // Linked upload (with articleId).
      await page.evaluate(async ({ name, id }) => {
        const fd = new FormData();
        fd.append('files', new Blob(['%PDF\nL\n%%EOF'], { type: 'application/pdf' }), name);
        fd.append('articleId', id);
        await fetch('/api/supp-library/upload', { method: 'POST', body: fd });
      }, { name: linkedName, id: articleIdForT8 });

      // Standalone scope list should contain the standalone file, NOT the linked one.
      const standaloneList = await page.evaluate(async () => {
        const r = await fetch('/api/supp-library?scope=standalone');
        return (await r.json()).files.map((f) => f.name);
      });
      if (standaloneList.includes(standaloneName) && !standaloneList.includes(linkedName)) {
        pass('standalone scope list includes standalone file only');
      } else fail('standalone scope filter wrong', `standalone=${standaloneList.includes(standaloneName)} linked=${standaloneList.includes(linkedName)}`);

      // Linked scope list should contain the linked file with its article ref.
      const linkedList = await page.evaluate(async () => {
        const r = await fetch('/api/supp-library?scope=linked');
        return (await r.json()).files;
      });
      const linkedEntry = linkedList.find((f) => f.name === linkedName);
      if (linkedEntry && Array.isArray(linkedEntry.references) && linkedEntry.references.length === 1
          && linkedEntry.references[0].articleId === articleIdForT8) {
        pass('linked scope list includes linked file with article reference');
      } else fail('linked scope filter wrong', JSON.stringify(linkedEntry));
      if (linkedList.every((f) => f.name !== standaloneName)) {
        pass('linked scope list excludes the standalone file');
      } else fail('standalone file leaked into linked scope');

      // Cleanup.
      for (const n of [standaloneName, linkedName]) {
        await page.evaluate(async (name) => fetch('/api/supp-library/' + encodeURIComponent(name), { method: 'DELETE' }), n);
      }
      // Roll back the article supplementary append from the linked upload.
      await page.evaluate(async ({ id, href }) => {
        const a = await (await fetch('/api/articles/' + id)).json();
        a.supplementary = (a.supplementary || []).filter((s) => s.href !== href);
        await fetch('/api/articles/' + id, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(a),
        });
      }, { id: articleIdForT8, href: `img/files/${linkedName}` });
    }

  } finally {
    await browser.close();
    // Tear down fixtures.
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (_) {}
  }
})().catch((e) => { console.error(e); process.exit(1); });
