-- ===============================
-- DOCUMENTS TABLE SCHEMA
-- ===============================

-- Table documents
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_documents_request_id ON documents(request_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents(uploaded_at DESC);

-- ===============================
-- RLS POLICIES
-- ===============================

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Politique SELECT : Les utilisateurs peuvent voir les documents de leurs demandes
CREATE POLICY "documents_select_own_requests"
ON documents
FOR SELECT
USING (
  request_id IN (
    SELECT id FROM requests WHERE client_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('ADMIN', 'SYSTEM')
  )
);

-- Politique INSERT : Les utilisateurs peuvent uploader pour leurs demandes
CREATE POLICY "documents_insert_own_requests"
ON documents
FOR INSERT
WITH CHECK (
  request_id IN (
    SELECT id FROM requests WHERE client_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('ADMIN', 'SYSTEM')
  )
);

-- Politique DELETE : Les clients peuvent supprimer leurs documents (si demande pas soumise)
CREATE POLICY "documents_delete_own"
ON documents
FOR DELETE
USING (
  (
    uploaded_by = auth.uid()
    AND request_id IN (
      SELECT id FROM requests 
      WHERE client_id = auth.uid() 
      AND status NOT IN ('SUBMITTED', 'UNDER_REVIEW', 'DRAFT_READY', 'VALIDATED', 'ISSUED')
    )
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('ADMIN', 'SYSTEM')
  )
);

-- Note: Le backend utilise SERVICE_ROLE_KEY qui contourne RLS
-- Ces politiques sont pour les accès directs depuis le client (si nécessaire)






