import type { SupabaseClient } from "@supabase/supabase-js";

export const ORIGENS_CRM = [
  "https://inq-saas.vercel.app",
  "https://inksystem.com.br",
  "https://www.inksystem.com.br",
  "https://acasadoscarvalhotattoo.com.br",
  "https://www.acasadoscarvalhotattoo.com.br",
];
const OWNER_EMAIL = "estudioabraaotattoo07@gmail.com";

export function origemPermitida(req: Request) {
  const origem = req.headers.get("origin") || "";
  if (ORIGENS_CRM.includes(origem)) return true;
  try {
    const host = new URL(origem).hostname;
    return /^inq-saas-[a-z0-9-]+-estudioabraaotattoo07-cells-projects\.vercel\.app$/i.test(host);
  } catch {
    return false;
  }
}

export async function usuarioTemAcessoCrm(sb: SupabaseClient, auth: { userId: string; email: string }) {
  if (auth.email.toLowerCase() === OWNER_EMAIL) return true;
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb.from("licencas").select("status,data_vencimento").eq("user_id", auth.userId).limit(1).maybeSingle();
  return !error && data?.status === "ativo" && String(data.data_vencimento || "") >= hoje;
}

export function respostaCors(resposta: Response, origem: string) {
  if (origemPermitida(new Request("https://interno.invalid", { headers: { origin: origem } }))) resposta.headers.set("Access-Control-Allow-Origin", origem);
  resposta.headers.set("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  resposta.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Implementacoes-Service-Key");
  resposta.headers.set("Vary", "Origin");
  return resposta;
}

const requisicoes = new Map<string, { quantidade: number; reiniciaEm: number }>();

export function excedeuLimite(chave: string, maximo: number, janelaMs = 60_000) {
  const agora = Date.now();
  const atual = requisicoes.get(chave);
  if (!atual || atual.reiniciaEm <= agora) {
    requisicoes.set(chave, { quantidade: 1, reiniciaEm: agora + janelaMs });
    return false;
  }
  atual.quantidade += 1;
  return atual.quantidade > maximo;
}
