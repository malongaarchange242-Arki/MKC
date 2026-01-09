"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DraftsService = void 0;
const supabaseAdmin_1 = require("../../config/supabaseAdmin");
const logger_1 = require("../../utils/logger");
const uuid_1 = require("uuid");
const requests_service_1 = require("../requests/requests.service");
const DRAFTS_BUCKET = 'request_drafts';
class DraftsService {
    // Create a draft: upload to Supabase storage and insert metadata in request_drafts
    static async createDraft(input) {
        const { requestId, file, uploadedBy, amount = null, currency = null } = input;
        logger_1.logger.info('Creating request draft', { requestId, fileName: file.originalname, uploadedBy });
        // Ensure request exists and admin can act
        const request = await requests_service_1.RequestsService.getRequestById(requestId);
        if (!request)
            throw new Error('Request not found');
        // Generate unique filename and path
        const ext = (file.originalname || 'draft.pdf').split('.').pop() || 'pdf';
        const uniqueName = `${(0, uuid_1.v4)()}.${ext}`;
        const storagePath = `${requestId}/${uniqueName}`;
        // Upload to supabase storage (private bucket)
        const { data: uploadData, error: uploadError } = await supabaseAdmin_1.supabaseAdmin.storage
            .from(DRAFTS_BUCKET)
            .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });
        if (uploadError) {
            logger_1.logger.error('Failed to upload draft to storage', { uploadError });
            throw new Error('Failed to upload draft');
        }
        // Persist draft metadata
        const draftId = (0, uuid_1.v4)();
        const insertPayload = {
            id: draftId,
            request_id: requestId,
            uploaded_by: uploadedBy,
            issued_by: uploadedBy,
            file_name: file.originalname,
            file_path: storagePath,
            amount: amount,
            currency: currency || 'USD',
            status: 'SENT'
        };
        const { data: inserted, error: dbError } = await supabaseAdmin_1.supabaseAdmin
            .from('request_drafts')
            .insert(insertPayload)
            .select()
            .single();
        if (dbError || !inserted) {
            // cleanup storage
            await supabaseAdmin_1.supabaseAdmin.storage.from(DRAFTS_BUCKET).remove([storagePath]).catch(() => null);
            logger_1.logger.error('Failed to persist draft metadata', { dbError });
            throw new Error('Failed to save draft metadata');
        }
        return inserted;
    }
    // Get draft by id (does not return signed url)
    static async getDraftById(draftId) {
        const { data: draft, error } = await supabaseAdmin_1.supabaseAdmin
            .from('request_drafts')
            .select('*')
            .eq('id', draftId)
            .single();
        if (error || !draft)
            throw new Error('Draft not found');
        return draft;
    }
    // Generate a short-lived signed URL for a draft
    static async generateSignedUrl(draftId, expiresInSec = 60 * 10) {
        const draft = await this.getDraftById(draftId);
        if (!draft || !draft.file_path)
            throw new Error('Draft file path not found');
        const { data: signData, error: signErr } = await supabaseAdmin_1.supabaseAdmin.storage
            .from(DRAFTS_BUCKET)
            .createSignedUrl(draft.file_path, expiresInSec);
        if (signErr || !signData?.signedUrl) {
            logger_1.logger.error('Failed to create signed url for draft', { draftId, signErr });
            throw new Error('Failed to generate signed url');
        }
        return signData.signedUrl;
    }
}
exports.DraftsService = DraftsService;
//# sourceMappingURL=drafts.service.js.map