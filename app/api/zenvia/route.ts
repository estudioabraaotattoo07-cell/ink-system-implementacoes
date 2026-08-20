import { NextRequest, NextResponse } from "next/server";
import { autenticarChamador } from "@/lib/auth/autenticarChamador";
import { createAdminClient } from "@/lib/supabase/admin";
import { descriptografarCredencial } from "@/lib/integracoes/credenciais";
import { excedeuLimite, origemPermitida, respostaCors, usuarioTemAcessoCrm } from "@/lib/integracoes/seguranca";

const OWNER_EMAIL = "estudioabraaotattoo07@gmail.com";
const responder = (req: Request, body: unknown, status = 200) => respostaCors(NextResponse.json(body, { status }), req.headers.get("origin") || "");
export function OPTIONS(req: NextRequest) { return origemPermitida(req) ? respostaCors(new NextResponse(null, { status: 204 }), req.headers.get("origin") || "") : responder(req, { error: "Acesso não permitido" }, 403); }

export async function POST(req: NextRequest) {
  const auth = await autenticarChamador(req);
  if (!auth.ok) return responder(req, { error: "Não autenticado" }, 401);
  if (auth.tipo === "user" && !origemPermitida(req)) return responder(req, { error: "Acesso não permitido" }, 403);
  if (excedeuLimite(`zenvia:${auth.identificador}`, 30)) return responder(req, { error: "Muitas solicitações. Aguarde um minuto." }, 429);
  const sb = createAdminClient();
  if (auth.tipo === "user" && !(await usuarioTemAcessoCrm(sb, auth))) return responder(req, { error: "Acesso não permitido" }, 403);
  let token = ""; let remetente = "";
  if (auth.tipo === "service") {
    token = process.env.ZENVIA_API_KEY || ""; remetente = process.env.ZENVIA_FROM || "";
  } else {
    const { data, error } = await sb.from("integracoes_credenciais").select("credencial_cifrada").eq("user_id", auth.userId).eq("provedor", "zenvia").maybeSingle();
    if (error) return responder(req, { error: "Serviço indisponível." }, 500);
    if (data) {
      try { const c = JSON.parse(descriptografarCredencial(data.credencial_cifrada)); token = c.token || ""; remetente = c.remetente || ""; }
      catch { return responder(req, { error: "Credencial protegida inválida. Cadastre-a novamente." }, 409); }
    } else if (auth.email.toLowerCase() === OWNER_EMAIL) { token = process.env.ZENVIA_API_KEY || ""; remetente = process.env.ZENVIA_FROM || ""; }
  }
  if (!token || !remetente) return responder(req, { error: "Configure a Zenvia em Configurações → Implementações." }, 409);
  const body = await req.json().catch(() => ({})); const { to, text, canal } = body;
  if (!to || !text || !["sms", "whatsapp"].includes(canal)) return responder(req, { error: "Mensagem inválida." }, 400);
  const digitos = String(to).replace(/\D/g, ""); const destino = digitos.startsWith("55") ? digitos : "55" + digitos;
  const endpoint = canal === "whatsapp" ? "https://api.zenvia.com/v2/channels/whatsapp/messages" : "https://api.zenvia.com/v2/channels/sms/messages";
  const resposta = await fetch(endpoint, { method: "POST", headers: { "X-API-TOKEN": token, "Content-Type": "application/json" }, body: JSON.stringify({ from: remetente, to: destino, contents: [{ type: "text", text: String(text).slice(0, 5000) }] }) });
  const json = await resposta.json().catch(() => ({})); return resposta.ok ? responder(req, json) : responder(req, { error: "A Zenvia recusou o envio." }, resposta.status);
}
