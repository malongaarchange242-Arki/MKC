import { supabaseAdmin as supabase } from '../../config/supabaseAdmin';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { RequestsService } from '../requests/requests.service';
import { DocumentsService } from '../documents/documents.service';

const DRAFTS_BUCKET = 'request_drafts';

export interface RequestDraft {
  id: string;
  request_id: string;
  uploaded_by: string;
  issued_by?: string;
  file_name: string;
  file_path: string;
  invoice_id?: string | null;
  created_at: string;
}

export class DraftsService {
  // Create a draft: upload to Supabase storage and insert metadata in request_drafts
  static async createDraft(input: {
    requestId: string;
    file: Express.Multer.File;
    uploadedBy: string;
    type?: string; // Added type property
    visibility?: string; // Added visibility property
    invoiceId?: string | null; // link to invoices table
  }): Promise<RequestDraft> {
    const { requestId, file, uploadedBy, type, visibility = 'CLIENT', invoiceId = null } = input;

    logger.info('Creating request draft', { requestId, fileName: file.originalname, uploadedBy, type, visibility });

    // Ensure request exists and admin can act
    const request = await RequestsService.getRequestById(requestId);
    if (!request) throw new Error('Request not found');

    // Generate unique filename and path
    const ext = (file.originalname || 'draft.pdf').split('.').pop() || 'pdf';
    const uniqueName = `${uuidv4()}.${ext}`;
    const storagePath = `${requestId}/${uniqueName}`;

    // Upload to supabase storage (private bucket)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(DRAFTS_BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: true });

    if (uploadError) {
      logger.error('Failed to upload draft to storage', { uploadError });
      throw new Error('Failed to upload draft');
    }

    // Persist draft metadata
    const draftId = uuidv4();
    const insertPayload: any = {
      id: draftId,
      request_id: requestId,
      uploaded_by: uploadedBy,
      issued_by: uploadedBy,
      file_name: file.originalname,
      file_path: storagePath,
      type, // Save the type if provided
      visibility // Save the visibility if provided
    };
    // If an invoice id is provided, link the draft to the invoice (document vs business data separation)
    if (invoiceId) insertPayload.invoice_id = invoiceId;

    const { data: inserted, error: dbError } = await supabase
      .from('request_drafts')
      .insert(insertPayload)
      .select()
      .single();

    if (dbError || !inserted) {
      // cleanup storage
      await supabase.storage.from(DRAFTS_BUCKET).remove([storagePath]).catch(() => null);
      logger.error('Failed to persist draft metadata', { dbError });
      throw new Error('Failed to save draft metadata');
    }

    return inserted as RequestDraft;
  }

  // Get draft by id (does not return signed url)
  static async getDraftById(draftId: string): Promise<RequestDraft> {
    const { data: draft, error } = await supabase
      .from('request_drafts')
      .select('*')
      .eq('id', draftId)
      .single();

    if (error || !draft) throw new Error('Draft not found');
    return draft as RequestDraft;
  }

  // Get drafts by request id
  static async getDraftsByRequestId(requestId: string): Promise<RequestDraft[]> {
    const { data: drafts, error } = await supabase
      .from('request_drafts')
      .select('*')
      .eq('request_id', requestId);

    if (error) throw new Error('Failed to query drafts');
    return (drafts || []) as RequestDraft[];
  }

  // Generate a short-lived signed URL for a draft
  static async generateSignedUrl(draftId: string, expiresInSec = 60 * 10) {
    const draft = await this.getDraftById(draftId);
    if (!draft || !draft.file_path) throw new Error('Draft file path not found');

    const { data: signData, error: signErr } = await supabase.storage
      .from(DRAFTS_BUCKET)
      .createSignedUrl(draft.file_path, expiresInSec);

    if (signErr || !signData?.signedUrl) {
      logger.error('Failed to create signed url for draft', { draftId, signErr });
      throw new Error('Failed to generate signed url');
    }

    return signData.signedUrl as string;
  }
}
