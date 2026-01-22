(function () {
  const DEFAULT_LANG = 'en';
  let translations = {};
  let currentLang = DEFAULT_LANG;

  async function loadTranslations() {
    try {
      const res = await fetch('translate.json', { cache: 'no-store' });
      translations = await res.json();
    } catch (e) {
      console.error('Failed to load translations', e);
      translations = { en: {}, fr: {} };
    }
  }

  // Ensure common status keys exist with safe defaults for both languages
  function ensureStatusKeys() {
    const defaults = {
      en: {
        CREATED: 'Created',
        AWAITING_DOCUMENTS: 'Awaiting Documents',
        SUBMITTED: 'Submitted',
        PROCESSING: 'Processing',
        UNDER_REVIEW: 'Under Review',
        DRAFT_SENT: 'Awaiting Payment',
        PAYMENT_PROOF_UPLOADED: 'Proof Uploaded',
        PAYMENT_SUBMITTED: 'Proof Submitted',
        PAYMENT_CONFIRMED: 'Payment Confirmed',
        VALIDATED: 'Validated',
        ISSUED: 'Issued',
        REJECTED: 'Rejected',
        CANCELLED: 'Cancelled',
        OCR_PENDING: 'OCR Pending',
        UNKNOWN: 'Unknown',
        COMPLETED: 'Completed'
      },
      fr: {
        CREATED: 'Créé',
        AWAITING_DOCUMENTS: 'En attente de documents',
        SUBMITTED: 'Soumis',
        PROCESSING: 'En cours',
        UNDER_REVIEW: 'En cours de vérification',
        DRAFT_SENT: 'En attente de paiement',
        PAYMENT_PROOF_UPLOADED: 'Preuve téléchargée',
        PAYMENT_SUBMITTED: 'Preuve soumise',
        PAYMENT_CONFIRMED: 'Paiement confirmé',
        VALIDATED: 'Validé',
        ISSUED: 'Émis',
        REJECTED: 'Rejeté',
        CANCELLED: 'Annulé',
        OCR_PENDING: "OCR en attente",
        UNKNOWN: 'Inconnu',
        COMPLETED: 'Terminé'
      }
    };

    ['en', 'fr'].forEach(lang => {
      translations[lang] = translations[lang] || {};
      Object.keys(defaults[lang]).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(translations[lang], key)) {
          translations[lang][key] = defaults[lang][key];
        }
      });
    });
  }

  function translatePage() {
    const dict = translations[currentLang] || {};
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      if (dict[key]) {
        if (el.placeholder !== undefined && el.tagName === 'INPUT') {
          el.placeholder = dict[key];
        } else {
          el.textContent = dict[key];
        }
      }
    });

    // titles/placeholders via data-i18n-title / data-i18n-placeholder
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (translations[currentLang] && translations[currentLang][key]) el.title = translations[currentLang][key];
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (translations[currentLang] && translations[currentLang][key]) el.placeholder = translations[currentLang][key];
    });

    // alt text for images via data-i18n-alt
    document.querySelectorAll('[data-i18n-alt]').forEach(el => {
      const key = el.getAttribute('data-i18n-alt');
      if (translations[currentLang] && translations[currentLang][key]) {
        try { el.alt = translations[currentLang][key]; } catch (e) {}
      }
    });

    // set lang attribute on html
    document.documentElement.lang = currentLang;
  }

  function t(key, params) {
    const dict = translations[currentLang] || {};
    let s = dict && dict[key] ? dict[key] : key;
    if (params && typeof params === 'object') {
      Object.keys(params).forEach(k => {
        const re = new RegExp(`\\{${k}\\}`, 'g');
        s = s.replace(re, params[k]);
      });
    }
    return s;
  }

  function setupSwitcher() {
    const sel = document.getElementById('lang-select');
    if (!sel) return;
    sel.value = currentLang;
    sel.addEventListener('change', (e) => {
      currentLang = e.target.value;
      localStorage.setItem('lang', currentLang);
      translatePage();
    });
  }

  async function init() {
    await loadTranslations();
    // ensure common status keys are present even if translate.json is incomplete
    ensureStatusKeys();
    // default to English per request, prefer persisted choice
    currentLang = localStorage.getItem('lang') || 'en';
    translatePage();
    // create a floating switch only on index page when no inline switch exists
    const path = window.location.pathname.split('/').pop().toLowerCase();
    const isIndex = (path === '' || path === 'index.html');
    if (!document.getElementById('lang-select') && isIndex) {
      const container = document.createElement('div');
      container.id = 'lang-switcher-float';
      container.style.position = 'fixed';
      container.style.right = '12px';
      container.style.bottom = '12px';
      container.style.zIndex = '9999';
      container.style.background = 'rgba(255,255,255,0.95)';
      container.style.border = '1px solid #e5e7eb';
      container.style.padding = '6px';
      container.style.borderRadius = '6px';
      container.style.boxShadow = '0 6px 18px rgba(0,0,0,0.08)';
      container.innerHTML = '<label style="font-size:12px; color:#374151; margin-right:6px;">Lang</label>' +
        '<select id="lang-select" aria-label="Language switch" style="padding:6px; border-radius:4px;">' +
        '<option value="en">EN</option><option value="fr">FR</option></select>';
      document.body.appendChild(container);
    }
    setupSwitcher();
  }

  // expose for console
  window.i18n = {
    setLang: (l) => { currentLang = l; translatePage(); },
    getLang: () => currentLang,
    t
  };

  document.addEventListener('DOMContentLoaded', init);
})();
