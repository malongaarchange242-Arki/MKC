"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const supabase_1 = require("../../config/supabase");
const logger_1 = require("../../utils/logger");
const nodemailer_1 = __importDefault(require("nodemailer"));
/* ===============================
   SMTP SINGLETON
================================ */
const smtpTransporter = process.env.SMTP_HOST
    ? nodemailer_1.default.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
            ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
            : undefined,
        tls: process.env.SMTP_ALLOW_INSECURE === 'true'
            ? { rejectUnauthorized: false }
            : undefined
    })
    : null;
/* ===============================
   SERVICE
================================ */
class NotificationsService {
    static async send(payload) {
        try {
            /* -------------------- Validation -------------------- */
            if (!payload.title || !payload.message) {
                throw new Error('Notification title and message are required');
            }
            const channels = payload.channels ?? ['in_app'];
            logger_1.logger.info('Sending notification', {
                type: payload.type,
                userId: payload.userId,
                channels
            });
            /* -------------------- IN-APP -------------------- */
            if (channels.includes('in_app')) {
                try {
                    await supabase_1.supabase.from('notifications').insert({
                        user_id: payload.userId,
                        type: payload.type,
                        title: payload.title,
                        message: payload.message,
                        entity_type: payload.entityType ?? null,
                        entity_id: payload.entityId ?? null,
                        data: {
                            links: payload.links ?? [],
                            channels,
                            metadata: payload.metadata ?? null
                        },
                        is_read: false,
                        created_at: new Date().toISOString()
                    });
                }
                catch (e) {
                    logger_1.logger.warn('Failed to persist in-app notification', { e });
                }
            }
            /* -------------------- EMAIL -------------------- */
            if (channels.includes('email')) {
                if (!smtpTransporter) {
                    logger_1.logger.info('SMTP not configured, skipping email', {
                        envSMTP: !!process.env.SMTP_HOST,
                        envSMTPHost: process.env.SMTP_HOST ? 'present' : 'missing'
                    });
                    return { success: true };
                }
                /* Helper: build attachments and template HTML */
                const attachments = (payload.attachments ?? []).map(a => ({
                    filename: a.name,
                    content: Buffer.from(a.base64, 'base64'),
                    contentType: a.mime
                }));
                const linksHtml = (payload.links ?? [])
                    .map(l => `<li><a href="${l.url}">${l.name}</a>${l.expires_in
                    ? ` (expire dans ${l.expires_in}s)`
                    : ''}</li>`)
                    .join('');
                const getHtmlFor = async (prenom) => {
                    let html = `
						<p>Bonjour ${prenom ?? ''},</p>
						<p>${payload.message}</p>
						${linksHtml ? `<ul>${linksHtml}</ul>` : ''}
					`;
                    try {
                        const { EmailTemplates } = await Promise.resolve().then(() => __importStar(require('./email.templates')));
                        const tpl = EmailTemplates[payload.type];
                        if (tpl) {
                            const tplInput = {
                                prenom,
                                entityId: payload.entityId,
                                links: payload.links ?? [],
                                client_name: payload.client_name,
                                client_email: payload.client_email,
                                status: payload.status,
                                date: payload.date,
                                admin_dashboard_url: payload.admin_dashboard_url
                            };
                            html = tpl(payload.language ?? 'fr', tplInput);
                        }
                    }
                    catch (e) {
                        logger_1.logger.warn('Email template error, fallback HTML used', { e });
                    }
                    return html;
                };
                /* Resolve client email (non-blocking for admin send) */
                let userEmail;
                let prenom;
                if (payload.overrideEmail) {
                    userEmail = payload.overrideEmail;
                    prenom = 'Administrateur';
                }
                else {
                    try {
                        const { data, error } = await supabase_1.supabase
                            .from('profiles')
                            .select('email, prenom')
                            .eq('id', payload.userId)
                            .single();
                        if (error) {
                            logger_1.logger.warn('Failed to load profile', { error, userId: payload.userId });
                        }
                        userEmail = data?.email;
                        prenom = data?.prenom;
                    }
                    catch (e) {
                        logger_1.logger.warn('Supabase profile fetch error', { e, userId: payload.userId });
                        // Do not throw or return: admin email must still be sent
                    }
                }
                logger_1.logger.info('Resolved email for notification', { userId: payload.userId, resolvedEmail: !!userEmail, email: userEmail ? (userEmail.length > 60 ? userEmail.slice(0, 40) + '...' : userEmail) : null, overrideEmail: !!payload.overrideEmail });
                /* Prepare send tasks */
                const tasks = [];
                /* Client email task (if available)
                   Do not block admin send if client resolution fails */
                if (userEmail) {
                    tasks.push((async () => {
                        try {
                            const html = await getHtmlFor(prenom);
                            logger_1.logger.info('Sending client email', { to: userEmail, type: payload.type });
                            await smtpTransporter.sendMail({
                                from: process.env.EMAIL_FROM || 'no-reply@example.com',
                                to: userEmail,
                                subject: payload.title,
                                text: payload.message,
                                html,
                                attachments
                            });
                            logger_1.logger.info('Client email sent', { to: userEmail, type: payload.type });
                        }
                        catch (sendErr) {
                            logger_1.logger.error('SMTP sendMail failed (client)', { error: sendErr, to: userEmail });
                        }
                    })());
                }
                else {
                    logger_1.logger.warn('No client email found, skipping client email', { userId: payload.userId });
                }
                /* Admin email: always attempt for critical event types, without querying Supabase */
                const ADMIN_EVENTS = new Set([
                    'REQUEST_STATUS_CHANGED',
                    'DRAFT_SENT',
                    'PAYMENT_PROOF_UPLOADED',
                    'PAYMENT_CONFIRMED'
                ]);
                const shouldNotifyAdmin = ADMIN_EVENTS.has(payload.type);
                if (shouldNotifyAdmin) {
                    const adminEnv = process.env.ADMIN_EMAIL;
                    const adminListEnv = process.env.ADMIN_EMAILS;
                    let adminRecipients = [];
                    if (adminEnv)
                        adminRecipients.push(adminEnv);
                    if (adminListEnv) {
                        adminRecipients = adminRecipients.concat(adminListEnv.split(',').map(s => s.trim()).filter(Boolean));
                    }
                    if (adminRecipients.length === 0) {
                        logger_1.logger.info('Admin email skipped (no ADMIN_EMAIL or ADMIN_EMAILS configured)');
                    }
                    else {
                        tasks.push((async () => {
                            try {
                                logger_1.logger.info('Sending admin email', { to: adminRecipients, type: payload.type });
                                const html = await getHtmlFor('Admin');
                                await smtpTransporter.sendMail({
                                    from: process.env.EMAIL_FROM || 'no-reply@example.com',
                                    to: adminRecipients.join(','),
                                    subject: `[ADMIN] ${payload.title}`,
                                    text: payload.message,
                                    html,
                                    attachments
                                });
                                logger_1.logger.info('Admin email sent', { to: adminRecipients });
                            }
                            catch (adminErr) {
                                logger_1.logger.error('Admin email send failed', { error: adminErr, to: adminRecipients });
                            }
                        })());
                    }
                }
                else {
                    logger_1.logger.info('Admin email skipped (event not in admin list)', { event: payload.type });
                }
                /* Run tasks in parallel and don't fail main flow if they error */
                if (tasks.length > 0) {
                    await Promise.allSettled(tasks);
                }
            }
            return { success: true };
        }
        catch (err) {
            logger_1.logger.error('NotificationsService.send failed', { err });
            throw new Error('Failed to send notification');
        }
    }
}
exports.NotificationsService = NotificationsService;
//# sourceMappingURL=notifications.service.js.map