// modules/requests/requests.service.ts
import { supabase } from '../../config/supabase';
import { logger } from '../../utils/logger';
import {
  RequestStatus,
  ActorRole,
  assertTransitionAllowed,
  isFinalState
} from './request.state-machine';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from '../audit/audit.service';

// ===============================
// TYPES
// ===============================
export interface CreateRequestInput {
  userId: string;
  type: 'FERI_ONLY' | 'AD_ONLY' | 'FERI_AND_AD';
  ref?: string | null;
  fxi_number?: string | null;
  feri_number?: string | null;
  vehicle_registration?: string | null;
  manual_bl?: string | null;
  carrier_name?: string | null;
  transport_road_amount?: number | null;
  transport_river_amount?: number | null;
}

export interface TransitionInput {
  requestId: string;
  to: RequestStatus;
  actorRole: ActorRole;
  actorId: string;
}

// ===============================
// REQUEST SERVICE
// ===============================
export class RequestsService {
  // ===============================
  // CREATE REQUEST
  // ===============================
  static async createRequest(input: CreateRequestInput) {
    logger.info('Creating new request', { input });

    // Business rule: AD_ONLY requests require a FERI number provided by the client
    if (input.type === 'AD_ONLY') {
      if (!input.feri_number || (typeof input.feri_number === 'string' && input.feri_number.trim() === '')) {
        throw new Error('Les demandes AD nécessitent un numéro FERI (feri_number) dans le payload.');
      }
    } else {
      // FERI_ONLY and FERI_AND_AD do NOT require an existing FERI
      logger.info('Request type does not require existing FERI', { type: input.type, userId: input.userId });
    }

    const insertObj: any = {
      id: uuidv4(),
      user_id: input.userId,
      type: input.type,
      // For AD-only requests we start in PROCESSING to reflect immediate AD work
      status: input.type === 'AD_ONLY' ? 'PROCESSING' : 'CREATED'
    };

    if (input.ref) insertObj.ref = input.ref;
    if (input.fxi_number) insertObj.fxi_number = input.fxi_number;
    if (input.feri_number) insertObj.feri_number = input.feri_number;
    if (input.vehicle_registration) insertObj.vehicle_registration = input.vehicle_registration;
    if (input.manual_bl) insertObj.manual_bl = input.manual_bl;
    if (typeof input.carrier_name !== 'undefined' && input.carrier_name !== null) insertObj.carrier_name = input.carrier_name;
    if (typeof input.transport_road_amount !== 'undefined' && input.transport_road_amount !== null) insertObj.transport_road_amount = input.transport_road_amount;
    if (typeof input.transport_river_amount !== 'undefined' && input.transport_river_amount !== null) insertObj.transport_river_amount = input.transport_river_amount;
    // For AD_ONLY requests, use the provided feri_number as the temporary BL display value
    if (input.type === 'AD_ONLY' && input.feri_number) {
      insertObj.bl_number = input.feri_number;
    }
    // If client supplied manual BL explicitly, use it as display BL when no other BL set
    if (!insertObj.bl_number && input.manual_bl) {
      insertObj.bl_number = input.manual_bl;
    }

    const { data, error } = await supabase
      .from('requests')
      .insert(insertObj)
      .select()
      .single();

    if (error || !data) {
      logger.error('Failed to create request', { error });
      throw new Error('Unable to create request');
    }

    logger.info('Request created', { requestId: data.id });
      // If this request was created in PROCESSING (AD_ONLY), notify the client about the status
      try {
        if (insertObj.status === 'PROCESSING') {
          (async () => {
            try {
              const { NotificationsService } = await import('../notifications/notifications.service');
              await NotificationsService.send({
                userId: data.user_id,
                type: 'REQUEST_STATUS_CHANGED',
                title: 'Votre demande est en cours de traitement',
                message: `Votre demande ${data.id} est en cours de traitement (PROCESSING).`,
                entityType: 'request',
                entityId: data.id,
                channels: ['in_app', 'email'],
                status: 'PROCESSING',
                date: new Date().toISOString(),
                admin_dashboard_url: process.env.ADMIN_DASHBOARD_URL || undefined
              });
            } catch (e) {
              logger.warn('Failed to send initial PROCESSING notification', { requestId: data.id, e });
            }
          })();
        }
      } catch (e) {
        logger.warn('Error while scheduling initial notification', { requestId: data.id, e });
      }

      return data;
  }

  // ===============================
  // LIST REQUESTS (ADMIN)
  // ===============================
  static async listRequests(filters: { status?: string; type?: string; userId?: string }) {
    logger.info('Listing requests (admin)', { filters });

    let query = supabase
      .from('requests')
      .select(`
        *,
        profiles (
          id,
          nom,
          prenom,
          email
        )
      `);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.type) query = query.eq('type', filters.type);
    if (filters.userId) query = query.eq('user_id', filters.userId);

    query = query.order('created_at', { ascending: false }).limit(100);

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to list requests', { error });
      throw new Error('Failed to list requests');
    }

    const rows = (data || []);

    // Debug logs to help trace missing client names in admin UI
    try {
      logger.info('DEBUG listRequests count', { count: Array.isArray(rows) ? rows.length : 0 });
      if (Array.isArray(rows) && rows.length > 0) {
        const sample = rows.slice(0, 3).map((r: any) => ({
          id: r.id,
          user_id: r.user_id,
          profiles: Array.isArray(r.profiles) ? r.profiles.map((p: any) => ({ id: p.id, prenom: p.prenom, nom: p.nom, email: p.email })) : r.profiles,
          prenom: r.prenom,
          nom: r.nom,
          email: r.email
        }));
        logger.info('DEBUG listRequests sampleProfiles', { sample });
      }
    } catch (e) {
      logger.warn('Failed to emit debug logs for listRequests', { err: (e as any)?.message ?? String(e) });
    }

    // If there are results, enrich them with latest COMPLETED feri_deliveries.feri_ref where available
    try {
      const ids = rows.map((r: any) => r.id).filter(Boolean);
      if (ids.length > 0) {
        const { data: deliveries, error: dErr } = await supabase
          .from('feri_deliveries')
          .select('request_id, feri_ref, pdf_url, status, delivered_at')
          .in('request_id', ids)
          .eq('status', 'COMPLETED')
          .order('delivered_at', { ascending: false });

        if (!dErr && Array.isArray(deliveries) && deliveries.length > 0) {
          const latestByRequest: Record<string, any> = {};
          for (const d of deliveries) {
            if (!latestByRequest[d.request_id]) latestByRequest[d.request_id] = d;
          }

          // Prepare signed URLs for any pdf_url present (best-effort)
          const bucket = 'feri_documents';

          // collect tasks
          const signTasks: Array<Promise<void>> = [];

          for (const r of rows) {
            const found = latestByRequest[r.id];
            if (found) {
              if (found.feri_ref) r.feri_ref = found.feri_ref;
              if (found.pdf_url) {
                // create a closure task to generate signed url
                signTasks.push((async () => {
                  try {
                    const path = found.pdf_url;
                    const { data: signed, error: signedErr } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
                    if (!signedErr && signed && (signed as any).signedUrl) {
                      r.feri_signed_url = (signed as any).signedUrl;
                    } else {
                      logger.warn('Failed to create signed url for request feri_delivery', { requestId: r.id, path, err: signedErr });
                    }
                  } catch (e) {
                    logger.warn('Exception when creating signed url for feri_delivery', { err: (e as any)?.message ?? String(e), requestId: r.id });
                  }
                })());
              }
            }
          }

          // await all signing tasks but do not fail listing on failures
          if (signTasks.length > 0) {
            try { await Promise.all(signTasks); } catch (e) { logger.warn('One or more signed url tasks failed', { err: (e as any)?.message ?? String(e) }); }
          }
        }
      }
    } catch (e) {
      // best-effort: do not fail the whole request listing if enrichment fails
      logger.warn('Failed to enrich requests with feri_deliveries', { err: (e as any)?.message ?? String(e) });
    }

    // Enrich with payment_mode from latest invoice if available
    try {
      const ids = rows.map((r: any) => r.id).filter(Boolean);
      if (ids.length > 0) {
        const { data: invoices, error: invErr } = await supabase
          .from('invoices')
          .select('request_id, payment_mode')
          .in('request_id', ids)
          .order('created_at', { ascending: false });

        if (!invErr && Array.isArray(invoices) && invoices.length > 0) {
          const latestByRequest: Record<string, string> = {};
          for (const inv of invoices) {
            if (!latestByRequest[inv.request_id] && inv.payment_mode) {
              latestByRequest[inv.request_id] = inv.payment_mode;
            }
          }

          for (const r of rows) {
            if (latestByRequest[r.id]) {
              r.payment_mode = latestByRequest[r.id];
            }
          }
        }
      }
    } catch (e) {
      logger.warn('Failed to enrich requests with payment_mode from invoices', { err: (e as any)?.message ?? String(e) });
    }

    return rows;
  }

  // ===============================
  // GET REQUEST BY ID (ADMIN)
  // ===============================
  static async getRequestById(requestId: string) {
    logger.info('Fetching request by id (admin)', { requestId });

    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (error || !data) {
      logger.error('Request not found', { requestId, error });
      throw new Error('Request not found');
    }

    return data;
  }

  // ===============================
  // UPDATE REQUEST (CLIENT)
  // Only allows clients to update non-protected fields such as `manual_bl` for their own requests.
  // ===============================
  static async updateRequest(requestId: string, userId: string, changes: { manual_bl?: string | null }) {
    logger.info('Updating request (client)', { requestId, userId, changes });

    // Ensure request exists and belongs to the user
    const { data: existing, error: fetchErr } = await supabase
      .from('requests')
      .select('id, user_id, status')
      .eq('id', requestId)
      .single();

    if (fetchErr || !existing) {
      logger.warn('Request not found for update', { requestId, fetchErr });
      throw new Error('Request not found');
    }

    if (String(existing.user_id) !== String(userId)) {
      logger.warn('User attempted to update request they do not own', { requestId, userId });
      throw new Error('Forbidden');
    }

    // Do not allow updating if request is in a final state
    try {
      if (isFinalState(existing.status as any)) {
        throw new Error('Cannot update request in final state');
      }
    } catch (e) {
      // If status is unknown to isFinalState, allow update path to proceed cautiously
    }

    const upd: any = {};
    if (typeof changes.manual_bl !== 'undefined') {
      upd.manual_bl = changes.manual_bl;
      // When client provides a manual BL, persist it as the display BL as well
      // so downstream logic treats it the same as an extracted BL.
      if (changes.manual_bl && String(changes.manual_bl).trim() !== '') {
        upd.bl_number = String(changes.manual_bl).trim();
        // clear confidence since this is a manual entry
        upd.bl_confidence = null;
      }
    }

    if (Object.keys(upd).length === 0) return existing;

    const { data: updated, error: updateErr } = await supabase
      .from('requests')
      .update(upd)
      .eq('id', requestId)
      .select('*')
      .single();

    if (updateErr || !updated) {
      logger.error('Failed to update request', { requestId, updateErr });
      throw new Error('Unable to update request');
    }

    // Persist audit entry (best-effort)
    try {
      await AuditService.log({
        actor_id: userId,
        action: 'UPDATE_REQUEST',
        entity: 'request',
        entity_id: requestId,
        metadata: { changes: Object.keys(upd) }
      });
    } catch (e) {
      logger.warn('Failed to write audit log for updateRequest', { e });
    }

    // If a manual BL was provided, attempt to transition the request to PROCESSING
    if (typeof changes.manual_bl !== 'undefined' && changes.manual_bl && String(changes.manual_bl).trim() !== '') {
      try {
        // Try to perform the same SYSTEM-driven transition as the OCR flow
        await RequestsService.transitionStatus({ requestId, to: 'PROCESSING', actorRole: 'SYSTEM', actorId: 'system' });
      } catch (transErr) {
        logger.warn('RequestsService.transitionStatus failed for manual_bl; falling back to forceUpdateStatus', { requestId, err: transErr });
        try {
          await RequestsService.forceUpdateStatus(requestId, 'PROCESSING');
        } catch (forceErr) {
          logger.error('Failed to force-update request to PROCESSING after manual_bl update', { requestId, err: forceErr });
        }
      }
    }

    return updated;
  }

  // ===============================
  // FORCE UPDATE STATUS (ADMIN)
  // ===============================
  static async forceUpdateStatus(requestId: string, status: string, opts: { notifyClient?: boolean } = { notifyClient: true }) {
    logger.warn('Force updating request status (admin)', { requestId, status, notifyClient: opts.notifyClient });

    // Read current status first to avoid sending duplicate notifications when status is unchanged
    let currentStatus: string | null = null;
    try {
      const { data: cur, error: curErr } = await supabase.from('requests').select('status').eq('id', requestId).single();
      if (!curErr && cur) currentStatus = cur.status;
    } catch (e) {
      logger.warn('Failed to read current status before forceUpdateStatus', { requestId, e });
    }

    const { data, error } = await supabase
      .from('requests')
      .update({ status })
      .eq('id', requestId)
      .select('*')
      .single();

    if (error || !data) {
      logger.error('Failed to force update status', { requestId, status, error });
      throw new Error('Failed to update request status');
    }

    // Notify user (best-effort) for forced updates
    (async () => {
      try {
        const { NotificationsService } = await import('../notifications/notifications.service');
        const clientId = data.user_id;

        // Try to resolve client profile (best-effort)
        let client_name: string | undefined;
        let client_email: string | undefined;
        try {
          const prof = await supabase.from('profiles').select('prenom,email').eq('id', clientId).single();
          client_name = prof.data?.prenom;
          client_email = prof.data?.email;
        } catch (e) {
          logger.warn('Failed to load client profile for forced update notification', { e, clientId });
        }

        // Only send notification if the status actually changed and caller allows it
        if (currentStatus !== status) {
          if (opts.notifyClient === false) {
            logger.info('Skipping forced REQUEST_STATUS_CHANGED because notifyClient=false', { requestId, status });
          } else {
            await NotificationsService.send({
              userId: clientId,
              type: 'REQUEST_STATUS_CHANGED',
              title: `Request status updated to ${status}`,
              message: `Your request ${requestId} status was set to ${status}`,
              entityType: 'request',
              entityId: requestId,
              channels: ['in_app', 'email'],
              // Admin template fields
              client_name,
              client_email,
              status,
              date: new Date().toISOString(),
              admin_dashboard_url: process.env.ADMIN_DASHBOARD_URL
            });
          }
        } else {
          logger.info('Skipping notification in forceUpdateStatus because status did not change', { requestId, status });
        }
      } catch (e) {
        logger.warn('Failed to send notification for forced status update', { requestId, status, err: e });
      }
    })();

    return data;
  }

  // ===============================
  // TRANSITION STATUS
  // ===============================
  static async transitionStatus(input: TransitionInput) {
    const { requestId, to, actorRole, actorId } = input;

    logger.info('Request status transition attempt', {
      requestId,
      to,
      actorRole
    });

    // 🔍 Fetch current state
    const { data: request, error } = await supabase
      .from('requests')
      .select('status')
      .eq('id', requestId)
      .single();

    if (error || !request) {
      logger.error('Request not found', { requestId });
      throw new Error('Request not found');
    }

    const from = request.status as RequestStatus;
    if (isFinalState(from)) {
      throw new Error('Request is in a final state');
    }

    // If the request already has the desired status, nothing to do (avoid duplicate notifications)
    if (from === to) {
      logger.info('Status transition no-op (already at target)', { requestId, status: to });
      return request as any; // return current record
    }

    // 🔒 Rule enforcement
    assertTransitionAllowed(from, to, actorRole);

    // 🔄 Perform update: do NOT rely on DB-side status filtering.
    // Business rules are enforced above via `assertTransitionAllowed(from, to, actorRole)`.
    const { data: updated, error: updateError } = await supabase
      .from('requests')
      .update({ status: to })
      .eq('id', requestId)
      .select('*')
      .single();

    if (updateError || !updated) {
      // Provide clearer diagnostics for common Postgres enum errors
      if (updateError && (updateError as any).code === '22P02') {
        logger.error('Supabase update failed invalid input value for enum', { updateError, attemptedStatus: to });
        throw new Error(`Database does not accept status value '${to}'. Add this value to the request_status enum in the DB.`);
      }

      logger.error('Status transition failed', { updateError });
      throw new Error('Unable to transition request');
    }

    logger.info('Request status updated', { requestId, from, to });

    // Write an audit entry (best-effort)
    try {
      await AuditService.log({
        actor_id: actorId,
        action: `TRANSITION_${from}_TO_${to}`,
        entity: 'request',
        entity_id: requestId,
        metadata: { from, to, actorRole }
      });
    } catch (e) {
      logger.warn('Failed to persist audit log for transition', { e });
    }

    // Notify user (best-effort) — dynamic import to avoid circular deps
    (async () => {
      try {
        const { NotificationsService } = await import('../notifications/notifications.service');

        // Resolve client id and profile separately and do not fail the notification if Supabase errors
        let clientId: string | undefined;
        let client_name: string | undefined;
        let client_email: string | undefined;

        if (actorRole === 'CLIENT') {
          clientId = actorId;
        } else {
          try {
                const resp = await supabase.from('requests').select('user_id').eq('id', requestId).single();
                clientId = resp.data?.user_id;
          } catch (e) {
                logger.warn('Failed to resolve user_id for notification (supabase)', { e, requestId });
          }
        }

        if (clientId) {
          try {
            const prof = await supabase.from('profiles').select('prenom,email').eq('id', clientId).single();
            client_name = prof.data?.prenom;
            client_email = prof.data?.email;
          } catch (e) {
            logger.warn('Failed to fetch client profile for notification', { e, clientId });
          }
        }

        // Only notify clients about generic status changes when the status becomes
        // PROCESSING or when the actor is the client. Admin/internal flows that
        // change status to other values (e.g. UNDER_REVIEW, DRAFT_SENT) should
        // use specialized events (e.g. CLIENT_DRAFT_AVAILABLE) to avoid duplicate
        // generic "status changed" emails to the client.
        const shouldNotifyClientStatusChange = (to === 'PROCESSING') || actorRole === 'CLIENT';

        if (shouldNotifyClientStatusChange) {
          // Prefer specific event types for some statuses so clients receive
          // dedicated templates (e.g. PAYMENT_PROOF_UPLOADED) instead of the
          // generic REQUEST_STATUS_CHANGED template that prints the raw status.
          const eventType = (to === 'PAYMENT_PROOF_UPLOADED') ? 'PAYMENT_PROOF_UPLOADED' : 'REQUEST_STATUS_CHANGED';
          await NotificationsService.send({
            userId: clientId ?? '',
            type: eventType,
            title: `Request status updated to ${to}`,
            message: `Your request ${requestId} status changed from ${from} to ${to}`,
            entityType: 'request',
            entityId: requestId,
            channels: ['in_app', 'email'],
            client_name,
            client_email,
            status: to,
            date: new Date().toISOString(),
            admin_dashboard_url: process.env.ADMIN_DASHBOARD_URL
          });
        } else {
          logger.info('Skipping generic REQUEST_STATUS_CHANGED client email for admin/internal non-PROCESSING transition', { requestId, from, to, actorRole });
        }
      } catch (e) {
        logger.error('Failed to send notification for status transition', { 
          e: e instanceof Error ? e.message : JSON.stringify(e),
          requestId,
          stack: e instanceof Error ? e.stack : undefined
        });
      }
    })();

    // Additional client-targeted emails for key statuses (do not impact admin emails)
    (async () => {
      try {
        const { NotificationsService } = await import('../notifications/notifications.service');

        // Resolve clientId locally to avoid relying on outer async IIFE state
        let clientIdLocal: string | undefined;
        try {
          if (actorRole === 'CLIENT') {
            clientIdLocal = actorId;
          } else {
            const resp = await supabase.from('requests').select('user_id').eq('id', requestId).single();
            clientIdLocal = resp.data?.user_id;
          }
        } catch (e) {
          logger.warn('Failed to resolve client id for client-targeted notifications', { e, requestId });
        }

        if (!clientIdLocal) return;

        const important = ['DRAFT_SENT', 'PAYMENT_CONFIRMED', 'COMPLETED'];
        if (!important.includes(String(to))) return;

        let title = '';
        let message = '';
        let eventType = '';

        switch (String(to)) {
          case 'DRAFT_SENT':
            eventType = 'CLIENT_DRAFT_AVAILABLE';
            title = 'Draft FERI disponible';
            message = 'Votre draft FERI est disponible. Connectez‑vous à votre espace pour le consulter et procéder au paiement.';
            break;
          case 'PAYMENT_CONFIRMED':
            eventType = 'CLIENT_PAYMENT_CONFIRMED';
            title = 'Paiement confirmé';
            message = 'Votre paiement a été confirmé par l\'administration. La génération des documents finaux est en cours.';
            break;
          case 'COMPLETED':
            eventType = 'CLIENT_FERI_ISSUED';
            title = 'FERI final disponible';
            message = 'Le FERI officiel final est disponible. Vous pouvez le télécharger depuis votre espace.';
            break;
          default:
            return;
        }

        // For COMPLETED status, attach the final document to the email
        let attachments: Array<{ name: string; mime: string; base64: string }> = [];
        if (String(to) === 'COMPLETED') {
          try {
            const { data: delivery, error: deliveryErr } = await supabase
              .from('feri_deliveries')
              .select('pdf_url, file_name')
              .eq('request_id', requestId)
              .eq('status', 'COMPLETED')
              .order('delivered_at', { ascending: false })
              .limit(1)
              .single();

            if (delivery && delivery.pdf_url) {
              const bucket = 'feri_documents';
              const filePath = delivery.pdf_url;
              const fileName = delivery.file_name || 'document.pdf';

              const { data: fileBuffer, error: downloadErr } = await supabase.storage
                .from(bucket)
                .download(filePath);

              if (fileBuffer && !downloadErr) {
                const arrayBuffer = await (fileBuffer as any).arrayBuffer();
                const base64Content = Buffer.from(arrayBuffer).toString('base64');
                attachments.push({
                  name: fileName,
                  mime: 'application/pdf',
                  base64: base64Content
                });
              } else {
                logger.warn('Failed to download final document for attachment', { requestId, filePath, downloadErr });
              }
            }
          } catch (e) {
            logger.warn('Error preparing final document attachment', { requestId, e: e instanceof Error ? e.message : String(e) });
          }
        }

        await NotificationsService.send({
          userId: clientIdLocal,
          type: eventType,
          title,
          message,
          entityType: 'request',
          entityId: requestId,
          channels: ['in_app', 'email'],
          attachments: attachments.length > 0 ? attachments : undefined
        });
      } catch (e) {
        logger.error('Failed to send client targeted notification', { 
          e: e instanceof Error ? e.message : JSON.stringify(e),
          requestId, 
          to,
          stack: e instanceof Error ? e.stack : undefined
        });
      }
    })();

    return { requestId, status: to };
  }

  // ===============================
  // CHECK IF CLIENT CAN SUBMIT
  // ===============================
  static async canClientSubmit(requestId: string, clientId: string): Promise<boolean> {
    // Fetch request
    const { data: request, error } = await supabase
      .from('requests')
      .select('id, user_id, status, type')
      .eq('id', requestId)
      .single();

    if (error || !request) {
      throw new Error('Request not found');
    }

    if (request.user_id !== clientId) {
      throw new Error('Access denied: not the owner of the request');
    }

    // Only allow from CREATED or AWAITING_DOCUMENTS
    if (!['CREATED', 'AWAITING_DOCUMENTS'].includes(request.status)) {
      throw new Error(`Cannot submit request when status is: ${request.status}`);
    }

    // Require at least one uploaded document
    const { data: docs, error: docsErr, count } = await supabase
      .from('documents')
      .select('id', { count: 'exact' })
      .eq('request_id', requestId);

    if (docsErr) {
      logger.warn('Failed to check documents for submit', { docsErr });
      throw new Error('Unable to validate documents');
    }

    if (!docs || (count || 0) === 0) {
      throw new Error('At least one document must be uploaded before submitting');
    }

    return true;
  }
}
