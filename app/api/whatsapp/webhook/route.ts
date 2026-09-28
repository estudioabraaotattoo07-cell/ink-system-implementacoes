import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assinaturaValida, extrairEventos, registrarSinalDeVida, responderVerificacao } from "@/lib/integracoes/metaWebhook";

// Integração Meta WhatsApp — Fase 3. Rota PÚBLICA chamada pela Meta
// (servidor a servidor): sem origem/sessão/CORS. A proteção é o verify token
// no GET e a assinatura X-Hub-Signature-256 no POST, calculada sobre os
// bytes BRUTOS do corpo -- por isso arrayBuffer() antes de qualquer parse.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const texto = (corpo: string, status: number) =>
  new NextResponse(corpo, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export function GET(req: NextRequest) {
  const { status, corpo } = responderVerificacao(req.nextUrl.searchParams);
  return texto(corpo, status);
}

export async function POST(req: NextRequest) {
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  if (!appSecret) return texto("Service Unavailable", 503);

  const bruto = Buffer.from(await req.arrayBuffer());
  if (!assinaturaValida(bruto, req.headers.get("x-hub-signature-256"), appSecret)) return texto("Unauthorized", 401);

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bruto));
  } catch {
    return texto("Bad Request", 400);
  }

  const eventos = extrairEventos(payload);
  if (eventos && eventos.wabaIds.length > 0) {
    try {
      await registrarSinalDeVida(createAdminClient(), eventos.wabaIds);
    } catch {
      // Assinatura válida e evento processável, mas o sinal de vida não foi
      // gravado (falha de leitura -- não se sabe se a WABA é conhecida -- ou
      // de escrita numa WABA conhecida): 503 para a Meta entregar de novo.
      // Nada do payload é guardado. Log só com código curto.
      console.error("whatsapp/webhook: falha_sinal_de_vida");
      return texto("Service Unavailable", 503);
    }
  }
  // WABA desconhecida, sinal já gravado há menos de 1 min ou evento não
  // processado ('messages' ausente, objeto alheio): 200.
  // Só contagem no log -- nunca conteúdo, telefones ou IDs.
  console.info("whatsapp/webhook: mudancas_messages", eventos ? eventos.mudancas : 0);
  return texto("EVENT_RECEIVED", 200);
}
