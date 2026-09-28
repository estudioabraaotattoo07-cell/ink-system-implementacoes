// lib/integracoes/metaWhatsapp.test.ts
//
// Integração Meta WhatsApp — Fase 2. Executa a orquestração REAL
// (conectarWhatsapp / estadoWhatsapp) com a Graph API e o Supabase falsos em
// memória: nenhuma chamada sai para a Meta nem para o banco.
//
// Rodar com:
//   node --import ./scripts/_harness/register-hook.mjs --test lib/integracoes/metaWhatsapp.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.INTEGRACOES_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const meta = await import("@/lib/integracoes/metaWhatsapp");
const { descriptografarCredencial } = await import("@/lib/integracoes/credenciais");
const {
  conectarWhatsapp, estadoWhatsapp, validarPedido, lerConfigMeta, usuarioHabilitadoWhatsapp, ErroConexao, PROVEDOR_META,
} = meta;

const APP = "1032989656347607";
const CONFIG = { appId: APP, appSecret: "segredo-do-app", versao: "v26.0" };
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OUTRO = "11111111-2222-4333-8444-555555555555";
const WABA = "102290129340398";
const PHONE = "106540352242922";
const TOKEN = "EAAGtokenDeNegocioFalsoComMaisDeVinteCaracteres";
const PEDIDO = { code: "AQBcodeFalso", wabaId: WABA, phoneNumberId: PHONE };
const src = readFileSync(new URL("./metaWhatsapp.ts", import.meta.url), "utf8");
const rota = readFileSync(new URL("../../app/api/whatsapp/conexao/route.ts", import.meta.url), "utf8");

// ── Supabase falso (só o que a lib usa) ─────────────────────────────────────

type Linhas = Record<string, any>[];
// falhas["tabela.op"]: objeto de erro (falha SEMPRE) ou lista consumida a cada
// chamada -- null = normal, { error } = falha, { vazio: true } = 0 linhas.
function fakeSb(inicial: { whatsapp?: Linhas; credenciais?: Linhas } = {}, falhas: Record<string, any> = {}) {
  const tabelas: Record<string, Linhas> = {
    integracoes_whatsapp: (inicial.whatsapp || []).map((l) => ({ ...l })),
    integracoes_credenciais: (inicial.credenciais || []).map((l) => ({ ...l })),
  };
  const ops: { tabela: string; op: string; valores: any }[] = [];
  const padrao = (tabela: string) => tabela === "integracoes_whatsapp"
    ? { waba_id: null, phone_number_id: null, business_id: null, display_phone_number: null, status: "conectando",
        webhook_inscrito_em: null, conectado_em: null, ultimo_erro: null, token_expira_em: null, atualizado_em: "2026-09-28T00:00:00Z" }
    : {};
  const violaUnico = (tabela: string, linha: any) => tabela === "integracoes_whatsapp"
    && tabelas[tabela].some((r) => r.user_id !== linha.user_id
      && ((linha.waba_id && r.waba_id === linha.waba_id) || (linha.phone_number_id && r.phone_number_id === linha.phone_number_id)));

  const from = (tabela: string) => {
    let op = "select"; let valores: any = null; let opcoes: any = null; let limite: number | null = null;
    let retornar = false;
    const filtros: ((r: any) => boolean)[] = [];
    const executar = async (unico: boolean) => {
      ops.push({ tabela, op, valores });
      const programada = falhas[`${tabela}.${op}`];
      const falha = Array.isArray(programada) ? programada.shift() : programada ? { error: programada } : null;
      if (falha?.vazio) return { data: [], error: null };
      if (falha?.error) return { data: null, error: falha.error };
      const linhas = tabelas[tabela];
      const casa = (r: any) => filtros.every((f) => f(r));
      if (op === "select") {
        // cópias, como o PostgREST real: o chamador nunca segura referência viva da "tabela"
        let d = linhas.filter(casa).map((r) => ({ ...r }));
        if (limite != null) d = d.slice(0, limite);
        return { data: unico ? (d[0] ?? null) : d, error: null };
      }
      if (op === "upsert") {
        const chaves = String(opcoes.onConflict).split(",");
        const existente = linhas.find((r) => chaves.every((k) => r[k] === valores[k]));
        const candidato = { ...(existente || padrao(tabela)), ...valores };
        if (violaUnico(tabela, candidato)) return { data: null, error: { code: "23505" } };
        if (existente) Object.assign(existente, valores); else linhas.push(candidato);
        return { data: null, error: null };
      }
      if (op === "update") {
        const afetadas = linhas.filter(casa);
        for (const r of afetadas) {
          if (violaUnico(tabela, { ...r, ...valores })) return { data: null, error: { code: "23505" } };
        }
        for (const r of afetadas) Object.assign(r, valores);
        return { data: retornar ? afetadas.map((r) => ({ ...r })) : null, error: null };
      }
      const removidas = linhas.filter(casa); // delete
      tabelas[tabela] = linhas.filter((r) => !casa(r));
      return { data: retornar ? removidas : null, error: null };
    };
    const b: any = {
      // .select() depois de update/delete = "devolva as linhas afetadas"
      select: () => { if (op === "update" || op === "delete") retornar = true; else op = "select"; return b; },
      upsert: (v: any, o: any) => { op = "upsert"; valores = v; opcoes = o; return b; },
      update: (v: any) => { op = "update"; valores = v; return b; },
      delete: () => { op = "delete"; return b; },
      eq: (c: string, v: any) => { filtros.push((r) => r[c] === v); return b; },
      neq: (c: string, v: any) => { filtros.push((r) => r[c] !== v); return b; },
      limit: (n: number) => { limite = n; return b; },
      maybeSingle: () => executar(true),
      then: (ok: any, erro: any) => executar(false).then(ok, erro),
    };
    return b;
  };
  return { sb: { from } as any, tabelas, ops };
}

// ── Graph API falsa ─────────────────────────────────────────────────────────

const OK = (body: unknown, status = 200) => ({ status, body });
function fakeMeta(sobrescrever: Record<string, () => { status: number; body: unknown } | "rede"> = {}) {
  const chamadas: { url: URL; auth: string | null }[] = [];
  const respostas: Record<string, () => { status: number; body: unknown } | "rede"> = {
    troca: () => OK({ access_token: TOKEN, token_type: "bearer" }),
    debug: () => OK({ data: { is_valid: true, app_id: APP, expires_at: 0, granular_scopes: [
      { scope: "whatsapp_business_management", target_ids: [WABA] },
      { scope: "whatsapp_business_messaging", target_ids: [WABA] },
    ] } }),
    telefones: () => OK({ data: [{ id: "999", display_phone_number: "+55 11 0000-0000" }, { id: PHONE, display_phone_number: "+55 27 99999-0000" }] }),
    ...sobrescrever,
  };
  const buscar = (async (entrada: any, init: any = {}) => {
    const url = new URL(String(entrada));
    chamadas.push({ url, auth: init.headers?.Authorization ?? null });
    const tipo = url.pathname.endsWith("/oauth/access_token") ? "troca"
      : url.pathname.endsWith("/debug_token") ? "debug"
      : url.pathname.endsWith("/phone_numbers") ? "telefones" : "desconhecido";
    const r = respostas[tipo]?.();
    if (!r) throw new Error("chamada inesperada à Meta: " + url.pathname);
    if (r === "rede") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const conectar = (sb: any, buscar: typeof fetch, pedido = PEDIDO) =>
  conectarWhatsapp({ sb, userId: USER, pedido, config: CONFIG, buscar, agora: () => new Date("2026-09-28T12:00:00Z") });

const falhaCom = async (promessa: Promise<unknown>) => {
  try { await promessa; } catch (e) { return e as InstanceType<typeof ErroConexao>; }
  assert.fail("deveria ter falhado");
};

// ═══════════════════════════════════════════════════════════════════════════
// Entrada, configuração e portão do laboratório
// ═══════════════════════════════════════════════════════════════════════════

test("payload: só code, waba_id e phone_number_id válidos; business_id e display do navegador são descartados", () => {
  const pedido = validarPedido({ code: "AQB", waba_id: WABA, phone_number_id: PHONE, business_id: "123", display_phone_number: "+55 x", user_id: OUTRO });
  assert.deepEqual(pedido, { code: "AQB", wabaId: WABA, phoneNumberId: PHONE });
  for (const ruim of [
    null, "texto", {}, { code: "", waba_id: WABA, phone_number_id: PHONE },
    { code: "com espaço", waba_id: WABA, phone_number_id: PHONE },
    { code: "x".repeat(2049), waba_id: WABA, phone_number_id: PHONE },
    { code: "AQB", waba_id: "12a", phone_number_id: PHONE },
    { code: "AQB", waba_id: WABA, phone_number_id: "1".repeat(33) },
    { code: "AQB", waba_id: 102290129340398, phone_number_id: PHONE },
  ]) assert.equal(validarPedido(ruim), null, JSON.stringify(ruim));
});

test("configuração: exige App ID numérico, App Secret e versão no formato vNN.N (sem padrão no código)", () => {
  assert.deepEqual(lerConfigMeta({ META_APP_ID: APP, META_APP_SECRET: "s", META_GRAPH_VERSION: "v26.0" } as any), { appId: APP, appSecret: "s", versao: "v26.0" });
  assert.equal(lerConfigMeta({ META_APP_ID: APP, META_GRAPH_VERSION: "v26.0" } as any), null);
  assert.equal(lerConfigMeta({ META_APP_ID: APP, META_APP_SECRET: "s", META_GRAPH_VERSION: "26" } as any), null);
  assert.equal(lerConfigMeta({ META_APP_ID: "abc", META_APP_SECRET: "s", META_GRAPH_VERSION: "v26.0" } as any), null);
  assert.equal(lerConfigMeta({} as any), null);
});

test("laboratório: allowlist por user_id; sem variável ninguém passa (fail-closed)", () => {
  const env = { META_WHATSAPP_USUARIOS_PERMITIDOS: ` ${USER.toUpperCase()} , outro-id ` } as any;
  assert.equal(usuarioHabilitadoWhatsapp(USER, env), true);
  assert.equal(usuarioHabilitadoWhatsapp(OUTRO, env), false);
  assert.equal(usuarioHabilitadoWhatsapp(USER, {} as any), false);
  assert.equal(usuarioHabilitadoWhatsapp(USER, { META_WHATSAPP_USUARIOS_PERMITIDOS: "" } as any), false);
  assert.equal(usuarioHabilitadoWhatsapp("", env), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Sucesso: termina em 'conectando' (Fase 2)
// ═══════════════════════════════════════════════════════════════════════════

test("sucesso: token cifrado no cofre, metadados gravados, status 'conectando' e conectado_em nulo", async () => {
  const { sb, tabelas } = fakeSb();
  const { buscar } = fakeMeta();
  const r = await conectar(sb, buscar);
  assert.deepEqual(r, { status: "conectando", waba_id: WABA, phone_number_id: PHONE, display_phone_number: "+55 27 99999-0000" });

  const linha = tabelas.integracoes_whatsapp[0];
  assert.equal(linha.status, "conectando");
  assert.equal(linha.conectado_em, null);
  assert.equal(linha.webhook_inscrito_em, null);
  assert.equal(linha.ultimo_erro, null);
  assert.equal(linha.waba_id, WABA);
  assert.equal(linha.phone_number_id, PHONE);
  assert.equal(linha.business_id, null, "business_id sem fonte confiável da Meta fica null");
  assert.equal(linha.display_phone_number, "+55 27 99999-0000", "número exibido vem da Meta");
  assert.equal(linha.token_expira_em, null, "expires_at = 0 => não expira");

  const cred = tabelas.integracoes_credenciais[0];
  assert.equal(cred.provedor, PROVEDOR_META);
  assert.equal(cred.status, "ativa");
  assert.ok(!String(cred.credencial_cifrada).includes(TOKEN), "token nunca em texto puro");
  const segredo = JSON.parse(descriptografarCredencial(cred.credencial_cifrada));
  assert.deepEqual(segredo, { access_token: TOKEN, obtido_em: "2026-09-28T12:00:00.000Z", app_id: APP, waba_id: WABA, phone_number_id: PHONE });
  assert.doesNotMatch(JSON.stringify(r), new RegExp(TOKEN), "token nunca volta na resposta");
});

test("sucesso: expiração do token vem do debug_token (expires_at) ou, na falta, do expires_in da troca", async () => {
  const comExpira = fakeSb();
  await conectar(comExpira.sb, fakeMeta({ debug: () => OK({ data: { is_valid: true, app_id: APP, expires_at: 1790000000, granular_scopes: [
    { scope: "whatsapp_business_management", target_ids: [WABA] }, { scope: "whatsapp_business_messaging", target_ids: [WABA] }] } }) }).buscar);
  assert.equal(comExpira.tabelas.integracoes_whatsapp[0].token_expira_em, new Date(1790000000 * 1000).toISOString());

  const comExpiresIn = fakeSb();
  await conectar(comExpiresIn.sb, fakeMeta({ troca: () => OK({ access_token: TOKEN, expires_in: 3600 }) }).buscar);
  assert.equal(comExpiresIn.tabelas.integracoes_whatsapp[0].token_expira_em, "2026-09-28T13:00:00.000Z");
});

test("sucesso: nunca grava status 'conectado' nem conectado_em nesta fase", () => {
  const codigo = src.replace(/\/\/[^\n]*/g, "");
  // toda gravação acontece dentro de conectarWhatsapp
  const gravacoes = codigo.slice(codigo.indexOf("export async function conectarWhatsapp"), codigo.indexOf("export async function estadoWhatsapp"));
  assert.doesNotMatch(gravacoes, /status:\s*"conectado"/);
  // só null (tentativa nova) ou o valor ANTERIOR (restauração) -- nunca um valor novo
  assert.deepEqual(gravacoes.match(/conectado_em:[^,\n]*/g), ["conectado_em: null", "conectado_em: anterior!.conectado_em"]);
  assert.doesNotMatch(codigo, /status:\s*"conectado"/);
});

test("ordem: conflito e 'conectando' antes da Meta; troca do code é a 1ª chamada; cofre antes dos metadados", async () => {
  const { sb, ops } = fakeSb();
  const { buscar, chamadas } = fakeMeta();
  await conectar(sb, buscar);
  assert.deepEqual(chamadas.map((c) => c.url.pathname.split("/").pop()), ["access_token", "debug_token", "phone_numbers"]);
  const escritas = ops.filter((o) => o.op !== "select").map((o) => `${o.tabela}.${o.op}`);
  assert.deepEqual(escritas, ["integracoes_whatsapp.upsert", "integracoes_credenciais.upsert", "integracoes_whatsapp.update"]);
  assert.deepEqual(ops[ops.findIndex((o) => o.op === "upsert")].valores, { user_id: USER, status: "conectando", ultimo_erro: null }, "tentativa inicia sem IDs");
});

test("segredos: App Secret só vai para a troca do code e para o debug_token; token do cliente só no cabeçalho Authorization", async () => {
  const m = fakeMeta();
  await conectar(fakeSb().sb, m.buscar);
  const [troca, debug, telefones] = m.chamadas;
  assert.equal(troca.url.searchParams.get("client_secret"), CONFIG.appSecret);
  assert.equal(troca.url.searchParams.get("code"), PEDIDO.code);
  assert.equal(debug.auth, `Bearer ${APP}|${CONFIG.appSecret}`);
  assert.equal(debug.url.searchParams.get("input_token"), TOKEN);
  assert.equal(telefones.auth, `Bearer ${TOKEN}`);
  assert.equal(telefones.url.search.includes(CONFIG.appSecret), false);
  assert.equal(telefones.url.search.includes(TOKEN), false);
  assert.ok(troca.url.href.startsWith("https://graph.facebook.com/v26.0/"));
});

// ═══════════════════════════════════════════════════════════════════════════
// Validação na Meta (IDs do navegador nunca são aceitos sem prova)
// ═══════════════════════════════════════════════════════════════════════════

const escopos = (management: string[] | undefined, messaging: string[] | undefined) => [
  { scope: "whatsapp_business_management", ...(management ? { target_ids: management } : {}) },
  { scope: "whatsapp_business_messaging", ...(messaging ? { target_ids: messaging } : {}) },
];

for (const [nome, dados, codigo] of [
  ["token inválido", { is_valid: false, app_id: APP, granular_scopes: escopos([WABA], [WABA]) }, "token_invalido"],
  ["token de outro app", { is_valid: true, app_id: "999", granular_scopes: escopos([WABA], [WABA]) }, "token_de_outro_app"],
  ["WABA fora dos target_ids", { is_valid: true, app_id: APP, granular_scopes: escopos(["555"], ["555"]) }, "waba_nao_autorizada"],
  ["target_ids ausente (fail-closed)", { is_valid: true, app_id: APP, granular_scopes: escopos(undefined, undefined) }, "waba_nao_autorizada"],
  ["falta o escopo de messaging", { is_valid: true, app_id: APP, granular_scopes: escopos([WABA], ["555"]) }, "waba_nao_autorizada"],
] as const) {
  test(`debug_token: ${nome} -> recusa, nada no cofre, status 'erro'`, async () => {
    const { sb, tabelas } = fakeSb();
    const erro = await falhaCom(conectar(sb, fakeMeta({ debug: () => OK({ data: dados }) }).buscar));
    assert.equal(erro.codigo, codigo);
    assert.equal(erro.status, 502);
    assert.equal(tabelas.integracoes_credenciais.length, 0);
    assert.equal(tabelas.integracoes_whatsapp[0].status, "erro");
    assert.equal(tabelas.integracoes_whatsapp[0].ultimo_erro, codigo);
    assert.equal(tabelas.integracoes_whatsapp[0].waba_id, null, "ID não verificado nunca é gravado");
  });
}

test("telefone: phone_number_id que não pertence à WABA é recusado", async () => {
  const { sb, tabelas } = fakeSb();
  const erro = await falhaCom(conectar(sb, fakeMeta({ telefones: () => OK({ data: [{ id: "999", display_phone_number: "+55" }] }) }).buscar));
  assert.equal(erro.codigo, "telefone_fora_da_waba");
  assert.equal(tabelas.integracoes_credenciais.length, 0);
  assert.equal(tabelas.integracoes_whatsapp[0].status, "erro");
});

test("troca do code: recusa da Meta vira código curto (sem mensagem da Meta); rede/timeout vira meta_indisponivel", async () => {
  const recusa = fakeSb();
  const e1 = await falhaCom(conectar(recusa.sb, fakeMeta({ troca: () => OK({ error: { code: 100, message: "Mensagem longa da Meta com dados" } }, 400) }).buscar));
  assert.equal(e1.codigo, "meta_troca_code:100");
  assert.equal(recusa.tabelas.integracoes_whatsapp[0].ultimo_erro, "meta_troca_code:100");
  assert.doesNotMatch(JSON.stringify(recusa.tabelas), /Mensagem longa da Meta/);

  const rede = fakeSb();
  const e2 = await falhaCom(conectar(rede.sb, fakeMeta({ troca: () => "rede" }).buscar));
  assert.equal(e2.codigo, "meta_indisponivel");

  const semToken = fakeSb();
  const e3 = await falhaCom(conectar(semToken.sb, fakeMeta({ troca: () => OK({ token_type: "bearer" }) }).buscar));
  assert.equal(e3.codigo, "meta_troca_code:sem_codigo");
});

test("conflito: WABA ou número já ligado a OUTRA conta -> 409 sem chamar a Meta", async () => {
  for (const campo of ["waba_id", "phone_number_id"]) {
    const { sb, tabelas } = fakeSb({ whatsapp: [{ user_id: OUTRO, status: "conectando", [campo]: campo === "waba_id" ? WABA : PHONE }] });
    const m = fakeMeta();
    const erro = await falhaCom(conectar(sb, m.buscar));
    assert.equal(erro.codigo, "conflito_outra_conta");
    assert.equal(erro.status, 409);
    assert.equal(m.chamadas.length, 0, "o code nem chega à Meta");
    assert.equal(tabelas.integracoes_whatsapp.find((l) => l.user_id === OUTRO)![campo], campo === "waba_id" ? WABA : PHONE, "conta alheia intacta");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Compensação e proteção contra clique duplo
// ═══════════════════════════════════════════════════════════════════════════

test("compensação: metadados falham depois do cofre -> token recém-gravado é removido e status vira 'erro'", async () => {
  const { sb, tabelas } = fakeSb({}, { "integracoes_whatsapp.update": { code: "XX000" } });
  // o update da falha também é bloqueado pelo fake; o que importa é o cofre limpo
  const erro = await falhaCom(conectar(sb, fakeMeta().buscar));
  assert.equal(erro.codigo, "metadados_falhou");
  assert.equal(tabelas.integracoes_credenciais.length, 0, "nenhum token órfão");
});

test("compensação: corrida pela mesma WABA (UNIQUE no banco) -> conflito_outra_conta e cofre limpo", async () => {
  const { sb, tabelas } = fakeSb();
  const m = fakeMeta({
    telefones: () => {
      // outra conta grava a mesma WABA enquanto a Meta responde
      tabelas.integracoes_whatsapp.push({ user_id: OUTRO, waba_id: WABA, phone_number_id: "777", status: "conectando" });
      return OK({ data: [{ id: PHONE, display_phone_number: "+55 27 99999-0000" }] });
    },
  });
  const erro = await falhaCom(conectar(sb, m.buscar));
  assert.equal(erro.codigo, "conflito_outra_conta");
  assert.equal(erro.status, 409);
  assert.equal(tabelas.integracoes_credenciais.length, 0);
  assert.equal(tabelas.integracoes_whatsapp.find((l) => l.user_id === USER)!.status, "erro");
});

// ── compensação com conexão anterior válida (bloqueador da revisão) ────────

const WABA2 = "203300000000001";
const PHONE2 = "203300000000002";
const linhaAnterior = () => ({
  user_id: USER, waba_id: WABA, phone_number_id: PHONE, business_id: null, display_phone_number: "+55 27 99999-0000",
  status: "conectando", webhook_inscrito_em: null, conectado_em: null, ultimo_erro: null,
  token_expira_em: "2027-01-01T00:00:00.000Z", atualizado_em: "2026-09-27T10:00:00Z",
});
const credencialAnterior = () => ({
  user_id: USER, provedor: PROVEDOR_META, credencial_cifrada: "v1.token-antigo-cifrado", status: "ativa",
  testado_em: "2026-09-27T10:00:00Z", updated_at: "2026-09-27T10:00:00Z", created_at: "2026-09-27T10:00:00Z",
});
const metaParaWaba2 = () => fakeMeta({
  debug: () => OK({ data: { is_valid: true, app_id: APP, expires_at: 0, granular_scopes: escopos([WABA2], [WABA2]) } }),
  telefones: () => OK({ data: [{ id: PHONE2, display_phone_number: "+55 27 98888-0000" }] }),
});

for (const [nome, pedido, meta] of [
  ["mesmos IDs (reconexão)", PEDIDO, () => fakeMeta()],
  ["IDs novos (troca de número)", { code: "AQBnovo", wabaId: WABA2, phoneNumberId: PHONE2 }, metaParaWaba2],
] as const) {
  test(`compensação com conexão anterior válida, ${nome}: token novo gravado, metadados falham -> token ANTIGO restaurado e linha intacta`, async () => {
    const { sb, tabelas, ops } = fakeSb(
      { whatsapp: [linhaAnterior()], credenciais: [credencialAnterior()] },
      { "integracoes_whatsapp.update": [{ error: { code: "XX000" } }] }, // só o UPDATE final dos metadados falha
    );
    const erro = await falhaCom(conectar(sb, meta().buscar, pedido));
    assert.equal(erro.codigo, "metadados_falhou");
    // o token novo chegou a ser gravado (a falha foi mesmo depois do cofre)...
    assert.ok(ops.some((o) => o.tabela === "integracoes_credenciais" && o.op === "upsert"));
    // ...e o cofre voltou EXATAMENTE ao anterior: nada apagado
    assert.deepEqual(tabelas.integracoes_credenciais, [credencialAnterior()]);
    assert.ok(!ops.some((o) => o.tabela === "integracoes_credenciais" && o.op === "delete"), "com credencial anterior, nunca DELETE");
    // metadados e estado anteriores intactos (IDs, número, status, ultimo_erro, expiração)
    assert.deepEqual(tabelas.integracoes_whatsapp, [linhaAnterior()]);
  });
}

test("compensação sem credencial anterior: a credencial recém-criada é removida", async () => {
  const { sb, tabelas } = fakeSb({}, { "integracoes_whatsapp.update": [{ error: { code: "XX000" } }] });
  await falhaCom(conectar(sb, fakeMeta().buscar));
  assert.equal(tabelas.integracoes_credenciais.length, 0);
  assert.equal(tabelas.integracoes_whatsapp[0].status, "erro");
  assert.equal(tabelas.integracoes_whatsapp[0].ultimo_erro, "metadados_falhou");
});

test("UPDATE final com ZERO linhas não é sucesso: compensa e registra metadados_falhou", async () => {
  const sem = fakeSb({}, { "integracoes_whatsapp.update": [{ vazio: true }] });
  const erro = await falhaCom(conectar(sem.sb, fakeMeta().buscar));
  assert.equal(erro.codigo, "metadados_falhou");
  assert.equal(sem.tabelas.integracoes_credenciais.length, 0, "token não fica órfão");
  assert.equal(sem.tabelas.integracoes_whatsapp[0].status, "erro");

  const com = fakeSb({ whatsapp: [linhaAnterior()], credenciais: [credencialAnterior()] }, { "integracoes_whatsapp.update": [{ vazio: true }] });
  await falhaCom(conectar(com.sb, fakeMeta().buscar));
  assert.deepEqual(com.tabelas.integracoes_credenciais, [credencialAnterior()]);
  assert.deepEqual(com.tabelas.integracoes_whatsapp, [linhaAnterior()]);
});

test("se a própria restauração do cofre falhar, a linha NÃO finge conexão válida: fica 'erro'", async () => {
  const { sb, tabelas } = fakeSb(
    { whatsapp: [linhaAnterior()], credenciais: [credencialAnterior()] },
    { "integracoes_whatsapp.update": [{ error: { code: "XX000" } }], "integracoes_credenciais.update": [{ error: { code: "XX000" } }] },
  );
  await falhaCom(conectar(sb, fakeMeta().buscar));
  assert.equal(tabelas.integracoes_whatsapp[0].status, "erro");
  assert.equal(tabelas.integracoes_whatsapp[0].ultimo_erro, "metadados_falhou");
});

test("sucesso confirma UMA linha atualizada (update ... .select)", () => {
  const codigo = src.replace(/\/\/[^\n]*/g, "");
  assert.match(codigo, /token_expira_em: tokenExpiraEm,\s*\}\)\.eq\("user_id", userId\)\.select\("user_id"\);\s*if \(erroMetadados \|\| !umaLinha\(atualizadas\)\)/);
  assert.match(codigo, /const umaLinha = \(data: unknown\) => Array\.isArray\(data\) && data\.length === 1;/);
});

test("clique duplo: falha com os MESMOS IDs de uma conexão já validada não a derruba (linha volta ao estado anterior)", async () => {
  const anterior = { user_id: USER, waba_id: WABA, phone_number_id: PHONE, display_phone_number: "+55 27 99999-0000", status: "conectando",
    ultimo_erro: null, conectado_em: null, business_id: null, webhook_inscrito_em: null, token_expira_em: null, atualizado_em: "x" };
  const credencial = { user_id: USER, provedor: PROVEDOR_META, credencial_cifrada: "v1.antigo", status: "ativa" };
  const { sb, tabelas } = fakeSb({ whatsapp: [anterior], credenciais: [credencial] });
  const erro = await falhaCom(conectar(sb, fakeMeta({ troca: () => OK({ error: { code: 100 } }, 400) }).buscar));
  assert.equal(erro.codigo, "meta_troca_code:100", "o chamador ainda recebe o erro");
  const linha = tabelas.integracoes_whatsapp[0];
  assert.equal(linha.status, "conectando");
  assert.equal(linha.ultimo_erro, null);
  assert.equal(linha.waba_id, WABA);
  assert.equal(tabelas.integracoes_credenciais[0].credencial_cifrada, "v1.antigo", "token anterior intacto");
});

for (const [nome, meta, codigo] of [
  ["troca do code recusada", () => fakeMeta({ troca: () => OK({ error: { code: 100 } }, 400) }), "meta_troca_code:100"],
  ["WABA B não autorizada no token", () => fakeMeta({ debug: () => OK({ data: { is_valid: true, app_id: APP, granular_scopes: escopos(["555"], ["555"]) } }) }), "waba_nao_autorizada"],
] as const) {
  test(`substituição A -> B que falha ANTES do cofre (${nome}): credencial A e linha A intactas`, async () => {
    const { sb, tabelas, ops } = fakeSb({ whatsapp: [linhaAnterior()], credenciais: [credencialAnterior()] });
    const erro = await falhaCom(conectar(sb, meta().buscar, { code: "AQBnovo", wabaId: WABA2, phoneNumberId: PHONE2 }));
    assert.equal(erro.codigo, codigo, "o chamador ainda recebe o erro");
    assert.ok(!ops.some((o) => o.tabela === "integracoes_credenciais" && o.op !== "select"), "cofre nem foi tocado");
    assert.deepEqual(tabelas.integracoes_credenciais, [credencialAnterior()]);
    assert.deepEqual(tabelas.integracoes_whatsapp, [linhaAnterior()], "conexão A preservada integralmente (não vira 'erro')");
  });
}

test("sem conexão anterior válida (linha com IDs mas SEM token no cofre), a falha continua registrada como 'erro'", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaAnterior()] });
  await falhaCom(conectar(sb, fakeMeta({ troca: () => OK({ error: { code: 100 } }, 400) }).buscar, { code: "AQBnovo", wabaId: WABA2, phoneNumberId: PHONE2 }));
  assert.equal(tabelas.integracoes_whatsapp[0].status, "erro");
  assert.equal(tabelas.integracoes_whatsapp[0].ultimo_erro, "meta_troca_code:100");
});

test("ultimo_erro: só código curto, até 500 caracteres, sem token nem code", async () => {
  const { sb, tabelas } = fakeSb();
  await falhaCom(conectar(sb, fakeMeta({ telefones: () => OK({ data: [] }) }).buscar));
  const erroGravado = String(tabelas.integracoes_whatsapp[0].ultimo_erro);
  assert.match(erroGravado, /^[a-z_:0-9]{1,500}$/);
  assert.ok(!erroGravado.includes(TOKEN) && !erroGravado.includes(PEDIDO.code));
});

// ═══════════════════════════════════════════════════════════════════════════
// GET: estado
// ═══════════════════════════════════════════════════════════════════════════

test("estado: sem linha -> conectado false, status null", async () => {
  assert.deepEqual(await estadoWhatsapp(fakeSb().sb, USER), { habilitado: true, conectado: false, status: null });
});

test("estado: 'conectando' com token e IDs armazenados continua conectado:false (Fase 2)", async () => {
  const { sb } = fakeSb();
  await conectar(sb, fakeMeta().buscar);
  const estado = await estadoWhatsapp(sb, USER);
  assert.equal(estado.conectado, false);
  assert.equal(estado.status, "conectando");
  assert.equal(estado.waba_id, WABA);
  assert.equal(estado.phone_number_id, PHONE);
  assert.doesNotMatch(JSON.stringify(estado), new RegExp(TOKEN));
  assert.deepEqual(Object.keys(estado).sort(), ["atualizado_em", "business_id", "conectado", "conectado_em", "display_phone_number",
    "habilitado", "phone_number_id", "status", "token_expira_em", "ultimo_erro", "waba_id", "webhook_inscrito_em"].sort());
});

test("estado (preparado para a Fase 3): 'conectado' só vale com token no cofre", async () => {
  const linha = { user_id: USER, waba_id: WABA, phone_number_id: PHONE, status: "conectado", conectado_em: "2026-10-01T00:00:00Z" };
  const semToken = await estadoWhatsapp(fakeSb({ whatsapp: [linha] }).sb, USER);
  assert.equal(semToken.conectado, false);
  const comToken = await estadoWhatsapp(fakeSb({ whatsapp: [linha], credenciais: [{ user_id: USER, provedor: PROVEDOR_META }] }).sb, USER);
  assert.equal(comToken.conectado, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// Rota HTTP (estrutural) e isolamento do cofre genérico
// ═══════════════════════════════════════════════════════════════════════════

test("rota: portões na ordem -- origem, sessão de usuário, limite, licença, laboratório; config e payload antes da Meta", () => {
  const portoes = rota.slice(rota.indexOf("async function portoes"), rota.indexOf("export function OPTIONS"));
  const ordem = ["origemPermitida(req)", "autenticarChamador(req)", 'auth.tipo !== "user"', "excedeuLimite(", "usuarioTemAcessoCrm("].map((t) => portoes.indexOf(t));
  ordem.forEach((p, i) => assert.ok(p !== -1 && (i === 0 || p > ordem[i - 1]), `portão fora de ordem: ${i}`));
  const post = rota.slice(rota.indexOf("export async function POST"));
  const passos = ["usuarioHabilitadoWhatsapp(", "lerConfigMeta()", "validarPedido(", "conectarWhatsapp("].map((t) => post.indexOf(t));
  passos.forEach((p, i) => assert.ok(p !== -1 && (i === 0 || p > passos[i - 1]), `passo fora de ordem: ${i}`));
  assert.match(rota, /export function OPTIONS/);
  assert.match(rota, /export async function GET/);
});

test("rota: GET de usuário fora do laboratório só diz habilitado:false; POST recusa com 403", () => {
  assert.match(rota, /if \(!usuarioHabilitadoWhatsapp\(ctx\.auth\.userId\)\) return responder\(req, \{ habilitado: false \}\);/);
  assert.match(rota, /if \(!usuarioHabilitadoWhatsapp\(ctx\.auth\.userId\)\) return responder\(req, \{ ok: false, erro: "acesso_nao_permitido" \}, 403\);/);
});

test("rota: user_id vem só da sessão; log só com o código curto; nenhuma resposta cita token", () => {
  assert.match(rota, /userId: ctx\.auth\.userId, pedido, config/);
  assert.doesNotMatch(rota, /body\.user_id|pedido\.userId/);
  const logs = rota.match(/console\.(log|error|warn)\([^)]*\)/g) || [];
  assert.deepEqual(logs, ['console.error("whatsapp/conexao:", falha.codigo)']);
  assert.doesNotMatch(rota, /access_token|accessToken/);
  assert.doesNotMatch(src.replace(/\/\/[^\n]*/g, ""), /console\./, "a lib não registra nada");
});

test("cofre genérico: meta_whatsapp continua fora de PROVEDORES (o PUT/DELETE de /api/integracoes não toca o token da Meta)", () => {
  const integracoes = readFileSync(new URL("../../app/api/integracoes/route.ts", import.meta.url), "utf8");
  assert.match(integracoes, /const PROVEDORES = \["anthropic", "zenvia"\];/);
});
