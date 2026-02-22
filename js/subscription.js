/**
 * Balkan Medical Journal — Email Subscription + GDPR
 *
 * FORMSPREE SETUP:
 * 1. Create a form at https://formspree.io
 * 2. Copy your form endpoint URL (e.g., https://formspree.io/f/xyzabcde)
 * 3. Replace the FORM_ENDPOINT value below with your URL
 * 4. The form will then send real submissions to your Formspree inbox
 *
 * While FORM_ENDPOINT is empty, the form shows an informational message.
 */
var FORM_ENDPOINT = ''; // <-- Paste your Formspree endpoint URL here

(function () {
  'use strict';

  var form = document.getElementById('subscription-form');
  if (!form) return;

  var emailInput = document.getElementById('sub-email');
  var gdprCheckbox = document.getElementById('gdpr-consent');
  var errorEl = document.getElementById('sub-error');
  var successEl = document.getElementById('sub-success');
  var infoEl = document.getElementById('sub-info');
  var submitBtn = form.querySelector('button[type="submit"]');
  var configuredEndpoint = String(
    (window.BMJ_CONFIG && window.BMJ_CONFIG.subscriptionEndpoint) ||
    form.getAttribute('data-endpoint') ||
    FORM_ENDPOINT ||
    ''
  ).trim();
  var canSubmit = !!configuredEndpoint;

  if (!canSubmit) {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-disabled', 'true');
      submitBtn.classList.add('opacity-70');
      submitBtn.classList.remove('hover:bg-teal-800');
    }
    if (infoEl) {
      infoEl.textContent = 'Email subscription is temporarily unavailable.';
      infoEl.classList.remove('hidden');
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideMessages();

    if (!canSubmit) {
      showError('Email subscription is temporarily unavailable. Please try again later.');
      return;
    }

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

    // Show loading state
    var btn = submitBtn || form.querySelector('button[type="submit"]');
    var originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;

    // Submit via fetch
    var formData = new FormData();
    formData.append('email', email);
    formData.append('_subject', 'New Journal Subscription');

    fetch(configuredEndpoint, {
      method: 'POST',
      body: formData,
      headers: { 'Accept': 'application/json' }
    })
    .then(function (response) {
      btn.textContent = originalText;
      btn.disabled = false;

      if (response.ok) {
        emailInput.value = '';
        if (gdprCheckbox) gdprCheckbox.checked = false;

        if (successEl) {
          successEl.textContent = 'Thank you for subscribing! You will receive updates about new issues and journal news.';
          successEl.classList.remove('hidden');
        }

        if (window.showToast) {
          window.showToast('Successfully subscribed!');
        }
      } else {
        return response.json().then(function (data) {
          var msg = (data && data.errors && data.errors.length > 0)
            ? data.errors.map(function (err) { return err.message; }).join(', ')
            : 'Subscription failed. Please try again later.';
          showError(msg);
        });
      }
    })
    .catch(function () {
      btn.textContent = originalText;
      btn.disabled = false;
      showError('Network error. Please check your connection and try again.');
    });
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
    if (infoEl && !canSubmit) infoEl.classList.remove('hidden');
  }
})();
