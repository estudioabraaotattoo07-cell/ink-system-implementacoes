import { NextRequest, NextResponse } from "next/server";
import { autenticarChamador } from "@/lib/auth/autenticarChamador";
import { createAdminClient } from "@/lib/supabase/admin";
import { excedeuLimite, origemPermitida, respostaCors, usuarioTemAcessoCrm } from "@/lib/integracoes/seguranca";
import {
  ErroConexao, ativarWhatsapp, lerConfigMeta, usuarioHabilitadoWhatsapp, validarPedidoAtivacao,
} from "@/lib/integracoes/metaWhatsapp";

// Integração Meta WhatsApp — Fase 3. POST: inscreve a WABA no webhook do app,
// registra o número na Cloud API (PIN de 6 dígitos, só quando necessário) e
// promove 'conectando' -> 'conectado'. Só laboratório. O PIN nunca é gravado,
// registrado em log nem devolvido. Portões idênticos aos de
// /api/whatsapp/conexao.

const responder = (req: Request, body: unknown, status = 200) =>
  respostaCors(NextResponse.json(body, { status }), req.headers.get("origin") || "");

export function OPTIONS(req: NextRequest) {
  return origemPermitida(req)
    ? respostaCors(new NextResponse(null, { status: 204 }), req.headers.get("origin") || "")
    : responder(req, { ok: false, erro: "acesso_nao_permitido" }, 403);
}

export async function POST(req: NextRequest) {
  if (!origemPermitida(req)) return responder(req, { ok: false, erro: "acesso_nao_permitido" }, 403);
  const auth = await autenticarChamador(req);
  if (!auth.ok || auth.tipo !== "user") return responder(req, { ok: false, erro: "nao_autenticado" }, 401);
  if (excedeuLimite(`whatsapp-ativacao:${auth.userId}`, 5)) return responder(req, { ok: false, erro: "muitas_solicitacoes" }, 429);
  const sb = createAdminClient();
  if (!(await usuarioTemAcessoCrm(sb, auth))) return responder(req, { ok: false, erro: "acesso_nao_permitido" }, 403);
  if (!usuarioHabilitadoWhatsapp(auth.userId)) return responder(req, { ok: false, erro: "acesso_nao_permitido" }, 403);
  const config = lerConfigMeta();
  if (!config) return responder(req, { ok: false, erro: "configuracao_indisponivel" }, 500);
  const pedido = validarPedidoAtivacao(await req.json().catch(() => null));
  if (!pedido) return responder(req, { ok: false, erro: "payload_invalido" }, 400);

  try {
    const resultado = await ativarWhatsapp({ sb, userId: auth.userId, pin: pedido.pin, config });
    return responder(req, { ok: true, ...resultado });
  } catch (erro) {
    const falha = erro instanceof ErroConexao ? erro : new ErroConexao("falha_interna", 500);
    // Só o código curto no log (nunca PIN, token ou resposta da Meta).
    console.error("whatsapp/ativacao:", falha.codigo);
    if (falha.status === 409 || falha.status === 429) return responder(req, { ok: false, erro: falha.codigo }, falha.status);
    if (falha.status === 502) return responder(req, { ok: false, erro: "meta_recusou", codigo: falha.codigo }, 502);
    return responder(req, { ok: false, erro: falha.codigo === "credencial_invalida" ? falha.codigo : "falha_interna" }, 500);
  }
}
