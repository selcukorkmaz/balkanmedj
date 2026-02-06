/**
 * Balkan Medical Journal — Article Search & Filter
 * Type filter pills + text search for article listings
 */
(function () {
  'use strict';

  var container = document.getElementById('articles-container');
  var searchInput = document.getElementById('article-search');
  var filterContainer = document.getElementById('type-filters');
  var countDisplay = document.getElementById('article-count');
  if (!container || !window.ARTICLES) return;

  var articles = window.ARTICLES;
  var activeType = 'All';

  // Get unique article types
  var types = ['All'];
  articles.forEach(function (a) {
    if (types.indexOf(a.type) === -1) types.push(a.type);
  });

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

  // Filter articles based on type and search
  function getFilteredArticles() {
    var searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    return articles.filter(function (a) {
      var matchesType = activeType === 'All' || a.type === activeType;
      if (!matchesType) return false;
      if (!searchTerm) return true;
      var searchable = (a.title + ' ' + a.authors.map(function (au) { return au.name; }).join(' ') + ' ' + (a.keywords || []).join(' ')).toLowerCase();
      return searchable.indexOf(searchTerm) !== -1;
    });
  }

  // Render article cards
  function renderArticles() {
    var filtered = getFilteredArticles();
    container.innerHTML = '';

    if (countDisplay) {
      countDisplay.textContent = filtered.length + ' article' + (filtered.length !== 1 ? 's' : '');
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div class="col-span-full text-center py-12"><p class="text-gray-400 text-lg">No articles found matching your criteria.</p></div>';
      return;
    }

    // Group by type if showing all
    if (activeType === 'All') {
      var grouped = {};
      filtered.forEach(function (a) {
        if (!grouped[a.type]) grouped[a.type] = [];
        grouped[a.type].push(a);
      });

      // Order: Editorial, Original Article, Review, Brief Report, Case Report, Letter, Image Corner
      var typeOrder = ['Editorial', 'Original Article', 'Review', 'Brief Report', 'Case Report', 'Letter to the Editor', 'Image Corner'];
      typeOrder.forEach(function (type) {
        if (!grouped[type]) return;
        var section = document.createElement('div');
        section.className = 'col-span-full';
        section.innerHTML = '<h3 class="text-xl font-bold text-gray-900 mt-8 mb-4 pb-2 border-b border-gray-200">' + type + 's</h3>';
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
    var typeColor = article.type === 'Review' ? 'bg-purple-100 text-purple-700' :
                    article.type === 'Editorial' ? 'bg-blue-100 text-blue-700' :
                    article.type === 'Case Report' ? 'bg-amber-100 text-amber-700' :
                    article.type === 'Brief Report' ? 'bg-cyan-100 text-cyan-700' :
                    article.type === 'Letter to the Editor' ? 'bg-pink-100 text-pink-700' :
                    article.type === 'Image Corner' ? 'bg-indigo-100 text-indigo-700' :
                    'bg-teal-100 text-teal-700';

    var card = document.createElement('article');
    card.className = 'article-card bg-white rounded-xl border border-gray-200 p-6';
    card.innerHTML =
      '<div class="flex items-center gap-2 mb-3">' +
        '<span class="badge ' + typeColor + '">' + article.type + '</span>' +
        (article.aheadOfPrint ? '<span class="badge bg-orange-100 text-orange-700">Ahead of Print</span>' : '') +
        '<span class="text-xs text-gray-400">' + article.pages + '</span>' +
      '</div>' +
      '<h3 class="text-lg font-semibold text-gray-900 mb-2 leading-snug">' +
        '<a href="article.html?id=' + article.id + '" class="hover:text-teal-700 transition-colors">' + article.title + '</a>' +
      '</h3>' +
      '<p class="text-sm text-gray-500 mb-3">' + article.authors.map(function (a) { return a.name; }).join(', ') + '</p>' +
      '<p class="text-sm text-gray-400 mb-4 line-clamp-2">' + (article.abstract || '').substring(0, 200) + '...</p>' +
      '<div class="flex items-center justify-between text-xs text-gray-400 pt-4 border-t border-gray-100">' +
        '<div class="flex gap-4">' +
          '<span title="Views"><svg class="inline w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>' + (article.views || 0).toLocaleString() + '</span>' +
          '<span title="Downloads"><svg class="inline w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>' + (article.downloads || 0).toLocaleString() + '</span>' +
        '</div>' +
        '<a href="article.html?id=' + article.id + '" class="text-teal-700 font-medium hover:text-teal-800">Read more →</a>' +
      '</div>';
    return card;
  }

  // Event listeners
  if (searchInput) {
    var debounceTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderArticles, 300);
    });
  }

  // Initialize
  renderFilters();
  renderArticles();
})();
