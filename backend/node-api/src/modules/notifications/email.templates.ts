// modules/notifications/email.templates.ts

export interface EmailTemplateInput {
  prenom?: string;
  requestRef?: string;
  links?: Array<{ name: string; url: string }>;
  client_name?: string;
  client_email?: string;
  reason?: string;
  status?: string;
  date?: string;
  admin_dashboard_url?: string;
  requestType?: 'FERI' | 'AD' | 'FERI_AND_AD';
}

export interface EmailTemplateOutput {
  subject: string;
  title: string;
  text: string;
  html: string;
}

function escapeHtml(v?: string) {
  if (!v) return '';
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function greeting(lang: 'fr' | 'en', prenom?: string) {
  const hour = new Date().getHours();
  const isEvening = hour >= 18 || hour < 6;
  if (lang === 'en') {
    return `${isEvening ? 'Good evening' : 'Hello'}${prenom ? ' ' + escapeHtml(prenom) : ''}`;
  }
  return `${isEvening ? 'Bonsoir' : 'Bonjour'}${prenom ? ' ' + escapeHtml(prenom) : ''}`;
}

function renderLinks(links?: Array<{ name: string; url: string }>) {
  if (!links || !links.length) return '';
  return `
<ul>
  ${links
    .map(l => `<li><a href="${escapeHtml(l.url)}">${escapeHtml(l.name)}</a></li>`)
    .join('')}
</ul>
`;
}

function brandedLayout(title: string, body: string) {
  const logo = process.env.BRAND_LOGO_URL || 'https://feri-mkc.com/Logotype_mkc_bon-removebg-preview.png';
  const primary = process.env.BRAND_PRIMARY_COLOR || '#e67b33';
  const brandName = process.env.BRAND_NAME || 'Maritime Kargo Consulting';
  return `
<div style="font-family:Arial,Helvetica,sans-serif;color:#222">
  <div style="display:flex;align-items:center;gap:12px">
    ${logo ? `<img src="${escapeHtml(logo)}" alt="logo" style="height:48px" />` : ''}
    <h2 style="color:${primary};margin:0">${escapeHtml(title)}</h2>
  </div>
  <div style="margin-top:12px">${body}</div>
  <hr/>
  <p style="font-size:12px;color:#777">${escapeHtml(brandName)} – Ceci est un message automatique.</p>
</div>
`;
}

export const EmailTemplates: Record<string, (lang: 'fr' | 'en', input: EmailTemplateInput) => EmailTemplateOutput> = {
  REQUEST_STATUS_CHANGED: (lang, input) => {
    const title = lang === 'en' ? 'Request status updated' : 'Mise à jour du statut';
    const subject = title;
    const status = escapeHtml(input.status || '');
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, the status of your request ${ref} has been updated to ${status}.`
      : `${greeting('fr', input.prenom)}, le statut de votre demande ${ref} a été mis à jour : ${status}.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
${renderLinks(input.links)}
<p style="margin-top:8px;color:#666;font-size:13px">${lang === 'en' ? 'We will notify you of the next steps when available.' : "Nous vous informerons des prochaines étapes dès qu'elles seront disponibles."}</p>
`);
    return { subject, title, text, html };
  },

  REQUEST_CREATED: (lang, input) => {
    const title = lang === 'en' ? 'Request created' : 'Demande créée';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, your request ${ref} has been registered. Please upload the required documents to begin verification.`
      : `${greeting('fr', input.prenom)}, votre demande ${ref} a été enregistrée. Veuillez téléverser les documents requis pour lancer la vérification.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
`);
    return { subject, title, text, html };
  },

  REQUEST_SUBMITTED: (lang, input) => {
    const title = lang === 'en' ? 'Request submitted' : 'Demande soumise';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, your request ${ref} has been submitted to our operations team for document review. We will contact you only if additional information is required.`
      : `${greeting('fr', input.prenom)}, la demande ${ref} a été transmise à notre équipe opérationnelle pour vérification des documents. Nous vous contacterons uniquement si des informations supplémentaires sont requises.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
`);
    return { subject, title, text, html };
  },

  REQUEST_MESSAGE: (lang, input) => {
    const title = lang === 'en' ? 'New message regarding your request' : 'Nouveau message concernant votre demande';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, you have received a new message regarding your request ${ref}. Sign in to view and reply.`
      : `${greeting('fr', input.prenom)}, vous avez reçu un nouveau message concernant votre demande ${ref}. Connectez-vous pour consulter et répondre.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
${renderLinks(input.links)}
`);
    return { subject, title, text, html };
  },

  REQUEST_MESSAGE_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'New message (admin)' : 'Nouveau message (admin)';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, a new message was posted for request ${ref}.`
      : `${greeting('fr', input.prenom)}, un nouveau message a été publié pour la demande ${ref}.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
${renderLinks(input.links)}
`);
    return { subject, title, text, html };
  },

  REQUEST_DISPUTE: (lang, input) => {
    const title = lang === 'en' ? 'BL contested' : 'Contestation de BL';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const reason = input.reason ? escapeHtml(input.reason) : '';
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, a dispute has been raised for your request ${ref}.${reason ? ' Reason: ' + reason : ''} Our team will review and contact you if more information is needed.`
      : `${greeting('fr', input.prenom)}, une contestation a été signalée pour votre demande ${ref}.${reason ? ' Raison : ' + reason : ''} Notre équipe examinera et vous contactera si des informations supplémentaires sont nécessaires.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
${reason ? `<p><strong>${lang === 'en' ? 'Reason' : 'Raison'}:</strong> ${reason}</p>` : ''}
${renderLinks(input.links)}
`);
    return { subject, title, text, html };
  },

  REQUEST_DISPUTE_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'BL contested (admin)' : 'Contestation de BL (admin)';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const reason = input.reason ? escapeHtml(input.reason) : '';
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, a dispute was raised for request ${ref}.${reason ? ' Reason: ' + reason : ''}`
      : `${greeting('fr', input.prenom)}, une contestation a été signalée pour la demande ${ref}.${reason ? ' Raison : ' + reason : ''}`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
${reason ? `<p><strong>${lang === 'en' ? 'Reason' : 'Raison'}:</strong> ${reason}</p>` : ''}
${renderLinks(input.links)}
`);
    return { subject, title, text, html };
  },

  PAYMENT_PROOF_UPLOADED: (lang, input) => {
    const title = lang === 'en' ? 'Payment proof uploaded' : 'Preuve de paiement téléversée';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, a payment proof has been uploaded for request ${ref}. We will verify and update the status accordingly.`
      : `${greeting('fr', input.prenom)}, une preuve de paiement a été téléversée pour la demande ${ref}. Nous vérifierons et mettrons à jour le statut en conséquence.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
${renderLinks(input.links)}
`);
    return { subject, title, text, html };
  },

  DRAFT_SENT: (lang, input) => {
    const title = lang === 'en' ? 'Draft sent' : 'Draft envoyé';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const client = escapeHtml(input.client_name || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, the draft and proforma for request ${ref} ${client ? 'for ' + client : ''} have been issued.`
      : `${greeting('fr', input.prenom)}, le draft et la proforma pour la demande ${ref} ${client ? 'du client ' + client : ''} ont été générés.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
${renderLinks(input.links)}
<p style="margin-top:8px;color:#666;font-size:13px">${lang === 'en' ? 'Download links are temporary.' : 'Les liens de téléchargement sont temporaires.'}</p>
`);
    return { subject, title, text, html };
  },

  DRAFT_AVAILABLE: (lang, input) => {
    const title = lang === 'en' ? 'Draft available' : 'Draft et proforma disponibles';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, the draft and proforma invoice for request ${ref} are available for review.`
      : `${greeting('fr', input.prenom)}, le draft et la facture proforma pour la demande ${ref} sont disponibles pour consultation.`;
    // Build links HTML with explicit preview option and split into Proforma/Facture
    const linksArr = input.links ?? [];
    const proformaLinks = linksArr.filter(l => /proforma/i.test(l.name));
    const invoiceLinks = linksArr.filter(l => /facture|invoice/i.test(l.name));
    const otherLinks = linksArr.filter(l => !/proforma|facture|invoice/i.test(l.name));

    const renderLinkList = (arr: Array<{ name: string; url: string }>) =>
      arr.length
        ? `<ul>${arr
            .map(
              l =>
                `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(
                  l.name
                )}</a> — <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${lang === 'en' ? 'Preview' : 'Prévisualiser'}</a></li>`
            )
            .join('')}</ul>`
        : '';

    const proformaHtml = renderLinkList(proformaLinks);
    const invoiceHtml = renderLinkList(invoiceLinks);
    const otherHtml = renderLinkList(otherLinks);

    const html = brandedLayout(
      title,
      `
<p>${escapeHtml(text)}</p>
${invoiceLinks.length ? `<h3>${lang === 'en' ? 'Invoice' : 'Facture'}</h3>${invoiceHtml}` : ''}
${proformaLinks.length ? `<h3>${lang === 'en' ? 'Proforma' : 'Proforma'}</h3>${proformaHtml}` : ''}
${otherLinks.length ? `<h3>${lang === 'en' ? 'Files' : 'Fichiers'}</h3>${otherHtml}` : ''}
<p style="margin-top:8px;color:#666;font-size:13px">${lang === 'en' ? 'You can preview the files before downloading.' : "Vous pouvez prévisualiser les fichiers avant de les télécharger."}</p>
`
    );
    return { subject, title, text, html };
  },

  PAYMENT_CONFIRMED: (lang, input) => {
    const title = lang === 'en' ? 'Payment confirmed' : 'Paiement confirmé';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, we have received and recorded your payment for request ${ref}. We will generate the final document and notify you when ready.`
      : `${greeting('fr', input.prenom)}, nous avons reçu et enregistré votre paiement pour la demande ${ref}. Nous générerons le document final et vous informerons.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
${renderLinks(input.links)}
<p style="color:#666;font-size:12px">${lang === 'en' ? 'Reference' : 'Référence'} : <strong>${ref}</strong></p>
`);
    return { subject, title, text, html };
  },

  REQUEST_COMPLETED: (lang, input) => {
    const title = lang === 'en' ? 'Request completed' : 'Demande traitée';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, we have received and validated the documents for your request ${ref}. The file is complete and is now being processed.`
      : `${greeting('fr', input.prenom)}, nous confirmons la réception et la validation des documents relatifs à votre demande ${ref}. Le dossier est complet et est désormais en cours de traitement.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
`);
    return { subject, title, text, html };
  },

  REQUEST_REJECTED: (lang, input) => {
    const title = lang === 'en' ? 'Request rejected' : 'Demande rejetée';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, one or more submitted documents are incomplete or do not meet our requirements for request ${ref}. Please review and upload corrected documents.`
      : `${greeting('fr', input.prenom)}, un ou plusieurs documents fournis sont incomplets ou non conformes pour la demande ${ref}. Merci de téléverser les documents corrigés.`;
    const html = brandedLayout(title, `
<p>${escapeHtml(text)}</p>
<p style="margin-top:8px;color:#666;font-size:13px">${lang === 'en' ? 'Reference' : 'Référence'} : <strong>${ref}</strong></p>
`);
    return { subject, title, text, html };
  }
};
