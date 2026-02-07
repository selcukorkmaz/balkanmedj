/**
 * Balkan Medical Journal — Contact Form Validation & Submission
 *
 * FORMSPREE SETUP:
 * 1. Create a form at https://formspree.io
 * 2. Copy your form endpoint URL (e.g., https://formspree.io/f/xyzabcde)
 * 3. Replace the CONTACT_FORM_ENDPOINT value below with your URL
 * 4. The form will then send real messages to your Formspree inbox
 *
 * While CONTACT_FORM_ENDPOINT is empty, the form shows an informational message.
 */
var CONTACT_FORM_ENDPOINT = ''; // <-- Paste your Formspree endpoint URL here

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

    // Check if endpoint is configured
    if (!CONTACT_FORM_ENDPOINT) {
      setTimeout(function () {
        btn.textContent = originalText;
        btn.disabled = false;
        showFieldError(fields.message, 'Contact form endpoint not configured. Please email info@balkanmedicaljournal.org directly.');
      }, 500);
      return;
    }

    // Submit via fetch
    var formData = new FormData();
    formData.append('name', fields.name.el.value.trim());
    formData.append('email', fields.email.el.value.trim());
    formData.append('_subject', 'Contact Form: ' + fields.subject.el.value.trim());
    formData.append('message', fields.message.el.value.trim());

    fetch(CONTACT_FORM_ENDPOINT, {
      method: 'POST',
      body: formData,
      headers: { 'Accept': 'application/json' }
    })
    .then(function (response) {
      btn.textContent = originalText;
      btn.disabled = false;

      if (response.ok) {
        form.reset();

        if (successMsg) {
          successMsg.classList.remove('hidden');
          successMsg.focus();
        }

        if (window.showToast) {
          window.showToast('Message sent successfully!');
        }
      } else {
        return response.json().then(function (data) {
          var msg = (data && data.errors && data.errors.length > 0)
            ? data.errors.map(function (err) { return err.message; }).join(', ')
            : 'Failed to send message. Please try again later.';
          showFieldError(fields.message, msg);
        });
      }
    })
    .catch(function () {
      btn.textContent = originalText;
      btn.disabled = false;
      showFieldError(fields.message, 'Network error. Please check your connection and try again.');
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
})();
