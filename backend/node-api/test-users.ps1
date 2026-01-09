# Script de test PowerShell pour les endpoints Users
# Usage: .\test-users.ps1

$BASE_URL = "http://localhost:3000"
$TEST_EMAIL = "test@example.com"
$TEST_PASSWORD = "Test123456!"

Write-Host "`n🚀 Test des endpoints Users`n" -ForegroundColor Cyan
Write-Host "Base URL: $BASE_URL`n"

# Test 1: Health Check
Write-Host "📋 Test 1: Health Check" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/health" -Method Get
    Write-Host "✅ Health check OK" -ForegroundColor Green
    Write-Host "   Service: $($response.service)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Assurez-vous que le serveur est demarre (npm run dev)" -ForegroundColor Yellow
    exit 1
}

# Test 2: Register
Write-Host "`n📋 Test 2: Register" -ForegroundColor Yellow
$uniqueEmail = "test$(Get-Date -Format 'yyyyMMddHHmmss')@example.com"
$registerBody = @{
    email = $uniqueEmail
    password = $TEST_PASSWORD
    nom = "Test"
    prenom = "User"
} | ConvertTo-Json

try {
    $registerResponse = Invoke-RestMethod -Uri "$BASE_URL/auth/register" -Method Post -Body $registerBody -ContentType "application/json"
    Write-Host "✅ Register OK" -ForegroundColor Green
    Write-Host "   Email: $uniqueEmail" -ForegroundColor Gray
    Write-Host "   User ID: $($registerResponse.user.id)" -ForegroundColor Gray
    $TEST_EMAIL = $uniqueEmail
} catch {
    Write-Host "❌ Register failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "   Response: $responseBody" -ForegroundColor Gray
    }
    Write-Host "   Utilisez un email qui n'existe pas encore" -ForegroundColor Yellow
}

# Test 3: Login
Write-Host "`n📋 Test 3: Login" -ForegroundColor Yellow
$loginBody = @{
    email = $TEST_EMAIL
    password = $TEST_PASSWORD
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "$BASE_URL/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
    $token = $loginResponse.session.access_token
    Write-Host "✅ Login OK" -ForegroundColor Green
    Write-Host "   Token: $($token.Substring(0, 20))..." -ForegroundColor Gray
} catch {
    Write-Host "❌ Login failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Creez d'abord un utilisateur avec /auth/register" -ForegroundColor Yellow
    exit 1
}

# Test 4: GET /users/me
Write-Host "`n📋 Test 4: GET /users/me" -ForegroundColor Yellow
$headers = @{
    "Authorization" = "Bearer $token"
}

try {
    $meResponse = Invoke-RestMethod -Uri "$BASE_URL/users/me" -Method Get -Headers $headers
    Write-Host "✅ GET /users/me OK" -ForegroundColor Green
    Write-Host "   Profile:" -ForegroundColor Gray
    Write-Host "   - ID: $($meResponse.profile.id)" -ForegroundColor Gray
    Write-Host "   - Email: $($meResponse.profile.email)" -ForegroundColor Gray
    Write-Host "   - Nom: $($meResponse.profile.nom)" -ForegroundColor Gray
    Write-Host "   - Prenom: $($meResponse.profile.prenom)" -ForegroundColor Gray
    Write-Host "   - Role: $($meResponse.profile.role)" -ForegroundColor Gray
} catch {
    Write-Host "❌ GET /users/me failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: PATCH /users/me
Write-Host "`n📋 Test 5: PATCH /users/me" -ForegroundColor Yellow
$updateBody = @{
    nom = "Updated"
    prenom = "Name"
} | ConvertTo-Json

try {
    $updateResponse = Invoke-RestMethod -Uri "$BASE_URL/users/me" -Method Patch -Body $updateBody -ContentType "application/json" -Headers $headers
    Write-Host "✅ PATCH /users/me OK" -ForegroundColor Green
    Write-Host "   Nom mis a jour: $($updateResponse.profile.nom)" -ForegroundColor Gray
    Write-Host "   Prenom mis a jour: $($updateResponse.profile.prenom)" -ForegroundColor Gray
} catch {
    Write-Host "❌ PATCH /users/me failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 6: GET /users (ADMIN only)
Write-Host "`n📋 Test 6: GET /users (ADMIN only)" -ForegroundColor Yellow
try {
    $usersResponse = Invoke-RestMethod -Uri "$BASE_URL/users" -Method Get -Headers $headers
    Write-Host "✅ GET /users OK" -ForegroundColor Green
    Write-Host "   Nombre d'utilisateurs: $($usersResponse.count)" -ForegroundColor Gray
} catch {
    if ($_.Exception.Response.StatusCode -eq 403) {
        Write-Host "⚠️  GET /users - Forbidden (normal si pas ADMIN)" -ForegroundColor Yellow
    } else {
        Write-Host "❌ GET /users failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n✅ Tests termines !`n" -ForegroundColor Green
Write-Host "Pour tester les routes ADMIN, connectez-vous avec un compte ADMIN -ForegroundColor Cyan
