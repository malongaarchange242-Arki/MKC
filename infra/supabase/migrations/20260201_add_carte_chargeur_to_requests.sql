-- Migration: Add carte_chargeur column to requests

-- Add nullable text column to store charger card number provided by client
ALTER TABLE IF EXISTS requests
ADD COLUMN IF NOT EXISTS carte_chargeur text NULL;

-- Optional index to speed up lookups by carte_chargeur
CREATE INDEX IF NOT EXISTS idx_requests_carte_chargeur ON requests (carte_chargeur);
