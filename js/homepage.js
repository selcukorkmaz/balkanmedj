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
    if (names.length <= 6) return names.join(', ');
    return names.slice(0, 6).join(', ') + ' +' + (names.length - 6) + ' more';
  }

  function typeBadgeClass(articleType) {
    if (window.BMJArticleTypes && typeof window.BMJArticleTypes.getBadgeClass === 'function') {
      return window.BMJArticleTypes.getBadgeClass(articleType);
    }
    return 'bg-teal-100 text-teal-700';
  }

  function newsBadgeClass(category) {
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

    window.BMJLazyData.loadArticles = function () {
      if (Array.isArray(window.ARTICLES) && window.ARTICLES.length > 0) {
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

  function renderFeaturedArticles(data) {
    var container = document.getElementById('featured-articles');
    if (!container) return;

    var featured = getFeaturedArticles(data);
    if (!featured.length) {
      container.innerHTML =
        '<article class="bg-white rounded-xl border border-gray-200 p-6 md:col-span-2 lg:col-span-3">' +
          '<h3 class="text-lg font-semibold text-gray-900">Featured articles are being curated.</h3>' +
          '<p class="text-sm text-gray-500 mt-2 font-serif">Browse the full issue to access the latest publications.</p>' +
          '<a href="current-issue.html" class="inline-flex items-center text-teal-700 font-semibold mt-4 hover:text-teal-800">View Current Issue</a>' +
        '</article>';
      return;
    }

    container.innerHTML = featured.map(function (article) {
      var type = escapeHtml(stripTags(article.type || 'Article'));
      var title = escapeHtml(stripTags(article.title || 'Untitled'));
      var authors = escapeHtml(formatAuthors(article.authors));
      var volume = escapeHtml(String(article.volume || ''));
      var issue = escapeHtml(String(article.issue || ''));
      var views = Number(article.views || 0).toLocaleString('en-US');
      var downloads = Number(article.downloads || 0).toLocaleString('en-US');
      var citations = Number(article.citations || 0).toLocaleString('en-US');
      var badge = typeBadgeClass(article.type);

      return '<article class="article-card bg-white rounded-xl border border-gray-200 p-6 flex flex-col">' +
        '<div class="flex items-center gap-2 mb-3">' +
          '<span class="badge ' + badge + '">' + type + '</span>' +
          '<span class="text-xs text-gray-400">Vol. ' + volume + ', Issue ' + issue + '</span>' +
        '</div>' +
        '<h3 class="text-lg font-semibold text-gray-900 mb-3 leading-snug flex-1">' +
          '<a href="article.html?id=' + encodeURIComponent(String(article.id || '')) + '" class="hover:text-teal-700 transition-colors">' + title + '</a>' +
        '</h3>' +
        (authors ? '<p class="text-sm text-gray-500 mb-4">' + authors + '</p>' : '') +
        '<div class="flex items-center gap-4 text-xs text-gray-400 mt-auto pt-4 border-t border-gray-100">' +
          '<span title="Views">' + views + '</span>' +
          '<span title="Downloads">' + downloads + '</span>' +
          '<span title="Citations">' + citations + '</span>' +
        '</div>' +
      '</article>';
    }).join('');
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
    renderFeaturedArticles(data);
    renderImageCorner(data);
    renderNews();
    renderMetricsProvenance(data);
  }

  init();
})();
