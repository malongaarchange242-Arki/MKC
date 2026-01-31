document.addEventListener('DOMContentLoaded', async () => {
    const objetRefInput = document.getElementById('objetRef');
    const tableBody = document.getElementById('tableBody');
    const previewModal = document.getElementById('previewModal');
    const clientNameInput = document.getElementById('clientName');
    const origineInput = document.getElementById('origine');

    // Basic guard: if core elements are missing, abort to avoid runtime errors
    if (!objetRefInput || !tableBody || !previewModal) {
        console.warn('creat_facture.js: required DOM elements missing, aborting initialization');
        return;
    }

    const DRAFT_KEY = 'creat_facture_draft_v1';

    function saveDraft() {
        try {
            const rows = Array.from(document.querySelectorAll('.item-row')).map(r => ({
                desc: (r.querySelector('.in-desc') && r.querySelector('.in-desc').value) || '',
                bl: (r.querySelector('.in-bl') && r.querySelector('.in-bl').value) || '',
                cond: (r.querySelector('.in-cond') && r.querySelector('.in-cond').value) || '',
                pu: (r.querySelector('.in-pu') && r.querySelector('.in-pu').value) || '',
                qty: (r.querySelector('.in-qty') && r.querySelector('.in-qty').value) || ''
            }));
            const payload = {
                clientName: clientNameInput.value || '',
                origine: origineInput ? (origineInput.value || '') : '',
                objetRef: objetRefInput.value || '',
                rows,
                updated: Date.now()
            };
            localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
        } catch (e) { console.warn('saveDraft', e); }
    }

    function loadDraft() {
        try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) { return null; }
    }

    // Attach listeners on individual row BL inputs so edits in rows can update the top-level `objetRef`.
    function attachBlListeners(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const inputs = scope.querySelectorAll('.in-bl');
        inputs.forEach(input => {
            if (input.dataset.blListenerAttached) return;
            input.addEventListener('input', () => {
                // Pick the first non-empty BL from rows and write it to objetRef
                const first = Array.from(document.querySelectorAll('.in-bl'))
                    .map(i => (i.value || '').trim())
                    .find(v => v && v.length > 0);
                if (first && objetRefInput && objetRefInput.value !== first) {
                    objetRefInput.value = first;
                    try { saveDraft(); } catch (e) {}
                }
            });
            input.dataset.blListenerAttached = '1';
        });
    }

    function applyDraftToDom(draft) {
        if (!draft) return;
        if (clientNameInput && draft.clientName) clientNameInput.value = draft.clientName;
        if (origineInput && draft.origine) origineInput.value = draft.origine;
        if (objetRefInput && draft.objetRef) objetRefInput.value = draft.objetRef;
        // populate existing rows' BL fields
        if (draft.objetRef) {
            document.querySelectorAll('.in-bl').forEach(i => i.value = draft.objetRef);
        }
        // If saved rows > 1, ensure DOM has same number
        if (Array.isArray(draft.rows) && draft.rows.length > 1) {
            // keep first row as template; clear and repopulate
            const template = document.querySelector('.item-row');
            tableBody.innerHTML = '';
            draft.rows.forEach(rData => {
                const row = template.cloneNode(true);
                const sel = row.querySelector('.in-desc'); if (sel) sel.value = rData.desc || '';
                const inbl = row.querySelector('.in-bl'); if (inbl) inbl.value = rData.bl || draft.objetRef || '';
                const cond = row.querySelector('.in-cond'); if (cond) cond.value = rData.cond || '';
                const pu = row.querySelector('.in-pu'); if (pu) pu.value = rData.pu || '';
                const qty = row.querySelector('.in-qty'); if (qty) qty.value = rData.qty || '';
                tableBody.appendChild(row);
                attachBlListeners(row);
            });
        }
    }

    // Load URL params if present and merge with draft
    const params = new URLSearchParams(window.location.search);
    const urlClient = params.get('client');
    const urlRef = params.get('ref');
    const urlBl = params.get('bl');

    // Detect if opened from admin sidebar/manual flow
    let openedFromSidebar = false;
    try {
        openedFromSidebar = params.has('manual') || (document.referrer || '').toString().includes('dashboard_admin') || !!(window.opener && window.opener.location && String(window.opener.location).includes('dashboard_admin'));
    } catch (e) {
        openedFromSidebar = params.has('manual') || (document.referrer || '').toString().includes('dashboard_admin');
    }

    // public holders for manual invoice
    window.currentInvoiceId = window.currentInvoiceId || null;
    window.currentInvoiceNumber = window.currentInvoiceNumber || null;

    async function createManualInvoiceIfNeeded() {
    try {
        // ❌ ON SUPPRIME params.has('manual')
        if (window.currentInvoiceId) return;
        if (params.has('request_id')) return; // pas manuel si lié à une demande

        const API_BASE = document.querySelector('meta[name="api-base"]')?.content || 'https://mkc-backend-kqov.onrender.com';
        const token = localStorage.getItem('token') || localStorage.getItem('access_token');

            const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/api/client/invoices/manual`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token && { Authorization: `Bearer ${token}` })
            },
            body: JSON.stringify({})
        });

        if (!resp.ok) throw new Error("Erreur création facture manuelle");

        const data = await resp.json();
        const invoice = data.invoice || data;

        window.currentInvoiceId = invoice.id || invoice.invoice_id || null;
        window.currentInvoiceNumber = invoice.invoice_number || invoice.reference || null;

        console.log("✅ Facture manuelle créée :", window.currentInvoiceNumber);

    } catch (e) {
        console.error("❌ createManualInvoiceIfNeeded", e);
        alert("Impossible de générer le numéro de facture");
    }
    }

    // Fetch admin request details and apply to form (client name, BLs)
    async function fetchAndApplyRequestDetails(requestId) {
        try {
            if (!requestId) return;
            const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
            const API_BASE = metaApi || 'https://mkc-backend-kqov.onrender.com';
            const token = localStorage.getItem('token') || localStorage.getItem('access_token');

            const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/requests/${encodeURIComponent(requestId)}`, {
                method: 'GET',
                headers: Object.assign({}, token ? { Authorization: `Bearer ${token}` } : {})
            });

            if (!resp.ok) return;
            const json = await resp.json().catch(() => null);
            const data = json && (json.data || json.request || json);
            const req = data && (data.request || data) ? (data.request || data) : null;
            if (!req) return;

            // Apply BL values
            const serverBl = req.manual_bl || req.bl_number || req.bl_saisi || req.bill_of_lading || '';
            if (serverBl && serverBl.toString().trim()) {
                const cleaned = serverBl.toString();
                if (objetRefInput) objetRefInput.value = cleaned;
                document.querySelectorAll('.in-bl').forEach(i => i.value = cleaned);
                try { saveDraft(); } catch (e) {}
            }

            // Try to resolve client name via admin user endpoint if user_id present
            const userId = req.user_id || req.client_id || null;
            if (userId) {
                try {
                    const uResp = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/users/${encodeURIComponent(userId)}`, {
                        method: 'GET',
                        headers: Object.assign({}, token ? { Authorization: `Bearer ${token}` } : {})
                    });
                    if (uResp.ok) {
                        const uJson = await uResp.json().catch(() => null);
                        const profile = uJson && (uJson.profile || uJson.data || uJson) ? (uJson.profile || uJson.data || uJson) : null;
                        if (profile) {
                            const fullname = [profile.prenom || profile.first_name || '', profile.nom || profile.last_name || ''].filter(Boolean).join(' ').trim();
                            if (fullname && clientNameInput) clientNameInput.value = fullname;
                        }
                    }
                } catch (e) {
                    // non-fatal
                }
            }

        } catch (e) {
            console.warn('Failed to fetch request details', e);
        }
    }

    function normalizeTypeForSelect(typeVal) {
        if (!typeVal) return '';
        const t = (typeVal || '').toString().toUpperCase();
        const hasFERI = t.includes('FERI');
        const hasAD = t.includes('AD');
        if (hasFERI && hasAD) return 'FERI+AD';
        if (hasFERI) return 'FERI';
        if (hasAD) return 'AD';
        return typeVal;
    }


    // If opened from sidebar/dashboard, or with ?blank=1, clear any saved draft and keep fields empty
    const referrer = (document.referrer || '').toString();
    let openerIsDashboard = false;
    try {
        openerIsDashboard = !!(window.opener && window.opener.location && String(window.opener.location).includes('dashboard_admin'));
    } catch (e) { openerIsDashboard = false; }

    // If opened from dashboard/admin sidebar we usually want a blank page,
    // but if a `request_id` is present (opened after sending a draft),
    // we must NOT treat the page as blank so request data can be loaded.
    const isBlank = params.has('blank') || ((referrer.includes('dashboard_admin') || openerIsDashboard) && !params.has('request_id'));
    if (isBlank) {
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
        if (clientNameInput) clientNameInput.value = '';
        if (objetRefInput) objetRefInput.value = '';
        document.querySelectorAll('.in-bl').forEach(i => i.value = '');
    } else {
        // apply draft first, then override with URL params to ensure opening from admin side-panel wins
        const existingDraft = loadDraft();
        if (existingDraft) applyDraftToDom(existingDraft);

        if (urlClient && clientNameInput) clientNameInput.value = urlClient;
        if (urlRef && objetRefInput) objetRefInput.value = urlRef;
        if (urlBl) {
            const cleaned = urlBl.replace(/\s*\([^)]+\)\s*$/,'').trim();
            document.querySelectorAll('.in-bl').forEach(i => i.value = cleaned);
            if (objetRefInput && !objetRefInput.value) objetRefInput.value = cleaned;
        }
        // If URL contains a `type` param (e.g. FERI_ONLY), populate description fields
        if (params.has('type')) {
            const typeVal = (params.get('type') || '').toString();
            const normalized = normalizeTypeForSelect(typeVal);
            if (normalized) {
                document.querySelectorAll('.in-desc').forEach(i => {
                    if (!i.value || i.value.trim() === '') i.value = normalized;
                });
            }
        }
        // If opened for a request, fetch its details and apply client/BL data
        if (params.has('request_id')) {
            const rid = params.get('request_id');
            try { await fetchAndApplyRequestDetails(rid); } catch (e) { /* non-fatal */ }
        }
        // Save whatever initial state we have
        saveDraft();
        // Manual invoice creation moved to preview button; do not auto-create on page load
    }

    // Save on user interactions
    [clientNameInput, origineInput, objetRefInput].forEach(el => {
        if (!el) return;
        el.addEventListener('input', saveDraft);
    });
    // observe table changes to save rows
    const observer = new MutationObserver(saveDraft);
    observer.observe(tableBody, { childList: true, subtree: true });

    // 1. Synchronisation du N° BL (Recopie la référence dans toutes les lignes)
    objetRefInput.addEventListener('input', () => {
        const val = objetRefInput.value;
        document.querySelectorAll('.in-bl').forEach(input => {
            input.value = val;
        });
    });

    // 2. Gestion des lignes du tableau (Ajout/Suppression)
    document.getElementById('addBtn').onclick = () => {
        const row = document.querySelector('.item-row').cloneNode(true);
        row.querySelectorAll('input').forEach(i => i.value = "");
        row.querySelector('.in-bl').value = objetRefInput.value;
        tableBody.appendChild(row);
        attachBlListeners(row);
        saveDraft();
    };

    tableBody.onclick = (e) => {
        if (e.target.classList.contains('btn-del')) {
            if (document.querySelectorAll('.item-row').length > 1) {
                e.target.closest('tr').remove();
                saveDraft();
            }
        }
    };

    // Ensure listeners exist for existing DOM rows on load
    attachBlListeners();

    // 3. Logique de génération de la facture (Preview)
    document.getElementById('previewBtn').onclick = async () => {
        // Ensure a manual invoice is created only when admin clicks preview
        await createManualInvoiceIfNeeded();

        const client = document.getElementById('clientName').value || "................................";
        const origine = document.getElementById('origine').value || "................";
        // Prefer the top `objetRef` if provided; otherwise use the first non-empty BL from table rows
        const _objetRefVal = (document.getElementById('objetRef').value || '').trim();
        let refBL = _objetRefVal || '';

        // If this preview is tied to a request, prefer the server's BL (manual_bl or bl_number)
        // and prefer the request type when determining the objet label. This ensures
        // admin-provided MKC manual BLs or generated FERI refs are used consistently.
        const apiBaseMeta = document.querySelector('meta[name="api-base"]')?.content || '';
        const API_BASE_FOR_REQUEST = apiBaseMeta || 'https://mkc-backend-kqov.onrender.com';
        if (!refBL) {
            const firstRowBl = Array.from(document.querySelectorAll('.in-bl'))
                .map(i => (i.value || '').trim())
                .find(v => v && v.length > 0);
            refBL = firstRowBl || '................';
        }

        // default objet label may be adjusted later from request or rows
        let objetLabel = 'FERI';

        // If a request_id is present, fetch request details and prefer server BL/type
        const requestIdParamForFetch = params.get('request_id');
        if (requestIdParamForFetch) {
            try {
                const token = localStorage.getItem('token') || localStorage.getItem('access_token');
                const resp = await fetch(`${API_BASE_FOR_REQUEST.replace(/\/$/, '')}/admin/requests/${requestIdParamForFetch}`, {
                    method: 'GET',
                    headers: Object.assign({}, token ? { Authorization: `Bearer ${token}` } : {})
                });
                if (resp.ok) {
                    const json = await resp.json().catch(() => null);
                    const reqData = json && (json.data || json.request);
                    if (reqData) {
                        const serverBl = reqData.manual_bl || reqData.bl_number || reqData.bl_saisi || '';
                        if (serverBl && serverBl.toString().trim()) {
                            refBL = serverBl.toString();
                            try {
                                if (objetRefInput) objetRefInput.value = refBL;
                                document.querySelectorAll('.in-bl').forEach(i => i.value = refBL);
                                saveDraft();
                            } catch (e) { /* non-fatal */ }
                        }
                        const serverType = (reqData.type || '') + '';
                        if (serverType) {
                            const normalizedServerType = normalizeTypeForSelect(serverType);
                            document.querySelectorAll('.in-desc').forEach(i => {
                                if (!i.value || i.value.trim() === '') i.value = normalizedServerType;
                            });
                        }
                        if (serverType && serverType.toUpperCase().includes('FERI')) {
                            objetLabel = 'FERI';
                        } else if (serverType && serverType.toUpperCase().includes('AD')) {
                            objetLabel = 'AD';
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch request details for preview', e);
            }
        }

        // Determine request type for Objet label: prefer URL param, fallback to row selections
        const paramType = params.get('type') || '';
        let detectedType = (paramType || '').toString().toUpperCase();
        if (!detectedType) {
            // inspect rows for FERI / AD markers
            const descs = Array.from(document.querySelectorAll('.in-desc')).map(s => (s.value || '').toString().toUpperCase());
            const hasFERI = descs.some(d => d.includes('FERI'));
            const hasAD = descs.some(d => d.includes('AD'));
            if (hasFERI && hasAD) detectedType = 'FERI_AND_AD';
            else if (hasAD) detectedType = 'AD_ONLY';
            else if (hasFERI) detectedType = 'FERI_ONLY';
        }
        // map to desired label per requirements (default set earlier)
        if (String(detectedType).includes('AD') && String(detectedType).includes('FERI')) {
            // when both FERI and AD present, use the first non-empty description value instead of 'FER_AD'
            const firstDesc = (document.querySelector('.in-desc') && document.querySelector('.in-desc').value) || '';
            objetLabel = firstDesc || 'FERI_AD';
        } else if (String(detectedType).includes('AD')) objetLabel = 'AD';
        else objetLabel = 'FERI';

        // Date du jour
        const d = new Date();
        const dateNow = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

        let rowsHtml = '';
        let sousTotalXaf = 0;

        // Parcours des lignes saisies
        document.querySelectorAll('.item-row').forEach((row, idx) => {
            const desc = row.querySelector('.in-desc').value || "-";
            const bl = row.querySelector('.in-bl').value || "";
            const cond = row.querySelector('.in-cond').value || "";
            const pu = Math.round(parseFloat(row.querySelector('.in-pu').value) || 0);
            const qty = Math.round(parseFloat(row.querySelector('.in-qty').value) || 0);

            const montant = pu * qty;
            sousTotalXaf += montant;

            rowsHtml += `
                <tr>
                    <td>${idx + 1}</td>
                    <td style="text-align:left; padding-left:10px;">${desc}</td>
                    <td>${bl}</td>
                    <td>${cond}</td>
                    <td>${pu.toLocaleString('fr-FR')}</td>
                    <td>${qty}</td>
                    <td>${montant.toLocaleString('fr-FR')}</td>
                </tr>`;
        });

        // Calcul des Frais de Service (1,8%) et Total Final
        const fraisService = Math.round(sousTotalXaf * 0.018);
        const totalGeneral = sousTotalXaf + fraisService;

        // If we have a request_id in the URL and a positive total, create an invoice record first so we can show REF
        let invoiceRef = '';
        const urlParams = new URLSearchParams(window.location.search);
        const requestIdParam = urlParams.get('request_id');
        // Build items array to send to server (quantity, packaging, unit_price, line_total...)
        const itemsPayload = Array.from(document.querySelectorAll('.item-row')).map((row, idx) => {
            const desc = row.querySelector('.in-desc').value || '-';
            const bl = row.querySelector('.in-bl').value || '';
            const cond = row.querySelector('.in-cond').value || '';
            const pu = Math.round(parseFloat(row.querySelector('.in-pu').value) || 0);
            const qty = Math.round(parseFloat(row.querySelector('.in-qty').value) || 0);
            const montant = pu * qty;
            return {
                description: desc,
                bl_number: bl,
                packaging: cond,
                unit_price: pu,
                quantity: qty,
                line_total: montant,
                position: idx + 1
            };
        }).filter(i => i.description || i.line_total > 0);
        if (requestIdParam && Number(totalGeneral) > 0) {
            try {
                const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
                const API_BASE = metaApi || 'https://mkc-backend-kqov.onrender.com';
                const token = localStorage.getItem('token') || localStorage.getItem('access_token');
                const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/api/client/invoices`, {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
                    body: JSON.stringify({ request_id: requestIdParam, amount: totalGeneral, currency: 'XAF', bill_of_lading: refBL || undefined, customer_reference: urlParams.get('ref') || undefined, items: itemsPayload })
                });

                if (!resp.ok) {
                    const txt = await resp.text().catch(() => null);
                    console.warn('Create invoice failed', resp.status, txt);
                    alert('Impossible de créer la facture côté serveur: ' + (txt || resp.status));
                } else {
                    const json = await resp.json().catch(() => null);
                    if (json && json.success && json.invoice) {
                        invoiceRef = json.invoice.invoice_number || '';
                    }
                }
            } catch (err) {
                console.warn('createInvoice error', err);
                // Non-blocking: continue to show preview even if invoice creation failed
                alert('Impossible de créer la facture côté serveur: ' + (err.message || err));
            }
            // If creation didn't return a REF, try fetching existing invoice for this request_id
            if ((!invoiceRef || invoiceRef === '') && requestIdParam) {
                try {
                    const metaApi2 = document.querySelector('meta[name="api-base"]')?.content || '';
                    const API_BASE2 = metaApi2 || 'https://mkc-backend-kqov.onrender.com';
                    const token2 = localStorage.getItem('token') || localStorage.getItem('access_token');
                    const headers2 = Object.assign({}, token2 ? { Authorization: `Bearer ${token2}` } : {});
                    const listResp = await fetch(`${API_BASE2.replace(/\/$/, '')}/api/client/invoices?request_id=${encodeURIComponent(requestIdParam)}`, { headers: headers2 });
                    if (listResp.ok) {
                        const listJson = await listResp.json().catch(() => null);
                        const invs = listJson && (listJson.invoices || listJson.data || listJson) ? (listJson.invoices || listJson.data || listJson) : [];
                        if (Array.isArray(invs) && invs.length > 0) {
                            const found = invs[0];
                            invoiceRef = found.invoice_number || found.reference || '';
                        }
                    }
                } catch (e) {
                    console.warn('Failed to fetch existing invoice for request', e);
                }
            }
        } else if (requestIdParam && Number(totalGeneral) <= 0) {
            alert('Le montant total est nul. Entrez des PU/Qté valides pour créer la facture côté serveur.');
        }

        // Ajout de la ligne Frais de Service au tableau
        rowsHtml += `
            <tr style="font-style: italic;">
                <td>${document.querySelectorAll('.item-row').length + 1}</td>
                <td style="text-align:left; padding-left:10px;">Frais de Service</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>${fraisService.toLocaleString('fr-FR')}</td>
            </tr>`;

        // Injection du HTML dans le modal (Structure fixe A4)
        previewModal.innerHTML = `
            <div class="modal-nav no-print">
                <button id="backBtn" class="btn-back">← Éditer</button>
                <div class="nav-right">
                    <button id="sendBtn" class="btn-send">✉ Envoyer</button>
                    <button id="printBtn" class="btn-print">⎙ Imprimer</button>
                </div>
            </div>

            <div class="a4-page" id="invoiceContent">
                <div class="header-logos">
                    <img src="Logotype mkc_bon.png" alt="Logo Maritime Kargo">
                    <img src="Capture_d_écran_2026-01-27_202504-removebg-preview.png" alt="Logo OGEFREM">
                </div>

                <div class="date-line">Date: ${dateNow}</div>
                <div class="ref-line">REF: ${window.currentInvoiceNumber || invoiceRef || ''}</div>
                <div class="invoice-title">FACTURE PROFOMA</div>

                <div class="client-meta">
                    <p>Client: ${client}</p>
                    <p>Objet: Souscription ${objetLabel} BL: ${refBL}</p>
                    <p>Origine: ${origine}</p>
                </div>

                <table class="main-table">
                    <thead>
                        <tr>
                            <th>ID</th><th>DESCRIPTION</th><th>N° BL</th><th>CONDITIONNEMENT</th>
                            <th>PU (XAF)</th><th>QUANTITE</th><th>MT (XAF)</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tr class="total-line">
                        <td colspan="6" style="text-align:right; padding-right:20px;">TOTAL GENERAL</td>
                        <td>${totalGeneral.toLocaleString('fr-FR')}</td>
                    </tr>
                </table>

                <div class="signature-section">
                    <div class="signature-block">
                        La Direction<br><br><br><br>
                        Olivia OKAMBA
                    </div>
                </div>

                <div class="payment-info">
                    <strong>MODE DE PAIEMENT :</strong><br>
                    • Espèce ; MOMOPAY (Code marchand) : 459975 ;<br>
                    • Chèque au nom de Maritime Kargo Consulting ;<br>
                    • Compte Bancaire : 30012 00125 26893701101 30
                </div>

                <div class="footer-line">
                    Siège Social: Immeuble Tour Mayombe 7è étage A - B.P: 4809 Pointe-Noire, République du Congo<br>
                    Tél : +242 05 614 9191 || feri@kargo-consulting.com || www.kargo-consulting.com
                </div>
            </div>
        `;

        // 🔁 Réinjecter la REF après rendu (sécurité si HTML réécrit)
        if (window.currentInvoiceNumber) {
            const refLine = document.querySelector('.ref-line');
            if (refLine) {
                refLine.textContent = 'REF: ' + window.currentInvoiceNumber;
            }
        }

        previewModal.style.display = 'block';

        // Ré-attachement des événements des boutons du modal car ils ont été ré-injectés
        document.getElementById('backBtn').onclick = () => previewModal.style.display = 'none';
        document.getElementById('printBtn').onclick = () => window.print();
        const _sendBtn = document.getElementById('sendBtn');
        if (_sendBtn) {
            // If opened from admin sidebar (manual creation), keep Send button disabled/greyed initially
            // If opened from admin sidebar and NOT tied to a specific request, keep Send disabled.
            // If a `request_id` param is present (opened after upload/send draft), allow Send to be enabled.
            if (openedFromSidebar && !params.has('request_id')) {
                _sendBtn.disabled = true;
                _sendBtn.style.opacity = '0.5';
                _sendBtn.style.cursor = 'not-allowed';
            }
            _sendBtn.onclick = () => {
                (async () => {
                    // disable / grey out to prevent duplicate submissions
                    _sendBtn.disabled = true;
                    _sendBtn.style.opacity = '0.5';
                    _sendBtn.style.cursor = 'not-allowed';

                    const payload = {
                        client_name: client,
                        objet: `Souscription ${objetLabel}`,
                        origin: origine,
                        invoice_date: dateNow.split('-').reverse().join('-') || dateNow,
                        subtotal_amount: Number(sousTotalXaf),
                        service_fee_amount: Number(fraisService),
                        total_amount: Number(totalGeneral),
                        amount: Number(totalGeneral)
                    };

                    // attach items
                    if (Array.isArray(itemsPayload) && itemsPayload.length > 0) payload.items = itemsPayload;

                    const urlParams2 = new URLSearchParams(window.location.search);
                    const requestIdParam2 = urlParams2.get('request_id');
                    const metaApi = document.querySelector('meta[name="api-base"]')?.content || '';
                    const API_BASE = metaApi || 'https://mkc-backend-kqov.onrender.com';
                    const token = localStorage.getItem('token') || localStorage.getItem('access_token');

                    try {
                        if (requestIdParam2) payload.request_id = requestIdParam2;

                        const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/api/client/invoices`, {
                            method: 'POST',
                            headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
                            body: JSON.stringify(payload)
                        });

                        if (!resp.ok) {
                            const txt = await resp.text().catch(() => null);
                            alert('Erreur lors de l enregistrement de la facture: ' + (txt || resp.status));
                            return;
                        }

                        const json = await resp.json().catch(() => null);
                        if (json && json.success && json.invoice) {
                            alert('Facture enregistrée: ' + (json.invoice.invoice_number || '—'));
                            // update displayed REF
                            const refEl = document.querySelector('.ref-line');
                            if (refEl) refEl.innerText = 'REF: ' + (json.invoice.invoice_number || '');

                            // If this preview was opened with a request_id, explicitly trigger the
                            // server-side "draft available" notification now (admin endpoint).
                            if (requestIdParam2) {
                                try {
                                    // Call notification-only endpoint to trigger draft/proforma notification
                                    const notifyResp = await fetch(`${API_BASE.replace(/\/$/, '')}/admin/requests/${requestIdParam2}/notify-draft`, {
                                        method: 'POST',
                                        headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
                                        body: JSON.stringify({ invoice_id: json.invoice.id || null })
                                    });
                                    if (!notifyResp.ok) {
                                        const _txt = await notifyResp.text().catch(() => null);
                                        console.warn('notify draft failed', notifyResp.status, _txt);
                                    }
                                } catch (notifyErr) {
                                    console.warn('notify draft error', notifyErr);
                                }
                            }

                            // close preview modal after successful save then navigate to dashboard
                            if (previewModal) previewModal.style.display = 'none';
                            try { window.location.href = 'dashboard_admin.html'; } catch (e) { history.back(); }
                        } else {
                            alert('Facture enregistrée (réponse inattendue du serveur)');
                        }
                    } catch (e) {
                        console.warn('send invoice error', e);
                        alert('Erreur réseau lors de l enregistrement de la facture');
                    } finally {
                        // re-enable button after request completes only when not opened from sidebar
                        // Re-enable Send after request completes when either not opened from sidebar,
                        // or when opened from sidebar but tied to a request (we allow send in that case).
                        if (!openedFromSidebar || params.has('request_id')) {
                            _sendBtn.disabled = false;
                            _sendBtn.style.opacity = '';
                            _sendBtn.style.cursor = '';
                        }
                    }
                })();
            };
        }
    };

    // Top-level back button to return to admin dashboard
    const backPageBtn = document.getElementById('btn-back-page');
    if (backPageBtn) {
        backPageBtn.onclick = () => {
            // Prefer explicit dashboard page; fallback to history.back()
            try {
                window.location.href = 'dashboard_admin.html';
            } catch (e) {
                history.back();
            }
        };
    }

    // Fermer le modal en cliquant à l'extérieur de la page A4
    window.onclick = (event) => {
        if (event.target == previewModal) {
            previewModal.style.display = "none";
        }
    };
});