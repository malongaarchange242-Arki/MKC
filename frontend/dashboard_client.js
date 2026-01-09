import { getMe, createRequest } from './js/client.js';
import { uploadDocuments, getDocument } from './js/documents.js';
import { logout } from './js/auth.js';
import { api } from './js/axios.config.js';

// --- DONNÉES INITIALES (stockage local comme fallback) ---
const STORAGE_KEY = 'logirdc_requests_v1';
let requests = [];
let extractedBL = "";
let selectedRequestType = '';

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
  await loadRequests();
  // start polling notifications (badge + popup content)
  try { startNotifPolling(); } catch (_) {}
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
    p.innerHTML = `<div class="popup-header">Notifications</div><div class="popup-body"><div class="notif-item">Aucune notification</div></div>`;
    document.body.appendChild(p);
  }
  if (!document.getElementById('popup-settings')) {
    const p = document.createElement('div');
    p.id = 'popup-settings';
    p.className = 'dropdown-popup';
    p.setAttribute('aria-hidden', 'true');
    p.innerHTML = `<div class="popup-header">Settings</div><div class="popup-body"><div class="setting-link">Profil</div></div>`;
    document.body.appendChild(p);
  }
}

function formatDateNow() {
  return new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
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
    if (!rows.length) return t.innerHTML = '<tr><td colspan="8">Aucune demande trouvée</td></tr>';

    const rowsHtml = rows.slice(0, 50).map(r => renderRow(r)).join('');
    t.innerHTML = rowsHtml;
    const info = document.getElementById('entries-info');
    if (info) info.textContent = `Showing ${rows.length} of ${rows.length} entries`;
  } catch (e) {
    // fallback to localStorage
    requests = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    loadTable(requests);
  }
}

function loadTable(data = requests) {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  tbody.innerHTML = data.map(row => {
    const invHtml = row.inv ? `
      <a href="#" class="invoice-link" title="Télécharger" data-bl="${escapeHtml(row.bl)}" data-inv="${escapeHtml(row.inv)}" data-invstatus="${escapeHtml(row.invStatus || '')}">
        <div class="invoice-box ${row.invStatus === 'ok' ? 'inv-green' : 'inv-red'}">
          <i class="fas fa-file-download"></i>
          <span>${escapeHtml(row.inv)}</span>
        </div>
      </a>` : '---';

    const docAction = row.ectn ? `<a href="#" class="doc-download" data-bl="${escapeHtml(row.bl)}"><i class="far fa-file-pdf" style="color: #78B13F; cursor: pointer;"></i></a>` : `<i class="far fa-file-pdf text-muted" title="Document non disponible"></i>`;

    return `
      <tr>
        <td style="color: #3B82F6; font-weight: 500;">${escapeHtml(row.bl || row.bl_number || row.extracted_bl || row.bill_of_lading || '')}</td>
        <td>${escapeHtml(row.ref || '---')}</td>
        <td>${escapeHtml(row.updated)}</td>
        <td><span class="status ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/6/6f/Flag_of_the_Democratic_Republic_of_the_Congo.svg" width="20" alt="flag">
            ${escapeHtml(row.country)}
          </div>
        </td>
        <td>${invHtml}</td>
        <td style="color: #64748b;">${escapeHtml(row.ectn || '---')}</td>
        <td>${docAction}</td>
      </tr>
    `;
  }).join('');

  const info = document.getElementById('entries-info');
  if (info) info.textContent = `Showing ${data.length} of ${requests.length} entries`;
}

function renderRow(r) {
  // map backend fields to frontend-friendly shape
  const blVal = r.bl_number || r.bl || r.extracted_bl || r.bill_of_lading || '';
  const blConf = (typeof r.bl_confidence === 'number') ? r.bl_confidence : (typeof r.blConfidence === 'number' ? r.blConfidence : null);
  const ref = r.ref || r.reference || '';
  const updated = new Date(r.updated_at || r.created_at || Date.now()).toLocaleString();
  const status = r.status || r.state || 'UNKNOWN';
  const country = r.country || '';
  const invoice = r.invoice_number || r.inv || r.invoice || null;
  const invStatus = r.inv_status || r.invStatus || null;
  const ectn = r.ectn_number || r.ectn || '';

  const invHtml = invoice ? `
      <a href="#" class="invoice-link" title="Télécharger" data-bl="${escapeHtml(blVal)}" data-inv="${escapeHtml(invoice)}" data-invstatus="${escapeHtml(invStatus || '')}">
        <div class="invoice-box ${invStatus === 'ok' ? 'inv-green' : 'inv-red'}">
          <i class="fas fa-file-download"></i>
          <span>${escapeHtml(invoice)}</span>
        </div>
      </a>` : '---';

  const docAction = ectn ? `<a href="#" class="doc-download" data-bl="${escapeHtml(blVal)}"><i class="far fa-file-pdf" style="color: #78B13F; cursor: pointer;"></i></a>` : `<i class="far fa-file-pdf text-muted" title="Document non disponible"></i>`;

  const blDisplay = blVal
    ? escapeHtml(blVal)
    : `<span class="badge warn">BL en cours...</span>`;

  return `
      <tr>
        <td style="color: #3B82F6; font-weight: 500;">${blDisplay}</td>
        <td>${escapeHtml(ref || '---')}</td>
        <td>${escapeHtml(updated)}</td>
        <td><span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span></td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/6/6f/Flag_of_the_Democratic_Republic_of_the_Congo.svg" width="20" alt="flag">
            ${escapeHtml(country)}
          </div>
        </td>
        <td>${invHtml}</td>
        <td style="color: #64748b;">${escapeHtml(ectn || '---')}</td>
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
    loadTable();
  });

  // Popup buttons
  const notifBtn = document.getElementById('notif-btn');
  const settingsBtn = document.getElementById('settings-btn');
  if (notifBtn) notifBtn.addEventListener('click', () => togglePopup('notif', notifBtn));
  if (settingsBtn) settingsBtn.addEventListener('click', () => togglePopup('settings', settingsBtn));

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
        e.preventDefault();
        const bl = invLink.getAttribute('data-bl') || '';
        downloadInvoice(bl);
        return;
      }
      const docLink = e.target.closest('.doc-download');
      if (docLink) {
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
        return `
          <div class="notif-item" data-id="${escapeHtml(n.id)}">
            <div class="title">🟢 Dossier en cours de traitement</div>
            <div class="message">
              <p>Bonjour,</p>

              <p>Nous avons bien reçu et validé les documents de votre demande FERI.</p>

              <p><strong>Référence :</strong> ${reference}</p>

              <p>Votre dossier est désormais en cours de traitement (<strong>PROCESSING</strong>).<br/>Aucune action n’est requise de votre part pour le moment.</p>

              <p>Vous serez informé(e) dès la prochaine étape.</p>
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
  if (title) title.innerText = "Issue a CTN " + type;
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
  if (selected) selected.textContent = `Requirements for ${type}`;
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
        labelSpan.innerHTML = `<strong>${escapeHtml(fileName)}</strong><br><small>Extracted: ${escapeHtml(extractedBL)}</small>`;
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

    if (!selectedRequestType) {
      alert('Sélectionnez un type de demande.');
      return;
    }

    const statusEl = document.getElementById('uploadStatus');
    if (statusEl) statusEl.innerText = 'Création de la demande...';

    try {
      // 1) Create request on backend
      const created = await createRequest({ type: selectedRequestType });
      const requestId = created.id || created[0]?.id || created.request_id || null;
      if (!requestId) throw new Error('Impossible de récupérer l\'ID de la demande');

      if (statusEl) statusEl.innerText = 'Upload des documents...';

      // 2) Collect files and upload via API
      const filesToUpload = [];
      const fileBl = document.getElementById('file-bl');
      const fileFi = document.getElementById('file-fi');
      const fileCi = document.getElementById('file-ci');
      const fileEd = document.getElementById('file-ed');

      if (fileBl && fileBl.files && fileBl.files.length) filesToUpload.push({ type: 'bill_of_lading', files: Array.from(fileBl.files) });
      if (fileFi && fileFi.files && fileFi.files.length) filesToUpload.push({ type: 'freight_invoice', files: Array.from(fileFi.files) });
      if (fileCi && fileCi.files && fileCi.files.length) filesToUpload.push({ type: 'commercial_invoice', files: Array.from(fileCi.files) });
      if (fileEd && fileEd.files && fileEd.files.length) filesToUpload.push({ type: 'export_declaration', files: Array.from(fileEd.files) });

      // also support generic misc uploads if any input with class .doc-file exists
      document.querySelectorAll('.doc-file').forEach(d => {
        const input = d;
        if (input && input.files && input.files.length) filesToUpload.push({ type: input.dataset?.doc || 'misc', files: Array.from(input.files) });
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
    { id: 'label-ed', txt: 'Export Declaration' }
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
  extractedBL = "";
}

// --- DOWNLOAD SIMULÉ (placeholder) ---
function downloadInvoice(bl) {
  alert(`Téléchargement simulé de la facture pour ${bl}. (Intégrer backend pour vrai fichier)`);
}

function downloadDocument(bl) {
  alert(`Téléchargement simulé du document pour ${bl}. (Intégrer backend pour vrai fichier)`);
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
