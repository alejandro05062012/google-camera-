/*
# Ultra Camera Pro: ajustes y registro de capturas

Plain-English summary: stores the camera settings of each device and a log of
every photo taken (metadata only, no image files). The app has no sign-in, so
each browser identifies itself with a random device id.

1. New Tables
- `camera_settings`: one row per device with its settings as JSON.
  - `device_id` (text, primary key)
  - `settings` (jsonb, not null)
  - `updated_at` (timestamptz)
- `camera_captures`: one row per photo or video taken.
  - `id` (uuid, primary key)
  - `device_id` (text, not null)
  - `metadata` (jsonb, not null): ISO, shutter, aperture, lens, profile, size, mode
  - `created_at` (timestamptz)

2. Security
- RLS enabled on both tables.
- Data is intentionally shared per device id (no accounts), so the anon role
  is granted only the verbs the app uses.
- camera_settings: select, insert, update (no delete).
- camera_captures: select, insert (no update or delete).

3. Notes
- Idempotent: safe to re-run.
- No existing data is modified or removed.
*/

CREATE TABLE IF NOT EXISTS camera_settings (
  device_id text PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS camera_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS camera_captures_device_created_idx
  ON camera_captures (device_id, created_at DESC);

ALTER TABLE camera_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE camera_captures ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON camera_settings TO anon, authenticated;
GRANT SELECT, INSERT ON camera_captures TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_camera_settings" ON camera_settings;
CREATE POLICY "anon_select_camera_settings" ON camera_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_camera_settings" ON camera_settings;
CREATE POLICY "anon_insert_camera_settings" ON camera_settings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_camera_settings" ON camera_settings;
CREATE POLICY "anon_update_camera_settings" ON camera_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_select_camera_captures" ON camera_captures;
CREATE POLICY "anon_select_camera_captures" ON camera_captures FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_camera_captures" ON camera_captures;
CREATE POLICY "anon_insert_camera_captures" ON camera_captures FOR INSERT
  TO anon, authenticated WITH CHECK (true);
