/**
 * Balkan Medical Journal — News Category Filter + Load More
 */
(function () {
  'use strict';

  var container = document.getElementById('news-container');
  var filterContainer = document.getElementById('news-filters');
  var loadMoreBtn = document.getElementById('news-load-more');
  var DEFAULT_THUMBNAIL = 'https://balkanmedicaljournal.org/style/images/trial-image-1.png';
  if (!container || !window.NEWS) return;

  function parseNewsDate(value) {
    if (!value) return NaN;
    var ts = Date.parse(value);
    return Number.isNaN(ts) ? NaN : ts;
  }

  function normalizeCategory(category) {
    return category || 'News';
  }

  function escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
  }

  function normalizeThumbnail(url) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.indexOf('//') === 0) return 'https:' + url;
    return 'https://balkanmedicaljournal.org/' + String(url).replace(/^\/+/, '');
  }

  function getThumbnail(item) {
    var image = item && item.image ? String(item.image).trim() : '';
    if (image && image !== 'images/placeholder-news.jpg') {
      return normalizeThumbnail(image);
    }

    var content = item && item.content ? String(item.content) : '';
    var match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? normalizeThumbnail(match[1]) : DEFAULT_THUMBNAIL;
  }

  var news = window.NEWS.slice().sort(function (a, b) {
    var dateA = parseNewsDate(a.date);
    var dateB = parseNewsDate(b.date);
    var hasA = !Number.isNaN(dateA);
    var hasB = !Number.isNaN(dateB);

    if (hasA && hasB) return dateB - dateA;
    if (hasA) return -1;
    if (hasB) return 1;
    return (b.id || 0) - (a.id || 0);
  });

  var activeCategory = 'All';
  var visibleCount = 6;

  // Get unique categories
  var categories = ['All'];
  news.forEach(function (n) {
    var category = normalizeCategory(n.category);
    if (categories.indexOf(category) === -1) categories.push(category);
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
    return news.filter(function (n) {
      return normalizeCategory(n.category) === activeCategory;
    });
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
      var displayCategory = normalizeCategory(item.category);
      var catColor = displayCategory === 'News' ? 'bg-teal-100 text-teal-700' :
                     displayCategory === 'Announcement' ? 'bg-blue-100 text-blue-700' :
                     displayCategory === 'Award' ? 'bg-amber-100 text-amber-700' :
                     displayCategory === 'Indexing' ? 'bg-green-100 text-green-700' :
                     displayCategory === 'Event' ? 'bg-purple-100 text-purple-700' :
                     'bg-gray-100 text-gray-700';
      var parsedDate = parseNewsDate(item.date);
      var dateHtml = Number.isNaN(parsedDate)
        ? ''
        : '<time class="text-xs text-gray-400" datetime="' + item.date + '">' + new Date(parsedDate).toLocaleDateString('en-US', {year:'numeric', month:'long', day:'numeric'}) + '</time>';
      var thumbnail = getThumbnail(item);
      var mediaHtml = '<img src="' + escapeAttr(thumbnail) + '" alt="' + escapeAttr(item.title) + '" class="news-thumb-image" loading="lazy" onerror="this.onerror=null;this.src=\'' + escapeAttr(DEFAULT_THUMBNAIL) + '\';">';

      var card = document.createElement('article');
      card.className = 'article-card bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col';
      card.innerHTML =
        '<div class="news-thumb">' +
          '<div class="news-thumb-media">' + mediaHtml + '</div>' +
        '</div>' +
        '<div class="p-6 flex flex-col flex-1">' +
          '<div class="flex items-center gap-2 mb-3">' +
            '<span class="badge ' + catColor + '">' + displayCategory + '</span>' +
            dateHtml +
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
