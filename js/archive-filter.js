/**
 * Balkan Medical Journal — Archive Year/Issue Filtering
 */
(function () {
  'use strict';

  var yearGrid = document.getElementById('archive-year-grid');
  var issuePanel = document.getElementById('archive-issues');
  var issueTitle = document.getElementById('archive-issue-title');
  var issueMeta = document.getElementById('archive-issue-meta');
  var yearCount = document.getElementById('archive-year-count');
  var yearHint = document.getElementById('archive-year-hint');
  var yearToggle = document.getElementById('archive-year-toggle');
  var yearToggleText = document.getElementById('archive-year-toggle-text');
  var yearToggleIcon = document.getElementById('archive-year-toggle-icon');
  if (!yearGrid || !window.ARCHIVE_ISSUES) return;

  var data = window.ARCHIVE_ISSUES;
  var selectedYear = null;
  var showAllYears = false;
  var recentYearThreshold = 2021;
  var recentYearCount = data.filter(function (entry) {
    var match = String(entry.year || '').match(/^(\d{4})/);
    if (!match) return false;
    return Number(match[1]) >= recentYearThreshold;
  }).length;
  if (recentYearCount <= 0) recentYearCount = Math.min(8, data.length);

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildIssueUrl(entry, issue) {
    var params = new URLSearchParams();
    params.set('year', String(entry.year));
    params.set('label', issue.label || '');

    if (issue.sourceId) params.set('sourceId', String(issue.sourceId));
    if (issue.volume !== null && issue.volume !== undefined) params.set('volume', String(issue.volume));
    if (issue.issue !== null && issue.issue !== undefined) params.set('issue', String(issue.issue));

    return 'current-issue.html?' + params.toString();
  }

  function resolveIssueArticleCount(issue) {
    var fallbackCount = typeof issue.articleCount === 'number' ? issue.articleCount : null;
    if (!Array.isArray(window.ARTICLES)) return fallbackCount;
    if (issue.volume === null || issue.volume === undefined || issue.issue === null || issue.issue === undefined) return fallbackCount;

    var matches = window.ARTICLES.filter(function (article) {
      return String(article.volume) === String(issue.volume) && String(article.issue) === String(issue.issue);
    });
    if (!matches.length) return fallbackCount;

    var nonCoverCount = matches.filter(function (article) {
      return String(article.type || '').trim().toLowerCase() !== 'cover page';
    }).length;
    return nonCoverCount;
  }

  // Render year grid
  function renderYears() {
    var visibleEntries = showAllYears ? data : data.slice(0, recentYearCount);
    yearGrid.innerHTML = '';
    visibleEntries.forEach(function (entry) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.title = String(entry.year) + ' (' + entry.issues.length + ' issue' + (entry.issues.length !== 1 ? 's' : '') + ')';
      btn.className = String(entry.year) === String(selectedYear)
        ? 'group px-4 py-2.5 sm:py-3 rounded-xl text-left border border-teal-700 bg-gradient-to-br from-teal-700 to-teal-800 text-white shadow-sm ring-2 ring-teal-100 transition-all'
        : 'group px-4 py-2.5 sm:py-3 rounded-xl text-left border border-gray-200 bg-white text-gray-700 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-200 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 transition-all';
      btn.setAttribute('aria-pressed', String(String(entry.year) === String(selectedYear)));
      btn.innerHTML =
        '<span class="block text-sm font-semibold leading-tight">' + escapeHtml(entry.year) + '</span>' +
        '<span class="block mt-1 text-[11px] leading-tight ' + (String(entry.year) === String(selectedYear) ? 'text-teal-100' : 'text-gray-400 group-hover:text-teal-600') + '">' +
          entry.issues.length + ' issue' + (entry.issues.length !== 1 ? 's' : '') +
        '</span>';
      btn.addEventListener('click', function () {
        selectedYear = entry.year;
        renderYears();
        renderIssues(entry);
      });
      yearGrid.appendChild(btn);
    });

    if (yearCount) {
      yearCount.textContent = showAllYears
        ? (data.length + ' year groups')
        : ('Showing ' + visibleEntries.length + ' of ' + data.length + ' year groups');
    }
    if (yearHint) {
      yearHint.textContent = showAllYears ? 'Complete archive visible' : ('Recent years: ' + data[0].year + '-' + recentYearThreshold);
    }

    if (yearToggle) {
      var hasMoreThanRecent = data.length > recentYearCount;
      yearToggle.classList.toggle('hidden', !hasMoreThanRecent);
      yearToggle.setAttribute('aria-expanded', String(showAllYears));
      if (yearToggleText) {
        yearToggleText.textContent = showAllYears ? 'Show recent years' : 'View older years';
      }
      if (yearToggleIcon) {
        yearToggleIcon.classList.toggle('rotate-180', showAllYears);
      }
    }
  }

  // Render issues for selected year
  function renderIssues(entry) {
    if (!issuePanel) return;
    issuePanel.classList.remove('hidden');

    if (issueTitle) {
      issueTitle.textContent = String(entry.year);
    }
    if (issueMeta) {
      issueMeta.textContent = entry.issues.length + ' issue' + (entry.issues.length !== 1 ? 's' : '') + ' available in this year group';
    }

    var issueList = document.getElementById('archive-issue-list');
    if (!issueList) return;
    issueList.innerHTML = '';

    entry.issues.forEach(function (issue) {
      var card = document.createElement('a');
      card.href = buildIssueUrl(entry, issue);
      card.className = 'article-card block bg-white rounded-xl border border-gray-200 p-6 hover:border-teal-200 hover:shadow-sm transition-all';
      var displayCount = resolveIssueArticleCount(issue);
      card.innerHTML =
        '<div class="flex items-center justify-between mb-2">' +
          '<h3 class="font-semibold text-gray-900">' + escapeHtml(issue.label || 'Archive Issue') + '</h3>' +
        '</div>' +
        '<div class="flex items-center justify-between text-sm">' +
          '<span class="text-gray-400">' + (typeof displayCount === 'number' ? displayCount + ' articles' : 'Archive issue') + '</span>' +
          '<span class="text-teal-700 font-medium">Browse →</span>' +
        '</div>';
      issueList.appendChild(card);
    });
  }

  // Initialize
  if (yearToggle) {
    yearToggle.addEventListener('click', function () {
      showAllYears = !showAllYears;
      // If collapsing while an older year is selected, reset to latest visible year.
      if (!showAllYears && data.slice(0, recentYearCount).every(function (entry) { return String(entry.year) !== String(selectedYear); })) {
        selectedYear = data[0] ? data[0].year : null;
        if (data[0]) renderIssues(data[0]);
      }
      renderYears();
    });
  }

  renderYears();

  // Auto-select latest year
  if (data.length > 0) {
    selectedYear = data[0].year;
    renderYears();
    renderIssues(data[0]);
  }
})();
