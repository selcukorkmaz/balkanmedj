/**
 * Balkan Medical Journal — Citation Format & Copy Tools
 * APA, MLA, Vancouver, BibTeX formatters with clipboard copy
 */
(function () {
  'use strict';

  window.CitationHelper = {
    /**
     * Generate APA citation
     */
    apa: function (article) {
      var authorStr = article.authors.map(function (a) {
        var parts = a.name.split(' ');
        var last = parts.pop();
        var initials = parts.map(function (p) { return p.charAt(0) + '.'; }).join(' ');
        return last + ', ' + initials;
      }).join(', ');

      // Replace last comma with &
      var lastComma = authorStr.lastIndexOf(', ');
      if (article.authors.length > 1 && lastComma > -1) {
        authorStr = authorStr.substring(0, lastComma) + ', & ' + authorStr.substring(lastComma + 2);
      }

      var year = article.published ? new Date(article.published).getFullYear() : '';
      return authorStr + ' (' + year + '). ' + article.title + '. <em>Balkan Medical Journal</em>, <em>' + article.volume + '</em>(' + article.issue + '), ' + article.pages + '. https://doi.org/' + article.doi;
    },

    /**
     * Generate MLA citation
     */
    mla: function (article) {
      var authorStr;
      if (article.authors.length === 1) {
        var parts = article.authors[0].name.split(' ');
        var last = parts.pop();
        authorStr = last + ', ' + parts.join(' ');
      } else if (article.authors.length === 2) {
        var p1 = article.authors[0].name.split(' ');
        var last1 = p1.pop();
        authorStr = last1 + ', ' + p1.join(' ') + ', and ' + article.authors[1].name;
      } else {
        var p0 = article.authors[0].name.split(' ');
        var last0 = p0.pop();
        authorStr = last0 + ', ' + p0.join(' ') + ', et al.';
      }

      var year = article.published ? new Date(article.published).getFullYear() : '';
      return authorStr + ' "' + article.title + '." <em>Balkan Medical Journal</em>, vol. ' + article.volume + ', no. ' + article.issue + ', ' + year + ', pp. ' + article.pages + '. DOI: ' + article.doi + '.';
    },

    /**
     * Generate Vancouver citation
     */
    vancouver: function (article) {
      var authorStr = article.authors.slice(0, 6).map(function (a) {
        var parts = a.name.split(' ');
        var last = parts.pop();
        var initials = parts.map(function (p) { return p.charAt(0); }).join('');
        return last + ' ' + initials;
      }).join(', ');
      if (article.authors.length > 6) authorStr += ', et al';

      var pubDate = article.published ? new Date(article.published) : null;
      var year = pubDate ? pubDate.getFullYear() : '';

      return authorStr + '. ' + article.title + '. Balkan Med J. ' + year + ';' + article.volume + '(' + article.issue + '):' + article.pages + '. doi: ' + article.doi + '.';
    },

    /**
     * Generate BibTeX citation
     */
    bibtex: function (article) {
      var firstAuthor = article.authors[0].name.split(' ').pop().toLowerCase();
      var year = article.published ? new Date(article.published).getFullYear() : '';
      var key = firstAuthor + year;

      var authors = article.authors.map(function (a) { return a.name; }).join(' and ');

      return '@article{' + key + ',\n' +
        '  title     = {' + article.title + '},\n' +
        '  author    = {' + authors + '},\n' +
        '  journal   = {Balkan Medical Journal},\n' +
        '  year      = {' + year + '},\n' +
        '  volume    = {' + article.volume + '},\n' +
        '  number    = {' + article.issue + '},\n' +
        '  pages     = {' + article.pages + '},\n' +
        '  doi       = {' + article.doi + '},\n' +
        '  issn      = {2146-3131}\n' +
        '}';
    },

    /**
     * Copy text to clipboard
     */
    copyToClipboard: function (text) {
      // Strip HTML tags for plain text copy
      var plain = text.replace(/<[^>]+>/g, '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(plain).then(function () {
          window.showToast('Citation copied to clipboard');
        }).catch(function () {
          fallbackCopy(plain);
        });
      } else {
        fallbackCopy(plain);
      }
    }
  };

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      window.showToast('Citation copied to clipboard');
    } catch (e) {
      window.showToast('Failed to copy. Please select and copy manually.');
    }
    document.body.removeChild(ta);
  }
})();
