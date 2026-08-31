/**
 * Extract AIP metadata from a Galenos-style .docx submission.
 *
 * The journal's template puts the entire metadata block in the first ~25
 * paragraphs in a deterministic order:
 *
 *   p0    Article type             (e.g. "Invited Review")
 *   p1    "DOI: <doi>"
 *   p2    Title
 *   p3..  Authors                  ("https://orcid.org/<id> <Name><digit(s)>,")
 *   p..   Affiliations             ("<digit><Institution text>")
 *   p..   "Corresponding author: ..."
 *   p..   "e-mail: <addr>"
 *   p..   "Received: dd.mm.yyyy"
 *   p..   "Accepted: dd.mm.yyyy"
 *   p..   "Yayın: dd.mm.yyyy" or "Published: ..." (optional)
 *   p..   "Online: ..."           (optional)
 *   p..   "Abstract"
 *   p..   <abstract paragraphs>
 *   p..   "Keywords: <a, b, c>"
 *
 * The numbers that link authors to affiliations are stored as plain digits
 * in the text (not as <w:vertAlign w:val="superscript"/> runs) in the
 * sample I inspected, so the parser leans on regex over plain-text rather
 * than the run/style metadata.
 */

const AdmZip = require('adm-zip');

function parseAipDocx(buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('Geçersiz .docx: word/document.xml bulunamadı');
  const xml = entry.getData().toString('utf8');
  const paragraphs = extractParagraphs(xml);
  const meta = extractMetadata(paragraphs);

  // Full body text → HTML for the "Tam Metin" editor. Done after metadata so a
  // failure here never blocks the (already-working) metadata import: on error
  // we leave fullTextHtml empty and surface a warning instead of throwing.
  try {
    const rels = buildRelsMap(zip);
    const rich = extractRichParagraphs(xml, rels);
    const body = buildBodyHtml(rich, { type: meta.type });
    meta.fullTextHtml = body.html;
    meta.fullTextHeadingCount = body.headingCount;
    if (!meta.fullTextHtml) {
      meta.warnings.push('Tam metin gövdesi bulunamadı (başlıklar tespit edilemedi)');
    } else if (body.headingCount > 0) {
      // Heading levels are an automated first-pass guess — ask the editor to
      // verify H3 (main section) vs H4 (subsection) before publishing.
      meta.headingCheckReminder = true;
    }
  } catch (e) {
    meta.fullTextHtml = '';
    meta.warnings.push('Tam metin çıkarılamadı: ' + e.message);
  }
  return meta;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// Map relationship id → target URL (used to resolve <w:hyperlink r:id="…">).
function buildRelsMap(zip) {
  const map = {};
  const e = zip.getEntry('word/_rels/document.xml.rels');
  if (!e) return map;
  const xml = e.getData().toString('utf8');
  const tagRe = /<Relationship\b[^>]*\/?>/g;
  let t;
  while ((t = tagRe.exec(xml)) !== null) {
    const id = (t[0].match(/\bId="([^"]+)"/) || [])[1];
    const target = (t[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target) map[id] = decodeXmlEntities(target);
  }
  return map;
}

// True if a run-property block turns a boolean toggle (b/i) ON. In OOXML the
// bare tag (<w:b/>) means ON; <w:b w:val="0|false|off"/> means OFF.
function rprToggleOn(rpr, name) {
  const m = rpr.match(new RegExp('<w:' + name + '\\b([^>]*)/?>'));
  if (!m) return false;
  const v = (m[1].match(/w:val="([^"]*)"/) || [])[1];
  return !(v && /^(0|false|off)$/i.test(v));
}

// Convert a single <w:r>…</w:r> run to formatted HTML, preserving bold, italic,
// superscript and subscript. Returns { html, plain }.
function runToHtml(runXml) {
  const rprMatch = runXml.match(/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/);
  const rpr = rprMatch ? rprMatch[1] : '';
  const bold = rprToggleOn(rpr, 'b');
  const italic = rprToggleOn(rpr, 'i');
  const vert = (rpr.match(/<w:vertAlign\b[^>]*w:val="([^"]+)"/) || [])[1] || '';

  let plain = '';
  const tokRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>/g;
  let tk;
  while ((tk = tokRe.exec(runXml)) !== null) {
    if (tk[1] !== undefined) plain += decodeXmlEntities(tk[1]);
    else if (/w:tab/.test(tk[0])) plain += '\t';
    else plain += '\n';
  }
  if (!plain) return { html: '', plain: '' };

  let html = escapeHtml(plain).replace(/\n/g, '<br>');
  if (vert === 'superscript') html = `<sup>${html}</sup>`;
  else if (vert === 'subscript') html = `<sub>${html}</sub>`;
  if (italic) html = `<em>${html}</em>`;
  if (bold) html = `<strong>${html}</strong>`;
  return { html, plain };
}

// Convert the inner XML of one <w:p> into HTML, walking hyperlinks and runs in
// document order so anchor wrappers and inline formatting are preserved.
function paraInnerToHtml(inner, rels) {
  let html = '';
  let plain = '';
  const re = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    if (m[2] !== undefined) {
      // Hyperlink: resolve its target, render its inner runs, wrap in <a>.
      const rid = (m[1].match(/r:id="([^"]+)"/) || [])[1];
      const href = rid ? (rels[rid] || '') : '';
      let sub = '';
      let subPlain = '';
      const rr = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
      let rm;
      while ((rm = rr.exec(m[2])) !== null) { const o = runToHtml(rm[0]); sub += o.html; subPlain += o.plain; }
      html += href ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener">${sub}</a>` : sub;
      plain += subPlain;
    } else {
      const o = runToHtml(m[0]);
      html += o.html;
      plain += o.plain;
    }
  }
  return { html: html.trim(), plain: plain.replace(/\t/g, ' ').trim() };
}

// One paragraph token from its <w:p> inner XML.
function paragraphToken(inner, rels) {
  const pprMatch = inner.match(/<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/);
  const ppr = pprMatch ? pprMatch[1] : '';
  const isList = /<w:numPr\b/.test(ppr);
  const styleId = (ppr.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/) || [])[1] || '';
  const outlineRaw = (ppr.match(/<w:outlineLvl\b[^>]*w:val="([^"]+)"/) || [])[1];
  const { html, plain } = paraInnerToHtml(inner, rels);
  return { type: 'p', html, plain, isList, styleId, outline: outlineRaw != null ? parseInt(outlineRaw, 10) : null };
}

// Convert a <w:tbl> block to an HTML <table>. Rows flagged with <w:tblHeader>
// render as <th>; everything else is <td>. Cell content reuses paraInnerToHtml
// so inline formatting survives. (Nested tables are not expanded — rare in
// manuscripts — but never crash: the inner content still renders as cell text.)
function tableToken(tblXml, rels) {
  let rows = '';
  const trRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
  let tr;
  while ((tr = trRe.exec(tblXml)) !== null) {
    const trInner = tr[1];
    const isHeader = /<w:tblHeader\b/.test((trInner.match(/<w:trPr\b[^>]*>([\s\S]*?)<\/w:trPr>/) || [])[1] || '');
    const cellTag = isHeader ? 'th' : 'td';
    let cells = '';
    const tcRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
    let tc;
    while ((tc = tcRe.exec(trInner)) !== null) {
      const tcInner = tc[1];
      const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
      let pm;
      const parts = [];
      while ((pm = pRe.exec(tcInner)) !== null) {
        const { html } = paraInnerToHtml(pm[1], rels);
        if (html) parts.push(html);
      }
      cells += `<${cellTag}>${parts.join('<br>')}</${cellTag}>`;
    }
    if (cells) rows += `<tr>${cells}</tr>`;
  }
  return { type: 'table', plain: '', html: rows ? `<table class="article-table"><tbody>${rows}</tbody></table>` : '' };
}

// Walk the document body in order, emitting paragraph and table tokens. Tables
// are matched whole (their inner <w:p> are NOT leaked as loose paragraphs).
// Same top-level ordering as the source; only block-level structure is kept.
function extractRichParagraphs(xml, rels) {
  const tokens = [];
  const blockRe = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = blockRe.exec(xml)) !== null) {
    if (m[1] !== undefined) tokens.push(tableToken(m[1], rels));
    else tokens.push(paragraphToken(m[2], rels));
  }
  return tokens;
}

// Explicit heading level from a Word heading style / outline level, or null
// when the paragraph carries no structural heading signal.
function explicitHeadingLevel(p) {
  const sm = String(p.styleId || '').match(/(?:heading|Ba_?l_?k|Başlık|Baslik)\s*([1-9])/i)
    || String(p.styleId || '').match(/^Heading([1-9])$/i);
  if (sm) return parseInt(sm[1], 10);
  if (p.outline != null) return p.outline + 1; // outlineLvl is 0-based
  return null;
}

// Normalise a heading for canonical matching: strip leading numbering ("2.",
// "2.1"), trailing punctuation, collapse spaces, lowercase.
function normalizeHeading(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\d.]+[).]?\s+/, '')
    .replace(/[:.\s]+$/, '')
    .toLowerCase();
}

// Canonical "main section" names that should always render as H3. IMRaD plus
// the universally-recognised front/back matter. METHODS is broad (clinical
// originals use "Patients and Methods", etc.). Turkish equivalents included.
const _SECT_METHODS = /^(materials? and methods|material and methods|patients? and methods|subjects? and methods|methods?|methodology|gereç ve yöntem(ler)?|gerec ve yöntem(ler)?|materyal ve met[oy]t?|yöntem(ler)?|yontem(ler)?)$/;
const _SECT_COMMON = [
  /^introduction$/, /^giriş$/, /^giris$/,
  /^results? and discussions?$/,
  /^results?$/, /^findings$/, /^bulgular$/,
  /^discussions?$/, /^tartışma$/, /^tartisma$/,
  /^conclusions?$/, /^concluding remarks$/, /^sonuç(lar)?$/, /^sonuc(lar)?$/,
  /^references$/, /^kaynaklar$/, /^kaynakça$/, /^kaynakca$/,
  /^abstract$/, /^öz$/, /^özet$/, /^ozet$/,
];
// Extra mains accepted for NON-original types (case reports, etc.).
const _SECT_CASE = [
  /^case (report|reports|presentation|description|series)$/, /^olgu( sunumu)?$/, /^vaka( sunumu)?$/,
];
// Standard back-matter that journals render at main (H3) level, for all types.
const _SECT_BACKMATTER = [
  /^acknowledge?ments?$/, /^acknowledgements?$/, /^teşekkür$/, /^tesekkur$/,
  /^fundings?$/, /^financial (support|disclosure|disclosures)$/, /^funding (information|statement|sources?)$/,
  /^conflicts? of interest$/, /^disclosures?$/, /^competing interests?$/, /^declaration of (competing )?interest(s)?$/,
  /^(author|authors'?|authorship) contributions?$/, /^yazar katkı(ları)?$/,
  /^ethics?( statement| approval)?$/, /^ethical (approval|statement|considerations?)$/,
  /^data availability( statement)?$/, /^abbreviations?$/,
];

function isMainSection(norm, isOriginal) {
  if (_SECT_METHODS.test(norm)) return true;
  if (_SECT_COMMON.some((re) => re.test(norm))) return true;
  if (_SECT_BACKMATTER.some((re) => re.test(norm))) return true;
  if (!isOriginal && _SECT_CASE.some((re) => re.test(norm))) return true;
  return false;
}

function isOriginalType(type) {
  return /\boriginal\b|\borijinal\b|research article|original research|özgün araştırma|ozgun arastirma|araştırma makale|arastirma makale/i.test(String(type || ''));
}

// Does this paragraph read as a heading at all? Either an explicit Word heading
// style/outline, the template's ALL-CAPS convention, or a short paragraph whose
// (number-stripped) text is exactly a canonical section name — this last case
// catches unmarked, mixed-case headings like "4. Results" that carry no style.
function looksLikeHeading(p) {
  if (explicitHeadingLevel(p) != null) return true;
  if (isLikelyBodyHeading(p.plain)) return true;
  if (p.plain && p.plain.length <= 80 && isMainSection(normalizeHeading(p.plain), false)) return true;
  return false;
}

// Decide the heading level for a heading paragraph. The journal rule wins over
// Word's own styling so the first pass is consistent:
//   1) canonical main section → h3 (Introduction, Methods, Results, …, back matter)
//   2) any other heading once a main section has been seen → h4 (subsection
//      "between the mains"), regardless of how Word styled it
//   3) before the first main → explicit Word level (h4 if ≥2), else h3
function classifyHeadingLevel(p, ctx) {
  const norm = normalizeHeading(p.plain);
  if (isMainSection(norm, ctx.isOriginal)) return 'h3';
  if (ctx.seenMain) return 'h4';
  const explicit = explicitHeadingLevel(p);
  if (explicit != null && explicit >= 2) return 'h4';
  return 'h3';
}

// True for a short comma/semicolon-separated keyword list (1-6 word items) — NOT
// a body sentence. Guards the "Keywords:" fallback so an editorial's opening
// paragraph isn't mistaken for keywords.
function _looksLikeKeywordList(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 160) return false;
  const parts = t.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => p.split(/\s+/).length <= 6);
}

// Article types that carry NO abstract per the journal guidelines (so a missing
// abstract/keywords is normal, not a warning).
function typeHasAbstract(type) {
  const t = String(type || '').toLowerCase();
  if (/editorial|letter|clinical image|scientific letter|editorial comment|commentary|\bimage\b/.test(t)) return false;
  return true;
}

// Fallback body start: skip the recognizable top metadata block (type, citation,
// DOI, title, authors, affiliations, corresponding, e-mail, dates, abstract,
// keywords) and return the first real content paragraph. Used only when there is
// neither a Keywords line nor a detectable section heading.
function _firstNonMetadataIndex(paras) {
  let sawDoi = false, sawTitle = false, sawAuthor = false;
  let i = 0;
  for (; i < paras.length; i++) {
    const t = paras[i].plain;
    if (!t) continue;
    if (i === 0) continue;                                   // type line
    if (/^balkan med j\b/i.test(t)) continue;                // citation
    if (/^DOI[:\s]/i.test(t)) { sawDoi = true; continue; }
    if (/orcid\.org\//i.test(t)) { sawAuthor = true; continue; }
    if (/^Corresponding\s+author/i.test(t)) continue;
    if (/^e-?mail\s*[:：]/i.test(t)) continue;
    if (/^(Received|Accepted|Yay[ıi]n|Published|Online)\s*[:：]/i.test(t)) continue;
    if (/^abstract$/i.test(t)) continue;
    if (/^keywords?\s*[:：]/i.test(t)) continue;
    if (/^\d+\s*\S/.test(t) && /universit|üniversite|department|b[öo]l[üu]m|hospital|hastane|clinic|klinik|institut|enstit[üu]|faculty|fak[üu]lte|laborat|cent(er|re)|college|school|division|service|unit/i.test(t)) continue; // affiliation
    if (sawDoi && !sawTitle && !sawAuthor) { sawTitle = true; continue; } // title (line after DOI, before authors)
    break;
  }
  return i;
}

// Assemble the article body HTML from rich paragraphs. Produces:
//   <h3>/<h4> section headings, <p> paragraphs (bold/italic/sup preserved),
//   and a <div class="article-references"><h3>…</h3><ol><li>…</ol></div> block
//   that the editor's _autoLinkInEditor() then cross-links to the <sup> markers.
function buildBodyHtml(paras, opts) {
  const isOriginal = isOriginalType((opts && opts.type) || '');
  // Locate the body start. The body begins right after the metadata block — NOT
  // necessarily at a section heading (editorials/letters often have no headings
  // before References, so requiring a heading would skip the whole main text).
  const idxAbstract = paras.findIndex((p) => /^abstract$/i.test(p.plain));
  let idxKeywords = -1;
  for (let i = (idxAbstract >= 0 ? idxAbstract : 0); i < paras.length; i++) {
    if (/^keywords?\s*:/i.test(paras[i].plain)) { idxKeywords = i; break; }
  }
  let start = -1;
  if (idxKeywords >= 0) {
    start = idxKeywords + 1;
    const kwInline = /^keywords?\s*:\s*\S/i.test(paras[idxKeywords].plain);
    // Skip a keyword VALUE sitting on its own line after an empty "Keywords:".
    if (!kwInline && paras[start] && !looksLikeHeading(paras[start]) && _looksLikeKeywordList(paras[start].plain)) start += 1;
  } else {
    const after = idxAbstract >= 0 ? idxAbstract : 0;
    for (let i = after + 1; i < paras.length; i++) {
      if (looksLikeHeading(paras[i])) { start = i; break; }
    }
    if (start < 0) start = _firstNonMetadataIndex(paras);
  }
  while (start < paras.length && !(paras[start] && (paras[start].plain || (paras[start].html || '').trim()))) start++;
  if (start < 0) start = 0;

  const REF_RE = /^(references|reference list|bibliography|kaynaklar|kaynakça|kaynakca)$/;
  const ctx = { isOriginal, seenMain: false };
  let html = '';
  let headingCount = 0;
  let inRefs = false;
  let refHeading = 'References';
  const refItems = [];
  for (let i = start; i < paras.length; i++) {
    const p = paras[i];
    if (!p.plain && !p.html) continue;

    // Tables render as-is (never wrapped in <p>, never a heading/reference).
    if (p.type === 'table') { html += p.html + '\n'; continue; }

    if (!inRefs && REF_RE.test(normalizeHeading(p.plain))) {
      inRefs = true;
      refHeading = p.plain.replace(/^[\d.]+[).]?\s+/, '').replace(/\s+/g, ' ').trim() || 'References';
      continue;
    }
    if (inRefs) {
      if (p.html) {
        // Auto-numbered <ol> supplies the number; drop any manually typed
        // leading "N." / "N)" so it isn't shown twice.
        refItems.push(p.html.replace(/^\s*\d+[.)]\s+/, ''));
      }
      continue;
    }
    if (looksLikeHeading(p)) {
      const tag = classifyHeadingLevel(p, ctx);
      if (tag === 'h3') ctx.seenMain = true;
      headingCount += 1;
      html += `<${tag}>${escapeHtml(p.plain)}</${tag}>\n`;
      continue;
    }
    html += `<p>${p.html || escapeHtml(p.plain)}</p>\n`;
  }
  if (refItems.length) {
    html += `\n<div class="article-references">\n  <h3>${escapeHtml(refHeading === refHeading.toUpperCase() ? 'References' : refHeading)}</h3>\n  <ol>\n`;
    for (const r of refItems) html += `    <li>${r}</li>\n`;
    html += '  </ol>\n</div>\n';
  }
  return { html: html.trim(), headingCount };
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Return array of { text, hasSuperscript } in document order.
function extractParagraphs(xml) {
  const result = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    const inner = m[1];
    let text = '';
    let hasSuperscript = false;
    const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    let rm;
    while ((rm = runRe.exec(inner)) !== null) {
      const r = rm[1];
      if (/<w:vertAlign\s+w:val="superscript"/.test(r)) hasSuperscript = true;
      const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
      let tm;
      while ((tm = tRe.exec(r)) !== null) text += decodeXmlEntities(tm[1]);
      if (/<w:tab\b/.test(r)) text += '\t';
      if (/<w:br\b/.test(r)) text += '\n';
    }
    result.push({ text: text.trim(), hasSuperscript });
  }
  return result;
}

function findIndex(paras, pred, from = 0) {
  for (let i = from; i < paras.length; i++) if (pred(paras[i].text, i)) return i;
  return -1;
}

function isoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function foldDateText(value) {
  return String(value || '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
    .toLowerCase();
}

// Parse numeric, English and Turkish dates into ISO yyyy-mm-dd.
function parseDate(input) {
  let raw = String(input || '').replace(/[\u200e\u200f\u202a-\u202e]/g, ' ').trim();
  if (!raw) return '';
  raw = raw.replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/\s+/g, ' ');

  let m = raw.match(/\b((?:19|20|21)\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\b/);
  if (m) return isoDate(m[1], m[2], m[3]);

  m = raw.match(/\b(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*((?:19|20|21)?\d{2})\b/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoDate(year, m[2], m[1]);
  }

  const months = {
    jan: 1, january: 1, oca: 1, ocak: 1,
    feb: 2, february: 2, sub: 2, subat: 2,
    mar: 3, march: 3, mart: 3,
    apr: 4, april: 4, nis: 4, nisan: 4,
    may: 5, mayis: 5,
    jun: 6, june: 6, haz: 6, haziran: 6,
    jul: 7, july: 7, tem: 7, temmuz: 7,
    aug: 8, august: 8, agu: 8, agustos: 8,
    sep: 9, sept: 9, september: 9, eyl: 9, eylul: 9,
    oct: 10, october: 10, eki: 10, ekim: 10,
    nov: 11, november: 11, kas: 11, kasim: 11,
    dec: 12, december: 12, ara: 12, aralik: 12,
  };
  const folded = foldDateText(raw);
  m = folded.match(/\b(\d{1,2})\s+([a-z]+)\.?\s*,?\s*((?:19|20|21)\d{2})\b/);
  if (m && months[m[2]]) return isoDate(m[3], months[m[2]], m[1]);
  m = folded.match(/\b([a-z]+)\.?\s+(\d{1,2})\s*,?\s*((?:19|20|21)\d{2})\b/);
  if (m && months[m[1]]) return isoDate(m[3], months[m[1]], m[2]);

  m = raw.match(/\b((?:19|20|21)\d{2})(\d{2})(\d{2})\b/);
  return m ? isoDate(m[1], m[2], m[3]) : '';
}

function findLabeledDate(paras, labelPatterns) {
  for (let i = 0; i < paras.length; i++) {
    const text = String(paras[i] && paras[i].text || '').trim();
    if (!text) continue;
    for (const label of labelPatterns) {
      const match = text.match(new RegExp('(?:^|[;,|]|\\s)\\s*(?:' + label + ')\\s*(?:date|tarihi)?\\s*[:：\\-–—]?\\s*([^;|]*)', 'i'));
      if (!match) continue;
      const inline = parseDate(match[1]);
      if (inline) return inline;
      for (let next = i + 1; next < Math.min(paras.length, i + 3); next++) {
        const adjacent = parseDate(paras[next] && paras[next].text);
        if (adjacent) return adjacent;
        if (String(paras[next] && paras[next].text || '').trim()) break;
      }
    }
  }
  return '';
}

function extractMetadata(paras) {
  const meta = {
    type: '',
    doi: '',
    title: '',
    authors: [],
    abstract: '',
    keywords: [],
    received: '',
    accepted: '',
    publishedOnline: '',
    published: '',
    correspondingEmail: '',
    warnings: [],
  };

  // Drop leading blank paragraphs.
  let cursor = 0;
  while (cursor < paras.length && !paras[cursor].text) cursor++;

  // 1) Article type — first non-empty paragraph if it isn't a DOI line.
  if (cursor < paras.length && !/^DOI[:\s]/i.test(paras[cursor].text)) {
    meta.type = paras[cursor].text;
    cursor++;
  }

  // 2) DOI — search globally in the first 5 paragraphs (cheap, defensive).
  const doiIdx = findIndex(paras.slice(0, 8), (t) => /^DOI[:\s]/i.test(t));
  if (doiIdx >= 0) {
    const m = paras[doiIdx].text.match(/^DOI[:\s]+(.+?)\s*$/i);
    if (m) meta.doi = m[1].trim();
    cursor = Math.max(cursor, doiIdx + 1);
  } else {
    meta.warnings.push('DOI satırı bulunamadı');
  }

  // Skip blanks again.
  while (cursor < paras.length && !paras[cursor].text) cursor++;

  // 3) Title — the paragraph right after DOI (or first non-empty if no DOI),
  // as long as it doesn't look like an ORCID/author line.
  if (cursor < paras.length && !/orcid\.org\//i.test(paras[cursor].text)) {
    meta.title = paras[cursor].text;
    cursor++;
  } else {
    meta.warnings.push('Başlık satırı bulunamadı');
  }

  // 4) Authors — consecutive lines that contain "orcid.org/...".
  const authorParas = [];
  while (cursor < paras.length) {
    const t = paras[cursor].text;
    if (!t) { cursor++; continue; }
    if (/orcid\.org\//i.test(t)) {
      authorParas.push(t);
      cursor++;
    } else {
      break;
    }
  }
  for (const t of authorParas) {
    // Format observed:  https://orcid.org/<id>  <Full Name><digit(s)>[,]
    // The digit(s) at the end map to affiliation indices; preserve them
    // verbatim so the admin's Kurumlar editor can show "1" or "1,2".
    const m = t.match(/orcid\.org\/([\w-]+)\s+(.+?)\s*$/i);
    if (!m) {
      // Fallback: no ORCID URL but still looks like an author line — accept.
      meta.warnings.push('Yazar satırı ayrıştırılamadı: ' + t.slice(0, 80));
      continue;
    }
    const orcid = m[1];
    let rest = m[2];
    // Strip trailing comma.
    rest = rest.replace(/[,.;]+\s*$/, '');
    // Split trailing affiliation digits (one or more separated by commas).
    const tail = rest.match(/^(.*?)\s*((?:\d+\s*,?\s*)+)$/);
    let name = rest;
    let affIdxStr = '';
    if (tail) {
      name = tail[1].trim();
      affIdxStr = tail[2].replace(/\s+/g, '').replace(/,$/, '');
    }
    meta.authors.push({ name, orcid, _affIdxRaw: affIdxStr });
  }
  if (meta.authors.length === 0) meta.warnings.push('Yazar satırı bulunamadı');

  // 5) Affiliations — paragraphs starting with a digit (the marker that
  // ties them to author indices). Continues until a known label is hit.
  const affiliations = []; // dense by 1-based index
  while (cursor < paras.length) {
    const t = paras[cursor].text;
    if (!t) { cursor++; continue; }
    if (/^(Corresponding\s+author|Received|Accepted|Abstract|e-?mail|Yayın|Published|Online)/i.test(t)) break;
    const m = t.match(/^(\d+)\s*(.+)$/);
    if (!m) break;
    const num = parseInt(m[1], 10);
    affiliations[num] = m[2].trim();
    cursor++;
  }
  if (affiliations.filter(Boolean).length === 0) {
    meta.warnings.push('Kurum satırı bulunamadı');
  }

  // 6) Resolve each author's affiliation string by joining matched institutions.
  for (const a of meta.authors) {
    const idxs = (a._affIdxRaw || '').split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
    const texts = idxs.map((n) => affiliations[n]).filter(Boolean);
    a.affiliation = texts.join('; ');
    delete a._affIdxRaw;
  }

  // 7) Corresponding author email — labeled either on its own line or
  // inline in the corresponding-author paragraph.
  for (let i = cursor; i < Math.min(paras.length, cursor + 6); i++) {
    const em = paras[i].text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
    if (em) { meta.correspondingEmail = em[0]; break; }
  }

  // 8) Dates — Received / Accepted / Published. "Yayın" is the Turkish
  // template label; accept both.
  const dateParas = paras.slice(0, 80);
  meta.received = findLabeledDate(dateParas, [
    'received', 'date\\s+received', 'submission\\s+date',
    'alındığı', 'alindigi', 'alındı', 'alindi', 'geliş', 'gelis', 'başvuru', 'basvuru',
  ]);
  meta.accepted = findLabeledDate(dateParas, [
    'accepted', 'acceptance', 'date\\s+accepted',
    'kabul', 'kabul\\s+edildi',
  ]);
  meta.publishedOnline = findLabeledDate(dateParas, [
    'published\\s+online', 'online\\s+publication', 'available\\s+online',
    'online\\s+first', 'online', 'epub', 'e-pub', 'çevrimiçi\\s+yayın', 'cevrimici\\s+yayin',
  ]);
  meta.published = findLabeledDate(dateParas, [
    'published(?!\\s+online)', 'publication\\s+date', 'date\\s+published',
    'yayın', 'yayin', 'yayım', 'yayim', 'yayımlanma', 'yayinlanma',
  ]);

  // 9) Abstract — paragraphs between "Abstract" and "Keywords:" / first
  // ALL-CAPS section heading (whichever comes first).
  const absIdx = findIndex(paras, (t) => /^Abstract\s*$/i.test(t));
  const kwIdx = findIndex(paras, (t) => /^Keywords?\s*:/i.test(t), absIdx >= 0 ? absIdx : 0);
  if (absIdx >= 0) {
    const stop = kwIdx >= 0 ? kwIdx : findIndex(paras, (t) => isLikelyBodyHeading(t), absIdx + 1);
    const end = stop >= 0 ? stop : paras.length;
    const parts = [];
    for (let i = absIdx + 1; i < end; i++) {
      if (paras[i].text) parts.push(paras[i].text);
    }
    meta.abstract = parts.join('\n\n');
  } else if (typeHasAbstract(meta.type)) {
    meta.warnings.push('"Abstract" başlığı bulunamadı');
  }

  // 10) Keywords — NOT extracted. The journal has no keyword field, so we never
  // pull keyword values from the Word file or warn about them. The "Keywords:"
  // line (kwIdx) is still used above only as the abstract's stop boundary and (in
  // buildBodyHtml) as a body-start marker. meta.keywords stays [].

  return meta;
}

// Section headings in the body are typed ALL-CAPS in this template
// (INTRODUCTION, MATERIALS AND METHODS, DISCUSSION, REFERENCES, etc.).
function isLikelyBodyHeading(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 80) return false;
  // Must be entirely uppercase letters / spaces / digits / a few punctuation
  // chars, with at least one letter. Excludes label lines like "DOI: ...".
  if (!/^[A-Z0-9\s.,&\-/]+$/.test(t)) return false;
  if (!/[A-Z]/.test(t)) return false;
  return true;
}

module.exports = { parseAipDocx, extractParagraphs, extractMetadata, extractRichParagraphs, buildBodyHtml, buildRelsMap, parseDate, findLabeledDate };
