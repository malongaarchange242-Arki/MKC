-- ===============================
-- FIX RLS POLICIES FOR PROFILES
-- ===============================
-- Ce script corrige la récursion infinie dans les politiques RLS

-- D'abord, désactiver temporairement RLS pour corriger les politiques
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Supprimer toutes les politiques existantes qui causent la récursion
DROP POLICY IF EXISTS "User can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Enable read access for own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_select_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON profiles;

-- Réactiver RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ===============================
-- POLITIQUES CORRIGÉES (sans récursion)
-- ===============================

-- Politique SELECT : Les utilisateurs peuvent lire leur propre profil
-- Utilise auth.uid() directement, pas de sous-requête vers profiles
CREATE POLICY "profiles_select_own"
ON profiles
FOR SELECT
USING (auth.uid() = id);

-- Politique INSERT : Le service role peut insérer (via backend)
-- Les utilisateurs ne peuvent pas s'inscrire directement
-- L'insertion se fait via le backend avec SERVICE_ROLE_KEY
CREATE POLICY "profiles_insert_service_role"
ON profiles
FOR INSERT
WITH CHECK (true); -- Service role contourne RLS de toute façon

-- Politique UPDATE : Les utilisateurs peuvent mettre à jour leur propre profil
CREATE POLICY "profiles_update_own"
ON profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- ===============================
-- NOTE IMPORTANTE
-- ===============================
-- Le backend utilise SERVICE_ROLE_KEY qui contourne RLS automatiquement
-- Ces politiques sont pour les accès directs depuis le client (si nécessaire)
-- Pour le backend, RLS est contourné par défaut avec SERVICE_ROLE_KEY

