// Unit tests for the ZIP-import cleanup helpers added to zip-importer.js.
//
// Uses synthetic article IDs (999990+) that don't collide with real data, so
// the test can create real files on disk, exercise the helpers, and tidy
// up after itself without touching production article folders.

const fs = require('fs');
const path = require('path');
const importer = require('./lib/zip-importer');
const dio = require('./lib/data-io');

const TEST_IDS = [999990, 999991, 999992, 999993];

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS:', name); }
  else { fail++; console.log('  FAIL:', name, detail ? '— ' + detail : ''); }
}

function setupFakeArticle(id) {
  const figDir = path.join(dio.PATHS.articleImagesDir, String(id));
  const suppDir = path.join(dio.PATHS.supplementaryDir, String(id));
  fs.mkdirSync(figDir, { recursive: true });
  fs.mkdirSync(suppDir, { recursive: true });
  fs.writeFileSync(path.join(figDir, 'figure-1.png'), Buffer.from('fake fig 1'));
  fs.writeFileSync(path.join(figDir, 'figure-2.png'), Buffer.from('fake fig 2'));
  fs.writeFileSync(path.join(suppDir, 'supp-data.csv'), Buffer.from('a,b,c\n1,2,3'));
}

function teardown(id) {
  const figDir = path.join(dio.PATHS.articleImagesDir, String(id));
  const suppDir = path.join(dio.PATHS.supplementaryDir, String(id));
  try { fs.rmSync(figDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(suppDir, { recursive: true, force: true }); } catch (_) {}
}

try {
  // ── T1: cleanArticleAssets removes leftover figures + supplementaries ───
  console.log('=== T1: cleanArticleAssets wipes existing files ===');
  setupFakeArticle(TEST_IDS[0]);
  const removed = importer.cleanArticleAssets(TEST_IDS[0]);
  check('reports 2 figures removed',
    removed.figures.length === 2 && removed.figures.includes('figure-1.png') && removed.figures.includes('figure-2.png'),
    JSON.stringify(removed.figures));
  check('reports 1 supplementary removed',
    removed.supplementary.length === 1 && removed.supplementary[0] === 'supp-data.csv',
    JSON.stringify(removed.supplementary));
  const figDir1 = path.join(dio.PATHS.articleImagesDir, String(TEST_IDS[0]));
  const suppDir1 = path.join(dio.PATHS.supplementaryDir, String(TEST_IDS[0]));
  check('figures dir is empty after cleanup',
    fs.existsSync(figDir1) && fs.readdirSync(figDir1).length === 0);
  check('supplementary dir is empty after cleanup',
    fs.existsSync(suppDir1) && fs.readdirSync(suppDir1).length === 0);

  // ── T2: listExistingArticleAssets returns what's on disk ────────────────
  console.log('=== T2: listExistingArticleAssets enumerates on-disk files ===');
  setupFakeArticle(TEST_IDS[1]);
  const listed = importer.listExistingArticleAssets(TEST_IDS[1]);
  check('lists 2 figures', listed.figures.length === 2, JSON.stringify(listed.figures));
  check('lists 1 supplementary', listed.supplementary.length === 1, JSON.stringify(listed.supplementary));
  check('fullText is false (no html written)', listed.fullText === false);
  // For an ID with nothing on disk: empty lists, fullText false.
  const empty = importer.listExistingArticleAssets(TEST_IDS[3]);
  check('empty article: figures=[]', empty.figures.length === 0);
  check('empty article: supplementary=[]', empty.supplementary.length === 0);
  check('empty article: fullText=false', empty.fullText === false);

  // ── T3: cleanArticleAssets is a no-op for a brand-new ID ────────────────
  console.log('=== T3: cleanArticleAssets safe for IDs with no files ===');
  const noop = importer.cleanArticleAssets(TEST_IDS[2]);
  check('no-op returns empty arrays', noop.figures.length === 0 && noop.supplementary.length === 0);

  // ── T4: Path-traversal & garbage inputs are rejected ────────────────────
  console.log('=== T4: cleanArticleAssets refuses non-numeric / negative IDs ===');
  // These should each early-exit with empty removal report and NOT touch disk.
  const evil = [
    '../foo',
    '..\\bar',
    '/etc/passwd',
    '0',
    -5,
    'abc',
    null,
    undefined,
    '',
    { id: 1 },
  ];
  let allSafe = true;
  for (const v of evil) {
    const r = importer.cleanArticleAssets(v);
    if (r.figures.length || r.supplementary.length) {
      allSafe = false;
      console.log('  INFO: input', JSON.stringify(v), 'returned', JSON.stringify(r));
    }
  }
  check('all evil inputs returned empty (path-traversal refused)', allSafe);

  // ── T5: Removing only files, not subdirectories ─────────────────────────
  console.log('=== T5: subdirectories inside article folder are preserved ===');
  const figDir5 = path.join(dio.PATHS.articleImagesDir, String(TEST_IDS[0]));
  fs.mkdirSync(path.join(figDir5, 'thumbs'), { recursive: true });
  fs.writeFileSync(path.join(figDir5, 'fig-a.png'), Buffer.from('a'));
  importer.cleanArticleAssets(TEST_IDS[0]);
  check('subdirectory "thumbs" preserved (only files removed)',
    fs.existsSync(path.join(figDir5, 'thumbs')) && !fs.existsSync(path.join(figDir5, 'fig-a.png')));

} finally {
  TEST_IDS.forEach(teardown);
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}
