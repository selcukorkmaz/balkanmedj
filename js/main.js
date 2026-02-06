/**
 * Balkan Medical Journal — Shared Utilities
 * Mobile menu, scroll-to-top, nav active state, dropdowns
 */

(function () {
  'use strict';

  // ─── Mobile Menu ───────────────────────────────────────────
  const menuBtn = document.getElementById('mobile-menu-btn');
  const closeBtn = document.getElementById('mobile-menu-close');
  const mobileMenu = document.getElementById('mobile-menu');
  const menuOverlay = document.getElementById('mobile-menu-overlay');

  function openMenu() {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('mobile-menu-enter');
    mobileMenu.classList.add('mobile-menu-active');
    menuOverlay.classList.remove('hidden');
    menuBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    // Focus first link
    const firstLink = mobileMenu.querySelector('a, button');
    if (firstLink) firstLink.focus();
  }

  function closeMenu() {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('mobile-menu-active');
    mobileMenu.classList.add('mobile-menu-enter');
    menuOverlay.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    menuBtn.focus();
  }

  if (menuBtn) menuBtn.addEventListener('click', openMenu);
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);

  // Escape key closes menu
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && mobileMenu && mobileMenu.classList.contains('mobile-menu-active')) {
      closeMenu();
    }
  });

  // Focus trap inside mobile menu
  if (mobileMenu) {
    mobileMenu.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      const focusable = mobileMenu.querySelectorAll('a, button, input, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // ─── Scroll to Top ────────────────────────────────────────
  const scrollBtn = document.getElementById('scroll-top');
  if (scrollBtn) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 400) {
        scrollBtn.classList.add('visible');
      } else {
        scrollBtn.classList.remove('visible');
      }
    });
    scrollBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ─── Nav Active State ─────────────────────────────────────
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  var navLinks = document.querySelectorAll('[data-nav-page]');
  navLinks.forEach(function (link) {
    if (link.getAttribute('data-nav-page') === currentPage) {
      link.classList.add('text-teal-700', 'font-semibold');
      link.setAttribute('aria-current', 'page');
    }
  });

  // ─── Desktop Dropdown (keyboard accessible) ──────────────
  var dropdownTriggers = document.querySelectorAll('[data-dropdown-trigger]');
  dropdownTriggers.forEach(function (trigger) {
    var dropdown = trigger.closest('.group').querySelector('.nav-dropdown');
    if (!dropdown) return;

    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        dropdown.classList.add('show');
        var firstLink = dropdown.querySelector('a');
        if (firstLink) firstLink.focus();
      }
    });

    dropdown.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        dropdown.classList.remove('show');
        trigger.focus();
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
      if (!trigger.closest('.group').contains(e.target)) {
        dropdown.classList.remove('show');
      }
    });
  });

  // ─── Mobile dropdown toggles ──────────────────────────────
  var mobileDropdowns = document.querySelectorAll('[data-mobile-dropdown]');
  mobileDropdowns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.getAttribute('data-mobile-dropdown'));
      if (!target) return;
      var expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      target.classList.toggle('hidden');
      // Rotate chevron
      var chevron = btn.querySelector('.chevron-icon');
      if (chevron) chevron.classList.toggle('rotate-180');
    });
  });

  // ─── Toast Helper ─────────────────────────────────────────
  window.showToast = function (message, duration) {
    duration = duration || 3000;
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('show');
    });
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, duration);
  };

})();
