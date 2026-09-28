import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Integração Meta WhatsApp — Fase 3: webhook.
//
// Referências (conferidas em 2026-09-28):
//   Verificação: GET com hub.mode=subscribe, hub.verify_token, hub.challenge;
//   responder o challenge.
//   Eventos: POST assinado em X-Hub-Signature-256 = "sha256=" + HMAC-SHA256
//   (App Secret, bytes BRUTOS do corpo). Responder 200. Lotes de até 3 MB.
//
// Política de dados desta fase: só o campo 'messages' é processado, e dele só
// se usa entry[].id (WABA) para gravar webhook_ultimo_evento_em. Conteúdo,
// payload, telefones e IDs do cliente final nunca são gravados nem logados.

export const CAMPO_PROCESSADO = "messages";
const ID_META = /^[0-9]{1,32}$/;
const INTERVALO_MINIMO_SINAL_MS = 60_000;

const igualTempoConstante = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

// ── verificação (GET) ───────────────────────────────────────────────────────

export function responderVerificacao(params: URLSearchParams, env: NodeJS.ProcessEnv = process.env) {
  const esperado = (env.META_WEBHOOK_VERIFY_TOKEN || "").trim();
  const recebido = params.get("hub.verify_token") || "";
  const desafio = params.get("hub.challenge") || "";
  // Sem token configurado ninguém verifica (fail-closed).
  if (!esperado) return { status: 403, corpo: "Forbidden" };
  if (params.get("hub.mode") !== "subscribe") return { status: 403, corpo: "Forbidden" };
  if (!igualTempoConstante(Buffer.from(recebido, "utf8"), Buffer.from(esperado, "utf8"))) return { status: 403, corpo: "Forbidden" };
  // A Meta envia um inteiro: nada além de dígitos é refletido.
  if (!/^[0-9]{1,64}$/.test(desafio)) return { status: 400, corpo: "Bad Request" };
  return { status: 200, corpo: desafio };
}

// ── assinatura (POST) ───────────────────────────────────────────────────────

export function assinaturaValida(bruto: Buffer, cabecalho: string | null, appSecret: string) {
  if (!appSecret || !cabecalho) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(cabecalho.trim());
  if (!m) return false;
  const esperada = createHmac("sha256", appSecret).update(bruto).digest();
  return igualTempoConstante(Buffer.from(m[1], "hex"), esperada);
}

// ── extração mínima ─────────────────────────────────────────────────────────
// null = não é um webhook do WhatsApp Business (ignorado com 200).

export function extrairEventos(payload: unknown) {
  if (!payload || typeof payload !== "object" || (payload as any).object !== "whatsapp_business_account") return null;
  const entradas: any[] = Array.isArray((payload as any).entry) ? (payload as any).entry : [];
  const wabaIds = new Set<string>();
  let mudancas = 0;
  for (const entrada of entradas) {
    const wabaId = String(entrada?.id ?? "");
    if (!ID_META.test(wabaId)) continue;
    const mudancasDoCampo = (Array.isArray(entrada?.changes) ? entrada.changes : [])
      .filter((c: any) => c?.field === CAMPO_PROCESSADO).length;
    if (mudancasDoCampo === 0) continue;
    mudancas += mudancasDoCampo;
    wabaIds.add(wabaId);
  }
  return { wabaIds: [...wabaIds], mudancas };
}

// ── sinal de vida ───────────────────────────────────────────────────────────
// Grava só o instante, no máximo 1 vez por minuto por WABA. WABA desconhecida
// não gera escrita nenhuma. Falha de leitura ou de escrita LANÇA erro: a rota
// responde 5xx para a Meta reentregar.

export async function registrarSinalDeVida(sb: SupabaseClient, wabaIds: string[], agora: Date = new Date()) {
  let gravados = 0;
  for (const wabaId of wabaIds.slice(0, 50)) {
    const { data, error } = await sb.from("integracoes_whatsapp").select("user_id,webhook_ultimo_evento_em")
      .eq("waba_id", wabaId).maybeSingle();
    if (error) throw new Error("falha_leitura");
    if (!data) continue;
    const ultimo = Date.parse(String((data as any).webhook_ultimo_evento_em ?? ""));
    if (Number.isFinite(ultimo) && agora.getTime() - ultimo < INTERVALO_MINIMO_SINAL_MS) continue;
    const { data: gravadas, error: erroEscrita } = await sb.from("integracoes_whatsapp")
      .update({ webhook_ultimo_evento_em: agora.toISOString() }).eq("waba_id", wabaId).select("user_id");
    // WABA conhecida (lida acima): escrever em 0 linhas também é falha.
    if (erroEscrita || !Array.isArray(gravadas) || gravadas.length !== 1) throw new Error("falha_escrita");
    gravados++;
  }
  return gravados;
}
