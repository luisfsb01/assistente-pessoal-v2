import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../lib/config.js';

const cfg = getConfig();

export const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
