/**
 * Balkan Medical Journal — Global Search
 * Searches articles, news, and site pages with live results
 */
(function () {
  'use strict';

  var overlay = document.getElementById('search-overlay');
  var input = document.getElementById('search-input');
  var resultsContainer = document.getElementById('search-results');
  var closeBtn = document.getElementById('search-close');
  var openBtns = document.querySelectorAll('[data-search-toggle]');

  if (!overlay || !input || !resultsContainer) return;

  var debounceTimer;

  // ─── Site pages (always available, no data file needed) ────────
  var SITE_PAGES = [
    { title: 'Home', url: 'index.html', desc: 'Journal homepage with featured articles and latest news' },
    { title: 'About the Journal', url: 'about.html', desc: 'Mission, scope, history, indexing, open access policy, Trakya University' },
    { title: 'Editorial Board', url: 'editorial-board.html', desc: 'Editor-in-chief, associate editors, editorial board members' },
    { title: 'Journal Metrics', url: 'journal-metrics.html', desc: 'Impact factor, CiteScore, SJR, SNIP, H-index, citation metrics' },
    { title: 'Current Issue', url: 'current-issue.html', desc: 'Latest published volume and issue with all articles' },
    { title: 'Articles in Press', url: 'articles-in-press.html', desc: 'Accepted manuscripts ahead of print publication' },
    { title: 'Archive', url: 'archive.html', desc: 'Past volumes and issues, back issues, previous publications' },
    { title: 'For Authors', url: 'for-authors.html', desc: 'Author guidelines, submission instructions, manuscript preparation, formatting' },
    { title: 'For Reviewers', url: 'for-reviewers.html', desc: 'Reviewer guidelines, peer review process, evaluation criteria' },
    { title: 'Policies', url: 'policies.html', desc: 'Ethics, plagiarism, copyright, conflict of interest, data sharing, corrections' },
    { title: 'Contact', url: 'contact.html', desc: 'Contact information, editorial office, address, email' },
    { title: 'News', url: 'news.html', desc: 'Latest announcements, journal updates, events' },
    { title: 'Forms', url: 'forms.html', desc: 'Copyright transfer, conflict of interest, author forms, downloads' },
    { title: 'Submit Manuscript', url: 'https://balkanmedj.manuscriptmanager.net', desc: 'Online manuscript submission system' }
  ];

  // ─── Open / Close ──────────────────────────────────────────────

  function openSearch() {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    renderInitial();
    setTimeout(function () { input.focus(); }, 100);
  }

  function closeSearch() {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    input.value = '';
    resultsContainer.innerHTML = '';
  }

  for (var i = 0; i < openBtns.length; i++) {
    openBtns[i].addEventListener('click', function (e) {
      e.preventDefault();
      var mobileMenu = document.getElementById('mobile-menu');
      if (mobileMenu && mobileMenu.classList.contains('mobile-menu-active')) {
        var closeMenuBtn = document.getElementById('mobile-menu-close');
        if (closeMenuBtn) closeMenuBtn.click();
      }
      openSearch();
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeSearch);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeSearch();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
      closeSearch();
    }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (overlay.classList.contains('hidden')) {
        openSearch();
      } else {
        closeSearch();
      }
    }
  });

  // ─── Helpers ───────────────────────────────────────────────────

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function highlightMatch(text, query) {
    if (!query) return text;
    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var regex = new RegExp('(' + escaped + ')', 'gi');
    return text.replace(regex, '<mark class="bg-yellow-200 text-inherit rounded px-0.5">$1</mark>');
  }

  function stripHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  // ─── Search functions ──────────────────────────────────────────

  function searchArticles(q) {
    var articles = (window.ARTICLES && window.ARTICLES.length) ? window.ARTICLES : [];
    var results = [];

    for (var i = 0; i < articles.length; i++) {
      var a = articles[i];
      var score = 0;
      var titleL = (a.title || '').toLowerCase();
      var authorsStr = (a.authors || []).map(function (au) { return au.name; }).join(' ').toLowerCase();
      var affiliationsStr = (a.authors || []).map(function (au) { return au.affiliation || ''; }).join(' ').toLowerCase();
      var keywordsStr = (a.keywords || []).join(' ').toLowerCase();
      var abstractL = (a.abstract || '').toLowerCase();
      var previewL = (a.previewText || '').toLowerCase();
      var doiL = (a.doi || '').toLowerCase();
      var typeL = (a.type || '').toLowerCase();

      if (titleL.indexOf(q) !== -1) score += 10;
      if (authorsStr.indexOf(q) !== -1) score += 7;
      if (doiL.indexOf(q) !== -1) score += 8;
      if (keywordsStr.indexOf(q) !== -1) score += 5;
      if (typeL.indexOf(q) !== -1) score += 4;
      if (affiliationsStr.indexOf(q) !== -1) score += 3;
      if (abstractL.indexOf(q) !== -1) score += 2;
      if (previewL.indexOf(q) !== -1) score += 1;

      if (score > 0) results.push({ item: a, score: score, type: 'article' });
    }

    return results;
  }

  function searchNews(q) {
    var news = (window.NEWS && window.NEWS.length) ? window.NEWS : [];
    var results = [];

    for (var i = 0; i < news.length; i++) {
      var n = news[i];
      var score = 0;
      var titleL = (n.title || '').toLowerCase();
      var excerptL = (n.excerpt || '').toLowerCase();
      var contentL = stripHtml(n.content || '').toLowerCase();
      var catL = (n.category || '').toLowerCase();

      if (titleL.indexOf(q) !== -1) score += 10;
      if (catL.indexOf(q) !== -1) score += 5;
      if (excerptL.indexOf(q) !== -1) score += 3;
      if (contentL.indexOf(q) !== -1) score += 1;

      if (score > 0) results.push({ item: n, score: score, type: 'news' });
    }

    return results;
  }

  function searchPages(q) {
    var results = [];

    for (var i = 0; i < SITE_PAGES.length; i++) {
      var p = SITE_PAGES[i];
      var score = 0;
      var titleL = p.title.toLowerCase();
      var descL = p.desc.toLowerCase();

      if (titleL.indexOf(q) !== -1) score += 10;
      if (descL.indexOf(q) !== -1) score += 3;

      if (score > 0) results.push({ item: p, score: score, type: 'page' });
    }

    return results;
  }

  // ─── Render ────────────────────────────────────────────────────

  function renderInitial() {
    resultsContainer.innerHTML =
      '<div class="text-center py-10">' +
      '<svg class="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>' +
      '<p class="text-sm text-gray-400">Search articles, authors, keywords, news, and pages</p>' +
      '<p class="text-xs text-gray-300 mt-1">Type at least 2 characters to start</p>' +
      '</div>';
  }

  function renderArticleCard(a, query) {
    var authors = (a.authors || []).map(function (au) { return au.name; }).join(', ');
    var year = a.published ? a.published.substring(0, 4) : '';

    var html = '<a href="article.html?id=' + a.id + '" class="block p-3 rounded-lg hover:bg-gray-50 border border-gray-100 transition-colors group">';
    html += '<span class="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 mb-1">' + escapeHtml(a.type || '') + '</span>';
    html += '<h3 class="text-sm font-semibold text-gray-900 group-hover:text-teal-700 leading-snug">' + highlightMatch(escapeHtml(a.title || ''), query) + '</h3>';
    if (authors) {
      html += '<p class="text-xs text-gray-500 mt-1 truncate">' + highlightMatch(escapeHtml(authors), query) + '</p>';
    }
    if (year || a.pages) {
      html += '<p class="text-xs text-gray-400 mt-0.5">';
      if (year) html += year;
      if (year && a.pages) html += ' &middot; ';
      if (a.pages) html += 'pp. ' + a.pages;
      html += '</p>';
    }
    html += '</a>';
    return html;
  }

  function renderNewsCard(n, query) {
    var html = '<a href="news-article.html?id=' + n.id + '" class="block p-3 rounded-lg hover:bg-gray-50 border border-gray-100 transition-colors group">';
    html += '<span class="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 mb-1">' + escapeHtml(n.category || 'News') + '</span>';
    html += '<h3 class="text-sm font-semibold text-gray-900 group-hover:text-teal-700 leading-snug">' + highlightMatch(escapeHtml(n.title || ''), query) + '</h3>';
    if (n.excerpt) {
      var excerpt = n.excerpt.length > 120 ? n.excerpt.substring(0, 120) + '...' : n.excerpt;
      html += '<p class="text-xs text-gray-500 mt-1">' + highlightMatch(escapeHtml(excerpt), query) + '</p>';
    }
    if (n.date) {
      html += '<p class="text-xs text-gray-400 mt-0.5">' + n.date + '</p>';
    }
    html += '</a>';
    return html;
  }

  function renderPageCard(p, query) {
    var isExternal = p.url.indexOf('http') === 0;
    var target = isExternal ? ' target="_blank" rel="noopener"' : '';
    var html = '<a href="' + p.url + '"' + target + ' class="block p-3 rounded-lg hover:bg-gray-50 border border-gray-100 transition-colors group">';
    html += '<span class="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 mb-1">Page</span>';
    html += '<h3 class="text-sm font-semibold text-gray-900 group-hover:text-teal-700 leading-snug">' + highlightMatch(escapeHtml(p.title), query) + '</h3>';
    html += '<p class="text-xs text-gray-500 mt-1">' + highlightMatch(escapeHtml(p.desc), query) + '</p>';
    html += '</a>';
    return html;
  }

  function renderResults(query) {
    if (!query || query.length < 2) {
      renderInitial();
      return;
    }

    var q = query.toLowerCase();
    var articleResults = searchArticles(q);
    var newsResults = searchNews(q);
    var pageResults = searchPages(q);
    var total = articleResults.length + newsResults.length + pageResults.length;

    if (total === 0) {
      resultsContainer.innerHTML =
        '<div class="text-center py-8">' +
        '<svg class="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>' +
        '<p class="text-gray-500">No results found for "<strong>' + escapeHtml(query) + '</strong>"</p>' +
        '<p class="text-xs text-gray-400 mt-1">Try different keywords or check spelling</p>' +
        '</div>';
      return;
    }

    var html = '<p class="text-sm text-gray-500 mb-3">' + total + ' result' + (total > 1 ? 's' : '') + ' found</p>';
    html += '<div class="space-y-2">';

    // Articles first (most important)
    if (articleResults.length > 0) {
      articleResults.sort(function (a, b) { return b.score - a.score; });
      var showArticles = articleResults.slice(0, 8);
      html += '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-2 mb-1">Articles (' + articleResults.length + ')</p>';
      for (var i = 0; i < showArticles.length; i++) {
        html += renderArticleCard(showArticles[i].item, query);
      }
      if (articleResults.length > 8) {
        html += '<p class="text-xs text-teal-600 text-center py-1">+ ' + (articleResults.length - 8) + ' more articles</p>';
      }
    }

    // News
    if (newsResults.length > 0) {
      newsResults.sort(function (a, b) { return b.score - a.score; });
      var showNews = newsResults.slice(0, 5);
      html += '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 mb-1">News (' + newsResults.length + ')</p>';
      for (var j = 0; j < showNews.length; j++) {
        html += renderNewsCard(showNews[j].item, query);
      }
    }

    // Pages
    if (pageResults.length > 0) {
      pageResults.sort(function (a, b) { return b.score - a.score; });
      html += '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 mb-1">Pages (' + pageResults.length + ')</p>';
      for (var k = 0; k < pageResults.length; k++) {
        html += renderPageCard(pageResults[k].item, query);
      }
    }

    html += '</div>';
    resultsContainer.innerHTML = html;
  }

  // ─── Input handling ────────────────────────────────────────────

  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    var query = input.value.trim();
    debounceTimer = setTimeout(function () {
      renderResults(query);
    }, 200);
  });

  // Arrow key navigation through results
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var focused = resultsContainer.querySelector('a.search-focused') || resultsContainer.querySelector('a');
      if (focused) {
        focused.click();
        closeSearch();
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
    }
  });

  function moveFocus(dir) {
    var links = resultsContainer.querySelectorAll('a');
    if (!links.length) return;

    var current = resultsContainer.querySelector('a.search-focused');
    var idx = -1;

    if (current) {
      current.classList.remove('search-focused', 'bg-gray-50');
      for (var i = 0; i < links.length; i++) {
        if (links[i] === current) { idx = i; break; }
      }
    }

    var next = idx + dir;
    if (next < 0) next = links.length - 1;
    if (next >= links.length) next = 0;

    links[next].classList.add('search-focused', 'bg-gray-50');
    links[next].scrollIntoView({ block: 'nearest' });
  }
})();
