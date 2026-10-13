import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { createInterface } from 'readline/promises';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis dans backend/.env.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function readHidden(label: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Lancez ce script depuis un terminal interactif pour saisir le mot de passe en sécurité.'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Saisie interrompue.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (char >= ' ') {
          value += char;
          process.stdout.write('*');
        }
      }
    };
    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
    };

    process.stdout.write(label);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function findAuthUser(email: string) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    const user = data.users.find(candidate => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) return null;
  }
}

async function main() {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let readlineClosed = false;
  try {
    const email = (await readline.question('Email administrateur : ')).trim().toLowerCase();
    const prenom = (await readline.question('Prénom : ')).trim();
    const nom = (await readline.question('Nom : ')).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || prenom.length < 2 || nom.length < 2) {
      throw new Error('Email, prénom ou nom invalide.');
    }

    const existingUser = await findAuthUser(email);
    if (existingUser) {
      const confirmation = (await readline.question(
        `Un compte existe déjà pour ${email}. Le promouvoir ADMIN et remplacer son mot de passe ? (oui/non) `
      )).trim().toLowerCase();
      if (!['oui', 'o', 'yes', 'y'].includes(confirmation)) {
        console.log('Aucune modification effectuée.');
        return;
      }
    }
    readline.close();
    readlineClosed = true;

    const password = await readHidden('Nouveau mot de passe (8 caractères minimum) : ');
    const passwordConfirmation = await readHidden('Confirmer le mot de passe : ');
    if (password.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
    if (password !== passwordConfirmation) throw new Error('Les mots de passe ne correspondent pas.');

    const userMetadata = {
      ...(existingUser?.user_metadata || {}),
      prenom,
      nom,
      role: 'ADMIN'
    };

    let userId: string;
    if (existingUser) {
      const { data, error } = await supabase.auth.admin.updateUserById(existingUser.id, {
        password,
        user_metadata: userMetadata,
        email_confirm: true
      });
      if (error) throw error;
      userId = data.user.id;
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: userMetadata
      });
      if (error) throw error;
      if (!data.user) throw new Error('Supabase n’a pas retourné le compte créé.');
      userId = data.user.id;
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ id: userId, email, prenom, nom, role: 'ADMIN' }, { onConflict: 'id' });
    if (profileError) {
      throw new Error(`Compte Auth ${email} prêt, mais la mise à jour du profil a échoué : ${profileError.message}`);
    }

    console.log(`Compte administrateur créé/configuré avec succès : ${email}`);
    console.log('Déconnectez-vous puis reconnectez-vous pour obtenir une session avec le rôle ADMIN.');
  } finally {
    if (!readlineClosed) readline.close();
  }
}

main().catch(error => {
  console.error('Échec de la création du compte administrateur :', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
