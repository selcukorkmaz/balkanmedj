/**
 * Balkan Medical Journal — Contact Form Validation & Submission
 *
 * Delivery:
 * - POST to configured endpoint (FormSubmit-compatible)
 * - Fallback to mailto flow when endpoint is unavailable (or local file mode)
 */
var CONTACT_FORM_ENDPOINT = 'https://formsubmit.co/ajax/info@balkanmedicaljournal.org';
var CONTACT_FORM_RECIPIENT = 'info@balkanmedicaljournal.org';

(function () {
  'use strict';

  var form = document.getElementById('contact-form');
  if (!form) return;

  var fields = {
    name: { el: form.querySelector('#contact-name'), errorEl: form.querySelector('#contact-name-error') },
    email: { el: form.querySelector('#contact-email'), errorEl: form.querySelector('#contact-email-error') },
    subject: { el: form.querySelector('#contact-subject'), errorEl: form.querySelector('#contact-subject-error') },
    message: { el: form.querySelector('#contact-message'), errorEl: form.querySelector('#contact-message-error') }
  };

  var successMsg = document.getElementById('contact-success');
  var configuredEndpoint = String(
    (window.BMJ_CONFIG && window.BMJ_CONFIG.contactEndpoint) ||
    form.getAttribute('data-endpoint') ||
    CONTACT_FORM_ENDPOINT ||
    ''
  ).trim();
  var isFileProtocol = String(window.location.protocol || '').toLowerCase() === 'file:';
  var mode = configuredEndpoint && !isFileProtocol ? 'endpoint' : 'mailto';

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();

    var valid = true;

    // Name
    if (!fields.name.el.value.trim()) {
      showFieldError(fields.name, 'Please enter your name.');
      valid = false;
    }

    // Email
    var email = fields.email.el.value.trim();
    if (!email) {
      showFieldError(fields.email, 'Please enter your email address.');
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFieldError(fields.email, 'Please enter a valid email address.');
      valid = false;
    }

    // Subject
    if (!fields.subject.el.value.trim()) {
      showFieldError(fields.subject, 'Please select a subject.');
      valid = false;
    }

    // Message
    if (!fields.message.el.value.trim()) {
      showFieldError(fields.message, 'Please enter your message.');
      valid = false;
    } else if (fields.message.el.value.trim().length < 10) {
      showFieldError(fields.message, 'Message must be at least 10 characters.');
      valid = false;
    }

    if (!valid) {
      // Focus first error field
      for (var key in fields) {
        if (!fields[key].errorEl.classList.contains('hidden')) {
          fields[key].el.focus();
          break;
        }
      }
      return;
    }

    // Show loading state
    var btn = form.querySelector('button[type="submit"]');
    var originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Sending...';
    btn.disabled = true;

    if (mode === 'mailto') {
      btn.textContent = originalText;
      btn.disabled = false;
      openMailtoFallback();
      if (successMsg) {
        successMsg.textContent = 'Your email client has been opened to complete your message.';
        successMsg.classList.remove('hidden');
        successMsg.focus();
      }
      return;
    }

    var subjectLabel = getSelectedSubjectLabel();

    var formData = new FormData();
    formData.append('name', fields.name.el.value.trim());
    formData.append('email', fields.email.el.value.trim());
    formData.append('subject', subjectLabel);
    formData.append('message', fields.message.el.value.trim());
    formData.append('_subject', 'Contact Form: ' + subjectLabel);
    formData.append('_captcha', 'false');
    formData.append('_template', 'table');
    formData.append('_honey', '');

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
          form.reset();

          if (successMsg) {
            successMsg.textContent = 'Your message has been sent successfully. We will get back to you within 2-3 business days.';
            successMsg.classList.remove('hidden');
            successMsg.focus();
          }

          if (window.showToast) {
            window.showToast('Message sent successfully!');
          }
          return;
        }

        var msg = (data && data.errors && data.errors.length > 0)
          ? data.errors.map(function (err) { return err.message; }).join(', ')
          : (data && data.message ? String(data.message) : 'Failed to send message. Please try again later.');

        // Local mirror context/provider issues: gracefully fall back to mail client.
        if (/open this page through a web server/i.test(msg)) {
          openMailtoFallback();
          if (successMsg) {
            successMsg.textContent = 'Your email client has been opened to complete your message.';
            successMsg.classList.remove('hidden');
            successMsg.focus();
          }
          return;
        }

        showFieldError(fields.message, msg);
      });
    })
    .catch(function () {
      btn.textContent = originalText;
      btn.disabled = false;
      openMailtoFallback();
      if (successMsg) {
        successMsg.textContent = 'Network issue detected. Your email client has been opened to complete your message.';
        successMsg.classList.remove('hidden');
        successMsg.focus();
      }
    });
  });

  // Real-time validation on blur
  for (var key in fields) {
    (function (field) {
      if (field.el) {
        field.el.addEventListener('blur', function () {
          if (field.el.value.trim() && field.errorEl) {
            field.errorEl.classList.add('hidden');
            field.el.classList.remove('border-red-500');
            field.el.classList.add('border-gray-300');
          }
        });
      }
    })(fields[key]);
  }

  function showFieldError(field, msg) {
    if (field.errorEl) {
      field.errorEl.textContent = msg;
      field.errorEl.classList.remove('hidden');
    }
    if (field.el) {
      field.el.classList.add('border-red-500');
      field.el.classList.remove('border-gray-300');
    }
  }

  function clearErrors() {
    for (var key in fields) {
      if (fields[key].errorEl) fields[key].errorEl.classList.add('hidden');
      if (fields[key].el) {
        fields[key].el.classList.remove('border-red-500');
        fields[key].el.classList.add('border-gray-300');
      }
    }
    if (successMsg) successMsg.classList.add('hidden');
  }

  function getSelectedSubjectLabel() {
    var subjectSelect = fields.subject && fields.subject.el;
    if (!subjectSelect) return '';
    var option = subjectSelect.options[subjectSelect.selectedIndex];
    var label = option ? String(option.textContent || '') : '';
    return label.replace(/\s+/g, ' ').trim() || String(subjectSelect.value || '').trim();
  }

  function openMailtoFallback() {
    var name = String(fields.name.el.value || '').trim();
    var email = String(fields.email.el.value || '').trim();
    var subjectLabel = getSelectedSubjectLabel();
    var message = String(fields.message.el.value || '').trim();
    var bodyLines = [
      'Name: ' + name,
      'Email: ' + email,
      'Subject: ' + subjectLabel,
      '',
      'Message:',
      message
    ];
    var href = 'mailto:' + CONTACT_FORM_RECIPIENT +
      '?subject=' + encodeURIComponent('Contact Form: ' + subjectLabel) +
      '&body=' + encodeURIComponent(bodyLines.join('\n'));
    window.location.href = href;
  }
})();
