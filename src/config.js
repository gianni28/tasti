// Conexión con Supabase. La URL y la clave publicable son públicas (igual viajan en la página).
// Se pueden cambiar con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY al construir.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://qbufidbzpnblxmzvxwel.supabase.co";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_ZPDRtrGPpIIUlXX5i7iWzA_n_rW1oje";
export const ONLINE = Boolean(SUPABASE_URL && SUPABASE_KEY);
