-- =========================================================
-- Supabase schema aligned with the current backend code usage
-- =========================================================
-- This version preserves the table names currently used by the app
-- and keeps them compatible with PostgreSQL/Supabase.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================
-- Enums
-- =========================
CREATE TYPE user_role AS ENUM ('CLIENT', 'ADMIN', 'SYSTEM');
CREATE TYPE request_type AS ENUM ('IMPORT', 'EXPORT', 'FERI_ONLY', 'AD_ONLY', 'FERI_AND_AD', 'OTHER');
CREATE TYPE request_status AS ENUM ('DRAFT', 'PENDING', 'CREATED', 'AWAITING_DOCUMENTS', 'AWAITING_PAYMENT', 'SUBMITTED', 'PROCESSING', 'UNDER_REVIEW', 'DRAFT_SENT', 'PROFORMAT_SENT', 'PAYMENT_PROOF_UPLOADED', 'PAYMENT_CONFIRMED', 'VALIDATED', 'ISSUED', 'APPROVED', 'REJECTED', 'CANCELLED', 'PAID');
CREATE TYPE document_kind AS ENUM ('INVOICE', 'BL', 'PROOF_OF_PAYMENT', 'CUSTOMS', 'OTHER');
CREATE TYPE invoice_status AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED');
CREATE TYPE delivery_status AS ENUM ('PENDING', 'IN_TRANSIT', 'DELIVERED', 'FAILED');
CREATE TYPE notification_channel AS ENUM ('EMAIL', 'SMS', 'IN_APP');
CREATE TYPE dispute_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE message_direction AS ENUM ('IN', 'OUT');

-- =========================
-- profiles
-- =========================
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    prenom TEXT,
    nom TEXT,
    role user_role NOT NULL DEFAULT 'CLIENT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- requests
-- =========================
CREATE TABLE requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type request_type NOT NULL,
    status request_status NOT NULL DEFAULT 'CREATED',
    ref TEXT,
    fxi_number TEXT,
    feri_number TEXT,
    vehicle_registration TEXT,
    manual_bl TEXT,
    carrier_name TEXT,
    carte_chargeur TEXT,
    transport_road_amount NUMERIC,
    transport_river_amount NUMERIC,
    cargo_route TEXT,
    bl_number TEXT,
    extracted_bl TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_requests_user_id ON requests(user_id);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_bl_number ON requests(bl_number);

-- =========================
-- documents
-- =========================
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    doc_type TEXT,
    kind document_kind NOT NULL DEFAULT 'OTHER',
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type TEXT,
    file_size BIGINT,
    checksum TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_request_id ON documents(request_id);
CREATE INDEX idx_documents_kind ON documents(kind);

-- =========================
-- document_extractions
-- =========================
CREATE TABLE document_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    bl_number TEXT,
    confidence NUMERIC(5,2),
    structured_data JSONB,
    raw_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_extractions_bl_number ON document_extractions(bl_number);

-- =========================
-- request_drafts
-- =========================
CREATE TABLE request_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_request_drafts_request_id ON request_drafts(request_id);

-- =========================
-- request_messages
-- =========================
CREATE TABLE request_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    direction message_direction NOT NULL DEFAULT 'IN',
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_request_messages_request_id ON request_messages(request_id);

-- =========================
-- messages_request
-- =========================
CREATE TABLE messages_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    direction message_direction NOT NULL DEFAULT 'IN',
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_request_request_id ON messages_request(request_id);

-- =========================
-- request_disputes
-- =========================
CREATE TABLE request_disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    raised_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    status dispute_status NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_request_disputes_request_id ON request_disputes(request_id);

-- =========================
-- notifications
-- =========================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    channel notification_channel NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    metadata JSONB,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);

-- =========================
-- audit_logs
-- =========================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    action TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);

-- =========================
-- invoices
-- =========================
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL UNIQUE,
    status invoice_status NOT NULL DEFAULT 'DRAFT',
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency CHAR(3) NOT NULL DEFAULT 'EUR',
    issued_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_request_id ON invoices(request_id);
CREATE INDEX idx_invoices_status ON invoices(status);

-- =========================
-- invoice_items
-- =========================
CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- =========================
-- payment_proofs
-- =========================
CREATE TABLE payment_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    provider TEXT,
    reference_number TEXT,
    proof_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_proofs_invoice_id ON payment_proofs(invoice_id);
CREATE INDEX idx_payment_proofs_document_id ON payment_proofs(document_id);

-- =========================
-- feri_deliveries
-- =========================
CREATE TABLE feri_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    status delivery_status NOT NULL DEFAULT 'PENDING',
    pickup_location TEXT,
    delivery_location TEXT,
    eta TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feri_deliveries_request_id ON feri_deliveries(request_id);

-- =========================
-- feri_documents
-- =========================
CREATE TABLE feri_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID REFERENCES feri_deliveries(id) ON DELETE CASCADE,
    document_name TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type TEXT,
    file_size BIGINT,
    checksum TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feri_documents_delivery_id ON feri_documents(delivery_id);

-- =========================
-- carte_chargeur
-- =========================
CREATE TABLE carte_chargeur (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    card_name TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_carte_chargeur_user_id ON carte_chargeur(user_id);

-- =========================
-- carte_chargeur_items
-- =========================
CREATE TABLE carte_chargeur_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carte_chargeur_id UUID NOT NULL REFERENCES carte_chargeur(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_carte_chargeur_items_carte_chargeur_id ON carte_chargeur_items(carte_chargeur_id);

-- =========================
-- Updated-at trigger helper
-- =========================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_requests_updated_at
BEFORE UPDATE ON requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_request_drafts_updated_at
BEFORE UPDATE ON request_drafts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_feri_deliveries_updated_at
BEFORE UPDATE ON feri_deliveries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- Optional row-level security example (Supabase-native)
-- =========================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_documents ENABLE ROW LEVEL SECURITY;

-- NOTE:
-- The file intentionally keeps the exact table names used in the app.
-- If you want the stricter Supabase-native version with more explicit RLS policies,
-- this is the right starting point.



5h7zF1pBu6a6Eexp