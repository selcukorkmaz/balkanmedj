/**
 * Balkan Medical Journal — Archive Year/Issue Filtering
 */
(function () {
  'use strict';

  var yearGrid = document.getElementById('archive-year-grid');
  var issuePanel = document.getElementById('archive-issues');
  var issueTitle = document.getElementById('archive-issue-title');
  if (!yearGrid || !window.ARCHIVE_ISSUES) return;

  var data = window.ARCHIVE_ISSUES;
  var selectedYear = null;

  // Render year grid
  function renderYears() {
    yearGrid.innerHTML = '';
    data.forEach(function (entry) {
      var btn = document.createElement('button');
      btn.textContent = entry.year;
      btn.className = entry.year === selectedYear
        ? 'px-4 py-3 rounded-xl text-sm font-semibold bg-teal-700 text-white transition-colors shadow-sm'
        : 'px-4 py-3 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-teal-50 hover:text-teal-700 hover:border-teal-200 transition-colors';
      btn.setAttribute('aria-pressed', String(entry.year === selectedYear));
      btn.addEventListener('click', function () {
        selectedYear = entry.year;
        renderYears();
        renderIssues(entry);
      });
      yearGrid.appendChild(btn);
    });
  }

  // Render issues for selected year
  function renderIssues(entry) {
    if (!issuePanel) return;
    issuePanel.classList.remove('hidden');

    if (issueTitle) {
      issueTitle.textContent = entry.year + ' — Volume ' + entry.volume;
    }

    var issueList = document.getElementById('archive-issue-list');
    if (!issueList) return;
    issueList.innerHTML = '';

    entry.issues.forEach(function (issue) {
      var card = document.createElement('a');
      card.href = 'current-issue.html?volume=' + entry.volume + '&issue=' + issue.number;
      card.className = 'article-card block bg-white rounded-xl border border-gray-200 p-6 hover:border-teal-200 transition-colors';
      card.innerHTML =
        '<div class="flex items-center justify-between mb-2">' +
          '<h3 class="font-semibold text-gray-900">Issue ' + issue.number + '</h3>' +
          (issue.current ? '<span class="badge bg-green-100 text-green-700">Current</span>' : '') +
        '</div>' +
        '<p class="text-sm text-gray-500 mb-3">' + issue.title + '</p>' +
        '<div class="flex items-center justify-between text-sm">' +
          '<span class="text-gray-400">' + issue.articleCount + ' articles</span>' +
          '<span class="text-teal-700 font-medium">Browse →</span>' +
        '</div>';
      issueList.appendChild(card);
    });
  }

  // Initialize
  renderYears();

  // Auto-select latest year
  if (data.length > 0) {
    selectedYear = data[0].year;
    renderYears();
    renderIssues(data[0]);
  }
})();
