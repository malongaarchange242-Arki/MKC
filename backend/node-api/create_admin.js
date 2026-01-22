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
  const prenom = process.argv[4] || 'Admin';
  const nom = process.argv[5] || 'Admin';

  if (!email || !password) {
    console.error('Usage: node create_admin.js <email> <password> [prenom] [nom]');
    process.exit(2);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log('🔐 Creating ADMIN user:', email);

  // ===============================
  // 1️⃣ VÉRIFICATION RÉELLE DE L'EMAIL
  // ===============================
  let userExists = false;
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      console.error('listUsers error:', error);
      process.exit(1);
    }

    if (!data?.users || data.users.length === 0) break;

    if (data.users.some(u => u.email === email)) {
      userExists = true;
      break;
    }

    page++;
  }

  if (userExists) {
    console.error('❌ User already exists. Aborting to avoid role escalation.');
    process.exit(1);
  }

  // ===============================
  // 2️⃣ CRÉATION DE L'ADMIN (AUTH)
  // ===============================
  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'ADMIN', prenom, nom }
    });

  if (createError) {
    console.error('createUser error:', createError);
    process.exit(1);
  }

  const userId = created.user.id;
  console.log('✅ Auth user created:', userId);

  // ===============================
// 3️⃣ MISE À JOUR DU PROFIL ADMIN
// ===============================
const { error: profileError } = await supabase
  .from('profiles')
  .update({
    email,
    prenom,
    nom,
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
