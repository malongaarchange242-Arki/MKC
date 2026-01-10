import supabaseAdmin from '../../config/supabaseAdmin';

export class PaymentsService {
  // Retrieve invoices from the central billing table.
  // Optional filters: userId (from auth), request_id, bl_number
  async getInvoices(filters: {
    userId?: string | null;
    request_id?: string | null;
    bl_number?: string | null;
  }) {
    const { userId, request_id, bl_number } = filters || {};
    // Read from request_drafts and join requests to retrieve bl_number
    // We select request_drafts fields and the related requests.bl_number when available.
    try {
      const { data, error } = await supabaseAdmin
        .from('request_drafts')
        .select('request_id,amount,currency,status,requests(bl_number)');

      if (error) return { data: null, error };

      // Normalize and optionally filter by request_id or bl_number
      const mapped = (data || []).map((row: any) => {
        const bl = (row.requests && row.requests.length && row.requests[0].bl_number) ? row.requests[0].bl_number : null;
        return {
          request_id: row.request_id || null,
          bl_number: bl,
          amount_due: row.amount !== undefined && row.amount !== null ? row.amount : null,
          currency: row.currency || null,
          status: row.status || null
        };
      }).filter((inv: any) => {
        if (request_id) return String(inv.request_id) === String(request_id);
        if (bl_number) return inv.bl_number && String(inv.bl_number) === String(bl_number);
        return true;
      });

      return { data: mapped, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }
}

export default PaymentsService;
// single export default above