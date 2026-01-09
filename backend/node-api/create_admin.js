#!/usr/bin/env node
// Utility: create an ADMIN user using Supabase service role key
const { createClient } = require('@supabase/supabase-js');

async function main(){
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key){
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
    process.exit(2);
  }

  const email = process.argv[2];
  const password = process.argv[3];
  const prenom = process.argv[4] || 'Admin';
  const nom = process.argv[5] || 'Admin';

  if(!email || !password){
    console.error('Usage: node create_admin.js <email> <password> [prenom] [nom]');
    process.exit(2);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try{
    console.log('Creating admin user', email);
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'ADMIN', prenom, nom }
    });
    if(error){
      console.error('Supabase createUser error:', error);
      process.exit(1);
    }

    console.log('User created. id=', data.user?.id);

    // Ensure profile exists / upsert
    try{
      const profilePayload = { id: data.user.id, email, prenom, nom, role: 'ADMIN' };
      const { data: pData, error: pErr } = await supabase.from('profiles').upsert(profilePayload, { onConflict: 'id' }).select().maybeSingle();
      if(pErr) console.warn('Profile upsert warning:', pErr);
      else console.log('Profile ensured for user:', pData?.id || data.user.id);
    }catch(e){ console.warn('Profile upsert failed', e); }

    console.log('Admin creation finished successfully.');
  }catch(e){
    console.error('Unexpected error', e);
    process.exit(1);
  }
}

main();
