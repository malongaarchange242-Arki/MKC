const STORAGE_KEY = 'logirdc_requests_v1';
let requests = [];
let selectedBL = null;
let currentMode = 'DRAFT'; // Logic tracker: 'DRAFT' or 'FINAL'

document.addEventListener('DOMContentLoaded', async () => {
  // Load requests from backend (fallback to localStorage)
  await loadAdminRequests();

  // Fetch current user and render header info (name, role, avatar)
  fetchAndRenderUser();

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
});

// Load requests from backend to ensure admin sees same data as client
async function loadAdminRequests() {
  try {
    const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
    const defaultLocal = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? `${location.protocol}//${location.hostname}:3000` : location.origin;
    const API_BASE = metaApi || defaultLocal;

    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await fetch(`${API_BASE.replace(/\/$/,'')}/admin/requests`, { headers });
    if (resp.ok) {
      const data = await resp.json();
      requests = Array.isArray(data) ? data : (data?.data || []);
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
    const status = row.status || '';
    const displayStatus = String(status).replace(/_/g, ' ');
    const isInitiated = ['INITIATED', 'CREATED', 'AWAITING_DOCUMENTS', 'PROCESSING'].includes(status);

    // Use same BL selection logic as client but prefer extracted BL when available
    let blValue = '';
    // prefer the extracted value first (most reliable), then explicit fields
    blValue = blValue || row.extracted_bl || row.bl_number || row.bl || row.bill_of_lading || '';
    // fallback to nested request fields
    if (!blValue && row.request) {
      blValue = row.request.extracted_bl || row.request.bl_number || row.request.bl || '';
    }
    // fallback to documents array (first available)
    if (!blValue && row.documents && Array.isArray(row.documents)) {
      for (const d of row.documents) {
        // prefer extracted_bl inside documents as well
        if (d.extracted_bl || d.bl_number || d.bl || d.bill_of_lading) {
          blValue = d.extracted_bl || d.bl_number || d.bl || d.bill_of_lading;
          break;
        }
      }
    }

    return `
        <tr>
            <td class="text-blue" style="font-weight: 600;">${escapeHtml(blValue)}</td>
            <td>${escapeHtml(formatDateFromRow(row))}</td>
            <td><span class="status ${escapeHtml(status)}">${escapeHtml(displayStatus)}</span></td>
            <td>
              <button class="icon-btn" title="View Docs" onclick="viewDocs('${escapeJs(((row.request && (row.request.id || row.request.request_id)) || row.request_id || row.id || blValue) || '')}')"><i class="fas fa-folder-open"></i></button>
            </td>
            <td>
                ${isInitiated ?
      `<button class="btn-green" onclick="openAdminModal('${escapeJs(blValue)}', 'DRAFT')" style="font-size:11px; padding:6px 12px;">ISSUE DRAFT/PRICE</button>` :
      `<button class="btn-white" onclick="openAdminModal('${escapeJs(blValue)}', 'FINAL')" style="font-size:11px; padding:6px 12px; border-color:var(--primary-green); color:var(--primary-green);">DELIVER FINAL FERI</button>`
    }
            </td>
        </tr>
    `;
  }).join('');
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
  const labelInput = document.getElementById('main-label');
  const inputField = document.getElementById('admin-amount');
  const btnSubmit = document.getElementById('admin-submit-btn');
  const labelUpload = document.getElementById('label-draft');

  const targetDisplay = document.getElementById('target-bl-display');
  if (targetDisplay) targetDisplay.innerText = bl || '';

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

  if (mode === 'DRAFT') {
    if (title) title.innerText = "Issue Draft & Pricing";
    if (labelInput) labelInput.innerText = "Proforma Amount ($)";
    if (inputField) inputField.placeholder = "e.g. 450.00";
    if (btnSubmit) btnSubmit.innerText = "SEND DRAFT TO CLIENT";
  } else {
    if (title) title.innerText = "Deliver Official FERI";
    if (labelInput) labelInput.innerText = "FERI / AD Number";
    if (inputField) inputField.placeholder = "e.g. FERI-12345-RDC";
    if (btnSubmit) btnSubmit.innerText = "VALIDATE & DELIVER FINAL";
  }

  modal.style.display = 'flex';
}

function closeAdminModal() {
  document.getElementById('admin-modal').style.display = 'none';
  document.getElementById('admin-amount').value = '';
  document.getElementById('admin-file-draft').value = '';
}

/**
 * Handles the logic for X and $ automatically
 */
function handleAdminSubmit() {
  const inputEl = document.getElementById('admin-amount');
  const inputValue = inputEl ? String(inputEl.value).trim() : '';
  const fileInp = document.getElementById('admin-file-draft');

  if (!inputValue) return alert("Please fill the required field.");
  if (!fileInp || !fileInp.files || fileInp.files.length === 0) return alert("Please attach the PDF file.");

  const btnSubmit = document.getElementById('admin-submit-btn');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    const origText = btnSubmit.innerText;
    btnSubmit.innerText = 'Processing...';
    // Real upload flow: find request id by matching selected BL values
    (async () => {
      try {
        const matching = requests.find(r => {
          const bls = [r.extracted_bl, r.bl_number, r.bl, r.bill_of_lading];
          if (r.request) bls.push(r.request.extracted_bl, r.request.bl_number, r.request.bl);
          return bls.some(x => x && String(x) === selectedBL);
        });

        if (!matching || !(matching.id || matching.request_id)) {
          // fallback: try to use selectedBL as request id if it looks like a uuid
          const maybeUuid = selectedBL && /^[0-9a-fA-F-]{36}$/.test(selectedBL) ? selectedBL : null;
          if (!maybeUuid) throw new Error('Impossible de trouver la demande correspondante pour ce BL');
        }

        const requestId = (matching && (matching.id || matching.request_id)) || selectedBL;

        // Prepare API base and token early (used to mark UNDER_REVIEW)
        const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
        const defaultLocal = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? `${location.protocol}//${location.hostname}:3000` : location.origin;
        const API_BASE = metaApi || defaultLocal;

        const token = localStorage.getItem('token') || localStorage.getItem('access_token');
        if (!token) throw new Error('Token administrateur introuvable. Veuillez vous reconnecter.');

        // If the request isn't UNDER_REVIEW, ask backend to mark it under review first
        const currentStatus = matching && matching.status ? String(matching.status) : null;
        if (currentStatus !== 'UNDER_REVIEW') {
          // Use force-update endpoint for admins to set UNDER_REVIEW when allowed by policy
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

        const fd = new FormData();
        // documentType expected by backend: use PROFORMA for draft/pricing
        fd.append('documentType', 'PROFORMA');
        fd.append('amount', inputValue.replace(/[^0-9.]/g, ''));
        fd.append('currency', 'USD');
        for (let i = 0; i < fileInp.files.length; i++) {
          fd.append('files', fileInp.files[i]);
        }

        const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/requests/${requestId}/upload-draft`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => null);
          throw new Error(`Upload failed: ${resp.status} ${txt || ''}`);
        }

        const json = await resp.json().catch(() => null);

        // Update local state and UI
        requests = requests.map(req => {
          if ((req.id || req.request_id) === requestId || [req.extracted_bl, req.bl_number, req.bl].some(x => x && String(x) === selectedBL)) {
            return { ...req, status: 'DRAFT_SENT', inv: `$ ${inputValue}`, invStatus: 'error', updated: new Date().toLocaleString() };
          }
          return req;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
        renderAdminTable();
        closeAdminModal();

        // Optionally show result
        alert('Draft envoyé au client.');
      } catch (e) {
        console.warn('handleAdminSubmit error', e);
        alert(String(e.message || e));
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerText = origText;
      }
    })();
  } else {
    // If no button found, still update
    requests = requests.map(req => {
      if (req.bl === selectedBL) {
        if (currentMode === 'DRAFT') {
          const cleanPrice = inputValue.replace(/[^0-9.]/g, '');
          return { ...req, status: 'DRAFT_SENT', inv: `X ${cleanPrice}`, invStatus: 'error', updated: new Date().toLocaleString('en-US') };
        }
        return { ...req, status: 'ISSUED', inv: `$ ${inputValue}`, invStatus: 'ok', ectn: inputValue, updated: new Date().toLocaleString('en-US') };
      }
      return req;
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
    renderAdminTable();
    closeAdminModal();
  }
}

async function fetchAndRenderUser() {
  try {
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    if (!token) return;

    const resp = await fetch('http://localhost:3000/users/me', {
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
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return new Date(v).toLocaleString('fr-FR');
    const d = new Date(String(v));
    if (!isNaN(d.getTime())) return d.toLocaleString('fr-FR');
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

/**
 * Renders the Pending Payments view: requests that need payment verification.
 */
function renderPendingPayments() {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;

  // Consider these statuses as pending payments
  const pendingStatuses = ['DRAFT_SENT', 'PAYMENT_PROOF_UPLOADED'];

  const rows = requests.filter(r => pendingStatuses.includes(r.status));
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;">Aucun paiement en attente.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const status = row.status || '';
    const displayStatus = String(status).replace(/_/g, ' ');
    let blValue = '';
    blValue = blValue || row.extracted_bl || row.bl_number || row.bl || row.bill_of_lading || '';
    if (!blValue && row.request) blValue = row.request.extracted_bl || row.request.bl_number || row.request.bl || '';
    if (!blValue && row.documents && Array.isArray(row.documents)) {
      for (const d of row.documents) {
        if (d.extracted_bl || d.bl_number || d.bl || d.bill_of_lading) {
          blValue = d.extracted_bl || d.bl_number || d.bl || d.bill_of_lading;
          break;
        }
      }
    }

    const viewDocsBtn = `<button class="icon-btn" title="View Docs" onclick="viewDocs('${escapeJs(((row.request && (row.request.id || row.request.request_id)) || row.request_id || row.id || blValue) || '')}')"><i class="fas fa-folder-open"></i></button>`;
    const confirmBtn = `<button class="btn-green" onclick="confirmPaymentFor('${escapeJs(row.id || row.request_id || '')}')" style="font-size:11px; padding:6px 12px;">CONFIRM PAYMENT</button>`;

    return `
      <tr>
        <td class="text-blue" style="font-weight: 600;">${escapeHtml(blValue)}</td>
        <td>${escapeHtml(formatDateFromRow(row))}</td>
        <td><span class="status ${escapeHtml(status)}">${escapeHtml(displayStatus)}</span></td>
        <td>${viewDocsBtn}</td>
        <td>${confirmBtn}</td>
      </tr>
    `;
  }).join('');
}

// Simple handler called from Pending Payments UI to confirm payment (simulated)
window.confirmPaymentFor = function (requestId) {
  if (!requestId) return alert('Request id missing');
  if (!confirm('Confirmer le paiement pour la demande sélectionnée ?')) return;
  // Update local state and re-render — production should call backend endpoint
  requests = requests.map(r => {
    if ((r.id || r.request_id) === requestId) {
      return { ...r, status: 'PAID', updated: new Date().toLocaleString() };
    }
    return r;
  });
  renderPendingPayments();
};

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
      const defaultLocal = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? `${location.protocol}//${location.hostname}:3000` : location.origin;
      return defaultLocal;
    })();
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/documents?requestId=${requestId}`, { headers });
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
      const defaultLocal = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? `${location.protocol}//${location.hostname}:3000` : location.origin;
      return defaultLocal;
    })();
    const token = localStorage.getItem('token') || localStorage.getItem('access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/documents/${documentId}/download`, { headers });
    if (!resp.ok) {
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
  title.innerText = `Documents pour ${req.extracted_bl || req.bl || req.bl_number || ''}`;
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