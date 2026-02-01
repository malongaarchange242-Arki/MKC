import { Router } from 'express';
import { AdminController } from './admin.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/role.middleware';
import { getAuthUserId, getAuthUserRole } from '../../utils/request-user';
import { logger } from '../../utils/logger';
import { uploadMiddleware } from '../../middlewares/upload.middleware';

export const adminModule = (): Router => {
	const router = Router();

	// Apply module-wide protection: only ADMIN or SYSTEM
	// Add a short logging middleware after auth to capture attempts for diagnosis
	router.use(
		authMiddleware,
		(req, _res, next) => {
			try {
				const uid = getAuthUserId(req);
				const role = getAuthUserRole(req);
				logger.info('Admin route access attempt', { path: req.path, userId: uid, role });
			} catch (e) {
				logger.warn('Failed to log admin access attempt', { error: e });
			}
			next();
		},
		requireRole(['ADMIN', 'SYSTEM'])
	);

	// Users
	router.get('/users', AdminController.listUsers);
	router.get('/users/:id', AdminController.getUserById);
	router.patch('/users/:id/role', AdminController.updateUserRole);
	router.patch('/users/:id/status', (_req, res) => res.status(501).json({ message: 'Not implemented' }));

	// Requests
	router.get('/requests', AdminController.listRequests);
	router.get('/requests/:id', AdminController.getRequestById);
	router.post('/requests/:id/under-review', AdminController.markUnderReview);
	router.patch('/requests/:id/status', AdminController.forceUpdateRequestStatus);
	router.patch('/requests/:id/bl-saisi', AdminController.updateBLSaisi);
	router.post('/requests/:id/publish', uploadMiddleware.fields([{ name: 'file', maxCount: 1 }, { name: 'ad_file', maxCount: 1 }]), AdminController.publishFinalDocuments);
	router.post('/requests/:id/confirm-payment', AdminController.confirmPayment);
	router.post('/requests/:id/generate-feri', AdminController.generateFeri);
	router.post('/requests/:id/generate-ad', AdminController.generateAd);
	// Regenerate/fix manual BL (admin only)
	router.post('/requests/:id/regenerate-manual-bl', AdminController.regenerateManualBl);

	// SEND DRAFT (atomic: create/update invoice + attach draft + transition + notify)
	router.post('/requests/:id/send-draft', uploadMiddleware.single('file'), AdminController.sendDraft);

	// NOTIFY DRAFT (notification-only: admin triggers sending draft/proforma notification
	// to client for an existing invoice/draft. Accepts JSON { invoice_id? invoice_number? })
	router.post('/requests/:id/notify-draft', AdminController.notifyDraft);

	// NOTIFY PROFORMA (notification-only: admin triggers sending notification for specific
	// proforma file IDs returned by the upload endpoint. Accepts JSON { fileIds?: string[], message?: string })
	router.post('/requests/:id/notify-proforma', AdminController.notifyProforma);

	// ADMIN upload draft/proforma (legacy, keeps array flow)
	router.post('/requests/:id/upload-draft', uploadMiddleware.array('files'), AdminController.uploadDraft);

	// Documents
	router.get('/documents', AdminController.listDocuments);
	router.get('/documents/:id', AdminController.getDocumentById);
	router.delete('/documents/:id', AdminController.deleteDocument);

	return router;
};