/**
 * Balkan Medical Journal — Homepage Rendering
 * Lightweight homepage feed + robust fallbacks.
 */
(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripTags(value) {
    return String(value == null ? '' : value).replace(/<[^>]*>/g, '').trim();
  }

  function formatDate(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    var date = new Date(raw);
    if (isNaN(date.getTime())) return raw;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatAuthors(authors) {
    var names = (authors || []).map(function (author) {
      return stripTags(author && author.name);
    }).filter(Boolean);

    if (!names.length) return '';
    if (names.length <= 2) return names.join(', ');
    return names[0] + ' et al.';
  }

  function typeBadgeClass(articleType) {
    if (window.BMJArticleTypes && typeof window.BMJArticleTypes.getBadgeClass === 'function') {
      return window.BMJArticleTypes.getBadgeClass(articleType);
    }
    return 'bg-teal-100 text-teal-700';
  }

  function newsBadgeClass(category) {
    if (category === 'News') return 'bg-teal-100 text-teal-700';
    if (category === 'Announcement') return 'bg-blue-100 text-blue-700';
    if (category === 'Award') return 'bg-amber-100 text-amber-700';
    if (category === 'Indexing') return 'bg-green-100 text-green-700';
    if (category === 'Event') return 'bg-purple-100 text-purple-700';
    return 'bg-gray-100 text-gray-700';
  }

  function loadScriptOnce(id, src) {
    return new Promise(function (resolve, reject) {
      var existing = document.getElementById(id);
      if (existing) {
        if (existing.getAttribute('data-loaded') === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', function () { resolve(); }, { once: true });
        existing.addEventListener('error', function () { reject(new Error('Failed to load ' + src)); }, { once: true });
        return;
      }

      var script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.async = true;
      script.onload = function () {
        script.setAttribute('data-loaded', 'true');
        resolve();
      };
      script.onerror = function () {
        reject(new Error('Failed to load ' + src));
      };
      document.head.appendChild(script);
    });
  }

  var imageCornerFigureCache = {};
  var imageCornerCropPresetMap = {
    // Clinical Image: Left Ventricular Cardiac Hydatid Cyst Presenting with Angina Pectoris
    '2820': {
      position: '50% 8%',
      scale: '1.27',
      origin: '50% 14%'
    },
    // Clinical Image: External Manual Carotid Compression for Cavernous Sinus Fistula
    '2771': {
      position: '50% 7%',
      scale: '1.24',
      origin: '50% 14%'
    }
  };

  function toAbsoluteImageUrl(path) {
    var raw = String(path || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    raw = raw.replace(/^['"]|['"]$/g, '').replace(/^\/+/, '');
    if (!raw) return '';
    if (raw.indexOf('uploads/') === 0 || raw.indexOf('images/') === 0) {
      return 'https://balkanmedicaljournal.org/' + raw;
    }
    return raw;
  }

  function getImageCornerCropStyle(article) {
    var id = String(article && article.id || '').trim();
    var preset = imageCornerCropPresetMap[id];
    if (!preset) return '';

    var styleParts = [];
    if (preset.position) styleParts.push('--ic-object-position:' + String(preset.position));
    if (preset.scale) styleParts.push('--ic-scale:' + String(preset.scale));
    if (preset.origin) styleParts.push('--ic-origin:' + String(preset.origin));
    return styleParts.length ? (' style="' + escapeHtml(styleParts.join(';')) + '"') : '';
  }

  function extractFigureUrlFromArticleMarkup(markup) {
    var html = String(markup || '');
    if (!html) return '';

    var openWinMatch = html.match(/openWin\(\s*['"]([^'"]+\.(?:jpe?g|png|webp|gif))['"]/i);
    if (openWinMatch && openWinMatch[1]) {
      return toAbsoluteImageUrl(openWinMatch[1]);
    }

    // Supports escaped payloads inside JS files, e.g. openWin(\'uploads/grafik/figure_BMJ_2771_0.jpg\', ...)
    var escapedOpenWinMatch = html.match(/openWin\(\s*\\['"]([^\\'"]+\.(?:jpe?g|png|webp|gif))\\['"]/i);
    if (escapedOpenWinMatch && escapedOpenWinMatch[1]) {
      return toAbsoluteImageUrl(escapedOpenWinMatch[1]);
    }

    var imgMatch = html.match(/<img[^>]+src=['"]([^'"]+\.(?:jpe?g|png|webp|gif))['"][^>]*>/i);
    if (imgMatch && imgMatch[1]) {
      return toAbsoluteImageUrl(imgMatch[1]);
    }

    var escapedImgMatch = html.match(/<img[^>]+src=\\['"]([^\\'"]+\.(?:jpe?g|png|webp|gif))\\['"][^>]*>/i);
    if (escapedImgMatch && escapedImgMatch[1]) {
      return toAbsoluteImageUrl(escapedImgMatch[1]);
    }

    return '';
  }

  function buildImageCornerFigureFallback(article) {
    var sourceId = String(
      (article && article.sourceArticleId) ||
      (article && article.id) ||
      ''
    ).trim();
    if (!sourceId) return '';
    // Mirrors source storage naming for most Clinical Image figures.
    return 'https://balkanmedicaljournal.org/uploads/grafik/figure_BMJ_' + sourceId + '_0.jpg';
  }

  function resolveImageCornerFigureUrl(article) {
    var explicit = String(article && article.image || '').trim();
    if (explicit) return Promise.resolve(toAbsoluteImageUrl(explicit));

    var id = String(article && article.id || '').trim();
    if (!id) return Promise.resolve('');

    if (Object.prototype.hasOwnProperty.call(imageCornerFigureCache, id)) {
      return Promise.resolve(imageCornerFigureCache[id]);
    }

    var deterministicFallback = buildImageCornerFigureFallback(article);

    if (typeof fetch !== 'function') {
      imageCornerFigureCache[id] = deterministicFallback || '';
      return Promise.resolve(imageCornerFigureCache[id]);
    }

    var candidateFiles = [
      'js/data/articles/' + encodeURIComponent(id) + '.html',
      'js/data/articles/' + encodeURIComponent(id) + '.js'
    ];

    function tryFetchAt(index) {
      if (index >= candidateFiles.length) {
        imageCornerFigureCache[id] = deterministicFallback || '';
        return Promise.resolve(imageCornerFigureCache[id]);
      }

      return fetch(candidateFiles[index])
        .then(function (response) {
          if (!response.ok) return '';
          return response.text();
        })
        .then(function (markup) {
          var figureUrl = extractFigureUrlFromArticleMarkup(markup);
          if (figureUrl) {
            imageCornerFigureCache[id] = figureUrl;
            return imageCornerFigureCache[id];
          }
          return tryFetchAt(index + 1);
        })
        .catch(function () {
          return tryFetchAt(index + 1);
        });
    }

    return tryFetchAt(0);
  }

  function hydrateImageCornerImages(articles) {
    if (!Array.isArray(articles) || !articles.length) return;

    articles.forEach(function (article) {
      var articleId = String(article && article.id || '').trim();
      if (!articleId) return;

      resolveImageCornerFigureUrl(article).then(function (figureUrl) {
        if (!figureUrl) return;

        var img = document.querySelector('[data-image-corner-img="' + articleId + '"]');
        var fallback = document.querySelector('[data-image-corner-fallback="' + articleId + '"]');
        if (!img) return;

        img.loading = 'eager';
        img.decoding = 'async';

        if (img.getAttribute('src') !== figureUrl) {
          img.setAttribute('src', figureUrl);
        }

        img.addEventListener('load', function () {
          img.classList.remove('hidden');
          if (fallback) fallback.classList.add('hidden');
        }, { once: true });

        img.addEventListener('error', function () {
          img.classList.add('hidden');
          if (fallback) fallback.classList.remove('hidden');
        }, { once: true });

        if (img.complete && img.naturalWidth > 0) {
          img.classList.remove('hidden');
          if (fallback) fallback.classList.add('hidden');
        }
      });
    });
  }

  function setupLazyArticleLoader() {
    window.BMJLazyData = window.BMJLazyData || {};
    if (typeof window.BMJLazyData.loadArticles === 'function') return;

    function hasRichArticleDataset(items) {
      if (!Array.isArray(items) || !items.length) return false;
      return items.some(function (article) {
        return article &&
          (Object.prototype.hasOwnProperty.call(article, 'doi') ||
           Object.prototype.hasOwnProperty.call(article, 'sourceAbstractUrl'));
      });
    }

    window.BMJLazyData.loadArticles = function () {
      if (hasRichArticleDataset(window.ARTICLES)) {
        return Promise.resolve();
      }
      return loadScriptOnce('bmj-articles-data', 'js/data/articles.js');
    };
  }

  function getFeaturedArticles(data) {
    var featured = Array.isArray(data.featuredArticles) ? data.featuredArticles.slice() : [];
    if (featured.length) return featured.slice(0, 6);

    if (!Array.isArray(window.ARTICLES) || window.ARTICLES.length === 0) return [];

    var issueId = data.currentIssue && String(data.currentIssue.sourceIssueId || '').trim();
    var pool = window.ARTICLES.filter(function (article) {
      if (!article || String(article.type || '').trim() === 'Cover Page') return false;
      if (!issueId) return true;
      return String(article.sourceIssueId || '').trim() === issueId;
    });

    var explicit = pool.filter(function (article) { return !!article.featured; });
    if (explicit.length) return explicit.slice(0, 6);
    return pool.slice(0, 6);
  }

  function getImageCornerArticles(data) {
    var items = Array.isArray(data.imageCornerArticles) ? data.imageCornerArticles.slice() : [];
    if (items.length) return items.slice(0, 2);

    if (!Array.isArray(window.ARTICLES) || window.ARTICLES.length === 0) return [];
    return window.ARTICLES.filter(function (article) {
      return article && (article.imageCorner || String(article.type || '') === 'Image Corner');
    }).slice(0, 2);
  }

  function ensureArticlesInPressData() {
    if (Array.isArray(window.ARTICLES_IN_PRESS) && window.ARTICLES_IN_PRESS.length) {
      return Promise.resolve();
    }
    return loadScriptOnce('bmj-articles-in-press-data', 'js/data/articles-in-press.js');
  }

  function toTimestamp(value) {
    var raw = String(value || '').trim();
    if (!raw) return 0;
    var ms = new Date(raw).getTime();
    return isNaN(ms) ? 0 : ms;
  }

  function numericValue(value) {
    if (value == null) return 0;
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    var normalized = String(value).replace(/,/g, '').trim();
    if (!normalized) return 0;
    var n = Number(normalized);
    return isNaN(n) ? 0 : n;
  }

  function normalizeDoi(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    raw = raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    return raw;
  }

  var liveCitationPromiseCache = {};
  var liveCitationValueCache = {};
  var topJournalCitationMapPromise = null;

  function fetchLiveCitationCount(article) {
    var fallback = numericValue(article && article.citations);
    if (typeof fetch !== 'function') return Promise.resolve(fallback);

    var doi = normalizeDoi(article && article.doi);
    if (!doi) return Promise.resolve(fallback);

    if (Object.prototype.hasOwnProperty.call(liveCitationValueCache, doi)) {
      return Promise.resolve(numericValue(liveCitationValueCache[doi]));
    }
    if (liveCitationPromiseCache[doi]) {
      return liveCitationPromiseCache[doi];
    }

    var url = 'https://api.openalex.org/works?filter=doi:https://doi.org/' + encodeURIComponent(doi) + '&select=doi,cited_by_count&per-page=1';
    liveCitationPromiseCache[doi] = fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('OpenAlex request failed');
        return response.json();
      })
      .then(function (payload) {
        var result = payload && payload.results && payload.results[0] ? payload.results[0] : null;
        var citedBy = numericValue(result && result.cited_by_count);
        liveCitationValueCache[doi] = citedBy;
        return citedBy;
      })
      .catch(function () {
        liveCitationValueCache[doi] = fallback;
        return fallback;
      });

    return liveCitationPromiseCache[doi];
  }

  function getCitationValue(article, citationMap) {
    var doi = normalizeDoi(article && article.doi);
    if (doi && citationMap && Object.prototype.hasOwnProperty.call(citationMap, doi)) {
      return numericValue(citationMap[doi]);
    }
    return numericValue(article && article.citations);
  }

  function fetchTopJournalCitationMap() {
    if (topJournalCitationMapPromise) return topJournalCitationMapPromise;
    if (typeof fetch !== 'function') return Promise.resolve({});

    var url = 'https://api.openalex.org/works?filter=primary_location.source.issn:2146-3131&sort=cited_by_count:desc&per-page=200&select=doi,cited_by_count';
    topJournalCitationMapPromise = fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('OpenAlex top cited request failed');
        return response.json();
      })
      .then(function (payload) {
        var map = {};
        var results = payload && Array.isArray(payload.results) ? payload.results : [];
        results.forEach(function (work) {
          var doi = normalizeDoi(work && work.doi);
          if (!doi) return;
          map[doi] = numericValue(work && work.cited_by_count);
        });
        return map;
      })
      .catch(function () {
        return {};
      });

    return topJournalCitationMapPromise;
  }

  function compareByPublishedDesc(a, b) {
    var aPublished = toTimestamp(a && a.published);
    var bPublished = toTimestamp(b && b.published);
    if (bPublished !== aPublished) return bPublished - aPublished;
    return numericValue(b && b.views) - numericValue(a && a.views);
  }

  function compareByDownloadsDesc(a, b) {
    var aDownloads = numericValue(a && a.downloads);
    var bDownloads = numericValue(b && b.downloads);
    if (bDownloads !== aDownloads) return bDownloads - aDownloads;
    return numericValue(b && b.views) - numericValue(a && a.views);
  }

  function compareByViewsDesc(a, b) {
    var aViews = numericValue(a && a.views);
    var bViews = numericValue(b && b.views);
    if (bViews !== aViews) return bViews - aViews;
    return numericValue(b && b.downloads) - numericValue(a && a.downloads);
  }

  function getCurrentIssueArticles(data, regularArticles) {
    var currentIssue = data && data.currentIssue ? data.currentIssue : {};
    var issueId = String(currentIssue.sourceIssueId || '').trim();
    var volume = String(currentIssue.volume || '').trim();
    var issueNo = String(currentIssue.issue || '').trim();

    if (issueId) {
      return regularArticles.filter(function (article) {
        return String(article && article.sourceIssueId || '').trim() === issueId;
      });
    }

    if (volume && issueNo) {
      return regularArticles.filter(function (article) {
        return String(article && article.volume || '').trim() === volume &&
          String(article && article.issue || '').trim() === issueNo;
      });
    }

    return [];
  }

  function getArticleCollections(data, citationMap) {
    var articles = Array.isArray(window.ARTICLES) ? window.ARTICLES.slice() : [];
    var articlesInPress = Array.isArray(window.ARTICLES_IN_PRESS) ? window.ARTICLES_IN_PRESS.slice() : [];

    var regular = articles.filter(function (article) {
      return article && String(article.type || '').trim() !== 'Cover Page';
    });

    var latestPublishedPool = getCurrentIssueArticles(data, regular).slice().sort(compareByPublishedDesc);
    var topCitedPool = regular.slice().sort(function (a, b) {
      var aCitations = getCitationValue(a, citationMap);
      var bCitations = getCitationValue(b, citationMap);
      if (bCitations !== aCitations) return bCitations - aCitations;
      return compareByPublishedDesc(a, b);
    });

    return {
      'latest-published': latestPublishedPool.slice(0, 6),
      'articles-in-press': articlesInPress.slice().sort(function (a, b) {
        var aOrder = numericValue(a && a.order);
        var bOrder = numericValue(b && b.order);
        if (aOrder !== bOrder) return aOrder - bOrder;
        return compareByViewsDesc(a, b);
      }).slice(0, 6),
      'top-cited': topCitedPool.slice(0, 6),
      'most-downloaded': regular.slice().sort(compareByDownloadsDesc).slice(0, 6)
    };
  }

  var liveUsageMetricPromiseCache = {};

  function parseMetricCount(rawValue) {
    if (rawValue == null) return null;
    var digits = String(rawValue).replace(/[^\d]/g, '');
    if (!digits) return null;
    var value = Number(digits);
    return isNaN(value) ? null : value;
  }

  function parseLiveUsageMetrics(markup) {
    var html = String(markup || '');
    if (!html) return { views: null, downloads: null };

    var viewedMatch = html.match(/<strong>\s*Viewed\s*<\/strong>\s*:\s*([0-9][0-9.,]*)/i) ||
      html.match(/\bViewed\b\s*:\s*([0-9][0-9.,]*)/i);
    var downloadedMatch = html.match(/<strong>\s*Downloaded\s*<\/strong>\s*:\s*([0-9][0-9.,]*)/i) ||
      html.match(/\bDownloaded\b\s*:\s*([0-9][0-9.,]*)/i);

    return {
      views: parseMetricCount(viewedMatch && viewedMatch[1]),
      downloads: parseMetricCount(downloadedMatch && downloadedMatch[1])
    };
  }

  function metricSourceUrl(article) {
    var explicit = String(article && article.sourceAbstractUrl || '').trim();
    if (explicit) return explicit;

    var id = String(article && article.id || '').trim();
    if (!id) return '';
    return 'https://balkanmedicaljournal.org/abstract.php?id=' + encodeURIComponent(id);
  }

  function fetchLiveUsageMetrics(article) {
    var defaultMetrics = {
      views: numericValue(article && article.views),
      downloads: numericValue(article && article.downloads)
    };

    var articleKey = String(article && article.id || '').trim();
    if (!articleKey || typeof fetch !== 'function') return Promise.resolve(defaultMetrics);

    if (liveUsageMetricPromiseCache[articleKey]) {
      return liveUsageMetricPromiseCache[articleKey];
    }

    var url = metricSourceUrl(article);
    if (!url) return Promise.resolve(defaultMetrics);

    liveUsageMetricPromiseCache[articleKey] = fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('Metric source unavailable');
        return response.text();
      })
      .then(function (html) {
        var parsed = parseLiveUsageMetrics(html);
        return {
          views: parsed.views == null ? defaultMetrics.views : parsed.views,
          downloads: parsed.downloads == null ? defaultMetrics.downloads : parsed.downloads
        };
      })
      .catch(function () {
        return defaultMetrics;
      });

    return liveUsageMetricPromiseCache[articleKey];
  }

  function hydrateLiveArticleMetrics(cardsRoot, items) {
    if (!cardsRoot || !Array.isArray(items) || !items.length) return;

    items.forEach(function (article) {
      var articleId = String(article && article.id || '').trim();
      if (!articleId) return;

      var card = cardsRoot.querySelector('[data-article-id="' + articleId + '"]');
      if (!card) return;

      var viewsNode = card.querySelector('[data-metric="views"]');
      var downloadsNode = card.querySelector('[data-metric="downloads"]');
      if (!viewsNode && !downloadsNode) return;

      fetchLiveUsageMetrics(article).then(function (metrics) {
        if (viewsNode) {
          viewsNode.textContent = 'Views: ' + numericValue(metrics.views).toLocaleString('en-US');
        }
        if (downloadsNode) {
          downloadsNode.textContent = 'Downloads: ' + numericValue(metrics.downloads).toLocaleString('en-US');
        }
      });
    });
  }

  function hydrateLiveCitationMetrics(cardsRoot, items, citationMap) {
    if (!cardsRoot || !Array.isArray(items) || !items.length) return;

    items.forEach(function (article) {
      var articleId = String(article && article.id || '').trim();
      if (!articleId) return;

      var card = cardsRoot.querySelector('[data-article-id="' + articleId + '"]');
      if (!card) return;

      var citationNode = card.querySelector('[data-metric="citations"]');
      if (!citationNode) return;

      fetchLiveCitationCount(article).then(function (count) {
        var normalizedCount = numericValue(count);
        var doi = normalizeDoi(article && article.doi);
        if (doi && citationMap) {
          citationMap[doi] = normalizedCount;
        }
        citationNode.textContent = 'Citations: ' + normalizedCount.toLocaleString('en-US');
      });
    });
  }

  function articleUrlForCollectionItem(article, tabKey) {
    var id = encodeURIComponent(String(article && article.id || ''));
    if (!id) return 'archive.html';
    if (tabKey === 'articles-in-press') {
      return 'article.html?id=' + id + '&source=aip';
    }
    return 'article.html?id=' + id;
  }

  function articlePdfUrlForCollectionItem(article) {
    var candidates = [
      article && article.localPdfUrl,
      article && article.pdfUrl,
      article && article.sourcePdfUrl
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      var value = String(candidates[i] || '').trim();
      if (!value) continue;
      if (/^javascript:/i.test(value)) continue;
      return value;
    }

    return '';
  }

  function articleAccessLabel(article, tabKey) {
    if (tabKey === 'articles-in-press' && article && article.hasFullText === false) {
      return 'Abstract only';
    }
    return 'Open access';
  }

  function renderArticleCollectionCards(items, tabKey, citationMap) {
    if (!Array.isArray(items) || !items.length) {
      return '<article class="bg-white rounded-xl border border-gray-200 p-6 md:col-span-2 lg:col-span-3">' +
        '<h3 class="text-lg font-semibold text-gray-900">No articles available in this list.</h3>' +
        '<p class="text-sm text-gray-500 mt-2 font-serif">Please explore other article collections.</p>' +
      '</article>';
    }

    return items.map(function (article) {
      var articleId = escapeHtml(String(article.id || ''));
      var type = escapeHtml(stripTags(article.type || 'Article'));
      var title = escapeHtml(stripTags(article.title || 'Untitled'));
      var authors = escapeHtml(formatAuthors(article.authors || []));
      var url = articleUrlForCollectionItem(article, tabKey);
      var pdfUrl = escapeHtml(articlePdfUrlForCollectionItem(article));
      var access = escapeHtml(articleAccessLabel(article, tabKey));
      var accessDotClass = access === 'Open access' ? 'bg-emerald-400' : 'bg-gray-400';
      var typeBadge = typeBadgeClass(article.type);
      var views = numericValue(article.views).toLocaleString('en-US');
      var downloads = numericValue(article.downloads).toLocaleString('en-US');
      var citations = getCitationValue(article, citationMap).toLocaleString('en-US');
      var citationLabel = 'Citations';
      var hideCitations = tabKey === 'latest-published' || tabKey === 'articles-in-press';

      return '<article class="min-w-0" data-article-id="' + articleId + '">' +
        '<div class="flex items-center gap-2 text-sm text-gray-500 mb-2">' +
          '<span class="badge ' + typeBadge + '">' + type + '</span>' +
          '<span class="inline-block w-2 h-2 rounded-full flex-shrink-0 ' + accessDotClass + '" aria-hidden="true"></span>' +
          '<span class="italic">' + access + '</span>' +
        '</div>' +
        '<h3 class="text-xl md:text-2xl font-serif text-gray-900 leading-snug">' +
          '<a href="' + url + '" class="hover:text-teal-700 transition-colors">' + title + '</a>' +
        '</h3>' +
        (authors ? '<p class="mt-2 text-base text-gray-500 font-serif leading-relaxed">' + authors + '</p>' : '') +
        '<div class="mt-3 pt-3 border-t border-gray-200 flex flex-wrap items-center gap-3">' +
          '<div class="flex flex-wrap items-center gap-4 text-xs text-gray-400">' +
            '<span title="Views" data-metric="views">Views: ' + views + '</span>' +
            '<span title="Downloads" data-metric="downloads">Downloads: ' + downloads + '</span>' +
            (hideCitations ? '' : '<span title="' + citationLabel + '" data-metric="citations">' + citationLabel + ': ' + citations + '</span>') +
          '</div>' +
          (pdfUrl ? '<a href="' + pdfUrl + '" target="_blank" rel="noopener" aria-label="View PDF" title="View PDF" class="inline-flex items-center justify-center text-red-600 hover:text-red-700 transition-colors sm:ml-auto">' +
            '<svg class="w-4 h-5" viewBox="0 0 24 28" role="img" aria-label="View PDF" title="View PDF">' +
              '<title>View PDF</title>' +
              '<path d="M3.2 1.5h11.1l6.2 6.1v16.1a2.8 2.8 0 0 1-2.8 2.8H3.2a2.8 2.8 0 0 1-2.8-2.8V4.3a2.8 2.8 0 0 1 2.8-2.8z" fill="#ffffff" stroke="#ef2a2a" stroke-width="2"></path>' +
              '<path d="M14.3 1.5v5a2.2 2.2 0 0 0 2.2 2.2h4" fill="none" stroke="#ef2a2a" stroke-width="2"></path>' +
              '<path d="M4.3 11.2h12.8M4.3 13.8h12.8M4.3 16.4h9.8" fill="none" stroke="#95a0aa" stroke-width="1.1" stroke-linecap="round"></path>' +
              '<rect x="0.7" y="17.6" width="13.5" height="6.6" rx="1.2" fill="#ef2a2a"></rect>' +
              '<text x="7.45" y="22.3" text-anchor="middle" font-size="4.7" font-family="Arial,sans-serif" font-weight="700" fill="#ffffff">PDF</text>' +
            '</svg>' +
          '</a>' : '') +
        '</div>' +
      '</article>';
    }).join('');
  }

  function renderArticlesDiscovery(data) {
    var tabsRoot = document.getElementById('home-articles-tabs');
    var cardsRoot = document.getElementById('home-articles-grid');
    var panelRoot = document.getElementById('home-articles-panel');
    var mobileAccordionRoot = document.getElementById('home-articles-mobile-accordion');
    if (!tabsRoot || !cardsRoot || !panelRoot) return Promise.resolve();

    var tabs = Array.prototype.slice.call(tabsRoot.querySelectorAll('[data-articles-tab]'));
    if (!tabs.length) return Promise.resolve();
    var mobileCollectionMeta = {
      'latest-published': {
        label: 'Latest published',
        description: 'Latest published articles from the current issue.'
      },
      'articles-in-press': {
        label: 'Articles in press',
        description: 'Articles accepted and published online ahead of issue assignment.'
      },
      'top-cited': {
        label: 'Top cited',
        description: 'The most cited articles based on OpenAlex citation counts.'
      },
      'most-downloaded': {
        label: 'Most downloaded',
        description: 'The most downloaded articles in the last 90 days.'
      }
    };
    var activeKey = 'latest-published';
    var citationMap = {};
    var topCitedRankReady = false;
    var topCitedRankLoading = false;
    var mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 47.99rem)') : null;

    function isMobileAccordionMode() {
      return !!(mobileAccordionRoot && mobileQuery && mobileQuery.matches);
    }

    function renderDesktopCollections(collections) {
      var items = collections[activeKey] || [];
      cardsRoot.innerHTML = renderArticleCollectionCards(items, activeKey, citationMap);
      hydrateLiveArticleMetrics(cardsRoot, items);
      hydrateLiveCitationMetrics(cardsRoot, items, citationMap);
    }

    function renderMobileAccordion(collections) {
      if (!mobileAccordionRoot) return;

      var orderedKeys = tabs.map(function (tab) {
        return tab.getAttribute('data-articles-tab');
      }).filter(Boolean);

      mobileAccordionRoot.innerHTML = orderedKeys.map(function (key) {
        var meta = mobileCollectionMeta[key] || {};
        var label = escapeHtml(meta.label || key);
        var description = escapeHtml(meta.description || '');
        var isOpen = key === activeKey;
        var triggerId = 'home-articles-mobile-trigger-' + key;
        var panelId = 'home-articles-mobile-panel-' + key;
        var items = collections[key] || [];

        return '<section class="home-articles-accordion-item" data-mobile-articles-key="' + key + '">' +
          '<h3>' +
            '<button type="button" id="' + triggerId + '" class="home-articles-accordion-trigger" data-mobile-articles-trigger="' + key + '" aria-controls="' + panelId + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' + label + '</button>' +
          '</h3>' +
          '<div id="' + panelId + '" class="home-articles-accordion-panel' + (isOpen ? ' open' : '') + '" role="region" aria-labelledby="' + triggerId + '"' + (isOpen ? '' : ' hidden') + '>' +
            (description ? '<p class="home-articles-accordion-intro">' + description + '</p>' : '') +
            '<div class="home-articles-cards" data-mobile-cards-for="' + key + '">' + renderArticleCollectionCards(items, key, citationMap) + '</div>' +
          '</div>' +
        '</section>';
      }).join('');

      Array.prototype.slice.call(mobileAccordionRoot.querySelectorAll('[data-mobile-articles-trigger]')).forEach(function (trigger) {
        trigger.addEventListener('click', function () {
          applyTab(trigger.getAttribute('data-mobile-articles-trigger'), true);
        });
      });

      var openPanel = mobileAccordionRoot.querySelector('.home-articles-accordion-panel.open');
      if (openPanel) {
        var openItems = collections[activeKey] || [];
        var openCardsRoot = openPanel.querySelector('.home-articles-cards');
        if (openCardsRoot) {
          hydrateLiveArticleMetrics(openCardsRoot, openItems);
          hydrateLiveCitationMetrics(openCardsRoot, openItems, citationMap);
        }
      }
    }

    function applyTab(key, toggleMobile) {
      var tabExists = tabs.some(function (t) { return t.getAttribute('data-articles-tab') === key; });
      if (toggleMobile && isMobileAccordionMode()) {
        activeKey = (activeKey === key) ? '' : key;
      } else {
        activeKey = tabExists ? key : 'latest-published';
      }

      tabs.forEach(function (tab) {
        var isActive = tab.getAttribute('data-articles-tab') === activeKey;
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      var activeTab = tabsRoot.querySelector('[data-articles-tab="' + activeKey + '"]');
      if (activeTab) {
        panelRoot.setAttribute('aria-labelledby', activeTab.id || '');
      }

      var collections = getArticleCollections(data, citationMap);
      if (isMobileAccordionMode()) {
        renderMobileAccordion(collections);
      } else {
        renderDesktopCollections(collections);
      }

      if (activeKey === 'top-cited' && !topCitedRankReady && !topCitedRankLoading) {
        topCitedRankLoading = true;
        fetchTopJournalCitationMap()
          .then(function (map) {
            citationMap = Object.assign({}, citationMap, map || {});
            topCitedRankReady = true;
            if (activeKey === 'top-cited') {
              applyTab('top-cited');
            }
          })
          .catch(function () {
            topCitedRankReady = true;
          })
          .then(function () {
            topCitedRankLoading = false;
          });
      }
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        applyTab(tab.getAttribute('data-articles-tab'));
      });
    });

    if (mobileQuery) {
      var onViewportChange = function () {
        applyTab(activeKey);
      };
      if (typeof mobileQuery.addEventListener === 'function') {
        mobileQuery.addEventListener('change', onViewportChange);
      } else if (typeof mobileQuery.addListener === 'function') {
        mobileQuery.addListener(onViewportChange);
      }
    }

    return Promise.all([
      window.BMJLazyData && typeof window.BMJLazyData.loadArticles === 'function'
        ? window.BMJLazyData.loadArticles()
        : Promise.resolve(),
      ensureArticlesInPressData()
    ]).catch(function () {
      // Keep UI functional with whichever data is already available.
    }).then(function () {
      applyTab('latest-published');
    });
  }

  function renderImageCorner(data) {
    var section = document.getElementById('image-corner-section');
    var container = document.getElementById('image-corner');
    if (!section || !container) return;

    var images = getImageCornerArticles(data);
    if (!images.length) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    container.innerHTML = images.map(function (article) {
      var articleId = escapeHtml(String(article.id || ''));
      var title = escapeHtml(stripTags(article.title || 'Untitled'));
      var authors = escapeHtml(formatAuthors(article.authors));
      var imageSrc = toAbsoluteImageUrl(String(article.image || '').trim());
      var cropStyle = getImageCornerCropStyle(article);
      var imageHtml = imageSrc
        ? '<img src="' + escapeHtml(imageSrc) + '" alt="' + title + '" class="w-full h-full object-cover image-corner-cover-media" loading="lazy" data-image-corner-img="' + articleId + '"' + cropStyle + '>'
        : '<img alt="' + title + '" class="w-full h-full object-cover image-corner-cover-media hidden" loading="eager" data-image-corner-img="' + articleId + '"' + cropStyle + '>' +
          '<div class="text-center p-8" data-image-corner-fallback="' + articleId + '">' +
            '<svg class="w-16 h-16 mx-auto text-teal-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' +
            '<span class="text-sm text-teal-500">Image Corner</span>' +
          '</div>';

      var imageCornerBadgeClass = typeBadgeClass('Image Corner');

      return '<a href="article.html?id=' + encodeURIComponent(String(article.id || '')) + '" class="article-card group block bg-white rounded-xl border border-gray-200 overflow-hidden">' +
        '<div class="aspect-video bg-gray-900 flex items-center justify-center overflow-hidden">' + imageHtml + '</div>' +
        '<div class="p-6">' +
          '<span class="inline-block px-2 py-0.5 text-xs font-semibold rounded-full mb-2 ' + imageCornerBadgeClass + '">Image Corner</span>' +
          '<h3 class="text-lg font-semibold text-gray-900 group-hover:text-teal-700 transition-colors mb-2">' + title + '</h3>' +
          (authors ? '<p class="text-sm text-gray-500">' + authors + '</p>' : '') +
        '</div>' +
      '</a>';
    }).join('');

    hydrateImageCornerImages(images);
  }

  function renderNews() {
    var container = document.getElementById('latest-news');
    if (!container) return;
    if (!Array.isArray(window.NEWS) || window.NEWS.length === 0) {
      container.innerHTML =
        '<article class="bg-white rounded-xl border border-gray-200 p-6 md:col-span-2 lg:col-span-3">' +
          '<h3 class="text-lg font-semibold text-gray-900">News is temporarily unavailable.</h3>' +
          '<p class="text-sm text-gray-500 mt-2 font-serif">Please visit the News page for recent updates.</p>' +
        '</article>';
      return;
    }

    var latest = window.NEWS.slice().sort(function (a, b) {
      var da = new Date(a.date || '').getTime();
      var db = new Date(b.date || '').getTime();
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    }).slice(0, 3);

    container.innerHTML = latest.map(function (item) {
      var category = escapeHtml(stripTags(item.category || 'News'));
      var title = escapeHtml(stripTags(item.title || 'Untitled'));
      var excerpt = escapeHtml(stripTags(item.excerpt || ''));
      var dateLabel = formatDate(item.date);
      var badgeClass = newsBadgeClass(item.category);
      return '<article class="article-card bg-white rounded-xl border border-gray-200 p-6 flex flex-col">' +
        '<div class="flex items-center gap-2 mb-3">' +
          '<span class="badge ' + badgeClass + '">' + category + '</span>' +
          (dateLabel ? '<time class="text-xs text-gray-400" datetime="' + escapeHtml(String(item.date || '')) + '">' + escapeHtml(dateLabel) + '</time>' : '') +
        '</div>' +
        '<h3 class="text-lg font-semibold text-gray-900 mb-3 flex-1">' +
          '<a href="news-article.html?id=' + encodeURIComponent(String(item.id || '')) + '" class="hover:text-teal-700 transition-colors">' + title + '</a>' +
        '</h3>' +
        (excerpt ? '<p class="text-sm text-gray-500 leading-relaxed">' + excerpt + '</p>' : '') +
      '</article>';
    }).join('');
  }

  function getLatestNewsItem() {
    if (!Array.isArray(window.NEWS) || window.NEWS.length === 0) return null;
    var sorted = window.NEWS.slice().sort(function (a, b) {
      var da = new Date(a.date || '').getTime();
      var db = new Date(b.date || '').getTime();
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });
    return sorted[0] || null;
  }

  function populateHeroSlides(data) {
    var issue = data && data.currentIssue ? data.currentIssue : {};
    var volume = issue.volume ? 'Volume ' + issue.volume : '';
    var issueNo = issue.issue ? 'Issue ' + issue.issue : '';
    var year = issue.year ? String(issue.year) : '';
    var issueLabel = [volume, issueNo].filter(Boolean).join(', ');
    if (year) {
      issueLabel = issueLabel ? issueLabel + ' (' + year + ')' : year;
    }
    if (issueLabel) {
      var issueNodes = document.querySelectorAll('[data-hero-issue-label]');
      issueNodes.forEach(function (node) {
        node.textContent = issueLabel;
      });
    }

    var featured = getFeaturedArticles(data)[0];
    if (featured) {
      var featuredTitle = stripTags(featured.title || '');
      var featuredAuthors = formatAuthors(featured.authors);
      var featuredUrl = 'article.html?id=' + encodeURIComponent(String(featured.id || ''));

      var featuredTitleNode = document.querySelector('[data-hero-featured-title]');
      if (featuredTitleNode && featuredTitle) featuredTitleNode.textContent = featuredTitle;

      var featuredAuthorsNode = document.querySelector('[data-hero-featured-authors]');
      if (featuredAuthorsNode && featuredAuthors) featuredAuthorsNode.textContent = featuredAuthors;

      var featuredLinkNode = document.querySelector('[data-hero-featured-link]');
      if (featuredLinkNode) featuredLinkNode.setAttribute('href', featuredUrl);
    }

    var latestNews = getLatestNewsItem();
    if (latestNews) {
      var newsTitle = stripTags(latestNews.title || '');
      var newsExcerpt = stripTags(latestNews.excerpt || '');
      var newsUrl = 'news-article.html?id=' + encodeURIComponent(String(latestNews.id || ''));

      var newsTitleNode = document.querySelector('[data-hero-news-title]');
      if (newsTitleNode && newsTitle) newsTitleNode.textContent = newsTitle;

      var newsExcerptNode = document.querySelector('[data-hero-news-excerpt]');
      if (newsExcerptNode && newsExcerpt) newsExcerptNode.textContent = newsExcerpt;

      var newsLinkNode = document.querySelector('[data-hero-news-link]');
      if (newsLinkNode) newsLinkNode.setAttribute('href', newsUrl);
    }
  }

  function initHeroCarousel(data) {
    var root = document.getElementById('home-hero-carousel');
    if (!root) return;

    populateHeroSlides(data);

    var slides = Array.prototype.slice.call(root.querySelectorAll('.hero-slide'));
    if (!slides.length) return;

    var prevBtn = root.querySelector('[data-hero-prev]');
    var nextBtn = root.querySelector('[data-hero-next]');
    var indicators = Array.prototype.slice.call(root.querySelectorAll('[data-hero-indicator]'));
    var status = root.querySelector('#hero-carousel-status');

    var intervalMs = parseInt(root.getAttribute('data-interval'), 10);
    if (!(intervalMs >= 2000 && intervalMs <= 30000)) intervalMs = 6000;

    var autoplayEnabled = root.getAttribute('data-autoplay') !== 'false';
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      autoplayEnabled = false;
    }

    var activeIndex = slides.findIndex(function (slide) {
      return slide.classList.contains('is-active');
    });
    if (activeIndex < 0) activeIndex = 0;

    var timer = null;
    var hoverPaused = false;
    var focusPaused = false;

    function getSlideHeading(slide) {
      if (!slide) return '';
      var heading = slide.querySelector('h1, h2, h3');
      return heading ? stripTags(heading.textContent || '') : '';
    }

    function shouldPauseAutoplay() {
      return hoverPaused || focusPaused || document.hidden;
    }

    function stopAutoplay() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    function startAutoplay() {
      if (!autoplayEnabled || slides.length < 2 || shouldPauseAutoplay()) return;
      stopAutoplay();
      timer = window.setInterval(function () {
        goToSlide(activeIndex + 1, false);
      }, intervalMs);
    }

    function syncAriaLive() {
      root.setAttribute('aria-live', autoplayEnabled ? 'off' : 'polite');
    }

    function updateCarousel() {
      slides.forEach(function (slide, index) {
        var isActive = index === activeIndex;
        slide.classList.toggle('is-active', isActive);
        if (isActive) {
          slide.removeAttribute('aria-hidden');
        } else {
          slide.setAttribute('aria-hidden', 'true');
        }
      });

      indicators.forEach(function (button, index) {
        var isActive = index === activeIndex;
        button.classList.toggle('is-active', isActive);
        if (isActive) {
          button.setAttribute('aria-current', 'true');
        } else {
          button.removeAttribute('aria-current');
        }
      });

      if (status) {
        var title = getSlideHeading(slides[activeIndex]);
        status.textContent = 'Slide ' + (activeIndex + 1) + ' of ' + slides.length + (title ? ': ' + title : '');
      }

      syncAriaLive();
    }

    function goToSlide(index, userInitiated) {
      var nextIndex = index;
      if (nextIndex < 0) nextIndex = slides.length - 1;
      if (nextIndex >= slides.length) nextIndex = 0;
      activeIndex = nextIndex;
      updateCarousel();
      if (userInitiated) {
        startAutoplay();
      }
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        goToSlide(activeIndex - 1, true);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        goToSlide(activeIndex + 1, true);
      });
    }

    indicators.forEach(function (button, index) {
      button.addEventListener('click', function () {
        goToSlide(index, true);
      });
    });

    root.addEventListener('mouseenter', function () {
      hoverPaused = true;
      stopAutoplay();
    });

    root.addEventListener('mouseleave', function () {
      hoverPaused = false;
      startAutoplay();
    });

    root.addEventListener('focusin', function () {
      focusPaused = true;
      stopAutoplay();
    });

    root.addEventListener('focusout', function (event) {
      if (!root.contains(event.relatedTarget)) {
        focusPaused = false;
        startAutoplay();
      }
    });

    root.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToSlide(activeIndex - 1, true);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToSlide(activeIndex + 1, true);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goToSlide(0, true);
      } else if (event.key === 'End') {
        event.preventDefault();
        goToSlide(slides.length - 1, true);
      } else if ((event.key === ' ' || event.key === 'Spacebar') && event.target === root) {
        event.preventDefault();
        autoplayEnabled = !autoplayEnabled;
        root.setAttribute('data-autoplay', autoplayEnabled ? 'true' : 'false');
        if (autoplayEnabled) {
          startAutoplay();
        } else {
          stopAutoplay();
          syncAriaLive();
        }
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopAutoplay();
      } else {
        startAutoplay();
      }
    });

    updateCarousel();
    startAutoplay();
  }

  function renderMetricsProvenance(data) {
    var el = document.getElementById('journal-metrics-provenance');
    if (!el) return;
    var refreshDate = formatDate(data.generatedAt || '');
    if (!refreshDate) return;
    el.textContent = 'Metrics shown for quick reference. Last homepage data refresh: ' + refreshDate + '. Detailed sources are available in Journal Metrics.';
  }

  function init() {
    var data = window.HOMEPAGE_DATA || {};
    initHeroCarousel(data);
    setupLazyArticleLoader();
    renderArticlesDiscovery(data);
    renderImageCorner(data);
    renderNews();
    renderMetricsProvenance(data);
  }

  init();
})();
