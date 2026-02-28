/**
 * Balkan Medical Journal — Full Search Results Page
 */
(function () {
  'use strict';

  var form = document.getElementById('search-page-form');
  var input = document.getElementById('search-page-input');
  var searchSubmitBtn = form ? form.querySelector('button[type="submit"]') : null;
  var queryLabel = document.getElementById('search-page-query');
  var summaryContainer = document.getElementById('search-page-summary');
  var resultsContainer = document.getElementById('search-page-results');

  var advancedToggle = document.getElementById('advanced-search-toggle');
  var advancedPanel = document.getElementById('advanced-search-panel');
  var advancedApplyBtn = document.getElementById('advanced-search-apply');
  var advancedClearBtn = document.getElementById('advanced-search-clear');

  var typeArticle = document.getElementById('adv-type-article');
  var typeNews = document.getElementById('adv-type-news');
  var typePage = document.getElementById('adv-type-page');

  var articleTypeInput = document.getElementById('adv-article-type');
  var titleInput = document.getElementById('adv-title');
  var authorInput = document.getElementById('adv-author');
  var keywordInput = document.getElementById('adv-keyword');
  var doiInput = document.getElementById('adv-doi');
  var yearFromInput = document.getElementById('adv-year-from');
  var yearToInput = document.getElementById('adv-year-to');
  var volumeInput = document.getElementById('adv-volume');
  var issueInput = document.getElementById('adv-issue');
  var sortInput = document.getElementById('adv-sort');

  if (!form || !input || !queryLabel || !summaryContainer || !resultsContainer) return;

  var searchApi = window.BMJSearch;
  if (!searchApi || typeof searchApi.searchAll !== 'function') {
    resultsContainer.innerHTML =
      '<div class="bg-white rounded-xl border border-red-500 p-6">' +
      '<p class="text-red-700 font-semibold">Search service is unavailable.</p>' +
      '<p class="text-sm text-gray-600 mt-2">Please refresh the page or contact the editorial office.</p>' +
      '</div>';
    return;
  }

  function normalize(str) {
    return (str || '').toString().trim().toLowerCase();
  }

  function getArticleTypeBadgeClass(articleType) {
    if (window.BMJArticleTypes && typeof window.BMJArticleTypes.getBadgeClass === 'function') {
      return window.BMJArticleTypes.getBadgeClass(articleType);
    }
    return 'bg-teal-100 text-teal-700';
  }

  function syncAdvancedColumnWidth() {
    if (!searchSubmitBtn || !document.body) return;
    if (!window.matchMedia('(min-width: 640px)').matches) {
      document.body.style.removeProperty('--search-side-col-width');
      return;
    }
    var width = searchSubmitBtn.getBoundingClientRect().width;
    if (width > 0) {
      document.body.style.setProperty('--search-side-col-width', width + 'px');
    }
  }

  function normalizeArticleTypeFilter(value) {
    var normalized = normalize(value);
    if (normalized === 'image corner') return 'clinical image';
    return normalized;
  }

  function escape(str) {
    return searchApi.escapeHtml(str == null ? '' : String(str));
  }

  function defaultFilters() {
    return {
      includeArticle: true,
      includeNews: true,
      includePage: true,
      articleType: '',
      title: '',
      author: '',
      keyword: '',
      doi: '',
      yearFrom: '',
      yearTo: '',
      volume: '',
      issue: '',
      sort: 'relevance'
    };
  }

  function parseFiltersFromUrl(params) {
    var filters = defaultFilters();

    var types = normalize(params.get('types'));
    if (types) {
      var parts = types.split(',');
      filters.includeArticle = parts.indexOf('article') !== -1;
      filters.includeNews = parts.indexOf('news') !== -1;
      filters.includePage = parts.indexOf('page') !== -1;
    }

    filters.articleType = params.get('article_type') || '';
    if (normalizeArticleTypeFilter(filters.articleType) === 'clinical image') {
      filters.articleType = 'Clinical Image';
    }
    filters.title = params.get('title') || '';
    filters.author = params.get('author') || '';
    filters.keyword = params.get('keyword') || '';
    filters.doi = params.get('doi') || '';
    filters.yearFrom = params.get('year_from') || '';
    filters.yearTo = params.get('year_to') || '';
    filters.volume = params.get('volume') || '';
    filters.issue = params.get('issue') || '';

    var sort = params.get('sort') || 'relevance';
    filters.sort = ['relevance', 'newest', 'oldest', 'title'].indexOf(sort) !== -1 ? sort : 'relevance';

    if (!filters.includeArticle && !filters.includeNews && !filters.includePage) {
      filters.includeArticle = true;
      filters.includeNews = true;
      filters.includePage = true;
    }

    return filters;
  }

  function applyFiltersToUi(filters) {
    if (!typeArticle || !typeNews || !typePage) return;

    typeArticle.checked = filters.includeArticle;
    typeNews.checked = filters.includeNews;
    typePage.checked = filters.includePage;

    if (articleTypeInput) articleTypeInput.value = filters.articleType;
    if (titleInput) titleInput.value = filters.title;
    if (authorInput) authorInput.value = filters.author;
    if (keywordInput) keywordInput.value = filters.keyword;
    if (doiInput) doiInput.value = filters.doi;
    if (yearFromInput) yearFromInput.value = filters.yearFrom;
    if (yearToInput) yearToInput.value = filters.yearTo;
    if (volumeInput) volumeInput.value = filters.volume;
    if (issueInput) issueInput.value = filters.issue;
    if (sortInput) sortInput.value = filters.sort;
  }

  function readFiltersFromUi() {
    var filters = defaultFilters();

    if (typeArticle && typeNews && typePage) {
      filters.includeArticle = !!typeArticle.checked;
      filters.includeNews = !!typeNews.checked;
      filters.includePage = !!typePage.checked;

      if (!filters.includeArticle && !filters.includeNews && !filters.includePage) {
        filters.includeArticle = true;
        filters.includeNews = true;
        filters.includePage = true;
      }
    }

    filters.articleType = articleTypeInput ? articleTypeInput.value.trim() : '';
    filters.title = titleInput ? titleInput.value.trim() : '';
    filters.author = authorInput ? authorInput.value.trim() : '';
    filters.keyword = keywordInput ? keywordInput.value.trim() : '';
    filters.doi = doiInput ? doiInput.value.trim() : '';
    filters.yearFrom = yearFromInput ? yearFromInput.value.trim() : '';
    filters.yearTo = yearToInput ? yearToInput.value.trim() : '';
    filters.volume = volumeInput ? volumeInput.value.trim() : '';
    filters.issue = issueInput ? issueInput.value.trim() : '';
    filters.sort = sortInput ? sortInput.value : 'relevance';

    if (['relevance', 'newest', 'oldest', 'title'].indexOf(filters.sort) === -1) {
      filters.sort = 'relevance';
    }

    return filters;
  }

  function hasAdvancedConstraints(filters) {
    if (!filters) return false;

    if (!filters.includeArticle || !filters.includeNews || !filters.includePage) return true;
    if (filters.articleType) return true;
    if (filters.title) return true;
    if (filters.author) return true;
    if (filters.keyword) return true;
    if (filters.doi) return true;
    if (filters.yearFrom) return true;
    if (filters.yearTo) return true;
    if (filters.volume) return true;
    if (filters.issue) return true;
    if (filters.sort !== 'relevance') return true;

    return false;
  }

  function getQueryFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return (params.get('q') || '').trim();
  }

  function getDateValue(type, item) {
    var raw = '';
    if (type === 'article') raw = item.published || '';
    if (type === 'news') raw = item.date || '';
    var date = raw ? new Date(raw) : null;
    return date && !isNaN(date.getTime()) ? date.getTime() : null;
  }

  function getYearValue(type, item) {
    var raw = '';
    if (type === 'article') raw = item.published || '';
    if (type === 'news') raw = item.date || '';
    if (!raw || raw.length < 4) return null;
    var y = parseInt(raw.substring(0, 4), 10);
    return isNaN(y) ? null : y;
  }

  function getTitle(type, item) {
    if (type === 'page') return item.title || '';
    return item.title || '';
  }

  function getAuthorsText(item) {
    return (item.authors || []).map(function (author) { return author.name || ''; }).join(' ');
  }

  function getKeywordText(type, item) {
    if (type === 'article') {
      return [
        (item.keywords || []).join(' '),
        item.abstract || '',
        item.previewText || ''
      ].join(' ');
    }

    if (type === 'news') {
      return [item.excerpt || '', searchApi.stripHtml(item.content || ''), item.category || ''].join(' ');
    }

    return [item.desc || '', item.title || ''].join(' ');
  }

  function getSearchableText(type, item) {
    if (type === 'article') {
      return [
        item.title || '',
        getAuthorsText(item),
        (item.authors || []).map(function (author) { return author.affiliation || ''; }).join(' '),
        (item.keywords || []).join(' '),
        item.abstract || '',
        item.previewText || '',
        item.doi || '',
        item.type || '',
        item.volume || '',
        item.issue || ''
      ].join(' ').toLowerCase();
    }

    if (type === 'news') {
      return [
        item.title || '',
        item.excerpt || '',
        searchApi.stripHtml(item.content || ''),
        item.category || '',
        item.date || ''
      ].join(' ').toLowerCase();
    }

    return [item.title || '', item.desc || '', item.url || ''].join(' ').toLowerCase();
  }

  function gatherAllCandidates() {
    var candidates = [];
    var articles = (window.ARTICLES && window.ARTICLES.length) ? window.ARTICLES : [];
    var news = (window.NEWS && window.NEWS.length) ? window.NEWS : [];
    var pages = searchApi.SITE_PAGES || [];

    for (var i = 0; i < articles.length; i++) {
      candidates.push({ type: 'article', item: articles[i], score: 0 });
    }
    for (var j = 0; j < news.length; j++) {
      candidates.push({ type: 'news', item: news[j], score: 0 });
    }
    for (var k = 0; k < pages.length; k++) {
      candidates.push({ type: 'page', item: pages[k], score: 0 });
    }

    return candidates;
  }

  function gatherQueryCandidates(query, filters) {
    var normalizedQuery = normalize(query);

    if (normalizedQuery.length < 2) {
      if (hasAdvancedConstraints(filters)) {
        return gatherAllCandidates();
      }
      return [];
    }

    var state = searchApi.searchAll(normalizedQuery);
    var candidates = [];
    var i;

    for (i = 0; i < state.articleResults.length; i++) {
      candidates.push({ type: 'article', item: state.articleResults[i].item, score: state.articleResults[i].score || 0 });
    }
    for (i = 0; i < state.newsResults.length; i++) {
      candidates.push({ type: 'news', item: state.newsResults[i].item, score: state.newsResults[i].score || 0 });
    }
    for (i = 0; i < state.pageResults.length; i++) {
      candidates.push({ type: 'page', item: state.pageResults[i].item, score: state.pageResults[i].score || 0 });
    }

    return candidates;
  }

  function candidatePassesFilters(candidate, filters) {
    var type = candidate.type;
    var item = candidate.item;

    if (type === 'article' && !filters.includeArticle) return false;
    if (type === 'news' && !filters.includeNews) return false;
    if (type === 'page' && !filters.includePage) return false;

    if (filters.articleType) {
      if (type !== 'article') return false;
      var selectedType = normalizeArticleTypeFilter(filters.articleType);
      var itemType = normalize(item.type);
      if (selectedType === 'clinical image') {
        if (itemType.indexOf('clinical image') === -1 && itemType.indexOf('image corner') === -1) return false;
      } else if (itemType.indexOf(selectedType) === -1) {
        return false;
      }
    }

    if (filters.title) {
      if (normalize(getTitle(type, item)).indexOf(normalize(filters.title)) === -1) return false;
    }

    if (filters.author) {
      if (type !== 'article') return false;
      if (normalize(getAuthorsText(item)).indexOf(normalize(filters.author)) === -1) return false;
    }

    if (filters.keyword) {
      if (normalize(getKeywordText(type, item)).indexOf(normalize(filters.keyword)) === -1) return false;
    }

    if (filters.doi) {
      if (type !== 'article') return false;
      if (normalize(item.doi).indexOf(normalize(filters.doi)) === -1) return false;
    }

    if (filters.yearFrom || filters.yearTo) {
      var year = getYearValue(type, item);
      if (year == null) return false;
      if (filters.yearFrom) {
        var yf = parseInt(filters.yearFrom, 10);
        if (!isNaN(yf) && year < yf) return false;
      }
      if (filters.yearTo) {
        var yt = parseInt(filters.yearTo, 10);
        if (!isNaN(yt) && year > yt) return false;
      }
    }

    if (filters.volume) {
      if (type !== 'article') return false;
      if (String(item.volume || '') !== String(filters.volume)) return false;
    }

    if (filters.issue) {
      if (type !== 'article') return false;
      if (String(item.issue || '') !== String(filters.issue)) return false;
    }

    return true;
  }

  function sortCandidates(candidates, sort) {
    var arr = candidates.slice();

    if (sort === 'title') {
      arr.sort(function (a, b) {
        return getTitle(a.type, a.item).localeCompare(getTitle(b.type, b.item), 'en', { sensitivity: 'base' });
      });
      return arr;
    }

    if (sort === 'newest') {
      arr.sort(function (a, b) {
        var da = getDateValue(a.type, a.item);
        var db = getDateValue(b.type, b.item);
        if (db == null && da == null) return 0;
        if (db == null) return -1;
        if (da == null) return 1;
        return db - da;
      });
      return arr;
    }

    if (sort === 'oldest') {
      arr.sort(function (a, b) {
        var da = getDateValue(a.type, a.item);
        var db = getDateValue(b.type, b.item);
        if (db == null && da == null) return 0;
        if (db == null) return -1;
        if (da == null) return 1;
        return da - db;
      });
      return arr;
    }

    // relevance default
    arr.sort(function (a, b) {
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }

      var da = getDateValue(a.type, a.item);
      var db = getDateValue(b.type, b.item);
      if (db == null && da == null) return 0;
      if (db == null) return -1;
      if (da == null) return 1;
      return db - da;
    });

    return arr;
  }

  function buildSearchUrl(query, filters) {
    var params = new URLSearchParams();

    if (query) params.set('q', query);

    var types = [];
    if (filters.includeArticle) types.push('article');
    if (filters.includeNews) types.push('news');
    if (filters.includePage) types.push('page');
    if (types.length > 0 && types.length < 3) {
      params.set('types', types.join(','));
    }

    if (filters.articleType) params.set('article_type', filters.articleType);
    if (filters.title) params.set('title', filters.title);
    if (filters.author) params.set('author', filters.author);
    if (filters.keyword) params.set('keyword', filters.keyword);
    if (filters.doi) params.set('doi', filters.doi);
    if (filters.yearFrom) params.set('year_from', filters.yearFrom);
    if (filters.yearTo) params.set('year_to', filters.yearTo);
    if (filters.volume) params.set('volume', filters.volume);
    if (filters.issue) params.set('issue', filters.issue);
    if (filters.sort && filters.sort !== 'relevance') params.set('sort', filters.sort);

    var queryString = params.toString();
    return 'search-results.html' + (queryString ? ('?' + queryString) : '');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return escape(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  function getNewsBadgeClass(category) {
    if (category === 'Announcement') return 'bg-blue-100 text-blue-700';
    if (category === 'Award') return 'bg-amber-100 text-amber-700';
    if (category === 'Indexing') return 'bg-green-100 text-green-700';
    if (category === 'Event') return 'bg-purple-100 text-purple-700';
    return 'bg-gray-100 text-gray-700';
  }

  function formatAuthorsForDisplay(authors) {
    if (searchApi && typeof searchApi.formatAuthorsForDisplay === 'function') {
      return searchApi.formatAuthorsForDisplay(authors);
    }
    var names = (authors || []).map(function (author) {
      return (author && author.name ? String(author.name) : '').trim();
    }).filter(Boolean);
    if (!names.length) return '';
    if (names.length <= 2) return names.join(', ');
    return names[0] + ' et al.';
  }

  function renderSummary(total, articleCount, newsCount, pageCount) {
    summaryContainer.innerHTML =
      '<div class="bg-white rounded-xl border border-gray-200 p-4">' +
      '<p class="text-xs text-gray-400 uppercase tracking-wider">Total Matches</p>' +
      '<p class="mt-1 text-2xl font-bold text-gray-900">' + total + '</p>' +
      '</div>' +
      '<div class="bg-white rounded-xl border border-gray-200 p-4">' +
      '<p class="text-xs text-gray-400 uppercase tracking-wider">Articles</p>' +
      '<p class="mt-1 text-2xl font-bold text-teal-700">' + articleCount + '</p>' +
      '</div>' +
      '<div class="bg-white rounded-xl border border-gray-200 p-4">' +
      '<p class="text-xs text-gray-400 uppercase tracking-wider">News</p>' +
      '<p class="mt-1 text-2xl font-bold text-gray-900">' + newsCount + '</p>' +
      '</div>' +
      '<div class="bg-white rounded-xl border border-gray-200 p-4">' +
      '<p class="text-xs text-gray-400 uppercase tracking-wider">Pages</p>' +
      '<p class="mt-1 text-2xl font-bold text-gray-900">' + pageCount + '</p>' +
      '</div>';
  }

  function renderArticleResult(article, query) {
    var authors = formatAuthorsForDisplay(article.authors);
    var summary = article.abstract || article.previewText || '';
    summary = truncateText(summary, 280);

    var html = '<article class="article-card bg-white rounded-xl border border-gray-200 p-6">';
    html += '<div class="flex items-center gap-2 mb-3">';
    html += '<span class="badge ' + getArticleTypeBadgeClass(article.type) + '">' + escape(article.type || 'Article') + '</span>';
    html += '<span class="text-xs text-gray-400">Vol. ' + escape(String(article.volume || '')) + ', Issue ' + escape(String(article.issue || '')) + '</span>';
    html += '</div>';
    html += '<h2 class="text-lg font-semibold text-gray-900 mb-2 leading-snug">';
    html += '<a href="article.html?id=' + article.id + '" class="hover:text-teal-700 transition-colors">' + searchApi.highlightMatch(escape(article.title || ''), query) + '</a>';
    html += '</h2>';

    if (authors) {
      html += '<p class="text-sm text-gray-500 mb-3">' + searchApi.highlightMatch(escape(authors), query) + '</p>';
    }

    if (summary) {
      html += '<p class="text-sm text-gray-600 leading-relaxed font-serif">' + searchApi.highlightMatch(escape(summary), query) + '</p>';
    }

    html += '<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">';
    if (article.published) html += '<span>' + escape(article.published) + '</span>';
    if (article.pages) html += '<span>pp. ' + escape(article.pages) + '</span>';
    if (article.doi) html += '<span style="overflow-wrap:anywhere;word-break:break-word;">DOI: ' + searchApi.highlightMatch(escape(article.doi), query) + '</span>';
    html += '</div>';
    html += '</article>';

    return html;
  }

  function renderNewsResult(newsItem, query) {
    var badgeClass = getNewsBadgeClass(newsItem.category);
    var excerpt = truncateText(newsItem.excerpt || '', 260);

    var html = '<article class="article-card bg-white rounded-xl border border-gray-200 p-6">';
    html += '<div class="flex items-center gap-2 mb-3">';
    html += '<span class="badge ' + badgeClass + '">' + escape(newsItem.category || 'News') + '</span>';
    html += '<span class="text-xs text-gray-400">' + formatDate(newsItem.date) + '</span>';
    html += '</div>';
    html += '<h2 class="text-lg font-semibold text-gray-900 mb-2 leading-snug">';
    html += '<a href="news-article.html?id=' + newsItem.id + '" class="hover:text-teal-700 transition-colors">' + searchApi.highlightMatch(escape(newsItem.title || ''), query) + '</a>';
    html += '</h2>';
    if (excerpt) {
      html += '<p class="text-sm text-gray-600 leading-relaxed font-serif">' + searchApi.highlightMatch(escape(excerpt), query) + '</p>';
    }
    html += '</article>';

    return html;
  }

  function renderPageResult(pageItem, query) {
    var isExternal = pageItem.url.indexOf('http') === 0;
    var target = isExternal ? ' target="_blank" rel="noopener"' : '';

    var html = '<article class="article-card bg-white rounded-xl border border-gray-200 p-6">';
    html += '<span class="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 mb-2">Page</span>';
    html += '<h2 class="text-lg font-semibold text-gray-900 mb-2 leading-snug">';
    html += '<a href="' + pageItem.url + '"' + target + ' class="hover:text-teal-700 transition-colors">' + searchApi.highlightMatch(escape(pageItem.title), query) + '</a>';
    html += '</h2>';
    html += '<p class="text-sm text-gray-600 leading-relaxed font-serif">' + searchApi.highlightMatch(escape(pageItem.desc), query) + '</p>';
    html += '</article>';

    return html;
  }

  function renderSection(title, id, count, items, renderer, query) {
    if (!items || items.length === 0) return '';

    var html = '<section id="' + id + '">';
    html += '<div class="flex items-center justify-between mb-4">';
    html += '<h2 class="text-2xl font-bold text-gray-900">' + title + '</h2>';
    html += '<span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-700">' + count + '</span>';
    html += '</div>';
    html += '<div class="space-y-4">';

    for (var i = 0; i < items.length; i++) {
      html += renderer(items[i].item, query);
    }

    html += '</div>';
    html += '</section>';
    return html;
  }

  function renderIntroState() {
    queryLabel.textContent = 'Enter at least 2 characters to begin your search, or use advanced filters.';
    summaryContainer.innerHTML =
      '<div class="bg-white rounded-xl border border-gray-200 p-4 col-span-full">' +
      '<p class="text-sm text-gray-600">Try terms like <span class="font-semibold text-gray-900">atherosclerosis</span>, <span class="font-semibold text-gray-900">hyperuricemia</span>, <span class="font-semibold text-gray-900">DOI</span>, or an author surname.</p>' +
      '</div>';

    resultsContainer.innerHTML =
      '<section class="bg-white rounded-xl border border-gray-200 p-6">' +
      '<h2 class="text-xl font-semibold text-gray-900 mb-3">Start a Focused Search</h2>' +
      '<p class="text-gray-600 font-serif leading-relaxed mb-4">Use the search box above or open Advanced Search to query by title, author, DOI, publication year, volume, issue, and content type.</p>' +
      '<div class="grid sm:grid-cols-2 gap-3">' +
      '<a href="current-issue.html" class="block px-4 py-3 rounded-lg border border-gray-200 hover:border-teal-200 hover:bg-teal-50 transition-colors text-sm font-medium text-gray-700">Browse Current Issue</a>' +
      '<a href="archive.html" class="block px-4 py-3 rounded-lg border border-gray-200 hover:border-teal-200 hover:bg-teal-50 transition-colors text-sm font-medium text-gray-700">Explore Archive</a>' +
      '<a href="articles-in-press.html" class="block px-4 py-3 rounded-lg border border-gray-200 hover:border-teal-200 hover:bg-teal-50 transition-colors text-sm font-medium text-gray-700">See Articles in Press</a>' +
      '<a href="news.html" class="block px-4 py-3 rounded-lg border border-gray-200 hover:border-teal-200 hover:bg-teal-50 transition-colors text-sm font-medium text-gray-700">Read Journal News</a>' +
      '</div>' +
      '</section>';
  }

  function renderNoResultsState(query) {
    queryLabel.innerHTML = 'No matches found for <strong>"' + escape(query) + '"</strong> with the selected filters.';
    summaryContainer.innerHTML =
      '<div class="bg-white rounded-xl border border-gray-200 p-4 col-span-full">' +
      '<p class="text-sm text-gray-600">Try broader keywords, remove one or two advanced criteria, or adjust publication year boundaries.</p>' +
      '</div>';

    resultsContainer.innerHTML =
      '<section class="bg-white rounded-xl border border-gray-200 p-6">' +
      '<h2 class="text-xl font-semibold text-gray-900 mb-3">Refine Your Search Strategy</h2>' +
      '<ul class="list-disc list-inside text-sm text-gray-600 space-y-2">' +
      '<li>Use fewer words and avoid punctuation-heavy phrases.</li>' +
      '<li>Try field-specific terms such as manuscript type or disease name.</li>' +
      '<li>Search using DOI fragments when available.</li>' +
      '</ul>' +
      '</section>';
  }

  function setAdvancedOpen(open) {
    if (!advancedToggle || !advancedPanel) return;

    advancedToggle.setAttribute('aria-expanded', String(open));
    advancedPanel.classList.toggle('hidden', !open);

    var label = open ? 'Hide Advanced Search' : 'Advanced Search';
    var iconPath = open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7';
    advancedToggle.innerHTML =
      label +
      '<svg class="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + iconPath + '"/></svg>';
  }

  function updateDocumentTitle(query, total) {
    if (!query) {
      document.title = 'Search Results — Balkan Medical Journal';
      return;
    }
    document.title = 'Search Results (' + total + ') for "' + query + '" — Balkan Medical Journal';
  }

  function renderResults(query, filters, options) {
    options = options || {};

    var candidates = gatherQueryCandidates(query, filters);
    var filtered = [];

    for (var i = 0; i < candidates.length; i++) {
      if (candidatePassesFilters(candidates[i], filters)) {
        filtered.push(candidates[i]);
      }
    }

    var article = [];
    var news = [];
    var page = [];

    for (var j = 0; j < filtered.length; j++) {
      if (filtered[j].type === 'article') article.push(filtered[j]);
      if (filtered[j].type === 'news') news.push(filtered[j]);
      if (filtered[j].type === 'page') page.push(filtered[j]);
    }

    article = sortCandidates(article, filters.sort);
    news = sortCandidates(news, filters.sort);
    page = sortCandidates(page, filters.sort);

    var total = article.length + news.length + page.length;

    updateDocumentTitle(query, total);

    if ((query || '').trim().length < 2 && !hasAdvancedConstraints(filters)) {
      renderIntroState();
      return;
    }

    if (total === 0) {
      renderNoResultsState(query || 'your search');
      return;
    }

    if (query) {
      queryLabel.innerHTML = total + ' result' + (total > 1 ? 's' : '') + ' found for <strong>"' + escape(query) + '"</strong>.';
    } else {
      queryLabel.innerHTML = total + ' result' + (total > 1 ? 's' : '') + ' found using advanced search criteria.';
    }

    renderSummary(total, article.length, news.length, page.length);

    var html = '';
    html += renderSection('Articles', 'results-articles', article.length, article, renderArticleResult, query);
    html += renderSection('News', 'results-news', news.length, news, renderNewsResult, query);
    html += renderSection('Pages', 'results-pages', page.length, page, renderPageResult, query);
    resultsContainer.innerHTML = html;

    if (options.syncUrl !== false) {
      var nextUrl = buildSearchUrl(query, filters);
      if (options.replaceState) {
        window.history.replaceState(null, '', nextUrl);
      } else {
        window.history.pushState(null, '', nextUrl);
      }
    }
  }

  function executeSearch(options) {
    var query = input.value.trim();
    var filters = readFiltersFromUi();
    renderResults(query, filters, options || {});
  }

  function resetAdvancedFilters() {
    applyFiltersToUi(defaultFilters());
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    executeSearch({ syncUrl: true, replaceState: false });
  });

  if (advancedApplyBtn) {
    advancedApplyBtn.addEventListener('click', function () {
      executeSearch({ syncUrl: true, replaceState: false });
    });
  }

  if (advancedClearBtn) {
    advancedClearBtn.addEventListener('click', function () {
      resetAdvancedFilters();
      executeSearch({ syncUrl: true, replaceState: false });
    });
  }

  if (advancedToggle) {
    advancedToggle.addEventListener('click', function () {
      var isOpen = advancedToggle.getAttribute('aria-expanded') === 'true';
      setAdvancedOpen(!isOpen);
    });
  }

  window.addEventListener('resize', syncAdvancedColumnWidth);

  window.addEventListener('popstate', function () {
    var params = new URLSearchParams(window.location.search);
    var query = (params.get('q') || '').trim();
    var filters = parseFiltersFromUrl(params);

    input.value = query;
    applyFiltersToUi(filters);
    setAdvancedOpen(hasAdvancedConstraints(filters));
    renderResults(query, filters, { syncUrl: false });
  });

  // Initial load
  (function init() {
    var params = new URLSearchParams(window.location.search);
    var query = (params.get('q') || '').trim();
    var filters = parseFiltersFromUrl(params);

    syncAdvancedColumnWidth();
    setTimeout(syncAdvancedColumnWidth, 120);

    input.value = query;
    applyFiltersToUi(filters);
    setAdvancedOpen(hasAdvancedConstraints(filters));
    renderResults(query, filters, { syncUrl: true, replaceState: true });
  })();
})();
