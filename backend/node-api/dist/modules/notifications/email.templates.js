"use strict";
// modules/notifications/email.templates.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailTemplates = void 0;
function brandedLayout(title, body) {
    const logo = process.env.BRAND_LOGO_URL || 'https://example.com/assets/logo.png';
    const primary = process.env.BRAND_PRIMARY_COLOR || '#0b5cff';
    return ('<div style="font-family: Arial, Helvetica, sans-serif; color:#222">' +
        '<div style="display:flex;align-items:center;gap:12px">' +
        '<img src="' + logo + '" alt="logo" style="height:48px" />' +
        '<h2 style="color:' + primary + ';margin:0">' + title + '</h2>' +
        '</div>' +
        '<div style="margin-top:12px">' + body + '</div>' +
        '<hr/>' +
        '<p style="font-size:12px;color:#777">Plateforme FERI / AD – Ceci est un message automatique.</p>' +
        '</div>');
}
exports.EmailTemplates = {
    REQUEST_CREATED: (lang, input) => brandedLayout(lang === 'en' ? 'Request created' : 'Demande créée', (lang === 'en' ? 'Hi ' : 'Bonjour ') + (input.prenom || '') +
        '<p>' + (lang === 'en' ? 'Your request has been created.' : 'Votre demande a été créée.') + '</p>'),
    REQUEST_SUBMITTED: (lang, input) => brandedLayout(lang === 'en' ? 'Request submitted' : 'Demande soumise', (lang === 'en' ? 'Hi ' : 'Bonjour ') + (input.prenom || '') +
        '<p>' + (lang === 'en' ? 'Your request ' + (input.requestRef || '') + ' has been submitted.' : 'Votre demande <strong>' + (input.requestRef || '') + '</strong> a été soumise avec succès.') + '</p>'),
    DRAFT_AVAILABLE: (lang, input) => brandedLayout(lang === 'en' ? 'Draft available' : 'Draft et proforma disponibles', (lang === 'en' ? 'Hi ' : 'Bonjour ') + (input.prenom || '') +
        '<p>' + (lang === 'en' ? 'Draft and proforma documents are available.' : 'Les documents draft et proforma sont disponibles sur votre espace.') + '</p>'),
    REQUEST_COMPLETED: (lang, input) => brandedLayout(lang === 'en' ? 'Your official documents are available' : 'Documents officiels disponibles', (lang === 'en' ? 'Hi ' : 'Bonjour ') + (input.prenom || '') +
        '<p>' + (lang === 'en' ? 'Your FERI / AD has been validated. You can download your documents below.' : 'Vos documents officiels sont maintenant disponibles.') + '</p>' +
        ((input.links && input.links.length) ? ('<ul>' + input.links.map(l => '<li><a href="' + l.url + '">' + l.name + '</a></li>').join('') + '</ul>') : '') +
        '<p style="color:#666;font-size:12px">' + (lang === 'en' ? 'Reference' : 'Référence') + ': ' + (input.requestRef || '') + '</p>'),
    REQUEST_REJECTED: (lang, input) => brandedLayout(lang === 'en' ? 'Request rejected' : 'Demande rejetée', (lang === 'en' ? 'Hi ' : 'Bonjour ') + (input.prenom || '') +
        '<p>' + (lang === 'en' ? 'Your request requires correction.' : 'Votre demande nécessite une correction. Merci de vous reconnecter à la plateforme.') + '</p>')
};
//# sourceMappingURL=email.templates.js.map