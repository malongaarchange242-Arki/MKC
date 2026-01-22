import supabaseAdmin from '../../config/supabaseAdmin';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';

export class PaymentsService {

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
        .select(`id, invoice_number, amount, currency, cargo_route, status, created_at, request_id, requests ( bl_number, user_id )`)
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
            amount_due: row.amount,
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
  }) {
    try {
      const { request_id, amount, currency = 'USD', customer_reference, cargo_route = null, created_by } = input;

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
        // Update amount/currency/cargo_route and set status to DRAFT
        const { data: updated, error: updErr } = await supabaseAdmin
          .from('invoices')
          .update({ amount: Number(amount), currency, cargo_route: cargo_route || existing.cargo_route || null, status: 'DRAFT' })
          .eq('id', existing.id)
          .select()
          .single();

        if (updErr) {
          logger.error('Failed to update existing invoice during createInvoice', { request_id, error: updErr });
          return { data: null, error: updErr };
        }

        return { data: updated, error: null };
      }

      // 3️⃣ Génération Invoice Number (format requested: MKC-INV-001)

      // 4️⃣ Insertion with retry on invoice_number unique constraint (race protection)
      const baseInsertObj = {
        id: uuidv4(),
        request_id,
        client_id,
        amount: Number(amount),
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

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Compute a global sequential-ish counter by looking at existing invoice suffixes
        const { data: allInvs, error: allErr } = await supabaseAdmin
          .from('invoices')
          .select('invoice_number')
          .ilike('invoice_number', `MKC-INV-%`);

        if (allErr) {
          logger.error('Failed to list existing invoices for numbering', { error: allErr });
          return { data: null, error: allErr };
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

        const next = maxSuffix + attempt + 1;
        const candidateInvoiceNumber = `MKC-INV-${String(next).padStart(3, '0')}`;

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

      return { data: inserted, error: null };

    } catch (err: any) {
      logger.error('Error creating invoice:', err);
      return { data: null, error: err };
    }
  }

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
}

export default PaymentsService;
