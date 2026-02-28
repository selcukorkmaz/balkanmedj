/**
 * Balkan Medical Journal — Article Search & Filter
 * Type filter pills + text search + advanced faceted search
 */
(function () {
  'use strict';

  var container = document.getElementById('articles-container');
  var searchInput = document.getElementById('article-search');
  var filterContainer = document.getElementById('type-filters');
  var countDisplay = document.getElementById('article-count');
  var issuePageTitle = document.getElementById('issue-page-title');
  var issuePageSubtitle = document.getElementById('issue-page-subtitle');
  var fallbackNotice = document.getElementById('archive-fallback-notice');
  var fallbackCopy = document.getElementById('archive-fallback-copy');
  var fallbackLink = document.getElementById('archive-fallback-link');
  var breadcrumbSection = document.getElementById('issue-breadcrumb-section');
  var breadcrumbSectionLink = document.getElementById('issue-breadcrumb-section-link');
  var breadcrumbDetailSep = document.getElementById('issue-breadcrumb-detail-sep');
  var breadcrumbDetail = document.getElementById('issue-breadcrumb-detail');
  var articleSource = Array.isArray(window.PAGE_ARTICLES) ? window.PAGE_ARTICLES : window.ARTICLES;
  if (!container || !Array.isArray(articleSource)) return;

  var query = new URLSearchParams(window.location.search);
  var queryVolume = query.get('volume');
  var queryIssue = query.get('issue');
  var queryYear = query.get('year');
  var queryLabel = query.get('label');
  var querySourceId = query.get('sourceId');
  var isArchiveContext = Boolean(queryLabel || queryYear || querySourceId);
  var issueContext = String(container.getAttribute('data-issue-context') || '').toLowerCase();

  function getArticleTypeBadgeClass(articleType) {
    if (window.BMJArticleTypes && typeof window.BMJArticleTypes.getBadgeClass === 'function') {
      return window.BMJArticleTypes.getBadgeClass(articleType);
    }
    return 'bg-teal-100 text-teal-700';
  }

  function isCoverPageArticle(article) {
    return String((article && article.type) || '').trim().toLowerCase() === 'cover page';
  }

  // Filter by volume/issue if specified on container
  var filterVolume = container.getAttribute('data-volume');
  var filterIssue = container.getAttribute('data-issue');
  if (queryVolume && queryIssue) {
    filterVolume = queryVolume;
    filterIssue = queryIssue;
  }

  if (isArchiveContext) {
    if (issuePageTitle) issuePageTitle.textContent = 'Archive Issue';
    if (issuePageSubtitle) {
      issuePageSubtitle.textContent = (queryLabel || 'Archive Issue') + (queryYear ? (' — ' + queryYear) : '');
    }
  }

  // Breadcrumb context: Home > Current Issue (default) OR Home > Archive > [Issue]
  if (isArchiveContext) {
    if (breadcrumbSectionLink) {
      breadcrumbSectionLink.textContent = 'Archive';
      breadcrumbSectionLink.href = 'archive.html';
    }
    if (breadcrumbSection) {
      breadcrumbSection.removeAttribute('aria-current');
      breadcrumbSection.classList.remove('text-gray-900', 'font-medium');
    }
    if (breadcrumbDetail) {
      breadcrumbDetail.textContent = (queryLabel || 'Archive Issue') + (queryYear ? (' — ' + queryYear) : '');
      breadcrumbDetail.classList.remove('hidden');
      breadcrumbDetail.setAttribute('aria-current', 'page');
    }
    if (breadcrumbDetailSep) breadcrumbDetailSep.classList.remove('hidden');
  } else {
    if (breadcrumbSectionLink) {
      breadcrumbSectionLink.textContent = 'Current Issue';
      breadcrumbSectionLink.href = 'current-issue.html';
    }
    if (breadcrumbSection) {
      breadcrumbSection.setAttribute('aria-current', 'page');
      breadcrumbSection.classList.add('text-gray-900', 'font-medium');
    }
    if (breadcrumbDetail) {
      breadcrumbDetail.classList.add('hidden');
      breadcrumbDetail.removeAttribute('aria-current');
      breadcrumbDetail.textContent = '';
    }
    if (breadcrumbDetailSep) breadcrumbDetailSep.classList.add('hidden');
  }

  var articles = articleSource;
  if (filterVolume && filterIssue) {
    articles = articles.filter(function (a) {
      return String(a.volume) === String(filterVolume) && String(a.issue) === String(filterIssue);
    });
  }
  var activeType = 'All';

  // Advanced filter state
  var filters = {
    authorSearch: '',
    selectedKeywords: [],
    yearFrom: '',
    yearTo: ''
  };

  // Get unique article types
  var types = ['All'];
  articles.forEach(function (a) {
    if (a.type === 'Cover Page') return;
    if (types.indexOf(a.type) === -1) types.push(a.type);
  });

  // Get all unique keywords
  var allKeywords = [];
  articles.forEach(function (a) {
    (a.keywords || []).forEach(function (k) {
      if (allKeywords.indexOf(k) === -1) allKeywords.push(k);
    });
  });
  allKeywords.sort();

  // Get all unique author names
  var allAuthors = [];
  articles.forEach(function (a) {
    (a.authors || []).forEach(function (au) {
      if (allAuthors.indexOf(au.name) === -1) allAuthors.push(au.name);
    });
  });
  allAuthors.sort();

  // Get year range
  var years = articles.map(function (a) {
    return a.published ? new Date(a.published).getFullYear() : null;
  }).filter(Boolean);
  var currentYear = new Date().getFullYear();
  var minYear = years.length ? Math.min.apply(null, years) : currentYear;
  var maxYear = years.length ? Math.max.apply(null, years) : currentYear;
  var introPreviewTypes = {
    'invited review': true,
    'original article': true,
    'brief report': true
  };
  var introPreviewCache = {};
  var introPreviewPending = {};

  // Render filter pills
  function renderFilters() {
    if (!filterContainer) return;
    filterContainer.innerHTML = '';
    types.forEach(function (type) {
      var btn = document.createElement('button');
      btn.textContent = type;
      btn.className = type === activeType
        ? 'px-4 py-2 rounded-full text-sm font-semibold bg-teal-700 text-white transition-colors'
        : 'px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors';
      btn.setAttribute('aria-pressed', String(type === activeType));
      btn.addEventListener('click', function () {
        activeType = type;
        renderFilters();
        renderArticles();
      });
      filterContainer.appendChild(btn);
    });
  }

  // Build advanced filters panel
  function buildAdvancedFilters() {
    var panel = document.getElementById('advanced-filters');
    if (!panel) return;

    panel.innerHTML =
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">' +
        // Author search
        '<div>' +
          '<label for="author-filter" class="block text-sm font-medium text-gray-700 mb-1">Author</label>' +
          '<div class="relative">' +
            '<input type="text" id="author-filter" placeholder="Search by author..." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500" autocomplete="off">' +
            '<div id="author-suggestions" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto"></div>' +
          '</div>' +
        '</div>' +
        // Year from
        '<div>' +
          '<label for="year-from" class="block text-sm font-medium text-gray-700 mb-1">Year From</label>' +
          '<select id="year-from" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500">' +
            '<option value="">Any</option>' +
            buildYearOptions() +
          '</select>' +
        '</div>' +
        // Year to
        '<div>' +
          '<label for="year-to" class="block text-sm font-medium text-gray-700 mb-1">Year To</label>' +
          '<select id="year-to" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500">' +
            '<option value="">Any</option>' +
            buildYearOptions() +
          '</select>' +
        '</div>' +
        // Keywords
        '<div>' +
          '<label for="keyword-filter" class="block text-sm font-medium text-gray-700 mb-1">Keywords</label>' +
          '<select id="keyword-filter" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500">' +
            '<option value="">Add keyword...</option>' +
            allKeywords.map(function (k) { return '<option value="' + escapeHtml(k) + '">' + escapeHtml(k) + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +
      // Active filter chips
      '<div id="active-chips" class="flex flex-wrap gap-2 mt-3"></div>';

    // Bind events
    var authorInput = document.getElementById('author-filter');
    var suggestionsEl = document.getElementById('author-suggestions');
    var yearFromEl = document.getElementById('year-from');
    var yearToEl = document.getElementById('year-to');
    var keywordSelect = document.getElementById('keyword-filter');

    // Author autocomplete
    if (authorInput) {
      var authorDebounce;
      authorInput.addEventListener('input', function () {
        clearTimeout(authorDebounce);
        authorDebounce = setTimeout(function () {
          var val = authorInput.value.trim().toLowerCase();
          filters.authorSearch = val;
          if (val.length < 2) {
            suggestionsEl.classList.add('hidden');
            renderArticles();
            renderChips();
            return;
          }
          var matches = allAuthors.filter(function (name) {
            return name.toLowerCase().indexOf(val) !== -1;
          }).slice(0, 8);
          if (matches.length > 0) {
            suggestionsEl.innerHTML = matches.map(function (name) {
              return '<button type="button" class="w-full text-left px-3 py-2 text-sm hover:bg-teal-50 hover:text-teal-700 transition-colors">' + escapeHtml(name) + '</button>';
            }).join('');
            suggestionsEl.classList.remove('hidden');
            // Click handlers for suggestions
            var btns = suggestionsEl.querySelectorAll('button');
            btns.forEach(function (btn) {
              btn.addEventListener('click', function () {
                authorInput.value = btn.textContent;
                filters.authorSearch = btn.textContent.toLowerCase();
                suggestionsEl.classList.add('hidden');
                renderArticles();
                renderChips();
              });
            });
          } else {
            suggestionsEl.classList.add('hidden');
          }
          renderArticles();
          renderChips();
        }, 200);
      });
      // Hide suggestions on blur (with delay for click)
      authorInput.addEventListener('blur', function () {
        setTimeout(function () { suggestionsEl.classList.add('hidden'); }, 200);
      });
    }

    // Year filters
    if (yearFromEl) {
      yearFromEl.addEventListener('change', function () {
        filters.yearFrom = yearFromEl.value;
        renderArticles();
        renderChips();
      });
    }
    if (yearToEl) {
      yearToEl.addEventListener('change', function () {
        filters.yearTo = yearToEl.value;
        renderArticles();
        renderChips();
      });
    }

    // Keyword filter
    if (keywordSelect) {
      keywordSelect.addEventListener('change', function () {
        var val = keywordSelect.value;
        if (val && filters.selectedKeywords.indexOf(val) === -1) {
          filters.selectedKeywords.push(val);
          renderArticles();
          renderChips();
        }
        keywordSelect.value = '';
      });
    }
  }

  function buildYearOptions() {
    var opts = '';
    for (var y = maxYear; y >= minYear; y--) {
      opts += '<option value="' + y + '">' + y + '</option>';
    }
    return opts;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildAuthorNameHtml(author) {
    if (!author || !author.name) return '';
    var safeName = escapeHtml(author.name);
    var orcid = String(author.orcid || '').trim();
    if (!orcid) return safeName;
    return safeName + ' <a href="https://orcid.org/' + encodeURIComponent(orcid) + '" target="_blank" rel="noopener" title="ORCID: ' + escapeHtml(orcid) + '" class="inline-flex align-middle"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" class="inline-block"><path fill="#A6CE39" d="M256,128c0,70.7-57.3,128-128,128C57.3,256,0,198.7,0,128C0,57.3,57.3,0,128,0C198.7,0,256,57.3,256,128z"/><path fill="#fff" d="M86.3,186.2H70.9V79.1h15.4v48.4V186.2z"/><path fill="#fff" d="M108.9,79.1h41.6c39.6,0,57,28.3,57,53.6c0,27.5-21.5,53.6-56.8,53.6h-41.8V79.1z M124.3,172.4h24.5c34.9,0,42.9-26.5,42.9-39.7c0-21.5-13.7-39.7-43.7-39.7h-23.7V172.4z"/><path fill="#fff" d="M88.7,56.8c0,5.5-4.5,10.1-10.1,10.1c-5.6,0-10.1-4.6-10.1-10.1c0-5.6,4.5-10.1,10.1-10.1C84.2,46.7,88.7,51.3,88.7,56.8z"/></svg></a>';
  }

  function formatAuthorsHtml(authors) {
    var list = (authors || []).filter(function (author) {
      return !!(author && String(author.name || '').trim());
    });
    if (!list.length) return '';
    if (list.length <= 2) {
      return list.map(buildAuthorNameHtml).join(', ');
    }
    return buildAuthorNameHtml(list[0]) + ' et al.';
  }

  function buildOfficialIssueUrl(sourceId) {
    return 'https://balkanmedicaljournal.org/content.php?id=' + encodeURIComponent(sourceId);
  }

  function buildArticleUrl(article) {
    if (issueContext === 'aip') {
      if (article.localArticleUrl) return article.localArticleUrl;
      return 'article.html?id=' + encodeURIComponent(String(article.id)) + '&source=aip';
    }

    if (article.localArticleAvailable === false && article.sourceAbstractUrl) {
      return article.sourceAbstractUrl;
    }
    if (article.localArticleUrl) {
      return article.localArticleUrl;
    }

    var params = new URLSearchParams();
    params.set('id', String(article.id));

    if (isArchiveContext) {
      params.set('source', 'archive');
      if (queryYear) params.set('year', queryYear);
      if (queryLabel) params.set('label', queryLabel);
      if (querySourceId) params.set('sourceId', querySourceId);
      if (filterVolume && filterIssue) {
        params.set('volume', String(filterVolume));
        params.set('issue', String(filterIssue));
      }
    }

    return 'article.html?' + params.toString();
  }

  function isExternalUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  function normalizeSpace(str) {
    return String(str || '').replace(/\s+/g, ' ').trim();
  }

  function shortenPreview(value) {
    var text = normalizeSpace(value);
    if (!text) return '';
    return text.length > 200 ? text.substring(0, 200) + '...' : text;
  }

  function pickIntroSentences(text) {
    var clean = normalizeSpace(text);
    if (!clean) return '';
    var sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
    var out = '';
    for (var i = 0; i < sentences.length; i++) {
      var part = normalizeSpace(sentences[i]);
      if (!part) continue;
      var next = out ? (out + ' ' + part) : part;
      if (next.length > 320 && out) break;
      out = next;
      if (out.length >= 180) break;
    }
    return normalizeSpace(out || clean);
  }

  function extractIntroductionPreview(fullTextHtml) {
    if (!fullTextHtml) return '';
    var root = document.createElement('div');
    root.innerHTML = String(fullTextHtml);

    function normalizedHeadingLabel(el) {
      return normalizeSpace(el && el.textContent || '').toLowerCase().replace(/[:\-]+$/, '');
    }

    // Imported source markup includes explicit introduction anchors.
    var introAnchor = root.querySelector('a[name="introduction"], a[id="introduction"], a[name="Introduction"], a[id="Introduction"]');
    if (introAnchor) {
      var anchorChunks = [];
      var cursorFromAnchor = introAnchor.nextElementSibling;
      var introStartedFromAnchor = false;
      while (cursorFromAnchor) {
        if (/^H[1-6]$/.test(cursorFromAnchor.tagName)) {
          var anchorHeading = normalizedHeadingLabel(cursorFromAnchor);
          if (!introStartedFromAnchor && (anchorHeading === 'introduction' || anchorHeading.indexOf('introduction ') === 0)) {
            introStartedFromAnchor = true;
            cursorFromAnchor = cursorFromAnchor.nextElementSibling;
            continue;
          }
          if (introStartedFromAnchor) break;
          break;
        }
        var anchorChunk = normalizeSpace(cursorFromAnchor.textContent || '');
        if (anchorChunk) {
          anchorChunks.push(anchorChunk);
          introStartedFromAnchor = true;
        }
        if (normalizeSpace(anchorChunks.join(' ')).length > 420) break;
        cursorFromAnchor = cursorFromAnchor.nextElementSibling;
      }
      var introFromAnchor = pickIntroSentences(anchorChunks.join(' '));
      if (introFromAnchor) return introFromAnchor;
    }

    // Fallback for normalized HTML markup.
    var introHeading = null;
    var headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (var i = 0; i < headings.length; i++) {
      var label = normalizedHeadingLabel(headings[i]);
      if (label === 'introduction' || label.indexOf('introduction ') === 0) {
        introHeading = headings[i];
        break;
      }
    }

    if (introHeading) {
      var chunks = [];
      var cursor = introHeading.nextElementSibling;
      while (cursor) {
        if (/^H[1-6]$/.test(cursor.tagName)) break;
        var chunk = normalizeSpace(cursor.textContent || '');
        if (chunk) chunks.push(chunk);
        if (normalizeSpace(chunks.join(' ')).length > 420) break;
        cursor = cursor.nextElementSibling;
      }
      var introText = pickIntroSentences(chunks.join(' '));
      if (introText) return introText;
    }

    return '';
  }

  function shouldUseIntroductionPreview(article) {
    return issueContext !== 'aip' &&
      !!introPreviewTypes[String(article.type || '').toLowerCase()] &&
      window.DataLoader &&
      typeof window.DataLoader.loadFullText === 'function';
  }

  function applyIntroPreview(card, articleId, text) {
    var target = card.querySelector('[data-intro-preview-id="' + String(articleId) + '"]');
    if (!target) return;
    var previewText = shortenPreview(text);
    if (!previewText) {
      target.remove();
      return;
    }
    target.textContent = previewText;
    target.classList.remove('hidden');
  }

  function hydrateIntroPreview(card, article) {
    var aid = Number(article.id);
    if (Object.prototype.hasOwnProperty.call(introPreviewCache, aid)) {
      applyIntroPreview(card, aid, introPreviewCache[aid]);
      return;
    }

    if (!introPreviewPending[aid]) {
      introPreviewPending[aid] = window.DataLoader.loadFullText(aid)
        .then(function (html) {
          var intro = extractIntroductionPreview(html);
          introPreviewCache[aid] = intro;
          delete introPreviewPending[aid];
          return intro;
        })
        .catch(function () {
          introPreviewCache[aid] = '';
          delete introPreviewPending[aid];
          return '';
        });
    }

    introPreviewPending[aid].then(function (introText) {
      applyIntroPreview(card, aid, introText);
    });
  }

  function renderChips() {
    var chipsEl = document.getElementById('active-chips');
    if (!chipsEl) return;
    var chips = [];

    if (filters.authorSearch) {
      chips.push(makeChip('Author: ' + filters.authorSearch, function () {
        filters.authorSearch = '';
        var el = document.getElementById('author-filter');
        if (el) el.value = '';
        renderArticles();
        renderChips();
      }));
    }
    if (filters.yearFrom) {
      chips.push(makeChip('From: ' + filters.yearFrom, function () {
        filters.yearFrom = '';
        var el = document.getElementById('year-from');
        if (el) el.value = '';
        renderArticles();
        renderChips();
      }));
    }
    if (filters.yearTo) {
      chips.push(makeChip('To: ' + filters.yearTo, function () {
        filters.yearTo = '';
        var el = document.getElementById('year-to');
        if (el) el.value = '';
        renderArticles();
        renderChips();
      }));
    }
    filters.selectedKeywords.forEach(function (kw) {
      chips.push(makeChip(kw, function () {
        filters.selectedKeywords = filters.selectedKeywords.filter(function (k) { return k !== kw; });
        renderArticles();
        renderChips();
      }));
    });

    chipsEl.innerHTML = '';
    if (chips.length > 0) {
      chips.forEach(function (chip) { chipsEl.appendChild(chip); });
      // Add clear all button
      var clearAll = document.createElement('button');
      clearAll.className = 'px-3 py-1 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-full transition-colors';
      clearAll.textContent = 'Clear all';
      clearAll.addEventListener('click', function () {
        filters.authorSearch = '';
        filters.selectedKeywords = [];
        filters.yearFrom = '';
        filters.yearTo = '';
        var af = document.getElementById('author-filter');
        var yf = document.getElementById('year-from');
        var yt = document.getElementById('year-to');
        if (af) af.value = '';
        if (yf) yf.value = '';
        if (yt) yt.value = '';
        renderArticles();
        renderChips();
      });
      chipsEl.appendChild(clearAll);
    }
  }

  function makeChip(label, onRemove) {
    var chip = document.createElement('span');
    chip.className = 'inline-flex items-center gap-1 px-3 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full';
    chip.innerHTML = escapeHtml(label) +
      '<button type="button" class="ml-1 text-teal-500 hover:text-teal-800" aria-label="Remove filter">' +
        '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
      '</button>';
    chip.querySelector('button').addEventListener('click', onRemove);
    return chip;
  }

  // Filter articles based on all criteria
  function getFilteredArticles() {
    var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    return articles.filter(function (a) {
      // Type filter
      var matchesType = activeType === 'All' || a.type === activeType;
      if (!matchesType) return false;

      // Text search
      if (searchTerm) {
        var searchable = (a.title + ' ' + (a.authors || []).map(function (au) { return au.name; }).join(' ') + ' ' + (a.keywords || []).join(' ')).toLowerCase();
        if (searchable.indexOf(searchTerm) === -1) return false;
      }

      // Author filter
      if (filters.authorSearch) {
        var authorNames = (a.authors || []).map(function (au) { return au.name.toLowerCase(); }).join(' ');
        if (authorNames.indexOf(filters.authorSearch) === -1) return false;
      }

      // Year range
      if (filters.yearFrom || filters.yearTo) {
        var articleYear = a.published ? new Date(a.published).getFullYear() : null;
        if (!articleYear) return false;
        if (filters.yearFrom && articleYear < parseInt(filters.yearFrom)) return false;
        if (filters.yearTo && articleYear > parseInt(filters.yearTo)) return false;
      }

      // Keywords
      if (filters.selectedKeywords.length > 0) {
        var articleKeywords = (a.keywords || []).map(function (k) { return k.toLowerCase(); });
        var allMatch = filters.selectedKeywords.every(function (kw) {
          return articleKeywords.indexOf(kw.toLowerCase()) !== -1;
        });
        if (!allMatch) return false;
      }

      return true;
    });
  }

  // Render article cards
  function renderArticles() {
    var filtered = getFilteredArticles();
    var missingLocalIssue = Boolean(querySourceId && articles.length === 0);
    container.innerHTML = '';
    if (fallbackNotice) fallbackNotice.classList.add('hidden');

    if (countDisplay) {
      var articleOnlyCount = filtered.filter(function (a) { return !isCoverPageArticle(a); }).length;
      countDisplay.textContent = articleOnlyCount + ' article' + (articleOnlyCount !== 1 ? 's' : '');
    }

    if (filtered.length === 0) {
      var emptyMessage = 'No articles found matching your criteria.';
      if (missingLocalIssue) {
        emptyMessage = 'No local articles were found for this archive issue.';
        if (fallbackCopy) {
          fallbackCopy.textContent = 'The selected issue is available on balkanmedicaljournal.org.';
        }
        if (fallbackLink) {
          fallbackLink.href = buildOfficialIssueUrl(querySourceId);
        }
        if (fallbackNotice) {
          fallbackNotice.classList.remove('hidden');
        }
      }
      container.innerHTML = '<div class="col-span-full text-center py-12"><p class="text-gray-400 text-lg">' + escapeHtml(emptyMessage) + '</p></div>';
      return;
    }

    // Group by type if showing all
    if (activeType === 'All') {
      var grouped = {};
      filtered.forEach(function (a) {
        if (!grouped[a.type]) grouped[a.type] = [];
        grouped[a.type].push(a);
      });

      // Order: Cover Page first, then main article types
      var typeOrder = ['Cover Page', 'Editorial', 'Invited Review', 'Original Article', 'Systematic Review', 'Scientific Letter', 'Clinical Image', 'Letter to the Editor'];
      // Section header plurals
      var typePlurals = {
        'Cover Page': 'Cover Pages',
        'Editorial': 'Editorials',
        'Invited Review': 'Invited Reviews',
        'Original Article': 'Original Articles',
        'Systematic Review': 'Systematic Reviews',
        'Scientific Letter': 'Scientific Letters',
        'Clinical Image': 'Clinical Images',
        'Letter to the Editor': 'Letters to the Editor'
      };
      typeOrder.forEach(function (type) {
        if (!grouped[type]) return;
        var section = document.createElement('div');
        section.className = 'col-span-full';
        section.innerHTML = '<h3 class="text-xl font-bold text-gray-900 mt-8 mb-4 pb-2 border-b border-gray-200">' + (typePlurals[type] || type + 's') + '</h3>';
        container.appendChild(section);

        grouped[type].forEach(function (article) {
          container.appendChild(createArticleCard(article));
        });
      });

      Object.keys(grouped).forEach(function (type) {
        if (typeOrder.indexOf(type) !== -1) return;
        var section = document.createElement('div');
        section.className = 'col-span-full';
        section.innerHTML = '<h3 class="text-xl font-bold text-gray-900 mt-8 mb-4 pb-2 border-b border-gray-200">' + (typePlurals[type] || type + 's') + '</h3>';
        container.appendChild(section);

        grouped[type].forEach(function (article) {
          container.appendChild(createArticleCard(article));
        });
      });
    } else {
      filtered.forEach(function (article) {
        container.appendChild(createArticleCard(article));
      });
    }
  }

  function createArticleCard(article) {
    var typeColor = getArticleTypeBadgeClass(article.type);

    var card = document.createElement('article');
    card.className = 'article-card bg-white rounded-xl border border-gray-200 p-6';
    var articleUrl = buildArticleUrl(article);
    var externalAttrs = isExternalUrl(articleUrl) ? ' target="_blank" rel="noopener"' : '';
    var introPreviewEnabled = shouldUseIntroductionPreview(article);
    var previewHtml = '';
    if (introPreviewEnabled) {
      previewHtml = '<p class="text-sm text-gray-400 mb-4 line-clamp-2 hidden" data-intro-preview-id="' + article.id + '"></p>';
    } else {
      var preview = article.abstract || article.previewText || '';
      if (preview && preview !== 'No abstract available.') {
        previewHtml = '<p class="text-sm text-gray-400 mb-4 line-clamp-2">' + escapeHtml(shortenPreview(preview)) + '</p>';
      }
    }
    card.innerHTML =
      '<div class="flex items-center gap-2 mb-3">' +
        '<span class="badge ' + typeColor + '">' + article.type + '</span>' +
        (article.aheadOfPrint ? '<span class="badge bg-orange-100 text-orange-700">Ahead of Print</span>' : '') +
        '<span class="text-xs text-gray-400">' + article.pages + '</span>' +
      '</div>' +
      '<h3 class="text-lg font-semibold text-gray-900 mb-2 leading-snug">' +
        '<a href="' + articleUrl + '"' + externalAttrs + ' class="hover:text-teal-700 transition-colors">' + article.title + '</a>' +
      '</h3>' +
      '<p class="text-sm text-gray-500 mb-3">' + formatAuthorsHtml(article.authors) + '</p>' +
      previewHtml +
      '<div class="flex items-center justify-between text-xs text-gray-400 pt-4 border-t border-gray-100">' +
        '<div class="flex gap-4">' +
          '<span title="Views"><svg class="inline w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>' + (article.views || 0).toLocaleString() + '</span>' +
          '<span title="Downloads"><svg class="inline w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>' + (article.downloads || 0).toLocaleString() + '</span>' +
        '</div>' +
        '<a href="' + articleUrl + '"' + externalAttrs + ' class="text-teal-700 font-medium hover:text-teal-800">Read more &rarr;</a>' +
      '</div>';

    if (introPreviewEnabled) {
      hydrateIntroPreview(card, article);
    }

    return card;
  }

  // Event listeners
  if (searchInput) {
    var debounceTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        renderArticles();
        renderChips();
      }, 300);
    });
  }

  // Initialize
  renderFilters();
  buildAdvancedFilters();
  renderArticles();
})();
