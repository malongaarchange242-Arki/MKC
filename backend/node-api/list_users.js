#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }});

  let page = 1; const perPage = 1000; let all = [];
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) { console.error('listUsers error:', error); process.exit(1); }
    if (!data?.users || data.users.length === 0) break;
    all = all.concat(data.users);
    page++;
  }

  console.log('Total users found:', all.length);
  all.forEach(u => {
    console.log(u.id, '|', u.email, '|', u.user_metadata ? JSON.stringify(u.user_metadata) : '{}');
  });
}

main();
