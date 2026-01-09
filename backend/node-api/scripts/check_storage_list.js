#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE key in environment');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const requestId = process.argv[2];
if (!requestId) {
  console.error('Usage: node check_storage_list.js <requestId>');
  process.exit(2);
}

(async () => {
  try {
    console.log('Listing storage for requestId', requestId);
    const { data, error } = await supabase.storage.from('documents').list(requestId);

    if (error) {
      console.error('LIST_ERROR', JSON.stringify(error, null, 2));
      // When list returns an error, still surface mismatch possibility
      console.error('STORAGE PROJECT MISMATCH (on error)', { requestId });
      process.exit(1);
    }

    console.log('LIST_RESULT_count=', Array.isArray(data) ? data.length : 0);
    if (Array.isArray(data) && data.length === 0) {
      console.error('STORAGE PROJECT MISMATCH', { requestId });
      process.exit(1);
    }

    console.log('FILES:', JSON.stringify(data, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('UNEXPECTED_ERROR', e && e.message ? e.message : String(e));
    process.exit(1);
  }
})();
