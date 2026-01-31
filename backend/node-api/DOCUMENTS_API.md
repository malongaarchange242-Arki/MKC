# Guide API Documents

## Endpoints disponibles

### 1. Upload Document
**POST** `/documents/:requestId/upload`

Upload un fichier pour une demande spécifique.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Body (form-data):**
- `file`: Le fichier à uploader (max 10MB)

**Types de fichiers acceptés:**
- PDF: `application/pdf`
- Images: `image/jpeg`, `image/png`, `image/jpg`
- Word: `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Excel: `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

**Exemple (curl):**
```bash
curl -X POST https://mkc-backend-kqov.onrender.com/documents/{requestId}/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/file.pdf"
```

**Réponse (201):**
```json
{
  "success": true,
  "document": {
    "id": "uuid",
    "request_id": "uuid",
    "file_name": "document.pdf",
    "file_path": "requestId/uuid.pdf",
    "file_size": 123456,
    "mime_type": "application/pdf",
    "version": 1,
    "uploaded_by": "user-uuid",
    "uploaded_at": "2025-12-30T...",
    "created_at": "2025-12-30T..."
  }
}
```

### 2. List My Documents
**GET** `/documents/me`

Liste tous les documents de l'utilisateur connecté.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `requestId` (optional): Filtrer par demande
- `limit` (optional): Nombre de résultats (défaut: 50)
- `offset` (optional): Offset pour pagination

**Exemple:**
```bash
curl -X GET "https://mkc-backend-kqov.onrender.com/documents/me?requestId={requestId}&limit=10" \
  -H "Authorization: Bearer <token>"
```

**Réponse (200):**
```json
{
  "success": true,
  "documents": [
    {
      "id": "uuid",
      "request_id": "uuid",
      "file_name": "document.pdf",
      "file_size": 123456,
      "mime_type": "application/pdf",
      "version": 1,
      "uploaded_at": "2025-12-30T..."
    }
  ],
  "count": 1
}
```

### 3. Get Document By ID
**GET** `/documents/:id`

Récupère les métadonnées d'un document.

**Headers:**
```
Authorization: Bearer <token>
```

**Réponse (200):**
```json
{
  "success": true,
  "document": {
    "id": "uuid",
    "request_id": "uuid",
    "file_name": "document.pdf",
    "file_path": "requestId/uuid.pdf",
    "file_size": 123456,
    "mime_type": "application/pdf",
    "version": 1,
    "uploaded_by": "user-uuid",
    "uploaded_at": "2025-12-30T..."
  }
}
```

### 4. Download Document
**GET** `/documents/:id/download`

Télécharge un document.

**Headers:**
```
Authorization: Bearer <token>
```

**Réponse (200):**
- Content-Type: selon le type de fichier
- Content-Disposition: attachment; filename="..."
- Body: Fichier binaire

**Exemple:**
```bash
curl -X GET https://mkc-backend-kqov.onrender.com/documents/{id}/download \
  -H "Authorization: Bearer <token>" \
  -o downloaded_file.pdf
```

### 5. Delete Document
**DELETE** `/documents/:id`

Supprime un document.

**Headers:**
```
Authorization: Bearer <token>
```

**Règles:**
- CLIENT: Peut supprimer uniquement si la demande n'est pas soumise
- ADMIN: Peut supprimer n'importe quel document

**Réponse (200):**
```json
{
  "success": true,
  "message": "Document deleted successfully"
}
```

### 6. List All Documents (ADMIN only)
**GET** `/documents`

Liste tous les documents (réservé aux admins).

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `requestId` (optional): Filtrer par demande
- `limit` (optional): Nombre de résultats
- `offset` (optional): Offset pour pagination

## Permissions

### CLIENT
- ✅ Upload documents pour ses demandes
- ✅ Voir ses documents
- ✅ Télécharger ses documents
- ✅ Supprimer ses documents (si demande pas soumise)
- ❌ Voir les documents des autres

### ADMIN
- ✅ Upload documents pour n'importe quelle demande
- ✅ Voir tous les documents
- ✅ Télécharger tous les documents
- ✅ Supprimer tous les documents

## Workflow

1. **Client crée demande** → Status: `CREATED`
2. **Client upload fichiers** → Status: `AWAITING_DOCUMENTS` (automatique au premier upload)
3. **Client soumet** → Status: `SUBMITTED`
4. **Agent récupère les fichiers** → Status: `UNDER_REVIEW`
5. **Documents validés** → Status: `DRAFT_READY`

## Configuration Supabase

### Storage Bucket

Créer un bucket nommé `documents` dans Supabase Storage:

1. Aller dans Storage → Create bucket
2. Nom: `documents`
3. Public: ❌ (privé)
4. File size limit: 10MB
5. Allowed MIME types: (laisser vide ou configurer selon besoins)

### Table Documents

Exécuter le script `infra/supabase/documents-schema.sql` pour créer la table et les politiques RLS.



