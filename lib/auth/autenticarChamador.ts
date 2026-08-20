import { createClient } from "@supabase/supabase-js";

// Criado somente quando chega uma requisição. Assim, uma variável ausente não
// derruba o build inteiro; a autenticação falha de forma segura em tempo de uso.
function criarClienteAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

export type ResultadoAutenticacao =
  | { ok: true; tipo: "user"; userId: string; email: string; identificador: string }
  | { ok: true; tipo: "service"; identificador: string }
  | { ok: false };

// Duas das três vias da Especificação Arquitetural (§8):
//   1. Usuário -- sessão real do Supabase, header Authorization: Bearer.
//   2. Servidor-a-servidor interno -- segredo dedicado deste projeto,
//      nunca reaproveitando PROVISIONING_SERVICE_SECRET nem
//      INTERNAL_SERVICE_SECRET (segredos de outros projetos).
// A via 3 (webhook de integração de terceiro do cliente) não tem código
// aqui -- é um segredo por tenant e por integração, não um segredo global
// como as duas vias acima, e nasce junto da primeira integração real
// (Bloco 4.14), não antes.
//
// Nunca aceita um userId enviado solto no corpo como prova de identidade --
// só os dois mecanismos abaixo contam.
export async function autenticarChamador(req: Request): Promise<ResultadoAutenticacao> {
  const serviceKey = req.headers.get("x-implementacoes-service-key");
  if (serviceKey) {
    if (serviceKey === process.env.IMPLEMENTACOES_SERVICE_SECRET) {
      return { ok: true, tipo: "service", identificador: "service:ink-system" };
    }
    return { ok: false };
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token) {
    try {
      const sbAuth = criarClienteAuth();
      if (!sbAuth) return { ok: false };
      const { data, error } = await sbAuth.auth.getUser(token);
      if (!error && data?.user) {
        return { ok: true, tipo: "user", userId: data.user.id, email: data.user.email || "", identificador: `user:${data.user.id}` };
      }
    } catch (e) {
      console.error("validação de sessão falhou:", e);
    }
  }

  return { ok: false };
}
