import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Prova de vida da fundação (Bloco 4.7): confirma que o deploy funciona e
// que a conexão com o Supabase compartilhado é genuína -- não só que as
// variáveis de ambiente existem. Usa auth.admin.listUsers (infraestrutura
// do próprio Supabase, não uma tabela de negócio) de propósito: esta rota
// não deve conhecer nenhuma tabela de CRM, Plataforma ou de domínio.
// Descreve a forma da chave sem nunca devolver o valor -- comprimento e
// prefixo bastam pra diagnosticar (JWT legado "eyJ..." vs. chave nova
// "sb_secret_..." do Supabase), sem expor nada sensível na resposta.
function formaDaChave(v: string | undefined) {
  if (!v) return "ausente";
  const prefixo = v.startsWith("eyJ") ? "jwt-legado" : v.startsWith("sb_secret_") ? "sb_secret" : v.startsWith("sb_publishable_") ? "sb_publishable" : "desconhecido";
  return `presente, ${v.length} chars, prefixo=${prefixo}`;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const diagnostico = {
    url_host: url ? new URL(url).host : "ausente",
    service_key_forma: formaDaChave(process.env.SUPABASE_SERVICE_KEY),
    anon_key_forma: formaDaChave(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };

  // 1. Ping cru ao REST do Postgrest -- mais simples e universal que a Auth
  // Admin API, isola se o problema é a chave/URL em si ou algo específico
  // do endpoint de admin de usuários.
  let restOk = false;
  let restDetalhe = "";
  try {
    const r = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY || "" },
    });
    restOk = r.ok;
    restDetalhe = `status ${r.status}`;
  } catch (e) {
    restDetalhe = e instanceof Error ? `${e.name}: ${e.message}${e.cause ? " | cause: " + String(e.cause) : ""}` : String(e);
  }

  // 2. Auth Admin API -- a prova de vida original desta rota.
  let authOk = false;
  let authDetalhe = "";
  try {
    const sb = createAdminClient();
    const { error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
    authOk = !error;
    authDetalhe = error ? error.message : "ok";
  } catch (e) {
    authDetalhe = e instanceof Error ? `${e.name}: ${e.message}${e.cause ? " | cause: " + String(e.cause) : ""}` : String(e);
  }

  const ok = restOk && authOk;
  return NextResponse.json(
    { ok, supabase: ok, diagnostico, rest: { ok: restOk, detalhe: restDetalhe }, authAdmin: { ok: authOk, detalhe: authDetalhe } },
    { status: ok ? 200 : 500 }
  );
}
