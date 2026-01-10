#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service role pour tout modifier

  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }

  const email = process.argv[2];
  const newPassword = process.argv[3];
  const prenom = process.argv[4] || 'Admin';
  const nom = process.argv[5] || 'Admin';
  const role = process.argv[6] || 'ADMIN';

  if (!email || !newPassword) {
    console.error('Usage: node fix_admin_user.js <email> <newPassword> [prenom] [nom] [role]');
    process.exit(2);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('🔍 Searching auth user for email:', email);

  // 1️⃣ Trouver l'utilisateur dans auth.users
  const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (usersErr) {
    console.error('Error listing users:', usersErr);
    process.exit(1);
  }

  const authUser = usersData.users.find(u => u.email === email);

  if (!authUser) {
    console.error('❌ No auth user found for email:', email);
    process.exit(1);
  }

  const userId = authUser.id;
  console.log('✅ Found auth user with ID:', userId);

  // 2️⃣ Mettre à jour le mot de passe et metadata
  const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
    password: newPassword,
    user_metadata: { prenom, nom, role },
  });

  if (updateErr) {
    console.error('❌ Error updating user password/metadata:', updateErr);
    process.exit(1);
  }

  console.log('✅ Password and metadata updated');

  // 3️⃣ Vérifier / corriger le profil
  const { data: profileData, error: profileErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (profileErr) {
    console.error('Error fetching profile:', profileErr);
    process.exit(1);
  }

  if (profileData && profileData.id !== userId) {
    console.log('⚠️ Profile exists but with wrong ID. Deleting old profile...');
    await supabase.from('profiles').delete().eq('id', profileData.id);
  }

  // Upsert le profil correct
  const { error: upsertErr } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      email,
      prenom,
      nom,
      role,
      created_at: new Date().toISOString(),
    }, { onConflict: 'id' });

  if (upsertErr) {
    console.error('❌ Error upserting profile:', upsertErr);
    process.exit(1);
  }

  console.log('✅ Profile fixed successfully for user ID:', userId);
  console.log(`🎉 Admin user ready. Login with email="${email}" and password="${newPassword}"`);
}

main();
