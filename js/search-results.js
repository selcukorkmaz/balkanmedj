/**
 * Balkan Medical Journal — Full Search Results Page
 */
(function () {
  'use strict';

  var form = document.getElementById('search-page-form');
  var input = document.getElementById('search-page-input');
  var queryLabel = document.getElementById('search-page-query');
  var summaryContainer = document.getElementById('search-page-summary');
  var resultsContainer = document.getElementById('search-page-results');

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

  function getQueryFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return (params.get('q') || '').trim();
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return searchApi.escapeHtml(dateStr);
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

  function renderSummary(state) {
    summaryContainer.innerHTML =
      '<div class="bg-white rounded-xl border border-gray-200 p-4">' +
      '<p class="text-xs text-gray-400 uppercase tracking-wider">Total Matches</p>' +
      '<p class="mt-1 text-2xl font-bold text-gray-900">' + state.total + '</p>' +
      '</div>' +
      '<div class="bg-white rounded-xl border border-gray-200 p-4">' +
      '<p class="text-xs text-gray-400 uppercase tracking-wider">Articles</p>' +
      '<p class="mt-1 text-2xl font-bold text-teal-700">' + state.articleResults.length + '</p>' +
      '</div>' +
      '<div class="bg-white rounded-xl border border-gray-200 p-4">' +
      '<p class="text-xs text-gray-400 uppercase tracking-wider">News &amp; Pages</p>' +
      '<p class="mt-1 text-2xl font-bold text-gray-900">' + (state.newsResults.length + state.pageResults.length) + '</p>' +
      '</div>';
  }

  function renderArticleResult(article, query) {
    var authors = (article.authors || []).map(function (author) { return author.name; }).join(', ');
    var summary = article.abstract || article.previewText || '';
    summary = truncateText(summary, 280);

    var html = '<article class="article-card bg-white rounded-xl border border-gray-200 p-6">';
    html += '<div class="flex items-center gap-2 mb-3">';
    html += '<span class="badge bg-teal-100 text-teal-700">' + searchApi.escapeHtml(article.type || 'Article') + '</span>';
    html += '<span class="text-xs text-gray-400">Vol. ' + searchApi.escapeHtml(String(article.volume || '')) + ', Issue ' + searchApi.escapeHtml(String(article.issue || '')) + '</span>';
    html += '</div>';
    html += '<h2 class="text-lg font-semibold text-gray-900 mb-2 leading-snug">';
    html += '<a href="article.html?id=' + article.id + '" class="hover:text-teal-700 transition-colors">' + searchApi.highlightMatch(searchApi.escapeHtml(article.title || ''), query) + '</a>';
    html += '</h2>';

    if (authors) {
      html += '<p class="text-sm text-gray-500 mb-3">' + searchApi.highlightMatch(searchApi.escapeHtml(authors), query) + '</p>';
    }

    if (summary) {
      html += '<p class="text-sm text-gray-600 leading-relaxed font-serif">' + searchApi.highlightMatch(searchApi.escapeHtml(summary), query) + '</p>';
    }

    html += '<div class="flex items-center gap-4 text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">';
    if (article.published) html += '<span>' + searchApi.escapeHtml(article.published) + '</span>';
    if (article.pages) html += '<span>pp. ' + searchApi.escapeHtml(article.pages) + '</span>';
    if (article.doi) html += '<span>DOI: ' + searchApi.highlightMatch(searchApi.escapeHtml(article.doi), query) + '</span>';
    html += '</div>';
    html += '</article>';

    return html;
  }

  function renderNewsResult(newsItem, query) {
    var badgeClass = getNewsBadgeClass(newsItem.category);
    var excerpt = truncateText(newsItem.excerpt || '', 260);

    var html = '<article class="article-card bg-white rounded-xl border border-gray-200 p-6">';
    html += '<div class="flex items-center gap-2 mb-3">';
    html += '<span class="badge ' + badgeClass + '">' + searchApi.escapeHtml(newsItem.category || 'News') + '</span>';
    html += '<span class="text-xs text-gray-400">' + formatDate(newsItem.date) + '</span>';
    html += '</div>';
    html += '<h2 class="text-lg font-semibold text-gray-900 mb-2 leading-snug">';
    html += '<a href="news-article.html?id=' + newsItem.id + '" class="hover:text-teal-700 transition-colors">' + searchApi.highlightMatch(searchApi.escapeHtml(newsItem.title || ''), query) + '</a>';
    html += '</h2>';
    if (excerpt) {
      html += '<p class="text-sm text-gray-600 leading-relaxed font-serif">' + searchApi.highlightMatch(searchApi.escapeHtml(excerpt), query) + '</p>';
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
    html += '<a href="' + pageItem.url + '"' + target + ' class="hover:text-teal-700 transition-colors">' + searchApi.highlightMatch(searchApi.escapeHtml(pageItem.title), query) + '</a>';
    html += '</h2>';
    html += '<p class="text-sm text-gray-600 leading-relaxed font-serif">' + searchApi.highlightMatch(searchApi.escapeHtml(pageItem.desc), query) + '</p>';
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
    queryLabel.textContent = 'Enter at least 2 characters to begin your search.';
    summaryContainer.innerHTML =
      '<div class="bg-white rounded-xl border border-gray-200 p-4 col-span-full">' +
      '<p class="text-sm text-gray-600">Try terms like <span class="font-semibold text-gray-900">atherosclerosis</span>, <span class="font-semibold text-gray-900">peer review</span>, <span class="font-semibold text-gray-900">DOI</span>, or an author surname.</p>' +
      '</div>';

    resultsContainer.innerHTML =
      '<section class="bg-white rounded-xl border border-gray-200 p-6">' +
      '<h2 class="text-xl font-semibold text-gray-900 mb-3">Start a Focused Search</h2>' +
      '<p class="text-gray-600 font-serif leading-relaxed mb-4">Use the search box above to retrieve all matching articles, news items, and relevant journal pages. Results are ranked by relevance to help you reach key content quickly.</p>' +
      '<div class="grid sm:grid-cols-2 gap-3">' +
      '<a href="current-issue.html" class="block px-4 py-3 rounded-lg border border-gray-200 hover:border-teal-200 hover:bg-teal-50 transition-colors text-sm font-medium text-gray-700">Browse Current Issue</a>' +
      '<a href="archive.html" class="block px-4 py-3 rounded-lg border border-gray-200 hover:border-teal-200 hover:bg-teal-50 transition-colors text-sm font-medium text-gray-700">Explore Archive</a>' +
      '<a href="articles-in-press.html" class="block px-4 py-3 rounded-lg border border-gray-200 hover:border-teal-200 hover:bg-teal-50 transition-colors text-sm font-medium text-gray-700">See Articles in Press</a>' +
      '<a href="news.html" class="block px-4 py-3 rounded-lg border border-gray-200 hover:border-teal-200 hover:bg-teal-50 transition-colors text-sm font-medium text-gray-700">Read Journal News</a>' +
      '</div>' +
      '</section>';
  }

  function renderNoResultsState(query) {
    queryLabel.innerHTML = 'No matches found for <strong>"' + searchApi.escapeHtml(query) + '"</strong>.';
    summaryContainer.innerHTML =
      '<div class="bg-white rounded-xl border border-gray-200 p-4 col-span-full">' +
      '<p class="text-sm text-gray-600">No items matched this query. Try broader keywords, alternate spellings, or author surnames.</p>' +
      '</div>';

    resultsContainer.innerHTML =
      '<section class="bg-white rounded-xl border border-gray-200 p-6">' +
      '<h2 class="text-xl font-semibold text-gray-900 mb-3">Refine Your Search</h2>' +
      '<ul class="list-disc list-inside text-sm text-gray-600 space-y-2">' +
      '<li>Use fewer words and avoid punctuation-heavy phrases.</li>' +
      '<li>Try field-specific terms such as manuscript type or disease name.</li>' +
      '<li>Search using DOI fragments when available.</li>' +
      '</ul>' +
      '</section>';
  }

  function renderResultsState(state) {
    queryLabel.innerHTML =
      state.total + ' result' + (state.total > 1 ? 's' : '') +
      ' found for <strong>"' + searchApi.escapeHtml(state.query) + '"</strong>.';

    renderSummary(state);

    var html = '';
    html += renderSection('Articles', 'results-articles', state.articleResults.length, state.articleResults, renderArticleResult, state.query);
    html += renderSection('News', 'results-news', state.newsResults.length, state.newsResults, renderNewsResult, state.query);
    html += renderSection('Pages', 'results-pages', state.pageResults.length, state.pageResults, renderPageResult, state.query);
    resultsContainer.innerHTML = html;
  }

  function updateDocumentTitle(query, total) {
    if (!query) {
      document.title = 'Search Results — Balkan Medical Journal';
      return;
    }
    document.title = 'Search Results (' + total + ') for "' + query + '" — Balkan Medical Journal';
  }

  function render() {
    var query = getQueryFromUrl();
    input.value = query;

    var state = searchApi.searchAll(query);
    updateDocumentTitle(state.query, state.total);

    if (!state.query || state.query.length < 2) {
      renderIntroState();
      return;
    }

    if (state.total === 0) {
      renderNoResultsState(state.query);
      return;
    }

    renderResultsState(state);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var query = input.value.trim();
    window.location.href = searchApi.getViewAllUrl(query);
  });

  window.addEventListener('popstate', render);
  render();
})();
