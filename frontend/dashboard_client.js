import { getMe, createRequest } from './client.js';
import { uploadDocuments, downloadDocument as downloadRequestFile, DOCUMENT_TYPES } from './documents.js';
import { logout } from './auth.js';
import { api } from './axios.config.js';

// --- DONNÉES INITIALES (stockage local comme fallback) ---
const STORAGE_KEY = 'logirdc_requests_v1';
let requests = [];
let extractedBL = "";
let selectedRequestType = '';
let activeDetailRequestId = '';
let detailDocumentsExpanded = false;
let activeDetailTrigger = null;
// Invoices cache retrieved from backend
let invoicesMap = new Map();
let currentPage = 1;
let pageSize = 10;
let notificationPage = 1;
let notificationFilter = 'all';
let notificationRows = [];
let notificationTotal = 0;
let notificationUnreadTotal = 0;
const notificationPageSize = 20;

// --- INITIALISATION AU CHARGEMENT ---
window.addEventListener('DOMContentLoaded', async () => {
  const detailBackdrop = document.getElementById('side-panel-backdrop');
  const detailPanel = document.getElementById('side-panel');
  if (detailBackdrop && detailPanel) {
    // A transformed mobile sidebar would otherwise become the fixed panel's containing block.
    document.body.append(detailBackdrop, detailPanel);
  }
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
  setupClientPageNavigation();
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

function setupClientPageNavigation() {
  const dashboardNav = document.querySelector('.nav-item[data-page="dashboard"]');
  const notificationsNav = document.getElementById('nav-notif');

  const showPage = page => {
    const content = document.querySelector('.content-scroll');
    const notificationPageElement = document.getElementById('client-notifications-page');
    if (!content || !notificationPageElement) return;

    const isNotificationsPage = page === 'notifications';
    content.classList.toggle('notifications-active', isNotificationsPage);
    notificationPageElement.hidden = !isNotificationsPage;
    dashboardNav?.classList.toggle('active', !isNotificationsPage);
    notificationsNav?.classList.toggle('active', isNotificationsPage);
    toggleMenu(false, false);

    document.querySelectorAll('.dropdown-popup').forEach(popup => {
      popup.classList.remove('show-popup');
      popup.setAttribute('aria-hidden', 'true');
      popup.style.display = 'none';
      if (popup.id === 'popup-settings') popup.setAttribute('inert', '');
    });
    const messagesBackdrop = document.getElementById('messages-backdrop');
    if (messagesBackdrop) messagesBackdrop.hidden = true;
    document.getElementById('notif-btn')?.setAttribute('aria-expanded', 'false');
    document.getElementById('settings-btn')?.setAttribute('aria-expanded', 'false');

    if (isNotificationsPage) {
      if (window.location.hash !== '#notifications') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#notifications`);
      }
      notificationPage = 1;
      loadNotificationPage().catch(error => {
        console.error('Failed to load client notification page', error);
      });
    } else if (window.location.hash === '#notifications') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };

  dashboardNav?.addEventListener('click', () => showPage('dashboard'));
  notificationsNav?.addEventListener('click', () => showPage('notifications'));
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(navItem => navItem.classList.toggle('active', navItem === item));
      if (window.matchMedia('(max-width: 767.98px)').matches) toggleMenu(false, false);
    });
    item.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        item.click();
      }
    });
  });

  document.getElementById('notifications-view-all')?.addEventListener('click', () => showPage('notifications'));
  document.querySelectorAll('[data-notification-filter]').forEach(button => {
    button.addEventListener('click', () => {
      notificationFilter = button.dataset.notificationFilter === 'unread' ? 'unread' : 'all';
      notificationPage = 1;
      document.querySelectorAll('[data-notification-filter]').forEach(filterButton => {
        const isActive = filterButton === button;
        filterButton.classList.toggle('active', isActive);
        filterButton.setAttribute('aria-pressed', String(isActive));
      });
      loadNotificationPage().catch(error => console.error('Failed to filter notifications', error));
    });
  });

  document.getElementById('notifications-prev')?.addEventListener('click', () => {
    if (notificationPage > 1) {
      notificationPage -= 1;
      loadNotificationPage().catch(error => console.error('Failed to load previous notifications page', error));
    }
  });
  document.getElementById('notifications-next')?.addEventListener('click', () => {
    if (notificationPage * notificationPageSize < notificationTotal) {
      notificationPage += 1;
      loadNotificationPage().catch(error => console.error('Failed to load next notifications page', error));
    }
  });

  document.getElementById('client-notification-list')?.addEventListener('click', async event => {
    const retryButton = event.target.closest('[data-retry-notifications]');
    if (retryButton) {
      await loadNotificationPage();
      return;
    }
    const markButton = event.target.closest('[data-mark-notification-read]');
    if (markButton) {
      event.stopPropagation();
      await markNotificationAsRead(markButton.dataset.markNotificationRead);
      return;
    }

    const openButton = event.target.closest('[data-open-notification-request]');
    if (!openButton) return;
    const item = notificationRows.find(notification => String(notification.id) === openButton.dataset.notificationId);
    if (item && !item.is_read) await markNotificationAsRead(item.id);

    const requestId = openButton.dataset.openNotificationRequest;
    showPage('dashboard');
    let request = requests.find(row => String(row.request_id || row.id || '') === String(requestId));
    if (!request) {
      await loadRequests();
      request = requests.find(row => String(row.request_id || row.id || '') === String(requestId));
    }
    if (request) openRequestDetails(requestId, openButton);
  });
  document.getElementById('notifications-mark-all')?.addEventListener('click', markAllNotificationsAsRead);
  if (window.location.hash === '#notifications') showPage('notifications');
  else dashboardNav?.classList.add('active');
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
  const reference = row.ref || row.reference || row.customer_reference || row.feri_ref ||
    row.bl_number || row.extracted_bl || row.manual_bl || '—';
  const status = String(row.status || row.state || 'UNKNOWN');
  const statusLabel = translateStatus(status) || '—';
  const category = getStatusCategory(status);
  const viewDetailsLabel = window.i18n?.t?.('view_details') || 'View details';
  const documentsLabel = window.i18n?.t?.('documents') || 'Documents';
  const labels = ['request_number', 'type', 'ref_number', 'client_company', 'creation_date', 'status', 'documents', 'actions'];
  const label = key => escapeHtml(window.i18n?.t?.(key) || key);

  return `<tr>
    <td data-label="${label(labels[0])}" class="request-number-cell">${escapeHtml(getRequestNumber(row))}</td>
    <td data-label="${label(labels[1])}"><span class="badge-type ${typeClass}">${escapeHtml(typeLabel)}</span></td>
    <td data-label="${label(labels[2])}" class="request-reference">${escapeHtml(reference)}</td>
    <td data-label="${label(labels[3])}" class="request-client">${escapeHtml(getRequestClient(row))}</td>
    <td data-label="${label(labels[4])}">${escapeHtml(getRequestDate(row))}</td>
    <td data-label="${label(labels[5])}"><span class="status status-${category}">${escapeHtml(statusLabel)}</span></td>
    <td data-label="${label(labels[6])}" class="request-documents-cell"><button type="button" class="request-documents-link" data-request-id="${escapeHtml(requestId)}" aria-label="${escapeHtml(documentsLabel)} — ${escapeHtml(getRequestNumber(row))}" title="${escapeHtml(documentsLabel)}"><i class="fas fa-file-pdf" aria-hidden="true"></i></button></td>
    <td data-label="${label(labels[7])}"><button type="button" class="request-detail-link" data-request-id="${escapeHtml(requestId)}"><span>${escapeHtml(viewDetailsLabel)}</span><span aria-hidden="true">→</span></button></td>
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
  const requestSearch = document.getElementById('request-search');
  if (requestSearch) requestSearch.value = '';
  ['filter-type', 'filter-status', 'filter-date'].forEach(id => {
    const select = document.getElementById(id);
    if (select) select.value = 'all';
  });
  const sort = document.getElementById('sort-by');
  if (sort) sort.value = 'newest';
  currentPage = 1;
  renderRequests();
}

function detailText(key, fallback) {
  return window.i18n?.t?.(key) || fallback;
}

function formatDetailDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const locale = window.i18n?.getLang?.() === 'en' ? 'en-US' : 'fr-FR';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function getDetailProgress(status) {
  const value = String(status || '').toUpperCase();
  if (['COMPLETED', 'VALIDATED', 'ISSUED'].includes(value)) return 3;
  if (['PROCESSING', 'SEND_DRAFT', 'DRAFT_SENT', 'PROFORMAT_SENT', 'PAYMENT_PROOF_UPLOADED', 'PAYMENT_CONFIRMED'].includes(value)) return 2;
  if (['UNDER_REVIEW', 'SUBMITTED', 'OCR_PENDING', 'INITIATED', 'AWAITING_REVIEW'].includes(value)) return 1;
  return 0;
}

function normalizeDocumentType(type) {
  return String(type || '').toUpperCase().replace(/[\s-]+/g, '_');
}

function getExpectedRequestDocuments(type) {
  const normalized = normalizeDocumentType(type);
  const feri = normalized.includes('FERI');
  const ad = normalized.includes('AD');
  const result = [];
  if (feri) {
    result.push(
      { type: DOCUMENT_TYPES.BILL_OF_LADING, nameKey: 'bill_of_lading', name: 'Connaissement maritime', descriptionKey: 'bill_of_lading_description', icon: 'fa-file-lines' },
      { type: DOCUMENT_TYPES.FREIGHT_INVOICE, nameKey: 'freight_invoice', name: 'Facture de fret', descriptionKey: 'freight_invoice_description', icon: 'fa-file-invoice' },
      { type: DOCUMENT_TYPES.COMMERCIAL_INVOICE, nameKey: 'commercial_invoice', name: 'Facture commerciale', descriptionKey: 'commercial_invoice_description', icon: 'fa-file-invoice-dollar' }
    );
  }
  if (ad) {
    result.push(
      { type: DOCUMENT_TYPES.CUSTOMS_DECLARATION, nameKey: 'customs_declaration', name: 'Déclaration en douane (IM8)', descriptionKey: 'customs_declaration_description', icon: 'fa-file-alt' },
      { type: DOCUMENT_TYPES.ROAD_FREIGHT_INVOICE, nameKey: 'road_freight_invoice', name: 'Facture fret terrestre', descriptionKey: 'road_freight_invoice_description', icon: 'fa-truck' },
      { type: DOCUMENT_TYPES.RIVER_FREIGHT_INVOICE, nameKey: 'river_freight_invoice', name: 'Facture fret fluvial', descriptionKey: 'river_freight_invoice_description', icon: 'fa-water' }
    );
  }
  return result;
}

function renderDetailDocuments(row, documents, loadError = false) {
  const container = document.getElementById('side-docs');
  const toggle = document.getElementById('detail-documents-toggle');
  if (!container) return;
  if (loadError) {
    container.innerHTML = `<p class="detail-docs-message is-error">${escapeHtml(detailText('detail_documents_error', 'Impossible de charger les documents.'))} <button type="button" id="detail-documents-retry">${escapeHtml(detailText('retry', 'Réessayer'))}</button></p>`;
    if (toggle) toggle.hidden = true;
    return;
  }

  const expected = getExpectedRequestDocuments(getRequestType(row));
  const normalizedDocs = documents.map(doc => ({
    ...doc,
    normalizedType: normalizeDocumentType(doc.type || doc.document_type || doc.doc_type)
  }));
  const isMkcDocument = doc => {
    const type = doc.normalizedType || normalizeDocumentType(doc.type || doc.document_type || doc.doc_type);
    const category = String(doc.category || '').toUpperCase();
    const uploadedByRole = String(doc.uploaded_by_role || '').toUpperCase();
    return uploadedByRole === 'ADMIN' ||
      ['FINAL', 'DRAFT'].includes(category) ||
      /^(DRAFT|PROFORMA|FERI_FINAL|AD_FINAL)|_FINAL$/.test(type);
  };
  const documentIdentity = doc => {
    const type = normalizeDocumentType(doc.type || doc.document_type || doc.doc_type);
    const name = String(doc.file_name || doc.fileName || doc.name || '').trim().toLowerCase();
    const path = String(doc.file_path || doc.storage_path || doc.pdf_url || doc.pdfUrl || '').split('?')[0];
    return name || path || type;
  };
  let transmittedCount = 0;
  const clientDocuments = expected.map(expectedDoc => {
    const document = normalizedDocs.find(doc => doc.normalizedType === normalizeDocumentType(expectedDoc.type));
    const provided = Boolean(document);
    if (provided) transmittedCount += 1;
    const statusLabel = document?.status
      ? translateStatus(document.status)
      : provided
        ? detailText('document_status_transmitted', 'Transmis')
        : detailText('document_status_to_provide', 'À fournir');
    const submittedAt = document?.uploaded_at || document?.created_at;
    const description = submittedAt
      ? `${detailText('document_submitted_on', 'Transmis le')} ${formatDetailDate(submittedAt)}`
      : detailText(expectedDoc.descriptionKey, expectedDoc.name);
    const documentName = document?.file_name || detailText(expectedDoc.nameKey, expectedDoc.name);
    const action = document?.id
      ? `<button type="button" class="detail-download-btn" data-document-id="${escapeHtml(document.id)}"><i class="fas fa-download" aria-hidden="true"></i><span>${escapeHtml(detailText('download', 'Télécharger'))}</span></button>`
      : '';
    return `<article class="detail-document-row is-client-document ${provided ? 'is-provided' : 'is-unavailable'}">
      <span class="detail-document-icon"><i class="fas ${expectedDoc.icon}" aria-hidden="true"></i></span>
      <span class="detail-document-copy"><strong>${escapeHtml(documentName)}</strong><small>${escapeHtml(description)}</small></span>
      <span class="detail-document-status ${provided ? 'status-transmitted' : 'status-not-received'}"><i class="fas ${provided ? 'fa-circle-up' : 'fa-circle-minus'}" aria-hidden="true"></i>${escapeHtml(statusLabel)}</span>
      ${action}
    </article>`;
  });
  const knownTypes = new Set(expected.map(item => normalizeDocumentType(item.type)));
  const mkcDocuments = [];
  const renderedDocumentIds = new Set();
  const renderedDocumentKeys = new Set();
  normalizedDocs.filter(doc => !knownTypes.has(doc.normalizedType)).forEach(doc => {
    const identity = documentIdentity(doc);
    const id = doc.id || doc.delivery_id;
    if ((id && renderedDocumentIds.has(String(id))) || (identity && renderedDocumentKeys.has(identity))) return;
    if (id) renderedDocumentIds.add(String(id));
    if (identity) renderedDocumentKeys.add(identity);
    const name = doc.file_name || detailText('document', 'Document');
    let safeHref = '';
    if (doc.downloadUrl || doc.url) {
      try {
        const parsed = new URL(doc.downloadUrl || doc.url, window.location.href);
        if (['http:', 'https:'].includes(parsed.protocol)) safeHref = parsed.href;
      } catch (_) {}
    }
    const action = safeHref
      ? `<a class="detail-download-btn" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i><span>${escapeHtml(detailText('view_document', 'Consulter'))}</span></a>`
      : doc.id
        ? `<button type="button" class="detail-download-btn" data-document-id="${escapeHtml(doc.id)}"><i class="fas fa-download" aria-hidden="true"></i><span>${escapeHtml(detailText('download', 'Télécharger'))}</span></button>`
        : '';
    const isMkc = isMkcDocument(doc);
    const issuedAt = doc.delivered_at || doc.issued_at || doc.created_at || doc.uploaded_at;
    const dateLabel = issuedAt
      ? `${detailText(isMkc ? 'document_issued_on' : 'document_submitted_on', isMkc ? 'Émis le' : 'Transmis le')} ${formatDetailDate(issuedAt)}`
      : detailText(doc.type && isMkc ? 'document_status_available' : 'document_status_transmitted', isMkc ? 'Disponible' : 'Transmis');
    const documentRow = `<article class="detail-document-row ${isMkc ? 'is-mkc-document' : 'is-client-document'} is-provided">
      <span class="detail-document-icon"><i class="fas fa-file-pdf" aria-hidden="true"></i></span>
      <span class="detail-document-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(dateLabel)}</small></span>
      <span class="detail-document-status ${isMkc ? 'status-available' : 'status-transmitted'}"><i class="fas ${isMkc ? 'fa-circle-down' : 'fa-circle-up'}" aria-hidden="true"></i>${escapeHtml(detailText(isMkc ? 'document_status_available' : 'document_status_transmitted', isMkc ? 'Disponible' : 'Transmis'))}</span>
      ${action}</article>`;
    if (!isMkc) transmittedCount += 1;
    (isMkc ? mkcDocuments : clientDocuments).push(documentRow);
  });
  const requestKey = String(row.request_id || row.id || '');
  const bl = row.bl_number || row.bl || row.extracted_bl || row.manual_bl || '—';
  const profile = getRelatedProfile(row);
  const externalFiles = [
    ...(Array.isArray(row.documents) ? row.documents.map(doc => ({ ...doc, isMkc: isMkcDocument(doc) })) : []),
    ...(Array.isArray(row.deliveries) ? row.deliveries.map(doc => ({ ...doc, isMkc: true })) : []),
    ...(Array.isArray(row.feri_deliveries) ? row.feri_deliveries.map(doc => ({ ...doc, isMkc: true })) : [])
  ].map(doc => ({
    ...doc,
    href: doc.downloadUrl || doc.signedUrl || doc.pdf_url || doc.pdfUrl || doc.url,
    name: doc.file_name || doc.fileName || doc.name || detailText('document', 'Document'),
    isMkc: doc.isMkc
  }));
  [
    { href: row.draft_url || row.draftUrl || row.request_draft_url, name: 'Draft', isMkc: true },
    { href: row.feri_signed_url || row.feriSignedUrl, name: 'FERI', isMkc: true }
  ].forEach(file => {
    if (file.href && !externalFiles.some(existing => existing.href === file.href)) externalFiles.push(file);
  });
  externalFiles.forEach(file => {
    if (!file.href) return;
    const identity = documentIdentity(file);
    if (identity && renderedDocumentKeys.has(identity)) return;
    let safeHref;
    try {
      const parsed = new URL(file.href, window.location.href);
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      safeHref = parsed.href;
    } catch (_) {
      return;
    }
    const isMkc = file.isMkc;
    const documentRow = `<article class="detail-document-row ${isMkc ? 'is-mkc-document' : 'is-client-document'} is-provided">
      <span class="detail-document-icon"><i class="fas fa-file-pdf" aria-hidden="true"></i></span>
      <span class="detail-document-copy"><strong>${escapeHtml(file.name)}</strong><small>${file.delivered_at || file.issued_at || file.created_at || file.uploaded_at ? `${escapeHtml(detailText(isMkc ? 'document_issued_on' : 'document_submitted_on', isMkc ? 'Émis le' : 'Transmis le'))} ${escapeHtml(formatDetailDate(file.delivered_at || file.issued_at || file.created_at || file.uploaded_at))}` : escapeHtml(detailText('document_status_received', 'Reçu'))}</small></span>
      <span class="detail-document-status ${isMkc ? 'status-available' : 'status-transmitted'}"><i class="fas ${isMkc ? 'fa-circle-down' : 'fa-circle-up'}" aria-hidden="true"></i>${escapeHtml(detailText(isMkc ? 'document_status_available' : 'document_status_transmitted', isMkc ? 'Disponible' : 'Transmis'))}</span>
      <a class="detail-download-btn" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i><span>${escapeHtml(detailText('view_document', 'Consulter'))}</span></a>
    </article>`;
    if (!isMkc) transmittedCount += 1;
    (isMkc ? mkcDocuments : clientDocuments).push(documentRow);
    if (identity) renderedDocumentKeys.add(identity);
  });

  const invoice = invoicesMap.get(requestKey) || invoicesMap.get(String(bl)) || null;
  const amount = invoice?.amount_due ?? row.amount_due ?? row.amount ?? '';
  const invoiceNumber = invoice?.invoice_number || row.invoice_number || row.invoice || '';
  if (invoiceNumber || amount) {
    const invoiceUrl = buildInvoiceUrl({
      invoice: invoiceNumber || requestKey,
      amount,
      bl,
      ref: row.ref || row.reference || row.customer_reference || row.feri_ref || '',
      date: row.created_at || row.updated_at,
      nom: profile?.nom || row.nom,
      prenom: profile?.prenom || row.prenom,
      email: profile?.email || row.email
    });
    mkcDocuments.unshift(`<article class="detail-document-row is-mkc-document is-provided">
      <span class="detail-document-icon"><i class="fas fa-receipt" aria-hidden="true"></i></span>
      <span class="detail-document-copy"><strong>${escapeHtml(detailText('invoice', 'Facture'))}</strong><small>${escapeHtml(String(invoiceNumber || formatAmountValue(amount)))}</small></span>
      <span class="detail-document-status status-available"><i class="fas fa-circle-down" aria-hidden="true"></i>${escapeHtml(detailText('document_status_available', 'Disponible'))}</span>
      <a class="invoice-link detail-download-btn" href="${escapeHtml(invoiceUrl)}" data-request="${escapeHtml(requestKey)}" data-bl="${escapeHtml(bl)}" data-inv="${escapeHtml(invoiceNumber)}" data-amount="${escapeHtml(String(amount))}" data-nom="${escapeHtml(profile?.nom || row.nom || '')}" data-prenom="${escapeHtml(profile?.prenom || row.prenom || '')}" data-email="${escapeHtml(profile?.email || row.email || '')}"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i><span>${escapeHtml(detailText('view_document', 'Consulter'))}</span></a>
    </article>`);
  }
  const documentCount = clientDocuments.length + mkcDocuments.length;
  if (!documentCount) {
    container.innerHTML = `<p class="detail-docs-message">${escapeHtml(detailText('detail_no_documents', 'Aucun document défini pour cette demande.'))}</p>`;
    if (toggle) toggle.hidden = true;
    return;
  }
  const limit = 4;
  const hasOverflow = clientDocuments.length > limit || mkcDocuments.length > limit;
  const renderSection = (key, icon, docs, badgeCount, emptyKey, emptyFallback) => {
    const items = docs.map((html, index) => {
      const collapsed = !detailDocumentsExpanded && index >= limit;
      return `<div class="detail-document-wrapper${collapsed ? ' is-collapsed' : ''}">${html}</div>`;
    }).join('');
    return `<section class="detail-document-group ${key}" aria-label="${escapeHtml(detailText(key === 'is-mkc-group' ? 'documents_received_from_mkc' : 'documents_sent_by_client', key === 'is-mkc-group' ? 'Documents reçus de MKC' : 'Documents transmis par vous'))}">
      <h4 class="detail-document-group-title"><i class="fas ${icon}" aria-hidden="true"></i>${escapeHtml(detailText(key === 'is-mkc-group' ? 'documents_received_from_mkc' : 'documents_sent_by_client', key === 'is-mkc-group' ? 'Documents reçus de MKC' : 'Documents transmis par vous'))}<span>${badgeCount}</span></h4>
      ${items || `<p class="detail-documents-empty">${escapeHtml(detailText(emptyKey, emptyFallback))}</p>`}
    </section>`;
  };
  container.innerHTML = renderSection('is-client-group', 'fa-arrow-up-from-bracket', clientDocuments, transmittedCount, 'no_client_documents_yet', 'Aucun document transmis.') +
    renderSection('is-mkc-group', 'fa-arrow-down-to-bracket', mkcDocuments, mkcDocuments.length, 'no_mkc_documents_yet', 'Aucun document mis à disposition pour le moment.');
  if (toggle) {
    toggle.hidden = !hasOverflow;
    toggle.textContent = detailDocumentsExpanded
      ? detailText('view_less_documents', 'Voir moins')
      : detailText('view_all_documents', 'Voir tous');
    toggle.setAttribute('aria-expanded', String(detailDocumentsExpanded));
  }
}

function openRequestDetails(requestId, trigger = null) {
  const row = requests.find(item => String(item.request_id || item.id || '') === String(requestId));
  const panel = document.getElementById('side-panel');
  if (!row || !panel) return;

  const requestKey = String(row.request_id || row.id || '');
  const status = String(row.status || row.state || '');
  const category = getStatusCategory(status);
  const rawType = getRequestType(row).toUpperCase();
  const type = rawType === 'FERI_ONLY' ? 'FERI' : rawType === 'AD_ONLY' ? 'AD' : rawType === 'FERI_AND_AD' ? 'FERI + AD' : rawType || '—';
  const reference = row.ref || row.reference || row.customer_reference || row.feri_ref ||
    row.bl_number || row.extracted_bl || row.manual_bl || '—';
  const profile = getRelatedProfile(row);
  const rejected = category === 'rejected';
  activeDetailRequestId = requestKey;
  activeDetailTrigger = trigger || document.activeElement;
  detailDocumentsExpanded = false;

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value == null || value === '' ? '—' : String(value);
  };
  const formattedStatus = translateStatus(status) || '—';
  const requestNumber = getRequestNumber(row);
  setText('side-request-number', requestNumber);
  const closeButton = document.getElementById('side-close-btn');
  if (closeButton) closeButton.setAttribute('aria-label', detailText('close_request_details', 'Fermer le panneau'));
  setText('detail-info-type', type);
  setText('detail-info-date', formatDetailDate(row.created_at || row.createdAt));
  setText('detail-info-client', getRequestClient(row));
  setText('detail-info-country', row.destination_country || row.country || row.destination || '—');
  setText('detail-info-reference', reference);
  setText('detail-info-status', formattedStatus);
  setText('detail-info-fxi', row.fxi_number || row.fxi || '—');
  setText('detail-info-charger', row.carte_chargeur || row.charger_card_number || '—');

  const typeBadge = document.getElementById('side-request-type');
  if (typeBadge) {
    typeBadge.textContent = type;
    typeBadge.className = `badge-type ${type === 'AD' ? 'badge-ad' : 'badge-feri'}`;
  }

  const steps = document.getElementById('voyage-steps');
  const rejectedPriorStatus = row.previous_status || row.status_before_rejection;
  const progress = rejected ? getDetailProgress(rejectedPriorStatus || 'CREATED') : getDetailProgress(status);
  if (steps) {
    steps.dataset.progress = String(progress);
    steps.classList.toggle('is-rejected', rejected);
    steps.querySelectorAll('li').forEach((step, index) => {
      step.classList.toggle('is-complete', !rejected && index < progress);
      step.classList.toggle('is-current', !rejected && index === progress);
      step.classList.toggle('is-future', !rejected && index > progress);
      step.classList.toggle('is-rejected-step', rejected && Boolean(rejectedPriorStatus) && index === progress);
    });
  }
  const ocean = document.querySelector('.voyage-ocean');
  if (ocean) {
    const shipPosition = Math.max(5, Math.min(95, 5 + progress * 30));
    ocean.style.setProperty('--ship-left', `${shipPosition}%`);
    ocean.style.setProperty('--route-fill', `${progress * 33.33}%`);
  }
  const route = document.querySelector('.voyage-steps');
  if (route) route.setAttribute('aria-label', `${detailText('request_details_title', 'Détails de la demande')} — ${formattedStatus}`);
  setText('voyage-date-created', formatDetailDate(row.created_at || row.createdAt));
  setText('voyage-date-review', formatDetailDate(row.reviewed_at || row.under_review_at || row.submitted_at));
  setText('voyage-date-processing', formatDetailDate(row.processing_started_at || row.processed_at));
  setText('voyage-date-completed', formatDetailDate(row.completed_at || row.validated_at));

  const notice = document.getElementById('detail-status-notice');
  if (notice) {
    const needsAction = ['AWAITING_DOCUMENTS', 'PAYMENT_REQUIRED', 'ACTION_REQUIRED'].includes(status.toUpperCase());
    notice.hidden = !rejected && !needsAction;
    notice.className = `detail-status-notice ${rejected ? 'is-rejected' : 'is-action-required'}`;
    notice.textContent = rejected
      ? detailText('request_rejected_notice', 'Demande rejetée')
      : needsAction ? formattedStatus : '';
  }
  const rejectionReason = document.getElementById('detail-rejection-reason');
  if (rejectionReason) {
    const reason = row.rejection_reason || row.reject_reason || row.rejection_message || '';
    rejectionReason.hidden = !rejected || !reason;
    rejectionReason.textContent = reason ? `${detailText('rejection_reason', 'Motif du rejet')} : ${reason}` : '';
  }
  const infoNote = document.querySelector('.detail-info-note');
  if (infoNote) infoNote.hidden = !['CREATED', 'AWAITING_DOCUMENTS', 'PROCESSING'].includes(status.toUpperCase());

  const docContainer = document.getElementById('side-docs');
  if (docContainer) docContainer.innerHTML = `<p class="detail-docs-message"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${escapeHtml(detailText('loading', 'Chargement...'))}</p>`;
  panel.classList.add('show');
  panel.setAttribute('aria-hidden', 'false');
  document.getElementById('side-panel-backdrop')?.classList.add('show');
  document.getElementById('side-close-btn')?.focus();

  const loadDetailDocuments = async () => {
    try {
      const response = await api.get(`/requests/${encodeURIComponent(requestKey)}/documents`);
      if (activeDetailRequestId !== requestKey) return;
      const list = Array.isArray(response.data?.documents) ? response.data.documents : [];
      renderDetailDocuments(row, list);
    } catch (error) {
      console.error('Failed to load documents for request details', {
        requestId: requestKey,
        status: error.response?.status,
        response: error.response?.data,
        message: error.message
      });
      if (activeDetailRequestId === requestKey) renderDetailDocuments(row, [], true);
    }
  };
  loadDetailDocuments();
}

// --- RECHERCHE ET BIND UI ---
function bindUIEvents() {
  const requestSearch = document.getElementById('request-search');
  if (requestSearch) requestSearch.addEventListener('input', applyFilters);

  // Buttons
  const openModalBtn = document.getElementById('open-modal-btn');
  if (openModalBtn) openModalBtn.addEventListener('click', openModal);

  const menuTrigger = document.getElementById('menu-trigger');
  if (menuTrigger) menuTrigger.addEventListener('click', () => toggleMenu());

  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', () => toggleMenu(false));
  document.getElementById('sidebar-backdrop')?.addEventListener('click', () => toggleMenu(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('sidebar')?.classList.contains('show')) {
      toggleMenu(false);
    }
  });

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
  const closeDetails = () => {
    const panel = document.getElementById('side-panel');
    if (!panel) return;
    panel.classList.remove('show');
    panel.setAttribute('aria-hidden', 'true');
    document.getElementById('side-panel-backdrop')?.classList.remove('show');
    activeDetailRequestId = '';
    activeDetailTrigger?.focus?.();
    activeDetailTrigger = null;
  };
  if (closeSidePanel) closeSidePanel.addEventListener('click', closeDetails);
  document.getElementById('side-panel-backdrop')?.addEventListener('click', closeDetails);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('side-panel')?.classList.contains('show')) closeDetails();
  });

  const documentsToggle = document.getElementById('detail-documents-toggle');
  if (documentsToggle) documentsToggle.addEventListener('click', () => {
    detailDocumentsExpanded = !detailDocumentsExpanded;
    document.querySelectorAll('.detail-document-wrapper').forEach((item, index) => {
      item.classList.toggle('is-collapsed', !detailDocumentsExpanded && index >= 4);
    });
    documentsToggle.textContent = detailDocumentsExpanded
      ? detailText('view_less_documents', 'Voir moins')
      : detailText('view_all_documents', 'Voir tous');
    documentsToggle.setAttribute('aria-expanded', String(detailDocumentsExpanded));
  });
  const docsContainer = document.getElementById('side-docs');
  if (docsContainer) docsContainer.addEventListener('click', async event => {
    const retry = event.target.closest('#detail-documents-retry');
    if (retry) {
      const row = requests.find(item => String(item.request_id || item.id || '') === activeDetailRequestId);
      if (row) openRequestDetails(activeDetailRequestId, activeDetailTrigger);
      return;
    }
    const downloadButton = event.target.closest('.detail-download-btn');
    if (!downloadButton) return;
    const documentId = downloadButton.dataset.documentId;
    if (!documentId) return;
    const original = downloadButton.innerHTML;
    downloadButton.disabled = true;
    downloadButton.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${escapeHtml(detailText('loading', 'Chargement...'))}</span>`;
    try {
      const response = await downloadRequestFile(documentId);
      const filename = response.headers?.['content-disposition']?.match(/filename="?([^";]+)"?/i)?.[1] || 'document';
      const objectUrl = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('Failed to download request document', { documentId, error });
      window.alert(detailText('detail_document_download_error', 'Impossible de télécharger ce document. Réessayez plus tard.'));
    } finally {
      if (downloadButton.isConnected) {
        downloadButton.disabled = false;
        downloadButton.innerHTML = original;
      }
    }
  });

  const contactSupport = document.getElementById('detail-contact-support');
  if (contactSupport) contactSupport.addEventListener('click', () => {
    closeDetails();
    document.getElementById('settings-btn')?.click();
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
  const messagesBackdrop = document.getElementById('messages-backdrop');
  if (messagesBackdrop) messagesBackdrop.addEventListener('click', () => {
    const popup = document.getElementById('popup-settings');
    if (!popup?.classList.contains('show-popup')) return;
    togglePopup('settings', document.getElementById('settings-btn'));
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const settingsPopup = document.getElementById('popup-settings');
    if (settingsPopup?.classList.contains('show-popup')) {
      togglePopup('settings', document.getElementById('settings-btn'));
    }
  });
  window.addEventListener('message', event => {
    const frame = document.querySelector('#popup-settings-body iframe');
    if (event.origin !== window.location.origin || event.source !== frame?.contentWindow ||
        event.data?.type !== 'messages:close') return;
    const popup = document.getElementById('popup-settings');
    if (popup?.classList.contains('show-popup')) {
      togglePopup('settings', document.getElementById('settings-btn'));
    }
  });

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
      if (document.getElementById('client-notifications-page') && !document.getElementById('client-notifications-page').hidden) {
        loadNotificationPage().catch(error => console.error('Failed to refresh translated notifications', error));
      }
      loadNotifications().catch(() => {});
    });
  }

  // Modal close and submit
  const modalClose = document.getElementById('modal-close-btn');
  if (modalClose) modalClose.addEventListener('click', closeModal);
  const modalHeaderClose = document.getElementById('modal-header-close');
  if (modalHeaderClose) modalHeaderClose.addEventListener('click', closeModal);
  const modal = document.getElementById('modal');
  if (modal) {
    modal.addEventListener('click', event => {
      if (event.target === modal) closeModal();
    });
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeModal();
    });
  }
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

    const uploadCard = inp.closest('.doc-upload-btn');
    if (uploadCard) {
      uploadCard.addEventListener('dragover', event => {
        event.preventDefault();
        uploadCard.classList.add('is-dragover');
      });
      uploadCard.addEventListener('dragleave', event => {
        if (!uploadCard.contains(event.relatedTarget)) uploadCard.classList.remove('is-dragover');
      });
      uploadCard.addEventListener('drop', event => {
        event.preventDefault();
        uploadCard.classList.remove('is-dragover');
        const file = event.dataTransfer && event.dataTransfer.files[0];
        if (!file || typeof DataTransfer === 'undefined') return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        inp.files = transfer.files;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  });

  // Delegated handlers for invoice/document downloads rendered in table
  const tableBody = document.getElementById('table-body');
  if (tableBody) {
    tableBody.addEventListener('click', function (e) {
      const actionButton = e.target.closest('.request-detail-link, .request-documents-link');
      if (!actionButton) return;
      openRequestDetails(actionButton.dataset.requestId, actionButton);
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
            if (statusLabel === 'SEND_DRAFT' || statusLabel === 'DRAFT_SENT' || statusLabel === 'PROFORMAT_SENT' || statusLabel === 'PAYMENT_PROOF_UPLOADED' || statusLabel === 'AWAITING_PAYMENT') {
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
  if (popup.id === 'popup-settings') {
    if (isShown) popup.removeAttribute('inert');
    else popup.setAttribute('inert', '');
  }

  if (triggerBtn) {
    triggerBtn.setAttribute('aria-expanded', isShown ? 'true' : 'false');
  }

  // Refresh the notification preview and unread count when the popup opens.
  const messagesBackdrop = document.getElementById('messages-backdrop');
  if (messagesBackdrop) messagesBackdrop.hidden = !(type === 'settings' && isShown);
  if (type === 'settings' && !isShown && triggerBtn) triggerBtn.focus({ preventScroll: true });
  if (type === 'notif' && isShown) {
    loadNotifications().catch(() => {});
  }
  // If opening settings popup (now repurposed as Messages), load messages
  if (type === 'settings' && isShown) {
    try {
      // load the messages page into an iframe inside the popup so it behaves like
      // a full HTML page while staying inside the dashboard layout
      const body = document.getElementById('popup-settings-body');
      const messagesFrame = body?.querySelector('iframe');
      if (body && !messagesFrame) {
        body.innerHTML = `<iframe title="Messagerie des demandes" src="messages_page.html" style="width:100%; height:100%; border:0; border-radius:0; display:block;"></iframe>`;
      } else {
        messagesFrame?.contentWindow?.postMessage({ type: 'messages:refresh' }, window.location.origin);
      }
      document.getElementById('popup-settings-close')?.focus({ preventScroll: true });
    } catch (e) { console.warn('loadMessages iframe failed', e); }
  }
}

// --- NOTIFICATIONS: polling, render and badge ---
let notifPollInterval = null;
async function loadNotifications() {
  const badge = document.getElementById('notif-badge');
  const body = document.getElementById('popup-notif-body') || document.querySelector('#popup-notif .popup-body');

  try {
    const [res, unreadRes] = await Promise.all([
      api.get('/notifications', { params: { page: 1, limit: 5 } }),
      api.get('/notifications', { params: { page: 1, limit: 1, unread: true } })
    ]);
    const list = (res && res.data && res.data.data) ? res.data.data : (res.data || []);
    if (!Array.isArray(list) || res?.data?.success === false || res?.data?.warning ||
        unreadRes?.data?.success === false || unreadRes?.data?.warning) {
      throw new Error(res?.data?.warning || 'Invalid notifications response');
    }

    const unreadCount = Number(unreadRes?.data?.pagination?.total);
    notificationUnreadTotal = Number.isFinite(unreadCount) ? unreadCount : list.filter(n => !n.is_read).length;
    if (badge) {
      badge.textContent = notificationUnreadTotal > 99 ? '99+' : String(notificationUnreadTotal);
      badge.style.display = notificationUnreadTotal > 0 ? 'inline-block' : 'none';
      badge.setAttribute('aria-label', notificationUnreadTotal > 0 ? `${notificationUnreadTotal} notifications non lues` : '0 notifications');
    }

    if (document.getElementById('client-notification-list')) renderNotificationPage();
    if (!body) return;
    if (list.length === 0) {
      body.innerHTML = `<div class="notif-item">${escapeHtml(notificationText('notifications_empty', 'Aucune notification'))}</div>`;
      return;
    }

    body.innerHTML = list.slice(0, 5).map(n => {
      const title = escapeHtml(n.title || 'Notification');
      const msg = escapeHtml(n.message || '');
      const time = formatNotificationDate(n.created_at);
      const unreadClass = n.is_read ? '' : ' is-unread';

      return `
        <div class="notif-item${unreadClass}" data-id="${escapeHtml(n.id)}">
          <div class="title">${title}</div>
          <div class="message">${msg}</div>
          <div class="meta">${escapeHtml(time)}</div>
        </div>`;
    }).join('');
  } catch (error) {
    console.error('Unable to refresh notification badge and preview', error);
    if (body) body.innerHTML = `<div class="notif-item">${escapeHtml(notificationText('notifications_load_error', 'Impossible de charger les notifications'))}</div>`;
  }
}

function notificationText(key, fallback) {
  const translation = window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t(key) : '';
  return translation && translation !== key ? translation : fallback;
}

function formatNotificationDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const lang = window.i18n && typeof window.i18n.getLang === 'function' ? window.i18n.getLang() : 'fr';
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

async function loadNotificationPage() {
  const listElement = document.getElementById('client-notification-list');
  if (!listElement) return;

  listElement.innerHTML = `<div class="notification-page-state">${escapeHtml(notificationText('notifications_loading', 'Chargement des notifications…'))}</div>`;
  try {
    const response = await api.get('/notifications', {
      params: {
        page: notificationPage,
        limit: notificationPageSize,
        ...(notificationFilter === 'unread' ? { unread: true } : {})
      }
    });
    const payload = response?.data;
    if (!payload?.success || payload.warning || !Array.isArray(payload.data)) {
      throw new Error(payload?.warning || 'Invalid notifications response');
    }

    notificationRows = payload.data;
    notificationTotal = Number(payload.pagination?.total) || notificationRows.length;
    renderNotificationPage();
  } catch (error) {
    console.error('Failed to load notifications page', error);
    listElement.innerHTML = `<div class="notification-page-state is-error">
      <span>${escapeHtml(notificationText('notifications_load_error', 'Impossible de charger les notifications'))}</span>
      <button class="notification-mark-read" type="button" data-retry-notifications>${escapeHtml(notificationText('retry', 'Réessayer'))}</button>
    </div>`;
    const pagination = document.getElementById('notifications-pagination');
    if (pagination) pagination.hidden = true;
  }
}

function renderNotificationPage() {
  const listElement = document.getElementById('client-notification-list');
  if (!listElement) return;

  const visibleRows = notificationRows.filter(item => notificationFilter !== 'unread' || !item.is_read);
  const unreadCountElement = document.getElementById('notifications-unread-count');
  if (unreadCountElement) {
    unreadCountElement.textContent = `${notificationUnreadTotal} ${notificationText('notifications_unread_count', 'non lue(s)')}`;
  }

  const markAllButton = document.getElementById('notifications-mark-all');
  if (markAllButton) markAllButton.disabled = notificationUnreadTotal === 0;

  if (visibleRows.length === 0) {
    const key = notificationFilter === 'unread' ? 'notifications_no_unread' : 'notifications_empty';
    const fallback = notificationFilter === 'unread' ? 'Aucune notification non lue.' : 'Aucune notification.';
    listElement.innerHTML = `<div class="notification-page-state">${escapeHtml(notificationText(key, fallback))}</div>`;
  } else {
    listElement.innerHTML = visibleRows.map(item => {
      const title = escapeHtml(item.title || notificationText('notifications', 'Notification'));
      const message = escapeHtml(item.message || '');
      const date = escapeHtml(formatNotificationDate(item.created_at));
      const reference = item.metadata?.requestRef || item.metadata?.request_id || item.entity_id || '';
      const requestId = String(item.entity_type || '').toLowerCase() === 'request'
        ? (item.entity_id || item.metadata?.request_id || item.metadata?.data?.metadata?.request_id || '')
        : '';
      const referenceText = reference
        ? `<span class="notification-reference">${escapeHtml(notificationText('ref_number', 'Référence'))} : ${escapeHtml(reference)}</span>`
        : '';
      const unreadClass = item.is_read ? '' : ' is-unread';
      const readButton = item.is_read ? '' : `
        <button class="notification-mark-read" type="button" data-mark-notification-read="${escapeHtml(item.id)}">
          ${escapeHtml(notificationText('mark_as_read', 'Marquer comme lue'))}
        </button>`;

      return `
        <article class="client-notification${unreadClass}">
          ${requestId ? `<button class="notification-open-request" type="button" data-open-notification-request="${escapeHtml(requestId)}" data-notification-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(notificationText('open_related_request', 'Ouvrir la demande liée'))}">` : '<div class="notification-open-request">'}
            <span class="client-notification-icon" aria-hidden="true"><i class="fas fa-bell"></i></span>
            <span class="client-notification-content">
              <span class="notification-title">${title}</span>
              ${message ? `<span class="notification-message">${message}</span>` : ''}
              <span class="client-notification-meta">${referenceText}<time>${date}</time></span>
            </span>
          ${requestId ? '</button>' : '</div>'}
          ${readButton}
        </article>`;
    }).join('');
  }

  const pagination = document.getElementById('notifications-pagination');
  const pageCount = Math.max(1, Math.ceil(notificationTotal / notificationPageSize));
  if (pagination) pagination.hidden = pageCount <= 1;
  const pageIndicator = document.getElementById('notifications-page-indicator');
  if (pageIndicator) pageIndicator.textContent = `${notificationPage} / ${pageCount}`;
  const previousButton = document.getElementById('notifications-prev');
  const nextButton = document.getElementById('notifications-next');
  if (previousButton) previousButton.disabled = notificationPage <= 1;
  if (nextButton) nextButton.disabled = notificationPage >= pageCount;
}

async function markNotificationAsRead(notificationId) {
  if (!notificationId) return false;
  try {
    const response = await api.patch(`/notifications/${encodeURIComponent(notificationId)}/read`);
    if (response?.data?.success === false) throw new Error(response.data.message || 'Unable to mark notification as read');

    notificationRows = notificationRows.map(item => item.id === notificationId ? { ...item, is_read: true } : item);
    renderNotificationPage();
    await loadNotifications();
    await loadNotificationPage();
    return true;
  } catch (error) {
    console.error('Failed to mark notification as read', { notificationId, error });
    window.alert(notificationText('notification_mark_read_error', 'Impossible de marquer cette notification comme lue.'));
    return false;
  }
}

async function markAllNotificationsAsRead() {
  const button = document.getElementById('notifications-mark-all');
  if (!button || button.disabled) return;
  const originalText = button.textContent;
  button.disabled = true;

  try {
    const unreadIds = [];
    let page = 1;
    let total = Infinity;
    while ((page - 1) * 50 < total) {
      const response = await api.get('/notifications', { params: { page, limit: 50 } });
      const payload = response?.data;
      if (!payload?.success || payload.warning || !Array.isArray(payload.data)) {
        throw new Error(payload?.warning || 'Unable to load notifications');
      }
      unreadIds.push(...payload.data.filter(item => !item.is_read).map(item => item.id).filter(Boolean));
      total = Number(payload.pagination?.total) || payload.data.length;
      if (payload.data.length < 50) break;
      page += 1;
    }

    for (let index = 0; index < unreadIds.length; index += 10) {
      const batch = unreadIds.slice(index, index + 10);
      const results = await Promise.allSettled(batch.map(id => api.patch(`/notifications/${encodeURIComponent(id)}/read`)));
      if (results.some(result => result.status === 'rejected' || result.value?.data?.success === false)) {
        throw new Error('Some notifications could not be marked as read');
      }
    }

    await Promise.all([loadNotificationPage(), loadNotifications()]);
  } catch (error) {
    console.error('Failed to mark all notifications as read', error);
    window.alert(notificationText('notification_mark_read_error', 'Impossible de marquer les notifications comme lues.'));
  } finally {
    button.textContent = originalText;
    button.disabled = notificationRows.every(item => item.is_read);
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
  const requestType = type === 'FERI + AD' ? 'FERI + AD' : type;
  if (title) title.innerText = window.i18n && typeof window.i18n.t === 'function'
    ? window.i18n.t('modal_new_request_type', { type: requestType })
    : `New ${requestType} Request`;
  const stepBadge = document.getElementById('modal-step-badge');
  if (stepBadge) stepBadge.innerText = window.i18n && typeof window.i18n.t === 'function'
    ? window.i18n.t('modal_step_selected')
    : 'STEP 1 / 1';
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
    el.style.display = el.classList.contains('feri-req') || el.classList.contains('ad-req') ? 'grid' : 'block';
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
    const fxi = document.getElementById('btn-ed') || document.getElementById('input-fxi'); if (fxi) fxi.style.display = '';
  } else if (type === 'AD') {
    hideElement(feriBlock);
    showElement(adBlock);
    const fxi = document.getElementById('btn-ed') || document.getElementById('input-fxi'); if (fxi) fxi.style.display = 'none';
    // Ensure Numéro FERI field is visible for AD-only flows
    try {
      const feriInput = document.getElementById('input-feri');
      const feriLabel = document.querySelector('label[for="input-feri"]');
      const feriField = feriInput && feriInput.closest('.request-modal-field');
      if (feriInput) feriInput.style.display = '';
      if (feriLabel) feriLabel.style.display = '';
      if (feriField) feriField.style.display = '';
    } catch (e) {}
  } else { // FERI + AD
    showElement(feriBlock);
    showElement(adBlock);
    const fxi = document.getElementById('btn-ed') || document.getElementById('input-fxi'); if (fxi) fxi.style.display = '';
    // For combined FERI + AD, remove (hide) the Numéro FERI field per request
    try {
      const feriInput = document.getElementById('input-feri');
      const feriLabel = document.querySelector('label[for="input-feri"]');
      const feriField = feriInput && feriInput.closest('.request-modal-field');
      if (feriInput) feriInput.style.display = 'none';
      if (feriLabel) feriLabel.style.display = 'none';
      if (feriField) feriField.style.display = 'none';
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
  const uploadCard = input.closest('.doc-upload-btn');
  const setCardState = (state, enabled) => {
    if (uploadCard) uploadCard.classList.toggle(state, enabled);
    else if (labelSpan.parentElement) labelSpan.parentElement.classList.toggle(state, enabled);
  };
  const fileHint = uploadCard && uploadCard.querySelector('.upload-file-hint [data-i18n="no_file_selected"]');

  if (input.files && input.files.length > 0) {
    const file = input.files[0];
    const MAX_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      labelSpan.innerText = `Fichier trop volumineux (${Math.round(file.size / 1024 / 1024)}MB)`;
      input.value = '';
      setCardState('file-selected', false);
      setCardState('scanning', false);
      return;
    }

    const fileName = file.name;
    if (fileHint) fileHint.textContent = fileName;

    if (labelSpan.id === 'label-bl') {
      labelSpan.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Scanning...`;
      setCardState('scanning', true);

      setTimeout(() => {
        extractedBL = "BL" + Math.floor(100000 + Math.random() * 900000);
        // Do not display the extracted BL value in the UI — show only the filename
        labelSpan.innerHTML = `<strong>${escapeHtml(fileName)}</strong>`;
        setCardState('scanning', false);
        setCardState('file-selected', true);
        const submitBtn = document.getElementById('submit-btn');
        if (submitBtn) submitBtn.style.display = 'block';
      }, 1200);
    } else {
      labelSpan.innerText = fileName;
      setCardState('file-selected', true);
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
  if (title) title.innerText = window.i18n && typeof window.i18n.t === 'function'
    ? window.i18n.t('new_request')
    : 'New Request';
  const stepBadge = document.getElementById('modal-step-badge');
  if (stepBadge) stepBadge.innerText = window.i18n && typeof window.i18n.t === 'function'
    ? window.i18n.t('modal_step_initial')
    : 'STEP 1 / 2';

  const labels = [
    { id: 'label-bl', key: 'bill_of_lading', fallback: 'Bill of Lading' },
    { id: 'label-fi', key: 'freight_invoice', fallback: 'Freight Invoice' },
    { id: 'label-ci', key: 'commercial_invoice', fallback: 'Commercial Invoice' },
    { id: 'label-im8', key: 'customs_declaration', fallback: 'Customs declaration (IM8)' },
    { id: 'label-road-inv', key: 'road_freight_invoice', fallback: 'Land freight invoice' },
    { id: 'label-river-inv', key: 'river_freight_invoice', fallback: 'River freight invoice' },
    // Export Declaration replaced by FXI input field
  ];

  labels.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) {
      el.innerText = window.i18n && typeof window.i18n.t === 'function'
        ? window.i18n.t(item.key)
        : item.fallback;
      const uploadCard = el.closest('.doc-upload-btn');
      if (uploadCard) uploadCard.classList.remove('file-selected', 'scanning', 'is-dragover');
      const hint = uploadCard && uploadCard.querySelector('.upload-file-hint [data-i18n="no_file_selected"]');
      if (hint) hint.textContent = window.i18n && typeof window.i18n.t === 'function'
        ? window.i18n.t('no_file_selected')
        : 'No file selected';
    }
  });

  document.querySelectorAll('.doc-upload-btn input[type="file"]').forEach(i => i.value = '');
  const fxi = document.getElementById('input-fxi');
  if (fxi) fxi.value = '';
  const fxiField = document.getElementById('btn-ed');
  if (fxiField) fxiField.style.display = '';
  // Reset optional inputs including FERI number
  const feri = document.getElementById('input-feri');
  if (feri) feri.value = '';
  const feriField = feri && feri.closest('.request-modal-field');
  if (feriField) feriField.style.display = '';
  const feriLabel = document.querySelector('label[for="input-feri"]');
  if (feriLabel) feriLabel.style.display = '';
  const vehicle = document.getElementById('input-vehicle');
  if (vehicle) vehicle.value = '';
  extractedBL = "";
    // reset requirement blocks visibility: default to FERI visible, AD hidden
    const feriBlock = document.querySelector('.feri-req');
    const adBlock = document.querySelector('.ad-req');
    if (feriBlock) feriBlock.style.display = 'grid';
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
function toggleMenu(open = null, restoreFocus = true) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const isOpen = open === null ? !sidebar.classList.contains('show') : open;
  sidebar.classList.toggle('show', isOpen);
  document.getElementById('menu-trigger')?.setAttribute('aria-expanded', String(isOpen));
  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop) backdrop.hidden = !isOpen;
  if (isOpen) {
    document.getElementById('close-sidebar-btn')?.focus({ preventScroll: true });
  } else if (restoreFocus) {
    document.getElementById('menu-trigger')?.focus({ preventScroll: true });
  }
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
