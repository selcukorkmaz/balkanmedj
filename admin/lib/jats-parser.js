/**
 * JATS XML Parser — converts JATS Archiving 1.3 XML to article objects.
 */

const { parseStringPromise } = require('xml2js');

// Map JATS article-type attribute to our type names
const ARTICLE_TYPE_MAP = {
  'research-article': 'Original Article',
  'brief-report': 'Brief Report',
  'editorial': 'Editorial',
  'correction': 'Erratum',
  'letter': 'Letter to the Editor',
  'review-article': 'Invited Review',
  'case-report': 'Case Report',
  'retraction': 'Retraction Notice',
};

// Reject XML payloads that look like they could trigger an XML external-entity
// (XXE) attack or a billion-laughs entity-expansion DoS. xml2js / sax-js does
// not resolve external entities by default, but it will happily multiply
// internal entity references at parse time, which is the same family of
// vulnerability we want to keep out of the importer entirely.
// 200 KB is a generous ceiling for a well-formed JATS article's <!DOCTYPE>
// (none usually exceeds a couple of KB).
const MAX_DOCTYPE_BYTES = 200 * 1024;
const MAX_ENTITY_DECLARATIONS = 8;

function guardAgainstXxe(xmlString) {
  if (typeof xmlString !== 'string') return;
  // Strip the BOM and any leading whitespace so the DOCTYPE detector works
  // on payloads saved by Windows tools.
  const head = xmlString.replace(/^﻿/, '').slice(0, 8192);
  if (!/<!DOCTYPE\b/i.test(head)) return; // no DTD declared → safe

  // Walk the full prolog to find the DOCTYPE's matching closing ']>' / '>'.
  // Anything inside is the internal subset where ENTITY declarations live.
  const start = xmlString.search(/<!DOCTYPE\b/i);
  const subsetStart = xmlString.indexOf('[', start);
  const subsetEnd = subsetStart >= 0 ? xmlString.indexOf(']>', subsetStart) : -1;
  // Refuse documents whose DOCTYPE declaration block is implausibly large —
  // a common shape of nested-entity attacks.
  if (subsetEnd > 0 && (subsetEnd - subsetStart) > MAX_DOCTYPE_BYTES) {
    throw new Error('XML DOCTYPE block too large — refusing to parse (possible entity-expansion attack)');
  }
  // Count <!ENTITY ...> declarations. A few are harmless (HTML named entities
  // get redefined inside some JATS exports), but more than a handful is a red
  // flag — billion-laughs starts with 9 entities referencing each other.
  const subset = subsetStart >= 0
    ? xmlString.slice(subsetStart, subsetEnd > 0 ? subsetEnd : xmlString.length)
    : '';
  const entityCount = (subset.match(/<!ENTITY\b/gi) || []).length;
  if (entityCount > MAX_ENTITY_DECLARATIONS) {
    throw new Error('XML contains too many entity declarations (' + entityCount + ') — refusing to parse');
  }
  // Refuse SYSTEM/PUBLIC external entity references outright.
  if (/<!ENTITY[^>]*\b(SYSTEM|PUBLIC)\b/i.test(subset)) {
    throw new Error('XML declares an external entity (SYSTEM/PUBLIC) — refusing to parse for security reasons');
  }
}

/**
 * Parse a JATS XML string and return a structured article object.
 */
async function parseJatsXml(xmlString) {
  guardAgainstXxe(xmlString);
  const result = await parseStringPromise(xmlString, {
    explicitArray: true,
    mergeAttrs: false,
    normalizeTags: false,
    preserveChildrenOrder: true,
    explicitChildren: true,
    charsAsChildren: true,
    trim: true,
  });

  const article = result.article;
  const attrs = article.$ || {};
  const front = article.front?.[0] || {};
  const body = article.body?.[0] || {};
  const back = article.back?.[0] || {};
  const floatsGroup = article['floats-group']?.[0] || {};
  const response = article.response?.[0] || null;

  const journalMeta = front['journal-meta']?.[0] || {};
  const articleMeta = front['article-meta']?.[0] || {};

  // --- Type ---
  const subjectEl = articleMeta['article-categories']?.[0]?.['subj-group']?.[0]?.subject?.[0];
  const typeFromSubject = typeof subjectEl === 'string' ? subjectEl : textContent(subjectEl);
  const typeFromAttr = ARTICLE_TYPE_MAP[attrs['article-type']] || attrs['article-type'];
  const type = typeFromSubject || typeFromAttr || 'Original Article';

  // --- Title ---
  const titleEl = articleMeta['title-group']?.[0]?.['article-title']?.[0];
  const title = stripXmlTags(textContent(titleEl));

  // --- DOI ---
  const doiEl = (articleMeta['article-id'] || []).find(
    (el) => el?.$?.['pub-id-type'] === 'doi'
  );
  const doi = doiEl ? textContent(doiEl) : '';

  // --- PMID ---
  const pmidEl = (articleMeta['article-id'] || []).find(
    (el) => el?.$?.['pub-id-type'] === 'pmid'
  );
  const pmid = pmidEl ? textContent(pmidEl) : '';

  // --- Authors & Affiliations ---
  const contribGroup = articleMeta['contrib-group']?.[0] || {};
  const { authors, correspondingAuthor, authorMetadata } = parseAuthors(contribGroup);

  // --- Dates ---
  const history = articleMeta.history?.[0] || {};
  const received = parseHistoryDate(history, 'received');
  const accepted = parseHistoryDate(history, 'accepted');
  const published = parsePubDate(articleMeta['pub-date']);

  // --- Volume / Issue / Pages ---
  const volume = parseInt(textContent(articleMeta.volume?.[0])) || null;
  const issue = textContent(articleMeta.issue?.[0]) || '';
  const fpage = textContent(articleMeta.fpage?.[0]) || '';
  const lpage = textContent(articleMeta.lpage?.[0]) || '';
  const elocationId = textContent(articleMeta['elocation-id']?.[0]) || '';
  const pages = fpage && lpage ? `${fpage}-${lpage}` : fpage || elocationId || '';

  // --- Abstract ---
  const { abstract, abstractHtml } = parseAbstract(articleMeta.abstract?.[0]);

  // --- Keywords ---
  const kwdGroups = articleMeta['kwd-group'] || [];
  const enKwdGroup = kwdGroups.find((g) => g.$?.['xml:lang'] === 'en') || kwdGroups[0];
  const keywords = (enKwdGroup?.kwd || []).map((k) => stripXmlTags(textContent(k)));

  // --- Body HTML ---
  const bodyHtml = convertBodyToHtml(body);

  // --- Figures ---
  const figures = parseFigures(floatsGroup);

  // --- Tables ---
  const tables = parseTables(floatsGroup);

  // --- Supplementary materials ---
  const supplementary = parseSupplementary(articleMeta, body, back, floatsGroup);

  // --- Funding ---
  const funding = parseFunding(articleMeta);

  // --- Permissions (license/copyright) ---
  const permissions = parsePermissions(articleMeta);

  // --- Back matter (fn-group, references, acknowledgments) ---
  const backMatter = parseBackMatter(back);

  // --- Full text (body + figures + tables + back) ---
  const fullTextHtml = buildFullTextHtml(bodyHtml, figures, tables, backMatter, supplementary, funding);

  // --- Related articles (erratum/retraction links) ---
  const relatedArticles = parseRelatedArticles(body, articleMeta);

  // --- Response (Letter reply) ---
  let replyArticle = null;
  if (response) {
    replyArticle = parseResponse(response);
  }

  // --- Preview text ---
  const previewText = abstract ? abstract.slice(0, 360).replace(/\s+/g, ' ').trim() : '';

  const parsed = {
    type,
    title,
    doi,
    pmid,
    authors,
    abstract,
    abstractHtml,
    previewText,
    keywords,
    received,
    accepted,
    published,
    volume,
    issue,
    pages,
    elocationId,
    fullTextHtml,
    figures: figures.map((f) => ({ id: f.id, label: f.label, caption: f.caption, imageFile: f.imageFile })),
    supplementary,
    funding,
    permissions,
    relatedArticles,
    replyArticle,
    authorMetadata: {
      correspondingName: correspondingAuthor?.name || '',
      correspondingAffiliation: correspondingAuthor?.affiliation || '',
      email: correspondingAuthor?.email || '',
      ...authorMetadata,
    },
  };

  return parsed;
}

// --- Helper functions ---

function textContent(el) {
  if (!el) return '';
  if (typeof el === 'string') return el;
  if (Array.isArray(el)) return el.map(textContent).join('');
  if (typeof el === 'object') {
    // Use $$ for ordered mixed content (text + elements interleaved)
    if (el.$$) {
      return el.$$.map((child) => {
        if (child['#name'] === '__text__') return child._ || '';
        return textContent(child);
      }).join('');
    }
    // Fallback: plain text or recurse into children
    if (el._) return el._;
    let text = '';
    for (const key of Object.keys(el)) {
      if (key === '$' || key === '$$' || key === '#name') continue;
      const val = el[key];
      if (Array.isArray(val)) text += val.map(textContent).join('');
      else text += textContent(val);
    }
    return text;
  }
  return String(el);
}

function stripXmlTags(str) {
  return str.replace(/<[^>]+>/g, '').trim();
}

function parseAuthors(contribGroup) {
  const contribs = contribGroup.contrib || [];
  const affs = contribGroup.aff || [];
  const affMap = {};

  for (const aff of affs) {
    const id = aff.$?.id;
    if (id) {
      // Get text but strip the label element
      let affText = textContent(aff);
      const label = aff.label?.[0];
      if (label) {
        const labelText = textContent(label);
        affText = affText.replace(labelText, '').trim();
      }
      affMap[id] = affText;
    }
  }

  const authors = [];
  let correspondingAuthor = null;
  const orcidByName = {};

  for (const contrib of contribs) {
    if (contrib.$?.['contrib-type'] !== 'author') continue;

    const nameEl = contrib.name?.[0] || {};
    const surname = textContent(nameEl.surname?.[0]);
    const givenNames = textContent(nameEl['given-names']?.[0]);
    const fullName = `${givenNames} ${surname}`.trim();

    const orcidEl = (contrib['contrib-id'] || []).find(
      (c) => c.$?.['contrib-id-type'] === 'orcid'
    );
    const orcid = orcidEl ? textContent(orcidEl) : '';

    // Resolve affiliations
    const xrefs = (contrib.xref || []).filter((x) => x.$?.['ref-type'] === 'aff');
    const affiliations = xrefs
      .map((x) => affMap[x.$?.rid])
      .filter(Boolean);
    const affiliation = affiliations.join('; ');

    const email = textContent(contrib.email?.[0]);
    const isCorresponding = contrib.$?.corresp === 'yes';

    authors.push({ name: fullName, affiliation, orcid });

    if (orcid) orcidByName[fullName] = orcid;

    if (isCorresponding) {
      correspondingAuthor = { name: fullName, affiliation, email };
    }
  }

  return {
    authors,
    correspondingAuthor,
    authorMetadata: { orcidByName },
  };
}

function parseHistoryDate(history, dateType) {
  const dates = history.date || [];
  const d = dates.find((dt) => dt.$?.['date-type'] === dateType);
  if (!d) return '';
  return formatDate(d);
}

function parsePubDate(pubDates) {
  if (!pubDates || !pubDates.length) return '';
  const pubDate = pubDates.find((d) => d.$?.['date-type'] === 'pub') || pubDates[0];
  return formatDate(pubDate);
}

function formatDate(dateEl) {
  if (!dateEl) return '';
  const year = textContent(dateEl.year?.[0]);
  const month = textContent(dateEl.month?.[0]);
  const day = textContent(dateEl.day?.[0]);
  if (!year) return '';
  return `${year}-${(month || '01').padStart(2, '0')}-${(day || '01').padStart(2, '0')}`;
}

function parseAbstract(abstractEl) {
  if (!abstractEl) return { abstract: '', abstractHtml: '' };

  const isStructured = abstractEl.$?.['abstract-type'] === 'section' || abstractEl.sec;

  if (isStructured) {
    const sections = abstractEl.sec || [];
    let plainParts = [];
    let htmlParts = [];

    for (const sec of sections) {
      const secTitle = textContent(sec.title?.[0]);
      const paragraphs = (sec.p || []).map((p) => inlineToHtml(p));
      const plainParas = (sec.p || []).map((p) => textContent(p));

      if (secTitle) {
        htmlParts.push(`<strong>${secTitle}:</strong> ${paragraphs.join(' ')}`);
        plainParts.push(`${secTitle}: ${plainParas.join(' ')}`);
      } else {
        htmlParts.push(paragraphs.join(' '));
        plainParts.push(plainParas.join(' '));
      }
    }

    return {
      abstract: plainParts.join(' ').trim(),
      abstractHtml: htmlParts.map((h) => `<p>${h}</p>`).join('\n'),
    };
  }

  // Flat abstract
  const paragraphs = abstractEl.p || [];
  const plainText = paragraphs.map((p) => textContent(p)).join(' ').trim();
  const htmlText = paragraphs.map((p) => `<p>${inlineToHtml(p)}</p>`).join('\n');

  return { abstract: plainText, abstractHtml: htmlText };
}

function inlineToHtml(el) {
  if (!el) return '';
  if (typeof el === 'string') return escapeHtml(el);

  const tagMap = {
    italic: 'em',
    bold: 'strong',
    sup: 'sup',
    sub: 'sub',
    'ext-link': 'a',
  };

  // Use $$ array for correct mixed content ordering (text + elements interleaved)
  if (el.$$) {
    let html = '';
    for (const child of el.$$) {
      const tag = child['#name'];
      if (tag === '__text__') {
        html += escapeHtml(child._);
      } else if (tagMap[tag]) {
        if (tag === 'ext-link') {
          const href = child.$?.['xlink:href'] || '#';
          html += `<a href="${escapeHtml(href)}" target="_blank">${inlineToHtml(child)}</a>`;
        } else {
          html += `<${tagMap[tag]}>${inlineToHtml(child)}</${tagMap[tag]}>`;
        }
      } else if (tag === 'xref') {
        const refType = child.$?.['ref-type'];
        if (refType === 'bibr') {
          html += `<sup>${textContent(child)}</sup>`;
        } else if (refType === 'fig') {
          html += `<a href="#${child.$?.rid || ''}">${textContent(child)}</a>`;
        } else if (refType === 'table') {
          html += `<a href="#${child.$?.rid || ''}">${textContent(child)}</a>`;
        } else {
          html += textContent(child);
        }
      } else if (tag === 'list') {
        html += convertListToHtml(child);
      } else if (tag === 'def-list') {
        html += convertDefListToHtml(child);
      } else {
        html += inlineToHtml(child);
      }
    }
    return html;
  }

  // Fallback for simple elements without $$
  if (el._) return escapeHtml(el._);
  return '';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function convertBodyToHtml(body) {
  if (!body || !body.sec) return '';
  return body.sec.map((sec) => convertSectionToHtml(sec, 'h3')).join('\n');
}

function isSupplementaryOnlySection(sec) {
  const title = textContent(sec.title?.[0]).trim();
  if (!/^supplementary materials?$/i.test(title)) return false;
  if (sec.$$) {
    return sec.$$.every((child) => {
      const tag = child['#name'];
      return tag === '__text__' || tag === 'title' || tag === 'supplementary-material';
    });
  }
  return !(sec.p?.length || sec.list?.length || sec['def-list']?.length || sec['table-wrap']?.length || sec.sec?.length);
}

function convertSectionToHtml(sec, headingTag) {
  if (isSupplementaryOnlySection(sec)) return '';
  let html = '';
  const title = textContent(sec.title?.[0]);
  if (title) html += `<${headingTag}>${escapeHtml(title)}</${headingTag}>\n`;

  const nextTag = headingTag === 'h3' ? 'h4' : 'h5';

  // Use $$ array for correct document order (explicitChildren: true)
  if (sec.$$) {
    for (const child of sec.$$) {
      const tag = child['#name'];
      if (tag === 'title') continue; // already handled above
      if (tag === 'p') html += `<p>${inlineToHtml(child)}</p>\n`;
      else if (tag === 'sec') html += convertSectionToHtml(child, nextTag);
      else if (tag === 'list') html += convertListToHtml(child) + '\n';
      else if (tag === 'def-list') html += convertDefListToHtml(child) + '\n';
      else if (tag === 'fig') { /* figures handled separately (floats-group) */ }
      // A <table-wrap> placed inline inside a body <sec> (rather than in
      // <floats-group>) would otherwise be dropped — emit it in place so the
      // table is not lost.
      else if (tag === 'table-wrap') html += tableWrapToHtml(child) + '\n';
    }
  } else {
    // Fallback for objects without $$ (shouldn't happen with explicitChildren)
    for (const p of sec.p || []) html += `<p>${inlineToHtml(p)}</p>\n`;
    for (const list of sec.list || []) html += convertListToHtml(list) + '\n';
    for (const dl of sec['def-list'] || []) html += convertDefListToHtml(dl) + '\n';
    for (const tw of sec['table-wrap'] || []) html += tableWrapToHtml(tw) + '\n';
    for (const subsec of sec.sec || []) html += convertSectionToHtml(subsec, nextTag);
  }

  return html;
}

function convertListToHtml(list) {
  const listType = list.$?.['list-type'] || 'bullet';
  const tag = listType === 'order' ? 'ol' : 'ul';
  let html = `<${tag}>`;
  for (const item of list['list-item'] || []) {
    const parts = (item.p || []).map((p) => inlineToHtml(p));
    let content = parts.join(' ');
    // Nested lists inside list-item
    for (const nested of item.list || []) {
      content += convertListToHtml(nested);
    }
    html += `<li>${content}</li>`;
  }
  html += `</${tag}>`;
  return html;
}

function convertDefListToHtml(defList) {
  let html = '<dl>';
  for (const item of defList['def-item'] || []) {
    const term = inlineToHtml(item.term?.[0]);
    const defs = (item.def?.[0]?.p || []).map((p) => inlineToHtml(p));
    html += `<dt>${term}</dt>`;
    html += `<dd>${defs.join(' ')}</dd>`;
  }
  html += '</dl>';
  return html;
}

function parseFigures(floatsGroup) {
  const figs = floatsGroup.fig || [];
  return figs.map((fig) => {
    const id = fig.$?.id || '';
    const label = textContent(fig.label?.[0]);
    const captionParts = (fig.caption?.[0]?.p || []).map((p) => inlineToHtml(p));
    const caption = captionParts.join(' ');
    const graphic = fig.graphic?.[0];
    const imageFile = graphic?.$?.['xlink:href'] || '';

    return { id, label, caption, imageFile };
  });
}

function parseTables(floatsGroup) {
  const tableWraps = floatsGroup['table-wrap'] || [];
  return tableWraps.map((tw) => {
    const id = tw.$?.id || '';
    const label = textContent(tw.label?.[0]);
    const tableEl = tw.table?.[0];
    const tableHtml = tableEl ? convertTableToHtml(tableEl) : '';
    const footParts = (tw['table-wrap-foot']?.[0]?.p || []).map((p) => inlineToHtml(p));
    const footnote = footParts.join('<br>');

    return { id, label, tableHtml, footnote };
  });
}

// Render a single <table-wrap> element to the same labelled block that
// buildFullTextHtml uses for floats-group tables. Used for tables embedded
// inline within body <sec>s so they survive instead of being dropped.
function tableWrapToHtml(tw) {
  if (!tw) return '';
  const id = tw.$?.id || '';
  const label = textContent(tw.label?.[0]);
  const tableEl = tw.table?.[0];
  const tableHtml = tableEl ? convertTableToHtml(tableEl) : '';
  if (!tableHtml) return '';
  const footParts = (tw['table-wrap-foot']?.[0]?.p || []).map((p) => inlineToHtml(p));
  const footnote = footParts.join('<br>');
  let html = `<div${id ? ` id="${escapeHtml(id)}"` : ''} class="article-table-wrap">`;
  if (label) html += `<p class="table-label"><strong>${escapeHtml(label)}</strong></p>`;
  html += tableHtml;
  if (footnote) html += `<p class="table-footnote">${footnote}</p>`;
  html += '</div>';
  return html;
}

function convertTableToHtml(tableEl) {
  let html = '<table class="article-table">';

  for (const section of ['thead', 'tbody', 'tfoot']) {
    const sectionEl = tableEl[section]?.[0];
    if (!sectionEl) continue;
    html += `<${section}>`;
    for (const tr of sectionEl.tr || []) {
      html += '<tr>';
      for (const cellTag of ['th', 'td']) {
        for (const cell of tr[cellTag] || []) {
          const colspan = cell.$?.colspan || '';
          const rowspan = cell.$?.rowspan || '';
          let attrs = '';
          if (colspan && colspan !== '1') attrs += ` colspan="${colspan}"`;
          if (rowspan && rowspan !== '1') attrs += ` rowspan="${rowspan}"`;
          const content = (cell.p || []).map((p) => inlineToHtml(p)).join(' ');
          html += `<${cellTag}${attrs}>${content || inlineToHtml(cell)}</${cellTag}>`;
        }
      }
      html += '</tr>';
    }
    html += `</${section}>`;
  }

  html += '</table>';
  return html;
}

// --- Supplementary materials ---
function collectBodySupplementaryMaterials(sections, materials) {
  for (const sec of sections || []) {
    materials.push(...(sec['supplementary-material'] || []));
    collectBodySupplementaryMaterials(sec.sec || [], materials);
  }
}

function findFirstExtLinkHref(el) {
  if (!el || typeof el !== 'object') return '';
  if (el['#name'] === 'ext-link' && el.$?.['xlink:href']) return el.$['xlink:href'];
  if (el['ext-link']?.[0]?.$?.['xlink:href']) return el['ext-link'][0].$['xlink:href'];
  if (el.$$) {
    for (const child of el.$$) {
      const href = findFirstExtLinkHref(child);
      if (href) return href;
    }
  }
  for (const key of Object.keys(el)) {
    if (key === '$' || key === '$$' || key === '#name') continue;
    const val = el[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        const href = findFirstExtLinkHref(item);
        if (href) return href;
      }
    } else if (val && typeof val === 'object') {
      const href = findFirstExtLinkHref(val);
      if (href) return href;
    }
  }
  return '';
}

function parseSupplementary(articleMeta, body, back, floatsGroup) {
  const materials = [];
  const bodyMaterials = [];
  collectBodySupplementaryMaterials(body.sec || [], bodyMaterials);
  const sources = [
    ...(articleMeta['supplementary-material'] || []),
    ...bodyMaterials,
    ...(back['supplementary-material'] || []),
    ...(floatsGroup['supplementary-material'] || []),
  ];
  for (const sm of sources) {
    const id = sm.$?.id || '';
    const label = textContent(sm.label?.[0]) || '';
    const caption = (sm.caption?.[0]?.p || []).map((p) => textContent(p)).join(' ');
    const mediaEl = sm.media?.[0] || sm['inline-supplementary-material']?.[0];
    const href = mediaEl?.$?.['xlink:href'] || sm.$?.['xlink:href'] || findFirstExtLinkHref(sm) || '';
    const mimeType = mediaEl?.$?.['mime-subtype'] || mediaEl?.$?.['mimetype'] || '';
    materials.push({ id, label, caption, href, mimeType });
  }
  return materials;
}

// --- Funding info ---
function parseFunding(articleMeta) {
  const fundingGroup = articleMeta['funding-group']?.[0];
  if (!fundingGroup) return [];
  const awards = fundingGroup['award-group'] || [];
  return awards.map((ag) => {
    const source = textContent(ag['funding-source']?.[0]) || '';
    const awardIds = (ag['award-id'] || []).map((a) => textContent(a));
    return { source, awardIds };
  });
}

// --- Permissions (copyright/license) ---
function parsePermissions(articleMeta) {
  const perm = articleMeta.permissions?.[0];
  if (!perm) return null;
  const copyrightStatement = textContent(perm['copyright-statement']?.[0]) || '';
  const copyrightYear = textContent(perm['copyright-year']?.[0]) || '';
  const copyrightHolder = textContent(perm['copyright-holder']?.[0]) || '';
  const licenseEl = perm.license?.[0];
  const licenseType = licenseEl?.$?.['license-type'] || '';
  const licenseUrl = licenseEl?.$?.['xlink:href'] || '';
  const licenseText = (licenseEl?.['license-p'] || licenseEl?.p || []).map((p) => textContent(p)).join(' ');
  return { copyrightStatement, copyrightYear, copyrightHolder, licenseType, licenseUrl, licenseText };
}

function parseBackMatter(back) {
  const result = { footnotes: [], references: [], acknowledgments: '' };

  // Acknowledgments
  const ack = back.ack?.[0];
  if (ack) {
    const parts = (ack.p || []).map((p) => inlineToHtml(p));
    result.acknowledgments = parts.join('\n');
  }

  // Footnotes (fn-group)
  for (const fnGroup of back['fn-group'] || []) {
    for (const fn of fnGroup.fn || []) {
      const fnType = fn.$?.['fn-type'] || '';
      const text = (fn.p || []).map((p) => inlineToHtml(p)).join(' ');
      result.footnotes.push({ type: fnType, html: text });
    }
  }

  // References
  const refList = back['ref-list']?.[0];
  if (refList) {
    for (const ref of refList.ref || []) {
      const label = textContent(ref.label?.[0]);
      const citation = ref['element-citation']?.[0] || ref['mixed-citation']?.[0];
      if (citation) {
        result.references.push({
          label,
          html: formatCitation(citation),
        });
      }
    }
  }

  return result;
}

function formatCitation(citation) {
  const authors = (citation['person-group']?.[0]?.name || [])
    .map((n) => `${textContent(n.surname?.[0])} ${textContent(n['given-names']?.[0])}`)
    .join(', ');

  const hasEtal = citation['person-group']?.[0]?.etal;
  const authorStr = hasEtal ? `${authors}, et al` : authors;

  const articleTitle = textContent(citation['article-title']?.[0]);
  const source = textContent(citation.source?.[0]);
  const year = textContent(citation.year?.[0]);
  const volume = textContent(citation.volume?.[0]);
  const fpage = textContent(citation.fpage?.[0]);
  const lpage = textContent(citation.lpage?.[0]);
  const doi = (citation['pub-id'] || []).find((p) => p.$?.['pub-id-type'] === 'doi');

  let html = `${escapeHtml(authorStr)}. ${escapeHtml(articleTitle)}. `;
  if (source) html += `<em>${escapeHtml(source)}</em>. `;
  if (year) html += `${year}`;
  if (volume) html += `;${volume}`;
  if (fpage) html += `:${fpage}`;
  if (lpage) html += `-${lpage}`;
  html += '.';
  if (doi) html += ` doi:${textContent(doi)}`;

  return html;
}

function parseRelatedArticles(body, articleMeta) {
  const related = [];

  // Search body for <related-article> elements
  const bodyXml = JSON.stringify(body);
  if (bodyXml.includes('related-article')) {
    findRelatedArticles(body, related);
  }

  // Also check article-meta for related-article
  const metaRelated = articleMeta['related-article'] || [];
  for (const ra of metaRelated) {
    const relType = ra.$?.['related-article-type'] || '';
    related.push({
      type: mapRelatedType(relType),
      targetDoi: '',
      targetPmid: ra.$?.['xlink:href'] || '',
      targetVolume: parseInt(ra.$?.vol) || null,
      targetPages: ra.$?.page || '',
      label: textContent(ra),
    });
  }

  return related;
}

function findRelatedArticles(obj, result) {
  if (!obj || typeof obj !== 'object') return;

  if (obj['related-article']) {
    for (const ra of obj['related-article']) {
      const relType = ra.$?.['related-article-type'] || '';
      result.push({
        type: mapRelatedType(relType),
        targetDoi: '',
        targetPmid: ra.$?.['xlink:href'] || '',
        targetVolume: parseInt(ra.$?.vol) || null,
        targetPages: ra.$?.page || '',
        label: textContent(ra),
      });
    }
  }

  // Recurse
  for (const key of Object.keys(obj)) {
    if (key === '$') continue;
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) findRelatedArticles(item, result);
    } else if (typeof val === 'object') {
      findRelatedArticles(val, result);
    }
  }
}

function mapRelatedType(jatsType) {
  const map = {
    'corrected-article': 'erratum-for',
    'retracted-article': 'retraction-of',
    'commentary-article': 'comment-on',
    'companion': 'related-to',
  };
  return map[jatsType] || 'related-to';
}

function parseResponse(response) {
  const frontStub = response['front-stub']?.[0] || {};
  const body = response.body?.[0] || {};
  const back = response.back?.[0] || {};

  const title = textContent(frontStub['title-group']?.[0]?.['article-title']?.[0]) || 'Reply';
  const bodyHtml = convertBodyToHtml(body);
  const backMatter = parseBackMatter(back);

  return { title, bodyHtml, backMatter };
}

function buildFullTextHtml(bodyHtml, figures, tables, backMatter, supplementary, funding) {
  let html = bodyHtml;

  // Add figures
  for (const fig of figures) {
    html += `\n<figure id="${fig.id}" class="article-figure">\n`;
    html += `  <figcaption><strong>${escapeHtml(fig.label)}</strong></figcaption>\n`;
    if (fig.imageFile) {
      html += `  <img src="${escapeHtml(fig.imageFile)}" alt="${escapeHtml(fig.label)}" loading="lazy">\n`;
    }
    if (fig.caption) html += `  <p>${fig.caption}</p>\n`;
    html += '</figure>\n';
  }

  // Add tables
  for (const tbl of tables) {
    html += `\n<div id="${tbl.id}" class="article-table-wrap">\n`;
    html += `  <p class="table-label"><strong>${escapeHtml(tbl.label)}</strong></p>\n`;
    html += `  ${tbl.tableHtml}\n`;
    if (tbl.footnote) html += `  <p class="table-footnote">${tbl.footnote}</p>\n`;
    html += '</div>\n';
  }

  // Add back-matter notes inline with the article flow. These are labels, not
  // article section headings, so they must not populate the table of contents.
  if (backMatter.acknowledgments || backMatter.footnotes.length || (funding && funding.length)) {
    html += '\n<div class="article-backmatter-notes">\n';
    if (backMatter.acknowledgments) {
      for (const part of backMatter.acknowledgments.split('\n')) {
        if (part.trim()) html += `  <p><strong>Acknowledgments:</strong> ${part}</p>\n`;
      }
    }
    for (const fn of backMatter.footnotes) {
      html += `  <p>${fn.html}</p>\n`;
    }
    if (funding && funding.length) {
      for (const f of funding) {
        const ids = f.awardIds.length ? ` (${escapeHtml(f.awardIds.join(', '))})` : '';
        html += `  <p><strong>Funding:</strong> ${escapeHtml(f.source)}${ids}</p>\n`;
      }
    }
    html += '</div>\n';
  }

  // Add article notes and supplementary materials as one compact PDF-style block.
  if (false && (backMatter.footnotes.length || (supplementary && supplementary.length))) {
    html += '\n<div class="article-notes-box">\n';
    for (const fn of backMatter.footnotes) {
      html += `  <p>${fn.html}</p>\n`;
    }
    for (const sm of supplementary || []) {
      const id = sm.id ? ` id="${escapeHtml(sm.id)}"` : '';
      const label = sm.label ? escapeHtml(sm.label) : 'Supplementary Material:';
      const href = sm.href ? escapeHtml(sm.href) : '';
      const caption = sm.caption ? escapeHtml(sm.caption) : '';
      html += `  <p${id} data-supplementary-note="true"><strong>${label}</strong>`;
      if (href) html += ` <a href="${href}" target="_blank" rel="noopener">${caption || href}</a>`;
      else if (caption) html += ` ${caption}`;
      html += '</p>\n';
    }
    html += '</div>\n';
    supplementary = [];
    backMatter.footnotes = [];
  }

  // Add supplementary materials as a real section immediately before references.
  if (supplementary && supplementary.length) {
    html += '\n<div class="article-supplementary">\n';
    html += '  <h3>Supplementary Materials</h3>\n';
    for (const sm of supplementary) {
      const label = sm.label ? escapeHtml(sm.label) : 'Supplementary Material';
      const caption = sm.caption ? ` — ${escapeHtml(sm.caption)}` : '';
      if (sm.href) {
        html += `    <p data-supplementary-note="true"><strong>${label}</strong> <a href="${escapeHtml(sm.href)}" target="_blank" rel="noopener">${caption || escapeHtml(sm.href)}</a></p>\n`;
      } else {
        html += `    <p data-supplementary-note="true"><strong>${label}</strong>${caption}</p>\n`;
      }
    }
    html += '</div>\n';
  }

  // Add footnotes
  if (false && backMatter.footnotes.length) {
    html += '\n<div class="article-footnotes">\n';
    for (const fn of backMatter.footnotes) {
      html += `  <p>${fn.html}</p>\n`;
    }
    html += '</div>\n';
  }

  // Add references
  if (backMatter.references.length) {
    html += '\n<div class="article-references">\n';
    html += '  <h3>References</h3>\n  <ol>\n';
    for (const ref of backMatter.references) {
      html += `    <li>${ref.html}</li>\n`;
    }
    html += '  </ol>\n</div>\n';
  }

  return html;
}

module.exports = { parseJatsXml };
