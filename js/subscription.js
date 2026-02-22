/**
 * Balkan Medical Journal — Email Subscription + GDPR
 *
 * Default delivery:
 * - POST to configured endpoint (FormSubmit-compatible)
 * - Fallback to mailto flow when endpoint is unavailable (or local file mode)
 */
var FORM_ENDPOINT = 'https://formsubmit.co/ajax/info@balkanmedicaljournal.org';
var FALLBACK_RECIPIENT = 'info@balkanmedicaljournal.org';

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
  var isFileProtocol = String(window.location.protocol || '').toLowerCase() === 'file:';
  var mode = configuredEndpoint && !isFileProtocol ? 'endpoint' : 'mailto';
  var canSubmit = true;

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.removeAttribute('aria-disabled');
    submitBtn.classList.remove('opacity-70');
  }
  if (infoEl) {
    if (mode === 'mailto') {
      infoEl.textContent = 'Subscription opens your email client to send the request.';
      infoEl.classList.remove('hidden');
    } else {
      infoEl.classList.add('hidden');
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideMessages();

    if (!canSubmit) {
      showError('Email subscription is currently unavailable. Please try again later.');
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

    if (mode === 'mailto') {
      btn.textContent = originalText;
      btn.disabled = false;
      openMailtoFallback(email);
      if (successEl) {
        successEl.textContent = 'Your email client has been opened to complete subscription.';
        successEl.classList.remove('hidden');
      }
      return;
    }

    // Submit via fetch
    var formData = new FormData();
    formData.append('email', email);
    formData.append('_subject', 'New Journal Subscription');
    formData.append('_captcha', 'false');
    formData.append('_template', 'table');

    fetch(configuredEndpoint, {
      method: 'POST',
      body: formData,
      headers: { 'Accept': 'application/json' }
    })
    .then(function (response) {
      btn.textContent = originalText;
      btn.disabled = false;

      return response.json().then(function (data) {
        var ok = response.ok && !/false/i.test(String(data && data.success || ''));
        if (ok) {
          emailInput.value = '';
          if (gdprCheckbox) gdprCheckbox.checked = false;

          if (successEl) {
            successEl.textContent = 'Thank you for subscribing! You will receive updates about new issues and journal news.';
            successEl.classList.remove('hidden');
          }

          if (window.showToast) {
            window.showToast('Successfully subscribed!');
          }
          return;
        }

        var msg = (data && data.errors && data.errors.length > 0)
          ? data.errors.map(function (err) { return err.message; }).join(', ')
          : (data && data.message ? String(data.message) : 'Subscription request could not be processed.');

        // Some providers reject local file:// context; fall back to email client.
        if (/open this page through a web server/i.test(msg)) {
          openMailtoFallback(email);
          if (successEl) {
            successEl.textContent = 'Your email client has been opened to complete subscription.';
            successEl.classList.remove('hidden');
          }
          return;
        }

        showError(msg);
      });
    })
    .catch(function () {
      btn.textContent = originalText;
      btn.disabled = false;
      openMailtoFallback(email);
      if (successEl) {
        successEl.textContent = 'Your email client has been opened to complete subscription.';
        successEl.classList.remove('hidden');
      }
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
    if (infoEl) infoEl.classList.toggle('hidden', mode !== 'mailto');
  }

  function openMailtoFallback(email) {
    var address = FALLBACK_RECIPIENT;
    var subject = 'Journal Newsletter Subscription';
    var bodyLines = [
      'Please subscribe this email address to Balkan Medical Journal updates.',
      '',
      'Email: ' + String(email || '').trim(),
      'GDPR consent: Yes'
    ];
    var href = 'mailto:' + address +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(bodyLines.join('\n'));
    window.location.href = href;
  }
})();
