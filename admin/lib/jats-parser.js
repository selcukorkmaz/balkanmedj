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

/**
 * Parse a JATS XML string and return a structured article object.
 */
async function parseJatsXml(xmlString) {
  const result = await parseStringPromise(xmlString, {
    explicitArray: true,
    mergeAttrs: false,
    normalizeTags: false,
    preserveChildrenOrder: true,
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
  const pages = fpage && lpage ? `${fpage}-${lpage}` : fpage || '';

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

  // --- Back matter (fn-group, references) ---
  const backMatter = parseBackMatter(back);

  // --- Full text (body + figures + tables + back) ---
  const fullTextHtml = buildFullTextHtml(bodyHtml, figures, tables, backMatter);

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
    fullTextHtml,
    figures: figures.map((f) => ({ id: f.id, label: f.label, imageFile: f.imageFile })),
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
  if (el._) return el._;
  if (Array.isArray(el)) return el.map(textContent).join('');
  if (typeof el === 'object') {
    // Recurse into child elements
    let text = '';
    for (const key of Object.keys(el)) {
      if (key === '$') continue;
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

  let html = '';

  // Handle mixed content (text + child elements)
  if (el._) html += escapeHtml(el._);

  const tagMap = {
    italic: 'em',
    bold: 'strong',
    sup: 'sup',
    sub: 'sub',
    'ext-link': 'a',
  };

  for (const key of Object.keys(el)) {
    if (key === '$' || key === '_') continue;
    const children = Array.isArray(el[key]) ? el[key] : [el[key]];

    for (const child of children) {
      const htmlTag = tagMap[key];
      if (htmlTag) {
        if (key === 'ext-link') {
          const href = child.$?.['xlink:href'] || '#';
          html += `<a href="${escapeHtml(href)}" target="_blank">${inlineToHtml(child)}</a>`;
        } else {
          html += `<${htmlTag}>${inlineToHtml(child)}</${htmlTag}>`;
        }
      } else if (key === 'xref') {
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
      } else {
        html += inlineToHtml(child);
      }
    }
  }

  return html;
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

function convertSectionToHtml(sec, headingTag) {
  let html = '';
  const title = textContent(sec.title?.[0]);
  if (title) html += `<${headingTag}>${escapeHtml(title)}</${headingTag}>\n`;

  for (const p of sec.p || []) {
    html += `<p>${inlineToHtml(p)}</p>\n`;
  }

  // Nested subsections
  for (const subsec of sec.sec || []) {
    const nextTag = headingTag === 'h3' ? 'h4' : 'h5';
    html += convertSectionToHtml(subsec, nextTag);
  }

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

function parseBackMatter(back) {
  const result = { footnotes: [], references: [] };

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

function buildFullTextHtml(bodyHtml, figures, tables, backMatter) {
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

  // Add footnotes
  if (backMatter.footnotes.length) {
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
