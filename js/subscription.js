/**
 * Balkan Medical Journal — Email Subscription + GDPR
 */
(function () {
  'use strict';

  var form = document.getElementById('subscription-form');
  if (!form) return;

  var emailInput = document.getElementById('sub-email');
  var gdprCheckbox = document.getElementById('gdpr-consent');
  var errorEl = document.getElementById('sub-error');
  var successEl = document.getElementById('sub-success');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideMessages();

    var email = emailInput.value.trim();

    // Validate email
    if (!email) {
      showError('Please enter your email address.');
      emailInput.focus();
      return;
    }

    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showError('Please enter a valid email address.');
      emailInput.focus();
      return;
    }

    // Validate GDPR consent
    if (gdprCheckbox && !gdprCheckbox.checked) {
      showError('Please agree to receive email notifications to subscribe.');
      gdprCheckbox.focus();
      return;
    }

    // Simulate subscription (no backend)
    var btn = form.querySelector('button[type="submit"]');
    var originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;

    setTimeout(function () {
      btn.textContent = originalText;
      btn.disabled = false;
      emailInput.value = '';
      if (gdprCheckbox) gdprCheckbox.checked = false;

      if (successEl) {
        successEl.textContent = 'Thank you for subscribing! You will receive updates about new issues and journal news.';
        successEl.classList.remove('hidden');
      }

      if (window.showToast) {
        window.showToast('Successfully subscribed!');
      }
    }, 1200);
  });

  function showError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  }

  function hideMessages() {
    if (errorEl) errorEl.classList.add('hidden');
    if (successEl) successEl.classList.add('hidden');
  }
})();
