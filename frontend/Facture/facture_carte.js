document.addEventListener('DOMContentLoaded', () => {
    // --- SÉLECTEURS ---
    const clientNameInput = document.getElementById('clientName');
    const invoiceDateInput = document.getElementById('invoiceDate');
    const tableBody = document.getElementById('tableBody');
    const previewModal = document.getElementById('previewModal');
    const addBtn = document.getElementById('addBtn');
    const previewBtn = document.getElementById('previewBtn');
    const saveBtn = document.getElementById('saveBtn');

    // --- 1. GESTION DU TABLEAU DYNAMIQUE ---
    function addRow() {
        const tr = document.createElement('tr');
        tr.className = 'item-row';

        tr.innerHTML = `
            <td>
                <select class="in-desc">
                    <option value="Contribution annuelle">Contribution annuelle</option>
                    <option value="Achat carte de chargeur">Achat carte de chargeur</option>
                    <option value="Frais de dossier">Frais de dossier</option>
                    <option value="custom">Autre (Saisir manuellement)...</option>
                </select>
                <input type="text" class="in-desc-custom" style="display: none; margin-top:5px;" placeholder="Désignation personnalisée">
            </td>
            <td style="display:flex; gap:5px;">
                <select class="in-validity-type" style="width:40%;">
                    <option value="year">Année</option>
                    <option value="date">Date</option>
                </select>
                <input type="number" class="in-val-year" style="width:60%;" value="2026">
                <input type="date" class="in-val-date" style="width:60%; display:none;">
            </td>
            <td><input type="number" class="in-amount" placeholder="0"></td>
            <td><button class="btn-del">×</button></td>
        `;
        tableBody.appendChild(tr);
        attachRowEvents(tr);
    }

    function attachRowEvents(row) {
        // Gérer l'affichage du champ personnalisé pour la désignation
        row.querySelector('.in-desc').addEventListener('change', (e) => {
            row.querySelector('.in-desc-custom').style.display = e.target.value === 'custom' ? 'block' : 'none';
        });

        // Gérer l'affichage Switch entre Année et Date
        row.querySelector('.in-validity-type').addEventListener('change', (e) => {
            const isYear = e.target.value === 'year';
            row.querySelector('.in-val-year').style.display = isYear ? 'block' : 'none';
            row.querySelector('.in-val-date').style.display = isYear ? 'none' : 'block';
        });
    }

    // Ajouter une ligne au clic
    addBtn.onclick = () => addRow();

    // Supprimer une ligne
    tableBody.onclick = (e) => {
        if (e.target.classList.contains('btn-del')) {
            const rows = document.querySelectorAll('.item-row');
            if (rows.length > 1) {
                e.target.closest('tr').remove();
            }
        }
    };

    // --- 2. FORMATAGE DATE EN FRANÇAIS ---
    function formatLongDate(dateStr) {
        if (!dateStr) return "................";
        const date = new Date(dateStr);
        const options = { day: 'numeric', month: 'long', year: 'numeric' };
        let formatted = date.toLocaleDateString('fr-FR', options);
        // Majuscule sur le mois
        return formatted.replace(/(\s)([a-z])/, (match, p1, p2) => p1 + p2.toUpperCase());
    }

    // --- Helpers for reference management ---
    function getCurrentRef() {
        try {
            const fromWindow = (window.currentInvoiceNumber || '').toString();
            if (fromWindow && fromWindow.trim()) return fromWindow;
        } catch (e) {}
        try { return (localStorage.getItem('invoice_reference') || '').toString(); } catch (e) { return ''; }
    }

    function setCurrentRef(v) {
        try { window.currentInvoiceNumber = v; } catch (e) {}
        try { if (v) localStorage.setItem('invoice_reference', v); } catch (e) {}
    }

    // --- 3. PREVIEW & IMPRESSION ---
    async function ensureServerReference() {
        try {
            const current = getCurrentRef();
            if (current && String(current).trim()) return;

            const token = localStorage.getItem('token') || localStorage.getItem('access_token');
            const API_BASE = "https://mkc-backend-kqov.onrender.com";

            if (token) {
                try {
                    const resp = await fetch(`${API_BASE.replace(/\/$/, '')}/api/client/invoices/manual`, {
                        method: 'POST',
                        headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
                        body: JSON.stringify({})
                    });
                    if (resp.ok) {
                        const data = await resp.json().catch(() => null);
                        const invoice = data && (data.invoice || data) ? (data.invoice || data) : null;
                        const ref = invoice && (invoice.reference || invoice.invoice_number || invoice.ref) ? (invoice.reference || invoice.invoice_number || invoice.ref) : null;
                        if (ref) {
                            setCurrentRef(ref);
                            return;
                        }
                    }
                } catch (e) {
                    // ignore server failure
                }
            }

            // Fallback: generate a provisional reference client-side
            try {
                const month = invoiceDateInput.value ? String(new Date(invoiceDateInput.value).getMonth() + 1).padStart(2, '0') : String(new Date().getMonth() + 1).padStart(2, '0');
                const key = `local_ref_counter_${month}_${new Date().getFullYear()}`;
                let counter = Number(localStorage.getItem(key) || '0') || 0;
                counter += 1;
                localStorage.setItem(key, String(counter));
                const num = String(counter).padStart(3, '0');
                const provisional = `${num}/${month}/mkc`;
                setCurrentRef(provisional);
            } catch (e) {}
        } catch (e) {
            // swallow
        }
    }

    previewBtn.onclick = async () => {
        await ensureServerReference();
        const clientRaw = clientNameInput.value || localStorage.getItem('invoice_client') || window.invoiceClientName || "................";
        const rawRef = getCurrentRef() || '';
        const ref = rawRef && rawRef.toString().trim() ? rawRef : "................";
        const rawDate = invoiceDateInput.value || localStorage.getItem('invoice_date') || window.invoiceDate || '';
        const dateInv = rawDate ? new Date(rawDate).toLocaleDateString('fr-FR') : "................";

        // persist preview values for Facture.html to read
        try {
            localStorage.setItem('invoice_reference', ref === '................' ? '' : ref);
            localStorage.setItem('invoice_client', clientRaw === '................' ? '' : clientRaw);
            if (rawDate) localStorage.setItem('invoice_date', rawDate);
        } catch (e) {}

        let rowsHtml = '';
        let total = 0;

        document.querySelectorAll('.item-row').forEach(row => {
            // Récupération désignation
            const descSelect = row.querySelector('.in-desc').value;
            const desc = descSelect === 'custom' ? row.querySelector('.in-desc-custom').value : descSelect;
            
            // Récupération validité
            const type = row.querySelector('.in-validity-type').value;
            const validity = type === 'year' ? row.querySelector('.in-val-year').value : formatLongDate(row.querySelector('.in-val-date').value);
            
            // Récupération montant
            const amount = parseFloat(row.querySelector('.in-amount').value) || 0;
            
            total += amount;
            rowsHtml += `
                <tr>
                    <td>${desc || "................"}</td>
                    <td class="text-center">${validity}</td>
                    <td class="text-center">${amount.toLocaleString('fr-FR')}</td>
                </tr>`;
        });

        previewModal.innerHTML = `
            <div class="no-print" style="width:210mm; margin: 10px auto; display:flex; gap:10px; justify-content: flex-end;">
                <button onclick="document.getElementById('previewModal').style.display='none'" style="padding:10px 20px; cursor:pointer; background:#6c757d; color:white; border:none; border-radius:4px;">← Retour</button>
                <button onclick="window.open('Facture.html?ref=${encodeURIComponent(ref)}&client=${encodeURIComponent(clientRaw)}&date=${encodeURIComponent(rawDate)}','_blank')" style="padding:10px 20px; cursor:pointer; background:#ff8c00; color:white; border:none; border-radius:4px; font-weight:bold;">⎙ Imprimer la facture</button>
            </div>
            <div class="page">
                <div class="logo-center">
                    <img src="carte de chargeur.jpeg" alt="Logo CCC">
                </div>
                <div class="header-left">
                    <div class="title">CONSEIL CONGOLAIS</div>
                    <div class="title">DES CHARGEURS</div>
                    <div class="dashed">--------------------</div>
                    <div>DIRECTION GENERALE</div>
                    <div class="dashed">--------------------</div>
                    <div>BP:741</div>
                    <div>NIU:M2006110000069140</div>
                    <div>TEL:(242) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 06852 2444</div>
                    <div class="tel-second">056591118</div>
                    <div class="location">Pointe-Noire</div>
                </div>
                <div class="invoice-info">
                    <div><strong>Facture N° :</strong> ${ref}</div>
                    <div><strong>Doit :</strong> ${clientRaw}</div>
                    <div><strong>Date :</strong> ${dateInv}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 50%;">Designation</th>
                            <th style="width: 25%;">Validité</th>
                            <th style="width: 25%;">Montant</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                        <tr>
                            <td colspan="2" class="text-right">Total (XAF)</td>
                            <td class="text-center" style="font-weight: bold;">${total.toLocaleString('fr-FR')}</td>
                        </tr>
                    </tbody>
                </table>
                <div class="footer">
                    <div>Encaissé par Maritime Kargo Consulting</div>
                    <div>Pour le compte du Conseil Congolais des Chargeurs</div>
                    <div class="bank-box">
                        MARITIME KARGO CONSULTING/LCB BANK N°:300120012526893701101/30
                    </div>
                    <div class="contact-line">
                        Des questions? Nous sommes là pour vous aider .Courriel : <strong>support@cccbesc.cg</strong> &nbsp;&nbsp; Tél: <strong>+242068770156</strong>
                    </div>
                </div>
            </div>
        `;
        previewModal.style.display = 'block';
    };

    // --- 4. SAVE (POST to backend) ---
    saveBtn.onclick = async () => {
        const client = clientNameInput.value || "";
        const ref = getCurrentRef() || "";
        const dateInv = invoiceDateInput.value || null;

        const itemsArr = [];
        document.querySelectorAll('.item-row').forEach(row => {
            const descSelect = row.querySelector('.in-desc').value;
            const desc = descSelect === 'custom' ? row.querySelector('.in-desc-custom').value : descSelect;
            const type = row.querySelector('.in-validity-type').value;
            const validity = type === 'year' ? row.querySelector('.in-val-year').value : row.querySelector('.in-val-date').value;
            const amount = parseFloat(row.querySelector('.in-amount').value) || 0;
            itemsArr.push({ description: desc, validity_type: type, validity_value: validity, amount });
        });

        const payload = { clientName: client, invoiceDate: dateInv, objetRef: ref, items: itemsArr };

        try {
            const token = localStorage.getItem('token') || localStorage.getItem('access_token');
            const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {});

            const API_BASE = "https://mkc-backend-kqov.onrender.com";
            const url = `${API_BASE.replace(/\/$/, '')}/api/client/carte`;

            const resp = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            // Be defensive: only attempt JSON parse when content-type is JSON and body present
            let body = null;
            try {
                const ct = resp.headers.get('content-type') || '';
                if (ct.includes('application/json')) {
                    body = await resp.json();
                } else {
                    const text = await resp.text();
                    body = text ? { message: text } : null;
                }
            } catch (parseErr) {
                body = null;
            }

            if (!resp.ok) {
                const msg = body && body.message ? body.message : resp.statusText || `HTTP ${resp.status}`;
                alert('Échec de l\'enregistrement: ' + msg);
                return;
            }

            // show generated reference and persist it for preview
            try {
                const serverRef = body && (body.reference || (body.carte && body.carte.reference)) ? (body.reference || (body.carte && body.carte.reference)) : null;
                if (serverRef) {
                    try { setCurrentRef(serverRef); } catch (e) {}
                    alert('Enregistré — Référence: ' + serverRef);
                } else {
                    alert('Enregistré');
                }
            } catch (e) {
                alert('Enregistré');
            }
        } catch (e) {
            console.error('Save failed', e);
            alert('Erreur réseau lors de l\'enregistrement');
        }
    };

    // Initialiser avec une ligne vide au chargement
    addRow();
});