# Guide : Créer le bucket Storage dans Supabase

## Méthode 1 : Script automatique (Recommandé)

### Option A : TypeScript

```bash
npx ts-node scripts/create-storage-bucket.ts
```

### Option B : JavaScript

```bash
node scripts/create-storage-bucket.js
```

Le script va :
- ✅ Vérifier si le bucket existe déjà
- ✅ Créer le bucket avec la configuration appropriée
- ✅ Configurer les limites de taille et types MIME

## Méthode 2 : Interface Web Supabase (Manuel)

### Étapes

1. **Accéder à Supabase Dashboard**
   - Aller sur https://app.supabase.com
   - Sélectionner votre projet

2. **Naviguer vers Storage**
   - Dans le menu de gauche, cliquer sur **Storage**

3. **Créer un nouveau bucket**
   - Cliquer sur **"New bucket"** ou **"Create bucket"**
   - Remplir les informations :
     - **Name**: `documents`
     - **Public bucket**: ❌ **DÉSACTIVÉ** (privé)
     - **File size limit**: `10` MB
     - **Allowed MIME types**: (optionnel, laisser vide ou ajouter les types)

4. **Configurer les politiques RLS** (optionnel)
   - Le backend utilise `SERVICE_ROLE_KEY` qui contourne RLS
   - Les politiques sont gérées au niveau de l'application

### Configuration recommandée

```
Nom: documents
Public: Non (privé)
File size limit: 10 MB
Allowed MIME types: (vide ou configuré selon besoins)
```

## Méthode 3 : API REST (Alternative)

Si vous préférez utiliser curl ou Postman :

```bash
curl -X POST 'https://YOUR_PROJECT.supabase.co/storage/v1/bucket' \
  -H "apikey: YOUR_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "documents",
    "public": false,
    "file_size_limit": 10485760,
    "allowed_mime_types": [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ]
  }'
```

## Vérification

Après création, vérifier que le bucket existe :

### Via Script
```bash
node scripts/create-storage-bucket.js
```

### Via Interface
- Aller dans Storage → Vérifier que "documents" apparaît dans la liste

### Via API
```bash
curl -X GET 'https://YOUR_PROJECT.supabase.co/storage/v1/bucket' \
  -H "apikey: YOUR_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

## Types de fichiers autorisés

Le bucket accepte les types suivants :
- ✅ PDF: `application/pdf`
- ✅ Images: `image/jpeg`, `image/png`, `image/jpg`
- ✅ Word: `application/msword`, `.docx`
- ✅ Excel: `application/vnd.ms-excel`, `.xlsx`

## Notes importantes

1. **Bucket privé** : Le bucket doit être privé pour la sécurité
2. **Service Role Key** : Le backend utilise `SERVICE_ROLE_KEY` qui contourne RLS
3. **Taille max** : 10MB par fichier (configurable)
4. **Structure** : Les fichiers sont stockés dans `{requestId}/{filename}`

## Problèmes courants

### Erreur "Bucket already exists"
- ✅ Le bucket existe déjà, c'est normal
- Le script détecte cela automatiquement

### Erreur "Permission denied"
- Vérifier que `SERVICE_ROLE_KEY` est correcte
- Vérifier que la clé a les permissions Storage

### Erreur "Invalid API key"
- Vérifier les variables d'environnement dans `.env`
- S'assurer que `SUPABASE_SERVICE_ROLE_KEY` est bien définie

## Prochaines étapes

Une fois le bucket créé :

1. ✅ Exécuter le schéma SQL pour la table `documents`
   ```sql
   -- Voir infra/supabase/documents-schema.sql
   ```

2. ✅ Tester l'upload via l'API
   ```bash
   POST /documents/:requestId/upload
   ```

3. ✅ Vérifier que les fichiers apparaissent dans Supabase Storage



