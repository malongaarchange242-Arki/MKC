// Payment_client.js — version complète et harmonisée avec les nouveaux statuts

const STORAGE_KEY = 'logirdc_requests_v1';

// i18n helper: use window.i18n.t(key) when available, otherwise fallback
function t(key, fallback) {
    try {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const val = window.i18n.t(key);
            if (val !== undefined && val !== null && String(val).trim() !== '') return val;
        }
    } catch (e) {
        // ignore
    }
    return fallback || key;
}

// Statuts centraux (utiliser ces valeurs partout)
const STATUS = {
    CREATED: 'CREATED',
    AWAITING_DOCUMENTS: 'AWAITING_DOCUMENTS',
    AWAITING_PAYMENT: 'AWAITING_PAYMENT',
    SUBMITTED: 'SUBMITTED',
    PROCESSING: 'PROCESSING',
    UNDER_REVIEW: 'UNDER_REVIEW',
    DRAFT_SENT: 'DRAFT_SENT',
    PROFORMAT_SENT: 'PROFORMAT_SENT',
    PAYMENT_PROOF_UPLOADED: 'PAYMENT_PROOF_UPLOADED',
    PAYMENT_SUBMITTED: 'PAYMENT_SUBMITTED',
    PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
    VALIDATED: 'VALIDATED',
    ISSUED: 'ISSUED',
    REJECTED: 'REJECTED',
    CANCELLED: 'CANCELLED'
};

// Payment modes
const PAYMENT_MODES = {
    MOMOPAY_MTN_CONGO: 'MOMOPAY MTN CONGO',
    AIRTEL_CONGO: 'AIRTEL CONGO',
    ORANGE_MONEY_CAMEROON: 'ORANGE MONEY CAMEROON',
    MPESA_VODACOM_RDC: 'MPESA VODACOM RDC',
    BANK_ACCOUNT: 'BANK ACCOUNT (LCB)',
    CHECK: 'CHECK',
    CASH: 'CASH'
};

// Payment modes that trigger auto transition to PAYMENT_PROOF_UPLOADED
const AUTO_TRANSITION_MODES = [
    PAYMENT_MODES.MOMOPAY_MTN_CONGO,
    PAYMENT_MODES.AIRTEL_CONGO,
    PAYMENT_MODES.ORANGE_MONEY_CAMEROON,
    PAYMENT_MODES.MPESA_VODACOM_RDC,
    PAYMENT_MODES.CASH
];

let selectedBL = null;
let selectedRequestId = null;
let requests = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
// invoices cache from backend
let invoicesMap = new Map();

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
        [STATUS.PROFORMAT_SENT]: "Awaiting Payment",
        [STATUS.AWAITING_PAYMENT]: "Awaiting Payment",
        [STATUS.PAYMENT_PROOF_UPLOADED]: "Proof Uploaded",
        [STATUS.PAYMENT_SUBMITTED]: "Proof Submitted",
        [STATUS.PAYMENT_CONFIRMED]: "Payment Confirmed",
        [STATUS.VALIDATED]: "Validated",
        [STATUS.ISSUED]: "Issued",
        [STATUS.REJECTED]: "Rejected",
        [STATUS.CANCELLED]: "Cancelled"
    };
    if (window.i18n && typeof window.i18n.t === 'function') {
        const t = window.i18n.t(status);
        return t || map[status] || status;
    }
    return map[status] || status;
}

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Load requests (source of truth) then invoices, then render.
    // If API is unavailable or unauthenticated, fall back to localStorage cache.
    fetchRequests()
        .then(() => fetchInvoices())
        .then(() => {
            renderClientPayments();
        })
        .catch(() => {
            renderClientPayments();
        });
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

// --- Auto-refresh (polling) to keep the UI in sync when other users act ---
const POLL_INTERVAL_MS = 8000; // 8 seconds
let _clientAutoRefreshTimer = null;
async function refreshClientDataOnce() {
    try {
        await fetchRequests();
        await fetchInvoices();
        renderClientPayments();
    } catch (e) {
        // ignore transient errors
    }
}
function startClientAutoRefresh() {
    if (_clientAutoRefreshTimer) return;
    _clientAutoRefreshTimer = setInterval(() => {
        refreshClientDataOnce();
    }, POLL_INTERVAL_MS);
    // do an immediate fetch too
    refreshClientDataOnce();
}
function stopClientAutoRefresh() {
    if (_clientAutoRefreshTimer) {
        clearInterval(_clientAutoRefreshTimer);
        _clientAutoRefreshTimer = null;
    }
}

// Pause polling when page is hidden to reduce server load
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopClientAutoRefresh(); else startClientAutoRefresh();
});

// Start auto-refresh after initial load
window.addEventListener('load', () => {
    try { startClientAutoRefresh(); } catch (e) {}
});

// --- RENDER TABLEAU DES PAIEMENTS CLIENT ---
function renderClientPayments() {
    const tbody = document.getElementById('client-payment-body');
    if (!tbody) return;

    // Montrer uniquement les dossiers en attente de paiement (AWAITING_PAYMENT).
    // Les lignes dont la preuve a été uploadée (PAYMENT_PROOF_UPLOADED) seront retirées immédiatement.
    const unpaid = requests.filter(req => req.status === STATUS.AWAITING_PAYMENT || req.status === STATUS.DRAFT_SENT);

    if (unpaid.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px;">${escapeHtml(t('no_pending_payments','No pending payments. All set!'))}</td></tr>`;
        return;
    }

        tbody.innerHTML = unpaid.map(req => {
                const statusLabel = formatStatusLabel(req.status);

                // Robust BL extraction: prefer explicit BL fields (don't use internal UUID `id`)
                const blValue = req.bl_number || req.bl || req.extracted_bl || req.bill_of_lading || req.bl_ref || req.blNumber || req.reference || '';

                // Amount column: prefer authoritative backend invoice amount where available
                const requestKey = String(req.request_id || req.id || '');
                const invoiceFromApi =
                    invoicesMap.get(requestKey) ||
                    invoicesMap.get(String(req.bl_number || req.bl || req.extracted_bl || '')) ||
                    null;
                // Force display in XAF regardless of invoice currency (per UI requirement)
                const amountValue = (invoiceFromApi && invoiceFromApi.amount_due !== null && invoiceFromApi.amount_due !== undefined)
                    ? escapeHtml(`${invoiceFromApi.amount_due} XAF`)
                    : (req.amount ? escapeHtml(String(req.amount) + ' XAF') : (req.inv ? escapeHtml(req.inv) : '1500 XAF'));

                // Determine action button label/class based on status (all labels use i18n)
                let actionLabelKey = 'upload_proof';
                let actionFallback = 'UPLOAD PROOF';
                let actionClass = 'btn-green';

                switch (req.status) {
                    case STATUS.PAYMENT_PROOF_UPLOADED:
                        actionLabelKey = 'view_change_proof';
                        actionFallback = 'VIEW / CHANGE PROOF';
                        actionClass = 'btn-white';
                        break;
                    case STATUS.PAYMENT_SUBMITTED:
                        actionLabelKey = 'proof_submitted';
                        actionFallback = 'PROOF SUBMITTED';
                        actionClass = 'btn-white';
                        break;
                    case STATUS.PAYMENT_CONFIRMED:
                        actionLabelKey = 'payment_confirmed';
                        actionFallback = 'PAYMENT CONFIRMED';
                        actionClass = 'btn-white';
                        break;
                    case STATUS.DRAFT_SENT:
                    default:
                        actionLabelKey = 'upload_proof';
                        actionFallback = 'UPLOAD PROOF';
                        actionClass = 'btn-green';
                        break;
                }

                const actionBtn = `<button class="${actionClass}" onclick="openPaymentModal('${escapeHtml(blValue)}')" style="font-size:11px; padding:6px 12px;">${escapeHtml(t(actionLabelKey, actionFallback))}</button>`;

                const blDisplay = blValue ? escapeHtml(blValue) : `<span class="badge warn">${escapeHtml(t('bl_pending','BL en cours...'))}</span>`;

                // Create payment mode select
                const currentMode = req.payment_mode || '';
                const paymentModeSelect = `
                    <select class="payment-mode-select" onchange="handlePaymentModeChange('${escapeHtml(blValue)}', this.value)" style="padding:6px; border:1px solid #ccc; border-radius:4px; font-size:12px;">
                        <option value="">${escapeHtml(t('select_mode','-- Select Mode --'))}</option>
                        <option value="${PAYMENT_MODES.MOMOPAY_MTN_CONGO}" ${currentMode === PAYMENT_MODES.MOMOPAY_MTN_CONGO ? 'selected' : ''}>${escapeHtml(t('momopay_mtn_congo', PAYMENT_MODES.MOMOPAY_MTN_CONGO))}</option>
                        <option value="${PAYMENT_MODES.AIRTEL_CONGO}" ${currentMode === PAYMENT_MODES.AIRTEL_CONGO ? 'selected' : ''}>${escapeHtml(t('airtel_congo', PAYMENT_MODES.AIRTEL_CONGO))}</option>
                        <option value="${PAYMENT_MODES.ORANGE_MONEY_CAMEROON}" ${currentMode === PAYMENT_MODES.ORANGE_MONEY_CAMEROON ? 'selected' : ''}>${escapeHtml(t('orange_money_cameroon', PAYMENT_MODES.ORANGE_MONEY_CAMEROON))}</option>
                        <option value="${PAYMENT_MODES.MPESA_VODACOM_RDC}" ${currentMode === PAYMENT_MODES.MPESA_VODACOM_RDC ? 'selected' : ''}>${escapeHtml(t('mpesa_vodacom_rdc', PAYMENT_MODES.MPESA_VODACOM_RDC))}</option>
                        <option value="${PAYMENT_MODES.BANK_ACCOUNT}" ${currentMode === PAYMENT_MODES.BANK_ACCOUNT ? 'selected' : ''}>${escapeHtml(t('bank_account_lcb', PAYMENT_MODES.BANK_ACCOUNT))}</option>
                        <option value="${PAYMENT_MODES.CHECK}" ${currentMode === PAYMENT_MODES.CHECK ? 'selected' : ''}>${escapeHtml(t('check', PAYMENT_MODES.CHECK))}</option>
                        <option value="${PAYMENT_MODES.CASH}" ${currentMode === PAYMENT_MODES.CASH ? 'selected' : ''}>${escapeHtml(t('cash', PAYMENT_MODES.CASH))}</option>
                    </select>
                `;

                return `
            <tr>
                <td class="text-blue" style="font-weight:600;">${blDisplay}</td>
                <td>FERI / CTN Issuance Fees</td>
                <td>${amountValue}</td>
                <td><span class="status ${escapeHtml(req.status)}">${escapeHtml(statusLabel)}</span></td>
                <td>${actionBtn}</td>
                <td>${paymentModeSelect}</td>
            </tr>
        `;
        }).join('');
}

// Fetch requests from backend and use as source of truth for `requests`.
// Falls back to existing `requests` (from localStorage) on error.
async function fetchRequests() {
    try {
        const token = localStorage.getItem('access_token') || localStorage.getItem('token') || null;
        const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
        const defaultLocal = 'https://mkc-backend-kqov.onrender.com';
        const API_BASE = metaApi || defaultLocal;

        // The requests listing endpoint is mounted at `/requests/me` on the backend
        // (see backend `main.ts` where `requestsModule` uses `/requests`).
        const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/requests/me`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined
        });

        if (resp.status === 401 || resp.status === 403) {
            apiAuthInvalid = true;
            return;
        }
        // If the backend doesn't expose a requests endpoint, don't overwrite local cache
        if (resp.status === 404) {
            return;
        }

        if (!resp.ok) {
            // non-ok: do not overwrite local cache
            return;
        }

        const body = await resp.json().catch(() => null);
        if (!body) return;

        // Accept multiple possible shapes: { requests: [...] } or { data: [...] } or array
        let list = null;
        if (Array.isArray(body)) list = body;
        else if (Array.isArray(body.requests)) list = body.requests;
        else if (Array.isArray(body.data)) list = body.data;
        else if (Array.isArray(body.results)) list = body.results;

        if (!Array.isArray(list)) return;

        // Adopt server-provided requests as source of truth
        requests = list.map(r => ({ ...r }));

        // Persist cache for offline/dev use
        try {
            saveRequests();
        } catch (e) {
            // ignore storage errors
        }
    } catch (e) {
        // network or parse error: keep existing local requests
    }
}

// Fetch invoices from backend and fill invoicesMap
async function fetchInvoices() {
    try {
        const token = localStorage.getItem('access_token') || localStorage.getItem('token') || null;
        const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
            const defaultLocal = 'https://mkc-backend-kqov.onrender.com';
            const API_BASE = metaApi || defaultLocal;

        const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/api/client/invoices`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined
        });
        if (!resp.ok) return;
        const body = await resp.json();
        const invoices = body?.invoices || [];
        invoicesMap = new Map();
        invoices.forEach(inv => {
            const normalized = {
                ...inv,
                amount_due: inv.amount_due ?? inv.amount ?? null,
                status: inv.status ?? inv.invoice_status ?? null
            };
            if (normalized.request_id) invoicesMap.set(String(normalized.request_id), normalized);
            if (normalized.bl_number) invoicesMap.set(String(normalized.bl_number), normalized);
        });
    } catch (e) {
        // ignore - best-effort
    }
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
    if (label) label.innerText = t('upload_receipt','Upload Receipt (PDF/JPG)');
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
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '';
        submitBtn.innerText = t('send_proof','Send Proof');
    }
    if (label) label.innerText = "Upload Receipt (PDF/JPG)";
    if (label && label.parentElement) label.parentElement.classList.remove('file-selected');
}

// --- SOUMISSION DE LA PREUVE (simulation locale) ---
function handleSubmitProof() {
    if (!selectedBL) {
            alert(t('no_bl_selected','No BL selected.'));
        return;
    }

    const proofInput = document.getElementById('proof-file');
        if (!proofInput || proofInput.files.length === 0) {
        alert(t('choose_file','Please choose a file to upload as proof.'));
        return;
    }

    const file = proofInput.files[0];
    const MAX_BYTES = 8 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
        alert(t('file_too_large','File too large. Max 8MB.'));
        proofInput.value = '';
        return;
    }

    const submitBtn = document.getElementById('submit-proof-btn');
    let __origText = null;
    if (submitBtn) {
        __origText = submitBtn.innerText;
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.6';
        submitBtn.innerText = 'Sending...';
    }

    (async () => {
        try {
            const token = localStorage.getItem('access_token') || localStorage.getItem('token') || null;
            const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
            const defaultLocal = 'https://mkc-backend-kqov.onrender.com';
            const API_BASE = metaApi || defaultLocal;

            // resolve request id for this BL
            let requestId = selectedRequestId;
            if (!requestId) {
                const match = requests.find(r => [r.bl, r.bl_number, r.extracted_bl, r.bill_of_lading].some(x => x && String(x) === String(selectedBL)));
                requestId = match ? (match.request_id || match.id || null) : null;
            }
            if (!requestId) throw new Error('Request id not found for this BL');

            const fd = new FormData();
            fd.append('file', file);

            const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/api/client/invoices/${encodeURIComponent(requestId)}/proofs`, {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                body: fd
            });

            if (!resp.ok) {
                const txt = await resp.text().catch(() => null);
                throw new Error(`Upload failed: ${resp.status} ${txt || ''}`);
            }

            const body = await resp.json().catch(() => null);
            if (!body || !body.success) throw new Error(body?.message || 'Upload failed');

            // on success: mark the local request as having proof uploaded so it
            // stays consistent in the UI instead of disappearing.
            let matched = false;
            requests = requests.map(r => {
                const matches = (r.request_id === requestId || r.id === requestId || [r.bl, r.bl_number, r.extracted_bl].some(x => x && String(x) === String(selectedBL)));
                if (matches) {
                    matched = true;
                    r.status = STATUS.PAYMENT_PROOF_UPLOADED;
                    r._proofFileName = file.name;
                }
                return r;
            });

            // If we didn't have the request locally (edge-case), avoid removing
            // the UI row silently — instead keep local list as-is. Optionally we
            // could fetch server state here to sync, but for now persist the
            // best-effort local update.
            saveRequests();
            renderClientPayments();
            // ensure we re-sync with server state (in case server-side rules modified status)
            try { await refreshClientDataOnce(); } catch (e) {}
            closePaymentModal();
            alert(t('proof_uploaded','Proof uploaded and recorded. Thank you.'));
            selectedBL = null;
            selectedRequestId = null;
        } catch (err) {
            alert(String(err.message || err));
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.style.opacity = '';
                submitBtn.innerText = __origText || 'Send Proof';
            }
        }
    })();
}

// Expose close function to HTML buttons if needed ---
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;

// --- Fonction pour gérer le changement de mode de paiement ---
async function handlePaymentModeChange(blValue, selectedMode) {
    if (!blValue || !selectedMode) return;

    try {
        const token = localStorage.getItem('access_token') || localStorage.getItem('token') || null;
        const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
        const defaultLocal = 'https://mkc-backend-kqov.onrender.com';
        const API_BASE = metaApi || defaultLocal;

        // Refresh server state to avoid stale local cache, then find the request
        try {
            await fetchRequests();
        } catch (e) {
            console.warn('fetchRequests failed before payment mode change', e);
        }

        let requestId = null;
        let reqIndex = -1;
        for (let idx = 0; idx < requests.length; idx++) {
            const r = requests[idx];
            if ([r.bl, r.bl_number, r.extracted_bl, r.bill_of_lading].some(x => x && String(x) === String(blValue))) {
                requestId = r.request_id || r.id || null;
                reqIndex = idx;
                break;
            }
        }

        if (!requestId) {
            console.error('Request ID not found for BL:', blValue);
            return;
        }

        // Sauvegarder le mode de paiement sélectionné
        if (reqIndex >= 0) {
            requests[reqIndex].payment_mode = selectedMode;
        }

        // Si le mode nécessite que le client téléverse une preuve (Bank account / Check),
        // informer l'utilisateur et ne pas déclencher la transition automatique.
        if (selectedMode === PAYMENT_MODES.BANK_ACCOUNT || selectedMode === PAYMENT_MODES.CHECK) {
            try {
                // Persist to backend the selected payment_mode (no status change)
                const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/api/client/invoices/${encodeURIComponent(requestId)}/mode`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({ payment_mode: selectedMode })
                });

                if (!resp.ok) {
                    const txt = await resp.text().catch(() => null);
                    console.error('Failed to persist payment_mode:', resp.status, txt);
                    alert(t('transition_failed','Failed to persist payment mode or change status.'));
                } else {
                    // Persist locally so selection remains visible
                    saveRequests();
                    renderClientPayments();
                }
            } catch (e) {
                console.error('Error persisting payment_mode:', e);
                alert(t('transition_failed','Failed to persist payment mode or change status.'));
            }

            alert(t('bank_check_alert',"D'après votre mode de paiement, veuillez téléverser une preuve de paiement en cliquant sur UPLOAD PROOF."));
            return;
        }

        // Si c'est un mode mobile-money qui doit déclencher la transition côté serveur,
        // appeler d'abord l'API de transition puis mettre à jour l'UI uniquement en cas de succès.
        if (AUTO_TRANSITION_MODES.includes(selectedMode)) {
            // Only attempt server-side transition when the request is in an allowed from-state.
            const currentStatus = (reqIndex >= 0 && requests[reqIndex]) ? requests[reqIndex].status : null;
            const ALLOWED_AUTO_FROM = [STATUS.DRAFT_SENT, STATUS.PROFORMAT_SENT, STATUS.AWAITING_PAYMENT, STATUS.PAYMENT_CONFIRMED];
            if (!ALLOWED_AUTO_FROM.includes(currentStatus)) {
                // Persist payment_mode only and inform the user that auto-transition
                // could not be performed due to current workflow state.
                try {
                    const respMode = await fetch(`${API_BASE.replace(/\/$/, '')}/api/client/invoices/${encodeURIComponent(requestId)}/mode`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { Authorization: `Bearer ${token}` } : {})
                        },
                        body: JSON.stringify({ payment_mode: selectedMode })
                    });

                    if (!respMode.ok) {
                        const txt = await respMode.text().catch(() => null);
                        console.error('Failed to persist payment_mode (no auto transition):', respMode.status, txt);
                        alert(t('transition_failed','Failed to persist payment mode or change status.'));
                    } else {
                        if (reqIndex >= 0) requests[reqIndex].payment_mode = selectedMode;
                        saveRequests();
                        renderClientPayments();
                    }
                } catch (e) {
                    console.error('Error persisting payment_mode (no auto transition):', e);
                    alert(t('transition_failed','Failed to persist payment mode or change status.'));
                }

                alert(t('auto_transition_not_allowed','Auto transition not allowed for this request state. Your payment mode was saved.'));
                return;
            }

            try {
                const resp = await fetch(
                    `${API_BASE.replace(/\/$/, '')}/api/client/invoices/${encodeURIComponent(requestId)}/transition`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { Authorization: `Bearer ${token}` } : {})
                        },
                        body: JSON.stringify({
                            new_status: STATUS.PAYMENT_PROOF_UPLOADED,
                            payment_mode: selectedMode
                        })
                    }
                );

                if (!resp.ok) {
                    const txt = await resp.text().catch(() => null);
                    console.error(`Transition failed: ${resp.status} ${txt || ''}`);
                    alert(t('transition_failed','Failed to persist payment mode or change status.')); 
                } else {
                    // Update local cache only after successful backend transition
                    if (reqIndex >= 0) {
                        requests[reqIndex].status = STATUS.PAYMENT_PROOF_UPLOADED;
                        requests[reqIndex].payment_mode = selectedMode;
                    }
                }
            } catch (err) {
                console.error('Error calling transition API:', err);
                alert(t('transition_failed','Failed to persist payment mode or change status.'));
            }
        }

        // For non-auto modes (e.g., CASH), persist the selection to backend
        if (!AUTO_TRANSITION_MODES.includes(selectedMode)) {
            try {
                const respMode = await fetch(`${API_BASE.replace(/\/$/, '')}/api/client/invoices/${encodeURIComponent(requestId)}/mode`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({ payment_mode: selectedMode })
                });

                if (!respMode.ok) {
                    const txt = await respMode.text().catch(() => null);
                    console.error('Failed to persist payment_mode:', respMode.status, txt);
                    alert(t('transition_failed','Failed to persist payment mode or change status.'));
                } else {
                    // Update local cache after success
                    if (reqIndex >= 0) requests[reqIndex].payment_mode = selectedMode;
                    saveRequests();
                    renderClientPayments();
                }
            } catch (e) {
                console.error('Error persisting payment_mode:', e);
                alert(t('transition_failed','Failed to persist payment mode or change status.'));
            }
        } else {
            // For auto-transition modes the local update was done above on success
            saveRequests();
            renderClientPayments();
            // trigger a background sync to reflect server-side state quickly
            try { await refreshClientDataOnce(); } catch (e) {}
        }
    } catch (err) {
        console.error('Error handling payment mode change:', err);
    }
}

// Expose la fonction au scope global
window.handlePaymentModeChange = handlePaymentModeChange;

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
                    const defaultLocal = 'https://mkc-backend-kqov.onrender.com';
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
