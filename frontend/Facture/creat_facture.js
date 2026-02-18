document.addEventListener('DOMContentLoaded', () => {
    // --- SÉLECTEURS ---
    const clientNameInput = document.getElementById('clientName');
    const objetRefInput = document.getElementById('objetRef');
    const invoiceDateInput = document.getElementById('invoiceDate');
    const tableBody = document.getElementById('tableBody');
    const previewModal = document.getElementById('previewModal');
    const addBtn = document.getElementById('addBtn');
    const previewBtn = document.getElementById('previewBtn');

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

    // --- 3. PREVIEW & IMPRESSION ---
    previewBtn.onclick = () => {
        const client = clientNameInput.value || "................";
        const ref = objetRefInput.value || "................";
        const dateInv = invoiceDateInput.value ? new Date(invoiceDateInput.value).toLocaleDateString('fr-FR') : "................";

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
                <button onclick="window.print()" style="padding:10px 20px; cursor:pointer; background:#ff8c00; color:white; border:none; border-radius:4px; font-weight:bold;">⎙ Imprimer la facture</button>
            </div>
            <div class="page">
                <div class="logo-center">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/World_map_blank_without_borders.svg/512px-World_map_blank_without_borders.svg.png" alt="Logo CCC">
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
                    <div><strong>Doit :</strong> ${client}</div>
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

    // Initialiser avec une ligne vide au chargement
    addRow();
});