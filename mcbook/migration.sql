-- MCBook — Required database migrations
-- Run these in your Supabase SQL editor (project → SQL editor)

-- ── 1. Unique constraint on customers(client_id, email) ────────────────────
-- Prevents duplicate customer rows when two concurrent bookings arrive with
-- the same email. The widget handles the 23505 conflict error gracefully.
CREATE UNIQUE INDEX IF NOT EXISTS customers_client_email_unique
  ON customers(client_id, email);

-- ── 2. Index on bookings(date) for the send-reminders cron query ───────────
CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(date);

-- ── 3. Index on bookings(status) for faster active-booking queries ──────────
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(status);

-- ── 4. Business mode on clients (service | restaurant) ───────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_mode TEXT DEFAULT 'service'
  CHECK (business_mode IN ('service', 'restaurant'));

-- ── 5. Total capacity on booking_settings (for restaurant mode) ───────────────
ALTER TABLE booking_settings ADD COLUMN IF NOT EXISTS total_capacity INTEGER;

-- ── 6. Party size on bookings ────────────────────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS party_size INTEGER DEFAULT 1;

-- ── 7. Seating areas table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seating_areas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  capacity   INTEGER NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seating_areas_client_idx ON seating_areas(client_id);

-- ── 8. Seating area foreign key on bookings ──────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS seating_area_id UUID
  REFERENCES seating_areas(id) ON DELETE SET NULL;

-- ── QUERY: Restaurants with available capacity at a given date/time ──────────
-- Replace the date and time values to find open slots across all restaurants.
-- Run this in the Supabase SQL editor.
--
-- SELECT
--   c.id,
--   c.business_name,
--   bs.total_capacity,
--   COALESCE(SUM(b.party_size), 0)                             AS booked_covers,
--   bs.total_capacity - COALESCE(SUM(b.party_size), 0)         AS available_covers
-- FROM clients c
-- JOIN booking_settings bs ON bs.client_id = c.id
-- LEFT JOIN bookings b
--   ON  b.client_id = c.id
--   AND b.date       = '2026-04-18'   -- ← change date
--   AND b.time       = '19:00'        -- ← change time (HH:MM 24h)
--   AND b.status    NOT IN ('cancelled')
-- WHERE c.business_mode = 'restaurant'
--   AND bs.total_capacity IS NOT NULL
-- GROUP BY c.id, c.business_name, bs.total_capacity
-- HAVING bs.total_capacity - COALESCE(SUM(b.party_size), 0) > 0
-- ORDER BY available_covers DESC;

-- ── 9. Cancellation deadline on booking_settings ────────────────────────────
-- How many hours before the appointment a customer can still cancel online.
-- 0 = anytime (no restriction). Default 4 hours.
ALTER TABLE booking_settings ADD COLUMN IF NOT EXISTS min_cancel_hours INTEGER DEFAULT 4;
