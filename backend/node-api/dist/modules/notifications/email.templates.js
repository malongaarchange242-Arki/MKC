"use strict";
// modules/notifications/email.templates.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailTemplates = void 0;
/**
 * Escape HTML to prevent injection (even in emails)
 */
function escapeHtml(v) {
    if (!v)
        return '';
    return v
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
/**
 * Localized greeting
 */
function greeting(lang, prenom) {
    return lang === 'en'
        ? `Hi${prenom ? ' ' + escapeHtml(prenom) : ''}`
        : `Bonjour${prenom ? ' ' + escapeHtml(prenom) : ''}`;
}
/**
 * Branded email layout
 */
function brandedLayout(title, body) {
    const logo = process.env.BRAND_LOGO_URL || 'https://example.com/assets/logo.png';
    const primary = process.env.BRAND_PRIMARY_COLOR || '#0b5cff';
    return `
<div style="font-family:Arial,Helvetica,sans-serif;color:#222">
  <div style="display:flex;align-items:center;gap:12px">
    <img src="${logo}" alt="logo" style="height:48px" />
    <h2 style="color:${primary};margin:0">${escapeHtml(title)}</h2>
  </div>

  <div style="margin-top:12px">
    ${body}
  </div>

  <hr/>

  <p style="font-size:12px;color:#777">
    Plateforme FERI / AD – Ceci est un message automatique.
  </p>
</div>
`;
}
/**
 * Shared helper to render secure links
 */
function renderLinks(links) {
    if (!links || !links.length)
        return '';
    return `
<ul>
  ${links
        .map(l => `<li><a href="${escapeHtml(l.url)}">${escapeHtml(l.name)}</a></li>`)
        .join('')}
</ul>
`;
}
exports.EmailTemplates = {
    REQUEST_CREATED: (lang, input) => brandedLayout(lang === 'en' ? 'Request created' : 'Demande créée', `
<p>${greeting(lang, input.prenom)},</p>
<p>
  ${lang === 'en'
        ? 'Your request has been created.'
        : 'Votre demande a été créée.'}
</p>
`),
    REQUEST_SUBMITTED: (lang, input) => brandedLayout(lang === 'en' ? 'Request submitted' : 'Demande soumise', `
<p>${greeting(lang, input.prenom)},</p>
<p>
  ${lang === 'en'
        ? `Your request <strong>${escapeHtml(input.requestRef)}</strong> has been submitted.`
        : `Votre demande <strong>${escapeHtml(input.requestRef)}</strong> a été soumise avec succès.`}
</p>
`),
    DRAFT_AVAILABLE: (lang, input) => brandedLayout(lang === 'en' ? 'Draft available' : 'Draft et proforma disponibles', `
<p>${greeting(lang, input.prenom)},</p>
<p>
  ${lang === 'en'
        ? 'Draft and proforma documents are available on your dashboard.'
        : 'Les documents draft et proforma sont disponibles sur votre espace.'}
</p>
`),
    REQUEST_COMPLETED: (lang, input) => brandedLayout(lang === 'en'
        ? 'Your official documents are available'
        : 'Documents officiels disponibles', `
<p>${greeting(lang, input.prenom)},</p>
<p>
  ${lang === 'en'
        ? 'Your FERI / AD has been validated. You can download your documents below.'
        : 'Vos documents officiels sont maintenant disponibles.'}
</p>

${renderLinks(input.links)}

<p style="color:#666;font-size:12px">
  ${lang === 'en' ? 'Reference' : 'Référence'} :
  <strong>${escapeHtml(input.requestRef)}</strong>
</p>
`),
    REQUEST_STATUS_CHANGED: (lang, input) => brandedLayout(lang === 'en' ? 'Request status update' : 'Mise à jour de la demande', `
<p>${greeting(lang, input.prenom)},</p>
${lang === 'en'
        ? `
<p>Dear Customer,</p>

<p>We have successfully received and validated the documents for your request<br/>
<strong>Reference ID:</strong> <strong>${escapeHtml(input.requestRef)}</strong>.</p>

<p>Your request is now <strong>PROCESSING</strong>.</p>

<p>Our team is currently reviewing your information and processing your FERI application. No further action is required from you at this stage.</p>

<p>You will be notified as soon as the next step is completed.</p>

<p>Thank you for trusting <strong>Maritime Kargo Consulting</strong>.</p>

<p>Kind regards,<br/><strong>Maritime Kargo Consulting Team</strong></p>
    `
        : (
        // If template is rendered for admin (we pass prenom='Admin'), show admin-specific french template
        input.prenom === 'Admin'
            ? `
<p>Bonjour Admin,</p>

<p>Une demande client vient de changer de statut et nécessite votre attention.</p>

<pre style="border-top:1px solid #ddd;border-bottom:1px solid #ddd;padding:8px 0">────────────────────────────
 Détails de la demande
────────────────────────────</pre>
<p style="margin:0">• Client : ${escapeHtml(input.client_name || '—')}</p>
<p style="margin:0">• Email client : ${escapeHtml(input.client_email || '—')}</p>
<p style="margin:0">• Référence : ${escapeHtml(input.requestRef || input.entityId || '—')}</p>
<p style="margin:0">• Nouveau statut : ${escapeHtml(input.status || '—')}</p>
<p style="margin:0">• Date : ${escapeHtml(input.date || new Date().toISOString())}</p>

<pre style="border-top:1px solid #eee;border-bottom:1px solid #eee;padding:8px 0">────────────────────────────
 Action requise
────────────────────────────</pre>
<p>Veuillez vous connecter à l’interface d’administration afin de :<br/>
→ examiner le dossier<br/>
→ vérifier les documents<br/>
→ poursuivre le traitement selon la procédure.</p>

<p> Accès admin :<br/>${escapeHtml(input.admin_dashboard_url || process.env.ADMIN_DASHBOARD_URL || '—')}</p>

<p>Ceci est une notification automatique du système FERI AD Platform.<br/>Merci de ne pas répondre à cet email.</p>

<p>—<br/>Équipe Maritime Kargo Consulting</p>
        `
            : `
<p>Bonjour${input.prenom ? ' ' + escapeHtml(input.prenom) : ''},</p>
<p>Nous avons bien reçu et validé les documents pour votre demande<br/>
<strong>Référence :</strong> <strong>${escapeHtml(input.requestRef)}</strong>.</p>
<p>Votre demande est maintenant en <strong>TRAITEMENT</strong>.</p>
<p>Notre équipe examine actuellement votre dossier. Aucune action n'est requise de votre part pour le moment.</p>
<p>Nous vous informerons dès la prochaine étape réalisée.</p>
<p>Merci de votre confiance,<br/><strong>Équipe Maritime Kargo Consulting</strong></p>
        `)}
`),
    REQUEST_REJECTED: (lang, input) => brandedLayout(lang === 'en' ? 'Request rejected' : 'Demande rejetée', `
<p>${greeting(lang, input.prenom)},</p>
<p>
  ${lang === 'en'
        ? 'Your request requires correction. Please log in to the platform.'
        : 'Votre demande nécessite une correction. Merci de vous reconnecter à la plateforme.'}
</p>
`)
};
//# sourceMappingURL=email.templates.js.map