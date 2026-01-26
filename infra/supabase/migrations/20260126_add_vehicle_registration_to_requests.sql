-- Migration: Add vehicle_registration column to requests

ALTER TABLE IF EXISTS requests
ADD COLUMN IF NOT EXISTS vehicle_registration text NULL;

-- Optional: create index if you plan to search by vehicle_registration
CREATE INDEX IF NOT EXISTS idx_requests_vehicle_registration ON requests (vehicle_registration);
