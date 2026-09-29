import { NextRequest, NextResponse } from "next/server";
import { autenticarChamador } from "@/lib/auth/autenticarChamador";
import { createAdminClient } from "@/lib/supabase/admin";
import { excedeuLimite, origemPermitida, respostaCors, usuarioTemAcessoCrm } from "@/lib/integracoes/seguranca";
import {
  ErroConexao, conectarWhatsapp, estadoWhatsapp, lerConfigMeta, usuarioHabilitadoWhatsapp, validarPedido,
} from "@/lib/integracoes/metaWhatsapp";

// Integração Meta WhatsApp — Fase 2. GET: estado da conexão do usuário
// autenticado. POST: recebe o retorno do Embedded Signup (code + IDs), troca o
// code por token server-to-server e grava cofre + metadados. Sem phone_number_id
// = Coexistência (o número é descoberto na WABA, no servidor). Só laboratório
// (META_WHATSAPP_USUARIOS_PERMITIDOS). Nenhuma resposta contém token.

const responder = (req: Request, body: unknown, status = 200) =>
  respostaCors(NextResponse.json(body, { status }), req.headers.get("origin") || "");

async function portoes(req: NextRequest) {
  if (!origemPermitida(req)) return { erro: responder(req, { ok: false, erro: "acesso_nao_permitido" }, 403) };
  const auth = await autenticarChamador(req);
  if (!auth.ok || auth.tipo !== "user") return { erro: responder(req, { ok: false, erro: "nao_autenticado" }, 401) };
  if (excedeuLimite(`whatsapp:${auth.userId}`, 10)) return { erro: responder(req, { ok: false, erro: "muitas_solicitacoes" }, 429) };
  const sb = createAdminClient();
  if (!(await usuarioTemAcessoCrm(sb, auth))) return { erro: responder(req, { ok: false, erro: "acesso_nao_permitido" }, 403) };
  return { auth, sb };
}

export function OPTIONS(req: NextRequest) {
  return origemPermitida(req)
    ? respostaCors(new NextResponse(null, { status: 204 }), req.headers.get("origin") || "")
    : responder(req, { ok: false, erro: "acesso_nao_permitido" }, 403);
}

export async function GET(req: NextRequest) {
  const ctx = await portoes(req); if ("erro" in ctx) return ctx.erro;
  if (!usuarioHabilitadoWhatsapp(ctx.auth.userId)) return responder(req, { habilitado: false });
  try {
    return responder(req, await estadoWhatsapp(ctx.sb, ctx.auth.userId));
  } catch {
    return responder(req, { ok: false, erro: "falha_interna" }, 500);
  }
}

export async function POST(req: NextRequest) {
  const ctx = await portoes(req); if ("erro" in ctx) return ctx.erro;
  if (!usuarioHabilitadoWhatsapp(ctx.auth.userId)) return responder(req, { ok: false, erro: "acesso_nao_permitido" }, 403);
  const config = lerConfigMeta();
  if (!config) return responder(req, { ok: false, erro: "configuracao_indisponivel" }, 500);
  const pedido = validarPedido(await req.json().catch(() => null));
  if (!pedido) return responder(req, { ok: false, erro: "payload_invalido" }, 400);

  try {
    const resultado = await conectarWhatsapp({ sb: ctx.sb, userId: ctx.auth.userId, pedido, config });
    return responder(req, { ok: true, ...resultado });
  } catch (erro) {
    const falha = erro instanceof ErroConexao ? erro : new ErroConexao("falha_interna", 500);
    // Só o código curto no log (nunca URL, token, code ou resposta da Meta).
    console.error("whatsapp/conexao:", falha.codigo);
    if (falha.status === 409) return responder(req, { ok: false, erro: "conflito_outra_conta" }, 409);
    // Coexistência: nenhum número elegível / mais de um / número demais na WABA.
    if (falha.status === 422) return responder(req, { ok: false, erro: falha.codigo }, 422);
    if (falha.status === 502) return responder(req, { ok: false, erro: "meta_recusou", codigo: falha.codigo }, 502);
    return responder(req, { ok: false, erro: falha.codigo === "cofre_falhou" || falha.codigo === "metadados_falhou" ? falha.codigo : "falha_interna" }, 500);
  }
}
