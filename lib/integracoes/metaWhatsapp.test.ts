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
  ativarWhatsapp, validarPedidoAtivacao,
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
    // modo_conexao: o DEFAULT do banco ('padrao') vale para linha que não o informa
    integracoes_whatsapp: (inicial.whatsapp || []).map((l) => ({ modo_conexao: "padrao", ...l })),
    integracoes_credenciais: (inicial.credenciais || []).map((l) => ({ ...l })),
  };
  const ops: { tabela: string; op: string; valores: any }[] = [];
  const padrao = (tabela: string) => tabela === "integracoes_whatsapp"
    ? { waba_id: null, phone_number_id: null, business_id: null, display_phone_number: null, modo_conexao: "padrao", status: "conectando",
        webhook_inscrito_em: null, webhook_ultimo_evento_em: null, registro_ultima_falha_em: null, conectado_em: null,
        ultimo_erro: null, token_expira_em: null,
        atualizado_em: "2026-09-28T00:00:00Z" }
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
type RespostaMeta = { status: number; body: unknown } | "rede";
function fakeMeta(sobrescrever: Record<string, (url: URL) => RespostaMeta> = {}) {
  const chamadas: { url: URL; auth: string | null; metodo: string; corpo: string | null; tipo: string }[] = [];
  const respostas: Record<string, (url: URL) => RespostaMeta> = {
    troca: () => OK({ access_token: TOKEN, token_type: "bearer" }),
    debug: () => OK({ data: { is_valid: true, app_id: APP, expires_at: 0, granular_scopes: [
      { scope: "whatsapp_business_management", target_ids: [WABA] },
      { scope: "whatsapp_business_messaging", target_ids: [WABA] },
    ] } }),
    telefones: () => OK({ data: [{ id: "999", display_phone_number: "+55 11 0000-0000" }, { id: PHONE, display_phone_number: "+55 27 99999-0000" }] }),
    // Fase 3 (ativação)
    inscrever: () => OK({ success: true }),
    inscricao: () => OK({ data: [{ whatsapp_business_api_data: { id: APP, name: "Ink System", link: "https://x" } }] }),
    numero: () => OK({ status: "CONNECTED", id: PHONE }),
    registro: () => OK({ success: true }),
    ...sobrescrever,
  };
  const buscar = (async (entrada: any, init: any = {}) => {
    const url = new URL(String(entrada));
    const metodo = String(init.method || "GET").toUpperCase();
    const p = url.pathname;
    const tipo = p.endsWith("/oauth/access_token") ? "troca"
      : p.endsWith("/debug_token") ? "debug"
      : p.endsWith("/phone_numbers") ? "telefones"
      : p.endsWith("/subscribed_apps") ? (metodo === "POST" ? "inscrever" : "inscricao")
      : p.endsWith("/register") ? "registro"
      : /^\/v[0-9.]+\/[0-9]+$/.test(p) ? "numero" : "desconhecido";
    chamadas.push({ url, auth: init.headers?.Authorization ?? null, metodo, corpo: init.body ?? null, tipo });
    const r = respostas[tipo]?.(url);
    if (!r) throw new Error("chamada inesperada à Meta: " + url.pathname);
    if (r === "rede") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const conectar = (sb: any, buscar: typeof fetch, pedido: { code: string; wabaId: string; phoneNumberId: string | null } = PEDIDO) =>
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
  assert.deepEqual(r, { status: "conectando", waba_id: WABA, phone_number_id: PHONE, display_phone_number: "+55 27 99999-0000", modo_conexao: "padrao" });

  const linha = tabelas.integracoes_whatsapp[0];
  assert.equal(linha.modo_conexao, "padrao", "fluxo padrão grava o modo padrao");
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
  // Fase 3: 'conectado' só aparece dentro de ativarWhatsapp (a promoção e o retorno dela)
  const inicioAtivacao = codigo.indexOf("export async function ativarWhatsapp");
  const ocorrencias = [...codigo.matchAll(/status:\s*"conectado"/g)].map((m) => m.index!);
  assert.ok(ocorrencias.length > 0 && ocorrencias.every((i) => i > inicioAtivacao));
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
  modo_conexao: "padrao", status: "conectando", webhook_inscrito_em: null, webhook_ultimo_evento_em: "2026-09-27T09:00:00.000Z",
  registro_ultima_falha_em: "2026-09-27T08:00:00.000Z", conectado_em: null,
  ultimo_erro: null, token_expira_em: "2027-01-01T00:00:00.000Z", atualizado_em: "2026-09-27T10:00:00Z",
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
    "habilitado", "modo_conexao", "phone_number_id", "status", "token_expira_em", "ultimo_erro", "waba_id", "webhook_inscrito_em",
    "webhook_ultimo_evento_em"].sort());
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

// ═══════════════════════════════════════════════════════════════════════════
// Fase 3 — ativação (inscrição da WABA, registro do número, promoção)
// ═══════════════════════════════════════════════════════════════════════════

const { criptografarCredencial } = await import("@/lib/integracoes/credenciais");
const PIN = "482915";
const credencialReal = () => ({
  user_id: USER, provedor: PROVEDOR_META, status: "ativa", testado_em: "2026-09-28T11:00:00Z", updated_at: "2026-09-28T11:00:00Z",
  credencial_cifrada: criptografarCredencial(JSON.stringify({ access_token: TOKEN, app_id: APP, waba_id: WABA, phone_number_id: PHONE })),
});
const linhaConectando = (extra: Record<string, unknown> = {}) =>
  ({ ...linhaAnterior(), webhook_ultimo_evento_em: null, registro_ultima_falha_em: null, ...extra });
const ativar = (sb: any, buscar: typeof fetch, pin: string | null = null, agora = "2026-09-28T12:00:00Z") =>
  ativarWhatsapp({ sb, userId: USER, pin, config: CONFIG, buscar, agora: () => new Date(agora) });
// respostas em sequência (a 1ª chamada recebe a 1ª, e assim por diante)
const seq = (...rs: { status: number; body: unknown }[]) => { let i = 0; return () => rs[Math.min(i++, rs.length - 1)]; };
const PENDENTE = OK({ status: "PENDING", id: PHONE });

test("ativação: payload -- PIN opcional, e quando presente exatamente 6 dígitos em texto", () => {
  assert.deepEqual(validarPedidoAtivacao(null), { pin: null });
  assert.deepEqual(validarPedidoAtivacao({}), { pin: null });
  assert.deepEqual(validarPedidoAtivacao({ pin: "" }), { pin: null });
  assert.deepEqual(validarPedidoAtivacao({ pin: PIN, user_id: OUTRO }), { pin: PIN });
  for (const ruim of ["x", { pin: "12345" }, { pin: "1234567" }, { pin: 482915 }, { pin: "48a915" }, { pin: " 482915" }]) {
    assert.equal(validarPedidoAtivacao(ruim), null, JSON.stringify(ruim));
  }
});

test("ativação: número já CONNECTED -> inscreve, confirma, promove a 'conectado' (sem registro, sem PIN)", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaConectando()], credenciais: [credencialReal()] });
  const m = fakeMeta();
  const r = await ativar(sb, m.buscar);
  assert.deepEqual(r, { status: "conectado", modo_conexao: "padrao", waba_id: WABA, phone_number_id: PHONE,
    webhook_inscrito_em: "2026-09-28T12:00:00.000Z", conectado_em: "2026-09-28T12:00:00.000Z" });
  assert.deepEqual(m.chamadas.map((c) => c.tipo), ["debug", "inscrever", "inscricao", "numero"]);
  const linha = tabelas.integracoes_whatsapp[0];
  assert.equal(linha.status, "conectado");
  assert.equal(linha.conectado_em, "2026-09-28T12:00:00.000Z");
  assert.equal(linha.webhook_inscrito_em, "2026-09-28T12:00:00.000Z");
  assert.equal(linha.ultimo_erro, null);
  // o GET da Fase 2 passa a mostrar conectado:true
  assert.equal((await estadoWhatsapp(sb, USER)).conectado, true);
  // chamadas com o token do cliente no cabeçalho; consulta do número pede só status
  assert.ok(m.chamadas.filter((c) => c.tipo !== "debug").every((c) => c.auth === `Bearer ${TOKEN}`));
  assert.equal(m.chamadas.find((c) => c.tipo === "numero")!.url.searchParams.get("fields"), "status");
  assert.equal(m.chamadas.find((c) => c.tipo === "inscrever")!.metodo, "POST");
});

test("ativação: número não CONNECTED e sem PIN -> 409 pin_necessario, inscrição já gravada, segue 'conectando'", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaConectando()], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: () => PENDENTE });
  const erro = await falhaCom(ativar(sb, m.buscar));
  assert.equal(erro.codigo, "pin_necessario");
  assert.equal(erro.status, 409);
  assert.ok(!m.chamadas.some((c) => c.tipo === "registro"));
  const linha = tabelas.integracoes_whatsapp[0];
  assert.equal(linha.status, "conectando");
  assert.equal(linha.webhook_inscrito_em, "2026-09-28T12:00:00.000Z");
  assert.equal(linha.ultimo_erro, null, "pedido de ação não é gravado como erro");
});

test("ativação: com PIN -> registra o número (PIN só no corpo) e promove", async () => {
  const { sb, tabelas, ops } = fakeSb({ whatsapp: [linhaConectando()], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: seq(PENDENTE, OK({ status: "CONNECTED", id: PHONE })) });
  const r = await ativar(sb, m.buscar, PIN);
  assert.equal(r.status, "conectado");
  assert.deepEqual(m.chamadas.map((c) => c.tipo), ["debug", "inscrever", "inscricao", "numero", "registro", "numero"]);
  const registro = m.chamadas.find((c) => c.tipo === "registro")!;
  assert.equal(registro.metodo, "POST");
  assert.deepEqual(JSON.parse(String(registro.corpo)), { messaging_product: "whatsapp", pin: PIN });
  assert.equal(registro.auth, `Bearer ${TOKEN}`);
  // PIN nunca em URL, banco ou resposta
  assert.ok(m.chamadas.every((c) => !c.url.href.includes(PIN)));
  assert.doesNotMatch(JSON.stringify(ops), new RegExp(PIN));
  assert.doesNotMatch(JSON.stringify(tabelas), new RegExp(PIN));
  assert.doesNotMatch(JSON.stringify(r), new RegExp(PIN));
  assert.equal(tabelas.integracoes_whatsapp[0].status, "conectado");
});

for (const [nome, meta, codigo, status, inscrito] of [
  ["debug_token inválido", () => fakeMeta({ debug: () => OK({ data: { is_valid: false, app_id: APP } }) }), "token_invalido", 502, false],
  ["inscrição sem success", () => fakeMeta({ inscrever: () => OK({ success: false }) }), "meta_subscribe:sem_codigo", 502, false],
  ["inscrição recusada pela Meta", () => fakeMeta({ inscrever: () => OK({ error: { code: 200 } }, 403) }), "meta_subscribe:200", 502, false],
  ["nosso app ausente da lista de inscritos", () => fakeMeta({ inscricao: () => OK({ data: [{ whatsapp_business_api_data: { id: "999" } }] }) }), "inscricao_nao_confirmada", 502, false],
  ["registro no limite da Meta (133016)", () => fakeMeta({ numero: () => PENDENTE, registro: () => OK({ error: { code: 133016 } }, 400) }), "registro_numero:133016", 429, true],
  ["registro recusado", () => fakeMeta({ numero: () => PENDENTE, registro: () => OK({ error: { code: 100 } }, 400) }), "registro_numero:100", 502, true],
  ["número continua não CONNECTED após o registro", () => fakeMeta({ numero: () => PENDENTE }), "numero_nao_conectado", 502, true],
] as const) {
  test(`ativação: falha (${nome}) -> continua 'conectando', ultimo_erro = ${codigo}`, async () => {
    const { sb, tabelas } = fakeSb({ whatsapp: [linhaConectando()], credenciais: [credencialReal()] });
    const erro = await falhaCom(ativar(sb, meta().buscar, PIN));
    assert.equal(erro.codigo, codigo);
    assert.equal(erro.status, status);
    const linha = tabelas.integracoes_whatsapp[0];
    assert.equal(linha.status, "conectando");
    assert.equal(linha.conectado_em, null);
    assert.equal(linha.ultimo_erro, codigo);
    assert.equal(linha.webhook_inscrito_em, inscrito ? "2026-09-28T12:00:00.000Z" : null, "só depois da confirmação do GET");
    // só a falha do POST /register liga o relógio da espera
    assert.equal(linha.registro_ultima_falha_em, codigo.startsWith("registro_numero:") ? "2026-09-28T12:00:00.000Z" : null);
  });
}

// ── espera entre tentativas de registro: relógio exclusivo ────────────────

test("espera de registro: falha recente (registro_ultima_falha_em < 10 min) bloqueia sem gastar tentativa", async () => {
  const a = fakeSb({ whatsapp: [linhaConectando({ registro_ultima_falha_em: "2026-09-28T11:55:00.000Z" })], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: () => PENDENTE });
  const erro = await falhaCom(ativar(a.sb, m.buscar, PIN, "2026-09-28T12:00:00Z"));
  assert.equal(erro.codigo, "aguarde_registro");
  assert.equal(erro.status, 429);
  assert.ok(!m.chamadas.some((c) => c.tipo === "registro"), "não gasta tentativa de registro");
  assert.equal(a.tabelas.integracoes_whatsapp[0].registro_ultima_falha_em, "2026-09-28T11:55:00.000Z", "relógio intacto");
});

test("espera de registro: após 10 min da falha, registra e promove -- e a promoção ZERA o relógio", async () => {
  const b = fakeSb({ whatsapp: [linhaConectando({ ultimo_erro: "registro_numero:100", registro_ultima_falha_em: "2026-09-28T11:49:00.000Z" })],
    credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: seq(PENDENTE, OK({ status: "CONNECTED" })) });
  assert.equal((await ativar(b.sb, m.buscar, PIN, "2026-09-28T12:00:00Z")).status, "conectado");
  assert.ok(m.chamadas.some((c) => c.tipo === "registro"));
  assert.equal(b.tabelas.integracoes_whatsapp[0].registro_ultima_falha_em, null);
  assert.equal(b.tabelas.integracoes_whatsapp[0].ultimo_erro, null);
});

test("espera de registro: atualizado_em, webhook_inscrito_em e webhook_ultimo_evento_em RECENTES não estendem a espera", async () => {
  // falha de registro há 11 min; todo o resto da linha mexido há segundos
  const linha = linhaConectando({
    ultimo_erro: "registro_numero:100",
    registro_ultima_falha_em: "2026-09-28T11:49:00.000Z",
    atualizado_em: "2026-09-28T11:59:50.000Z",
    webhook_inscrito_em: "2026-09-28T11:59:50.000Z",
    webhook_ultimo_evento_em: "2026-09-28T11:59:55.000Z",
  });
  const { sb } = fakeSb({ whatsapp: [linha], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: seq(PENDENTE, OK({ status: "CONNECTED" })) });
  assert.equal((await ativar(sb, m.buscar, PIN, "2026-09-28T12:00:00Z")).status, "conectado");
  assert.ok(m.chamadas.some((c) => c.tipo === "registro"), "a tentativa acontece");
});

test("espera de registro: atualizado_em ANTIGO não encurta a espera -- vale só registro_ultima_falha_em (e ultimo_erro não importa)", async () => {
  const linha = linhaConectando({ ultimo_erro: null, registro_ultima_falha_em: "2026-09-28T11:58:00.000Z", atualizado_em: "2026-09-01T00:00:00.000Z" });
  const { sb } = fakeSb({ whatsapp: [linha], credenciais: [credencialReal()] });
  const erro = await falhaCom(ativar(sb, fakeMeta({ numero: () => PENDENTE }).buscar, PIN, "2026-09-28T12:00:00Z"));
  assert.equal(erro.codigo, "aguarde_registro");
});

test("espera de registro: tentativas repetidas (cada uma grava webhook_inscrito_em) não mudam o relógio", async () => {
  // no banco real, cada uma dessas gravações também renova atualizado_em pelo gatilho da Fase 1
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaConectando({ registro_ultima_falha_em: "2026-09-28T11:55:00.000Z" })], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: () => PENDENTE });
  await falhaCom(ativar(sb, m.buscar, PIN, "2026-09-28T12:00:00Z"));
  await falhaCom(ativar(sb, m.buscar, PIN, "2026-09-28T12:04:00Z"));
  assert.equal(tabelas.integracoes_whatsapp[0].registro_ultima_falha_em, "2026-09-28T11:55:00.000Z");
  assert.ok(!m.chamadas.some((c) => c.tipo === "registro"), "nenhuma tentativa dentro dos 10 min");
});

test("espera de registro: chamar sem PIN não mexe no relógio (a espera não é contornável)", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaConectando({ registro_ultima_falha_em: "2026-09-28T11:58:00.000Z" })], credenciais: [credencialReal()] });
  await falhaCom(ativar(sb, fakeMeta({ numero: () => PENDENTE }).buscar, null));
  assert.equal(tabelas.integracoes_whatsapp[0].registro_ultima_falha_em, "2026-09-28T11:58:00.000Z");
});

test("espera de registro: reconexão nova (Fase 2) zera registro_ultima_falha_em; compensação restaura o valor anterior", async () => {
  const nova = fakeSb({ whatsapp: [linhaConectando({ registro_ultima_falha_em: "2026-09-28T11:58:00.000Z" })], credenciais: [credencialReal()] });
  await conectar(nova.sb, fakeMeta().buscar);
  assert.equal(nova.tabelas.integracoes_whatsapp[0].registro_ultima_falha_em, null);
  // compensação: linhaAnterior() carrega registro_ultima_falha_em e volta intacta (ver testes de compensação)
  assert.equal(linhaAnterior().registro_ultima_falha_em, "2026-09-27T08:00:00.000Z");
});

test("espera de registro (fonte): a ativação nunca lê atualizado_em", () => {
  const codigo = src.replace(/\/\/[^\n]*/g, "");
  const ativacao = codigo.slice(codigo.indexOf("export async function ativarWhatsapp"));
  assert.doesNotMatch(ativacao, /atualizado_em/);
  assert.match(ativacao, /Date\.parse\(String\(linha\.registro_ultima_falha_em \?\? ""\)\)/);
});

for (const [nome, inicial] of [
  ["já 'conectado'", { whatsapp: [linhaConectando({ status: "conectado", conectado_em: "2026-09-01T00:00:00Z" })] }],
  ["em 'erro'", { whatsapp: [linhaConectando({ status: "erro", ultimo_erro: "x" })] }],
  ["sem linha", {}],
  ["'conectando' sem IDs (tentativa em andamento)", { whatsapp: [linhaConectando({ waba_id: null, phone_number_id: null })] }],
] as const) {
  test(`ativação: estado inválido (${nome}) -> 409 sem chamar a Meta e sem escrever`, async () => {
    const { sb, tabelas, ops } = fakeSb({ ...(inicial as any), credenciais: [credencialReal()] });
    const antes = JSON.stringify(tabelas.integracoes_whatsapp);
    const m = fakeMeta();
    const erro = await falhaCom(ativar(sb, m.buscar, PIN));
    assert.equal(erro.codigo, "estado_invalido");
    assert.equal(erro.status, 409);
    assert.equal(m.chamadas.length, 0);
    assert.ok(!ops.some((o) => o.op !== "select"));
    assert.equal(JSON.stringify(tabelas.integracoes_whatsapp), antes);
  });
}

test("ativação: sem token no cofre -> credencial_ausente, sem chamar a Meta", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaConectando()] });
  const m = fakeMeta();
  const erro = await falhaCom(ativar(sb, m.buscar));
  assert.equal(erro.codigo, "credencial_ausente");
  assert.equal(m.chamadas.length, 0);
  assert.equal(tabelas.integracoes_whatsapp[0].status, "conectando");
});

test("ativação: reconexão no meio (IDs trocados) -> estado_alterado; nada é gravado sobre a conexão nova", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaConectando()], credenciais: [credencialReal()] });
  const m = fakeMeta({
    numero: () => {
      // um POST da Fase 2 concorrente regrava a linha com outra WABA/número
      Object.assign(tabelas.integracoes_whatsapp[0], { waba_id: "203300000000001", phone_number_id: "203300000000002",
        webhook_inscrito_em: null, ultimo_erro: null });
      return OK({ status: "CONNECTED" });
    },
  });
  const erro = await falhaCom(ativar(sb, m.buscar));
  assert.equal(erro.codigo, "estado_alterado");
  const linha = tabelas.integracoes_whatsapp[0];
  assert.equal(linha.status, "conectando", "não promove a conexão nova");
  assert.equal(linha.waba_id, "203300000000001");
  assert.equal(linha.webhook_inscrito_em, null);
  assert.equal(linha.ultimo_erro, null, "nem o erro é escrito sobre a conexão nova");
});

test("ativação: promoção com ZERO linhas afetadas não conta como sucesso", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaConectando()], credenciais: [credencialReal()] },
    { "integracoes_whatsapp.update": [null, { vazio: true }] }); // 1ª (inscrição) normal, 2ª (promoção) 0 linhas
  const erro = await falhaCom(ativar(sb, fakeMeta().buscar));
  assert.equal(erro.codigo, "estado_alterado");
  assert.equal(tabelas.integracoes_whatsapp[0].status, "conectando");
});

test("ativação (fonte): toda escrita é condicionada à mesma conexão e confirma 1 linha", () => {
  const codigo = src.replace(/\/\/[^\n]*/g, "");
  const ativacao = codigo.slice(codigo.indexOf("export async function ativarWhatsapp"));
  assert.match(ativacao, /\.update\(valores\)\s*\.eq\("user_id", userId\)\.eq\("status", "conectando"\)\.eq\("waba_id", wabaId\)\.eq\("phone_number_id", phoneNumberId\)\s*\.eq\("modo_conexao", modo\)\s*\.select\("user_id"\)/);
  assert.equal((ativacao.match(/sb\.from\("integracoes_whatsapp"\)\.update/g) || []).length, 1, "só o helper condicional escreve");
  assert.doesNotMatch(ativacao, /console\./);
  assert.match(codigo, /const STATUS_OPERACIONAL = "CONNECTED";/);
});

test("rota de ativação: portões na ordem, PIN só no corpo, nunca em log/resposta", () => {
  const rotaAtivacao = readFileSync(new URL("../../app/api/whatsapp/ativacao/route.ts", import.meta.url), "utf8");
  const post = rotaAtivacao.slice(rotaAtivacao.indexOf("export async function POST"));
  const ordem = ["origemPermitida(req)", "autenticarChamador(req)", 'auth.tipo !== "user"', "excedeuLimite(", "usuarioTemAcessoCrm(",
    "usuarioHabilitadoWhatsapp(", "lerConfigMeta()", "validarPedidoAtivacao(", "ativarWhatsapp("].map((t) => post.indexOf(t));
  ordem.forEach((p, i) => assert.ok(p !== -1 && (i === 0 || p > ordem[i - 1]), `passo fora de ordem: ${i}`));
  assert.match(post, /userId: auth\.userId, pin: pedido\.pin, config/);
  assert.deepEqual(rotaAtivacao.match(/console\.(log|error|warn|info)\([^)]*\)/g), ['console.error("whatsapp/ativacao:", falha.codigo)']);
  // o PIN só é repassado à ativação: nenhum outro uso (log, resposta, espalhamento do pedido)
  assert.equal((rotaAtivacao.match(/pedido\.pin/g) || []).length, 1);
  assert.doesNotMatch(rotaAtivacao, /\.\.\.pedido/);
  assert.match(rotaAtivacao, /return responder\(req, \{ ok: true, \.\.\.resultado \}\);/);
  assert.doesNotMatch(rotaAtivacao, /access_token|accessToken/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Coexistência (onboarding do app WhatsApp Business): só waba_id no retorno.
// O número é descoberto no servidor; ativação sem PIN e NUNCA com /register.
// Sem histórico: nada de /smb_app_data, sync_type nem persistência de histórico.
// ═══════════════════════════════════════════════════════════════════════════

const PEDIDO_COEX = { code: "AQBcodeFalso", wabaId: WABA, phoneNumberId: null };
const ELEGIVEL = { is_on_biz_app: true, platform_type: "CLOUD_API" };
// GET /{id}?fields=is_on_biz_app,platform_type por número; id fora do mapa = erro 100
const numeroCoex = (mapa: Record<string, Record<string, unknown>>) => (url: URL) => {
  const id = url.pathname.split("/").pop()!;
  return mapa[id] ? OK({ id, ...mapa[id] }) : OK({ error: { code: 100 } }, 400);
};
const listaDe = (...ids: string[]) => () => OK({ data: ids.map((id) => ({ id, display_phone_number: `+55 ${id}` })) });
const metaCoex = (mapa: Record<string, Record<string, unknown>>, extra: Record<string, (url: URL) => RespostaMeta> = {}) =>
  fakeMeta({ numero: numeroCoex(mapa), ...extra });
const NAO_ELEGIVEL = { is_on_biz_app: false, platform_type: "CLOUD_API" };
const linhaCoex = (extra: Record<string, unknown> = {}) => linhaConectando({ modo_conexao: "coexistencia", ...extra });
const proibidos = /register|smb_app_data|sync_type|history/i;

test("coexistência: payload SÓ com code e waba_id é aceito (phone_number_id ausente ou null = descoberta); lixo do navegador é descartado", () => {
  assert.deepEqual(validarPedido({ code: "AQB", waba_id: WABA }), { code: "AQB", wabaId: WABA, phoneNumberId: null });
  assert.deepEqual(validarPedido({ code: "AQB", waba_id: WABA, phone_number_id: null }), { code: "AQB", wabaId: WABA, phoneNumberId: null });
  assert.deepEqual(validarPedido({ code: "AQB", waba_id: WABA, business_id: "1", display_phone_number: "+55", user_id: OUTRO }),
    { code: "AQB", wabaId: WABA, phoneNumberId: null });
  // presente mas inválido continua 400 (nunca vira "descoberta" por engano)
  for (const ruim of ["", "12a", 106540352242922, "1".repeat(33), {}]) {
    assert.equal(validarPedido({ code: "AQB", waba_id: WABA, phone_number_id: ruim }), null, JSON.stringify(ruim));
  }
  assert.equal(validarPedido({ code: "AQB" }), null, "waba_id continua obrigatório");
  assert.equal(validarPedido({ waba_id: WABA }), null, "code continua obrigatório");
});

test("coexistência: exatamente UM elegível -> descobre o phone_number_id, grava modo 'coexistencia' e termina em 'conectando'", async () => {
  const { sb, tabelas } = fakeSb();
  const m = metaCoex({ "999": NAO_ELEGIVEL, [PHONE]: ELEGIVEL });
  const r = await conectar(sb, m.buscar, PEDIDO_COEX);
  assert.deepEqual(r, { status: "conectando", waba_id: WABA, phone_number_id: PHONE, display_phone_number: "+55 27 99999-0000", modo_conexao: "coexistencia" });

  const linha = tabelas.integracoes_whatsapp[0];
  assert.equal(linha.modo_conexao, "coexistencia");
  assert.equal(linha.status, "conectando");
  assert.equal(linha.conectado_em, null);
  assert.equal(linha.waba_id, WABA);
  assert.equal(linha.phone_number_id, PHONE, "ID vem da descoberta, não do navegador");
  assert.equal(linha.business_id, null);
  assert.equal(linha.display_phone_number, "+55 27 99999-0000");

  const segredo = JSON.parse(descriptografarCredencial(tabelas.integracoes_credenciais[0].credencial_cifrada));
  assert.deepEqual(segredo, { access_token: TOKEN, obtido_em: "2026-09-28T12:00:00.000Z", app_id: APP, waba_id: WABA, phone_number_id: PHONE },
    "o cofre não carrega marcador de modo");
  assert.doesNotMatch(JSON.stringify(r), new RegExp(TOKEN));

  // troca -> debug -> lista de números -> uma consulta por candidato; nada de /register nem de histórico
  assert.deepEqual(m.chamadas.map((c) => c.tipo), ["troca", "debug", "telefones", "numero", "numero"]);
  const consultas = m.chamadas.filter((c) => c.tipo === "numero");
  assert.deepEqual(consultas.map((c) => c.url.pathname.split("/").pop()), ["999", PHONE]);
  for (const c of consultas) {
    assert.equal(c.url.searchParams.get("fields"), "is_on_biz_app,platform_type");
    assert.equal(c.auth, `Bearer ${TOKEN}`);
    assert.equal(c.metodo, "GET");
  }
  assert.ok(m.chamadas.every((c) => !proibidos.test(c.url.pathname)), "nenhuma chamada a /register ou /smb_app_data");
  // troca/debug_token levam code/input_token na URL por desenho da Meta; as demais só por Bearer
  assert.ok(m.chamadas.filter((c) => c.tipo === "telefones" || c.tipo === "numero")
    .every((c) => !c.url.href.includes(TOKEN) && !c.url.href.includes(CONFIG.appSecret)));
});

test("coexistência: mesma ordem de escritas do fluxo padrão (marcador -> cofre -> metadados) e nenhuma escrita depois da Meta antes do fim", async () => {
  const { sb, ops } = fakeSb();
  const m = metaCoex({ [PHONE]: ELEGIVEL }, { telefones: listaDe(PHONE) });
  await conectar(sb, m.buscar, PEDIDO_COEX);
  assert.deepEqual(ops.filter((o) => o.op !== "select").map((o) => `${o.tabela}.${o.op}`),
    ["integracoes_whatsapp.upsert", "integracoes_credenciais.upsert", "integracoes_whatsapp.update"]);
  assert.deepEqual(ops[ops.findIndex((o) => o.op === "upsert")].valores, { user_id: USER, status: "conectando", ultimo_erro: null });
});

for (const [nome, telefones, mapa] of [
  ["WABA sem nenhum número", listaDe(), {}],
  ["número com is_on_biz_app = false", listaDe(PHONE), { [PHONE]: NAO_ELEGIVEL }],
  ["is_on_biz_app true mas platform_type diferente de CLOUD_API", listaDe(PHONE), { [PHONE]: { is_on_biz_app: true, platform_type: "NOT_APPLICABLE" } }],
  ["is_on_biz_app true e platform_type ausente", listaDe(PHONE), { [PHONE]: { is_on_biz_app: true } }],
  ["is_on_biz_app ausente", listaDe(PHONE), { [PHONE]: { platform_type: "CLOUD_API" } }],
  ["is_on_biz_app como texto 'true' (comparação estrita)", listaDe(PHONE), { [PHONE]: { is_on_biz_app: "true", platform_type: "CLOUD_API" } }],
  ["vários números, nenhum elegível", listaDe("999", PHONE), { "999": NAO_ELEGIVEL, [PHONE]: NAO_ELEGIVEL }],
] as const) {
  test(`coexistência: zero elegíveis (${nome}) -> 422 nenhum_numero_elegivel, cofre e IDs intocados, status 'erro'`, async () => {
    const { sb, tabelas, ops } = fakeSb();
    const erro = await falhaCom(conectar(sb, metaCoex(mapa as any, { telefones }).buscar, PEDIDO_COEX));
    assert.equal(erro.codigo, "nenhum_numero_elegivel");
    assert.equal(erro.status, 422);
    assert.ok(!ops.some((o) => o.tabela === "integracoes_credenciais" && o.op !== "select"), "cofre nem foi tocado");
    assert.equal(tabelas.integracoes_credenciais.length, 0);
    const linha = tabelas.integracoes_whatsapp[0];
    assert.equal(linha.status, "erro");
    assert.equal(linha.ultimo_erro, "nenhum_numero_elegivel");
    assert.equal(linha.waba_id, null, "ID não verificado nunca é gravado");
    assert.equal(linha.phone_number_id, null);
  });
}

test("coexistência: mais de um elegível -> 422 multiplos_numeros_elegiveis, sem escolher nenhum (nem o mais recente)", async () => {
  const { sb, tabelas, ops } = fakeSb();
  const m = metaCoex({ "999": ELEGIVEL, [PHONE]: ELEGIVEL }, { telefones: listaDe("999", PHONE) });
  const erro = await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "multiplos_numeros_elegiveis");
  assert.equal(erro.status, 422);
  assert.ok(!ops.some((o) => o.tabela === "integracoes_credenciais" && o.op !== "select"));
  assert.equal(tabelas.integracoes_whatsapp[0].phone_number_id, null, "nenhum número foi escolhido");
  assert.equal(tabelas.integracoes_whatsapp[0].status, "erro");
});

test("coexistência: para de consultar assim que acha o 2º elegível", async () => {
  const { sb } = fakeSb();
  const m = metaCoex({ "1": ELEGIVEL, "2": ELEGIVEL, "3": ELEGIVEL }, { telefones: listaDe("1", "2", "3") });
  await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.deepEqual(m.chamadas.filter((c) => c.tipo === "numero").map((c) => c.url.pathname.split("/").pop()), ["1", "2"]);
});

test("coexistência: falha ao consultar QUALQUER candidato recusa tudo (nunca ignora um número e conclui 'exatamente um')", async () => {
  const { sb, tabelas } = fakeSb();
  // 999 falha na consulta (fora do mapa); PHONE seria o único elegível
  const m = metaCoex({ [PHONE]: ELEGIVEL }, { telefones: listaDe("999", PHONE) });
  const erro = await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "meta_numero:100");
  assert.equal(erro.status, 502);
  assert.equal(tabelas.integracoes_credenciais.length, 0);
  assert.equal(tabelas.integracoes_whatsapp[0].status, "erro");
  assert.equal(tabelas.integracoes_whatsapp[0].phone_number_id, null);

  const rede = fakeSb();
  const e2 = await falhaCom(conectar(rede.sb, metaCoex({ [PHONE]: ELEGIVEL }, { numero: () => "rede", telefones: listaDe(PHONE) }).buscar, PEDIDO_COEX));
  assert.equal(e2.codigo, "meta_indisponivel");
});

test("coexistência: listagem de números da WABA recusada pela Meta -> código curto, cofre intocado", async () => {
  const { sb, tabelas } = fakeSb();
  const erro = await falhaCom(conectar(sb, metaCoex({}, { telefones: () => OK({ error: { code: 190 } }, 401) }).buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "meta_phone_numbers:190");
  assert.equal(tabelas.integracoes_credenciais.length, 0);
});

test("coexistência: paginação da lista de números é seguida pelo cursor 'after'", async () => {
  const { sb, tabelas } = fakeSb();
  const m = metaCoex({ "999": NAO_ELEGIVEL, [PHONE]: ELEGIVEL }, {
    telefones: (url) => url.searchParams.get("after") === "CURSOR2"
      ? OK({ data: [{ id: PHONE, display_phone_number: "+55 27 99999-0000" }], paging: { cursors: { after: "CURSOR3" } } })
      : OK({ data: [{ id: "999", display_phone_number: "+55" }], paging: { cursors: { after: "CURSOR2" }, next: "https://graph.facebook.com/x?access_token=NAO_USAR" } }),
  });
  const r = await conectar(sb, m.buscar, PEDIDO_COEX);
  assert.equal(r.phone_number_id, PHONE);
  const paginas = m.chamadas.filter((c) => c.tipo === "telefones");
  assert.equal(paginas.length, 2);
  assert.equal(paginas[1].url.searchParams.get("after"), "CURSOR2");
  assert.ok(m.chamadas.every((c) => !c.url.href.includes("NAO_USAR")), "nunca segue a URL 'next' da Meta (poderia carregar token)");
  assert.equal(tabelas.integracoes_whatsapp[0].phone_number_id, PHONE);
});

test("coexistência: WABA com números demais (mais de 25) -> 422 numeros_demais, sem consultar candidatos", async () => {
  const { sb, tabelas } = fakeSb();
  const ids = Array.from({ length: 26 }, (_, i) => String(1000 + i));
  const m = metaCoex({}, { telefones: listaDe(...ids) });
  const erro = await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "numeros_demais");
  assert.equal(erro.status, 422);
  assert.ok(!m.chamadas.some((c) => c.tipo === "numero"));
  assert.equal(tabelas.integracoes_credenciais.length, 0);
});

test("coexistência: paginação infinita da Meta é cortada (numeros_demais)", async () => {
  const { sb } = fakeSb();
  const m = metaCoex({}, { telefones: () => OK({ data: [], paging: { cursors: { after: "SEMPRE" }, next: "x" } }) });
  const erro = await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "numeros_demais");
  assert.equal(m.chamadas.filter((c) => c.tipo === "telefones").length, 5);
});

test("coexistência: conflito de WABA com OUTRA conta -> 409 antes de qualquer chamada à Meta", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [{ user_id: OUTRO, status: "conectando", waba_id: WABA }] });
  const m = metaCoex({ [PHONE]: ELEGIVEL });
  const erro = await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "conflito_outra_conta");
  assert.equal(erro.status, 409);
  assert.equal(m.chamadas.length, 0);
  assert.equal(tabelas.integracoes_whatsapp.find((l) => l.user_id === OUTRO)!.waba_id, WABA, "conta alheia intacta");
});

test("coexistência: número descoberto já ligado a OUTRA conta -> 409 DEPOIS da descoberta e ANTES de qualquer escrita de cofre/IDs", async () => {
  const { sb, tabelas, ops } = fakeSb({ whatsapp: [{ user_id: OUTRO, status: "conectado", waba_id: "777000000000001", phone_number_id: PHONE }] });
  const m = metaCoex({ [PHONE]: ELEGIVEL }, { telefones: listaDe(PHONE) });
  const erro = await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "conflito_outra_conta");
  assert.equal(erro.status, 409);
  // a descoberta aconteceu (o conflito só é conhecido depois dela)...
  assert.ok(m.chamadas.some((c) => c.tipo === "numero"), "descobriu o número antes de checar o conflito");
  // ...e nada foi gravado no cofre nem nos IDs
  assert.ok(!ops.some((o) => o.tabela === "integracoes_credenciais" && o.op !== "select"));
  assert.equal(tabelas.integracoes_credenciais.length, 0);
  const minha = tabelas.integracoes_whatsapp.find((l) => l.user_id === USER)!;
  assert.equal(minha.waba_id, null);
  assert.equal(minha.phone_number_id, null);
  assert.equal(minha.status, "erro");
  const alheia = tabelas.integracoes_whatsapp.find((l) => l.user_id === OUTRO)!;
  assert.equal(alheia.phone_number_id, PHONE, "conta alheia intacta");
  assert.equal(alheia.status, "conectado");
});

test("coexistência: outra conta pega o número durante a descoberta -> ainda 409 antes do cofre", async () => {
  const { sb, tabelas, ops } = fakeSb();
  const m = fakeMeta({
    telefones: listaDe(PHONE),
    numero: (url) => {
      tabelas.integracoes_whatsapp.push({ user_id: OUTRO, waba_id: "777000000000001", phone_number_id: PHONE, status: "conectando" });
      return OK({ id: url.pathname.split("/").pop(), ...ELEGIVEL });
    },
  });
  const erro = await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "conflito_outra_conta");
  assert.ok(!ops.some((o) => o.tabela === "integracoes_credenciais" && o.op !== "select"));
});

test("coexistência: corrida pela mesma WABA no UPDATE final (UNIQUE) -> conflito_outra_conta e cofre limpo (compensação preservada)", async () => {
  const { sb, tabelas } = fakeSb();
  const m = fakeMeta({
    telefones: listaDe(PHONE),
    numero: (url) => {
      tabelas.integracoes_whatsapp.push({ user_id: OUTRO, waba_id: WABA, phone_number_id: "777", status: "conectando" });
      return OK({ id: url.pathname.split("/").pop(), ...ELEGIVEL });
    },
  });
  const erro = await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "conflito_outra_conta");
  assert.equal(erro.status, 409);
  assert.equal(tabelas.integracoes_credenciais.length, 0, "token recém-gravado foi removido");
  assert.equal(tabelas.integracoes_whatsapp.find((l) => l.user_id === USER)!.status, "erro");
});

test("coexistência: compensação -- metadados falham depois do cofre -> cofre limpo (sem credencial anterior)", async () => {
  const { sb, tabelas, ops } = fakeSb({}, { "integracoes_whatsapp.update": [{ error: { code: "XX000" } }] });
  const erro = await falhaCom(conectar(sb, metaCoex({ [PHONE]: ELEGIVEL }, { telefones: listaDe(PHONE) }).buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "metadados_falhou");
  assert.ok(ops.some((o) => o.tabela === "integracoes_credenciais" && o.op === "upsert"), "o token chegou a ser gravado");
  assert.equal(tabelas.integracoes_credenciais.length, 0, "nenhum token órfão");
  assert.equal(tabelas.integracoes_whatsapp[0].status, "erro");
});

test("coexistência: compensação com conexão anterior válida -- token ANTIGO restaurado e linha anterior (inclusive o modo) intacta", async () => {
  const { sb, tabelas, ops } = fakeSb(
    { whatsapp: [linhaAnterior()], credenciais: [credencialAnterior()] },
    { "integracoes_whatsapp.update": [{ error: { code: "XX000" } }] },
  );
  const erro = await falhaCom(conectar(sb, metaCoex({ [PHONE]: ELEGIVEL }, { telefones: listaDe(PHONE) }).buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "metadados_falhou");
  assert.ok(ops.some((o) => o.tabela === "integracoes_credenciais" && o.op === "upsert"));
  assert.ok(!ops.some((o) => o.tabela === "integracoes_credenciais" && o.op === "delete"), "com credencial anterior, nunca DELETE");
  assert.deepEqual(tabelas.integracoes_credenciais, [credencialAnterior()]);
  assert.deepEqual(tabelas.integracoes_whatsapp, [linhaAnterior()]);
});

for (const [nome, mapa, codigo] of [
  ["nenhum elegível", { [PHONE]: NAO_ELEGIVEL, "999": NAO_ELEGIVEL }, "nenhum_numero_elegivel"],
  ["mais de um elegível", { [PHONE]: ELEGIVEL, "999": ELEGIVEL }, "multiplos_numeros_elegiveis"],
] as const) {
  test(`coexistência: falha na descoberta (${nome}) com conexão anterior válida -> cofre e linha anteriores intactos`, async () => {
    const { sb, tabelas, ops } = fakeSb({ whatsapp: [linhaAnterior()], credenciais: [credencialAnterior()] });
    const erro = await falhaCom(conectar(sb, metaCoex(mapa as any, { telefones: listaDe(PHONE, "999") }).buscar, PEDIDO_COEX));
    assert.equal(erro.codigo, codigo);
    assert.ok(!ops.some((o) => o.tabela === "integracoes_credenciais" && o.op !== "select"), "cofre nem foi tocado");
    assert.deepEqual(tabelas.integracoes_credenciais, [credencialAnterior()]);
    assert.deepEqual(tabelas.integracoes_whatsapp, [linhaAnterior()], "conexão anterior preservada (não vira 'erro')");
  });
}

test("coexistência: falha de token/WABA (debug_token) segue a mesma validação e recusa antes da descoberta", async () => {
  const { sb, tabelas } = fakeSb();
  const m = metaCoex({ [PHONE]: ELEGIVEL }, { debug: () => OK({ data: { is_valid: true, app_id: APP, granular_scopes: escopos(["555"], ["555"]) } }) });
  const erro = await falhaCom(conectar(sb, m.buscar, PEDIDO_COEX));
  assert.equal(erro.codigo, "waba_nao_autorizada");
  assert.ok(!m.chamadas.some((c) => c.tipo === "telefones" || c.tipo === "numero"), "nada é descoberto com token que não alcança a WABA");
  assert.equal(tabelas.integracoes_credenciais.length, 0);
});

test("fluxo padrão sem regressão: com phone_number_id NÃO usa a descoberta (nenhuma consulta is_on_biz_app) e mantém o modo 'padrao'", async () => {
  const { sb, tabelas } = fakeSb();
  const m = fakeMeta();
  const r = await conectar(sb, m.buscar);
  assert.equal(r.modo_conexao, "padrao");
  assert.deepEqual(m.chamadas.map((c) => c.tipo), ["troca", "debug", "telefones"]);
  assert.ok(m.chamadas.every((c) => !c.url.searchParams.get("fields")?.includes("is_on_biz_app")));
  assert.equal(tabelas.integracoes_whatsapp[0].modo_conexao, "padrao");
});

test("fluxo padrão sem regressão: reconectar em modo padrão sobre uma linha de coexistência volta o modo para 'padrao' (e vice-versa)", async () => {
  const a = fakeSb({ whatsapp: [linhaCoex({ status: "conectado", conectado_em: "2026-09-27T00:00:00Z" })], credenciais: [credencialReal()] });
  await conectar(a.sb, fakeMeta().buscar);
  assert.equal(a.tabelas.integracoes_whatsapp[0].modo_conexao, "padrao");
  assert.equal(a.tabelas.integracoes_whatsapp[0].status, "conectando");

  const b = fakeSb({ whatsapp: [linhaAnterior()], credenciais: [credencialReal()] });
  await conectar(b.sb, metaCoex({ [PHONE]: ELEGIVEL }, { telefones: listaDe(PHONE) }).buscar, PEDIDO_COEX);
  assert.equal(b.tabelas.integracoes_whatsapp[0].modo_conexao, "coexistencia");
});

test("estado: expõe o modo da conexão e continua sem devolver token", async () => {
  const { sb } = fakeSb();
  await conectar(sb, metaCoex({ [PHONE]: ELEGIVEL }, { telefones: listaDe(PHONE) }).buscar, PEDIDO_COEX);
  const estado = await estadoWhatsapp(sb, USER);
  assert.equal(estado.modo_conexao, "coexistencia");
  assert.equal(estado.conectado, false);
  assert.doesNotMatch(JSON.stringify(estado), new RegExp(TOKEN));
});

// ── ativação em Coexistência ────────────────────────────────────────────────

test("ativação coexistência: SEM PIN -> inscreve, confirma, valida is_on_biz_app/CLOUD_API e promove; /register nunca é chamado", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaCoex()], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: numeroCoex({ [PHONE]: ELEGIVEL }) });
  const r = await ativar(sb, m.buscar);
  assert.deepEqual(r, { status: "conectado", modo_conexao: "coexistencia", waba_id: WABA, phone_number_id: PHONE,
    webhook_inscrito_em: "2026-09-28T12:00:00.000Z", conectado_em: "2026-09-28T12:00:00.000Z" });
  assert.deepEqual(m.chamadas.map((c) => c.tipo), ["debug", "inscrever", "inscricao", "numero"], "subscribed_apps mantido, sem /register");
  const consulta = m.chamadas.find((c) => c.tipo === "numero")!;
  assert.equal(consulta.url.searchParams.get("fields"), "is_on_biz_app,platform_type");
  assert.equal(consulta.auth, `Bearer ${TOKEN}`);
  assert.equal(m.chamadas.find((c) => c.tipo === "inscrever")!.metodo, "POST");
  assert.equal(m.chamadas.find((c) => c.tipo === "inscrever")!.corpo, null, "inscrição sem campos extras (nada de history)");
  assert.ok(m.chamadas.every((c) => !proibidos.test(c.url.pathname)));
  const linha = tabelas.integracoes_whatsapp[0];
  assert.equal(linha.status, "conectado");
  assert.equal(linha.modo_conexao, "coexistencia");
  assert.equal(linha.conectado_em, "2026-09-28T12:00:00.000Z");
  assert.equal(linha.webhook_inscrito_em, "2026-09-28T12:00:00.000Z");
  assert.equal(linha.ultimo_erro, null);
  assert.equal((await estadoWhatsapp(sb, USER)).conectado, true);
});

test("ativação coexistência: status do número NÃO é exigido (só is_on_biz_app + CLOUD_API) e o status nem é consultado", async () => {
  const { sb } = fakeSb({ whatsapp: [linhaCoex()], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: (url) => OK({ id: PHONE, status: "PENDING", ...ELEGIVEL, fields: url.searchParams.get("fields") }) });
  assert.equal((await ativar(sb, m.buscar)).status, "conectado");
  assert.ok(m.chamadas.filter((c) => c.tipo === "numero").every((c) => c.url.searchParams.get("fields") === "is_on_biz_app,platform_type"));
});

test("ativação coexistência: PIN enviado por engano é ignorado -- /register continua sem ser chamado e o PIN não vai a lugar nenhum", async () => {
  const { sb, tabelas, ops } = fakeSb({ whatsapp: [linhaCoex()], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: numeroCoex({ [PHONE]: ELEGIVEL }) });
  const r = await ativar(sb, m.buscar, PIN);
  assert.equal(r.status, "conectado");
  assert.ok(!m.chamadas.some((c) => c.tipo === "registro"));
  assert.ok(m.chamadas.every((c) => c.corpo === null && !c.url.href.includes(PIN)));
  assert.doesNotMatch(JSON.stringify(ops) + JSON.stringify(tabelas) + JSON.stringify(r), new RegExp(PIN));
});

for (const [nome, dados] of [
  ["is_on_biz_app false", { is_on_biz_app: false, platform_type: "CLOUD_API" }],
  ["platform_type diferente de CLOUD_API", { is_on_biz_app: true, platform_type: "NOT_APPLICABLE" }],
  ["platform_type ausente", { is_on_biz_app: true }],
  ["is_on_biz_app ausente", { platform_type: "CLOUD_API" }],
  ["número sem nenhum dos dois campos", { status: "CONNECTED" }],
] as const) {
  test(`ativação coexistência: não pronto (${nome}) -> 409 tentável (numero_coexistencia_nao_pronto), sem /register e sem pin_necessario`, async () => {
    for (const pin of [null, PIN]) {
      const { sb, tabelas } = fakeSb({ whatsapp: [linhaCoex()], credenciais: [credencialReal()] });
      const m = fakeMeta({ numero: () => OK({ id: PHONE, ...dados }) });
      const erro = await falhaCom(ativar(sb, m.buscar, pin));
      assert.equal(erro.codigo, "numero_coexistencia_nao_pronto");
      assert.equal(erro.status, 409);
      assert.notEqual(erro.codigo, "pin_necessario");
      assert.ok(!m.chamadas.some((c) => c.tipo === "registro"), "nunca /register, com ou sem PIN");
      const linha = tabelas.integracoes_whatsapp[0];
      assert.equal(linha.status, "conectando", "não promove");
      assert.equal(linha.conectado_em, null);
      assert.equal(linha.ultimo_erro, null, "pedido de espera não é gravado como erro (nem pin_necessario)");
      assert.equal(linha.webhook_inscrito_em, "2026-09-28T12:00:00.000Z", "a inscrição já confirmada fica gravada");
      assert.equal(linha.registro_ultima_falha_em, null, "relógio do /register nunca é ligado em coexistência");
    }
  });
}

test("ativação coexistência: 'não pronto' é tentável -- a chamada seguinte, com o número pronto, promove (sem PIN)", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaCoex()], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: seq(OK({ id: PHONE, ...NAO_ELEGIVEL }), OK({ id: PHONE, ...ELEGIVEL })) });
  assert.equal((await falhaCom(ativar(sb, m.buscar))).codigo, "numero_coexistencia_nao_pronto");
  assert.equal((await ativar(sb, m.buscar)).status, "conectado");
  assert.equal(tabelas.integracoes_whatsapp[0].status, "conectado");
  assert.ok(!m.chamadas.some((c) => c.tipo === "registro"));
});

test("ativação coexistência: erro da Meta ao consultar o número -> 502 registrado em ultimo_erro, continua 'conectando', sem /register", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaCoex()], credenciais: [credencialReal()] });
  const m = fakeMeta({ numero: () => OK({ error: { code: 190 } }, 401) });
  const erro = await falhaCom(ativar(sb, m.buscar, PIN));
  assert.equal(erro.codigo, "meta_numero:190");
  assert.equal(erro.status, 502);
  assert.equal(tabelas.integracoes_whatsapp[0].status, "conectando");
  assert.equal(tabelas.integracoes_whatsapp[0].ultimo_erro, "meta_numero:190");
  assert.ok(!m.chamadas.some((c) => c.tipo === "registro"));
});

for (const [nome, extra] of [
  ["inscrição sem success", { inscrever: () => OK({ success: false }) }],
  ["nosso app ausente da lista de inscritos", { inscricao: () => OK({ data: [{ whatsapp_business_api_data: { id: "999" } }] }) }],
] as const) {
  test(`ativação coexistência: ${nome} -> falha e NÃO consulta nem promove o número (subscribed_apps + confirmação continuam obrigatórios)`, async () => {
    const { sb, tabelas } = fakeSb({ whatsapp: [linhaCoex()], credenciais: [credencialReal()] });
    const m = fakeMeta({ numero: numeroCoex({ [PHONE]: ELEGIVEL }), ...extra });
    const erro = await falhaCom(ativar(sb, m.buscar));
    assert.equal(erro.status, 502);
    assert.ok(!m.chamadas.some((c) => c.tipo === "numero" || c.tipo === "registro"));
    assert.equal(tabelas.integracoes_whatsapp[0].status, "conectando");
    assert.equal(tabelas.integracoes_whatsapp[0].webhook_inscrito_em, null);
  });
}

test("ativação coexistência: reconexão no meio (modo trocado) -> estado_alterado; nada promovido nem gravado sobre a conexão nova", async () => {
  const { sb, tabelas } = fakeSb({ whatsapp: [linhaCoex()], credenciais: [credencialReal()] });
  const m = fakeMeta({
    numero: (url) => {
      Object.assign(tabelas.integracoes_whatsapp[0], { modo_conexao: "padrao", webhook_inscrito_em: null, ultimo_erro: null });
      return OK({ id: url.pathname.split("/").pop(), ...ELEGIVEL });
    },
  });
  const erro = await falhaCom(ativar(sb, m.buscar));
  assert.equal(erro.codigo, "estado_alterado");
  assert.equal(tabelas.integracoes_whatsapp[0].status, "conectando");
  assert.equal(tabelas.integracoes_whatsapp[0].modo_conexao, "padrao");
});

for (const [nome, modo] of [["desconhecido", "outro"], ["nulo", null], ["ausente", undefined]] as const) {
  test(`ativação: modo_conexao ${nome} -> 409 estado_invalido, sem Meta e sem escrita (fail-closed: nunca cai no caminho do /register)`, async () => {
    const { sb, tabelas, ops } = fakeSb({ whatsapp: [{ ...linhaConectando(), modo_conexao: modo }], credenciais: [credencialReal()] });
    const m = fakeMeta({ numero: () => PENDENTE });
    const erro = await falhaCom(ativar(sb, m.buscar, PIN));
    assert.equal(erro.codigo, "estado_invalido");
    assert.equal(erro.status, 409);
    assert.equal(m.chamadas.length, 0);
    assert.ok(!ops.some((o) => o.op !== "select"));
    assert.equal(tabelas.integracoes_whatsapp[0].status, "conectando");
  });
}

test("fluxo padrão sem regressão na ativação: modo 'padrao' continua pedindo PIN e registrando quando o número não está CONNECTED", async () => {
  const semPin = fakeSb({ whatsapp: [linhaConectando()], credenciais: [credencialReal()] });
  const m1 = fakeMeta({ numero: () => PENDENTE });
  assert.equal((await falhaCom(ativar(semPin.sb, m1.buscar))).codigo, "pin_necessario");
  assert.ok(!m1.chamadas.some((c) => c.tipo === "registro"));

  const comPin = fakeSb({ whatsapp: [linhaConectando()], credenciais: [credencialReal()] });
  const m2 = fakeMeta({ numero: seq(PENDENTE, OK({ status: "CONNECTED", id: PHONE })) });
  assert.equal((await ativar(comPin.sb, m2.buscar, PIN)).status, "conectado");
  assert.deepEqual(m2.chamadas.map((c) => c.tipo), ["debug", "inscrever", "inscricao", "numero", "registro", "numero"]);
  assert.equal(m2.chamadas.filter((c) => c.tipo === "numero").every((c) => c.url.searchParams.get("fields") === "status"), true);
});

test("ponta a ponta (coexistência): conexão descobre o número, ativação promove -- sem PIN, sem /register, sem histórico", async () => {
  const { sb, tabelas } = fakeSb();
  const m = metaCoex({ "999": NAO_ELEGIVEL, [PHONE]: ELEGIVEL });
  const c = await conectar(sb, m.buscar, PEDIDO_COEX);
  assert.equal(c.status, "conectando");
  assert.equal(c.modo_conexao, "coexistencia");
  const a = await ativar(sb, m.buscar);
  assert.equal(a.status, "conectado");
  assert.equal(a.phone_number_id, PHONE);
  assert.equal(tabelas.integracoes_whatsapp[0].modo_conexao, "coexistencia");
  assert.equal((await estadoWhatsapp(sb, USER)).conectado, true);
  assert.ok(!m.chamadas.some((x) => x.tipo === "registro"));
  assert.ok(m.chamadas.every((x) => !proibidos.test(x.url.pathname) && x.corpo === null));
});

// ── proteções de fonte (o que os testes de comportamento não conseguem provar sozinhos) ──

test("fonte: /register só é alcançável no ramo 'padrao'; o ramo de coexistência não cita registro nem PIN", () => {
  const codigo = src.replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const ativacao = codigo.slice(codigo.indexOf("export async function ativarWhatsapp"));
  assert.equal((ativacao.match(/registrarNumero\(/g) || []).length, 1, "uma única chamada ao registro");
  const ramoCoex = ativacao.slice(ativacao.indexOf('if (modo === "coexistencia")'), ativacao.indexOf("} else {"));
  assert.ok(ramoCoex.length > 0);
  assert.doesNotMatch(ramoCoex, /registrarNumero|register|pin/i);
  assert.ok(ativacao.indexOf("registrarNumero(") > ativacao.indexOf("} else {"), "o registro está no else do ramo de coexistência");
  assert.match(ativacao, /linha\.modo_conexao !== "padrao" && linha\.modo_conexao !== "coexistencia"/, "modo desconhecido é recusado antes de tudo");
  // registrarNumero é o único ponto que fala com /register
  assert.equal((codigo.match(/\/register/g) || []).length, 1);
});

test("fonte: sem sincronização de histórico -- nenhum /smb_app_data, sync_type, history nem campos de webhook novos na lib", () => {
  const codigo = src.replace(/(^|\s)\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(codigo, /smb_app_data|sync_type|history|smb_app_state_sync|smb_message_echoes/i);
  // subscribed_apps continua sem corpo (nada de campos/override de callback)
  assert.match(codigo, /chamarGraph\(buscar, url, accessToken, \{ metodo: "POST" \}\)/);
  const webhook = readFileSync(new URL("./metaWebhook.ts", import.meta.url), "utf8");
  assert.match(webhook, /export const CAMPO_PROCESSADO = "messages";/, "webhook segue processando só 'messages'");
});

test("fonte: a compensação restaura o modo anterior; a rota devolve os códigos controlados da descoberta (422) sem confundir com conflito (409)", () => {
  const codigo = src.replace(/(^|\s)\/\/[^\n]*/g, "$1");
  assert.match(codigo, /modo_conexao: anterior!\.modo_conexao/);
  assert.match(codigo, /modo_conexao: modo,\s*status: "conectando"/);
  assert.match(rota, /falha\.status === 409\) return responder\(req, \{ ok: false, erro: "conflito_outra_conta" \}, 409\);/);
  assert.match(rota, /falha\.status === 422\) return responder\(req, \{ ok: false, erro: falha\.codigo \}, 422\);/);
  const ativacao = readFileSync(new URL("../../app/api/whatsapp/ativacao/route.ts", import.meta.url), "utf8");
  assert.match(ativacao, /falha\.status === 409 \|\| falha\.status === 429\) return responder\(req, \{ ok: false, erro: falha\.codigo \}, falha\.status\)/,
    "numero_coexistencia_nao_pronto (409) chega ao cliente com o código");
});
