// Conexión con Supabase. La URL y la clave anon son públicas (igual viajan en la página).
// Se pueden cambiar con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY al construir.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
export const ONLINE = Boolean(SUPABASE_URL && SUPABASE_KEY);
