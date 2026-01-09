/**
 * Script pour créer le bucket Storage dans Supabase (version JavaScript)
 * Usage: node scripts/create-storage-bucket.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Variables d\'environnement manquantes');
  console.error('Assurez-vous que SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont définies');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function createStorageBucket() {
  console.log('Création du bucket Storage "documents"...\n');

  const bucketName = 'documents';
  const bucketConfig = {
    name: bucketName,
    public: false,
    fileSizeLimit: 10485760, // 10MB
    allowedMimeTypes: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  };

  try {
    // Vérifier si le bucket existe déjà
    const { data: existingBuckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
      console.error('❌ Erreur lors de la vérification des buckets:', listError);
      process.exit(1);
    }

    const bucketExists = existingBuckets?.some(b => b.name === bucketName);

    if (bucketExists) {
      console.log('✅ Le bucket "documents" existe déjà');
      return;
    }

    // Créer le bucket
    const { data: bucket, error: createError } = await supabase.storage.createBucket(bucketName, {
      public: bucketConfig.public,
      fileSizeLimit: bucketConfig.fileSizeLimit,
      allowedMimeTypes: bucketConfig.allowedMimeTypes
    });

    if (createError) {
      console.error('❌ Erreur lors de la création du bucket:', createError);
      
      if (createError.message?.includes('already exists') || createError.statusCode === 409) {
        console.log('✅ Le bucket existe déjà');
        return;
      }
      
      process.exit(1);
    }

    console.log('✅ Bucket créé avec succès!');
    console.log('\n📋 Configuration:');
    console.log(`   - Nom: ${bucketName}`);
    console.log(`   - Public: ${bucketConfig.public ? 'Oui' : 'Non'}`);
    console.log(`   - Taille max: ${bucketConfig.fileSizeLimit / 1024 / 1024}MB`);
    console.log('\n✅ Le bucket est prêt à être utilisé!');

  } catch (error) {
    console.error('❌ Erreur inattendue:', error);
    process.exit(1);
  }
}

createStorageBucket();

