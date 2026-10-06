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
let currentPage = 1;
let pageSize = 10;

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
  return `Fac_Prev.html?${p.toString()}`;
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
  setRequestsViewState('loading');
  t.innerHTML = Array.from({ length: 5 }, () =>
    `<tr class="skeleton-row">${Array.from({ length: 7 }, () => '<td><span class="skeleton-line"></span></td>').join('')}</tr>`
  ).join('');
  try {
    const res = await api.get('/requests/me');
    requests = Array.isArray(res.data) ? res.data : [];
    currentPage = 1;
    renderRequests();
    
    // Display BL auto-generated alerts
    if (requests.length) displayBlAutoGeneratedAlerts().catch(err => console.error('Error displaying BL alerts:', err));
  } catch (e) {
    console.error('Failed to load client requests', e);
    requests = [];
    setRequestsViewState('error');
    const count = document.getElementById('request-count');
    if (count) count.textContent = '0';
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

function setRequestsViewState(state) {
  const tableWrap = document.getElementById('requests-table-wrap');
  const emptyState = document.getElementById('requests-empty');
  const errorState = document.getElementById('requests-error');
  const pagination = document.getElementById('pagination-footer');

  if (tableWrap) tableWrap.hidden = state !== 'loading' && state !== 'table';
  if (emptyState) emptyState.hidden = state !== 'empty';
  if (errorState) errorState.hidden = state !== 'error';
  if (pagination) pagination.hidden = state !== 'table';
}

function getRelatedProfile(row) {
  const profile = row.profiles || row.profile || null;
  return Array.isArray(profile) ? profile[0] || null : profile;
}

function getRequestNumber(row) {
  const number = row.request_number || row.request_no || row.request_code;
  if (number) return String(number).startsWith('#') ? String(number) : `#${number}`;
  const id = String(row.request_id || row.id || '');
  return id ? `#${id.slice(0, 8).toUpperCase()}` : '—';
}

function getRequestClient(row) {
  const profile = getRelatedProfile(row);
  const company = row.company_name || row.company || row.client_company || profile?.company_name || profile?.company;
  if (company) return company;
  const fullName = [profile?.prenom || row.prenom || row.first_name, profile?.nom || row.nom || row.last_name]
    .filter(Boolean)
    .join(' ');
  return fullName || profile?.email || row.client_email || row.email || '—';
}

function getRequestDate(row) {
  const value = row.created_at || row.createdAt || row.updated_at || row.updated;
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const locale = window.i18n?.getLang?.() === 'en' ? 'en-US' : 'fr-FR';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function getStatusCategory(status) {
  const value = String(status || '').toUpperCase();
  if (['REJECTED', 'CANCELLED'].includes(value)) return 'rejected';
  if (['COMPLETED', 'PAYMENT_CONFIRMED', 'VALIDATED', 'ISSUED'].includes(value)) return 'completed';
  if (['PROCESSING', 'SUBMITTED', 'UNDER_REVIEW', 'OCR_PENDING', 'INITIATED'].includes(value)) return 'in-progress';
  return 'pending';
}

function getFilteredRequests() {
  const search = (document.getElementById('request-search')?.value || '').trim().toLowerCase();
  const typeFilter = document.getElementById('filter-type')?.value || 'all';
  const statusFilter = document.getElementById('filter-status')?.value || 'all';
  const dateFilter = document.getElementById('filter-date')?.value || 'all';
  const sortBy = document.getElementById('sort-by')?.value || 'newest';
  const now = Date.now();

  const filtered = requests.filter(row => {
    const type = getRequestType(row).toUpperCase();
    if (typeFilter === 'feri' && !type.includes('FERI')) return false;
    if (typeFilter === 'ad' && !type.includes('AD')) return false;
    if (statusFilter !== 'all' && getStatusCategory(row.status || row.state) !== statusFilter.replace('_', '-')) return false;

    if (dateFilter !== 'all') {
      const createdAt = new Date(row.created_at || row.createdAt || row.updated_at || row.updated || 0).getTime();
      if (!createdAt) return false;
      const ageDays = (now - createdAt) / 86400000;
      if (dateFilter === 'today' && ageDays >= 1) return false;
      if (dateFilter === '7' && ageDays > 7) return false;
      if (dateFilter === '30' && ageDays > 30) return false;
    }

    if (search) {
      const profile = getRelatedProfile(row);
      const searchable = [
        getRequestNumber(row), row.id, row.request_id, row.bl_number, row.bl, row.extracted_bl,
        row.ref, row.reference, getRequestClient(row), getRequestType(row), row.status,
        profile?.email, row.client_email
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(search)) return false;
    }
    return true;
  });

  return filtered.sort((left, right) => {
    const leftDate = new Date(left.created_at || left.createdAt || left.updated_at || left.updated || 0).getTime();
    const rightDate = new Date(right.created_at || right.createdAt || right.updated_at || right.updated || 0).getTime();
    return sortBy === 'oldest' ? leftDate - rightDate : rightDate - leftDate;
  });
}

function renderPagination(totalItems) {
  const pages = document.getElementById('pagination-pages');
  const pageSizeSelect = document.getElementById('page-size');
  const summary = document.getElementById('entries-info');
  if (!pages) return;

  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  currentPage = Math.min(currentPage, pageCount);
  const previousLabel = window.i18n?.t?.('previous_page') || 'Previous page';
  const nextLabel = window.i18n?.t?.('next_page') || 'Next page';
  pages.innerHTML = `<button type="button" data-page="${currentPage - 1}" aria-label="${previousLabel}" ${currentPage <= 1 ? 'disabled' : ''}><span aria-hidden="true">‹</span></button>` +
    Array.from({ length: pageCount }, (_, index) => index + 1).map(page =>
      `<button type="button" data-page="${page}" class="${page === currentPage ? 'active' : ''}" ${page === currentPage ? 'aria-current="page"' : ''}>${page}</button>`
    ).join('') +
    `<button type="button" data-page="${currentPage + 1}" aria-label="${nextLabel}" ${currentPage >= pageCount ? 'disabled' : ''}><span aria-hidden="true">›</span></button>`;

  if (pageSizeSelect && Number(pageSizeSelect.value) !== pageSize) pageSizeSelect.value = String(pageSize);
  if (summary) {
    const from = totalItems ? (currentPage - 1) * pageSize + 1 : 0;
    const to = Math.min(currentPage * pageSize, totalItems);
    summary.textContent = window.i18n?.t?.('pagination_summary', { from, to, total: totalItems }) || `${from}–${to} of ${totalItems}`;
  }
}

function renderRequestRow(row) {
  const requestId = String(row.request_id || row.id || '');
  const type = getRequestType(row).toUpperCase();
  const typeLabel = type === 'AD_ONLY' || type === 'AD' ? 'AD' : type === 'FERI_AND_AD' ? 'FERI + AD' : type === 'FERI_ONLY' ? 'FERI' : type || '—';
  const typeClass = type.includes('AD') && !type.includes('FERI') ? 'badge-ad' : 'badge-feri';
  const reference = row.ref || row.reference || row.customer_reference || row.feri_ref || '—';
  const status = String(row.status || row.state || 'UNKNOWN');
  const statusLabel = translateStatus(status) || '—';
  const category = getStatusCategory(status);
  const viewDetailsLabel = window.i18n?.t?.('view_details') || 'View details';
  const labels = ['request_number', 'type', 'ref_number', 'client_company', 'creation_date', 'status', 'actions'];
  const label = key => escapeHtml(window.i18n?.t?.(key) || key);

  return `<tr>
    <td data-label="${label(labels[0])}" class="request-number-cell">${escapeHtml(getRequestNumber(row))}</td>
    <td data-label="${label(labels[1])}"><span class="badge-type ${typeClass}">${escapeHtml(typeLabel)}</span></td>
    <td data-label="${label(labels[2])}" class="request-reference">${escapeHtml(reference)}</td>
    <td data-label="${label(labels[3])}" class="request-client">${escapeHtml(getRequestClient(row))}</td>
    <td data-label="${label(labels[4])}">${escapeHtml(getRequestDate(row))}</td>
    <td data-label="${label(labels[5])}"><span class="status status-${category}">${escapeHtml(statusLabel)}</span></td>
    <td data-label="${label(labels[6])}"><button type="button" class="request-detail-link" data-request-id="${escapeHtml(requestId)}"><span>${escapeHtml(viewDetailsLabel)}</span><span aria-hidden="true">→</span></button></td>
  </tr>`;
}

function renderRequests() {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;
  const data = getFilteredRequests();
  const totalItems = data.length;
  const count = document.getElementById('request-count');
  if (count) count.textContent = String(totalItems);

  const emptyTitle = document.getElementById('empty-title');
  const emptyDescription = document.getElementById('empty-description');
  const emptyAction = document.getElementById('empty-action');
  if (!requests.length || !totalItems) {
    const hasFilters = Boolean(
      document.getElementById('request-search')?.value ||
      document.getElementById('filter-type')?.value !== 'all' ||
      document.getElementById('filter-status')?.value !== 'all' ||
      document.getElementById('filter-date')?.value !== 'all'
    );
    if (emptyTitle) emptyTitle.textContent = window.i18n?.t?.(hasFilters ? 'no_matching_requests' : 'no_requests') || 'No requests found';
    if (emptyDescription) emptyDescription.textContent = window.i18n?.t?.(hasFilters ? 'adjust_filters' : 'empty_requests_description') || 'Adjust your filters or create a new request.';
    if (emptyAction) {
      emptyAction.hidden = false;
      emptyAction.innerHTML = hasFilters
        ? `<span>${escapeHtml(window.i18n?.t?.('clear_filters') || 'Clear filters')}</span>`
        : `<span>${escapeHtml(window.i18n?.t?.('create_request') || 'Create request')}</span>`;
    }
    tbody.innerHTML = '';
    setRequestsViewState('empty');
    return;
  }

  setRequestsViewState('table');
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  currentPage = Math.min(currentPage, pageCount);
  const pageRows = data.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  tbody.innerHTML = pageRows.map(renderRequestRow).join('');
  renderPagination(totalItems);
}

function loadTable(data = null) {
  if (Array.isArray(data) && data !== requests) requests = data;
  renderRequests();
}

function applyFilters() {
  currentPage = 1;
  renderRequests();
}

function getRequestType(row) {
  return (row.type || row.request_type || row.requestType || row.service_type || '').toString();
}

function clearRequestFilters() {
  ['request-search', 'global-search'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  ['filter-type', 'filter-status', 'filter-date'].forEach(id => {
    const select = document.getElementById(id);
    if (select) select.value = 'all';
  });
  const sort = document.getElementById('sort-by');
  if (sort) sort.value = 'newest';
  currentPage = 1;
  renderRequests();
}

function openRequestDetails(requestId) {
  const row = requests.find(item => String(item.request_id || item.id || '') === String(requestId));
  const panel = document.getElementById('side-panel');
  if (!row || !panel) return;

  const requestKey = String(row.request_id || row.id || '');
  const bl = row.bl_number || row.bl || row.extracted_bl || row.manual_bl || '—';
  const reference = row.ref || row.reference || row.customer_reference || '—';
  const profile = getRelatedProfile(row);
  const setPanelText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  setPanelText('side-bl', `${window.i18n?.t?.('bl_number') || 'BL'}: ${bl}`);
  setPanelText('side-status', `${window.i18n?.t?.('status') || 'Status'}: ${translateStatus(row.status || row.state || 'UNKNOWN') || '—'}`);
  setPanelText('side-date', `${window.i18n?.t?.('updated_label') || 'Updated'}: ${getRequestDate(row)}`);
  setPanelText('side-client', `${window.i18n?.t?.('client') || 'Client'}: ${getRequestClient(row)}`);

  const links = [];
  const documents = [
    ...(Array.isArray(row.documents) ? row.documents : []),
    ...(Array.isArray(row.deliveries) ? row.deliveries : []),
    ...(Array.isArray(row.feri_deliveries) ? row.feri_deliveries : [])
  ];
  documents.forEach(doc => {
    const href = doc.downloadUrl || doc.signedUrl || doc.pdf_url || doc.pdfUrl || doc.url || doc.file_path || doc.filePath;
    const name = doc.file_name || doc.fileName || doc.name || 'Document';
    if (href) links.push(`<a class="detail-document-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)} <span aria-hidden="true">↗</span></a>`);
  });
  const draftUrl = row.draft_url || row.draftUrl || row.request_draft_url;
  const feriUrl = row.feri_signed_url || row.feriSignedUrl;
  [
    { url: draftUrl, name: 'Draft' },
    { url: feriUrl, name: 'FERI' }
  ].forEach(file => {
    if (file.url && !links.some(link => link.includes(escapeHtml(file.url)))) {
      links.push(`<a class="detail-document-link" href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer">${file.name} <span aria-hidden="true">↗</span></a>`);
    }
  });

  const invoice = invoicesMap.get(requestKey) || invoicesMap.get(String(bl)) || null;
  const amount = invoice?.amount_due ?? row.amount_due ?? row.amount ?? '';
  const invoiceNumber = invoice?.invoice_number || row.invoice_number || row.invoice || '';
  if (invoiceNumber || amount) {
    const invoiceUrl = buildInvoiceUrl({
      invoice: invoiceNumber || requestKey,
      amount,
      bl,
      ref: reference,
      date: row.created_at || row.updated_at,
      nom: profile?.nom || row.nom,
      prenom: profile?.prenom || row.prenom,
      email: profile?.email || row.email
    });
    links.unshift(`<a class="invoice-link detail-document-link" href="${escapeHtml(invoiceUrl)}" data-request="${escapeHtml(requestKey)}" data-bl="${escapeHtml(bl)}" data-inv="${escapeHtml(invoiceNumber)}" data-amount="${escapeHtml(String(amount))}" data-nom="${escapeHtml(profile?.nom || row.nom || '')}" data-prenom="${escapeHtml(profile?.prenom || row.prenom || '')}" data-email="${escapeHtml(profile?.email || row.email || '')}">${escapeHtml(invoiceNumber || formatAmountValue(amount))} <span aria-hidden="true">↗</span></a>`);
  }

  const docsContainer = document.getElementById('side-docs');
  if (docsContainer) {
    docsContainer.innerHTML = `<p class="detail-reference"><strong>${escapeHtml(window.i18n?.t?.('ref_number') || 'Reference')}:</strong> ${escapeHtml(reference)}</p>` +
      `<div class="detail-documents">${links.length ? links.join('') : `<span>${escapeHtml(window.i18n?.t?.('no_documents') || 'No documents available')}</span>`}</div>`;
  }
  panel.classList.add('show');
  panel.setAttribute('aria-hidden', 'false');
}

// --- RECHERCHE ET BIND UI ---
function bindUIEvents() {
  const searchInputs = ['request-search', 'global-search'].map(id => document.getElementById(id)).filter(Boolean);
  searchInputs.forEach(input => input.addEventListener('input', () => {
    searchInputs.forEach(other => { if (other !== input) other.value = input.value; });
    applyFilters();
  }));

  // Buttons
  const openModalBtn = document.getElementById('open-modal-btn');
  if (openModalBtn) openModalBtn.addEventListener('click', openModal);

  const menuTrigger = document.getElementById('menu-trigger');
  if (menuTrigger) menuTrigger.addEventListener('click', toggleMenu);

  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', toggleMenu);

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadRequests());

  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearRequestFilters);

  const emptyAction = document.getElementById('empty-action');
  if (emptyAction) emptyAction.addEventListener('click', () => {
    if (requests.length) clearRequestFilters();
    else openModal();
  });
  const retryRequests = document.getElementById('retry-requests');
  if (retryRequests) retryRequests.addEventListener('click', loadRequests);
  const closeSidePanel = document.getElementById('side-close-btn');
  if (closeSidePanel) closeSidePanel.addEventListener('click', () => {
    const panel = document.getElementById('side-panel');
    if (panel) {
      panel.classList.remove('show');
      panel.setAttribute('aria-hidden', 'true');
    }
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
  const sortSelect = document.getElementById('sort-by'); if (sortSelect) sortSelect.addEventListener('change', applyFilters);
  const pageSizeSelect = document.getElementById('page-size');
  if (pageSizeSelect) pageSizeSelect.addEventListener('change', () => {
    pageSize = Math.max(1, Number(pageSizeSelect.value) || 10);
    currentPage = 1;
    renderRequests();
  });
  const paginationPages = document.getElementById('pagination-pages');
  if (paginationPages) paginationPages.addEventListener('click', event => {
    const button = event.target.closest('button[data-page]');
    if (!button || button.disabled) return;
    currentPage = Number(button.dataset.page);
    renderRequests();
  });

  // language selector: update i18n and re-render status labels when changed
  const langSel = document.getElementById('lang-select');
  if (langSel) {
    langSel.addEventListener('change', () => {
      try {
        if (window.i18n && typeof window.i18n.setLang === 'function') window.i18n.setLang(langSel.value);
      } catch (e) { /* ignore */ }
      try { renderRequests(); } catch (e) { /* ignore */ }
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
      const detailButton = e.target.closest('.request-detail-link');
      if (!detailButton) return;
      openRequestDetails(detailButton.dataset.requestId);
    });
  }

  // Keep existing invoice and document actions available inside the detail panel.
  document.addEventListener('click', function (e) {
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
            if (statusLabel === 'DRAFT_SENT' || statusLabel === 'PROFORMAT_SENT' || statusLabel === 'PAYMENT_PROOF_UPLOADED' || statusLabel === 'AWAITING_PAYMENT') {
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
        const carteChargeurInput = document.getElementById('input-carte-chargeur');
        const carteChargeur = carteChargeurInput ? (carteChargeurInput.value || '').trim() : '';

        const payload = { type: selectedRequestType, ref: ref };
        if (fxiNumber) payload.fxi_number = fxiNumber;
        if (manualBl) payload.manual_bl = manualBl;
        if (feriNumber) payload.feri_number = feriNumber;
        if (vehicleRegistration) payload.vehicle_registration = vehicleRegistration;
        if (carrierName) payload.carrier_name = carrierName;
        if (carteChargeur) payload.carte_chargeur = carteChargeur;
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
