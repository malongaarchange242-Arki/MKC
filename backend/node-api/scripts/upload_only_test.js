#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE key in environment');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  try {
    const requestId = process.argv[2] || randomUUID();
    const fileName = `testfile-${randomUUID()}.pdf`;
    const storagePath = `${requestId}/${fileName}`;
    const content = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');

    console.log('Uploading to storage:', storagePath);
    const { data: upData, error: upErr } = await supabase.storage.from('documents').upload(storagePath, content, {
      contentType: 'application/pdf',
      upsert: false
    });

    if (upErr) {
      console.error('Upload error', upErr);
      process.exit(1);
    }

    console.log('Upload result:', upData);

    // Immediately list and attempt signed URL
    console.log('Listing storage for requestId', requestId);
    const { data: listData, error: listErr } = await supabase.storage.from('documents').list(requestId);
    console.log('List result count =', Array.isArray(listData) ? listData.length : 0, 'err=', listErr);

    console.log('Attempting to create signed URL immediately');
    const { data: signData, error: signErr } = await supabase.storage.from('documents').createSignedUrl(storagePath, 60 * 60);
    console.log('Signed result:', { signData, signErr });

    process.exit(0);
  } catch (e) {
    console.error('Unexpected error', e);
    process.exit(1);
  }
})();
