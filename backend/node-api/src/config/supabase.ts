import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import dotenv from 'dotenv';
import path from 'path';

// Ensure backend/.env is loaded (resolve relative to this file)
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

// ===============================
// ENV VALIDATION + NORMALIZATION
// ===============================
const SUPABASE_URL_RAW = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL_RAW || !SUPABASE_SERVICE_ROLE_KEY) {
  logger.error('Supabase environment variables are missing');
  throw new Error('Missing Supabase configuration');
}

// Ensure trailing slash on SUPABASE_URL for storage/paths compatibility
const SUPABASE_URL = SUPABASE_URL_RAW.replace(/\/+$/, '') + '/';
logger.info('Normalized SUPABASE_URL', { original: SUPABASE_URL_RAW, normalized: SUPABASE_URL });

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
