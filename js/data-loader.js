/**
 * Balkan Medical Journal — Data Loader
 * Fetch-based loader for per-volume JSON data.
 * Falls back to window.ARTICLES if available (for backward compatibility).
 */
(function () {
  'use strict';

  var cache = {};
  var fullTextCache = {};

  window.DataLoader = {
    /**
     * Load a specific issue's articles.
     * @param {number} volume
     * @param {number} issue
     * @returns {Promise<Array>}
     */
    loadIssue: function (volume, issue) {
      var key = 'vol' + volume + '-' + issue;
      if (cache[key]) return Promise.resolve(cache[key]);

      var url = 'js/data/volumes/' + key + '.json';
      return fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('Issue not found: ' + key);
          return res.json();
        })
        .then(function (data) {
          cache[key] = data;
          return data;
        });
    },

    /**
     * Load a single article by ID.
     * First checks window.ARTICLES (index), then fetches per-volume data.
     * @param {number} id
     * @returns {Promise<Object|null>}
     */
    loadArticle: function (id) {
      // Check if already loaded in any cache
      for (var key in cache) {
        var found = cache[key].find(function (a) { return a.id === id; });
        if (found) return Promise.resolve(found);
      }

      // Check window.ARTICLES index
      if (window.ARTICLES) {
        var indexed = window.ARTICLES.find(function (a) { return a.id === id; });
        if (indexed) {
          // If the index has full data (abstract present), use it
          if (indexed.abstract) return Promise.resolve(indexed);

          // Otherwise fetch the full volume data
          return window.DataLoader.loadIssue(indexed.volume, indexed.issue)
            .then(function (articles) {
              return articles.find(function (a) { return a.id === id; }) || indexed;
            });
        }
      }

      return Promise.resolve(null);
    },

    /**
     * Load full text HTML for an article.
     * @param {number} id
     * @returns {Promise<string|null>}
     */
    loadFullText: function (id) {
      if (fullTextCache[id]) return Promise.resolve(fullTextCache[id]);

      // Check if already loaded via <script> tag (file:// protocol path)
      if (window._articleFullText && window._articleFullText[id]) {
        fullTextCache[id] = window._articleFullText[id];
        return Promise.resolve(fullTextCache[id]);
      }

      // On file:// protocol, fetch/XHR won't work — use <script> injection
      if (window.location.protocol === 'file:') {
        return new Promise(function (resolve) {
          var script = document.createElement('script');
          script.src = 'js/data/articles/' + id + '.js';
          script.onload = function () {
            var html = window._articleFullText && window._articleFullText[id];
            if (html) {
              fullTextCache[id] = html;
              resolve(html);
            } else {
              resolve(null);
            }
          };
          script.onerror = function () { resolve(null); };
          document.head.appendChild(script);
        });
      }

      // HTTP/HTTPS: use fetch
      var url = 'js/data/articles/' + id + '.html';
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res.text();
      }).then(function (html) {
        if (html && html.indexOf('<section') !== -1) {
          fullTextCache[id] = html;
          return html;
        }
        return null;
      });
    },

    /**
     * Load all articles (combines all cached + window.ARTICLES).
     * @returns {Promise<Array>}
     */
    loadAll: function () {
      if (window.ARTICLES) return Promise.resolve(window.ARTICLES);

      // Attempt to load known volumes
      return Promise.all([
        window.DataLoader.loadIssue(43, 2).catch(function () { return []; }),
        window.DataLoader.loadIssue(43, 1).catch(function () { return []; }),
        window.DataLoader.loadIssue(42, 6).catch(function () { return []; })
      ]).then(function (results) {
        var all = [];
        results.forEach(function (arr) {
          all = all.concat(arr);
        });
        return all;
      });
    }
  };
})();
