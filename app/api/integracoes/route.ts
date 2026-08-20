import { NextRequest, NextResponse } from "next/server";
import { autenticarChamador } from "@/lib/auth/autenticarChamador";
import { createAdminClient } from "@/lib/supabase/admin";
import { criptografarCredencial } from "@/lib/integracoes/credenciais";
import { excedeuLimite, origemPermitida, respostaCors, usuarioTemAcessoCrm } from "@/lib/integracoes/seguranca";

const PROVEDORES = ["anthropic", "zenvia"];
const OWNER_EMAIL = "estudioabraaotattoo07@gmail.com";
const responder = (req: Request, body: unknown, status = 200) => respostaCors(NextResponse.json(body, { status }), req.headers.get("origin") || "");

async function contexto(req: NextRequest) {
  if (!origemPermitida(req)) return { erro: responder(req, { error: "Acesso não permitido" }, 403) };
  const auth = await autenticarChamador(req);
  if (!auth.ok || auth.tipo !== "user") return { erro: responder(req, { error: "Não autenticado" }, 401) };
  if (excedeuLimite(`integracoes:${auth.userId}`, 30)) return { erro: responder(req, { error: "Muitas solicitações. Aguarde um minuto." }, 429) };
  const sb = createAdminClient();
  if (!(await usuarioTemAcessoCrm(sb, auth))) return { erro: responder(req, { error: "Acesso não permitido" }, 403) };
  return { auth, sb };
}

export function OPTIONS(req: NextRequest) { return origemPermitida(req) ? respostaCors(new NextResponse(null, { status: 204 }), req.headers.get("origin") || "") : responder(req, { error: "Acesso não permitido" }, 403); }

export async function GET(req: NextRequest) {
  const ctx = await contexto(req); if ("erro" in ctx) return ctx.erro;
  const { data, error } = await ctx.sb.from("integracoes_credenciais").select("provedor,status,testado_em,updated_at").eq("user_id", ctx.auth.userId).in("provedor", PROVEDORES);
  if (error) return responder(req, { error: "Não foi possível consultar as integrações." }, 500);
  const mapa = Object.fromEntries((data || []).map(item => [item.provedor, { configurada: true, status: item.status, testadoEm: item.testado_em, atualizadoEm: item.updated_at }]));
  const central = ctx.auth.email.toLowerCase() === OWNER_EMAIL && Boolean(process.env.ZENVIA_API_KEY && process.env.ZENVIA_FROM);
  return responder(req, { anthropic: mapa.anthropic || { configurada: false }, zenvia: mapa.zenvia || (central ? { configurada: true, gerenciada: true, status: "ativa" } : { configurada: false }) });
}

export async function PUT(req: NextRequest) {
  const ctx = await contexto(req); if ("erro" in ctx) return ctx.erro;
  const body = await req.json().catch(() => ({}));
  const provedor = String(body.provedor || ""); const chave = String(body.chave || "").trim();
  if (!PROVEDORES.includes(provedor) || !chave || chave.length > 500) return responder(req, { error: "Credencial inválida." }, 400);
  let segredo = chave; let testadoEm: string | null = null;
  if (provedor === "anthropic") {
    if (!chave.startsWith("sk-ant-")) return responder(req, { error: "Chave Anthropic inválida." }, 400);
    const teste = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1, messages: [{ role: "user", content: "Responda OK." }] }) });
    if (!teste.ok) return responder(req, { error: "A Anthropic recusou a chave informada." }, 400);
    testadoEm = new Date().toISOString();
  } else {
    const remetente = String(body.remetente || "").trim();
    if (!remetente || remetente.length > 100) return responder(req, { error: "Identificador Zenvia inválido." }, 400);
    segredo = JSON.stringify({ token: chave, remetente });
  }
  const agora = new Date().toISOString();
  const { error } = await ctx.sb.from("integracoes_credenciais").upsert({ user_id: ctx.auth.userId, provedor, credencial_cifrada: criptografarCredencial(segredo), status: "ativa", testado_em: testadoEm, updated_at: agora }, { onConflict: "user_id,provedor" });
  return error ? responder(req, { error: "Não foi possível proteger a credencial." }, 500) : responder(req, { ok: true, provedor, configurada: true, status: "ativa", testadoEm });
}

export async function DELETE(req: NextRequest) {
  const ctx = await contexto(req); if ("erro" in ctx) return ctx.erro;
  const provedor = req.nextUrl.searchParams.get("provedor") || "";
  if (!PROVEDORES.includes(provedor)) return responder(req, { error: "Integração inválida." }, 400);
  const { error } = await ctx.sb.from("integracoes_credenciais").delete().eq("user_id", ctx.auth.userId).eq("provedor", provedor);
  return error ? responder(req, { error: "Não foi possível desconectar." }, 500) : responder(req, { ok: true });
}
