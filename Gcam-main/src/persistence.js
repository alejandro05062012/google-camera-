import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const DEVICE_KEY = 'ultra-camera-device-id';

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export async function loadPreferences(deviceId) {
  const { data, error } = await supabase
    .from('camera_settings')
    .select('settings')
    .eq('device_id', deviceId)
    .maybeSingle();
  if (error) throw error;
  return data?.settings ?? null;
}

export async function savePreferences(deviceId, preferences) {
  const { error } = await supabase
    .from('camera_settings')
    .upsert(
      { device_id: deviceId, settings: preferences, updated_at: new Date().toISOString() },
      { onConflict: 'device_id' }
    );
  if (error) throw error;
}

export async function logCapture(deviceId, metadata) {
  const { error } = await supabase
    .from('camera_captures')
    .insert({ device_id: deviceId, metadata });
  if (error) throw error;
}

export async function loadCaptureHistory(deviceId, limit = 20) {
  const { data, error } = await supabase
    .from('camera_captures')
    .select('id, metadata, created_at')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
