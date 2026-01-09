// payment_admin.js — Admin payment validation (harmonisé avec les statuts centraux)

const STORAGE_KEY = 'logirdc_requests_v1';

// Statuts centraux (utiliser ces valeurs partout dans l'app)
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

// --- Helpers ---
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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    renderPaymentTable();

    const searchEl = document.getElementById('adminSearch');
    if (searchEl) {
        searchEl.addEventListener('input', (e) => {
            const term = (e.target.value || '').toLowerCase();
            const filtered = requests.filter(req =>
                req.status === STATUS.PAYMENT_PROOF_UPLOADED && (req.bl || '').toLowerCase().includes(term)
            );
            renderPaymentTable(filtered);
        });
    }
});

// --- Render table ---
function renderPaymentTable(data = null) {
    const tbody = document.getElementById('payment-table-body');
    if (!tbody) return;

    // Par défaut, afficher les dossiers avec preuve uploadée
    const displayData = Array.isArray(data) ? data : requests.filter(req => req.status === STATUS.PAYMENT_PROOF_UPLOADED);

    if (displayData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#64748b;">No pending payments to validate.</td></tr>`;
        return;
    }

    tbody.innerHTML = displayData.map(row => {
        const invText = row.inv ? escapeHtml(row.inv) : '---';
        const proofLabel = row._proofFileName ? escapeHtml(row._proofFileName) : 'View proof';
        const statusLabel = formatStatusLabel(row.status);

        return `
      <tr>
        <td style="color: #3B82F6; font-weight: 600;">${escapeHtml(row.bl)}</td>
        <td style="font-weight: bold; color: var(--primary-orange);">${invText}</td>
        <td><span class="status ${escapeHtml(row.status)}">${escapeHtml(statusLabel)}</span></td>
        <td>
          <button class="btn-white" style="font-size:11px; padding:4px 8px;" onclick="viewProof('${escapeHtml(row.bl)}')">
            <i class="fas fa-eye"></i> ${proofLabel}
          </button>
        </td>
        <td>
          <button class="btn-green" onclick="openPaymentModal('${escapeHtml(row.bl)}')" style="font-size:11px; padding:6px 12px;">
            VALIDATE
          </button>
        </td>
      </tr>
    `;
    }).join('');
}

// --- View proof (placeholder) ---
function viewProof(bl) {
    const req = requests.find(r => r.bl === bl);
    if (!req) {
        alert(`No request found for ${bl}`);
        return;
    }
    // If filename stored, show it; otherwise indicate no file stored locally
    if (req._proofFileName) {
        alert(`Proof for ${bl}: ${req._proofFileName}\n(Implement backend viewer to open actual file.)`);
    } else {
        alert(`No proof file stored locally for ${bl}.`);
    }
}

// --- Modal handling ---
function openPaymentModal(bl) {
    selectedBL = bl;
    const target = document.getElementById('target-bl-payment');
    if (target) target.innerText = bl;
    const modal = document.getElementById('payment-modal');
    if (modal) modal.style.display = 'flex';

    const confirmBtn = document.getElementById('confirm-pay-btn');
    if (confirmBtn) {
        // remove previous handler to avoid duplicates
        confirmBtn.onclick = null;
        confirmBtn.onclick = function () {
            processValidation(bl);
        };
    }
}

function closePaymentModal() {
    const modal = document.getElementById('payment-modal');
    if (modal) modal.style.display = 'none';
}

// --- Process validation (admin confirms payment) ---
function processValidation(bl) {
    let found = false;

    requests = requests.map(req => {
        if (req.bl === bl) {
            found = true;
            // Convert invoice from X to $ safely
            const prevInv = req.inv || '';
            // Remove leading 'X ' if present, otherwise strip non-numeric chars
            const numericPart = prevInv.startsWith('X ') ? prevInv.slice(2) : (prevInv.replace(/[^0-9.]/g, '') || '0');

            return {
                ...req,
                status: STATUS.PAYMENT_CONFIRMED,
                inv: `$ ${numericPart}`,
                invStatus: 'ok',
                updated: new Date().toLocaleString('en-US')
            };
        }
        return req;
    });

    if (!found) {
        alert(`Request ${bl} not found.`);
        return;
    }

    saveRequests();
    closePaymentModal();
    renderPaymentTable();
    alert(`Payment for ${bl} has been successfully validated.`);
}

// --- Expose functions to global scope for inline onclick handlers in HTML ---
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;
window.processValidation = processValidation;
window.viewProof = viewProof;
