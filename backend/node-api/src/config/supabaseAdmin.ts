import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // 🔑 LA CLÉ QUI MANQUAIT
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

export default supabaseAdmin;
