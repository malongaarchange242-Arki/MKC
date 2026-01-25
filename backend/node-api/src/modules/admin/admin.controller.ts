import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { AdminService } from './admin.service';
import { getAuthUserId, getAuthUserRole } from '../../utils/request-user';
import { RequestsService } from '../requests/requests.service';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { logger } from '../../utils/logger';
import { DraftsService } from '../drafts/drafts.service';

type AuthRequest = Request & {
	user?: {
		id: string;
		role: 'ADMIN' | 'CLIENT' | 'SYSTEM';
	};
};

// Helper: ensure the caller is ADMIN or SYSTEM. Returns true if allowed, otherwise
// sends a 403 response and logs the attempt.
function ensureAdminOrSystem(req: Request, res: Response): boolean {
	const role = getAuthUserRole(req);
	const uid = getAuthUserId(req);
	if (role !== 'ADMIN' && role !== 'SYSTEM') {
		logger.warn('Non-admin accessed admin route', { userId: uid, role });
		res.status(403).json({ message: 'Forbidden' });
		return false;
	}
	return true;
}

const handleControllerError = (res: Response, error: unknown, context = '') => {
	logger.error(`${context} failed`, { error });

	if (error instanceof ZodError) {
		return res.status(422).json({ message: 'Invalid payload', errors: error.flatten().fieldErrors });
	}

	if (error instanceof Error) {
		return res.status(400).json({ message: error.message });
	}

	return res.status(500).json({ message: 'Unexpected error' });
};

export class AdminController {
	static async listUsers(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const limit = Number(req.query.limit ?? 50) || 50;
			const offset = Number(req.query.offset ?? 0) || 0;

			const users = await AdminService.listUsers(limit, offset);
			return res.status(200).json(users);
		} catch (error: unknown) {
			return handleControllerError(res, error, 'List users');
		}
	}

	static async getUserById(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const userId = req.params.id;
			const user = await AdminService.getUserById(userId);
			return res.status(200).json(user);
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Get user');
		}
	}

	static async updateUserRole(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const schema = z.object({ role: z.enum(['CLIENT', 'ADMIN', 'SYSTEM']) });
			const body = schema.parse(req.body);

			const userId = req.params.id;

			const updated = await AdminService.updateUserRole(userId, body.role);
			return res.status(200).json(updated);
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Update user role');
		}
	}

	static async listRequests(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const filters = {
				status: req.query.status as string | undefined,
				type: req.query.type as string | undefined,
				userId: req.query.userId as string | undefined
			};

			const data = await AdminService.listRequests(filters);
			return res.status(200).json(data);
		} catch (error: unknown) {
			return handleControllerError(res, error, 'List requests');
		}
	}

	static async getRequestById(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const requestId = req.params.id;
			const data = await AdminService.getRequestById(requestId);
			return res.status(200).json({ success: true, data });
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Get request');
		}
	}

	static async markUnderReview(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const adminId = getAuthUserId(req);
			if (!adminId) return res.status(401).json({ message: 'Unauthorized' });
			const requestId = req.params.id;

			// transition to UNDER_REVIEW
			const result = await RequestsService.transitionStatus({
				requestId,
				to: 'UNDER_REVIEW',
				actorRole: 'ADMIN',
				actorId: adminId
			});

			return res.status(200).json({ success: true, result });
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Mark under review');
		}
	}

	static async forceUpdateRequestStatus(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const schema = z.object({ status: z.string() });
			const body = schema.parse(req.body);

			const adminId = getAuthUserId(req);
			if (!adminId) return res.status(401).json({ message: 'Unauthorized' });

			const requestId = req.params.id;

			const result = await AdminService.forceUpdateRequestStatus(requestId, body.status, adminId);
			return res.status(200).json(result);
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Force update request status');
		}
	}

	static async listDocuments(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const filters = {
				requestId: req.query.requestId as string | undefined,
				userId: req.query.userId as string | undefined,
				limit: req.query.limit ? Number(req.query.limit) : undefined,
				offset: req.query.offset ? Number(req.query.offset) : undefined
			};

			const adminId = getAuthUserId(req) ?? '';

			const docs = await AdminService.listDocuments(adminId, filters);
			return res.status(200).json(docs);
		} catch (error: unknown) {
			return handleControllerError(res, error, 'List documents');
		}
	}

	static async getDocumentById(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const documentId = req.params.id;
			const adminId = getAuthUserId(req) ?? '';
			const doc = await AdminService.getDocumentById(documentId, adminId);
			return res.status(200).json(doc);
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Get document');
		}
	}

	static async deleteDocument(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const adminId = getAuthUserId(req);
			if (!adminId) return res.status(401).json({ message: 'Unauthorized' });

			const documentId = req.params.id;
			const result = await AdminService.deleteDocument(documentId, adminId);
			return res.status(200).json(result);
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Delete document');
		}
	}

	static async publishFinalDocuments(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const adminId = getAuthUserId(req);
			if (!adminId) return res.status(401).json({ message: 'Unauthorized' });

			const requestId = req.params.id;
			// Accept optional feri_ref and attached files (`file` and optional `ad_file`)
			const opts: any = req.body || {};
			const files = (req.files as any) || {};
			// multer.fields populates req.files as an object of arrays
			if (files.file && Array.isArray(files.file) && files.file[0]) opts.file = files.file[0];
			if (files.ad_file && Array.isArray(files.ad_file) && files.ad_file[0]) opts.ad_file = files.ad_file[0];
			if (req.body.feri_ref) opts.feri_ref = String(req.body.feri_ref);

			const result = await AdminService.publishFinalDocuments(requestId, adminId, opts);
			// Avoid duplicate `success` property at compile-time by merging at runtime
			if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'success')) {
				return res.status(200).json(result as any);
			}
			return res.status(200).json(Object.assign({ success: true }, result || {}));
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Publish final documents');
		}
	}

		static async regenerateManualBl(req: AuthRequest, res: Response) {
			try {
				if (!ensureAdminOrSystem(req, res)) return;
				const adminId = getAuthUserId(req) ?? '';
				if (!adminId) return res.status(401).json({ message: 'Unauthorized' });
				const requestId = req.params.id;
				const result = await AdminService.regenerateManualBl(requestId, adminId);
				if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'success')) {
					return res.status(200).json(result as any);
				}
				return res.status(200).json(Object.assign({ success: true }, result || {}));
			} catch (error: unknown) {
				return handleControllerError(res, error, 'Regenerate manual BL');
			}
		}

	static async uploadDraft(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;
			const adminId = getAuthUserId(req);
			if (!adminId) return res.status(401).json({ message: 'Unauthorized' });

			const requestId = req.params.id;

			// Validate documentType
			const docType = (req.body.documentType || req.body.documentType?.toString()) as string;
			if (!docType || !['DRAFT_FERI', 'PROFORMA'].includes(docType)) {
				return res.status(422).json({ message: 'documentType is required and must be DRAFT_FERI or PROFORMA' });
			}

			// Ensure files present
			const files = (req.files as Express.Multer.File[]) || [];
			if (!files || files.length === 0) {
				return res.status(400).json({ message: 'No files provided' });
			}

			// Fetch request and ensure status is UNDER_REVIEW
			const request = await RequestsService.getRequestById(requestId);
			if (!request) return res.status(404).json({ message: 'Request not found' });
			if (request.status !== 'UNDER_REVIEW') return res.status(400).json({ message: 'Cannot upload draft unless request is UNDER_REVIEW' });

			// Only ADMIN allowed (module guard exists but double-check)
			const role = getAuthUserRole(req);
			if (role !== 'ADMIN' && role !== 'SYSTEM') return res.status(403).json({ message: 'Forbidden' });

			// Use DraftsService to create request_drafts entries in dedicated bucket
			const createdDrafts: any[] = [];
			for (const f of files) {
				const draft = await DraftsService.createDraft({
					requestId,
					file: f,
					uploadedBy: adminId,
					type: docType
				});
				createdDrafts.push(draft);
			}

			// Transition to DRAFT_SENT (single transition)
			await RequestsService.transitionStatus({ requestId, to: 'DRAFT_SENT', actorRole: 'ADMIN', actorId: adminId });

			// Audit
			await AuditService.log({ actor_id: adminId, action: 'UPLOAD_DRAFT', entity: 'request', entity_id: requestId, metadata: { drafts: createdDrafts.map(d => d.id), type: docType } });

			// Prepare links (signed urls) and metadata for notifications — do NOT embed file content in notifications
			const links: Array<{ name: string; url: string; expires_in?: number }> = [];
			const metadataItems: any[] = [];
			for (const d of createdDrafts) {
				try {
					const signed = await DraftsService.generateSignedUrl(d.id, 60 * 60 * 24 * 3);
					// Prefer explicit naming by draft type so email groups links correctly
					let linkName = d.file_name || 'File';
					try {
						const t = (d.type || '').toString().toLowerCase();
						if (t.includes('proforma')) linkName = 'Proforma';
						else if (t.includes('feri') || t.includes('draft')) linkName = 'Draft';
					} catch (nerr) {
						// ignore and use file_name fallback
					}
					links.push({ name: linkName, url: signed, expires_in: 60 * 60 * 24 * 3 });
					metadataItems.push({ draft_id: d.id, file_name: d.file_name, file_path: d.file_path, type: d.type });
				} catch (e) {
					logger.warn('Failed to create signed url for draft', { draftId: d.id, e });
				}
			}

			// Send notification + email referencing the draft via metadata (no file content)
			try {
				const { NotificationsService } = await import('../notifications/notifications.service');
				await NotificationsService.send({
					userId: request.user_id,
					type: 'DRAFT_AVAILABLE',
					title: 'Draft & Proforma disponibles',
					message: 'Votre draft et votre facture proforma sont disponibles. Merci de procéder au paiement.',
					entityType: 'request',
					entityId: requestId,
					channels: ['in_app', 'email'],
					links: links.length > 0 ? links : [{ name: 'Voir la demande', url: `${process.env.FRONTEND_URL || 'https://app.example.com'}/requests/${requestId}`, expires_in: 259200 }],
					metadata: metadataItems.length === 1 ? metadataItems[0] : metadataItems
				});
			} catch (e) {
				logger.warn('Failed to send draft notification', { e });
			}

			return res.status(200).json({ success: true, drafts: createdDrafts });
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Upload draft');
		}
	}

	static async confirmPayment(req: AuthRequest, res: Response) {
		try {
			const adminId = getAuthUserId(req);
			if (!adminId) return res.status(401).json({ message: 'Unauthorized' });

			const requestId = req.params.id;

			const request = await RequestsService.getRequestById(requestId);
			if (!request) return res.status(404).json({ message: 'Request not found' });
			if (request.status !== 'PAYMENT_PROOF_UPLOADED') return res.status(400).json({ message: 'No payment proof to confirm' });

			// Transition to PAYMENT_CONFIRMED
			await RequestsService.transitionStatus({
				requestId,
				to: 'PAYMENT_CONFIRMED',
				actorRole: 'ADMIN',
				actorId: adminId
			});

			// Audit
			await AuditService.log({
				actor_id: adminId,
				action: 'CONFIRM_PAYMENT',
				entity: 'request',
				entity_id: requestId
			});

			// Notify client
			try {
				const { NotificationsService } = await import('../notifications/notifications.service');

				// Send client notification (in-app + email)
				const clientPromise = NotificationsService.send({
					userId: request.user_id,
					type: 'PAYMENT_CONFIRMED',
					title: 'Paiement confirmé',
					message: `Le paiement pour la demande ${request.ref || requestId} a été confirmé.`,
					entityType: 'request',
					entityId: requestId,
					channels: ['in_app', 'email']
				});

				// Also notify configured admin emails (best-effort)
				const adminRecipients: string[] = [];
				if (process.env.ADMIN_EMAIL) adminRecipients.push(process.env.ADMIN_EMAIL);
				if (process.env.ADMIN_EMAILS) adminRecipients.push(...process.env.ADMIN_EMAILS.split(',').map(s => s.trim()).filter(Boolean));

				const adminNotifications = adminRecipients.map(email =>
					NotificationsService.send({
						userId: request.user_id,
						overrideEmail: email,
						type: 'PAYMENT_CONFIRMED',
						title: 'Paiement confirmé',
						message: `Le paiement pour la demande ${request.ref || requestId} a été confirmé.`,
						entityType: 'request',
						entityId: requestId,
						channels: ['email']
					})
				);

				await Promise.allSettled([clientPromise, ...adminNotifications]);
			} catch (e) {
				logger.warn('Failed to send payment confirmed notification', { e });
			}

			return res.status(200).json({ success: true });
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Confirm payment');
		}
	}

	static async generateFeri(req: AuthRequest, res: Response) {
		try {
			const requestId = req.params.id;
			const adminId = getAuthUserId(req);
			if (!adminId) return res.status(401).json({ message: 'Unauthorized' });
			const doc = await AdminService.generateFinalDocument(requestId, adminId, 'FERI');
			return res.status(200).json({ success: true, document: doc });
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Generate FERI');
		}
	}

	static async generateAd(req: AuthRequest, res: Response) {
		try {
			const requestId = req.params.id;
			const adminId = getAuthUserId(req);
			if (!adminId) return res.status(401).json({ message: 'Unauthorized' });
			const doc = await AdminService.generateFinalDocument(requestId, adminId, 'AD');
			return res.status(200).json({ success: true, document: doc });
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Generate AD');
		}
	}

	// Internal helper to create admin document and return saved document
	private static async _createAdminDocumentInternal(requestId: string, adminId: string, docType: string, file: Express.Multer.File) {
		return await (await import('../documents/documents.service')).DocumentsService.createAdminDocument({
			requestId,
			file,
			uploadedBy: adminId,
			type: docType as any,
			visibility: 'CLIENT'
		});
	}

	static async sendDraft(req: AuthRequest, res: Response) {
		try {
			if (!ensureAdminOrSystem(req, res)) return;

			const adminId = getAuthUserId(req);
			if (!adminId) return res.status(401).json({ message: 'Unauthorized' });

			const requestId = req.params.id;

			// Parse multipart fields
			const amountRaw = req.body?.amount;
			const currency = (req.body?.currency || 'USD').toString();
			const cargoRoute = (req.body?.cargo_route || req.body?.cargoRoute || '').toString().trim();
			const file = req.file as Express.Multer.File | undefined;

			const amount = amountRaw !== undefined && amountRaw !== null ? Number(amountRaw) : null;

			// Log incoming data to help debugging
			logger.info('AdminController.sendDraft received', {
				requestId,
				adminId,
				amountRaw,
				amountParsed: amount,
				currency,
				filePresent: !!file,
				fileMeta: file ? { originalname: file.originalname, size: file.size, mimetype: file.mimetype } : undefined
			});

			if (amount === null || isNaN(amount)) {
				return res.status(422).json({ message: 'amount is required and must be a number' });
			}

			if (!cargoRoute) {
				return res.status(422).json({ message: 'cargo_route is required' });
			}

			if (!file) {
				return res.status(422).json({ message: 'file is required' });
			}

			// Prefer frontend base from request headers (origin or referer) when available
			const frontendBase = req.get('origin') || req.headers.referer || process.env.FRONTEND_URL || process.env.ADMIN_DASHBOARD_URL || '';
			const invoice = await AdminService.sendDraft(requestId, adminId, { amount, currency, file, cargo_route: cargoRoute, frontend_base: frontendBase });
			return res.status(200).json({ success: true, invoice });
		} catch (error: unknown) {
			return handleControllerError(res, error, 'Send draft');
		}
	}
}