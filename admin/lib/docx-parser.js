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
  return extractMetadata(paragraphs);
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

// Parse "dd.mm.yyyy" / "dd/mm/yyyy" / "dd-mm-yyyy" -> ISO "yyyy-mm-dd".
function parseDate(input) {
  const m = String(input || '').match(/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
  if (!m) return '';
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
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
  const findLabeledDate = (label) => {
    const p = paras.find((p) => new RegExp('^\\s*' + label + '\\s*[:：]', 'i').test(p.text));
    return p ? parseDate(p.text) : '';
  };
  meta.received = findLabeledDate('Received');
  meta.accepted = findLabeledDate('Accepted');
  meta.published = findLabeledDate('(?:Yayın|Yayin|Published)');

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
  } else {
    meta.warnings.push('"Abstract" başlığı bulunamadı');
  }

  // 10) Keywords — comma- or semicolon-separated, on the same line after the
  // colon or on the following paragraph.
  if (kwIdx >= 0) {
    const inline = paras[kwIdx].text.match(/^Keywords?\s*:\s*(.+)$/i);
    let raw = (inline && inline[1].trim()) ? inline[1] : '';
    if (!raw && kwIdx + 1 < paras.length) {
      const next = paras[kwIdx + 1].text;
      if (next && !isLikelyBodyHeading(next)) raw = next;
    }
    if (raw) {
      meta.keywords = raw
        .split(/[,;]/)
        .map((s) => s.trim().replace(/[.;]+$/, ''))
        .filter(Boolean);
    }
  }
  if (!meta.keywords.length) meta.warnings.push('Anahtar kelime bulunamadı');

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

module.exports = { parseAipDocx, extractParagraphs, extractMetadata };
