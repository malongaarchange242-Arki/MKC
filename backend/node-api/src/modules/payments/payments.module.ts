import express, { Request, Response } from 'express';
import { PaymentsService } from './payments.service';
import { uploadMiddleware } from '../../middlewares/upload.middleware';
import supabaseAdmin from '../../config/supabaseAdmin';
import { RequestsService } from '../requests/requests.service';
import { v4 as uuidv4 } from 'uuid';

export const paymentsModule = () => {
  const router = express.Router();
  const service = new PaymentsService();

  // GET /api/client/invoices
  // Optional query params: request_id, bl_number
  router.get('/invoices', async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any).authUserId ?? null;
      const { request_id, bl_number } = req.query;

      const { data, error } = await service.getInvoices({
        userId: authUserId,
        request_id: request_id as string | undefined,
        bl_number: bl_number as string | undefined
      });

      if (error) {
        return res.status(500).json({ success: false, error });
      }

      return res.json({ success: true, invoices: data ?? [] });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message ?? String(err) });
    }
  });

  // POST /api/client/invoices/:requestId/proofs
  // multipart/form-data -> field 'file'
  router.post('/invoices/:requestId/proofs', uploadMiddleware.single('file'), async (req: Request, res: Response) => {
    try {
      const authUserId = (req as any).authUserId ?? null;
      const { requestId } = req.params;

      if (!requestId) return res.status(400).json({ success: false, message: 'requestId required' });
      if (!req.file) return res.status(400).json({ success: false, message: 'file required' });

      // preserve extension if possible
      const documentId = uuidv4();
      const origName = req.file.originalname || 'proof.pdf';
      const ext = (origName.includes('.') ? origName.split('.').pop() : 'pdf') || 'pdf';
      const storagePath = `${requestId}/${documentId}.${ext}`;

      // Step 1: create a documents record (metadata) before uploading the file
      const docPayload: any = {
        id: documentId,
        request_id: requestId,
        file_name: origName,
        file_path: storagePath,
        file_size: req.file.size || (req.file.buffer ? req.file.buffer.length : null),
        mime_type: req.file.mimetype || 'application/octet-stream',
        version: 1,
        uploaded_by: authUserId,
        uploaded_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      };

      const { data: docInserted, error: docError } = await supabaseAdmin
        .from('documents')
        .insert(docPayload)
        .select()
        .single();

      if (docError || !docInserted) {
        return res.status(500).json({ success: false, message: 'Failed to create document record', error: docError });
      }

      // Step 2: upload to Supabase storage
      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from('payment_proofs')
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

      if (uploadError) {
        // rollback document record
        await supabaseAdmin.from('documents').delete().eq('id', documentId).catch(() => null);
        return res.status(500).json({ success: false, message: 'Storage upload failed', error: uploadError });
      }

      // Step 3: insert into payment_proofs linking to the document
      const proofId = uuidv4();
      const insertPayload: any = {
        id: proofId,
        request_id: requestId,
        document_id: documentId,
        uploaded_by: authUserId,
        status: 'PAYMENT_PROOF_UPLOADED',
        validated_by: null,
        validated_at: null,
        created_at: new Date().toISOString()
      };

      const { data: inserted, error: dbError } = await supabaseAdmin
        .from('payment_proofs')
        .insert(insertPayload)
        .select()
        .single();

      if (dbError || !inserted) {
        // rollback storage and document record
        await supabaseAdmin.storage.from('payment_proofs').remove([storagePath]).catch(() => null);
        await supabaseAdmin.from('documents').delete().eq('id', documentId).catch(() => null);
        return res.status(500).json({ success: false, message: 'DB insert failed', error: dbError });
      }

      // Step 4: transition request status to PAYMENT_PROOF_UPLOADED
      try {
        await RequestsService.transitionStatus({
          requestId,
          to: 'PAYMENT_PROOF_UPLOADED',
          actorRole: 'CLIENT',
          actorId: authUserId
        });
      } catch (transitionErr: any) {
        // rollback payment_proofs, storage and document
        await supabaseAdmin.from('payment_proofs').delete().eq('id', proofId).catch(() => null);
        await supabaseAdmin.storage.from('payment_proofs').remove([storagePath]).catch(() => null);
        await supabaseAdmin.from('documents').delete().eq('id', documentId).catch(() => null);
        return res.status(500).json({ success: false, message: 'Failed to transition request status', error: transitionErr?.message ?? String(transitionErr) });
      }

      return res.json({ success: true, proof: inserted, document: docInserted });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message || String(err) });
    }
  });

  return router;
};

export default paymentsModule;
export class PaymentsModule {}