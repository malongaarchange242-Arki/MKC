#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }

  const email = process.argv[2];
  const password = process.argv[3];
  const prenom = process.argv[4] || null;
  const nom = process.argv[5] || null;

  if (!email || !password) {
    console.error('Usage: node update_admin.js <email> <password> [prenom] [nom]');
    process.exit(2);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log('🔐 Updating ADMIN user:', email);

  let found = null;
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('listUsers error:', error);
      process.exit(1);
    }

    if (!data?.users || data.users.length === 0) break;

    const u = data.users.find(u => u.email === email);
    if (u) { found = u; break; }
    page++;
  }

  if (!found) {
    console.error('❌ User not found:', email);
    process.exit(1);
  }

  const userId = found.id;

  const { data: updated, error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { role: 'ADMIN', prenom: prenom || found.user_metadata?.prenom, nom: nom || found.user_metadata?.nom }
  });

  if (updateErr) {
    console.error('updateUserById error:', updateErr);
    process.exit(1);
  }

  console.log('✅ Auth user updated:', userId);

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      email,
      prenom: prenom || found.user_metadata?.prenom,
      nom: nom || found.user_metadata?.nom,
      role: 'ADMIN'
    })
    .eq('id', userId);

  if (profileError) {
    console.error('profile update error:', profileError);
    process.exit(1);
  }

  console.log('✅ ADMIN profile updated successfully');
}

main();
