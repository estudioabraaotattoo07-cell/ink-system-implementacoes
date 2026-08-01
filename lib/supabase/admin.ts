import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente com service role -- acesso privilegiado, só server-side. Nunca
// importar isto em código que roda no navegador.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } }
  );
}
