# Guide de test des endpoints Users

## Prérequis

1. Le serveur doit être démarré : `npm run dev`
2. Les variables d'environnement doivent être configurées (`.env`)
3. Supabase doit être accessible

## Tests manuels avec curl (PowerShell)

### 1. Health Check
```powershell
curl https://mkc-backend-kqov.onrender.com/health
```

### 2. Register (créer un utilisateur)
```powershell
$body = @{
    email = "test@example.com"
    password = "Test123456!"
    nom = "Test"
    prenom = "User"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://mkc-backend-kqov.onrender.com/auth/register" -Method Post -Body $body -ContentType "application/json"
```

### 3. Login (obtenir un token)
```powershell
$body = @{
    email = "test@example.com"
    password = "Test123456!"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "https://mkc-backend-kqov.onrender.com/auth/login" -Method Post -Body $body -ContentType "application/json"
$token = $response.session.access_token
Write-Host "Token: $token"
```

### 4. GET /users/me (mon profil)
```powershell
$headers = @{
    "Authorization" = "Bearer $token"
}

Invoke-RestMethod -Uri "https://mkc-backend-kqov.onrender.com/users/me" -Method Get -Headers $headers
```

### 5. PATCH /users/me (mettre à jour mon profil)
```powershell
$body = @{
    nom = "Updated"
    prenom = "Name"
} | ConvertTo-Json

$headers = @{
    "Authorization" = "Bearer $token"
}

Invoke-RestMethod -Uri "https://mkc-backend-kqov.onrender.com/users/me" -Method Patch -Body $body -ContentType "application/json" -Headers $headers
```

### 6. GET /users (liste des utilisateurs - ADMIN seulement)
```powershell
$headers = @{
    "Authorization" = "Bearer $token"
}

Invoke-RestMethod -Uri "https://mkc-backend-kqov.onrender.com/users" -Method Get -Headers $headers
```

### 7. GET /users/:id (détails d'un utilisateur - ADMIN seulement)
```powershell
$userId = "uuid-de-l-utilisateur"
$headers = @{
    "Authorization" = "Bearer $token"
}

Invoke-RestMethod -Uri "https://mkc-backend-kqov.onrender.com/users/$userId" -Method Get -Headers $headers
```

## Tests avec Postman/Thunder Client

### Collection à importer

1. **GET /health**
  - Method: GET
  - URL: `https://mkc-backend-kqov.onrender.com/health`
  - Headers: Aucun

2. **POST /auth/register**
  - Method: POST
  - URL: `https://mkc-backend-kqov.onrender.com/auth/register`
   - Headers: `Content-Type: application/json`
   - Body (JSON):
   ```json
   {
     "email": "test@example.com",
     "password": "Test123456!",
     "nom": "Test",
     "prenom": "User"
   }
   ```

3. **POST /auth/login**
  - Method: POST
  - URL: `https://mkc-backend-kqov.onrender.com/auth/login`
   - Headers: `Content-Type: application/json`
   - Body (JSON):
   ```json
   {
     "email": "test@example.com",
     "password": "Test123456!"
   }
   ```
   - ⚠️ Sauvegarder le `access_token` de la réponse

4. **GET /users/me**
  - Method: GET
  - URL: `https://mkc-backend-kqov.onrender.com/users/me`
   - Headers: 
     - `Authorization: Bearer <token>`
     - `Content-Type: application/json`

5. **PATCH /users/me**
  - Method: PATCH
  - URL: `https://mkc-backend-kqov.onrender.com/users/me`
   - Headers: 
     - `Authorization: Bearer <token>`
     - `Content-Type: application/json`
   - Body (JSON):
   ```json
   {
     "nom": "Updated",
     "prenom": "Name"
   }
   ```

6. **GET /users** (ADMIN)
  - Method: GET
  - URL: `https://mkc-backend-kqov.onrender.com/users`
   - Headers: 
     - `Authorization: Bearer <token-admin>`
     - `Content-Type: application/json`

7. **GET /users/:id** (ADMIN)
  - Method: GET
  - URL: `https://mkc-backend-kqov.onrender.com/users/{userId}`
   - Headers: 
     - `Authorization: Bearer <token-admin>`
     - `Content-Type: application/json`

8. **PATCH /users/:id/role** (ADMIN)
  - Method: PATCH
  - URL: `https://mkc-backend-kqov.onrender.com/users/{userId}/role`
   - Headers: 
     - `Authorization: Bearer <token-admin>`
     - `Content-Type: application/json`
   - Body (JSON):
   ```json
   {
     "role": "ADMIN"
   }
   ```

## Réponses attendues

### GET /users/me (succès)
```json
{
  "success": true,
  "profile": {
    "id": "uuid",
    "email": "test@example.com",
    "nom": "Test",
    "prenom": "User",
    "role": "CLIENT",
    "created_at": "2025-12-30T..."
  }
}
```

### Erreur 401 (non authentifié)
```json
{
  "message": "Unauthorized"
}
```

### Erreur 403 (pas les permissions)
```json
{
  "message": "Forbidden"
}
```

## Checklist de test

- [ ] Health check fonctionne
- [ ] Register crée un utilisateur
- [ ] Login retourne un token
- [ ] GET /users/me retourne le profil
- [ ] PATCH /users/me met à jour le profil
- [ ] GET /users nécessite ADMIN
- [ ] GET /users/:id nécessite ADMIN
- [ ] PATCH /users/:id/role nécessite ADMIN

