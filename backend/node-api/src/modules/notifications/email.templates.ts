// modules/notifications/email.templates.ts

export interface EmailTemplateInput {
  prenom?: string;
  requestRef?: string;
  message?: string;
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

function brandedLayout(title: string, body: string, lang: 'fr' | 'en' = 'fr') {
  const logo = process.env.BRAND_LOGO_URL || 'https://feri-mkc.com/Logotype_mkc_bon-removebg-preview.png';
  const primary = process.env.BRAND_PRIMARY_COLOR || '#e67b33';
  const brandName = process.env.BRAND_NAME || 'Maritime Kargo Consulting';
  const frontendBase = (process.env.FRONTEND_URL || 'https://feri-mkc.com').replace(/\/$/, '');
  const faqUrl = process.env.FAQ_URL || `${frontendBase}/faq.html`;
  const automated = lang === 'en' ? 'This is an automated message.' : 'Ceci est un message automatique.';
  const needHelp = lang === 'en'
    ? `Need help? See our <a href="${escapeHtml(faqUrl)}">FAQ</a>.`
    : `Besoin d'aide ? Consultez notre <a href="${escapeHtml(faqUrl)}">FAQ</a>.`;
  return `
<div style="font-family:Arial,Helvetica,sans-serif;color:#222">
  <div style="display:flex;align-items:center;gap:12px">
    ${logo ? `<img src="${escapeHtml(logo)}" alt="logo" style="height:24px;max-height:24px;width:auto;object-fit:contain" />` : ''}
    <h2 style="color:${primary};margin:0">${escapeHtml(title)}</h2>
  </div>
  <div style="margin-top:12px">${body}</div>
  <hr/>
  <p style="font-size:12px;color:#777">${escapeHtml(brandName)} – ${escapeHtml(automated)}</p>
  <p style="font-size:12px;color:#777;margin-top:6px">${needHelp}</p>
</div>
`;
}

function statusLabel(status?: string, lang: 'fr' | 'en' = 'fr') {
  if (!status) return '';
  const map: Record<string, { fr: string; en: string }> = {
    PROCESSING: { fr: 'Traitement en cours', en: 'Processing' },
    PAYMENT_PROOF_UPLOADED: { fr: 'Preuve de paiement téléversée', en: 'Payment proof uploaded' },
    SEND_DRAFT: { fr: 'Draft envoyé', en: 'Draft sent' },
    DRAFT_SENT: { fr: 'Draft envoyé', en: 'Draft sent' },
    PAYMENT_CONFIRMED: { fr: 'Paiement confirmé', en: 'Payment confirmed' },
    COMPLETED: { fr: 'Demande traitée', en: 'Request completed' },
    AWAITING_PAYMENT: { fr: 'En attente de paiement', en: 'Awaiting payment' }
  };
  const found = map[status];
  if (!found) return status;
  return lang === 'fr' ? found.fr : found.en;
}

export const EmailTemplates: Record<string, (lang: 'fr' | 'en', input: EmailTemplateInput) => EmailTemplateOutput> = {
  REQUEST_STATUS_CHANGED: (lang, input) => {
    const title = lang === 'en' ? 'Request status updated' : 'Mise à jour du statut';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const name = escapeHtml(input.client_name || input.prenom || '');
      // Client-facing message: show translated status label when available
      const rawStatus = input.status || '';
      const frStatusLabel = rawStatus ? statusLabel(rawStatus, 'fr') : 'Traitement en cours';
      const enStatusLabel = rawStatus ? statusLabel(rawStatus, 'en') : 'Processing';

      const honorific = lang === 'en' ? 'Mr/Ms' : 'Mr/Mme';
      const frBody = `${greeting('fr')} ${honorific} ${name}, le statut de votre demande (${ref}) a été mis à jour : ${frStatusLabel}.`;
      const enBody = `${greeting('en')} ${honorific} ${name}, the status of your request (${ref}) has been updated: ${enStatusLabel}.`;

    const text = lang === 'en'
      ? `${enBody}\n\nWe will notify you of the next steps when available.\n\nMaritime Kargo Consulting – This is an automated message.`
      : `${frBody}\n\nNous vous informerons des prochaines étapes dès qu'elles seront disponibles.\n\nMaritime Kargo Consulting – Ceci est un message automatique.`;

    const html = brandedLayout(title, `
  <p>${escapeHtml(lang === 'en' ? enBody : frBody)}</p>
  ${renderLinks(input.links)}
  <p style="margin-top:8px;color:#666;font-size:13px">${escapeHtml(lang === 'en' ? 'We will notify you of the next steps when available.' : 'Nous vous informerons des prochaines étapes dès qu\'elles seront disponibles.')}</p>
  `, lang);

    return { subject, title, text, html };
  },

  REQUEST_STATUS_CHANGED_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'Request status updated (admin)' : 'Mise à jour du statut (admin)';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const status = escapeHtml(input.status || '');
    const client = escapeHtml(input.client_name || '');
    const clientEmail = escapeHtml(input.client_email || '');
    const adminLink = input.admin_dashboard_url ? `<p><a href="${escapeHtml(input.admin_dashboard_url)}">Open admin dashboard</a></p>` : '';

    const text = lang === 'en'
      ? `${greeting('en')}, status for request ${ref} changed to ${status}. Client: ${client}${clientEmail ? ' <' + clientEmail + '>' : ''}. Please review and take action in the admin dashboard.`
      : `${greeting('fr')}, le statut de la demande ${ref} a été mis à jour : ${status}. Client : ${client}${clientEmail ? ' <' + clientEmail + '>' : ''}. Veuillez vérifier et agir depuis le panneau d'administration.`;

    const html = brandedLayout(title, `<p>${escapeHtml(text)}</p>${adminLink}${renderLinks(input.links)}`, lang);
    return { subject, title, text, html };
  },

  REQUEST_CREATED: (lang, input) => {
    const title = lang === 'en' ? 'Request received' : 'Demande reçue';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, we have received your request ${ref}. Our team will review it and notify you of the next steps.\n\nMaritime Kargo Consulting – This is an automated message.`
      : `${greeting('fr', input.prenom)}, nous avons bien reçu votre demande ${ref}. Notre équipe va l'examiner et vous informera des prochaines étapes.\n\nMaritime Kargo Consulting – Ceci est un message automatique.`;
    const html = brandedLayout(title, `
  <p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>
  `, lang);
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
  `, lang);
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
  `, lang);
    return { subject, title, text, html };
  },

  REQUEST_MESSAGE_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'New message (admin)' : 'Nouveau message (admin)';
    const subject = `${title}${input.requestRef ? ` — ${input.requestRef}` : ''}`;
    const ref = input.requestRef || '';
    const message = input.message || '';
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, a new message was posted for request ${ref}:\n\n${message}\n\nReview and reply on the admin dashboard.`
      : `${greeting('fr', input.prenom)}, un nouveau message a été publié pour la demande ${ref} :\n\n${message}\n\nConsultez-le et répondez depuis le tableau de bord admin.`;
    const adminLink = input.admin_dashboard_url ? `<p><a href="${escapeHtml(input.admin_dashboard_url)}">Open admin dashboard</a></p>` : '';
    const html = brandedLayout(title, `
  <p>${escapeHtml(lang === 'en'
    ? `${greeting('en', input.prenom)}, a new message was posted for request ${ref}.`
    : `${greeting('fr', input.prenom)}, un nouveau message a été publié pour la demande ${ref}.`)}</p>
  <blockquote style="margin:16px 0;padding:12px 16px;border-left:4px solid #e67b33;background:#f5f8fc;white-space:pre-wrap">${escapeHtml(message)}</blockquote>
  <p>${escapeHtml(lang === 'en' ? 'Review and reply on the admin dashboard.' : 'Consultez-le et répondez depuis le tableau de bord admin.')}</p>
  ${renderLinks(input.links)}
  ${adminLink}
  `, lang);
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
  `, lang);
    return { subject, title, text, html };
  },

  REQUEST_DISPUTE_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'BL contested (admin)' : 'Contestation de BL (admin)';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const reason = input.reason ? escapeHtml(input.reason) : '';
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, a dispute was raised for request ${ref}.${reason ? ' Reason: ' + reason : ''} Please investigate and respond via the admin panel.`
      : `${greeting('fr', input.prenom)}, une contestation a été signalée pour la demande ${ref}.${reason ? ' Raison : ' + reason : ''} Merci d'examiner et de répondre via le panneau d'administration.`;
    const adminLink = input.admin_dashboard_url ? `<p><a href="${escapeHtml(input.admin_dashboard_url)}">Open admin dashboard</a></p>` : '';
    const html = brandedLayout(title, `
  <p>${escapeHtml(text)}</p>
  ${reason ? `<p><strong>${lang === 'en' ? 'Reason' : 'Raison'}:</strong> ${reason}</p>` : ''}
  ${renderLinks(input.links)}
  ${adminLink}
  `, lang);
    return { subject, title, text, html };
  },

  /* Admin-oriented variants for common events: provide action links and admin-focused wording */
  REQUEST_CREATED_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'New request received' : 'Nouvelle demande reçue';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, a new request ${ref} was created. Review it in the admin dashboard and assign an operator.`
      : `${greeting('fr', input.prenom)}, une nouvelle demande ${ref} a été créée. Consultez-la dans le tableau de bord admin et assignez un opérateur.`;
    const adminLink = input.admin_dashboard_url ? `<p><a href="${escapeHtml(input.admin_dashboard_url)}">Open admin dashboard</a></p>` : '';
    const html = brandedLayout(title, `<p>${escapeHtml(text)}</p>${adminLink}`, lang);
    return { subject, title, text, html };
  },

  REQUEST_SUBMITTED_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'Documents submitted' : 'Documents soumis (admin)';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, documents have been submitted for request ${ref}. Please review and validate or request corrections.`
      : `${greeting('fr', input.prenom)}, des documents ont été soumis pour la demande ${ref}. Veuillez vérifier et valider ou demander des corrections.`;
    const adminLink = input.admin_dashboard_url ? `<p><a href="${escapeHtml(input.admin_dashboard_url)}">Open admin dashboard</a></p>` : '';
    const html = brandedLayout(title, `<p>${escapeHtml(text)}</p>${adminLink}${renderLinks(input.links)}`, lang);
    return { subject, title, text, html };
  },

  PAYMENT_PROOF_UPLOADED_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'Payment proof uploaded (admin)' : 'Preuve paiement téléversée (admin)';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, a payment proof was uploaded for ${ref}. Please verify payment and update status.`
      : `${greeting('fr', input.prenom)}, une preuve de paiement a été téléversée pour ${ref}. Vérifiez le paiement et mettez à jour le statut.`;
    const adminLink = input.admin_dashboard_url ? `<p><a href="${escapeHtml(input.admin_dashboard_url)}">Open admin dashboard</a></p>` : '';
    const html = brandedLayout(title, `<p>${escapeHtml(text)}</p>${adminLink}${renderLinks(input.links)}`, lang);
    return { subject, title, text, html };
  },

  PAYMENT_CONFIRMED_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'Payment confirmed (admin)' : 'Paiement confirmé (admin)';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, payment for ${ref} is confirmed. Proceed to generate final documents.`
      : `${greeting('fr', input.prenom)}, le paiement pour ${ref} est confirmé. Procédez à la génération des documents finaux.`;
    const adminLink = input.admin_dashboard_url ? `<p><a href="${escapeHtml(input.admin_dashboard_url)}">Open admin dashboard</a></p>` : '';
    const html = brandedLayout(title, `<p>${escapeHtml(text)}</p>${adminLink}`, lang);
    return { subject, title, text, html };
  },

  DRAFT_AVAILABLE_ADMIN: (lang, input) => {
    const ref = escapeHtml(input.requestRef || '');
    // Prefer explicit client name; if only "Admin" is present (injected for admin recipient),
    // try to fall back to client_name or client_email. If none available show a placeholder.
    let clientRaw = input.client_name || input.prenom || '';
    if (typeof clientRaw === 'string' && clientRaw.toLowerCase().includes('admin')) {
      clientRaw = input.client_name || input.client_email || '';
    }
    const client = escapeHtml(clientRaw || '—');

    const title = lang === 'en' ? `Draft and proforma invoice delivered – Request ${ref}` : `Draft et facture proforma délivrés – Demande ${ref}`;
    const subject = title;

    if (lang === 'en') {
      const text = `${greeting('en')},\n\nPlease be informed that the draft and proforma invoice related to request ${ref} have been delivered to the client.\n\nClient: ${client}\n\nNo immediate action is required. The request remains available in the administrative dashboard for review or further follow-up if necessary.\n\nKind regards,\nNotification System`;
      const html = brandedLayout(title, `
    <p>${escapeHtml(greeting('en'))},</p>
    <p>Please be informed that the draft and proforma invoice related to request <strong>${escapeHtml(ref)}</strong> have been delivered to the client.</p>
    <p><strong>Client:</strong> ${escapeHtml(client)}</p>
    <p>No immediate action is required. The request remains available in the administrative dashboard for review or further follow-up if necessary.</p>
    <p>Kind regards,<br/>Notification System</p>
    `, lang);
      return { subject, title, text, html };
    }

    // FR
    const text = `${greeting('fr')},\n\nNous vous informons que le draft et la facture proforma relatifs à la demande ${ref} ont été délivrés au client.\n\nClient : ${client}\n\nAucune action immédiate n’est requise. Le dossier reste accessible via le tableau de bord administratif pour consultation ou suivi ultérieur.\n\nCordialement,\nSystème de notification`;
    const html = brandedLayout(title, `
  <p>${escapeHtml(greeting('fr'))},</p>
  <p>Nous vous informons que le draft et la facture proforma relatifs à la demande <strong>${escapeHtml(ref)}</strong> ont été délivrés au client.</p>
  <p><strong>Client :</strong> ${escapeHtml(client)}</p>
  <p>Aucune action immédiate n’est requise. Le dossier reste accessible via le tableau de bord administratif pour consultation ou suivi ultérieur.</p>
  <p>Cordialement,<br/>Système de notification</p>
  `, lang);

    return { subject, title, text, html };
  },

  REQUEST_COMPLETED_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'Request completed (admin)' : 'Demande clôturée (admin)';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, request ${ref} is completed. Final documents were generated.`
      : `${greeting('fr', input.prenom)}, la demande ${ref} est clôturée. Les documents finaux ont été générés.`;
    const adminLink = input.admin_dashboard_url ? `<p><a href="${escapeHtml(input.admin_dashboard_url)}">Open admin dashboard</a></p>` : '';
    const html = brandedLayout(title, `<p>${escapeHtml(text)}</p>${adminLink}`, lang);
    return { subject, title, text, html };
  },

  REQUEST_REJECTED_ADMIN: (lang, input) => {
    const title = lang === 'en' ? 'Request rejected (admin)' : 'Demande rejetée (admin)';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)}, request ${ref} was rejected. Please follow up with the client for corrections.`
      : `${greeting('fr', input.prenom)}, la demande ${ref} a été rejetée. Merci de contacter le client pour corrections.`;
    const adminLink = input.admin_dashboard_url ? `<p><a href="${escapeHtml(input.admin_dashboard_url)}">Open admin dashboard</a></p>` : '';
    const html = brandedLayout(title, `<p>${escapeHtml(text)}</p>${adminLink}`, lang);
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
  `, lang);
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
    const name = escapeHtml(input.prenom || '');

    const text = lang === 'en'
      ? `${greeting('en', name)}, the draft and proforma invoice for request ${ref} are available for review.`
      : `${greeting('fr', name)}, le draft et la facture proforma pour la demande ${ref} sont disponibles pour consultation.`;

    // Split links into invoice/proforma/other and render invoice links with a PDF icon
    const linksArr = input.links ?? [];
    const proformaLinks = linksArr.filter(l => /proforma/i.test(l.name));
    const invoiceLinks = linksArr.filter(l => /facture|invoice/i.test(l.name));
    const otherLinks = linksArr.filter(l => !/proforma|facture|invoice/i.test(l.name));

    const renderLinkList = (arr: Array<{ name: string; url: string }>, isInvoice = false) =>
      arr.length
        ? `<ul>${arr
            .map(l => `
              <li>${isInvoice ? '📄 ' : ''}<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.name)}</a> — <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${lang === 'en' ? 'Preview' : 'Prévisualiser'}</a></li>`
            )
            .join('')}</ul>`
        : '';

    const invoiceHtml = renderLinkList(invoiceLinks, true);
    const proformaHtml = renderLinkList(proformaLinks, false);
    const otherHtml = renderLinkList(otherLinks, false);

    const html = brandedLayout(
      title,
      `
<p>${escapeHtml(text)}</p>
${invoiceLinks.length ? `<h3>${lang === 'en' ? 'Invoice' : 'Facture'}</h3>${invoiceHtml}` : ''}
${proformaLinks.length ? `<h3>${lang === 'en' ? 'Proforma' : 'Proforma'}</h3>${proformaHtml}` : ''}
${otherLinks.length ? `<h3>${lang === 'en' ? 'Files' : 'Fichiers'}</h3>${otherHtml}` : ''}
<p style="margin-top:8px;color:#666;font-size:13px">${lang === 'en' ? 'You can preview the files before downloading.' : "Vous pouvez prévisualiser les fichiers avant de les télécharger."}</p>
`, lang
    );
    return { subject, title, text, html };
  },

  DRAFT_AVAILABLE_FERI: (lang, input) => {
    const title = lang === 'en' ? 'FERI draft available' : 'Draft FERI disponible';
    const subject = title;
    const name = escapeHtml(input.prenom || '');

    const frText = `${greeting('fr', input.prenom)},\n\nVotre draft FERI est disponible. Connectez‑vous à votre espace pour le consulter et procéder au paiement.\n\nCordialement,\nMaritime Kargo Consulting\nCeci est un message automatique.`;
    const enText = `${greeting('en', input.prenom)},\n\nYour FERI draft is available. Please log in to your client area to view it and proceed with payment.\n\nKind regards,\nMaritime Kargo Consulting\nThis is an automated message.`;

    const text = lang === 'en' ? enText : frText;
    const html = brandedLayout(title, `
  <p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>
  ${renderLinks(input.links)}
  `, lang);

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
  `, lang);
    return { subject, title, text, html };
  },

  REQUEST_COMPLETED: (lang, input) => {
    const title = lang === 'en' ? 'Request completed' : 'Demande traitée';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const text = lang === 'en'
      ? `${greeting('en', input.prenom)},\n\nWe would like to inform you that your request has been fully processed.\n\nThe documents have been validated, and the final document is now available.\n\nYou can view and download it via your client area.\n\nKind regards,\nMaritime Kargo Consulting\n\nThis is an automated message.\n\nNeed help? Check out our FAQ.`
      : `${greeting('fr', input.prenom)},\n\nNous vous informons que votre demande a été entièrement traitée.\n\nLes documents ont été validés et le document final est désormais disponible.\n\nVous pouvez le consulter et le télécharger via votre espace client.\n\nCordialement,\nMaritime Kargo Consulting\nCeci est un message automatique.`;

    const html = brandedLayout(title, `
  <p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>
  ${renderLinks(input.links)}
  `, lang);
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
  `, lang);
    return { subject, title, text, html };
  },

  PROFORMA_AVAILABLE: (lang, input) => {
    const title = lang === 'en' ? 'Proforma available' : 'Proforma disponible';
    const subject = title;
    const ref = escapeHtml(input.requestRef || '');
    const name = escapeHtml(input.prenom || '');

    const text = lang === 'en'
      ? `${greeting('en', name)}, the proforma invoice for request ${ref} is available for download.`
      : `${greeting('fr', name)}, la facture proforma pour la demande ${ref} est disponible en téléchargement.`;

    const linksHtml = renderLinks(input.links);

    const html = brandedLayout(title, `
  <p>${escapeHtml(text)}</p>
  ${linksHtml}
  <p style="margin-top:8px;color:#666;font-size:13px">${lang === 'en' ? 'You can preview the proforma before downloading.' : 'Vous pouvez prévisualiser la proforma avant de la télécharger.'}</p>
  `, lang);

    return { subject, title, text, html };
  },

  PROFORMA_AVAILABLE_ADMIN: (lang, input) => {
    const ref = escapeHtml(input.requestRef || '');
    const title = lang === 'en' ? `Proforma delivered – Request ${ref}` : `Proforma délivrée – Demande ${ref}`;
    const subject = title;
    const client = escapeHtml(input.client_name || input.prenom || '—');
    const text = lang === 'en'
      ? `${greeting('en')},\n\nThe proforma invoice for request ${ref} has been delivered to the client.\n\nClient: ${client}\n\nNo immediate action is required.`
      : `${greeting('fr')},\n\nLa facture proforma pour la demande ${ref} a été délivrée au client.\n\nClient : ${client}\n\nAucune action immédiate n'est requise.`;

    const html = brandedLayout(title, `
  <p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>
  ${renderLinks(input.links)}
  `, lang);
    return { subject, title, text, html };
  },
};

// Alias client-oriented event keys (emitted by RequestsService) to existing templates
// so that the notifications system can resolve both FR and EN template outputs.
(EmailTemplates as any).CLIENT_PAYMENT_CONFIRMED = (EmailTemplates as any).PAYMENT_CONFIRMED;
(EmailTemplates as any).CLIENT_DRAFT_AVAILABLE = (EmailTemplates as any).DRAFT_AVAILABLE;
(EmailTemplates as any).CLIENT_FERI_ISSUED = (EmailTemplates as any).REQUEST_COMPLETED;
