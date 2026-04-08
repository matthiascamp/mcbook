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
