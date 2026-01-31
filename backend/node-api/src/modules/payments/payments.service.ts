import supabaseAdmin from '../../config/supabaseAdmin';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';

export class PaymentsService {

  // ---------------------------------------------------------------------------
  // Generate next invoice number (shared)
  // ---------------------------------------------------------------------------
  async generateNextInvoiceNumber(): Promise<string> {
    const { data: allInvs, error: allErr } = await supabaseAdmin
      .from('invoices')
      .select('invoice_number')
      .ilike('invoice_number', `MKC-INV-%`);

    if (allErr) {
      throw allErr;
    }

    let maxSuffix = 0;
    (allInvs || []).forEach((r: any) => {
      const inv = String(r.invoice_number || '');
      const m = inv.match(/(\d+)$/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (!Number.isNaN(num) && num > maxSuffix) maxSuffix = num;
      }
    });

    const next = maxSuffix + 1;
    return `MKC-INV-${String(next).padStart(3, '0')}`;
  }


  // ---------------------------------------------------------------------------
  // LIST INVOICES (Dashboard)
  // ---------------------------------------------------------------------------
  async getInvoices(filters: {
    userId?: string | null;
    request_id?: string | null;
    bl_number?: string | null;
  }) {
    const { userId, request_id, bl_number } = filters || {};

    try {
      // Read authoritative invoices table and join requests to get BL and owner
      const { data, error } = await supabaseAdmin
        .from('invoices')
        .select(`id, invoice_number, total_amount, subtotal_amount, service_fee_amount, currency, cargo_route, status, created_at, request_id, requests ( bl_number, user_id )`)
        .order('created_at', { ascending: false });

      if (error) return { data: null, error };

      const mapped = (data || [])
        .map((row: any) => {
          const bl = row.requests?.bl_number ?? null;
          const owner = row.requests?.user_id ?? null;
          return {
            id: row.id,
            request_id: row.request_id,
            invoice_number: row.invoice_number,
            bl_number: bl,
            cargo_route: row.cargo_route || null,
            client_id: owner,
            amount_due: row.total_amount,
            currency: row.currency,
            status: row.status,
            created_at: row.created_at
          };
        })
        .filter((inv: any) => {
          // filter by request_id, bl_number or owner (userId) if provided
          if (request_id) return String(inv.request_id) === String(request_id);
          if (bl_number) return inv.bl_number === bl_number;
          if (userId) return String(inv.client_id) === String(userId);
          return true;
        });

      return { data: mapped, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  // ---------------------------------------------------------------------------
  // CREATE INVOICE (CLICK $1500)
  // ---------------------------------------------------------------------------
  async createInvoice(input: {
    request_id: string;
    amount: number | string;
    currency?: string;
    customer_reference?: string | null;
    cargo_route?: string | null;
    created_by?: string | null;
    client_name?: string | null;
    objet?: string | null;
    origin?: string | null;
    subtotal_amount?: number | null;
    service_fee_amount?: number | null;
    invoice_date?: string | null;
    items?: Array<any>;
  }) {
    try {
      const { request_id, amount, currency = 'USD', customer_reference, cargo_route = null, created_by, client_name = null, objet = null, origin = null, subtotal_amount = null, service_fee_amount = null, invoice_date = null, items = undefined } = input;

      // Log input for debugging
      logger.info('Creating invoice with input:', input);

      // 1️⃣ Charger la requête (SOURCE DE VÉRITÉ)
      const { data: reqData, error: reqErr } = await supabaseAdmin
        .from('requests')
        .select('id, user_id, bl_number, extracted_bl, manual_bl, bill_of_lading')
        .eq('id', request_id)
        .single();

      if (reqErr || !reqData) {
        logger.error('Error fetching request:', reqErr || 'Request not found');
        return { data: null, error: new Error('Request not found') };
      }

      // Prefer canonical bl_number but fall back to extracted or manual BL when available
      const bill_of_lading = reqData.bl_number || reqData.extracted_bl || reqData.manual_bl || reqData.bill_of_lading || null;
      if (!bill_of_lading) {
        logger.error('BL number missing on request (no bl_number/extracted_bl/manual_bl):', reqData);
        return { data: null, error: new Error('BL number missing on request') };
      }

      const client_id = reqData.user_id;

      // 2️⃣ Idempotence: do not rely on a specific status; find any existing invoice for this request
      const { data: existing } = await supabaseAdmin
        .from('invoices')
        .select('*')
        .eq('request_id', request_id)
        .limit(1)
        .maybeSingle();

      if (existing) {
        // Update total_amount/currency/cargo_route and set status to DRAFT
        const updatePayload: any = { total_amount: Number(amount), currency, cargo_route: cargo_route || existing.cargo_route || null, status: 'DRAFT' };
        if (client_name) updatePayload.client_name = client_name;
        if (objet) updatePayload.objet = objet;
        if (origin) updatePayload.origin = origin;
        if (subtotal_amount !== null && subtotal_amount !== undefined) updatePayload.subtotal_amount = Number(subtotal_amount);
        if (service_fee_amount !== null && service_fee_amount !== undefined) updatePayload.service_fee_amount = Number(service_fee_amount);
        if (invoice_date) updatePayload.invoice_date = invoice_date;

        const { data: updated, error: updErr } = await supabaseAdmin
          .from('invoices')
          .update(updatePayload)
          .eq('id', existing.id)
          .select()
          .single();

        if (updErr) {
          logger.error('Failed to update existing invoice during createInvoice', { request_id, error: updErr });
          return { data: null, error: updErr };
        }

        // If items provided, replace existing invoice_items for this invoice
        try {
          if (Array.isArray(items) && items.length > 0) {
            await supabaseAdmin.from('invoice_items').delete().eq('invoice_id', existing.id);
            const itemsToInsert = (items || []).map((it: any, i: number) => ({
              id: uuidv4(),
              invoice_id: existing.id,
              description: it.description || null,
              bl_number: it.bl_number || null,
              packaging: it.packaging || null,
              unit_price: it.unit_price !== undefined && it.unit_price !== null ? Number(it.unit_price) : null,
              quantity: it.quantity !== undefined && it.quantity !== null ? Number(it.quantity) : null,
              line_total: it.line_total !== undefined && it.line_total !== null ? Number(it.line_total) : null,
              position: it.position !== undefined && it.position !== null ? Number(it.position) : (i + 1),
              created_at: new Date().toISOString()
            }));
            if (itemsToInsert.length > 0) {
              await supabaseAdmin.from('invoice_items').insert(itemsToInsert);
            }
          }
        } catch (e) {
          logger.warn('Failed to persist invoice items on update', { err: (e as any)?.message ?? String(e) });
        }

        return { data: updated, error: null };
      }

      // 3️⃣ Génération Invoice Number (format requested: MKC-INV-001)

      // 4️⃣ Insertion with retry on invoice_number unique constraint (race protection)
      const baseInsertObj = {
        id: uuidv4(),
        request_id,
        client_id,
        source: 'REQUEST',
        total_amount: Number(amount),
        client_name: client_name || null,
        objet: objet || null,
        origin: origin || null,
        subtotal_amount: subtotal_amount !== null && subtotal_amount !== undefined ? Number(subtotal_amount) : null,
        service_fee_amount: service_fee_amount !== null && service_fee_amount !== undefined ? Number(service_fee_amount) : null,
        currency,
        cargo_route: cargo_route || null,
        bill_of_lading,              
        customer_reference: customer_reference || null,
        status: 'DRAFT',
        created_by: created_by || null,
        created_at: new Date().toISOString()
      } as any;

      const maxAttempts = 5;
      let inserted: any = null;

      // compute a base candidate and allow incremental retries
      let baseCandidateNum = null as number | null;
      try {
        const baseStr = await this.generateNextInvoiceNumber();
        const m = String(baseStr).match(/(\d+)$/);
        baseCandidateNum = m ? parseInt(m[1], 10) : null;
      } catch (e) {
        logger.error('Failed to compute base invoice number', { error: e });
        return { data: null, error: e };
      }

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const nextNum = (baseCandidateNum ?? 0) + attempt;
        const candidateInvoiceNumber = `MKC-INV-${String(nextNum).padStart(3, '0')}`;

        const insertObj = { ...baseInsertObj, invoice_number: candidateInvoiceNumber };

        const { data: insData, error: insertErr } = await supabaseAdmin
          .from('invoices')
          .insert(insertObj)
          .select()
          .single();

        if (!insertErr && insData) {
          inserted = insData;
          break;
        }

        // If unique constraint on invoice_number, retry with next candidate
        const isUniqueViolation = insertErr && (String(insertErr.code) === '23505' || String(insertErr.message || '').toLowerCase().includes('duplicate'));
        if (!isUniqueViolation) {
          logger.error('Failed to create invoice', { error: insertErr });
          return { data: null, error: insertErr };
        }

        // otherwise loop and try again
        logger.warn('Invoice number collision, retrying', { candidateInvoiceNumber, attempt });
        // small backoff to reduce tight loop
        await new Promise(r => setTimeout(r, 120 * (attempt + 1)));
      }

      if (!inserted) {
        const err = new Error('Failed to create invoice after retries');
        logger.error('Failed to create invoice after retries', { request_id, error: (err as any).message });
        return { data: null, error: err };
      }

      // Persist items for newly created invoice (if provided)
      try {
        if (Array.isArray(items) && items.length > 0 && inserted && inserted.id) {
          const itemsToInsert = (items || []).map((it: any, i: number) => ({
            id: uuidv4(),
            invoice_id: inserted.id,
            description: it.description || null,
            bl_number: it.bl_number || null,
            packaging: it.packaging || null,
            unit_price: it.unit_price !== undefined && it.unit_price !== null ? Number(it.unit_price) : null,
            quantity: it.quantity !== undefined && it.quantity !== null ? Number(it.quantity) : null,
            line_total: it.line_total !== undefined && it.line_total !== null ? Number(it.line_total) : null,
            position: it.position !== undefined && it.position !== null ? Number(it.position) : (i + 1),
            created_at: new Date().toISOString()
          }));
          if (itemsToInsert.length > 0) {
            await supabaseAdmin.from('invoice_items').insert(itemsToInsert);
          }
        }
      } catch (e) {
        logger.warn('Failed to persist invoice items on insert', { err: (e as any)?.message ?? String(e) });
      }

      return { data: inserted, error: null };

    } catch (err: any) {
      logger.error('Error creating invoice:', err);
      return { data: null, error: err };
    }
  }

  // ---------------------------------------------------------------------------
  // GET INVOICE BY ID (FACTURE HTML / PDF)
  // (existing method below was present; we augment it to include items)

  // ---------------------------------------------------------------------------
  // GET INVOICE BY ID (FACTURE HTML / PDF)
  // ---------------------------------------------------------------------------
  async getInvoiceById(id: string) {
    try {
      const { data, error } = await supabaseAdmin
        .from('invoices')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) return { data: null, error };

      // Charger le profil client
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('id, nom, prenom, email')
        .eq('id', data.client_id)
        .single();

      if (prof) {
        (data as any).profile = prof;
      }

      // Load line items if present
      try {
        const { data: itemsRows, error: itemsErr } = await supabaseAdmin
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', id)
          .order('position', { ascending: true });

        if (!itemsErr && Array.isArray(itemsRows)) {
          (data as any).items = itemsRows;
        }
      } catch (e) {
        // non-fatal
      }

      return { data, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE INVOICE
  // ---------------------------------------------------------------------------
  async updateInvoice(invoiceId: string, updates: { invoice_number?: string; status?: string }) {
    try {
      const { data, error } = await supabaseAdmin
        .from('invoices')
        .update(updates)
        .eq('id', invoiceId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update invoice', { invoiceId, updates, error });
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err: any) {
      logger.error('Unexpected error updating invoice', { invoiceId, updates, error: err });
      return { data: null, error: err };
    }
  }

  // ---------------------------------------------------------------------------
  // CREATE MANUAL INVOICE (ADMIN manual flow)
  // ---------------------------------------------------------------------------
  async createManualInvoice(input: {
    created_by?: string | null;
    client_name?: string | null;
    objet?: string | null;
    origin?: string | null;
    subtotal_amount?: number | null;
    service_fee_amount?: number | null;
    currency?: string;
  }) {
    try {
      const { created_by = null, client_name = null, objet = null, origin = null, subtotal_amount = null, service_fee_amount = null, currency = 'XAF' } = input || {};

      const baseInsertObj: any = {
        id: uuidv4(),
        request_id: null,
        client_id: null,
        source: 'MANUAL',
        total_amount: 0,
        client_name: client_name || null,
        objet: objet || null,
        origin: origin || null,
        subtotal_amount: subtotal_amount !== null && subtotal_amount !== undefined ? Number(subtotal_amount) : null,
        service_fee_amount: service_fee_amount !== null && service_fee_amount !== undefined ? Number(service_fee_amount) : null,
        currency: currency || 'XAF',
        cargo_route: null,
        bill_of_lading: null,
        customer_reference: null,
        status: 'DRAFT',
        created_by: created_by || null,
        created_at: new Date().toISOString()
      };

      const maxAttempts = 5;
      let inserted: any = null;

      // compute base candidate and allow incremental retries
      let baseCandidateNum = null as number | null;
      try {
        const baseStr = await this.generateNextInvoiceNumber();
        const m = String(baseStr).match(/(\d+)$/);
        baseCandidateNum = m ? parseInt(m[1], 10) : null;
      } catch (e) {
        logger.error('Failed to compute base invoice number for manual invoice', { error: e });
        return { data: null, error: e };
      }

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const nextNum = (baseCandidateNum ?? 0) + attempt;
        const candidateInvoiceNumber = `MKC-INV-${String(nextNum).padStart(3, '0')}`;

        const insertObj = { ...baseInsertObj, invoice_number: candidateInvoiceNumber };

        const { data: insData, error: insertErr } = await supabaseAdmin
          .from('invoices')
          .insert(insertObj)
          .select()
          .single();

        if (!insertErr && insData) {
          inserted = insData;
          break;
        }

        const isUniqueViolation = insertErr && (String(insertErr.code) === '23505' || String(insertErr.message || '').toLowerCase().includes('duplicate'));
        if (!isUniqueViolation) {
          logger.error('Failed to create manual invoice', { error: insertErr });
          return { data: null, error: insertErr };
        }

        logger.warn('Manual invoice number collision, retrying', { candidateInvoiceNumber, attempt });
        await new Promise(r => setTimeout(r, 120 * (attempt + 1)));
      }

      if (!inserted) {
        const err = new Error('Failed to create manual invoice after retries');
        logger.error('Failed to create manual invoice after retries', { error: (err as any).message });
        return { data: null, error: err };
      }

      return { data: { id: inserted.id, invoice_number: inserted.invoice_number, status: inserted.status, source: inserted.source }, error: null };
    } catch (err: any) {
      logger.error('Error creating manual invoice:', err);
      return { data: null, error: err };
    }
  }
}

export default PaymentsService;
