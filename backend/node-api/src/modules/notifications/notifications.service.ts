import { supabase } from '../../config/supabase';
import { logger } from '../../utils/logger';
import nodemailer from 'nodemailer';

/* ===============================
   TYPES
================================ */

export type NotificationChannel = 'in_app' | 'email';

export interface NotificationPayload {
	userId: string;
	type: string;
	title: string;
	message: string;
	client_name?: string;
	client_email?: string;
	status?: string;
	date?: string;
	admin_dashboard_url?: string;
	requestRef?: string;
	request_id?: string;
	entityType?: string;
	entityId?: string;
	language?: 'fr' | 'en';
	channels?: NotificationChannel[];
	attachments?: Array<{ name: string; mime: string; base64: string }>;
	links?: Array<{ name: string; url: string; expires_in?: number }>;
	metadata?: any;
	overrideEmail?: string;
}

/* ===============================
   SMTP SINGLETON
================================ */

const smtpTransporter =
	process.env.SMTP_HOST
		? nodemailer.createTransport({
				host: process.env.SMTP_HOST,
				port: Number(process.env.SMTP_PORT || 587),
				secure: process.env.SMTP_SECURE === 'true',
				auth: process.env.SMTP_USER
					? {
							user: process.env.SMTP_USER,
							pass: process.env.SMTP_PASS
					  }
					: undefined,
				tls:
					process.env.SMTP_ALLOW_INSECURE === 'true'
						? { rejectUnauthorized: false }
						: undefined
		  })
		: null;

/* ===============================
   SERVICE
================================ */

export class NotificationsService {
	static async send(payload: NotificationPayload) {
		try {
			/* -------------------- Validation -------------------- */
			if (!payload.title || !payload.message) {
				throw new Error('Notification title and message are required');
			}

			const channels: NotificationChannel[] =
				payload.channels ?? ['in_app'];

			logger.info('Sending notification', {
				type: payload.type,
				userId: payload.userId,
				channels
			});

			/* -------------------- IN-APP -------------------- */
            if (channels.includes('in_app')) {
				try {
				await supabase.from('notifications').insert({
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
				} catch (e) {
					logger.warn('Failed to persist in-app notification', { e });
				}
			}

			/* -------------------- EMAIL -------------------- */
			if (channels.includes('email')) {
				if (!smtpTransporter) {
					logger.info('SMTP not configured, skipping email', {
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
					.map(
						l =>
							`<li><a href="${l.url}">${l.name}</a>${
								l.expires_in
									? ` (expire dans ${l.expires_in}s)`
									: ''
							}</li>`
					)
					.join('');

				const getHtmlFor = async (prenom?: string) => {
					let html = `
						<p>Bonjour ${prenom ?? ''},</p>
						<p>${payload.message}</p>
						${linksHtml ? `<ul>${linksHtml}</ul>` : ''}
					`;
					let subjectOverride: string | undefined;
					let textOverride: string | undefined;

					try {
						const { EmailTemplates } = await import('./email.templates');

						// Use the template based on the event type
						// Always use the appropriate template for the event type
						let tplKey = payload.type as keyof typeof EmailTemplates;

						// If this email is prepared for the admin (prenom passed as 'Admin' or 'Administrateur'),
						// prefer an ADMIN-specific template variant if available (e.g. REQUEST_CREATED_ADMIN).
						let tpl: any = EmailTemplates[tplKey];
						try {
							const isAdminRecipient = (prenom || '').toString().toLowerCase().includes('admin');
							const adminKey = (tplKey as string) + '_ADMIN';
							if (isAdminRecipient && (EmailTemplates as any)[adminKey]) {
								tpl = (EmailTemplates as any)[adminKey];
							}

							// Log which template key will be used to render the email (helps debug wrong template selection)
							const chosenKey = (isAdminRecipient && (EmailTemplates as any)[adminKey]) ? adminKey : tplKey;
							logger.info('Resolved email template key', { tplKey: String(tplKey), adminKey: String(adminKey), chosenKey: String(chosenKey) });
						} catch (e) {
							// ignore and use base tpl
						}
						if (tpl) {
							const tplInput: any = {
								prenom,
								entityId: payload.entityId,
								links: payload.links ?? [],
								client_name: (payload as any).client_name,
								client_email: (payload as any).client_email,
								status: (payload as any).status,
								date: (payload as any).date,
								admin_dashboard_url: (payload as any).admin_dashboard_url,
								requestRef: (payload as any).requestRef
							};

							try {
								const tplOut: any = tpl(payload.language ?? 'fr', tplInput);
								if (typeof tplOut === 'string') {
									html = tplOut;
								} else if (tplOut && typeof tplOut === 'object') {
									subjectOverride = tplOut.subject ?? tplOut.title;
									textOverride = tplOut.text;
									html = tplOut.html ?? html;
								}
							} catch (tplErr) {
								logger.warn('Email template function threw', { tplErr, tplKey });
							}
						}
					} catch (e) {
						logger.warn('Email template error, fallback HTML used', { e });
					}

					return { html, subjectOverride, textOverride };
				};

				/* Resolve client email (non-blocking for admin send) */
				let userEmail: string | undefined;
				let prenom: string | undefined;

				if (payload.overrideEmail) {
					userEmail = payload.overrideEmail;
					prenom = 'Administrateur';
				} else {
					try {
							const { data, error } = await supabase
								.schema('public') 
								.from('profiles')
								.select('email, prenom')
								.eq('id', payload.userId)
								.maybeSingle();

							if (error) {
								logger.warn('Failed to load profile', { error, userId: payload.userId });
							}

							if (!data) {
								logger.warn('Profile missing for user', { userId: payload.userId });
							}

							userEmail = data?.email;
							prenom = data?.prenom;
					} catch (e) {
						logger.warn('Supabase profile fetch error', { e, userId: payload.userId });
						// Do not throw or return: admin email must still be sent
					}
				}

				logger.info('Resolved email for notification', { userId: payload.userId, resolvedEmail: !!userEmail, email: userEmail ? (userEmail.length > 60 ? userEmail.slice(0,40)+'...' : userEmail) : null, overrideEmail: !!payload.overrideEmail });

				/* Prepare send tasks */
				const tasks: Promise<any>[] = [];

				/* ------------------ CLIENT / ADMIN FILTERS ------------------ */
			// ✅ CLIENT: 6 NOTIFICATIONS UNIQUEMENT (reduce noise)
			// REQUEST_CREATED, PAYMENT_CONFIRMED, DRAFT_AVAILABLE, REQUEST_COMPLETED, REQUEST_REJECTED, BL_AUTO_GENERATED
			const CLIENT_ALLOWED = new Set([
				'REQUEST_CREATED',
				'REQUEST_STATUS_CHANGED',
				'PAYMENT_CONFIRMED',
				// Allow client notification when they upload payment proof
				'PAYMENT_PROOF_UPLOADED',
				'DRAFT_AVAILABLE',
				'REQUEST_COMPLETED',
				'REQUEST_REJECTED',
				'BL_AUTO_GENERATED',
				// Also allow client-targeted event names emitted by RequestsService
				'CLIENT_PAYMENT_CONFIRMED',
				'CLIENT_DRAFT_AVAILABLE',
				'CLIENT_FERI_ISSUED'
			]);

			// ✅ ADMIN: VISIBILITÉ COMPLÈTE (10 événements)
			// REQUEST_CREATED, REQUEST_SUBMITTED, PAYMENT_PROOF_UPLOADED, PAYMENT_CONFIRMED,
			// DRAFT_AVAILABLE, REQUEST_STATUS_CHANGED, REQUEST_MESSAGE_ADMIN, REQUEST_DISPUTE_ADMIN,
			// REQUEST_COMPLETED, REQUEST_REJECTED
			const ADMIN_EVENTS = new Set([
				'REQUEST_CREATED',
				'REQUEST_SUBMITTED',
				'PAYMENT_PROOF_UPLOADED',
				'PAYMENT_CONFIRMED',
				'DRAFT_AVAILABLE',
				'REQUEST_STATUS_CHANGED',
				'REQUEST_MESSAGE_ADMIN',
				'REQUEST_DISPUTE_ADMIN',
				'REQUEST_COMPLETED',
				'REQUEST_REJECTED',
				// include BL auto-generation so admins receive an email when a BL ref is auto-created
				'BL_AUTO_GENERATED'
			]);

			/* Client email task (if available)
			   Only send for allowed client events. Attachments are sent to client
			   only for final document (REQUEST_COMPLETED). Drafts are provided as links. */
			if (userEmail) {
					if (!CLIENT_ALLOWED.has(payload.type)) {
						logger.info('Skipping client email (event not in client whitelist)', { type: payload.type, userId: payload.userId });
					} else {
						tasks.push((async () => {
							try {
								const { html, subjectOverride, textOverride } = await getHtmlFor(prenom);
								const mailSubject = subjectOverride || payload.title;
								const mailText = textOverride || payload.message;
								logger.info('Sending client email', { to: userEmail, type: payload.type });
								// Only attach final PDF for REQUEST_COMPLETED; drafts should be links
								const clientAttachments = payload.type === 'REQUEST_COMPLETED' ? attachments : [];
								await smtpTransporter.sendMail({
									from: process.env.EMAIL_FROM || 'no-reply@example.com',
									to: userEmail,
									subject: mailSubject,
									text: mailText,
									html,
									attachments: clientAttachments
								});
								logger.info('Client email sent', { to: userEmail, type: payload.type });
							} catch (sendErr) {
								logger.error('SMTP sendMail failed (client)', { 
									error: sendErr instanceof Error ? sendErr.message : JSON.stringify(sendErr), 
									to: userEmail,
									stack: sendErr instanceof Error ? sendErr.stack : undefined
								});
							}
						})());
					}
				} else {
					logger.warn('No client email found, skipping client email', { userId: payload.userId });
				}

				/* Admin email: check configured admin events (defined above) */
				const shouldNotifyAdmin = ADMIN_EVENTS.has(payload.type);

				if (shouldNotifyAdmin) {
					const adminEnv = process.env.ADMIN_EMAIL;
					const adminListEnv = process.env.ADMIN_EMAILS;
					let adminRecipients: string[] = [];

					if (adminEnv) adminRecipients.push(adminEnv);
					if (adminListEnv) {
						adminRecipients = adminRecipients.concat(
							adminListEnv.split(',').map(s => s.trim()).filter(Boolean)
						);
					}

					if (adminRecipients.length === 0) {
						logger.info('Admin email skipped (no ADMIN_EMAIL or ADMIN_EMAILS configured)');
						// Keep sending in-app notifications even when admin email recipients are not configured
					} else {
						tasks.push((async () => {
							try {
								logger.info('Sending admin email', { to: adminRecipients, type: payload.type });
								const { html, subjectOverride, textOverride } = await getHtmlFor('Admin');
								const mailSubject = `[ADMIN] ${subjectOverride || payload.title}`;
								const mailText = textOverride || payload.message;
								const adminFrom = process.env.ADMIN_EMAIL
									? `${process.env.BRAND_NAME || 'Maritime Kargo Consulting'} <${process.env.ADMIN_EMAIL}>`
									: 'Maritime Kargo Consulting <malongaarchange242@gmail.com>';
								await smtpTransporter.sendMail({
									from: adminFrom,
									to: adminRecipients.join(','),
									subject: mailSubject,
									text: mailText,
									html,
									attachments: [] // do not include attachments for admin
								});
								logger.info('Admin email sent', { to: adminRecipients });
							} catch (adminErr) {
								logger.error('Admin email send failed', { 
									error: adminErr instanceof Error ? adminErr.message : JSON.stringify(adminErr), 
									to: adminRecipients,
									stack: adminErr instanceof Error ? adminErr.stack : undefined
								});
							}
						})());
					}
				} else {
					logger.info('Admin email skipped (event not in admin list)', { event: payload.type });
				}

				/* Run tasks in parallel and don't fail main flow if they error */
				if (tasks.length > 0) {
					await Promise.allSettled(tasks);
				}
			}

			return { success: true };
		} catch (err) {
			logger.error('NotificationsService.send failed', { err });
			throw new Error('Failed to send notification');
		}
	}
}
