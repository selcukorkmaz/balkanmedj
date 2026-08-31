/**
 * Public issue PDF presentation.
 * Cover PDF becomes the issue cover; Full PDF becomes the primary download.
 */
(function () {
  'use strict';

  var host = document.getElementById('issue-publication-files');
  var articles = document.getElementById('articles-container');
  if (!host || !articles) return;

  var params = new URLSearchParams(window.location.search);
  var homeIssue = (window.HOMEPAGE_DATA && window.HOMEPAGE_DATA.currentIssue) || {};
  var volume = params.get('volume') || String(homeIssue.volume || articles.getAttribute('data-volume') || '');
  var issue = params.get('issue') || String(homeIssue.issue || articles.getAttribute('data-issue') || '');
  if (!volume || !issue) return;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function findIssueRecord() {
    var groups = Array.isArray(window.ARCHIVE_ISSUES) ? window.ARCHIVE_ISSUES : [];
    for (var i = 0; i < groups.length; i += 1) {
      var issues = Array.isArray(groups[i].issues) ? groups[i].issues : [];
      for (var j = 0; j < issues.length; j += 1) {
        if (String(issues[j].volume) === String(volume) && String(issues[j].issue) === String(issue)) {
          return { year: groups[i].year, issue: issues[j] };
        }
      }
    }
    return null;
  }

  function fileUrl(value) {
    if (!value) return '';
    return typeof value === 'string' ? value : String(value.url || '');
  }

  function coverImageUrl(value) {
    if (!value || typeof value === 'string') return '';
    var url = String(value.imageUrl || '');
    if (!url) return '';
    var version = String(value.uploadedAt || '').replace(/[^0-9]/g, '');
    return version ? url + '?v=' + version : url;
  }

  function safePart(value) {
    return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  function candidateUrls(type) {
    var vol = safePart(volume);
    var iss = safePart(issue);
    return [
      'js/data/issue-pdfs/vol' + vol + '-' + iss + '-' + type + '.pdf',
      'js/data/pdfs/issue-vol' + vol + '-' + iss + '-' + type + '.pdf',
    ];
  }

  function existingUrl(urls) {
    var index = 0;
    function next() {
      if (index >= urls.length) return Promise.resolve('');
      var url = urls[index++];
      return fetch(url, { method: 'HEAD', cache: 'no-store' })
        .then(function (response) { return response.ok ? url : next(); })
        .catch(next);
    }
    return next();
  }

  function resolveFiles() {
    var record = findIssueRecord();
    var issueRecord = record && record.issue ? record.issue : {};
    var full = fileUrl(issueRecord.fullPdf);
    var cover = fileUrl(issueRecord.coverPdf);
    var coverImage = coverImageUrl(issueRecord.coverPdf);
    return Promise.all([
      full ? Promise.resolve(full) : existingUrl(candidateUrls('full')),
      cover ? Promise.resolve(cover) : existingUrl(candidateUrls('cover')),
      coverImage
        ? Promise.resolve(coverImage)
        : existingUrl(['images/issue-covers/vol' + safePart(volume) + '-' + safePart(issue) + '-cover.png']),
    ]).then(function (urls) {
      return { full: urls[0], cover: urls[1], coverImage: urls[2], year: record ? record.year : '' };
    });
  }

  function render(files) {
    if (!files.full && !files.coverImage) return;
    var issueLabel = 'Volume ' + escapeHtml(volume) + ', Issue ' + escapeHtml(issue);
    var year = files.year ? '<span>' + escapeHtml(files.year) + '</span>' : '';
    var cover = files.coverImage ? (
      '<div class="bmj-issue-cover">' +
        '<div class="bmj-issue-cover-frame">' +
          '<img src="' + escapeHtml(files.coverImage) + '" alt="' + issueLabel + ' cover" loading="lazy">' +
        '</div>' +
      '</div>'
    ) : '';
    var fullAction = files.full ? (
      '<a href="' + escapeHtml(files.full) + '" target="_blank" rel="noopener" class="bmj-issue-full-pdf">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h7l5 5v15H7z"/><path d="M14 2v6h6M10 13h6M10 17h6"/></svg>' +
        '<span><strong>Full Issue PDF</strong><small>Read or download the complete issue</small></span>' +
        '<span class="bmj-issue-action-arrow">Open PDF →</span>' +
      '</a>'
    ) : '';
    var coverAction = files.cover ? (
      '<a href="' + escapeHtml(files.cover) + '" target="_blank" rel="noopener" class="bmj-issue-secondary-link">Open Cover PDF</a>'
    ) : '';

    host.className = 'mt-8 bmj-issue-publication' + (files.coverImage ? ' has-cover' : '');
    host.innerHTML =
      cover +
      '<div class="bmj-issue-publication-copy">' +
        '<div class="bmj-issue-kicker">Issue Access</div>' +
        '<h2>' + issueLabel + '</h2>' +
        '<div class="bmj-issue-meta">' + year + '<span>Article-level PDFs remain available below</span></div>' +
        '<p>Browse individual articles on this page or access the complete published issue as a single PDF.</p>' +
        '<div class="bmj-issue-actions">' + fullAction + coverAction + '</div>' +
      '</div>';
  }

  resolveFiles().then(render);
})();
