#!/usr/bin/env node
/**
 * Fetch PubMed IDs (PMIDs) for articles in articles.js using NCBI E-utilities.
 *
 * Usage:
 *   node scripts/sync_pmids.js                  # dry-run (prints matches)
 *   node scripts/sync_pmids.js --write          # updates js/data/articles.js
 *
 * NCBI rate limit: 3 requests/second (without API key).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ARTICLES_JS = path.resolve(__dirname, '..', 'js', 'data', 'articles.js');
const RATE_LIMIT_MS = 340; // ~3 requests/second

function parseArticlesJs(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const body = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/window\.ARTICLES\s*=\s*/, '')
    .trim()
    .replace(/;\s*$/, '');
  return JSON.parse(body);
}

function writeArticlesJs(filePath, articles) {
  const now = new Date().toISOString().slice(0, 10);
  const header =
    '/**\n' +
    ' * Balkan Medical Journal — Articles Data\n' +
    ' * Source sync from https://balkanmedicaljournal.org\n' +
    ' * PMID sync date: ' + now + '\n' +
    ' */\n';
  const body = JSON.stringify(articles, null, 2);
  fs.writeFileSync(filePath, header + 'window.ARTICLES = ' + body + ';\n', 'utf-8');
}

function lookupPmid(doi) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      db: 'pubmed',
      retmode: 'json',
      term: doi + '[doi]',
    });
    const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?' + params.toString();

    https.get(url, { headers: { 'User-Agent': 'BalkanMedJ-PMID-Sync/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const ids = (json.esearchresult || {}).idlist || [];
          resolve(ids.length ? ids[0] : null);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const doWrite = args.includes('--write');

  const articles = parseArticlesJs(ARTICLES_JS);

  const toLookup = [];
  let alreadyHave = 0;
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    if (a.pmid) { alreadyHave++; continue; }
    if (a.doi) { toLookup.push(i); }
  }

  console.log('Total articles:           ' + articles.length);
  console.log('Already have PMID:        ' + alreadyHave);
  console.log('Have DOI, need lookup:    ' + toLookup.length);
  console.log();

  if (!toLookup.length) {
    console.log('Nothing to do.');
    return;
  }

  let found = 0;
  let notFound = 0;

  for (let idx = 0; idx < toLookup.length; idx++) {
    const i = toLookup[idx];
    const doi = articles[i].doi;
    const pmid = await lookupPmid(doi);
    const progress = '[' + (idx + 1) + '/' + toLookup.length + ']';

    if (pmid) {
      articles[i].pmid = pmid;
      found++;
      console.log('  ' + progress + ' ' + doi + ' -> PMID ' + pmid);
    } else {
      notFound++;
      if (idx < 20 || (idx + 1) % 100 === 0) {
        console.log('  ' + progress + ' ' + doi + ' -> not found');
      }
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log();
  console.log('Found:     ' + found);
  console.log('Not found: ' + notFound);

  if (doWrite && found > 0) {
    writeArticlesJs(ARTICLES_JS, articles);
    console.log('\nUpdated ' + ARTICLES_JS);
  } else if (found > 0) {
    console.log('\nDry run — use --write to save results to articles.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
