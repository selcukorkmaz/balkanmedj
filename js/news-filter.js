/**
 * Balkan Medical Journal — News Category Filter + Load More
 */
(function () {
  'use strict';

  var container = document.getElementById('news-container');
  var filterContainer = document.getElementById('news-filters');
  var loadMoreBtn = document.getElementById('news-load-more');
  if (!container || !window.NEWS) return;

  var news = window.NEWS.slice().sort(function (a, b) {
    return new Date(b.date) - new Date(a.date);
  });

  var activeCategory = 'All';
  var visibleCount = 6;

  // Get unique categories
  var categories = ['All'];
  news.forEach(function (n) {
    if (categories.indexOf(n.category) === -1) categories.push(n.category);
  });

  function renderFilters() {
    if (!filterContainer) return;
    filterContainer.innerHTML = '';
    categories.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.textContent = cat;
      btn.className = cat === activeCategory
        ? 'px-4 py-2 rounded-full text-sm font-semibold bg-teal-700 text-white transition-colors'
        : 'px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors';
      btn.setAttribute('aria-pressed', String(cat === activeCategory));
      btn.addEventListener('click', function () {
        activeCategory = cat;
        visibleCount = 6;
        renderFilters();
        renderNews();
      });
      filterContainer.appendChild(btn);
    });
  }

  function getFiltered() {
    if (activeCategory === 'All') return news;
    return news.filter(function (n) { return n.category === activeCategory; });
  }

  function renderNews() {
    var filtered = getFiltered();
    var visible = filtered.slice(0, visibleCount);
    container.innerHTML = '';

    if (visible.length === 0) {
      container.innerHTML = '<div class="col-span-full text-center py-12"><p class="text-gray-400 text-lg">No news articles found.</p></div>';
      if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
      return;
    }

    visible.forEach(function (item) {
      var catColor = item.category === 'Announcement' ? 'bg-blue-100 text-blue-700' :
                     item.category === 'Award' ? 'bg-amber-100 text-amber-700' :
                     item.category === 'Indexing' ? 'bg-green-100 text-green-700' :
                     item.category === 'Event' ? 'bg-purple-100 text-purple-700' :
                     'bg-gray-100 text-gray-700';

      var card = document.createElement('article');
      card.className = 'article-card bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col';
      card.innerHTML =
        '<div class="aspect-video bg-gradient-to-br from-teal-50 to-gray-100 flex items-center justify-center">' +
          '<svg class="w-12 h-12 text-teal-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/></svg>' +
        '</div>' +
        '<div class="p-6 flex flex-col flex-1">' +
          '<div class="flex items-center gap-2 mb-3">' +
            '<span class="badge ' + catColor + '">' + item.category + '</span>' +
            '<time class="text-xs text-gray-400" datetime="' + item.date + '">' + new Date(item.date).toLocaleDateString('en-US', {year:'numeric', month:'long', day:'numeric'}) + '</time>' +
          '</div>' +
          '<h3 class="text-lg font-semibold text-gray-900 mb-3 flex-1">' +
            '<a href="news-article.html?id=' + item.id + '" class="hover:text-teal-700 transition-colors">' + item.title + '</a>' +
          '</h3>' +
          '<p class="text-sm text-gray-500 leading-relaxed">' + item.excerpt + '</p>' +
        '</div>';
      container.appendChild(card);
    });

    // Load more button
    if (loadMoreBtn) {
      if (filtered.length > visibleCount) {
        loadMoreBtn.classList.remove('hidden');
      } else {
        loadMoreBtn.classList.add('hidden');
      }
    }
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function () {
      visibleCount += 6;
      renderNews();
    });
  }

  renderFilters();
  renderNews();
})();
