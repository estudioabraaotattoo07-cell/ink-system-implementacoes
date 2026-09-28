// lib/integracoes/metaWebhook.test.ts
//
// Integração Meta WhatsApp — Fase 3 (webhook). Executa as funções da lib e a
// PRÓPRIA rota (app/api/whatsapp/webhook/route.ts) com NextRequest, sem rede e
// sem banco reais.
//
// Rodar com:
//   node --import ./scripts/_harness/register-hook.mjs --test lib/integracoes/metaWebhook.test.ts

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const SEGREDO = "segredo-do-app-de-teste";
const VERIFY = "token-de-verificacao-com-mais-de-32-caracteres-xyz";
process.env.META_APP_SECRET = SEGREDO;
process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY;

const { assinaturaValida, responderVerificacao, extrairEventos, registrarSinalDeVida, CAMPO_PROCESSADO } =
  await import("@/lib/integracoes/metaWebhook");
const rota = await import("@/app/api/whatsapp/webhook/route");
const { NextRequest } = await import("next/server");
const srcRota = readFileSync(new URL("../../app/api/whatsapp/webhook/route.ts", import.meta.url), "utf8");
const srcLib = readFileSync(new URL("./metaWebhook.ts", import.meta.url), "utf8");

const WABA = "102290129340398";
const assinar = (bytes: Buffer, segredo = SEGREDO) => "sha256=" + createHmac("sha256", segredo).update(bytes).digest("hex");
const params = (o: Record<string, string>) => new URLSearchParams(o);

// payload realista: conteúdo e telefone do cliente final presentes (e que NUNCA podem ser gravados/logados)
const payloadMensagem = (wabaId = WABA) => ({
  object: "whatsapp_business_account",
  entry: [{
    id: wabaId,
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "5527999990000", phone_number_id: "106540352242922" },
        contacts: [{ profile: { name: "Cliente Final Secreto" }, wa_id: "5527988887777" }],
        messages: [{ from: "5527988887777", id: "wamid.X", timestamp: "1790000000", type: "text", text: { body: "Olá, quero agendar ção 😀" } }],
      },
    }],
  }],
});

// ═══════════════════════════════════════════════════════════════════════════
// Assinatura X-Hub-Signature-256
// ═══════════════════════════════════════════════════════════════════════════

test("assinatura: HMAC-SHA256 do App Secret sobre os bytes brutos, formato sha256=<hex>", () => {
  const bruto = Buffer.from(JSON.stringify(payloadMensagem()), "utf8");
  assert.equal(assinaturaValida(bruto, assinar(bruto), SEGREDO), true);
  assert.equal(assinaturaValida(bruto, assinar(bruto).toUpperCase().replace("SHA256=", "sha256="), SEGREDO), true, "hex maiúsculo");
});

test("assinatura: inválida, ausente, prefixo errado, hex malformado, outro segredo ou 1 byte alterado -> recusa", () => {
  const bruto = Buffer.from(JSON.stringify(payloadMensagem()), "utf8");
  const ok = assinar(bruto);
  assert.equal(assinaturaValida(bruto, null, SEGREDO), false);
  assert.equal(assinaturaValida(bruto, "", SEGREDO), false);
  assert.equal(assinaturaValida(bruto, ok.replace("sha256=", "sha1="), SEGREDO), false);
  assert.equal(assinaturaValida(bruto, ok.slice(0, -1), SEGREDO), false, "63 hex");
  assert.equal(assinaturaValida(bruto, ok + "0", SEGREDO), false, "65 hex");
  assert.equal(assinaturaValida(bruto, "sha256=" + "z".repeat(64), SEGREDO), false);
  assert.equal(assinaturaValida(bruto, assinar(bruto, "outro-segredo"), SEGREDO), false);
  const alterado = Buffer.from(bruto); alterado[10] ^= 1;
  assert.equal(assinaturaValida(alterado, ok, SEGREDO), false);
  assert.equal(assinaturaValida(bruto, ok, ""), false, "sem segredo configurado nunca valida");
});

test("assinatura: vale para os bytes EXATOS -- o mesmo JSON reserializado (espaços, acentos escapados) não passa", () => {
  const original = Buffer.from('{"object": "whatsapp_business_account", "texto": "ção 😀"}', "utf8");
  const reserializado = Buffer.from(JSON.stringify(JSON.parse(original.toString("utf8"))), "utf8");
  assert.notDeepEqual(original, reserializado);
  assert.equal(assinaturaValida(original, assinar(original), SEGREDO), true);
  assert.equal(assinaturaValida(reserializado, assinar(original), SEGREDO), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Verificação (GET hub.challenge)
// ═══════════════════════════════════════════════════════════════════════════

test("verificação: subscribe + token certo -> 200 com o challenge", () => {
  assert.deepEqual(responderVerificacao(params({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1158201444" })),
    { status: 200, corpo: "1158201444" });
});

test("verificação: token errado/menor, modo errado, variável ausente -> 403; challenge não numérico -> 400", () => {
  const base = { "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "123" };
  assert.equal(responderVerificacao(params({ ...base, "hub.verify_token": "errado" })).status, 403);
  assert.equal(responderVerificacao(params({ ...base, "hub.verify_token": VERIFY.slice(0, -1) })).status, 403);
  assert.equal(responderVerificacao(params({ ...base, "hub.mode": "unsubscribe" })).status, 403);
  assert.equal(responderVerificacao(params(base), {} as any).status, 403, "sem META_WEBHOOK_VERIFY_TOKEN ninguém verifica");
  assert.equal(responderVerificacao(params({ ...base, "hub.challenge": "<script>" })).status, 400);
  assert.equal(responderVerificacao(params({ ...base, "hub.challenge": "" })).status, 400);
  assert.match(srcLib, /igualTempoConstante\(Buffer\.from\(recebido, "utf8"\), Buffer\.from\(esperado, "utf8"\)\)/, "comparação em tempo constante");
});

// ═══════════════════════════════════════════════════════════════════════════
// Extração mínima: só 'messages', só o id da WABA
// ═══════════════════════════════════════════════════════════════════════════

test("extração: só o campo 'messages' conta; outros campos, entradas sem id válido e objetos alheios são ignorados", () => {
  assert.equal(CAMPO_PROCESSADO, "messages");
  assert.equal(extrairEventos({ object: "page", entry: [] }), null);
  assert.equal(extrairEventos(null), null);
  const r = extrairEventos({
    object: "whatsapp_business_account",
    entry: [
      { id: WABA, changes: [{ field: "messages", value: {} }, { field: "messages", value: {} }, { field: "account_update", value: {} }] },
      { id: WABA, changes: [{ field: "messages", value: {} }] },
      { id: "999", changes: [{ field: "account_update", value: {} }] },
      { id: "abc", changes: [{ field: "messages", value: {} }] },
    ],
  });
  assert.deepEqual(r, { wabaIds: [WABA], mudancas: 3 });
});

test("extração: o resultado não carrega nenhum conteúdo, telefone ou nome do cliente final", () => {
  const r = extrairEventos(payloadMensagem());
  assert.deepEqual(r, { wabaIds: [WABA], mudancas: 1 });
  assert.doesNotMatch(JSON.stringify(r), /Olá|5527988887777|Cliente Final|106540352242922|wamid/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Sinal de vida (única escrita do webhook)
// ═══════════════════════════════════════════════════════════════════════════

// falhas: { leitura?: erro, escrita?: erro, escritaVazia?: true }
function fakeSb(linhas: Record<string, any>[], falhas: Record<string, any> = {}) {
  const ops: { op: string; valores: any; filtros: [string, any][] }[] = [];
  const from = () => {
    let op = "select"; let valores: any = null; let retornar = false; const filtros: [string, any][] = [];
    const executar = async () => {
      ops.push({ op, valores, filtros: [...filtros] });
      const alvo = linhas.filter((l) => filtros.every(([c, v]) => l[c] === v));
      if (op === "select") {
        if (falhas.leitura) return { data: null, error: falhas.leitura };
        return { data: alvo[0] ? { ...alvo[0] } : null, error: null };
      }
      if (falhas.escrita) return { data: null, error: falhas.escrita };
      if (falhas.escritaVazia) return { data: [], error: null };
      alvo.forEach((l) => Object.assign(l, valores));
      return { data: retornar ? alvo.map((l) => ({ ...l })) : null, error: null };
    };
    const b: any = {
      select: () => { if (op === "update") retornar = true; else op = "select"; return b; },
      update: (v: any) => { op = "update"; valores = v; return b; },
      eq: (c: string, v: any) => { filtros.push([c, v]); return b; },
      maybeSingle: () => executar(),
      then: (ok: any, erro: any) => executar().then(ok, erro),
    };
    return b;
  };
  return { sb: { from } as any, ops, linhas };
}

test("sinal de vida: WABA conhecida grava SÓ webhook_ultimo_evento_em; WABA desconhecida não grava nada", async () => {
  const { sb, ops, linhas } = fakeSb([{ user_id: "u1", waba_id: WABA, webhook_ultimo_evento_em: null }]);
  const agora = new Date("2026-09-28T12:00:00Z");
  assert.equal(await registrarSinalDeVida(sb, [WABA, "555"], agora), 1);
  const escritas = ops.filter((o) => o.op === "update");
  assert.equal(escritas.length, 1);
  assert.deepEqual(escritas[0].valores, { webhook_ultimo_evento_em: "2026-09-28T12:00:00.000Z" });
  assert.deepEqual(escritas[0].filtros, [["waba_id", WABA]]);
  assert.equal(linhas[0].webhook_ultimo_evento_em, "2026-09-28T12:00:00.000Z");
});

test("sinal de vida: falha de escrita, escrita em 0 linhas ou falha de leitura LANÇAM (a rota responde 5xx)", async () => {
  const conhecida = () => [{ user_id: "u1", waba_id: WABA, webhook_ultimo_evento_em: null }];
  await assert.rejects(registrarSinalDeVida(fakeSb(conhecida(), { escrita: { code: "XX000" } }).sb, [WABA]), /falha_escrita/);
  await assert.rejects(registrarSinalDeVida(fakeSb(conhecida(), { escritaVazia: true }).sb, [WABA]), /falha_escrita/);
  await assert.rejects(registrarSinalDeVida(fakeSb(conhecida(), { leitura: { code: "XX000" } }).sb, [WABA]), /falha_leitura/);
  // WABA desconhecida: nenhuma escrita, nenhum erro -- mesmo que a escrita estivesse quebrada
  assert.equal(await registrarSinalDeVida(fakeSb([], { escrita: { code: "XX000" } }).sb, [WABA]), 0);
});

test("sinal de vida: no máximo 1 gravação por minuto por WABA", async () => {
  const { sb, ops } = fakeSb([{ user_id: "u1", waba_id: WABA, webhook_ultimo_evento_em: "2026-09-28T11:59:30.000Z" }]);
  assert.equal(await registrarSinalDeVida(sb, [WABA], new Date("2026-09-28T12:00:00Z")), 0);
  assert.equal(ops.filter((o) => o.op === "update").length, 0);
  assert.equal(await registrarSinalDeVida(sb, [WABA], new Date("2026-09-28T12:00:31Z")), 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// Rota executada de verdade (NextRequest)
// ═══════════════════════════════════════════════════════════════════════════

const URL_WEBHOOK = "https://ink-system-implementacoes.vercel.app/api/whatsapp/webhook";
const postar = (bytes: Buffer, assinatura: string | null) => rota.POST(new NextRequest(URL_WEBHOOK, {
  method: "POST",
  body: new Uint8Array(bytes), // mesmos bytes, tipo aceito por BodyInit
  headers: { "Content-Type": "application/json", ...(assinatura ? { "X-Hub-Signature-256": assinatura } : {}) },
}));

test("rota GET: verificação real da Meta devolve o challenge em texto puro", async () => {
  const ok = await rota.GET(new NextRequest(`${URL_WEBHOOK}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=987654`));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "987654");
  assert.match(ok.headers.get("content-type") || "", /text\/plain/);
  const nao = await rota.GET(new NextRequest(`${URL_WEBHOOK}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`));
  assert.equal(nao.status, 403);
});

test("rota POST: assinatura inválida ou ausente -> 401", async () => {
  const bruto = Buffer.from(JSON.stringify(payloadMensagem()), "utf8");
  assert.equal((await postar(bruto, null)).status, 401);
  assert.equal((await postar(bruto, assinar(bruto, "outro"))).status, 401);
});

test("rota POST: assinada sobre os bytes brutos com acentos/emoji -> 200 (objeto alheio, sem tocar o banco)", async () => {
  const bruto = Buffer.from('{"object":"page","texto":"ção 😀"}', "utf8");
  const r = await postar(bruto, assinar(bruto));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "EVENT_RECEIVED");
});

test("rota POST: JSON malformado com assinatura válida -> 400; sem META_APP_SECRET -> 503", async () => {
  const ruim = Buffer.from("{nao-e-json", "utf8");
  assert.equal((await postar(ruim, assinar(ruim))).status, 400);
  delete process.env.META_APP_SECRET;
  try {
    const bruto = Buffer.from("{}", "utf8");
    assert.equal((await postar(bruto, assinar(bruto))).status, 503);
  } finally {
    process.env.META_APP_SECRET = SEGREDO;
  }
});

// ── rota POST com WABA real contra um PostgREST falso ─────────────────────
// A rota cria o cliente Supabase de verdade (createAdminClient); só o fetch
// para o "banco" é interceptado.

async function comBancoFalso(opcoes: { linha?: Record<string, any> | null; falhaLeitura?: boolean; falhaEscrita?: boolean }, fn: () => Promise<void>) {
  const envAntes = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, chave: process.env.SUPABASE_SERVICE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://banco-falso.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "chave-servico-falsa";
  const fetchOriginal = globalThis.fetch;
  const pedidos: { metodo: string; url: string; corpo: string }[] = [];
  globalThis.fetch = (async (entrada: any, init: any = {}) => {
    const url = new URL(typeof entrada === "string" ? entrada : entrada.url);
    const metodo = String(init.method || entrada?.method || "GET").toUpperCase();
    const corpo = init.body ? String(init.body) : "";
    pedidos.push({ metodo, url: url.href, corpo });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (metodo === "GET") {
      if (opcoes.falhaLeitura) return json({ message: "falha" }, 500);
      const linhas = opcoes.linha ? [opcoes.linha] : [];
      const aceita = String(new Headers(init.headers || {}).get("accept") || "");
      return aceita.includes("vnd.pgrst.object") ? (linhas[0] ? json(linhas[0]) : json({ code: "PGRST116" }, 406)) : json(linhas);
    }
    if (opcoes.falhaEscrita) return json({ message: "falha" }, 500);
    return json(opcoes.linha ? [{ user_id: opcoes.linha.user_id }] : []);
  }) as any;
  try {
    await fn();
  } finally {
    globalThis.fetch = fetchOriginal;
    process.env.NEXT_PUBLIC_SUPABASE_URL = envAntes.url;
    process.env.SUPABASE_SERVICE_KEY = envAntes.chave;
  }
  return pedidos;
}

const eventoAssinado = () => {
  const bruto = Buffer.from(JSON.stringify(payloadMensagem()), "utf8");
  return { bruto, assinatura: assinar(bruto) };
};
const LINHA = { user_id: "u1", waba_id: WABA, webhook_ultimo_evento_em: null };

test("rota POST: WABA conhecida e sinal de vida gravado -> 200; o banco recebe só o instante", async () => {
  let status = 0;
  const pedidos = await comBancoFalso({ linha: LINHA }, async () => {
    const { bruto, assinatura } = eventoAssinado();
    status = (await postar(bruto, assinatura)).status;
  });
  assert.equal(status, 200);
  const escrita = pedidos.find((p) => p.metodo === "PATCH")!;
  assert.deepEqual(Object.keys(JSON.parse(escrita.corpo)), ["webhook_ultimo_evento_em"]);
  assert.ok(Number.isFinite(Date.parse(JSON.parse(escrita.corpo).webhook_ultimo_evento_em)));
  assert.doesNotMatch(JSON.stringify(pedidos), /Olá|5527988887777|Cliente Final|wamid/, "nada do conteúdo vai ao banco");
});

test("rota POST: WABA conhecida e a gravação do sinal de vida FALHA -> 503 (Meta reentrega)", async () => {
  let status = 0;
  await comBancoFalso({ linha: LINHA, falhaEscrita: true }, async () => {
    const { bruto, assinatura } = eventoAssinado();
    status = (await postar(bruto, assinatura)).status;
  });
  assert.equal(status, 503);
});

test("rota POST: falha ao LER o banco (não dá para saber se a WABA é conhecida) -> 503", async () => {
  let status = 0;
  await comBancoFalso({ falhaLeitura: true }, async () => {
    const { bruto, assinatura } = eventoAssinado();
    status = (await postar(bruto, assinatura)).status;
  });
  assert.equal(status, 503);
});

test("rota POST: WABA desconhecida -> 200 sem escrita, mesmo com a escrita do banco quebrada", async () => {
  let status = 0;
  const pedidos = await comBancoFalso({ linha: null, falhaEscrita: true }, async () => {
    const { bruto, assinatura } = eventoAssinado();
    status = (await postar(bruto, assinatura)).status;
  });
  assert.equal(status, 200);
  assert.ok(!pedidos.some((p) => p.metodo !== "GET"));
});

test("rota POST: evento sem 'messages' -> 200 sem tocar o banco", async () => {
  let status = 0;
  const pedidos = await comBancoFalso({ linha: LINHA, falhaEscrita: true, falhaLeitura: true }, async () => {
    const bruto = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "account_update", value: {} }] }] }), "utf8");
    status = (await postar(bruto, assinar(bruto))).status;
  });
  assert.equal(status, 200);
  assert.equal(pedidos.length, 0);
});

test("rota (fonte): runtime nodejs, dinâmica, arrayBuffer ANTES do parse, nunca req.json(), sem CORS/origem", () => {
  assert.match(srcRota, /export const runtime = "nodejs";/);
  assert.match(srcRota, /export const dynamic = "force-dynamic";/);
  const iBruto = srcRota.indexOf("await req.arrayBuffer()");
  const iAssinatura = srcRota.indexOf("assinaturaValida(bruto");
  const iParse = srcRota.indexOf("JSON.parse(");
  assert.ok(iBruto !== -1 && iBruto < iAssinatura && iAssinatura < iParse);
  assert.doesNotMatch(srcRota, /req\.json\(|req\.text\(/);
  assert.doesNotMatch(srcRota, /origemPermitida|respostaCors|Access-Control|autenticarChamador/);
});

test("rota/lib: logs só com código ou contagem -- nunca conteúdo, telefones ou IDs", () => {
  const logs = srcRota.match(/console\.(log|error|warn|info)\([^)]*\)/g) || [];
  assert.deepEqual(logs, [
    'console.error("whatsapp/webhook: falha_sinal_de_vida")',
    'console.info("whatsapp/webhook: mudancas_messages", eventos ? eventos.mudancas : 0)',
  ]);
  assert.doesNotMatch(srcLib.replace(/\/\/[^\n]*/g, ""), /console\./);
  // a única gravação possível é o instante do sinal de vida
  const escritas = srcLib.match(/\.update\(\{[^}]*\}\)/g) || [];
  assert.deepEqual(escritas, [".update({ webhook_ultimo_evento_em: agora.toISOString() })"]);
  assert.doesNotMatch(srcLib, /\.insert\(|\.upsert\(|\.delete\(/);
});
