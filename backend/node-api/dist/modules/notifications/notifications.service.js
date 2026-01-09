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
class NotificationsService {
    static async send(payload) {
        try {
            logger_1.logger.info('Sending notification', { type: payload.type, userId: payload.userId });
            // Store notification in DB (best-effort)
            try {
                await supabase_1.supabase.from('notifications').insert({
                    id: undefined,
                    user_id: payload.userId,
                    type: payload.type,
                    title: payload.title,
                    message: payload.message,
                    entity_type: payload.entityType || null,
                    entity_id: payload.entityId || null,
                    channels: payload.channels || ['in_app'],
                    metadata: { links: payload.links || [] },
                    created_at: new Date().toISOString()
                });
            }
            catch (e) {
                logger_1.logger.warn('Failed to persist notification', { e });
            }
            // If email channel requested, try to send email
            if ((payload.channels || []).includes('email')) {
                // Resolve user email from profiles
                const { data: profile, error: profileError } = await supabase_1.supabase
                    .from('profiles')
                    .select('email, nom, prenom')
                    .eq('id', payload.userId)
                    .single();
                const userEmail = profile?.email;
                if (!userEmail) {
                    logger_1.logger.warn('No email for user, skipping email send', { userId: payload.userId, profileError });
                }
                else if (process.env.SMTP_HOST) {
                    const transporter = nodemailer_1.default.createTransport({
                        host: process.env.SMTP_HOST,
                        port: Number(process.env.SMTP_PORT || 587),
                        secure: process.env.SMTP_SECURE === 'true',
                        auth: process.env.SMTP_USER
                            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                            : undefined
                    });
                    const attachments = (payload.attachments || []).map(a => ({
                        filename: a.name,
                        content: Buffer.from(a.base64, 'base64'),
                        contentType: a.mime
                    }));
                    const linksHtml = (payload.links || [])
                        .map(l => `<li><a href="${l.url}">${l.name}</a> (expires in ${l.expires_in || 3600}s)</li>`)
                        .join('');
                    // Build localized HTML using templates if available
                    let html = `<p>${payload.message}</p>${linksHtml ? `<ul>${linksHtml}</ul>` : ''}`;
                    try {
                        const { EmailTemplates } = await Promise.resolve().then(() => __importStar(require('./email.templates')));
                        const tpl = EmailTemplates[payload.type];
                        if (tpl) {
                            html = tpl(payload.language || 'fr', {
                                prenom: profile?.prenom,
                                requestRef: payload.entityId,
                                links: payload.links || []
                                // attachments handled separately
                            });
                        }
                    }
                    catch (e) {
                        logger_1.logger.warn('Failed to build localized template, falling back to simple html', { e });
                    }
                    await transporter.sendMail({
                        from: process.env.EMAIL_FROM || 'no-reply@example.com',
                        to: userEmail,
                        subject: payload.title,
                        text: payload.message,
                        html,
                        attachments
                    });
                    logger_1.logger.info('Email sent', { to: userEmail, type: payload.type });
                }
                else {
                    logger_1.logger.info('SMTP not configured, skipping email send');
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