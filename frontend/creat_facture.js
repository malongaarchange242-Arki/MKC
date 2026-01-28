document.addEventListener('DOMContentLoaded', () => {
    const objetRefInput = document.getElementById('objetRef');
    const tableBody = document.getElementById('tableBody');
    const previewModal = document.getElementById('previewModal');

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
    };

    tableBody.onclick = (e) => {
        if (e.target.classList.contains('btn-del')) {
            if (document.querySelectorAll('.item-row').length > 1) {
                e.target.closest('tr').remove();
            }
        }
    };

    // 3. Logique de génération de la facture (Preview)
    document.getElementById('previewBtn').onclick = () => {
        const client = document.getElementById('clientName').value || "................................";
        const origine = document.getElementById('origine').value || "................";
        const refBL = document.getElementById('objetRef').value || "................";

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

        // Ajout de la ligne Frais de Service au tableau
        rowsHtml += `
            <tr style="font-style: italic;">
                <td>${document.querySelectorAll('.item-row').length + 1}</td>
                <td style="text-align:left; padding-left:10px;">Frais de Service (1.8%)</td>
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
                <div class="ref-line">REF: PRO-007/MKC-OGF/26</div>
                <div class="invoice-title">FACTURE PROFOMA</div>

                <div class="client-meta">
                    <p>Client: ${client}</p>
                    <p>Objet: Souscription FERI BL: ${refBL}</p>
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

        previewModal.style.display = 'block';

        // Ré-attachement des événements des boutons du modal car ils ont été ré-injectés
        document.getElementById('backBtn').onclick = () => previewModal.style.display = 'none';
        document.getElementById('printBtn').onclick = () => window.print();
        document.getElementById('sendBtn').onclick = () => {
            const subject = encodeURIComponent(`Facture Proforma - ${client}`);
            window.location.href = `mailto:?subject=${subject}&body=Veuillez trouver ci-joint votre facture concernant le BL ${refBL}.`;
        };
    };

    // Fermer le modal en cliquant à l'extérieur de la page A4
    window.onclick = (event) => {
        if (event.target == previewModal) {
            previewModal.style.display = "none";
        }
    };
});