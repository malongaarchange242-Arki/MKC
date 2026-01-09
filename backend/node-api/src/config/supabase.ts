import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import path from 'path';

// Ensure backend/.env is loaded (resolve relative to this file)
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

// ===============================
// ENV VALIDATION
// ===============================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  logger.error('Supabase environment variables are missing');
  throw new Error('Missing Supabase configuration');
}

// ===============================
// SUPABASE CLIENT
// ===============================
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

// ===============================
// HEALTH CHECK (OPTIONAL)
// ===============================
export const checkSupabaseConnection = async (): Promise<void> => {
  try {
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    logger.info('Supabase connection established');
  } catch (error) {
    logger.error('Supabase connection failed', { error });
    throw new Error('Supabase connection failed');
  }
};
