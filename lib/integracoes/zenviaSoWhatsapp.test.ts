// lib/integracoes/zenviaSoWhatsapp.test.ts
//
// Executa o POST REAL de /api/zenvia com o fetch global falso: o endpoint só
// envia WhatsApp. Qualquer outro canal é inválido (400) e não gera nenhuma
// chamada à Zenvia.
//
// Rodar com:
//   node --import ./scripts/_harness/register-hook.mjs --test lib/integracoes/zenviaSoWhatsapp.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.IMPLEMENTACOES_SERVICE_SECRET = "segredo-servico-teste";
process.env.ZENVIA_API_KEY = "token-zenvia-teste";
process.env.ZENVIA_FROM = "remetente-teste";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_KEY = "chave-servico-falsa";

const chamadas: { url: string; corpo: unknown }[] = [];
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  chamadas.push({ url: String(url), corpo: init?.body ? JSON.parse(String(init.body)) : null });
  return new Response(JSON.stringify({ id: "msg-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { POST } = await import("@/app/api/zenvia/route");
const { NextRequest } = await import("next/server");

function pedido(corpo: unknown) {
  return new NextRequest("https://implementacoes.invalid/api/zenvia", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-implementacoes-service-key": "segredo-servico-teste" },
    body: JSON.stringify(corpo),
  });
}

test("canal diferente de whatsapp é inválido (400) e nenhuma chamada sai para a Zenvia", async () => {
  chamadas.length = 0;
  for (const canal of [undefined, "", "email", "ambos", "WHATSAPP", "outro"]) {
    const resposta = await POST(pedido({ to: "27999990000", text: "oi", canal }));
    assert.equal(resposta.status, 400, String(canal));
  }
  assert.equal(chamadas.length, 0);
});

test("WhatsApp envia, só para o endpoint de WhatsApp da Zenvia", async () => {
  chamadas.length = 0;
  const resposta = await POST(pedido({ to: "27999990000", text: "oi", canal: "whatsapp" }));
  assert.equal(resposta.status, 200);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "https://api.zenvia.com/v2/channels/whatsapp/messages");
  assert.deepEqual(chamadas[0].corpo, { from: "remetente-teste", to: "5527999990000", contents: [{ type: "text", text: "oi" }] });
});

test("a rota tem um único endpoint da Zenvia, o de WhatsApp", () => {
  const rota = readFileSync(new URL("../../app/api/zenvia/route.ts", import.meta.url), "utf8");
  assert.deepEqual(rota.match(/https:\/\/api\.zenvia\.com[^"]*/g), ["https://api.zenvia.com/v2/channels/whatsapp/messages"]);
});
