import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('placeholder'));

if (!hasSupabaseConfig) {
  console.warn('⚠️ Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env to enable cloud sync across devices.');
}

export const supabaseReady = hasSupabaseConfig;
export const supabase = createClient(
  hasSupabaseConfig ? supabaseUrl : 'https://placeholder.supabase.co',
  hasSupabaseConfig ? supabaseAnonKey : 'placeholder-key'
);