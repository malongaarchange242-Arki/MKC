import { getMe, createRequest } from './client.js';
import { uploadDocuments, getDocument, DOCUMENT_TYPES } from './documents.js';
import { logout } from './auth.js';
import { api } from './axios.config.js';

// --- DONNÉES INITIALES (stockage local comme fallback) ---
const STORAGE_KEY = 'logirdc_requests_v1';
let requests = [];
let extractedBL = "";
let selectedRequestType = '';
// Invoices cache retrieved from backend
let invoicesMap = new Map();
// Pagination: 20 rows per page
const PAGE_SIZE = 20;
let currentPage = 1;

// --- INITIALISATION AU CHARGEMENT ---
window.addEventListener('DOMContentLoaded', async () => {
  ensurePopupContainers();
  bindUIEvents();
  try {
    const me = await getMe();
    renderUserInfo(me);
  } catch (e) {
    // not authenticated, redirect to login
    window.location.href = 'index.html';
    return;
  }

  // If a language switcher exists in the DOM but i18n has a different current
  // language (race condition between scripts), prefer the visible switch value
  // so the UI matches what the user sees.
  try {
    const langSel = document.getElementById('lang-select');
    if (langSel && window.i18n && typeof window.i18n.getLang === 'function' && typeof window.i18n.setLang === 'function') {
      const selVal = langSel.value;
      const cur = window.i18n.getLang();
      if (selVal && selVal !== cur) {
        window.i18n.setLang(selVal);
      } else if (!selVal) {
        // ensure selector reflects current language
        langSel.value = cur;
      }
    }
  } catch (e) {
    // ignore sync failures
  }
  // Replace settings icon with messaging icon (if present)
  try {
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      // Replace gear class with envelope icon class to avoid duplicate icons
      settingsBtn.className = 'fas fa-envelope icon-btn';
      settingsBtn.innerHTML = '';
      settingsBtn.title = 'Messages';
    }
  } catch (e) {}

  // Manual BL input removed: BLs are auto-generated when OCR fails and stored in `manual_bl`.
  await loadRequests();
  // fetch invoices once and merge amounts for display, then re-render table
  try { await fetchInvoices(); } catch (_) {}
  // ensure table shows invoice amounts retrieved from backend
  loadTable(requests);
  // start polling notifications (badge + popup content)
  try { startNotifPolling(); } catch (_) {}
  // Periodic auto-refresh disabled — refresh will be manual via the UI.
  // Previously: setInterval(() => { loadRequests().catch(() => {}); }, 15000);
});

// --- UTILITAIRES ---
function saveRequests() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
}

function ensurePopupContainers() {
  if (!document.getElementById('popup-notif')) {
    const p = document.createElement('div');
    p.id = 'popup-notif';
    p.className = 'dropdown-popup';
    p.setAttribute('aria-hidden', 'true');
    p.innerHTML = `<div class="popup-header" data-i18n="notifications">Notifications</div>` +
      `<div class="popup-body"><div class="notif-item">Aucune notification</div></div>`;
    document.body.appendChild(p);
  }
  if (!document.getElementById('popup-settings')) {
    // create empty popup-settings container; content will be loaded when opened
    const p = document.createElement('div');
    p.id = 'popup-settings';
    p.className = 'dropdown-popup';
    p.setAttribute('aria-hidden', 'true');
    p.innerHTML = `<div class="popup-header">Messages</div><div class="popup-body" id="popup-settings-body" style="max-height:80vh; overflow:auto; padding:8px;"></div>`;
    document.body.appendChild(p);
  }
}

function formatDateNow() {
  return new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Format amount to always show XAF currency prefix
function formatAmountValue(val) {
  if (val === null || val === undefined) return '';
  // prefer numeric-like strings; strip currency letters but keep digits and punctuation
  const s = String(val);
  const numeric = s.replace(/[^0-9.,]/g, '').trim();
  return numeric ? `XAF ${numeric}` : `XAF ${s}`;
}

// --- I18N HELPERS ---
// Translate a status key, trying common variants so "Completed" or
// "Completed"-like values map to the canonical keys (e.g. "COMPLETED").
function translateStatus(status) {
  if (!status) return '';
  try {
    if (window.i18n && typeof window.i18n.t === 'function') {
      const t = window.i18n.t;
      const s = String(status || '');

      // try several candidate keys (original, upper, lower, underscore forms)
      const candidates = [s, s.toUpperCase(), s.toLowerCase()];
      const underscored = s.replace(/[\s\-]+/g, '_');
      candidates.push(underscored);
      candidates.push(underscored.toUpperCase());

      for (const c of candidates) {
        if (!c) continue;
        try {
          const tr = t(c);
          if (tr && tr !== c) return tr;
        } catch (e) {
          // ignore individual candidate failures
        }
      }

      // common mappings from human-readable English to canonical enum keys
      const normalizeMap = {
        'completed': 'COMPLETED',
        'processing': 'PROCESSING',
        'ocr_pending': 'OCR_PENDING',
        'ocrpending': 'OCR_PENDING',
        'payment_confirmed': 'PAYMENT_CONFIRMED',
        'paymentconfirmed': 'PAYMENT_CONFIRMED',
        'created': 'CREATED'
      };
      const key = underscored.toLowerCase();
      if (normalizeMap[key]) {
        try {
          const tr2 = t(normalizeMap[key]);
          if (tr2 && tr2 !== normalizeMap[key]) return tr2;
        } catch (e) {}
        return normalizeMap[key];
      }

      // fallback to calling translator with original status
      try {
        const tr = t(s);
        return (tr && tr !== s) ? tr : s;
      } catch (e) {
        return s;
      }
    }
  } catch (e) {
    // ignore and fall through
  }
  return status;
}

// Build URL to Facture_.html with known params and request download
function buildInvoiceUrl({ invoice, amount, bl, ref, date, nom, prenom, email }) {
  const p = new URLSearchParams();
  if (invoice) p.set('invoice', String(invoice));
  if (amount !== undefined && amount !== null) {
    p.set('amount', String(amount));
    p.set('proforma', String(amount));
  }
  if (bl) p.set('bl', String(bl));
  if (ref) p.set('ref', String(ref));
  if (date) p.set('date', String(date));
  if (nom) p.set('nom', String(nom));
  if (prenom) p.set('prenom', String(prenom));
  if (email) p.set('email', String(email));
  return `Facture_.html?${p.toString()}`;
}

// --- USER INFO RENDERING ---
function renderUserInfo(me) {
  try {
    const profile = me && (me.profile || me.user || me.data) ? (me.profile || me.user || me.data) : null;
    const nameEl = document.querySelector('.user-info .name');
    const roleEl = document.querySelector('.user-info .role');

    if (!profile) {
      // fallback: try token-stored name
      const raw = localStorage.getItem('session') || localStorage.getItem('supabase.auth.token') || null;
      if (raw && nameEl) nameEl.textContent = 'Utilisateur';
      return;
    }

    const fullName = `${profile.nom || profile.first_name || ''} ${profile.prenom || profile.last_name || ''}`.trim();
    if (nameEl) nameEl.textContent = fullName || profile.email || 'Utilisateur';
    if (roleEl) roleEl.textContent = profile.role || (profile.user_metadata && profile.user_metadata.role) || 'User';
      const avatarEl = document.querySelector('.avatar-placeholder');
      if (avatarEl) {
        try {
          const initials = (fullName
            ? fullName.split(' ').filter(Boolean).map(s => s[0]).slice(0,2).join('')
            : (profile.email ? profile.email[0] : 'U')
          ).toUpperCase();

          const src = (profile.avatar_url && typeof profile.avatar_url === 'string')
            ? profile.avatar_url
            : `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><rect width="100%" height="100%" fill="#ddd"/><text x="50%" y="50%" font-size="14" text-anchor="middle" dy=".35em" fill="#555" font-family="Arial, sans-serif">${initials}</text></svg>`)}`;

          avatarEl.innerHTML = `<img src="${src}" alt="${escapeHtml(fullName || profile.email || 'Utilisateur')}" width="36" height="36" style="border-radius:50%; display:block;">`;
        } catch (err) {
          // fallback: keep existing initials markup
        }
      }
  } catch (e) {
    // silent
  }
}

// --- LOGIQUE DU TABLEAU ---
async function loadRequests() {
  const t = document.getElementById('table-body');
  if (!t) return;
  t.innerHTML = '<tr><td colspan="8">Chargement...</td></tr>';
  try {
    const res = await api.get('/requests/me');
    const rows = res.data || [];
    requests = rows;
    // reset to first page on fresh load
    currentPage = 1;
    // populate filter options based on loaded requests
    try { populateFilterOptions(); } catch (e) { /* ignore */ }
    if (!rows.length) {
      t.innerHTML = '<tr><td colspan="8">Aucune demande trouvée</td></tr>';
      renderPaginationControls(1);
      return;
    }

    // use paginated renderer
    loadTable(requests);
    
    // Display BL auto-generated alerts
    displayBlAutoGeneratedAlerts().catch(err => console.error('Error displaying BL alerts:', err));
  } catch (e) {
    // fallback to localStorage
    requests = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    currentPage = 1;
    loadTable(requests);
  }
}
// Fetch invoices from the central backend endpoint and cache them by request_id and bl_number
async function fetchInvoices() {
  try {
    // Use centralized axios instance `api` so Authorization interceptor applies
    // and so errors are visible in console (no more silent failures).
    const resp = await api.get('/api/client/invoices');
    const invoices = resp?.data?.invoices || [];
    invoicesMap = new Map();
    invoices.forEach(inv => {
      const normalized = {
        ...inv,
        amount_due: inv.amount_due ?? inv.amount ?? null,
        status: inv.status ?? inv.invoice_status ?? null
      };

      if (normalized.request_id) {
        invoicesMap.set(String(normalized.request_id), normalized);
      }
      if (normalized.bl_number) {
        invoicesMap.set(String(normalized.bl_number), normalized);
      }
      // also cache by invoice id
      if (normalized.id) invoicesMap.set(String(normalized.id), normalized);
    });
  } catch (e) {
    // Surface errors to help diagnose why `/api/client/invoices` fails in prod
    // (401, CORS, network...). Keep caching best-effort behavior.
    try {
      if (e && e.response) {
        console.warn('fetchInvoices: backend responded with error', { status: e.response.status, data: e.response.data });
      } else {
        console.warn('fetchInvoices: request failed', e);
      }
    } catch (logErr) {
      console.warn('fetchInvoices: error while logging failure', logErr);
    }
  }
}

function loadTable(data = null) {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  // Determine full dataset to paginate (data param is treated as the full dataset)
  const full = Array.isArray(data) ? data : requests;
  const totalItems = full.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageSlice = full.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageSlice.map(row => {
    // Make Invoice # column show the correct invoice_number
    const requestKey = String(row.request_id || row.id || '');
    const invoiceFromApi =
      invoicesMap.get(requestKey) ||
      invoicesMap.get(String(row.bl_number || row.bl || row.extracted_bl || '')) ||
      null;
    const displayInvoiceValue = (invoiceFromApi && invoiceFromApi.invoice_number)
      ? invoiceFromApi.invoice_number
      : (row.invoice_number || row.inv || row.invoice || null);

    // Robust updated display: accept updated_at, created_at or pre-computed updated
    const updatedDisplay = new Date(row.updated_at || row.created_at || row.updated || Date.now()).toLocaleString();
    const invStatus = row.invStatus || row.inv_status || '';
    const invDataAttr = row.invoice_number || row.inv || row.invoice || '';
    const isConfirmed = String(row.status) === 'PAYMENT_CONFIRMED' || String(row.status) === 'COMPLETED';
    // Prefer showing invoice reference (e.g. MKC-INV-006). If missing, fall back to amount display.
    const amountVal = (invoiceFromApi && invoiceFromApi.amount_due != null) ? invoiceFromApi.amount_due : (row.amount || row.amount_due || null);
    const displayLabel = displayInvoiceValue ? String(displayInvoiceValue) : (amountVal ? formatAmountValue(amountVal) : '');
    const invNum = invDataAttr || row.request_id || row.id || '';
    const dateStr = new Date(row.updated_at || row.created_at || Date.now()).toLocaleDateString();
    // derive client fields (support multiple possible shapes)
    const nom = row.nom || row.lastName || (row.profiles && row.profiles.nom) || row.client_name || '';
    const prenom = row.prenom || row.firstName || (row.profiles && row.profiles.prenom) || '';
    const email = row.email || row.client_email || row.contact_email || (row.profiles && row.profiles.email) || '';

    const invoiceHref = buildInvoiceUrl({ invoice: invNum, amount: amountVal, bl: row.bl || row.bl_number || '', ref: row.ref || '', date: dateStr, nom, prenom, email });
    const invHtml = displayLabel ? (
      `<a href="${invoiceHref}" class="invoice-link" title="Télécharger la facture" target="_blank" rel="noopener noreferrer" data-request="${escapeHtml(String(row.request_id || row.id || ''))}" data-bl="${escapeHtml(row.bl)}" data-inv="${escapeHtml(invDataAttr)}" data-invstatus="${escapeHtml(invStatus)}" data-amount="${escapeHtml(String(amountVal || ''))}" data-nom="${escapeHtml(nom || '')}" data-prenom="${escapeHtml(prenom || '')}" data-email="${escapeHtml(email || '')}">` +
      (isConfirmed
        ? `<div class="invoice-box inv-green inv-confirmed"><i class="fas fa-check-circle" style="color:#10B981; margin-right:6px;"></i><strong>${escapeHtml(String(displayLabel))}</strong></div>`
        : `<div class="invoice-box ${invStatus === 'ok' ? 'inv-green' : 'inv-red'}"><i class="fas fa-file-download"></i><span>${escapeHtml(String(displayLabel))}</span></div>`)
      + `</a>`
    ) : '---';

    // Actions column: show draft availability and provide draft-download action
    const draftAvailable = row.draft_url || row.draftUrl || row.request_draft_url || null;
    const isFeri = Boolean(row.feri_ref || row.feri_signed_url || row.feriSignedUrl);
    const reqType = (row.type || row.request_type || row.requestType || row.service_type || '').toString();
    const status = row.status || '';
    
    // Determine availability label based on status and request type
    // If in draft/payment stage, show 'Draft Sent', otherwise show type-based label
    let availabilityLabel = 'Available';
    if (status === 'DRAFT_SENT' || status === 'PAYMENT_PROOF_UPLOADED' || status === 'AWAITING_PAYMENT') {
      availabilityLabel = 'Draft Sent';
    } else {
      if (reqType === 'AD_ONLY') availabilityLabel = 'AD Available';
      else if (reqType === 'FERI_ONLY' && isFeri) availabilityLabel = 'FERI Available';
      else if (reqType === 'FERI_AND_AD' && isFeri) availabilityLabel = 'FERI_AND_AD Available';
    }
    
    const docAction = draftAvailable
      ? `<a href="#" class="draft-download" data-request="${escapeHtml(String(row.request_id || row.id || ''))}" data-draft="${escapeHtml(draftAvailable)}" data-type="${isFeri ? 'FERI' : 'DRAFT'}" title="Afficher/Télécharger le draft"><i class="far fa-file-pdf" style="color: #78B13F; cursor: pointer;"></i> ${escapeHtml(availabilityLabel)}</a>`
      : `<a href="#" class="draft-download" data-request="${escapeHtml(String(row.request_id || row.id || ''))}" data-type="${isFeri ? 'FERI' : 'DRAFT'}" title=""><i class="far fa-file-pdf text-muted" title=""></i></a>`;

    // BL display: prefer extracted BLs, then manual_bl; otherwise show inline input to allow manual entry
    const blValCell = row.bl || row.bl_number || row.extracted_bl || row.bill_of_lading || '';
    const manualBlCell = row.manual_bl || row.manualBl || '';
    let blCellHtml = '';
    if (blValCell) {
      blCellHtml = escapeHtml(blValCell);
    } else if (manualBlCell) {
      const blGenLabel = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('bl_generator') : 'BL generator';
      blCellHtml = `${escapeHtml(manualBlCell)} <small style="color:#6b7280; margin-left:6px;">(${escapeHtml(blGenLabel)})</small>`;
    } else {
      const rid = escapeHtml(String(row.request_id || row.id || ''));
      blCellHtml = `<span class="badge warn">BL généré automatiquement</span>`;
    }

    const statusLabel = translateStatus(row.status || '');
    return `
      <tr>
        <td style="color: #3B82F6; font-weight: 500;">${blCellHtml}</td>
        <td>${escapeHtml(row.ref || '---')}</td>
        <td>${escapeHtml(updatedDisplay)}</td>
        <td><span class="status ${escapeHtml(row.status)}">${escapeHtml(statusLabel)}</span></td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/6/6f/Flag_of_the_Democratic_Republic_of_the_Congo.svg" width="20" alt="flag">
            ${escapeHtml(row.country)}
          </div>
        </td>
        <td>${invHtml}</td>
        <td>${docAction}</td>
      </tr>
    `;
  }).join('');

  // update entries info
  const info = document.getElementById('entries-info');
  if (info) {
    const showingStart = totalItems === 0 ? 0 : start + 1;
    const showingEnd = Math.min(totalItems, start + PAGE_SIZE);
    info.textContent = `Showing ${showingStart}-${showingEnd} of ${totalItems} entries`;
  }

  // render pagination controls
  renderPaginationControls(totalPages);
}

// --- FILTERS ---
function parseDateField(row) {
  const d = row.updated_at || row.created_at || row.updated || null;
  return d ? new Date(d) : null;
}

function getRequestType(row) {
  return (row.type || row.request_type || row.requestType || row.service_type || '').toString();
}

function applyFilters() {
  const dateSel = document.getElementById('filter-date');
  const statusSel = document.getElementById('filter-status');
  const typeSel = document.getElementById('filter-type');

  const dateVal = dateSel ? dateSel.value : 'all';
  const statusVal = statusSel ? statusSel.value : 'all';
  const typeVal = typeSel ? typeSel.value : 'all';

  const now = Date.now();

  const filtered = requests.filter(r => {
    // date filter
    if (dateVal && dateVal !== 'all') {
      const d = parseDateField(r);
      if (!d) return false;
      const diffDays = (now - d.getTime()) / (1000 * 60 * 60 * 24);
      if (dateVal === 'today' && diffDays >= 1) return false;
      if (dateVal === '7' && diffDays > 7) return false;
      if (dateVal === '30' && diffDays > 30) return false;
    }

    // status filter
    if (statusVal && statusVal !== 'all') {
      const s = (r.status || r.state || '').toString();
      if (!s.toLowerCase().includes(statusVal.toLowerCase())) return false;
    }

    // type filter
    if (typeVal && typeVal !== 'all') {
      const t = getRequestType(r);
      if (!t) return false;
      if (!t.toLowerCase().includes(typeVal.toLowerCase())) return false;
    }

    return true;
  });

  currentPage = 1;
  loadTable(filtered);
}

function populateFilterOptions() {
  // Populate status and type selects from current requests
  const statusSel = document.getElementById('filter-status');
  const typeSel = document.getElementById('filter-type');
  if (!statusSel || !typeSel) return;

  const statuses = new Set();
  const types = new Set();
  requests.forEach(r => {
    if (r.status) statuses.add(r.status);
    const t = getRequestType(r);
    if (t) types.add(t);
  });

  // clear existing options except the "all"
  statusSel.querySelectorAll('option:not([value="all"])').forEach(o => o.remove());
  typeSel.querySelectorAll('option:not([value="all"])').forEach(o => o.remove());

  Array.from(statuses).sort().forEach(s => {
    const opt = document.createElement('option'); opt.value = s; opt.textContent = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(s) : s; statusSel.appendChild(opt);
  });
  Array.from(types).sort().forEach(t => {
    const opt = document.createElement('option'); opt.value = t; opt.textContent = t; typeSel.appendChild(opt);
  });
}

// --- PAGINATION HELPERS ---
function renderPaginationControls(totalPages) {
  let container = document.getElementById('pagination');
  if (!container) {
    // try to insert after entries-info
    const info = document.getElementById('entries-info');
    container = document.createElement('div');
    container.id = 'pagination';
    container.style.marginTop = '10px';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    if (info && info.parentElement) info.parentElement.appendChild(container);
    else document.body.appendChild(container);
  }

  container.innerHTML = '';

  const prev = document.createElement('button');
  prev.textContent = 'Prev';
  prev.disabled = currentPage <= 1;
  prev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadTable(); } });
  container.appendChild(prev);

  const pageLabel = document.createElement('span');
  pageLabel.textContent = `Page ${currentPage} / ${totalPages}`;
  pageLabel.style.margin = '0 8px';
  container.appendChild(pageLabel);

  const next = document.createElement('button');
  next.textContent = 'Next';
  next.disabled = currentPage >= totalPages;
  next.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; loadTable(); } });
  container.appendChild(next);
}

function renderRow(r) {
  // map backend fields to frontend-friendly shape
  const blVal = r.bl_number || r.bl || r.extracted_bl || r.bill_of_lading || '';
  const blConf = (typeof r.bl_confidence === 'number') ? r.bl_confidence : (typeof r.blConfidence === 'number' ? r.blConfidence : null);
  const ref = r.ref || r.reference || '';
  const updated = new Date(r.updated_at || r.created_at || Date.now()).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const status = r.status || r.state || 'UNKNOWN';
  const country = r.country || '';
  // Prefer amount/amount_due to be shown in the Invoice column (keep behavior identical to Amount Due)
  const requestKey = String(r.request_id || r.id || '');
  const invoiceFromApi =
    invoicesMap.get(requestKey) ||
    invoicesMap.get(String(r.bl_number || r.bl || r.extracted_bl || '')) ||
    null;
  const invoice = (invoiceFromApi && invoiceFromApi.amount_due !== null && invoiceFromApi.amount_due !== undefined)
    ? `${invoiceFromApi.amount_due} ${invoiceFromApi.currency || ''}`.trim()
    : ((r.amount || r.amount_due) ? (r.amount || r.amount_due) : (r.invoice_number || r.inv || r.invoice || null));
  const invStatus = r.inv_status || r.invStatus || null;
  const ectn = r.ectn_number || r.ectn || '';
  const feriRef = r.feri_ref || r.feriRef || '';

  const invDataAttr = r.inv || r.invoice || r.invoice_number || '';
  const isConfirmed = String(r.status) === 'PAYMENT_CONFIRMED' || String(r.status) === 'COMPLETED';
  // Prefer invoice reference string (MKC-INV-006). If not present, show amount.
  const invoiceRef = (invoiceFromApi && invoiceFromApi.invoice_number) ? invoiceFromApi.invoice_number : (r.invoice_number || r.inv || r.invoice || null);
  const amountValLocal = (invoiceFromApi && invoiceFromApi.amount_due !== null && invoiceFromApi.amount_due !== undefined) ? invoiceFromApi.amount_due : (r.amount || r.amount_due || null);
  const pretty = invoiceRef ? String(invoiceRef) : (amountValLocal ? formatAmountValue(amountValLocal) : '');
    const invHtml = pretty ? (
      `<a href="#" class="invoice-link" title="Télécharger" data-request="${escapeHtml(String(r.request_id || r.id || ''))}" data-bl="${escapeHtml(blVal)}" data-inv="${escapeHtml(invDataAttr)}" data-invstatus="${escapeHtml(invStatus || '')}">` +
      (isConfirmed
        ? `<div class="invoice-box inv-green inv-confirmed"><i class="fas fa-check-circle" style="color:#10B981; margin-right:6px;"></i><strong>${escapeHtml(String(pretty))}</strong></div>`
        : `<div class="invoice-box ${invStatus === 'ok' ? 'inv-green' : 'inv-red'}"><i class="fas fa-file-download"></i><span>${escapeHtml(String(pretty))}</span></div>`)
      + `</a>`
    ) : '---';

  const feriUrlRow = feriRef || r.feri_signed_url || r.feriSignedUrl || null;
  const reqTypeRow = (r.type || r.request_type || r.requestType || r.service_type || '').toString();
  const statusRow = r.status || '';
  
  // Determine availability label based on status and request type
  let availabilityLabelRow = 'Available';
  if (statusRow === 'DRAFT_SENT' || statusRow === 'PAYMENT_PROOF_UPLOADED' || statusRow === 'AWAITING_PAYMENT') {
    availabilityLabelRow = 'Draft Sent';
  } else {
      if (reqTypeRow === 'AD_ONLY') availabilityLabelRow = 'AD Available';
      else if (reqTypeRow === 'FERI_ONLY' && feriUrlRow) availabilityLabelRow = 'FERI Available';
      else if (reqTypeRow === 'FERI_AND_AD' && feriUrlRow) availabilityLabelRow = 'FERI_AND_AD Available';
  }
  let docsList = [];
  if (Array.isArray(r.feri_deliveries) && r.feri_deliveries.length) docsList = docsList.concat(r.feri_deliveries);
  if (Array.isArray(r.deliveries) && r.deliveries.length) docsList = docsList.concat(r.deliveries);
  if (Array.isArray(r.documents) && r.documents.length) docsList = docsList.concat(r.documents.filter(d => d.category === 'FINAL' || d.category === 'FINAL_FERI' || d.category === 'FINAL_AD'));
  if (feriUrlRow) docsList.push({ url: feriUrlRow, file_name: availabilityLabelRow });

  const buildHref = (d) => d.downloadUrl || d.signedUrl || d.pdf_url || d.pdfUrl || d.url || d.file_path || d.filePath || null;
  const buildName = (d) => d.file_name || d.fileName || d.name || (d.url ? d.url.split('/').pop() : null) || availabilityLabelRow;

  let docAction = '<i class="far fa-file-pdf text-muted" title="Document non disponible"></i>';
  if (docsList.length > 0) {
    const parts = docsList.map(d => {
      const href = buildHref(d) || null;
      const name = escapeHtml(String(buildName(d) || 'Document'));
      if (href) {
        return `<a class="doc-download" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"><i class="far fa-file-pdf" style="color: #78B13F; cursor: pointer;"></i> ${name}</a>`;
      }
      return `<span style="color:#6b7280;">${name}</span>`;
    });
    docAction = parts.join('<br>');
  }

  // BL display: prefer extracted BLs, then manual_bl; otherwise show input to allow manual entry
  const manualBl = r.manual_bl || r.manualBl || '';
  const blDisplay = blVal
    ? escapeHtml(blVal)
    : (manualBl ? `${escapeHtml(manualBl)} <small style="color:#6b7280; margin-left:6px;">(${escapeHtml((window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('bl_generator') : 'BL generator')})</small>` : `<span class="badge warn">BL généré automatiquement</span>`);

  const statusLabel = translateStatus(status);
  return `
      <tr>
        <td style="color: #3B82F6; font-weight: 500;">${blDisplay}</td>
        <td>${escapeHtml(ref || '---')}</td>
        <td>${escapeHtml(updated)}</td>
        <td><span class="status ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/6/6f/Flag_of_the_Democratic_Republic_of_the_Congo.svg" width="20" alt="flag">
            ${escapeHtml(country)}
          </div>
        </td>
        <td>${invHtml}</td>
        <td style="color: #64748b;">${escapeHtml(feriRef || ectn || '---')}</td>
        <td>${docAction}</td>
      </tr>
    `;
}

// --- RECHERCHE ET BIND UI ---
function bindUIEvents() {
  const kw = document.getElementById('keywordSearch');
  if (kw) {
    kw.addEventListener('input', function (e) {
      const term = e.target.value.toLowerCase();
      const filtered = requests.filter(row =>
        (row.bl && row.bl.toLowerCase().includes(term)) ||
        (row.status && row.status.toLowerCase().includes(term)) ||
        (row.ref && row.ref.toLowerCase().includes(term))
      );
      currentPage = 1;
      loadTable(filtered);
    });
  }

  // Buttons
  const openModalBtn = document.getElementById('open-modal-btn');
  if (openModalBtn) openModalBtn.addEventListener('click', openModal);

  const menuTrigger = document.getElementById('menu-trigger');
  if (menuTrigger) menuTrigger.addEventListener('click', toggleMenu);

  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', toggleMenu);

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadTable());

  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    const ks = document.getElementById('keywordSearch');
    if (ks) ks.value = '';
    // reset filters too
    const dateSel = document.getElementById('filter-date'); if (dateSel) dateSel.value = 'all';
    const statusSel = document.getElementById('filter-status'); if (statusSel) statusSel.value = 'all';
    const typeSel = document.getElementById('filter-type'); if (typeSel) typeSel.value = 'all';
    loadTable();
  });

  // Popup buttons
  const notifBtn = document.getElementById('notif-btn');
  const settingsBtn = document.getElementById('settings-btn');
  if (notifBtn) notifBtn.addEventListener('click', () => togglePopup('notif', notifBtn));
  if (settingsBtn) settingsBtn.addEventListener('click', () => togglePopup('settings', settingsBtn));

  // Close button inside messages popup
  const popupCloseBtn = document.getElementById('popup-settings-close');
  if (popupCloseBtn) {
    popupCloseBtn.addEventListener('click', () => {
      // prefer toggling via the trigger so aria-expanded updates
      const trigger = document.getElementById('settings-btn');
      togglePopup('settings', trigger || null);
    });
  }

  // filter selects
  const dateSel = document.getElementById('filter-date'); if (dateSel) dateSel.addEventListener('change', applyFilters);
  const statusSel = document.getElementById('filter-status'); if (statusSel) statusSel.addEventListener('change', applyFilters);
  const typeSel = document.getElementById('filter-type'); if (typeSel) typeSel.addEventListener('change', applyFilters);

  // language selector: update i18n and re-render status labels when changed
  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      try {
        if (window.i18n && typeof window.i18n.setLang === 'function') window.i18n.setLang(langSel.value);
      } catch (e) { /* ignore */ }
      try { populateFilterOptions(); } catch (e) { /* ignore */ }
      try { loadTable(); } catch (e) { /* ignore */ }
    });
  }

  // Modal close and submit
  const modalClose = document.getElementById('modal-close-btn');
  if (modalClose) modalClose.addEventListener('click', closeModal);
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.addEventListener('click', submitNewRequest);

  // Option buttons in modal (delegation)
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type') || 'UNKNOWN';
      goToStep2(type);
    });
  });

  // File inputs: robust label resolution (file- -> label-)
  document.querySelectorAll('.doc-upload-btn input[type="file"]').forEach(inp => {
    inp.setAttribute('accept', '.pdf,.jpg,.jpeg,.png');
    inp.addEventListener('change', function () {
      const fileId = this.id || '';
      const labelId = fileId.startsWith('file-') ? 'label-' + fileId.slice(5) : null;
      updateFileName(this, labelId);
    });
  });

  // Delegated handlers for invoice/document downloads rendered in table
  const tableBody = document.getElementById('table-body');
  if (tableBody) {
    tableBody.addEventListener('click', function (e) {
      const invLink = e.target.closest('.invoice-link');
      if (invLink) {
        // Intercept invoice link clicks so we create the invoice server-side first,
        // then open Facture_.html?invoice_id=<id> which will load persisted data.
        e.preventDefault();
        const requestId = invLink.getAttribute('data-request') || '';
        const bl = invLink.getAttribute('data-bl') || '';
        const inv = invLink.getAttribute('data-inv') || '';
        const amount = invLink.getAttribute('data-amount') || '';
        const nom = invLink.getAttribute('data-nom') || '';
        const prenom = invLink.getAttribute('data-prenom') || '';
        const email = invLink.getAttribute('data-email') || '';

        // If there's already an invoice id in the href query, allow normal navigation
        const href = invLink.getAttribute('href') || '';
        const params = new URLSearchParams(href.split('?')[1] || '');
        const existingInvoiceId = params.get('invoice_id') || params.get('invoiceId');
        if (existingInvoiceId) {
          window.open(href, '_blank');
          return;
        }

        // Call backend to create or return existing invoice
        (async () => {
          try {
            const payload = {
              request_id: requestId,
              amount: amount || null,
              currency: 'XAF',
              bill_of_lading: bl || null,
              customer_reference: inv || null,
              customer_nom: nom || null,
              customer_prenom: prenom || null,
              customer_email: email || null
            };
            const resp = await api.post('/api/client/invoices', payload);
            if (resp && resp.data && resp.data.success && resp.data.invoice) {
              const invoice = resp.data.invoice;
              const invoiceId = invoice.id || invoice.invoice_id || null;
              if (invoiceId) {
                const openUrl = `Facture_.html?invoice_id=${encodeURIComponent(invoiceId)}&download=1`;
                window.open(openUrl, '_blank');
                return;
              }
            }
            // Fallback: if create failed, try original href
            if (href) window.open(href, '_blank');
          } catch (err) {
            console.error('Failed to create/open invoice', err);
            if (href) window.open(href, '_blank');
          }
        })();

        return;
      }
      const draftLink = e.target.closest('.draft-download');
      if (draftLink) {
        e.preventDefault();
        // First click: show availability text; second click downloads.
        if (!draftLink.dataset.shown) {
          const dtype = draftLink.getAttribute('data-type') || 'DRAFT';
          draftLink.dataset.shown = '1';
          const rid = draftLink.getAttribute('data-request');
          let reqObj = null;
          try {
            reqObj = requests.find(r => String(r.request_id || r.id || '') === String(rid));
          } catch (err) {
            reqObj = null;
          }

          // Gather final documents from the cached request object (FERI + AD)
          const docs = [];
          if (reqObj) {
            if (Array.isArray(reqObj.feri_deliveries) && reqObj.feri_deliveries.length) docs.push(...reqObj.feri_deliveries);
            if (Array.isArray(reqObj.deliveries) && reqObj.deliveries.length) docs.push(...reqObj.deliveries);
            if (Array.isArray(reqObj.documents) && reqObj.documents.length) docs.push(...reqObj.documents.filter(d => d.category === 'FINAL' || d.category === 'FINAL_FERI' || d.category === 'FINAL_AD'));
            const feriUrlRow = reqObj.feri_ref || reqObj.feri_signed_url || reqObj.feriSignedUrl || null;
            if (feriUrlRow) docs.push({ url: feriUrlRow, file_name: 'FERI' });
          }

          if (docs.length > 0) {
            const parts = docs.map(d => {
              const href = d.downloadUrl || d.signedUrl || d.pdf_url || d.pdfUrl || d.url || d.file_path || d.filePath || null;
              const name = escapeHtml(String(d.file_name || d.fileName || d.name || (d.url ? d.url.split('/').pop() : 'Document')));
              if (href && typeof href === 'string') {
                return `<a class="doc-download" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"><i class="far fa-file-pdf" style="color: #78B13F; cursor: pointer;"></i> ${name}</a>`;
              }
              return `<span style="color:#6b7280;">${name}</span>`;
            });
            draftLink.innerHTML = parts.join('<br>');
          } else {
            // fallback to previous availability label behavior
            let reqTypeLabel = '';
            let statusLabel = '';
            try { 
              reqTypeLabel = (reqObj && (reqObj.type || reqObj.request_type || reqObj.requestType || reqObj.service_type)) || ''; 
              statusLabel = (reqObj && reqObj.status) || '';
            } catch (e) { 
              reqTypeLabel = ''; 
              statusLabel = '';
            }
            
            // Determine availability label based on status
            let availabilityText = 'Draft Available';
            if (statusLabel === 'DRAFT_SENT' || statusLabel === 'PAYMENT_PROOF_UPLOADED' || statusLabel === 'AWAITING_PAYMENT') {
              availabilityText = 'Draft Sent';
            } else {
              // only mark as FERI available if a FERI URL/reference exists on the request
              const hasFeri = Boolean(reqObj && (reqObj.feri_ref || reqObj.feri_signed_url || reqObj.feriSignedUrl || reqObj.feriRef));
              if (dtype === 'FERI' && hasFeri) {
                availabilityText = 'FERI Available';
              } else if (reqTypeLabel === 'AD_ONLY') {
                availabilityText = 'AD Available';
              } else if (reqTypeLabel === 'FERI_ONLY' && hasFeri) {
                availabilityText = 'FERI Available';
              } else if (reqTypeLabel === 'FERI_AND_AD' && hasFeri) {
                availabilityText = 'FERI_AND_AD Available';
              }
            }
            draftLink.innerHTML = `<span class="draft-available">${escapeHtml(availabilityText)}</span>`;
          }

          // restore icon/text after 6s
          const iconEl = draftLink.querySelector('i');
          const wasMuted = iconEl && iconEl.classList.contains('text-muted');
          const restoreColor = wasMuted ? '#999' : '#78B13F';
          setTimeout(() => {
            if (draftLink && draftLink.dataset) {
              delete draftLink.dataset.shown;
              draftLink.innerHTML = `<i class="far fa-file-pdf" style="color: ${restoreColor}; cursor: pointer;"></i>`;
            }
          }, 6000);
          return;
        }
        const requestId = draftLink.getAttribute('data-request') || '';
        downloadDraft(requestId);
        return;
      }
      const docLink = e.target.closest('.doc-download');
      if (docLink) {
        const href = docLink.getAttribute('href') || '';
        // If a signed URL is present, allow the browser to open it (target="_blank")
        if (href && href.startsWith('http')) {
          return;
        }
        e.preventDefault();
        const bl = docLink.getAttribute('data-bl') || '';
        downloadDocument(bl);
        return;
      }
    });
  }

  // Close popups when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-popup') && !e.target.closest('#notif-btn') && !e.target.closest('#settings-btn')) {
      document.querySelectorAll('.dropdown-popup').forEach(p => {
        p.classList.remove('show-popup');
        p.setAttribute('aria-hidden', 'true');
      });
      if (notifBtn) notifBtn.setAttribute('aria-expanded', 'false');
      if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // Close modal/popup on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.querySelectorAll('.dropdown-popup').forEach(p => {
        p.classList.remove('show-popup');
        p.setAttribute('aria-hidden', 'true');
      });
      if (notifBtn) notifBtn.setAttribute('aria-expanded', 'false');
      if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

// --- GESTION DES POP-UPS ---
function togglePopup(type, triggerBtn) {
  const popupId = type === 'notif' ? 'popup-notif' : 'popup-settings';
  const popup = document.getElementById(popupId);
  if (!popup) return;

  // close others
  document.querySelectorAll('.dropdown-popup').forEach(p => {
    if (p.id !== popupId) {
      p.classList.remove('show-popup');
      p.setAttribute('aria-hidden', 'true');
      p.style.display = 'none';
    }
  });

  const isShown = popup.classList.toggle('show-popup');
  popup.style.display = isShown ? 'block' : 'none';
  popup.setAttribute('aria-hidden', isShown ? 'false' : 'true');

  if (triggerBtn) {
    triggerBtn.setAttribute('aria-expanded', isShown ? 'true' : 'false');
  }

  // If opening notifications popup, load notifications and mark unread as read
  if (type === 'notif' && isShown) {
    loadNotifications().catch(() => {});
  }
  // If opening settings popup (now repurposed as Messages), load messages
  if (type === 'settings' && isShown) {
    try {
      // load the messages page into an iframe inside the popup so it behaves like
      // a full HTML page while staying inside the dashboard layout
      const body = document.getElementById('popup-settings-body');
      if (body) {
        body.innerHTML = `<iframe src="messages_page.html" style="width:100%; height:100%; border:0; border-radius:0; display:block;"></iframe>`;
      }
    } catch (e) { console.warn('loadMessages iframe failed', e); }
  }
}

// --- NOTIFICATIONS: polling, render and badge ---
let notifPollInterval = null;
async function loadNotifications() {
  const badge = document.getElementById('notif-badge');
  const body = document.getElementById('popup-notif-body') || document.querySelector('#popup-notif .popup-body');
  if (!body) return;

  try {
    const res = await api.get('/notifications');
    const list = (res && res.data && res.data.data) ? res.data.data : (res.data || []);

    if (!Array.isArray(list) || list.length === 0) {
      body.innerHTML = '<div class="notif-item">Aucune notification</div>';
      if (badge) {
        badge.textContent = '';
        badge.style.display = 'none';
      }
      return;
    }

    const unread = list.filter(n => !n.is_read);
    if (badge) {
      const count = unread.length || 0;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = count > 0 ? 'inline-block' : 'none';
      badge.setAttribute('aria-label', count > 0 ? `${count} notifications non lues` : '0 notifications');
    }

    body.innerHTML = list.slice().reverse().map(n => {
      const title = escapeHtml(n.title || 'Notification');
      const msg = escapeHtml(n.message || '');
      const ref = n.entity_id || (n.metadata && n.metadata.requestRef) || '';
      const time = n.created_at ? new Date(n.created_at).toLocaleString() : '';

        if (n.type === 'REQUEST_STATUS_CHANGED') {
        const reference = escapeHtml(ref || n.entity_id || '');
        const lang = (window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'fr';
        const statusLabel = escapeHtml(translateStatus('PROCESSING'));
        const greeting = (lang === 'en') ? 'Hello' : 'Bonjour';
        const referenceLabel = (lang === 'en') ? 'Reference' : 'Référence';
        const processingText = (lang === 'en')
          ? `Your file is now being processed (<strong>${statusLabel}</strong>). No action is required from you at this time.`
          : `Votre dossier est désormais en cours de traitement (<strong>${statusLabel}</strong>).<br/>Aucune action n\'est requise de votre part pour le moment.`;

        return `
          <div class="notif-item" data-id="${escapeHtml(n.id)}">
            <div class="title">🟢 ${statusLabel}</div>
            <div class="message">
              <p>${greeting},</p>

              <p>${lang === 'en' ? 'We have received and validated the documents for your FERI request.' : 'Nous avons bien reçu et validé les documents de votre demande FERI.'}</p>

              <p><strong>${referenceLabel} :</strong> ${reference}</p>

              <p>${processingText}</p>

              <p>${lang === 'en' ? 'You will be notified at the next step.' : 'Vous serez informé(e) dès la prochaine étape.'}</p>
            </div>
            <div class="meta">${time}</div>
          </div>`;
      }

      return `
        <div class="notif-item" data-id="${escapeHtml(n.id)}">
          <div class="title">${title}</div>
          <div class="message">${msg}</div>
          <div class="meta">${ref ? 'Ref: ' + escapeHtml(ref) + ' • ' : ''}${time}</div>
        </div>`;
    }).join('');

    // Mark unread as read when popup opened
    const unreadIds = unread.map(u => u.id).filter(Boolean);
    if (unreadIds.length) {
      await Promise.all(unreadIds.map(id => api.patch(`/notifications/${id}/read`).catch(() => {})));
      if (badge) {
        badge.textContent = '';
        badge.style.display = 'none';
      }
    }

  } catch (e) {
    body.innerHTML = `<div class="notif-item">Impossible de charger les notifications</div>`;
    if (badge) {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }
}

function startNotifPolling() {
  loadNotifications().catch(() => {});
  if (notifPollInterval) clearInterval(notifPollInterval);
  notifPollInterval = setInterval(() => loadNotifications().catch(() => {}), 15000);
}

// --- ALERTS: Display BL auto-generated alerts from notifications ---
async function displayBlAutoGeneratedAlerts() {
  const container = document.getElementById('alerts-container');
  if (!container) return;

  try {
    const res = await api.get('/notifications');
    const list = (res && res.data && res.data.data) ? res.data.data : (res.data || []);
    
    // Filter for BL_AUTO_GENERATED notifications that are unread
    const blAlerts = list.filter(n => n.type === 'BL_AUTO_GENERATED' && !n.is_read);
    
    if (blAlerts.length === 0) {
      container.innerHTML = '';
      return;
    }

    // Create alert HTML for each BL_AUTO_GENERATED notification
    const alertsHtml = blAlerts.map(alert => {
      const blRef = (alert.metadata && alert.metadata.bl_reference) ? escapeHtml(alert.metadata.bl_reference) : '';
      const defaultMsg = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t('bl_auto_generated_alert') : "We couldn't detect your BL reference. A BL reference has been automatically generated.";
      const message = escapeHtml(alert.message || defaultMsg);
      const alertId = escapeHtml(alert.id);
      
      return `
        <div class="alert alert-info" data-alert-id="${alertId}" role="alert">
          <i class="fas fa-info-circle"></i>
          <div>
            <strong>${escapeHtml(alert.title || 'Bill of Lading Generated')}</strong><br/>
            ${message}
            ${blRef ? `<br/><strong>Reference: ${blRef}</strong>` : ''}
          </div>
          <button class="alert-close-btn" type="button" aria-label="Fermer" onclick="closeAlert('${alertId}')">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
    }).join('');

    container.innerHTML = alertsHtml;
  } catch (e) {
    console.error('Error loading BL alerts:', e);
  }
}

function closeAlert(alertId) {
  const alert = document.querySelector(`[data-alert-id="${alertId}"]`);
  if (alert) {
    alert.style.opacity = '0';
    alert.style.transition = 'opacity 0.3s ease';
    setTimeout(() => alert.remove(), 300);
    
    // Mark as read in backend
    api.patch(`/notifications/${alertId}/read`).catch(() => {});
  }
}

// --- MESSAGING (simple client-side popup) ---
function loadMessages() {
  const body = document.getElementById('popup-messages-body');
  if (!body) return;
  const stored = JSON.parse(localStorage.getItem('dashboard_messages_v1') || '[]');
  if (!stored || !stored.length) {
    body.innerHTML = '<div class="msg-empty" style="color:#6b7280">No messages</div>';
    return;
  }
  // render messages
  body.innerHTML = stored.map(m => {
    const who = escapeHtml(m.from || 'User');
    const txt = escapeHtml(m.text || '');
    const time = m.created_at ? new Date(m.created_at).toLocaleString() : '';
    const isMe = (m.from === 'Me');
    return `<div style="margin-bottom:8px; display:flex; ${isMe ? 'justify-content:flex-end' : 'justify-content:flex-start'};">
      <div style="max-width:78%; background:${isMe ? '#DBEAFE' : '#F3F4F6'}; padding:8px 10px; border-radius:8px; box-shadow:0 1px 0 rgba(0,0,0,0.02);">
        <div style="font-size:13px; color:#111;">${txt}</div>
        <div style="font-size:11px; color:#6b7280; margin-top:6px; text-align:right;">${escapeHtml(time)}</div>
      </div>
    </div>`;
  }).join('');
  // scroll to bottom
  setTimeout(() => { body.scrollTop = body.scrollHeight; }, 40);
}

function sendMessage() {
  const input = document.getElementById('message-input');
  if (!input) return;
  const txt = (input.value || '').trim();
  if (!txt) return;
  const stored = JSON.parse(localStorage.getItem('dashboard_messages_v1') || '[]');
  const item = { id: Date.now(), from: 'Me', text: txt, created_at: new Date().toISOString() };
  stored.push(item);
  localStorage.setItem('dashboard_messages_v1', JSON.stringify(stored));
  input.value = '';
  loadMessages();
  // no simulated reply — real backend or admin should respond
}

// --- GESTION DE LA MODALE ---
function openModal() {
  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  const first = modal.querySelector('.option-btn, .input-ref, .doc-upload-btn');
  if (first) first.focus();
}

function closeModal() {
  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  resetModalForm();
}

function goToStep2(type) {
  const title = document.getElementById('modal-title');
  if (title) title.innerText = (type === 'FERI') ? "" : (window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t('modal_title_issue_ctn', { type }) : "Issue a CTN " + type);
  // Map human labels to backend enum values
  const map = {
    'FERI': 'FERI_ONLY',
    'AD': 'AD_ONLY',
    'FERI + AD': 'FERI_AND_AD',
    'FERI + AD': 'FERI_AND_AD'
  };
  selectedRequestType = map[type] || type;
  const s1 = document.getElementById('step-1');
  const s2 = document.getElementById('step-2');
  if (s1) s1.style.display = 'none';
  if (s2) s2.style.display = 'block';
  const selected = document.getElementById('selected-type-display');
  if (selected) {
    if (window.i18n && typeof window.i18n.t === 'function') {
      selected.textContent = window.i18n.t('requirements_for', { type });
    } else {
      selected.textContent = `Requirements for ${type}`;
    }
  }
  // Show/hide FERI vs AD fields in the same modal
  const feriBlock = document.querySelector('.feri-req');
  const adBlock = document.querySelector('.ad-req');
  // Robust visibility handling: explicitly hide/show blocks and descendants,
  // and ensure FXI input is hidden for AD-only.
  function showElement(el) {
    if (!el) return;
    el.style.display = 'block';
    el.setAttribute('aria-hidden', 'false');
    Array.from(el.querySelectorAll('*')).forEach(c => { c.style.display = ''; });
  }
  function hideElement(el) {
    if (!el) return;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    Array.from(el.querySelectorAll('*')).forEach(c => { c.style.display = 'none'; });
  }

  if (type === 'FERI') {
    showElement(feriBlock);
    hideElement(adBlock);
    const fxi = document.getElementById('input-fxi'); if (fxi) fxi.style.display = '';
  } else if (type === 'AD') {
    hideElement(feriBlock);
    showElement(adBlock);
    const fxi = document.getElementById('input-fxi'); if (fxi) fxi.style.display = 'none';
    // Ensure Numéro FERI field is visible for AD-only flows
    try {
      const feriInput = document.getElementById('input-feri');
      const feriLabel = document.querySelector('label[for="input-feri"]');
      if (feriInput) feriInput.style.display = '';
      if (feriLabel) feriLabel.style.display = '';
    } catch (e) {}
  } else { // FERI + AD
    showElement(feriBlock);
    showElement(adBlock);
    const fxi = document.getElementById('input-fxi'); if (fxi) fxi.style.display = '';
    // For combined FERI + AD, remove (hide) the Numéro FERI field per request
    try {
      const feriInput = document.getElementById('input-feri');
      const feriLabel = document.querySelector('label[for="input-feri"]');
      if (feriInput) feriInput.style.display = 'none';
      if (feriLabel) feriLabel.style.display = 'none';
    } catch (e) {}
  }
  // show submit button when on step 2
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.style.display = 'inline-block';
}

// --- GESTION FICHIERS & OCR SIMULÉ ---
function updateFileName(input, labelId) {
  const labelSpan = labelId ? document.getElementById(labelId) : input.parentElement.querySelector('span');
  if (!labelSpan) return;

  if (input.files && input.files.length > 0) {
    const file = input.files[0];
    const MAX_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      labelSpan.innerText = `Fichier trop volumineux (${Math.round(file.size / 1024 / 1024)}MB)`;
      input.value = '';
      return;
    }

    const fileName = file.name;

    if (labelSpan.id === 'label-bl') {
      labelSpan.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Scanning...`;
      if (labelSpan.parentElement) labelSpan.parentElement.classList.add('scanning');

      setTimeout(() => {
        extractedBL = "BL" + Math.floor(100000 + Math.random() * 900000);
        // Do not display the extracted BL value in the UI — show only the filename
        labelSpan.innerHTML = `<strong>${escapeHtml(fileName)}</strong>`;
        if (labelSpan.parentElement) {
          labelSpan.parentElement.classList.remove('scanning');
          labelSpan.parentElement.classList.add('file-selected');
        }
        const submitBtn = document.getElementById('submit-btn');
        if (submitBtn) submitBtn.style.display = 'block';
      }, 1200);
    } else {
      labelSpan.innerText = fileName;
      if (labelSpan.parentElement) labelSpan.parentElement.classList.add('file-selected');
      if (extractedBL) {
        const submitBtn = document.getElementById('submit-btn');
        if (submitBtn) submitBtn.style.display = 'block';
      }
    }
  }
}

// --- SOUMISSION ET RÉINITIALISATION ---
function submitNewRequest() {
  (async () => {
    const submitBtn = document.getElementById('submit-btn');
    let __origSubmitText = null;
    if (submitBtn) {
      __origSubmitText = submitBtn.innerText;
      submitBtn.disabled = true;
      submitBtn.innerText = 'Envoi...';
    }

    const refInput = document.getElementById('refInput');
    const ref = refInput ? refInput.value.trim() : "";

    // Read optional fields: FXI, manual BL and FERI number (FERI may be required for AD flows)

    if (!selectedRequestType) {
      alert('Sélectionnez un type de demande.');
      return;
    }

    const statusEl = document.getElementById('uploadStatus');
    if (statusEl) statusEl.innerText = 'Création de la demande...';

    try {
      // 1) Create request on backend
        const fxiInput = document.getElementById('input-fxi');
        const fxiNumber = fxiInput ? (fxiInput.value || '').trim() : '';
        const manualBlInput = document.getElementById('manual-bl');
        const manualBl = manualBlInput ? (manualBlInput.value || '').trim() : '';

        const feriInput = document.getElementById('input-feri');
        const feriNumber = feriInput ? (feriInput.value || '').trim() : '';
        const vehicleInput = document.getElementById('input-vehicle');
        const vehicleRegistration = vehicleInput ? (vehicleInput.value || '').trim() : '';

        // AD-specific fields
        const transporteurInput = document.getElementById('input-transporteur');
        const carrierName = transporteurInput ? (transporteurInput.value || '').trim() : '';
        const roadAmountInput = document.getElementById('input-road-amount');
        const riverAmountInput = document.getElementById('input-river-amount');
        const roadAmount = roadAmountInput ? (roadAmountInput.value || '').trim() : '';
        const riverAmount = riverAmountInput ? (riverAmountInput.value || '').trim() : '';

        const payload = { type: selectedRequestType, ref: ref };
        if (fxiNumber) payload.fxi_number = fxiNumber;
        if (manualBl) payload.manual_bl = manualBl;
        if (feriNumber) payload.feri_number = feriNumber;
        if (vehicleRegistration) payload.vehicle_registration = vehicleRegistration;
        if (carrierName) payload.carrier_name = carrierName;
        if (roadAmount) payload.transport_road_amount = roadAmount;
        if (riverAmount) payload.transport_river_amount = riverAmount;

        // Validation: for AD-only requests, require FERI number, IM8 file, carrier name and vehicle registration
        const isAdOnly = selectedRequestType === 'AD_ONLY';
        if (isAdOnly) {
          const fileIm8Check = document.getElementById('file-im8');
          if (!feriNumber) {
            alert('Numéro FERI requis pour une demande AD.');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = __origSubmitText || 'Submit'; }
            return;
          }
          if (!fileIm8Check || !fileIm8Check.files || fileIm8Check.files.length === 0) {
            alert('La déclaration IM8 (fichier) est requise pour une demande AD.');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = __origSubmitText || 'Submit'; }
            return;
          }
          if (!carrierName) {
            alert('Nom du transporteur est requis pour une demande AD.');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = __origSubmitText || 'Submit'; }
            return;
          }
          if (!vehicleRegistration) {
            alert('Numéro d\'immatriculation est requis pour une demande AD.');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerText = __origSubmitText || 'Submit'; }
            return;
          }
        }
        const created = await createRequest(payload);
      const requestId = created.id || created[0]?.id || created.request_id || null;
      if (!requestId) throw new Error('Impossible de récupérer l\'ID de la demande');

      if (statusEl) statusEl.innerText = 'Upload des documents...';

      // 2) Collect files and upload via API
      const filesToUpload = [];
      const fileBl = document.getElementById('file-bl');
      const fileFi = document.getElementById('file-fi');
      const fileCi = document.getElementById('file-ci');
      // AD files
      const fileIm8 = document.getElementById('file-im8');
      const fileRoad = document.getElementById('file-road');
      // vehicle registration is now a text input (`input-vehicle`) not a file
      const fileRoadInv = document.getElementById('file-road-inv');
      const fileRiverInv = document.getElementById('file-river-inv');

      if (fileBl && fileBl.files && fileBl.files.length) filesToUpload.push({ type: DOCUMENT_TYPES.BILL_OF_LADING, files: Array.from(fileBl.files) });
      if (fileFi && fileFi.files && fileFi.files.length) filesToUpload.push({ type: DOCUMENT_TYPES.FREIGHT_INVOICE, files: Array.from(fileFi.files) });
      if (fileCi && fileCi.files && fileCi.files.length) filesToUpload.push({ type: DOCUMENT_TYPES.COMMERCIAL_INVOICE, files: Array.from(fileCi.files) });

      // AD pushes
      if (fileIm8 && fileIm8.files && fileIm8.files.length) filesToUpload.push({ type: DOCUMENT_TYPES.CUSTOMS_DECLARATION, files: Array.from(fileIm8.files) });
      if (fileRoad && fileRoad.files && fileRoad.files.length) filesToUpload.push({ type: DOCUMENT_TYPES.ROAD_CARRIER, files: Array.from(fileRoad.files) });
      // no file upload for vehicle registration; value sent as payload.vehicle_registration
      if (fileRoadInv && fileRoadInv.files && fileRoadInv.files.length) filesToUpload.push({ type: DOCUMENT_TYPES.ROAD_FREIGHT_INVOICE, files: Array.from(fileRoadInv.files) });
      if (fileRiverInv && fileRiverInv.files && fileRiverInv.files.length) filesToUpload.push({ type: DOCUMENT_TYPES.RIVER_FREIGHT_INVOICE, files: Array.from(fileRiverInv.files) });

      // also support generic misc uploads if any input with class .doc-file exists
      document.querySelectorAll('.doc-file').forEach(d => {
        const input = d;
        if (input && input.files && input.files.length) filesToUpload.push({ type: input.dataset?.doc || DOCUMENT_TYPES.MISC, files: Array.from(input.files) });
      });

      for (const g of filesToUpload) {
        try {
          await uploadDocuments(requestId, g.type, '', g.files);
        } catch (err) {
          console.warn('Upload failed for', g.type, err);
        }
      }

      if (statusEl) statusEl.innerText = 'Documents envoyés — traitement OCR en cours...';

      // 3) Wait briefly then refresh list (backend will update bl_number when OCR completes)
      // If we have an extracted BL from the quick OCR step, insert a temporary row so user sees it immediately
      if (extractedBL) {
        const tempRow = {
          id: requestId,
          request_id: requestId,
          bl: extractedBL,
          extracted_bl: extractedBL,
          ref: ref || '',
          updated: formatDateNow(),
          status: 'OCR_PENDING',
          country: ''
        };
        // keep requests list in sync locally and render
        requests = [tempRow].concat(requests.filter(r => (r.id || r.request_id) !== requestId));
        saveRequests();
        loadTable(requests);
      }

      setTimeout(async () => {
        await loadRequests();
        if (statusEl) statusEl.innerText = '';
      }, 1500);

      closeModal();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Erreur création/upload');
      const statusEl2 = document.getElementById('uploadStatus');
      if (statusEl2) statusEl2.innerText = '';
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = __origSubmitText || 'Submit';
      }
    }
  })();
}

function resetModalForm() {
  const s1 = document.getElementById('step-1');
  const s2 = document.getElementById('step-2');
  if (s1) s1.style.display = 'block';
  if (s2) s2.style.display = 'none';
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.style.display = 'none';
  const refInput = document.getElementById('refInput');
  if (refInput) refInput.value = "";
  const title = document.getElementById('modal-title');
  if (title) title.innerText = "Select Request Type";

  const labels = [
    { id: 'label-bl', txt: 'Bill of Lading' },
    { id: 'label-fi', txt: 'Freight Invoice' },
    { id: 'label-ci', txt: 'Commercial Invoice' },
    // Export Declaration replaced by FXI input field
  ];

  labels.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) {
      el.innerText = item.txt;
      if (el.parentElement) {
        el.parentElement.classList.remove('file-selected', 'scanning');
      }
    }
  });

  document.querySelectorAll('.doc-upload-btn input[type="file"]').forEach(i => i.value = '');
  const fxi = document.getElementById('input-fxi');
  if (fxi) fxi.value = '';
  // Reset optional inputs including FERI number
  const feri = document.getElementById('input-feri');
  if (feri) feri.value = '';
  const vehicle = document.getElementById('input-vehicle');
  if (vehicle) vehicle.value = '';
  extractedBL = "";
    // reset requirement blocks visibility: default to FERI visible, AD hidden
    const feriBlock = document.querySelector('.feri-req');
    const adBlock = document.querySelector('.ad-req');
    if (feriBlock) feriBlock.style.display = 'block';
    if (adBlock) adBlock.style.display = 'none';
}

// --- DOWNLOAD SIMULÉ (placeholder) ---
async function downloadInvoice(requestId, inv, bl) {
  try {
    // Try to find an URL in the cached invoices map first (prefer requestId, then invoice/bl)
    const keys = [];
    if (requestId) keys.push(String(requestId));
    if (inv) keys.push(String(inv));
    if (bl) keys.push(String(bl));

    let invoice = null;
    for (const k of keys) {
      if (!k) continue;
      invoice = invoicesMap.get(k);
      if (invoice) break;
    }

    // Prefer final invoice URLs first (signed/download/pdf), fall back to draft_url
    const pickUrl = (obj) => {
      if (!obj) return null;
      return obj.signed_url || obj.download_url || obj.pdf_url || obj.url || obj.file_url || obj.draft_url || null;
    };

    const urlFromCache = pickUrl(invoice);
    if (urlFromCache && typeof urlFromCache === 'string' && urlFromCache.startsWith('http')) {
      window.open(urlFromCache, '_blank', 'noopener');
      return;
    }

    // Fallback: try backend endpoint to list drafts for the request and return signed urls
    const rid = requestId || inv || bl || '';
    if (!rid) {
      alert('Aucun identifiant disponible pour le téléchargement.');
      return;
    }

    try {
      const r = await api.get(`/drafts/request/${encodeURIComponent(rid)}`);
      const drafts = r?.data?.drafts || [];
      if (Array.isArray(drafts) && drafts.length) {
        // Prefer the first draft with a URL
        const withUrl = drafts.find(d => d.url);
        const pick = withUrl || drafts[0];
        const url = pick.url || null;
        if (url) {
          window.open(url, '_blank', 'noopener');
          return;
        }
      }
    } catch (e) {
      // ignore
    }

    alert('Aucun draft disponible pour téléchargement.');
  } catch (err) {
    console.error('downloadInvoice error', err);
    alert('Erreur lors du téléchargement du draft.');
  }
}

function downloadDocument(bl) {
  alert(`Téléchargement simulé du document pour ${bl}. (Intégrer backend pour vrai fichier)`);
}

// Download draft for a request by calling backend drafts endpoint and opening first signed URL
async function downloadDraft(requestId) {
  try {
    const rid = requestId || '';
    if (!rid) return alert('Aucun identifiant de demande fourni pour le téléchargement du draft.');
    try {
      const r = await api.get(`/drafts/request/${encodeURIComponent(rid)}`);
      const drafts = r?.data?.drafts || [];
      if (Array.isArray(drafts) && drafts.length) {
        const withUrl = drafts.find(d => d.url || d.signed_url || d.download_url);
        const pick = withUrl || drafts[0];
        const url = pick.url || pick.signed_url || pick.download_url || null;
        if (url) {
          window.open(url, '_blank', 'noopener');
          return;
        }
      }
    } catch (e) {
      console.warn('downloadDraft: backend call failed', e);
    }
    alert('Aucun draft disponible pour téléchargement.');
  } catch (err) {
    console.error('downloadDraft error', err);
    alert('Erreur lors du téléchargement du draft.');
  }
}

// --- MENU MOBILE ---
function toggleMenu() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('show');
}

// --- PETITES PROTECTIONS XSS (affichage) ---
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJs(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/'/g, "\\'");
}
