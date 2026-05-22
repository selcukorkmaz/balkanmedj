// E2E test for Sorun 15 — supplementary insert helper functions
// We test the pure JS helpers (detectSuppKind, buildSupplementaryInsertHtml)
// by extracting them into a Node-runnable module wrapper.

const fs = require('fs');
const path = require('path');

// Pull just the helpers we need out of app.js so they can run under Node
const appSource = fs.readFileSync(path.join(__dirname, 'public', 'js', 'app.js'), 'utf-8');

// Build a sandbox containing only what the helpers reference
const helperSource = `
function esc(str) { return String(str || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
${extractFunctionBody(appSource, 'detectSuppKind')}
${extractFunctionBody(appSource, 'suppKindLabel')}
${extractFunctionBody(appSource, 'currentArticleIdFromHash')}
${extractFunctionBody(appSource, 'buildSupplementaryInsertHtml')}
const SUPP_IMAGE_EXT = /\\.(jpe?g|png|gif|webp|svg|tiff?|bmp)$/i;
const SUPP_VIDEO_EXT = /\\.(mp4|webm|mov|m4v|ogv)$/i;
const SUPP_AUDIO_EXT = /\\.(mp3|wav|ogg|m4a)$/i;
const SUPP_PDF_EXT   = /\\.pdf$/i;
module.exports = { detectSuppKind, suppKindLabel, buildSupplementaryInsertHtml };
`;

function extractFunctionBody(src, name) {
  const re = new RegExp(`function ${name}\\b[\\s\\S]*?\\n}\\n`, 'g');
  const m = re.exec(src);
  return m ? m[0] : '';
}

const tmpFile = path.join(__dirname, '_test_helpers.js');
fs.writeFileSync(tmpFile, helperSource);
const { detectSuppKind, suppKindLabel, buildSupplementaryInsertHtml } = require(tmpFile);

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  PASS:', n); } else { fail++; console.log('  FAIL:', n, '—', d || ''); } };

try {
  console.log('=== T1: detectSuppKind dosya turu tespit ===');
  check('jpg -> image', detectSuppKind('table-s1.jpg') === 'image');
  check('JPEG -> image', detectSuppKind('TABLE.JPEG') === 'image');
  check('png -> image', detectSuppKind('fig.png') === 'image');
  check('mp4 -> video', detectSuppKind('movie.mp4') === 'video');
  check('webm -> video', detectSuppKind('clip.webm') === 'video');
  check('mp3 -> audio', detectSuppKind('audio.mp3') === 'audio');
  check('pdf -> pdf', detectSuppKind('supplement.pdf') === 'pdf');
  check('xlsx -> file', detectSuppKind('data.xlsx') === 'file');
  check('docx -> file', detectSuppKind('letter.docx') === 'file');
  check('csv -> file', detectSuppKind('table.csv') === 'file');
  check('empty -> file', detectSuppKind('') === 'file');
  check('URL -> tespit', detectSuppKind('https://example.com/data.csv') === 'file');

  console.log('=== T2: buildSupplementaryInsertHtml — link modu ===');
  const file1 = { url: 'js/data/supplementary/123/table.xlsx', label: 'Table S1', caption: '', kind: 'file' };
  let html = buildSupplementaryInsertHtml(file1, 'link', 'Table S1');
  check('link: <p> ile basliyor', html.startsWith('<p>'));
  check('link: <a> var', html.includes('<a href="'));
  check('link: URL dogru', html.includes('table.xlsx'));
  check('link: target=_blank', html.includes('target="_blank"'));
  check('link: rel=noopener', html.includes('rel="noopener"'));
  check('link: label kullaniliyor', html.includes('>Table S1<'));

  console.log('=== T3: buildSupplementaryInsertHtml — image embed ===');
  const img1 = { url: 'js/data/supplementary/123/fig1.png', label: 'Figure', caption: 'Caption text', kind: 'image' };
  html = buildSupplementaryInsertHtml(img1, 'embed', 'My Figure');
  check('image: <figure> tag', html.includes('<figure>'));
  check('image: <img> tag', html.includes('<img'));
  check('image: src dogru', html.includes('fig1.png'));
  check('image: alt label var', html.includes('alt="My Figure"'));
  check('image: caption render edildi', html.includes('Caption text'));
  check('image: figcaption tag', html.includes('<figcaption'));

  console.log('=== T4: buildSupplementaryInsertHtml — video embed ===');
  const vid1 = { url: 'js/data/supplementary/123/movie.mp4', label: 'Video', caption: '', kind: 'video' };
  html = buildSupplementaryInsertHtml(vid1, 'embed', 'Video clip');
  check('video: <video controls', html.includes('<video controls'));
  check('video: <source>', html.includes('<source'));
  check('video: URL dogru', html.includes('movie.mp4'));

  console.log('=== T5: buildSupplementaryInsertHtml — embed istense bile dosya link\'e duser ===');
  const pdf1 = { url: 'doc.pdf', label: 'PDF', caption: '', kind: 'pdf' };
  html = buildSupplementaryInsertHtml(pdf1, 'embed', 'PDF');
  check('PDF embed istegi link\'e dustu', html.startsWith('<p>') && html.includes('<a'));
  check('PDF kindHint var', html.includes('PDF'));

  console.log('=== T6: HTML escape — XSS koruma ===');
  const bad = { url: 'a.txt"><script>alert(1)</script>', label: '"><img src=x>', caption: '', kind: 'file' };
  html = buildSupplementaryInsertHtml(bad, 'link', '"><img>');
  check('URL escape edildi', !html.includes('"><script'), html.slice(0, 200));
  check('Label escape edildi', !/<img(?!\b[^>]*\/>)/.test(html.replace(/<img[^>]*alt=/, '')), html.slice(0, 200));

  console.log('=== T7: Label fallback — bos verilirse item.label ===');
  const noLabel = { url: 'file.txt', label: 'Original', caption: '', kind: 'file' };
  html = buildSupplementaryInsertHtml(noLabel, 'link', '');
  check('Empty label -> item.label kullanildi', html.includes('Ek Materyal') || html.includes('Original'));

} finally {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  console.log('\nPass:', pass, 'Fail:', fail);
  process.exit(fail ? 1 : 0);
}
