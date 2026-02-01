const STORAGE_KEY = 'logirdc_requests_v1';
let requests = [];
let selectedBL = null;
let currentMode = 'DRAFT'; // Logic tracker: 'DRAFT' or 'FINAL'

// Small UI helpers: toast notifications and browser Notification permission
function ensureNotificationPermission() {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => null);
    }
  } catch (e) {}
}

function showAdminToast(message, timeout = 4500) {
  try {
    let container = document.getElementById('admin-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'admin-toast-container';
      container.style.position = 'fixed';
      container.style.top = '16px';
      container.style.right = '16px';
      container.style.zIndex = '20000';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';
      document.body.appendChild(container);
    }

    const t = document.createElement('div');
    t.className = 'admin-toast';
    t.style.background = '#FFF7ED';
    t.style.border = '1px solid rgba(245,158,11,0.12)';
    t.style.borderLeft = '4px solid #f59e0b';
    t.style.padding = '10px 12px';
    t.style.borderRadius = '8px';
    t.style.boxShadow = '0 6px 18px rgba(0,0,0,0.08)';
    t.style.fontSize = '13px';
    t.style.color = '#f59e0b';
    t.innerText = message;
    container.appendChild(t);

    setTimeout(() => {
      t.style.transition = 'opacity 240ms ease, transform 240ms ease';
      t.style.opacity = '0';
      t.style.transform = 'translateY(-6px)';
      setTimeout(() => t.remove(), 300);
    }, timeout);
  } catch (e) {
    // ignore UI toast errors
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load requests from backend (fallback to localStorage)
  await loadAdminRequests();

  // Fetch current user and render header info (name, role, avatar)
  fetchAndRenderUser();

  // Request browser notification permission (non-blocking)
  ensureNotificationPermission();

  // Submit button logic
  const submitBtn = document.getElementById('admin-submit-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', handleAdminSubmit);
  }

  // Visual feedback for file upload button
  const fileInput = document.getElementById('admin-file-draft');
  if (fileInput) {
    fileInput.addEventListener('change', function () {
      const label = document.getElementById('label-draft');
      if (this.files.length > 0) {
        label.innerHTML = `<strong>${this.files[0].name}</strong>`;
        this.parentElement.style.background = "#DCFCE7"; // Success light green
        this.parentElement.style.borderColor = "#16A34A";
        const icon = this.parentElement.querySelector('i');
        if (icon) icon.className = "fas fa-check-circle";
      }
    });
  }

  // AD file input visual feedback (if present)
  const adFileInput = document.getElementById('admin-file-ad');
  if (adFileInput) {
    adFileInput.addEventListener('change', function () {
      const label = document.getElementById('label-ad');
      if (this.files.length > 0) {
        if (label) label.innerHTML = `<strong>${this.files[0].name}</strong>`;
        if (this.parentElement) {
          this.parentElement.style.background = "#DCFCE7";
          this.parentElement.style.borderColor = "#16A34A";
          const icon = this.parentElement.querySelector('i');
          if (icon) icon.className = "fas fa-check-circle";
        }
      }
    });
  }

  // Sidebar navigation: switch between Incoming Requests and Pending Payments
  const menuItems = document.querySelectorAll('nav.sidebar ul li');
  if (menuItems && menuItems.length) {
    menuItems.forEach((li, idx) => {
      li.addEventListener('click', () => {
        menuItems.forEach(x => x.classList.remove('active'));
        li.classList.add('active');
        if (idx === 0) {
          // Incoming Requests
          renderAdminTable();
        } else {
          // Pending Payments
          renderPendingPayments();
        }
      });
    });
  }

  // Add event listeners for filter inputs to trigger filtering automatically
  const dateFilter = document.getElementById('filter-date');
  const statusFilter = document.getElementById('filter-status');
  const typeFilter = document.getElementById('filter-type');

  if (dateFilter) {
    dateFilter.addEventListener('input', applyFilters);
  }

  if (statusFilter) {
    statusFilter.addEventListener('change', applyFilters);
  }

  if (typeFilter) {
    typeFilter.addEventListener('change', applyFilters);
  }

  // Initialize i18n translations for the filter bar
  applyTranslations();
  // Start automatic refresh to keep admin UI in sync with client actions
  try { startAdminAutoRefresh(); } catch (e) {}

  // Global handler: when clicking 'Envoyer la proforma' close side panel and open admin modal (DRAFT)
  try {
    const btnSendProforma = document.getElementById('btn-send-proforma');
    if (btnSendProforma) {
      btnSendProforma.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        try {
          // Close side panel first
          closeSidePanel();
          // Open the dedicated proforma modal (uses same upload route as draft)
          // Determine BL for display if present in side panel
          const sideBlEl = document.getElementById('side-bl');
          const blVal = sideBlEl ? sideBlEl.innerText.trim() : '';
          const proformaModal = document.getElementById('proforma-modal');
          if (proformaModal) {
            // store current request id if available on panel, otherwise leave blank
            try { proformaModal.dataset.requestId = document.getElementById('side-panel')?.dataset?.requestId || '';} catch(e){}
            const target = document.getElementById('proforma-target-bl');
            if (target) target.innerText = blVal && blVal !== '—' ? blVal : '';
            proformaModal.style.display = 'flex';
          } else {
            // fallback to admin modal if proforma modal missing
            const blArg = blVal && blVal !== '—' ? blVal : '';
            openAdminModal(blArg, 'DRAFT');
          }
        } catch (e) {
          console.warn('btn-send-proforma click error', e);
          alert('Impossible d\u00e9marrer l\u2019envoi de la proforma. Voir la console.');
        }
      });
    }
  } catch (e) {}

  // Proforma modal wiring: file input label, cancel and send handlers
  try {
    const proformaModal = document.getElementById('proforma-modal');
    const proformaFileInput = document.getElementById('proforma-file-input');
    const proformaFileLabel = document.getElementById('proforma-file-label');
    const proformaCancel = document.getElementById('proforma-cancel-btn');
    const proformaSend = document.getElementById('proforma-send-btn');

    if (proformaFileInput && proformaFileLabel) {
      proformaFileInput.addEventListener('change', function () {
        const f = this.files && this.files[0];
        proformaFileLabel.innerText = f ? f.name : 'Click to attach proforma (PDF)';
      });
    }

    if (proformaCancel && proformaModal) {
      proformaCancel.addEventListener('click', (ev) => { ev.preventDefault(); proformaModal.style.display = 'none'; });
    }

    if (proformaSend) {
      proformaSend.addEventListener('click', async (ev) => {
        ev.preventDefault();
        try {
          // determine request id: prefer dataset on modal, fallback to side-panel dataset
          const requestId = (proformaModal && proformaModal.dataset && proformaModal.dataset.requestId) || (document.getElementById('side-panel')?.dataset?.requestId) || '';
          if (!requestId) return alert('Identifiant de la demande introuvable. Ouvrez d\u2019abord le panneau pour choisir une demande.');
          if (!proformaFileInput || !proformaFileInput.files || proformaFileInput.files.length === 0) return alert('Veuillez sélectionner un fichier proforma (PDF).');

          const token = localStorage.getItem('token') || localStorage.getItem('access_token');
          if (!token) return alert('Authentification requise.');

          const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
          const defaultLocal = 'https://mkc-backend-kqov.onrender.com';
          const API_BASE = metaApi || defaultLocal;

          const fd = new FormData();
          fd.append('documentType', 'PROFORMA');
          fd.append('files', proformaFileInput.files[0]);

          const origText = proformaSend.innerText;
          proformaSend.disabled = true; proformaSend.innerText = 'Envoi...';

          const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/requests/${requestId}/upload-draft`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd
          });

          if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            throw new Error(`Upload failed: ${resp.status} ${txt}`);
          }

          const json = await resp.json().catch(() => null);
          if (!json || !json.success) throw new Error((json && json.message) || 'Upload failed');

          // Determine created draft IDs returned by upload
          const createdDrafts = Array.isArray(json.drafts) ? json.drafts : [];
          const draftIds = createdDrafts.map(d => d.id).filter(Boolean);

          // If we have draft ids, call notify-proforma to inform client
          let notifyOk = false;
          if (draftIds.length > 0) {
            try {
              proformaSend.innerText = 'Notification...';
              const notifyResp = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/requests/${requestId}/notify-proforma`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileIds: draftIds })
              });

              if (!notifyResp.ok) {
                const txt = await notifyResp.text().catch(() => '');
                throw new Error(`Notify failed: ${notifyResp.status} ${txt}`);
              }

              const notifyJson = await notifyResp.json().catch(() => null);
              if (!notifyJson || !notifyJson.success) throw new Error((notifyJson && notifyJson.message) || 'Notify failed');

              notifyOk = true;
            } catch (ne) {
              console.warn('proforma notify error', ne);
              alert('La proforma a été téléversée, mais la notification au client a échoué. Réessayez via le panneau ou contactez support.\n\nErreur: ' + String(ne.message || ne));
            }
          }

          // success: close modal and show toast (notify preferred, otherwise upload-only)
          if (proformaModal) proformaModal.style.display = 'none';
          if (notifyOk) showAdminToast('Proforma envoyée et notification déclenchée au client.');
          else showAdminToast('Proforma téléversée (notification en échec).');

          // update local state and UI
          try {
            const isProforma = Array.isArray(json.drafts) && json.drafts.some(d => (d.type || '').toString().toLowerCase().includes('proforma'));
            const newStatus = isProforma ? 'PROFORMAT_SENT' : 'DRAFT_SENT';
            requests = requests.map(r => ((r.id || r.request_id) == requestId) ? Object.assign({}, r, { status: newStatus }) : r);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(requests)); renderAdminTable();
          } catch (e) {}

          proformaSend.disabled = false; proformaSend.innerText = origText;
        } catch (e) {
          console.warn('proforma send error', e);
          alert(String(e.message || e));
          proformaSend.disabled = false; proformaSend.innerText = 'Envoyer la proforma';
        }
      });
    }
  } catch (e) { console.warn('proforma modal wiring failed', e); }
});

// --- Auto-refresh (polling) for admin UI ---
const ADMIN_POLL_INTERVAL_MS = 8000; // 8 seconds
let _adminAutoRefreshTimer = null;
async function refreshAdminOnce() {
  try {
    await loadAdminRequests();
    reRenderCurrentView();
  } catch (e) {
    // ignore transient errors
  }
}
function startAdminAutoRefresh() {
  if (_adminAutoRefreshTimer) return;
  _adminAutoRefreshTimer = setInterval(() => {
    refreshAdminOnce();
  }, ADMIN_POLL_INTERVAL_MS);
  // immediate fetch
  refreshAdminOnce();
}
function stopAdminAutoRefresh() {
  if (_adminAutoRefreshTimer) {
    clearInterval(_adminAutoRefreshTimer);
    _adminAutoRefreshTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAdminAutoRefresh(); else startAdminAutoRefresh();
});

function applyTranslations() {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key && i18n[key]) {
      const lang = document.getElementById('lang-select').value || 'en'; // Get selected language
      el.textContent = i18n[key][lang] || i18n[key]['en']; // Fallback to English if translation is missing
    }
  });
}

// Translate status keys using global i18n loader when available, fallback to humanized key
function translateStatus(status) {
  const s = String(status || '').toUpperCase();
  if (!s) return '';
  if (window.i18n && typeof window.i18n.t === 'function') {
    try {
      const t = window.i18n.t(s);
      if (t && t !== s) return t;
    } catch (e) {
      // ignore
    }
  }
  return s.replace(/_/g, ' ');
}

function reRenderCurrentView() {
  // Determine active menu to re-render the correct admin view
  try {
    const active = document.querySelector('nav.sidebar ul li.active');
    if (active) {
      const items = Array.from(document.querySelectorAll('nav.sidebar ul li'));
      const idx = items.indexOf(active);
      if (idx === 0) renderAdminTable(); else renderPendingPayments();
      return;
    }
  } catch (e) {}
  // default
  renderAdminTable();
}

document.getElementById('lang-select').addEventListener('change', () => {
  const lang = document.getElementById('lang-select').value || 'en';
  // Ensure global i18n knows about the language change so window.i18n.t() uses correct locale
  if (window.i18n && typeof window.i18n.setLang === 'function') {
    try { window.i18n.setLang(lang); } catch (e) {}
  }
  applyTranslations(); // Reapply local static translations
  reRenderCurrentView(); // Re-render dynamic status labels
});

const i18n = {
  filter_date: {
    en: 'Date:',
    fr: 'Date :'
  },
  filter_status: {
    en: 'Status:',
    fr: 'Statut :'
  },
  filter_type: {
    en: 'Type:',
    fr: 'Type :'
  },
  filter_all: {
    en: 'All',
    fr: 'Tous'
  },
  filter_initiated: {
    en: 'Initiated',
    fr: 'Initié'
  },
  filter_created: {
    en: 'Created',
    fr: 'Créé'
  },
  filter_awaiting_documents: {
    en: 'Awaiting Documents',
    fr: 'En attente de documents'
  },
  filter_processing: {
    en: 'Processing',
    fr: 'En cours'
  },
  filter_completed: {
    en: 'Completed',
    fr: 'Terminé'
  },
  filter_draft: {
    en: 'Draft',
    fr: 'Brouillon'
  },
  filter_final: {
    en: 'Final',
    fr: 'Final'
  }
  ,
  confirm_payment: {
    en: 'Confirm Payment',
    fr: 'Confirmer le paiement'
  },
  confirm_payment_confirmation: {
    en: 'Confirm payment for selected request?',
    fr: 'Confirmer le paiement pour la demande sélectionnée ?'
  }
};

// UI button labels and sidebar
Object.assign(i18n, {
  menu_create_invoice: { en: 'Create invoice', fr: 'Création facture' },
  btn_dispute: { en: 'Dispute', fr: 'Contester' },
  btn_message: { en: 'Message', fr: 'Message' },
  btn_invoice: { en: 'Invoice', fr: 'Facture' }
});

// Load requests from backend to ensure admin sees same data as client
async function loadAdminRequests() {
  try {
    const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
    const defaultLocal = 'https://mkc-backend-kqov.onrender.com';
    const API_BASE = metaApi || defaultLocal;

    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await fetch(`${API_BASE.replace(/\/$/,'')}/admin/requests`, { headers });
    if (resp.ok) {
      const data = await resp.json();
      requests = Array.isArray(data) ? data : (data?.data || []);
      // Debug: log first rows and resolved client names to help diagnose missing names
      try {
        console.debug('admin: loaded requests count', requests.length);
        console.debug('admin: requests sample', requests.slice(0,3));
        try { console.debug('admin: client names (sample)', requests.slice(0,5).map(r => getClientName(r))); } catch(e) { console.debug('admin: getClientName failed', e); }
      } catch (e) {
        // avoid breaking admin UI if console fails
      }
      renderAdminTable();
      return;
    }
  } catch (e) {
    // ignore and fallback to localStorage
  }

  // Fallback: read from localStorage (if any) to avoid empty UI
  try {
    requests = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) { requests = []; }
  renderAdminTable();
}

/**
 * Renders the table with English status and context buttons
 */
function renderAdminTable() {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;
  // default: show all incoming requests (exclude payment-only statuses)
  const rowsToShow = requests;
  tbody.innerHTML = rowsToShow.map(row => {
    const rowId = (row.id || row.request_id || row.bl_number || row.extracted_bl || row.bl || '').toString();
    const status = row.status || '';
    const displayStatus = String(status).replace(/_/g, ' ');
    const statusLabel = (window.i18n && typeof window.i18n.t === 'function') ? (window.i18n.t(status) || displayStatus) : displayStatus;
    // Only allow issuing draft when status is CREATED or AWAITING_DOCUMENTS
    const isInitiated = ['CREATED', 'AWAITING_DOCUMENTS', 'PROCESSING'].includes(status);

    // Use same BL selection logic as client but prefer extracted BL when available
    let blValue = '';
    // prefer the extracted value first (most reliable), then manual BL provided by client, then explicit fields
    blValue = blValue || row.extracted_bl || row.manual_bl || row.manualBl || row.bl_number || row.bl || row.bill_of_lading || '';
    // fallback to nested request fields
    if (!blValue && row.request) {
      blValue = row.request.extracted_bl || row.request.manual_bl || row.request.manualBl || row.request.bl_number || row.request.bl || '';
    }
    // fallback to documents array (first available)
    if (!blValue && row.documents && Array.isArray(row.documents)) {
      for (const d of row.documents) {
        // prefer extracted_bl inside documents as well
        if (d.extracted_bl || d.manual_bl || d.manualBl || d.bl_number || d.bl || d.bill_of_lading) {
          blValue = d.extracted_bl || d.manual_bl || d.manualBl || d.bl_number || d.bl || d.bill_of_lading;
          break;
        }
      }
    }

        const blGenLabel = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('bl_generator') : 'BL generator';
        const displayBl = (row.manual_bl || row.manualBl) ? (blValue + ' (' + blGenLabel + ')') : blValue;

        return `
      <tr data-req="${escapeHtml(rowId)}" class="clickable-row">
          <td class="text-blue" style="font-weight: 600;">${escapeHtml(displayBl)}</td>
            <td>${escapeHtml(formatDateFromRow(row))}</td>
            <td><span class="status ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></td>
            <td>${escapeHtml(getClientName(row))}</td>
            <td>
              <button class="icon-btn" title="View Docs" onclick="event.stopPropagation(); viewDocs('${escapeJs(((row.request && (row.request.id || row.request.request_id)) || row.request_id || row.id || blValue) || '')}')"><i class="fas fa-folder-open"></i></button>
            </td>
            <td>
                ${String(status) === 'DRAFT_SENT' || String(status) === 'PROFORMAT_SENT'
      ? `<span class="pending-payment" style="color:#f59e0b; font-weight:600;">${escapeHtml(translateStatus('DRAFT_SENT'))}</span>`
      : (isInitiated ?
        (() => {
          const _langBtn = (document.getElementById('lang-select') && document.getElementById('lang-select').value) ? document.getElementById('lang-select').value : 'en';
          const _label = (i18n.issue_draft_price && (i18n.issue_draft_price[_langBtn] || i18n.issue_draft_price.en)) || 'Issue Draft/Price';
          return `<button class="btn-green" onclick="openAdminModal('${escapeJs(blValue)}', 'DRAFT')" style="font-size:11px; padding:6px 12px;">${escapeHtml(_label)}</button>`;
        })() :
        (String(status) === 'PAYMENT_PROOF_UPLOADED'
          ? `<span class="pending-confirmation" style="color:#f59e0b; font-weight:600;">${escapeHtml(translateStatus('PAYMENT_PROOF_UPLOADED'))}</span>`
          : (String(status) === 'COMPLETED'
              ? `<button class="btn-white" disabled style="font-size:11px; padding:6px 12px; border-color:var(--primary-green); color:var(--primary-green); opacity:0.5; cursor:not-allowed;">${escapeHtml((i18n.deliver_final_feri && (i18n.deliver_final_feri[(document.getElementById('lang-select') && document.getElementById('lang-select').value) || 'en'] || i18n.deliver_final_feri.en)) || 'Deliver Final FERI')}</button>`
              : `<button class="btn-white" onclick="openAdminModal('${escapeJs(blValue)}', 'FINAL')" style="font-size:11px; padding:6px 12px; border-color:var(--primary-green); color:var(--primary-green);">${escapeHtml((i18n.deliver_final_feri && (i18n.deliver_final_feri[(document.getElementById('lang-select') && document.getElementById('lang-select').value) || 'en'] || i18n.deliver_final_feri.en)) || 'Deliver Final FERI')}</button>`)))
    }
            </td>
        </tr>
    `;
  }).join('');
  // use onclick to avoid multiple listeners when re-rendering
  tbody.onclick = onAdminRowClick;
}

/**
 * Opens the same modal but changes text based on mode
 */
function openAdminModal(bl, mode) {
  selectedBL = bl;
  currentMode = mode;
  const modal = document.getElementById('admin-modal');
  if (!modal) return;

  const title = modal.querySelector('h3') || null;
  const btnSubmit = document.getElementById('admin-submit-btn');
  const labelUpload = document.getElementById('label-draft');

  const targetDisplay = document.getElementById('target-bl-display');
  if (targetDisplay) targetDisplay.innerText = bl || '';

  // Determine request type for this BL and toggle AD upload
  try {
    const uploadAdGroup = document.getElementById('upload-ad-group');
    const matchingReqForType = requests.find(r => {
      const bls = [r.extracted_bl, r.manual_bl, r.manualBl, r.bl_number, r.bl, r.bill_of_lading];
      if (r.request) bls.push(r.request.extracted_bl, r.request.manual_bl, r.request.bl_number, r.request.bl);
      return bls.some(x => x && String(x) === String(bl));
    });
    if (uploadAdGroup) {
      if (matchingReqForType && String(matchingReqForType.type) === 'FERI_AND_AD') {
        uploadAdGroup.style.display = '';
      } else {
        uploadAdGroup.style.display = 'none';
        const adInput = document.getElementById('admin-file-ad');
        if (adInput) adInput.value = '';
      }
    }
  } catch (e) {
    // ignore and keep AD upload hidden
  }

  // Reset Modal UI (safe guards)
  if (labelUpload) {
    labelUpload.innerText = "Click to attach PDF";
    if (labelUpload.parentElement) {
      labelUpload.parentElement.style.background = "";
      labelUpload.parentElement.style.borderColor = "";
      const icon = labelUpload.parentElement.querySelector('i');
      if (icon) icon.className = "fas fa-cloud-upload-alt";
    }
  }
  // Reset AD upload label if present
  const labelAd = document.getElementById('label-ad');
  if (labelAd) {
    labelAd.innerText = 'Click to attach AD PDF';
    if (labelAd.parentElement) {
      labelAd.parentElement.style.background = '';
      labelAd.parentElement.style.borderColor = '';
      const iconA = labelAd.parentElement.querySelector('i');
      if (iconA) iconA.className = 'fas fa-cloud-upload-alt';
    }
  }

    if (mode === 'DRAFT') {
      if (title) title.innerText = (i18n.issue_draft_price && (i18n.issue_draft_price[(document.getElementById('lang-select') && document.getElementById('lang-select').value) || 'en'] || i18n.issue_draft_price.en)) || "Issue Draft & Pricing";
      if (btnSubmit) btnSubmit.innerText = (i18n.send_draft_to_client && (i18n.send_draft_to_client[(document.getElementById('lang-select') && document.getElementById('lang-select').value) || 'en'] || i18n.send_draft_to_client.en)) || "SEND DRAFT TO CLIENT";
    } else {
      if (title) title.innerText = (i18n.deliver_final_feri && (i18n.deliver_final_feri[(document.getElementById('lang-select') && document.getElementById('lang-select').value) || 'en'] || i18n.deliver_final_feri.en)) || "Deliver Official FERI";
      if (btnSubmit) btnSubmit.innerText = (i18n.validate_and_deliver_final && (i18n.validate_and_deliver_final[(document.getElementById('lang-select') && document.getElementById('lang-select').value) || 'en'] || i18n.validate_and_deliver_final.en)) || "VALIDATE & DELIVER FINAL";
    }

  modal.style.display = 'flex';
}

function closeAdminModal() {
  document.getElementById('admin-modal').style.display = 'none';
  document.getElementById('admin-file-draft').value = '';
  const adEl = document.getElementById('admin-file-ad');
  if (adEl) adEl.value = '';
  const labelAdClose = document.getElementById('label-ad');
  if (labelAdClose) {
    labelAdClose.innerText = 'Click to attach AD PDF';
    if (labelAdClose.parentElement) {
      labelAdClose.parentElement.style.background = '';
      labelAdClose.parentElement.style.borderColor = '';
      const icon = labelAdClose.parentElement.querySelector('i');
      if (icon) icon.className = 'fas fa-cloud-upload-alt';
    }
  }
}
/**
 * Handles the admin submit for DRAFT and FINAL modes.
 * For DRAFT: calls backend POST /admin/requests/:id/send-draft (multipart/form-data)
 * For FINAL: preserves existing publish flow.
 */
async function handleAdminSubmit() {
  // proforma amount field removed from modal; only require file attachment
  const fileInp = document.getElementById('admin-file-draft');

  // For DRAFT we only require a file attachment; amount/cargo are handled in the invoice composer
  if (!fileInp || !fileInp.files || fileInp.files.length === 0) return alert('Please attach the PDF file.');

  const btnSubmit = document.getElementById('admin-submit-btn');
  const origText = btnSubmit ? btnSubmit.innerText : '';
  if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerText = 'Processing...'; }

  try {
    // Be lenient when matching BL: some rows may store BL in different fields
    // Also selectedBL may include a display suffix like "(Bl saisi manuel)" – strip it
    const cleanedSelectedBL = (selectedBL || '').replace(/\s*\([^)]+\)\s*$/,'').trim();

    const matching = requests.find(r => {
      const bls = [r.extracted_bl, r.manual_bl, r.manualBl, r.bl_number, r.bl, r.bill_of_lading];
      if (r.request) bls.push(r.request.extracted_bl, r.request.manual_bl, r.request.manualBl, r.request.bl_number, r.request.bl);

      // Also consider id/request_id matching (some rows display the UUID instead of BL)
      const ids = [r.id, r.request_id, r.request && (r.request.id || r.request.request_id)];

      const s1 = String(selectedBL || '');
      const s2 = String(cleanedSelectedBL || '');

      if (ids.some(id => id && (String(id) === s1 || String(id) === s2))) return true;
      return bls.some(x => x && (String(x) === s1 || String(x) === s2));
    });

    if (!matching || !(matching.id || matching.request_id)) {
      const maybeUuid = selectedBL && /^[0-9a-fA-F-]{36}$/.test(selectedBL) ? selectedBL : null;
      if (!maybeUuid) throw new Error('Impossible de trouver la demande correspondante pour ce BL');
    }

    const requestId = (matching && (matching.id || matching.request_id)) || selectedBL;

    const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
    const defaultLocal = 'https://mkc-backend-kqov.onrender.com';
    const API_BASE = metaApi || defaultLocal;
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    if (!token) throw new Error('Token administrateur introuvable. Veuillez vous reconnecter.');

    // Ensure request is UNDER_REVIEW when required by backend policy
    const currentStatus = matching && matching.status ? String(matching.status) : null;
    if (currentStatus !== 'UNDER_REVIEW') {
      const markResp = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/requests/${requestId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'UNDER_REVIEW' })
      });
      if (!markResp.ok) {
        const txt = await markResp.text().catch(() => null);
        throw new Error(`Failed to mark UNDER_REVIEW: ${markResp.status} ${txt || ''}`);
      }
    }

    if (currentMode === 'FINAL') {
      // Keep existing final publish flow but do NOT send a FERI/AD number field from the modal.
      // Send the attached PDF only.
      const fd = new FormData();
      fd.append('file', fileInp.files[0]);

      // If AD file input is visible and a file was provided, append it as `ad_file`
      const adInputEl = document.getElementById('admin-file-ad');
      if (adInputEl && adInputEl.files && adInputEl.files.length > 0) {
        fd.append('ad_file', adInputEl.files[0]);
      }

      const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/requests/${requestId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => null);
        throw new Error(`Publish failed: ${resp.status} ${txt || ''}`);
      }

      // Update local state
      requests = requests.map(req => req.id === requestId || req.request_id === requestId ? { ...req, status: 'COMPLETED', updated: new Date().toLocaleString() } : req);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
      renderAdminTable();
      closeAdminModal();
      alert('Final FERI livré et enregistré.');
      return;
    }

    // DRAFT flow: upload draft/proforma only, then open creat_facture for invoice creation
    const fd2 = new FormData();
    fd2.append('documentType', 'PROFORMA');
    fd2.append('files', fileInp.files[0]);
    const adInputEl = document.getElementById('admin-file-ad');
    if (adInputEl && adInputEl.files && adInputEl.files.length > 0) {
      // append AD file(s) too (same multipart field name expected by backend)
      fd2.append('files', adInputEl.files[0]);
    }

    // Suppress server-side notification for draft upload; notification will be triggered
    // later explicitly by the admin after the invoice is recorded.
    const resp2 = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/requests/${requestId}/upload-draft`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Suppress-Notification': '1' },
      body: fd2
    });

    if (!resp2.ok) {
      const txt = await resp2.text().catch(() => null);
      throw new Error(`Upload draft failed: ${resp2.status} ${txt || ''}`);
    }

    const json2 = await resp2.json();
    if (!json2.success) throw new Error('Failed to upload draft');

    // Update local state to reflect server transition (DRAFT_SENT or PROFORMAT_SENT)
    try {
      const drafts = Array.isArray(json2.drafts) ? json2.drafts : [];
      const isProforma = drafts.some(d => (d.type || '').toString().toLowerCase().includes('proforma'));
      const newStatus = isProforma ? 'PROFORMAT_SENT' : 'DRAFT_SENT';
      requests = requests.map(req => {
        if ((req.id || req.request_id) === requestId || [req.extracted_bl, req.bl_number, req.bl].some(x => x && String(x) === selectedBL)) {
          return { ...req, status: newStatus, updated: new Date().toLocaleString() };
        }
        return req;
      });
    } catch (e) {
      // fallback: mark draft sent
      requests = requests.map(req => ((req.id || req.request_id) === requestId) ? Object.assign({}, req, { status: 'DRAFT_SENT', updated: new Date().toLocaleString() }) : req);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
    renderAdminTable();
    closeAdminModal();

    // Prefill creat_facture with request info
    try {
      const clientName = encodeURIComponent(getClientName(matching) || '');
      const refVal = encodeURIComponent((matching && (matching.customer_reference || matching.ref || matching.request_ref)) || '');
      const blVal = encodeURIComponent((matching && (matching.extracted_bl || matching.manual_bl || matching.bl_number || matching.bl || '')) || '');
      const typeVal = encodeURIComponent((matching && (matching.type || matching.request_type)) || '');
      const url = `creat_facture.html?request_id=${encodeURIComponent(requestId)}&client=${clientName}&ref=${refVal}&bl=${blVal}&type=${typeVal}`;
      window.location.href = url;
    } catch (redirErr) {
      alert('Draft uploaded successfully. Open creat_facture to continue.');
    }

  } catch (e) {
    console.warn('handleAdminSubmit error', e);
    alert(String(e.message || e));
  } finally {
    if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerText = origText; }
  }
}

async function fetchAndRenderUser() {
  try {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    if (!token) return;

    const resp = await fetch('https://mkc-backend-kqov.onrender.com/users/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    let data = null;
    if (resp.ok) {
      try { data = await resp.json(); } catch (e) { data = null; }
    }
    // If fetch failed or returned non-json, try to decode token as fallback
    if (!data) {
      data = decodeTokenFallback(token);
    }
    const nameEl = document.querySelector('.user-profile .user-info .name');
    const roleEl = document.querySelector('.user-profile .user-info .role');
    const avatarEl = document.querySelector('.user-profile .avatar-placeholder');

    const prenom = data?.prenom || data?.first_name || data?.user_metadata?.prenom || data?.prenom_fr || '';
    const nom = data?.nom || data?.last_name || data?.user_metadata?.nom || data?.nom_fr || '';
    const fullName = (prenom || nom) ? `${prenom} ${nom}`.trim() : (data?.email || 'Admin');
    const role = (data?.role || data?.user_metadata?.role || 'ADMIN').toString();

    if (nameEl) nameEl.innerText = fullName;
    if (roleEl) roleEl.innerText = role === 'ADMIN' ? 'Administrator' : String(role);
    if (avatarEl) {
      const initials = ((prenom || '').charAt(0) + (nom || '').charAt(0)).toUpperCase() || fullName.slice(0,2).toUpperCase();
      avatarEl.innerText = initials;
    }
  } catch (e) {
    // ignore errors; keep default static header
    console.warn('fetchAndRenderUser failed', e);
  }
}

// Decode a JWT token payload (safe fallback) and return a minimal user-like object
function decodeTokenFallback(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    // base64url -> base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(b64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    const obj = JSON.parse(json);
    // Normalize to expected shape
    return {
      email: obj.email || obj?.sub || null,
      role: obj.role || obj?.roles || null,
      prenom: obj.prenom || obj.first_name || null,
      nom: obj.nom || obj.last_name || null
    };
  } catch (e) {
    return null;
  }
}

// Derive a human-friendly date string from various possible fields
function formatDateFromRow(row) {
  if (!row) return '';
  const fields = ['updated', 'updated_at', 'updatedAt', 'created_at', 'createdAt', 'created'];

  const formatValue = (v) => {
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return new Date(v).toLocaleString('fr-FR', opts);
    const d = new Date(String(v));
    if (!isNaN(d.getTime())) return d.toLocaleString('fr-FR', opts);
    return String(v);
  };

  for (const f of fields) {
    const v = row[f] || (row.request && row.request[f]);
    if (v) return formatValue(v);
  }

  if (row.documents && Array.isArray(row.documents)) {
    for (const d of row.documents) {
      for (const f of fields) {
        if (d && d[f]) return formatValue(d[f]);
      }
    }
  }

  return '';
}

// Small helpers to avoid XSS when injecting values into HTML/JS
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe).replace(/[&<>"]|'/g, function (c) {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

function escapeJs(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\"/g, '\\"');
}

// Save BL saisi to backend
async function saveBLSaisi(requestId) {
  if (!requestId) {
    alert('Request ID not found');
    return;
  }
  
  const blSaisiInput = document.getElementById('side-bl-saisi-input');
  if (!blSaisiInput) return;
  
  const blSaisiValue = blSaisiInput.value.trim();
  if (!blSaisiValue) {
    alert('Veuillez entrer un numéro BL.');
    return;
  }
  
  try {
    const btnSave = document.getElementById('btn-save-bl-saisi');
    const origText = btnSave ? btnSave.innerText : 'Sauvegarder';
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerText = 'Saving...';
    }
    
    const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
    const API_BASE = metaApi || 'https://mkc-backend-kqov.onrender.com';
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    
    if (!token) {
      alert('Token not found');
      return;
    }
    
    const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/requests/${requestId}/bl-saisi`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bl_saisi: blSaisiValue })
    });
    
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${resp.status}`);
    }
    
    const result = await resp.json();
    
    // Update local cache
    const matching = requests.find(r => r.id === requestId || r.request_id === requestId);
    if (matching) {
      matching.bl_saisi = blSaisiValue;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
    }
    
    showAdminToast('BL saisi mis à jour avec succès');
    
  } catch (e) {
    console.warn('saveBLSaisi error', e);
    alert('Erreur: ' + (e.message || String(e)));
  } finally {
    const btnSave = document.getElementById('btn-save-bl-saisi');
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerText = 'Sauvegarder';
    }
  }
}

// Format BL for display: append marker when BL was entered manually
function formatBLDisplayFromRow(row) {
  if (!row) return '';
  // If admin-entered BL exists, prefer it and display it directly
  if (row.bl_saisi && String(row.bl_saisi).trim()) {
    return String(row.bl_saisi).trim();
  }

  const bl = row.manual_bl || row.manualBl || row.bl_number || row.extracted_bl || row.bill_of_lading || row.bl || '';
  if (!bl) return '';
  if (row.manual_bl) {
    const blGenLabel = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('bl_generator') : 'BL generator';
    return `${row.manual_bl} (${blGenLabel})`;
  }
  return bl;
}

// Extract a readable client name from various possible row shapes
function getClientName(row) {
  if (!row) return '---';

  // 1️⃣ Top-level first/last
  const firstTop = row.prenom || row.first_name || row.firstname || row.given_name || row.client_first_name || '';
  const lastTop = row.nom || row.last_name || row.lastname || row.surname || row.client_last_name || '';
  const combinedTop = `${firstTop} ${lastTop}`.trim();
  if (combinedTop) return combinedTop;

  // 2️⃣ Nested profile object
  const prof = row.profile || row.request?.profile || null;
  if (prof) {
    const f = prof.prenom || prof.first_name || prof.given_name || '';
    const l = prof.nom || prof.last_name || prof.lastname || '';
    const c = `${f} ${l}`.trim();
    if (c) return c;
    if (prof.email) return prof.email;
  }

  // 3️⃣ Single profile object from server-side join (row.profiles)
  if (row.profiles && typeof row.profiles === 'object') {
    const f = row.profiles.prenom || row.profiles.first_name || row.profiles.given_name || '';
    const l = row.profiles.nom || row.profiles.last_name || row.profiles.lastname || '';
    const c = `${f} ${l}`.trim();
    if (c) return c;
    if (row.profiles.email) return row.profiles.email;
  }

  // 4️⃣ Other fallbacks
  if (row.client_name) return row.client_name;
  if (row.name) return row.name;
  if (row.full_name) return row.full_name;
  if (row.email) return row.email;

  return '---';
}




// Simple handler called from Pending Payments UI to confirm payment (simulated)
window.confirmPaymentFor = async function (requestId) {
  if (!requestId) return alert('Request id missing');
  const lang = document.getElementById('lang-select').value || 'en';
  const confirmMsg = (i18n.confirm_payment_confirmation && i18n.confirm_payment_confirmation[lang]) || i18n.confirm_payment_confirmation.en;
  if (!confirm(confirmMsg)) return;

    const API_BASE = (() => {
    const meta = document.querySelector('meta[name="api-base"]')?.content || '';
    if (meta) return meta.replace(/\/$/, '');
    return 'https://mkc-backend-kqov.onrender.com';
  })();
  const token = localStorage.getItem('token') || localStorage.getItem('access_token');
  if (!token) return alert('Token administrateur introuvable. Veuillez vous reconnecter.');

  try {
    const resp = await fetch(`${API_BASE}/requests/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId, to: 'PAYMENT_CONFIRMED' })
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => null);
      throw new Error(`Failed to transition: ${resp.status} ${txt || ''}`);
    }

    // reload admin requests to reflect updated status in Pending Payments
    await loadAdminRequests();
    alert('Paiement confirmé. Statut mis à jour en PAYMENT_CONFIRMED.');
  } catch (e) {
    console.error('confirmPaymentFor error', e);
    alert('Erreur lors de la confirmation du paiement: ' + (e && e.message ? e.message : String(e)));
  }
};

// Row click handler and side panel functions
function onAdminRowClick(e) {
  const tr = e.target.closest && e.target.closest('tr[data-req]');
  if (!tr) return;

  // Check if the clicked element is inside the Admin Action column
  const isAdminActionColumn = e.target.closest('td') && e.target.closest('td').cellIndex === 5; // Assuming Admin Action is the 6th column (index 5)
  if (isAdminActionColumn) return; // Do nothing if Admin Action column is clicked

  const reqId = tr.dataset.req;
  if (!reqId) return;
  openSidePanelById(reqId);
}

function openSidePanelById(id) {
  const req = requests.find(r => String(r.id) === String(id) || String(r.request_id) === String(id) || String(r.bl_number) === String(id) || String(r.extracted_bl) === String(id) || String(r.bl) === String(id));
  if (!req) return;
  openSidePanel(req);
}

function openSidePanel(req) {
  const panel = document.getElementById('side-panel');
  if (!panel) return;
  document.getElementById('side-bl').innerText = formatBLDisplayFromRow(req) || '—';
  // Render status as a styled badge with icon
  const sideStatusEl = document.getElementById('side-status');
  const rawStatus = (req.status || '').toString().toUpperCase();
  const statusLabel = translateStatus(rawStatus) || 'UNKNOWN';
  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.2"/></svg>',
    pending: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 8v5l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.2"/></svg>',
    rejected: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  let cls = 'pending';
  if (rawStatus === 'COMPLETED' || rawStatus === 'FINAL') cls = 'success';
  if (rawStatus === 'REJECTED' || rawStatus === 'DENIED') cls = 'rejected';

  if (sideStatusEl) {
    sideStatusEl.className = 'status badge ' + cls;
    const iconHtml = cls === 'success' ? icons.success : (cls === 'rejected' ? icons.rejected : icons.pending);
    sideStatusEl.innerHTML = iconHtml + '<span>' + statusLabel + '</span>';
  }

  document.getElementById('side-date').innerText = 'Date: ' + (formatDateFromRow(req) || '—');
  document.getElementById('side-client').innerText = 'Client: ' + (getClientName(req) || '—');
  
  // Populate BL saisi field
  const blSaisiInput = document.getElementById('side-bl-saisi-input');
  if (blSaisiInput) {
    blSaisiInput.value = req.bl_saisi || '';
  }
  
  // Store current request ID for save handler
  const btnSaveBL = document.getElementById('btn-save-bl-saisi');
  if (btnSaveBL) {
    btnSaveBL.dataset.requestId = req.id || req.request_id || '';
    btnSaveBL.onclick = () => saveBLSaisi(req.id || req.request_id);
  }
  
  const fxiEl = document.getElementById('side-fxi');
  if (fxiEl) fxiEl.innerText = 'FXI: ' + (req.fxi_number || '—');
  
  // Display request type (FERI, AD, FERI_AND_AD)
  const typeEl = document.getElementById('side-type');
  if (typeEl) {
    const typeValue = req.type || '—';
    const typeDisplay = typeValue.replace(/_/g, ' ');
    typeEl.innerText = typeDisplay;
  }
  
  // Populate AD fields (transporteur, immatriculation, montants transport, mode paiement)
  const carrierEl = document.getElementById('side-carrier');
  if (carrierEl) carrierEl.innerText = req.carrier_name || '—';

  const carteEl = document.getElementById('side-carte-chargeur');
  if (carteEl) carteEl.innerText = req.carte_chargeur || '—';
  
  const vehicleEl = document.getElementById('side-vehicle');
  if (vehicleEl) vehicleEl.innerText = req.vehicle_registration || '—';
  
  const roadAmountEl = document.getElementById('side-road-amount');
  if (roadAmountEl) roadAmountEl.innerText = req.transport_road_amount ? (req.transport_road_amount + ' XAF') : '—';
  
  const riverAmountEl = document.getElementById('side-river-amount');
  if (riverAmountEl) riverAmountEl.innerText = req.transport_river_amount ? (req.transport_river_amount + ' XAF') : '—';
  
  const paymentModeEl = document.getElementById('side-payment-mode');
  if (paymentModeEl) paymentModeEl.innerText = req.payment_mode || '—';
  
  const docsEl = document.getElementById('side-docs');
  docsEl.innerHTML = '';
  let docs = req.documents || req.files || [];

  // Renders a documents array into the side panel using the existing style
  const renderDocsArray = (docsArr) => {
    docsEl.innerHTML = '';
    if (!Array.isArray(docsArr) || docsArr.length === 0) {
      docsEl.innerHTML = '<p style="color:#666">Aucun document attaché.</p>';
      return;
    }
    docsArr.forEach(d => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.padding = '8px 0';
      row.style.borderBottom = '1px solid #f0f0f0';

      const meta = document.createElement('div');
      meta.style.display = 'flex';
      meta.style.flexDirection = 'column';
      meta.innerHTML = `<strong>${d.file_name || d.name || d.filename || 'Document'}</strong><small style="color:#666">${d.type || d.category || d.doc_type || ''}</small>`;

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';

      const dl = document.createElement('button');
      dl.className = 'btn-white';
      dl.innerText = '⬇️ Télécharger';
      dl.onclick = (ev) => {
        ev.stopPropagation();
        if (d.url || d.file_path || d.pdf_url) {
          const href = d.url || d.file_path || d.pdf_url;
          window.open(href, '_blank');
        } else if (d.id) {
          downloadDocumentId(d.id, d.file_name || 'document');
        } else {
          alert('Aucun lien de téléchargement disponible');
        }
      };

      actions.appendChild(dl);
      row.appendChild(meta);
      row.appendChild(actions);
      docsEl.appendChild(row);
    });
  };

  // If there are embedded docs, render them. Otherwise fetch via the same backend endpoint and render.
  if (Array.isArray(docs) && docs.length > 0) {
    renderDocsArray(docs);
  } else {
    const requestId = req.id || req.request_id;
    if (!requestId) {
      renderDocsArray([]);
    } else {
      try {
        const API_BASE = (() => { const meta = document.querySelector('meta[name="api-base"]')?.content || ''; return meta ? meta.replace(/\/$/, '') : 'https://mkc-backend-kqov.onrender.com'; })();
        const token = localStorage.getItem('token') || localStorage.getItem('access_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const base = API_BASE.replace(/\/api\/?$/, '').replace(/\/$/, '');
        fetch(`${base}/api/requests/${requestId}/documents`, { headers }).then(async (resp) => {
          if (!resp.ok) return renderDocsArray([]);
          const json = await resp.json();
          const remoteDocs = Array.isArray(json) ? json : (Array.isArray(json.documents) ? json.documents : (Array.isArray(json.data) ? json.data : []));
          renderDocsArray(remoteDocs);
        }).catch((e) => { console.warn('Failed to load docs for side panel', e); renderDocsArray([]); });
      } catch (e) {
        console.warn('Failed to load docs for side panel', e);
        renderDocsArray([]);
      }
    }
  }
  panel.classList.add('show');
  panel.setAttribute('aria-hidden','false');

  // Invoice button removed from UI; no client-facing invoice action here.

  // Wire up message/dispute UI
  const btnMsg = document.getElementById('btn-message');
  const btnDispute = document.getElementById('btn-dispute');
  const msgForm = document.getElementById('side-message-form');
  const sendBtn = document.getElementById('side-send-message');
  const cancelBtn = document.getElementById('side-cancel-message');
  const statusEl = document.getElementById('side-message-status');

  if (btnMsg) btnMsg.onclick = () => { if (msgForm) { msgForm.style.display = 'block'; msgForm.dataset.type = 'MESSAGE'; if (statusEl) statusEl.style.display='none'; }};
  if (btnDispute) btnDispute.onclick = () => { if (msgForm) { msgForm.style.display = 'block'; msgForm.dataset.type = 'DISPUTE'; if (statusEl) statusEl.style.display='none'; }};
  if (cancelBtn) cancelBtn.onclick = () => { if (msgForm) { msgForm.style.display = 'none'; }};

  if (sendBtn) sendBtn.onclick = async () => {
    try {
      sendBtn.disabled = true;
      const text = document.getElementById('side-message-text').value.trim();
      const fileInput = document.getElementById('side-message-file');
      const type = msgForm?.dataset.type || 'MESSAGE';
      if (!text) { alert('Le message est requis'); sendBtn.disabled = false; return; }

      const API_BASE = (() => { const m = document.querySelector('meta[name="api-base"]')?.content || ''; return m || 'https://mkc-backend-kqov.onrender.com'; })();
      const token = localStorage.getItem('token') || localStorage.getItem('access_token');
      const fd = new FormData();
      fd.append('type', type);
      // For disputes, backend expects 'reason' and optional 'invoice_id'
      if (type === 'DISPUTE') {
        fd.append('reason', text);
        // attach invoice_id when available
        const invoiceId = (req && (req.invoice_id || (req.invoice && req.invoice.id) || (req.invoices && req.invoices[0] && req.invoices[0].id))) || '';
        if (invoiceId) fd.append('invoice_id', invoiceId);
      } else {
        fd.append('content', text);
      }
      if (fileInput && fileInput.files && fileInput.files[0]) fd.append('file', fileInput.files[0]);

      const base = API_BASE.replace(/\/api\/?$/,'').replace(/\/$/, '');
      const endpoint = type === 'DISPUTE'
        ? `${base}/api/requests/${req.id || req.request_id}/disputes`
        : `${base}/api/requests/${req.id || req.request_id}/messages`;

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(()=>null);
        throw new Error(`Envoi échoué: ${resp.status} ${txt||''}`);
      }

      if (statusEl) { statusEl.style.display = 'block'; statusEl.innerText = 'Votre message a été envoyé.'; }
      document.getElementById('side-message-text').value = '';
      if (fileInput) fileInput.value = '';
      if (msgForm) msgForm.style.display = 'none';

      // Show in-app toast
      const toastMsg = type === 'DISPUTE' ? 'Contestation envoyée au client.' : 'Message envoyé au client.';
      showAdminToast(toastMsg);

      // Browser notification when permitted
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          const title = type === 'DISPUTE' ? 'Contestation envoyée' : 'Message envoyé';
          new Notification(title, { body: toastMsg });
        }
      } catch (e) { /* ignore */ }
    } catch (e) {
      alert(String(e.message || e));
    } finally { sendBtn.disabled = false; }
  };
}

function closeSidePanel() {
  const panel = document.getElementById('side-panel');
  if (!panel) return;
  panel.classList.remove('show');
  panel.setAttribute('aria-hidden','true');
}

// Find request by id/request_id or BL and open docs modal
window.viewDocs = function (identifier) {
  if (!identifier) return alert('Identifiant de la demande manquant.');

  // If identifier looks like a UUID, prefer matching by id/request_id
  const isUuid = typeof identifier === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(identifier);

  let req = null;
  if (isUuid) {
    req = requests.find(r => (r.id || r.request_id) === identifier);
  } else {
    // Fallback: identifier might be a BL value — match against common BL fields
    req = requests.find(r => {
      const bls = [r.extracted_bl, r.bl_number, r.bl, r.bill_of_lading];
      if (r.request) bls.push(r.request.extracted_bl, r.request.bl_number, r.request.bl);
      return bls.some(x => x && String(x) === identifier);
    });
  }

  if (!req) {
    // If still not found and we have a UUID-like identifier, try server fetch by requestId
    if (isUuid) {
      fetchAndOpenDocsByRequestId(identifier);
      return;
    }
    return alert('Demande introuvable.');
  }

  const docs = req.documents || req.files || [];
  if (docs && docs.length > 0) return openDocsModal(docs, req);

  // Fallback: fetch documents from backend using request id
  const requestId = req.id || req.request_id;
  if (requestId) {
    fetchAndOpenDocsByRequestId(requestId);
    return;
  }

  alert('Aucun document attaché pour cette demande.');
};

async function fetchAndOpenDocsByRequestId(requestId) {
  try {
    const API_BASE = (() => {
      const meta = document.querySelector('meta[name="api-base"]')?.content || '';
      if (meta) return meta.replace(/\/$/, '');
      return 'https://mkc-backend-kqov.onrender.com';
    })();
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    // ensure single /api prefix
    const base = API_BASE.replace(/\/api\/?$/,'').replace(/\/$/, '');
    const resp = await fetch(`${base}/api/requests/${requestId}/documents`, { headers });
    if (resp.ok) {
      const json = await resp.json();
      const list = Array.isArray(json.documents) ? json.documents : (json?.data || []);
      if (list && list.length > 0) return openDocsModal(list, { id: requestId });
    }
    alert('Aucun document attaché pour cette demande.');
  } catch (e) {
    console.warn('Failed to fetch documents for request', e);
    alert('Erreur lors de la récupération des documents.');
  }
}

// Download a document by id using auth token and trigger file save
async function downloadDocumentId(documentId, filename) {
  try {
    const API_BASE = (() => {
      const meta = document.querySelector('meta[name="api-base"]')?.content || '';
      if (meta) return meta.replace(/\/$/, '');
      return 'https://mkc-backend-kqov.onrender.com';
    })();
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/documents/${documentId}/download`, { headers });

    if (!resp.ok) {

      // Try to parse JSON body for a direct URL returned by the server
      let bodyJson = null;
      try { bodyJson = await resp.json(); } catch (e) { bodyJson = null; }
      const candidateUrl = bodyJson && (bodyJson.url || bodyJson.signed_url || bodyJson.file_url || bodyJson.download_url);
      if (candidateUrl) {
        // Open fallback URL in new tab
        window.open(candidateUrl, '_blank');
        return;
      }

      // Try admin-signed-url endpoint as a fallback
      try {
        const signedResp = await fetch(`${API_BASE.replace(/\/$/, '')}/documents/${documentId}/signed-url`, { headers });
        if (signedResp.ok) {
          const signedJson = await signedResp.json();
          const signed = signedJson && (signedJson.url || signedJson.signedUrl || signedJson.downloadUrl);
          if (signed) { window.open(signed, '_blank'); return; }
        }
      } catch (e) {
        // ignore and continue to other fallbacks
      }

      // Fallback: try to GET document metadata and extract a URL
      try {
        const metaResp = await fetch(`${API_BASE.replace(/\/$/, '')}/documents/${documentId}`, { headers });
        if (metaResp.ok) {
          const metaJson = await metaResp.json();
          const metaCandidate = metaJson && (metaJson.url || metaJson.signed_url || metaJson.file_url || metaJson.pdf_url || metaJson.data?.url);
          if (metaCandidate) {
            window.open(metaCandidate, '_blank');
            return;
          }
        }
      } catch (e) {
        // ignore and continue to throw below
      }

      const text = await resp.text().catch(() => '');
      throw new Error('Download failed: ' + resp.status + ' ' + text);
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.warn('downloadDocumentId error', e);
    alert('Impossible de télécharger le document.');
  }
}

function openDocsModal(docs, req) {
  // remove existing if any
  const existing = document.getElementById('docs-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'docs-modal-overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.4)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '9999';

  const box = document.createElement('div');
  box.style.width = '520px';
  box.style.maxHeight = '80vh';
  box.style.overflow = 'auto';
  box.style.background = '#fff';
  box.style.borderRadius = '8px';
  box.style.padding = '18px';
  box.style.boxShadow = '0 6px 30px rgba(0,0,0,0.2)';

  const title = document.createElement('h3');
  title.innerText = `Documents pour ${formatBLDisplayFromRow(req)}`;
  title.style.marginTop = '0';
  box.appendChild(title);

  const list = document.createElement('div');
  docs.forEach(d => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.padding = '8px 0';
    row.style.borderBottom = '1px solid #f0f0f0';

    const name = document.createElement('div');
    name.innerText = d.name || d.filename || d.file_name || d.title || (d.url ? d.url.split('/').pop() : 'Document');
    name.style.flex = '1';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    if (d.url) {
      const a = document.createElement('a');
      a.href = d.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.download = '';
      a.className = 'btn-white';
      a.style.padding = '6px 10px';
      a.style.fontSize = '13px';
      a.innerText = 'Télécharger';
      actions.appendChild(a);
    } else if (d.id) {
      const btn = document.createElement('button');
      btn.className = 'btn-white';
      btn.style.padding = '6px 10px';
      btn.style.fontSize = '13px';
      btn.innerText = 'Télécharger';
      btn.onclick = () => downloadDocumentId(d.id, d.file_name || d.file_name || 'document');
      actions.appendChild(btn);
    } else {
      const note = document.createElement('span');
      note.style.color = '#666';
      note.innerText = 'Aucun identifiant ou URL disponible';
      actions.appendChild(note);
    }

    row.appendChild(name);
    row.appendChild(actions);
    list.appendChild(row);
  });

  box.appendChild(list);

  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  footer.style.marginTop = '12px';

  const btnClose = document.createElement('button');
  btnClose.className = 'btn-close';
  btnClose.innerText = 'Fermer';
  btnClose.onclick = () => overlay.remove();
  footer.appendChild(btnClose);

  box.appendChild(footer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

/**
 * Renders the Pending Payments view: requests that need payment verification.
 */
function renderPendingPayments() {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;

  // Consider these statuses as pending payments
  const pendingStatuses = ['DRAFT_SENT', 'PROFORMAT_SENT', 'PAYMENT_PROOF_UPLOADED'];

  const rows = requests.filter(r => pendingStatuses.includes(r.status));
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;">Aucun paiement en attente.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((row) => {
    const rowId = (row.id || row.request_id || row.bl_number || row.extracted_bl || row.bl || '').toString();
    const status = row.status || '';
    const statusLabel = translateStatus(status);
    let blValue = '';
    blValue = blValue || row.extracted_bl || row.manual_bl || row.manualBl || row.bl_number || row.bl || row.bill_of_lading || '';
    if (!blValue && row.request) blValue = row.request.extracted_bl || row.request.manual_bl || row.request.manualBl || row.request.bl_number || row.request.bl || '';
    if (!blValue && row.documents && Array.isArray(row.documents)) {
      for (const d of row.documents) {
        if (d.extracted_bl || d.bl_number || d.bl || d.bill_of_lading) {
          blValue = d.extracted_bl || d.bl_number || d.bl || d.bill_of_lading;
          break;
        }
      }
    }

    const viewDocsBtn = `<button class="icon-btn" title="View Docs" onclick="event.stopPropagation(); viewDocs('${escapeJs(((row.request && (row.request.id || row.request.request_id)) || row.request_id || row.id || blValue) || '')}')"><i class="fas fa-folder-open"></i></button>`;
    const _lang = (document.getElementById('lang-select') && document.getElementById('lang-select').value) ? document.getElementById('lang-select').value : 'en';
    const _confirmLabel = (i18n.confirm_payment && i18n.confirm_payment[_lang]) || i18n.confirm_payment.en;
    const confirmBtn = `<button class="btn-green" onclick="confirmPaymentFor('${escapeJs(row.id || row.request_id || '')}')" style="font-size:11px; padding:6px 12px;">${escapeHtml(_confirmLabel)}</button>`;

    const displayBl = (row.manual_bl || row.manualBl) ? (blValue + ' (Bl saisi manuel)') : blValue;

    return `
      <tr data-req="${escapeHtml(rowId)}" class="clickable-row">
        <td class="text-blue" style="font-weight: 600;">${escapeHtml(displayBl)}</td>
        <td>${escapeHtml(formatDateFromRow(row))}</td>
        <td><span class="status ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></td>
        <td>${escapeHtml(getClientName(row))}</td>
        <td>${viewDocsBtn}</td>
        <td>${confirmBtn}</td>
      </tr>
    `;
  }).join('');
  tbody.onclick = onAdminRowClick;
}

// Add event listener for filter button
const filterButton = document.getElementById('apply-filters');
if (filterButton) {
  filterButton.addEventListener('click', applyFilters);
}

function applyFilters() {
  const dateFilter = document.getElementById('filter-date').value;
  const statusFilter = document.getElementById('filter-status').value;
  const typeFilter = document.getElementById('filter-type').value;

  const filteredRequests = requests.filter(request => {
    const matchesDate = dateFilter ? formatDateFromRow(request) === dateFilter : true;
    const matchesStatus = statusFilter ? request.status === statusFilter : true;
    const matchesType = typeFilter ? request.type === typeFilter : true;
    return matchesDate && matchesStatus && matchesType;
  });

  renderFilteredTable(filteredRequests);
}

function renderFilteredTable(filteredRequests) {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;

  if (filteredRequests.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;">No matching requests found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredRequests.map(row => {
    const rowId = (row.id || row.request_id || row.bl_number || row.extracted_bl || row.bl || '').toString();
    const status = row.status || '';
    const statusLabel = translateStatus(status);
    let blValue = '';
    blValue = blValue || row.extracted_bl || row.manual_bl || row.manualBl || row.bl_number || row.bl || row.bill_of_lading || '';
    if (!blValue && row.request) blValue = row.request.extracted_bl || row.request.manual_bl || row.request.manualBl || row.request.bl_number || row.request.bl || '';
    if (!blValue && row.documents && Array.isArray(row.documents)) {
      for (const d of row.documents) {
        if (d.extracted_bl || d.bl_number || d.bl || d.bill_of_lading) {
          blValue = d.extracted_bl || d.bl_number || d.bl || d.bill_of_lading;
          break;
        }
      }
    }

    const viewDocsBtn = `<button class="icon-btn" title="View Docs" onclick="event.stopPropagation(); viewDocs('${escapeJs(((row.request && (row.request.id || row.request.request_id)) || row.request_id || row.id || blValue) || '')}')"><i class="fas fa-folder-open"></i></button>`;
    const _lang = (document.getElementById('lang-select') && document.getElementById('lang-select').value) ? document.getElementById('lang-select').value : 'en';
    const _confirmLabel = (i18n.confirm_payment && i18n.confirm_payment[_lang]) || i18n.confirm_payment.en;
    const confirmBtn = `<button class="btn-green" onclick="confirmPaymentFor('${escapeJs(row.id || row.request_id || '')}')" style="font-size:11px; padding:6px 12px;">${escapeHtml(_confirmLabel)}</button>`;

    const displayBl = (row.manual_bl || row.manualBl) ? (blValue + ' (Bl saisi manuel)') : blValue;

    return `
      <tr data-req="${escapeHtml(rowId)}" class="clickable-row">
        <td class="text-blue" style="font-weight: 600;">${escapeHtml(displayBl)}</td>
        <td>${escapeHtml(formatDateFromRow(row))}</td>
        <td><span class="status ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></td>
        <td>${escapeHtml(getClientName(row))}</td>
        <td>${viewDocsBtn}</td>
        <td>${confirmBtn}</td>
      </tr>
    `;
  }).join('');
  tbody.onclick = onAdminRowClick;
}