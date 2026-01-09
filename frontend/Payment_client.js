// Payment_client.js — version complète et harmonisée avec les nouveaux statuts

const STORAGE_KEY = 'logirdc_requests_v1';

// Statuts centraux (utiliser ces valeurs partout)
const STATUS = {
    CREATED: 'CREATED',
    AWAITING_DOCUMENTS: 'AWAITING_DOCUMENTS',
    SUBMITTED: 'SUBMITTED',
    PROCESSING: 'PROCESSING',
    UNDER_REVIEW: 'UNDER_REVIEW',
    DRAFT_SENT: 'DRAFT_SENT',
    PAYMENT_PROOF_UPLOADED: 'PAYMENT_PROOF_UPLOADED',
    PAYMENT_SUBMITTED: 'PAYMENT_SUBMITTED',
    PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
    VALIDATED: 'VALIDATED',
    ISSUED: 'ISSUED',
    REJECTED: 'REJECTED',
    CANCELLED: 'CANCELLED'
};

let requests = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
let selectedBL = null;

// --- UTILITAIRES ---
function saveRequests() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatStatusLabel(status) {
    const map = {
        [STATUS.CREATED]: "Created",
        [STATUS.AWAITING_DOCUMENTS]: "Awaiting Docs",
        [STATUS.SUBMITTED]: "Submitted",
        [STATUS.PROCESSING]: "Processing",
        [STATUS.UNDER_REVIEW]: "Under Review",
        [STATUS.DRAFT_SENT]: "Awaiting Payment",
        [STATUS.PAYMENT_PROOF_UPLOADED]: "Proof Uploaded",
        [STATUS.PAYMENT_SUBMITTED]: "Proof Submitted",
        [STATUS.PAYMENT_CONFIRMED]: "Payment Confirmed",
        [STATUS.VALIDATED]: "Validated",
        [STATUS.ISSUED]: "Issued",
        [STATUS.REJECTED]: "Rejected",
        [STATUS.CANCELLED]: "Cancelled"
    };
    return map[status] || status;
}

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
    renderClientPayments();
    populateHeaderFromSession();

    // Gestion de l'upload: on attache l'écouteur au champ fichier s'il existe
    const fileInp = document.getElementById('proof-file');
    if (fileInp) {
        fileInp.addEventListener('change', function () {
            const label = document.getElementById('label-proof');
            const submitBtn = document.getElementById('submit-proof-btn');
            if (this.files.length > 0) {
                label.innerHTML = `<strong>${escapeHtml(this.files[0].name)}</strong>`;
                if (submitBtn) submitBtn.style.display = 'block';
                if (label && label.parentElement) label.parentElement.classList.add('file-selected');
            }
        });
    }

    // Submit proof button: attach if present
    const submitProofBtn = document.getElementById('submit-proof-btn');
    if (submitProofBtn) {
        submitProofBtn.addEventListener('click', handleSubmitProof);
    }
});

// --- RENDER TABLEAU DES PAIEMENTS CLIENT ---
function renderClientPayments() {
    const tbody = document.getElementById('client-payment-body');
    if (!tbody) return;

    // Montrer les dossiers en attente de paiement (DRAFT_SENT) et ceux avec preuve déjà uploadée
    const unpaid = requests.filter(req => req.status === STATUS.DRAFT_SENT || req.status === STATUS.PAYMENT_PROOF_UPLOADED);

    if (unpaid.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px;">No pending payments. All set!</td></tr>`;
        return;
    }

    tbody.innerHTML = unpaid.map(req => {
        const statusLabel = formatStatusLabel(req.status);
        const invHtml = req.inv ? `
      <div class="invoice-box ${req.invStatus === 'ok' ? 'inv-green' : 'inv-red'}">
        <i class="fas fa-file-invoice"></i>
        <span>${escapeHtml(req.inv)}</span>
      </div>` : '---';

        // If proof already uploaded, show different action text
        const actionBtn = req.status === STATUS.PAYMENT_PROOF_UPLOADED
            ? `<button class="btn-white" onclick="openPaymentModal('${escapeHtml(req.bl)}')" style="font-size:11px; padding:6px 12px;">VIEW / CHANGE PROOF</button>`
            : `<button class="btn-green" onclick="openPaymentModal('${escapeHtml(req.bl)}')" style="font-size:11px; padding:6px 12px;">UPLOAD PROOF</button>`;

        return `
      <tr>
        <td class="text-blue" style="font-weight:600;">${escapeHtml(req.bl)}</td>
        <td>FERI / CTN Issuance Fees</td>
        <td>${invHtml}</td>
        <td><span class="status ${escapeHtml(req.status)}">${escapeHtml(statusLabel)}</span></td>
        <td>${actionBtn}</td>
      </tr>
    `;
    }).join('');
}

// --- MODAL D'UPLOAD ---
function openPaymentModal(bl) {
    selectedBL = bl;
    const modal = document.getElementById('payment-upload-modal');
    if (!modal) return;

    document.getElementById('modal-bl-ref').innerText = bl;

    // Reset file input UI inside modal each time we open
    const proofInput = document.getElementById('proof-file');
    const label = document.getElementById('label-proof');
    const submitBtn = document.getElementById('submit-proof-btn');

    if (proofInput) proofInput.value = '';
    if (label) label.innerText = "Upload Receipt (PDF/JPG)";
    if (label && label.parentElement) label.parentElement.classList.remove('file-selected');
    if (submitBtn) submitBtn.style.display = 'none';

    // If there is already a proof uploaded for this BL, show filename if known (we don't store file content in localStorage)
    const req = requests.find(r => r.bl === bl);
    if (req && req._proofFileName) {
        if (label) label.innerHTML = `<strong>${escapeHtml(req._proofFileName)}</strong>`;
        if (submitBtn) submitBtn.style.display = 'block';
    }

    modal.style.display = 'flex';
}

function closePaymentModal() {
    const modal = document.getElementById('payment-upload-modal');
    if (!modal) return;
    modal.style.display = 'none';

    const proofInput = document.getElementById('proof-file');
    const submitBtn = document.getElementById('submit-proof-btn');
    const label = document.getElementById('label-proof');

    if (proofInput) proofInput.value = '';
    if (submitBtn) submitBtn.style.display = 'none';
    if (label) label.innerText = "Upload Receipt (PDF/JPG)";
    if (label && label.parentElement) label.parentElement.classList.remove('file-selected');
}

// --- SOUMISSION DE LA PREUVE (simulation locale) ---
function handleSubmitProof() {
    if (!selectedBL) {
        alert('No BL selected.');
        return;
    }

    const proofInput = document.getElementById('proof-file');
    if (!proofInput || proofInput.files.length === 0) {
        alert('Please choose a file to upload as proof.');
        return;
    }

    const file = proofInput.files[0];
    const MAX_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
        alert('File too large. Max 8MB.');
        proofInput.value = '';
        return;
    }

    // Update the request locally: mark as PAYMENT_PROOF_UPLOADED and store filename for UI
    requests = requests.map(r => {
        if (r.bl === selectedBL) {
            return {
                ...r,
                status: STATUS.PAYMENT_PROOF_UPLOADED,
                // store proof filename locally for display only (not the file content)
                _proofFileName: file.name,
                updated: new Date().toLocaleString('fr-FR')
            };
        }
        return r;
    });

    saveRequests();
    renderClientPayments();
    closePaymentModal();

    // Simulated send to admin
    alert(`Proof for ${selectedBL} uploaded and sent to administrator. Status updated to "${formatStatusLabel(STATUS.PAYMENT_PROOF_UPLOADED)}".`);
    selectedBL = null;
}

// --- Expose close function to HTML buttons if needed ---
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;

// --- Small safety: ensure submit button listener exists if added dynamically elsewhere ---
(function ensureSubmitListener() {
    const submitBtn = document.getElementById('submit-proof-btn');
    if (submitBtn && !submitBtn._listenerAttached) {
        submitBtn.addEventListener('click', handleSubmitProof);
        submitBtn._listenerAttached = true;
    }
})();

// ----------------------------
// Header population helpers
// ----------------------------
function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const payload = parts[1];
        const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(atob(b64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

function populateHeaderFromSession() {
    try {
        const nameEl = document.querySelector('.user-info .name');
        const roleEl = document.querySelector('.user-info .role');
        const avatarEl = document.querySelector('.avatar-placeholder');

        // Try to read token from localStorage
        const token = localStorage.getItem('access_token') || localStorage.getItem('token') || null;
        let profile = null;
        if (token) {
            const payload = decodeJwtPayload(token);
            if (payload) {
                profile = {
                    prenom: payload.prenom || payload.first_name || payload.given_name || null,
                    nom: payload.nom || payload.last_name || payload.family_name || null,
                    role: payload.role || null,
                    email: payload.email || null
                };
            }
        }

        // Fallback: try session object in localStorage
        if (!profile) {
            try {
                const sess = JSON.parse(localStorage.getItem('session') || '{}');
                if (sess && sess.user) {
                    const meta = sess.user.user_metadata || {};
                    profile = { prenom: meta.prenom || meta.first_name || null, nom: meta.nom || meta.last_name || null, role: meta.role || null, email: sess.user.email || null };
                }
            } catch (e) {
                // ignore
            }
        }

        // If we still don't have a name, try fetching /users/me from backend (best-effort)
        (async () => {
            try {
                const hasName = Boolean(profile && (profile.prenom || profile.nom));
                if (!hasName) {
                    const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
                    const defaultLocal = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? `${location.protocol}//${location.hostname}:3000` : location.origin;
                    const API_BASE = metaApi || defaultLocal;
                    const token = localStorage.getItem('access_token') || localStorage.getItem('token') || null;
                    if (token) {
                        const resp = await fetch(`${API_BASE.replace(/\/$/,'')}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
                        if (resp.ok) {
                            const body = await resp.json();
                            const p = body?.profile || body?.data || body || null;
                            if (p) {
                                profile = profile || {};
                                profile.prenom = profile.prenom || p.prenom || p.first_name || p.given_name || null;
                                profile.nom = profile.nom || p.nom || p.last_name || p.family_name || null;
                                profile.role = profile.role || p.role || p.user_metadata?.role || null;
                                profile.email = profile.email || p.email || null;
                            }
                        }
                    }
                }
            } catch (e) {
                // ignore network errors
            } finally {
                const prenom = profile?.prenom || '';
                const nom = profile?.nom || '';
                const fullName = (prenom || nom) ? `${prenom} ${nom}`.trim() : (profile?.email || 'Utilisateur');
                const roleText = profile?.role ? String(profile.role) : 'Client';

                if (nameEl) nameEl.textContent = fullName;
                if (roleEl) roleEl.textContent = roleText;
                if (avatarEl) {
                    const initials = ((prenom || '').charAt(0) + (nom || '').charAt(0)).toUpperCase() || (fullName.slice(0,2).toUpperCase());
                    avatarEl.textContent = initials;
                }
            }
        })();
    } catch (e) {
        // fail silently
    }
}
