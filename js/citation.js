/**
 * Balkan Medical Journal — Citation Format & Copy Tools
 * APA, MLA, Vancouver, BibTeX formatters with clipboard copy
 */
(function () {
  'use strict';

  function normalizeAuthors(article) {
    if (article && Array.isArray(article.authors) && article.authors.length) {
      return article.authors;
    }
    return [{ name: 'Balkan Medical Journal' }];
  }

  window.CitationHelper = {
    /**
     * Generate APA citation
     */
    apa: function (article) {
      var authors = normalizeAuthors(article);
      var authorStr = authors.map(function (a) {
        var parts = a.name.split(' ');
        var last = parts.pop();
        var initials = parts.map(function (p) { return p.charAt(0) + '.'; }).join(' ');
        return last + ', ' + initials;
      }).join(', ');

      // Replace last comma with &
      var lastComma = authorStr.lastIndexOf(', ');
      if (authors.length > 1 && lastComma > -1) {
        authorStr = authorStr.substring(0, lastComma) + ', & ' + authorStr.substring(lastComma + 2);
      }

      var year = article.published ? new Date(article.published).getFullYear() : '';
      return authorStr + ' (' + year + '). ' + article.title + '. <em>Balkan Medical Journal</em>, <em>' + article.volume + '</em>(' + article.issue + '), ' + article.pages + '. https://doi.org/' + article.doi;
    },

    /**
     * Generate MLA citation
     */
    mla: function (article) {
      var authors = normalizeAuthors(article);
      var authorStr;
      if (authors.length === 1) {
        var parts = authors[0].name.split(' ');
        var last = parts.pop();
        authorStr = last + ', ' + parts.join(' ');
      } else if (authors.length === 2) {
        var p1 = authors[0].name.split(' ');
        var last1 = p1.pop();
        authorStr = last1 + ', ' + p1.join(' ') + ', and ' + authors[1].name;
      } else {
        var p0 = authors[0].name.split(' ');
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
      var authors = normalizeAuthors(article);
      var authorStr = authors.slice(0, 6).map(function (a) {
        var parts = a.name.split(' ');
        var last = parts.pop();
        var initials = parts.map(function (p) { return p.charAt(0); }).join('');
        return last + ' ' + initials;
      }).join(', ');
      if (authors.length > 6) authorStr += ', et al';

      var pubDate = article.published ? new Date(article.published) : null;
      var year = pubDate ? pubDate.getFullYear() : '';

      return authorStr + '. ' + article.title + '. Balkan Med J. ' + year + ';' + article.volume + '(' + article.issue + '):' + article.pages + '. doi: ' + article.doi + '.';
    },

    /**
     * Generate BibTeX citation
     */
    bibtex: function (article) {
      var authors = normalizeAuthors(article);
      var firstAuthor = authors[0].name.split(' ').pop().toLowerCase();
      var year = article.published ? new Date(article.published).getFullYear() : '';
      var key = firstAuthor + year;

      var authorStr = authors.map(function (a) { return a.name; }).join(' and ');

      return '@article{' + key + ',\n' +
        '  title     = {' + article.title + '},\n' +
        '  author    = {' + authorStr + '},\n' +
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
     * Generate RIS citation
     */
    ris: function (article) {
      var authors = normalizeAuthors(article);
      var year = article.published ? new Date(article.published).getFullYear() : '';
      var pages = article.pages ? article.pages.split('-') : ['', ''];
      var lines = [
        'TY  - JOUR',
        'T1  - ' + article.title
      ];
      authors.forEach(function (a) {
        var parts = a.name.split(' ');
        var last = parts.pop();
        var first = parts.join(' ');
        lines.push('AU  - ' + last + ', ' + first);
      });
      lines.push('DO  - ' + article.doi);
      lines.push('JO  - Balkan Medical Journal');
      lines.push('JA  - Balkan Med J');
      lines.push('VL  - ' + article.volume);
      lines.push('IS  - ' + article.issue);
      lines.push('SP  - ' + pages[0]);
      if (pages[1]) lines.push('EP  - ' + pages[1]);
      lines.push('PY  - ' + year);
      lines.push('SN  - 2146-3131');
      if (article.keywords) {
        article.keywords.forEach(function (k) {
          lines.push('KW  - ' + k);
        });
      }
      if (article.abstract) {
        lines.push('AB  - ' + article.abstract);
      }
      lines.push('ER  - ');
      return lines.join('\n');
    },

    /**
     * Generate EndNote (.enw) citation
     */
    endnote: function (article) {
      var authors = normalizeAuthors(article);
      var year = article.published ? new Date(article.published).getFullYear() : '';
      var lines = [
        '%0 Journal Article',
        '%T ' + article.title
      ];
      authors.forEach(function (a) {
        lines.push('%A ' + a.name);
      });
      lines.push('%D ' + year);
      lines.push('%J Balkan Medical Journal');
      lines.push('%V ' + article.volume);
      lines.push('%N ' + article.issue);
      lines.push('%P ' + article.pages);
      lines.push('%R ' + article.doi);
      lines.push('%@ 2146-3131');
      if (article.abstract) {
        lines.push('%X ' + article.abstract);
      }
      return lines.join('\n');
    },

    /**
     * Download text as a file
     */
    downloadFile: function (content, filename, mimeType) {
      var blob = new Blob([content], { type: mimeType || 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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
