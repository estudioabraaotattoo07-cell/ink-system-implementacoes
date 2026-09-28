import type { SupabaseClient } from "@supabase/supabase-js";
import { criptografarCredencial } from "@/lib/integracoes/credenciais";

// Integração Meta WhatsApp — Fase 2 (backend do Embedded Signup).
//
// Recebe o `code` e os IDs devolvidos pelo Embedded Signup, troca o code por
// token server-to-server, confirma na própria Meta que o token alcança a WABA
// e o número informados, guarda o token cifrado no cofre e os metadados em
// integracoes_whatsapp. Nesta fase o status termina em 'conectando': a
// promoção para 'conectado' depende da inscrição/registro operacional (Fase 3).
//
// Referências (Graph API v26.0, conferidas em 2026-09-28):
//   GET /oauth/access_token?client_id&client_secret&code  (code vale 30 s)
//   GET /debug_token?input_token  (granular_scopes[].target_ids)
//   GET /{waba_id}/phone_numbers  (id, display_phone_number)

export const PROVEDOR_META = "meta_whatsapp";
const ID_META = /^[0-9]{1,32}$/;
const VERSAO_GRAPH = /^v[0-9]{1,3}\.[0-9]{1,2}$/;
const ESCOPOS_OBRIGATORIOS = ["whatsapp_business_management", "whatsapp_business_messaging"];
const TIMEOUT_META_MS = 10_000;

export type ConfigMeta = { appId: string; appSecret: string; versao: string };
export type PedidoConexao = { code: string; wabaId: string; phoneNumberId: string };
type Busca = typeof fetch;

export class ErroConexao extends Error {
  codigo: string;
  status: number;
  constructor(codigo: string, status: number) {
    super(codigo);
    this.codigo = codigo;
    this.status = status;
  }
}

// ── configuração e portão do laboratório ────────────────────────────────────

export function lerConfigMeta(env: NodeJS.ProcessEnv = process.env): ConfigMeta | null {
  const appId = (env.META_APP_ID || "").trim();
  const appSecret = (env.META_APP_SECRET || "").trim();
  const versao = (env.META_GRAPH_VERSION || "").trim();
  if (!ID_META.test(appId) || !appSecret || !VERSAO_GRAPH.test(versao)) return null;
  return { appId, appSecret, versao };
}

// Sem a variável (ou vazia), ninguém é habilitado: fail-closed.
export function usuarioHabilitadoWhatsapp(userId: string, env: NodeJS.ProcessEnv = process.env) {
  const permitidos = (env.META_WHATSAPP_USUARIOS_PERMITIDOS || "")
    .split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
  return Boolean(userId) && permitidos.includes(userId.toLowerCase());
}

// Só os três campos confiáveis. business_id e display_phone_number vindos do
// navegador são descartados: o número exibido é lido da Meta, e o business_id
// não tem fonte server-side confiável nesta fase (fica null).
export function validarPedido(body: unknown): PedidoConexao | null {
  if (!body || typeof body !== "object") return null;
  const { code, waba_id, phone_number_id } = body as Record<string, unknown>;
  if (typeof code !== "string" || !/^\S{1,2048}$/.test(code)) return null;
  if (typeof waba_id !== "string" || !ID_META.test(waba_id)) return null;
  if (typeof phone_number_id !== "string" || !ID_META.test(phone_number_id)) return null;
  return { code, wabaId: waba_id, phoneNumberId: phone_number_id };
}

// ── chamadas à Graph API ────────────────────────────────────────────────────
// Nunca registrar URL, cabeçalho ou corpo destas chamadas: carregam o App
// Secret e o token do cliente. Erros viram só um código curto.

async function chamarGraph(buscar: Busca, url: string, token?: string) {
  try {
    const resposta = await buscar(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(TIMEOUT_META_MS),
      cache: "no-store",
    });
    const texto = await resposta.text();
    let json: any = null;
    try { json = JSON.parse(texto); } catch { json = null; }
    return { ok: resposta.ok, json };
  } catch {
    throw new ErroConexao("meta_indisponivel", 502);
  }
}

const codigoMeta = (json: any) => {
  const codigo = Number(json?.error?.code);
  return Number.isFinite(codigo) ? String(codigo) : "sem_codigo";
};

export async function trocarCodePorToken(config: ConfigMeta, code: string, buscar: Busca) {
  const url = new URL(`https://graph.facebook.com/${config.versao}/oauth/access_token`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("code", code);
  const { ok, json } = await chamarGraph(buscar, url.toString());
  const accessToken = json?.access_token;
  if (!ok || typeof accessToken !== "string" || !/^\S{20,4096}$/.test(accessToken)) {
    throw new ErroConexao(`meta_troca_code:${codigoMeta(json)}`, 502);
  }
  const expiresIn = Number(json?.expires_in);
  return { accessToken, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null };
}

// O token precisa: ser válido, pertencer a ESTE app e alcançar a WABA pedida
// nos dois escopos do WhatsApp. target_ids ausente é recusado (fail-closed):
// sem a lista, não há como provar que a WABA informada pelo navegador é a
// que o cliente autorizou.
export async function validarToken(config: ConfigMeta, accessToken: string, wabaId: string, buscar: Busca) {
  const url = new URL(`https://graph.facebook.com/${config.versao}/debug_token`);
  url.searchParams.set("input_token", accessToken);
  const { ok, json } = await chamarGraph(buscar, url.toString(), `${config.appId}|${config.appSecret}`);
  const dados = json?.data;
  if (!ok || !dados) throw new ErroConexao(`meta_debug_token:${codigoMeta(json)}`, 502);
  if (dados.is_valid !== true) throw new ErroConexao("token_invalido", 502);
  if (String(dados.app_id) !== config.appId) throw new ErroConexao("token_de_outro_app", 502);
  const escopos: any[] = Array.isArray(dados.granular_scopes) ? dados.granular_scopes : [];
  for (const nome of ESCOPOS_OBRIGATORIOS) {
    const escopo = escopos.find((e) => e?.scope === nome);
    const alvos = Array.isArray(escopo?.target_ids) ? escopo.target_ids.map(String) : [];
    if (!alvos.includes(wabaId)) throw new ErroConexao("waba_nao_autorizada", 502);
  }
  const expiraEm = Number(dados.expires_at);
  return { expiraEmUnix: Number.isFinite(expiraEm) && expiraEm > 0 ? expiraEm : null };
}

export async function confirmarTelefone(config: ConfigMeta, accessToken: string, wabaId: string, phoneNumberId: string, buscar: Busca) {
  const url = new URL(`https://graph.facebook.com/${config.versao}/${wabaId}/phone_numbers`);
  url.searchParams.set("fields", "id,display_phone_number");
  url.searchParams.set("limit", "100");
  const { ok, json } = await chamarGraph(buscar, url.toString(), accessToken);
  if (!ok || !Array.isArray(json?.data)) throw new ErroConexao(`meta_phone_numbers:${codigoMeta(json)}`, 502);
  const numero = json.data.find((n: any) => String(n?.id) === phoneNumberId);
  if (!numero) throw new ErroConexao("telefone_fora_da_waba", 502);
  const exibido = typeof numero.display_phone_number === "string" ? numero.display_phone_number.slice(0, 32) : null;
  return { displayPhoneNumber: exibido };
}

// ── orquestração ────────────────────────────────────────────────────────────

type Linha = {
  user_id: string; waba_id: string | null; phone_number_id: string | null; business_id: string | null;
  display_phone_number: string | null; status: string; webhook_inscrito_em: string | null;
  conectado_em: string | null; ultimo_erro: string | null; token_expira_em: string | null; atualizado_em: string;
};

const COLUNAS = "user_id,waba_id,phone_number_id,business_id,display_phone_number,status,webhook_inscrito_em,conectado_em,ultimo_erro,token_expira_em,atualizado_em";

async function lerLinha(sb: SupabaseClient, userId: string): Promise<Linha | null> {
  const { data, error } = await sb.from("integracoes_whatsapp").select(COLUNAS).eq("user_id", userId).maybeSingle();
  if (error) throw new ErroConexao("falha_interna", 500);
  return (data as Linha) || null;
}

type Credencial = { credencial_cifrada: string; status: string; testado_em: string | null; updated_at: string };

// Lê a credencial Meta completa (ainda cifrada): é o que permite restaurá-la
// exatamente se uma nova tentativa a sobrescrever e falhar depois.
async function lerCredencial(sb: SupabaseClient, userId: string): Promise<Credencial | null> {
  const { data, error } = await sb.from("integracoes_credenciais").select("credencial_cifrada,status,testado_em,updated_at")
    .eq("user_id", userId).eq("provedor", PROVEDOR_META).maybeSingle();
  if (error) throw new ErroConexao("falha_interna", 500);
  return (data as Credencial) || null;
}

const umaLinha = (data: unknown) => Array.isArray(data) && data.length === 1;

async function idEmOutraConta(sb: SupabaseClient, userId: string, coluna: "waba_id" | "phone_number_id", valor: string) {
  const { data, error } = await sb.from("integracoes_whatsapp").select("user_id")
    .eq(coluna, valor).neq("user_id", userId).limit(1);
  if (error) throw new ErroConexao("falha_interna", 500);
  return Array.isArray(data) && data.length > 0;
}

export type Dependencias = {
  sb: SupabaseClient;
  userId: string;
  pedido: PedidoConexao;
  config: ConfigMeta;
  buscar?: Busca;
  agora?: () => Date;
};

export async function conectarWhatsapp({ sb, userId, pedido, config, buscar = fetch, agora = () => new Date() }: Dependencias) {
  // Estado anterior capturado ANTES de qualquer escrita: é a base de toda
  // restauração em caso de falha.
  const anterior = await lerLinha(sb, userId);
  const credencialAnterior = await lerCredencial(sb, userId);
  let cofreSobrescrito = false;   // o token novo já substituiu/criou a credencial
  let cofreRestaurado = false;    // e a compensação devolveu o cofre ao estado anterior

  try {
    if (await idEmOutraConta(sb, userId, "waba_id", pedido.wabaId)
        || await idEmOutraConta(sb, userId, "phone_number_id", pedido.phoneNumberId)) {
      throw new ErroConexao("conflito_outra_conta", 409);
    }

    // Tentativa iniciada: IDs ainda NÃO são gravados (nada não verificado
    // fica reservado).
    const { error: erroInicio } = await sb.from("integracoes_whatsapp")
      .upsert({ user_id: userId, status: "conectando", ultimo_erro: null }, { onConflict: "user_id" });
    if (erroInicio) throw new ErroConexao("falha_interna", 500);

    // O code expira em 30 s: troca antes de qualquer outra chamada à Meta.
    const { accessToken, expiresIn } = await trocarCodePorToken(config, pedido.code, buscar);
    const { expiraEmUnix } = await validarToken(config, accessToken, pedido.wabaId, buscar);
    const { displayPhoneNumber } = await confirmarTelefone(config, accessToken, pedido.wabaId, pedido.phoneNumberId, buscar);

    const instante = agora();
    const tokenExpiraEm = expiraEmUnix
      ? new Date(expiraEmUnix * 1000).toISOString()
      : expiresIn ? new Date(instante.getTime() + expiresIn * 1000).toISOString() : null;

    // 1º o cofre, depois os metadados.
    const segredo = JSON.stringify({
      access_token: accessToken, obtido_em: instante.toISOString(), app_id: config.appId,
      waba_id: pedido.wabaId, phone_number_id: pedido.phoneNumberId,
    });
    const { error: erroCofre } = await sb.from("integracoes_credenciais").upsert({
      user_id: userId, provedor: PROVEDOR_META, credencial_cifrada: criptografarCredencial(segredo),
      status: "ativa", testado_em: instante.toISOString(), updated_at: instante.toISOString(),
    }, { onConflict: "user_id,provedor" });
    if (erroCofre) throw new ErroConexao("cofre_falhou", 500);
    cofreSobrescrito = true;

    // Fase 2 termina em 'conectando' (promoção para 'conectado' é da Fase 3).
    // Sucesso exige UMA linha atualizada: zero linhas é falha, não sucesso.
    const { data: atualizadas, error: erroMetadados } = await sb.from("integracoes_whatsapp").update({
      waba_id: pedido.wabaId,
      phone_number_id: pedido.phoneNumberId,
      business_id: null,
      display_phone_number: displayPhoneNumber,
      status: "conectando",
      conectado_em: null,
      webhook_inscrito_em: null,
      ultimo_erro: null,
      token_expira_em: tokenExpiraEm,
    }).eq("user_id", userId).select("user_id");
    if (erroMetadados || !umaLinha(atualizadas)) {
      const conflito = erroMetadados?.code === "23505";
      throw new ErroConexao(conflito ? "conflito_outra_conta" : "metadados_falhou", conflito ? 409 : 500);
    }

    return {
      status: "conectando" as const,
      waba_id: pedido.wabaId,
      phone_number_id: pedido.phoneNumberId,
      display_phone_number: displayPhoneNumber,
    };
  } catch (erro) {
    const falha = erro instanceof ErroConexao ? erro : new ErroConexao("falha_interna", 500);

    // 1) Cofre. Se o token novo já foi gravado, desfaz: sem credencial
    //    anterior, remove a recém-criada; com credencial anterior, restaura
    //    EXATAMENTE a anterior (nunca apaga uma conexão que era válida).
    if (cofreSobrescrito) {
      const alvo = sb.from("integracoes_credenciais");
      const { data, error } = credencialAnterior
        ? await alvo.update(credencialAnterior).eq("user_id", userId).eq("provedor", PROVEDOR_META).select("provedor")
        : await alvo.delete().eq("user_id", userId).eq("provedor", PROVEDOR_META).select("provedor");
      cofreRestaurado = !error && umaLinha(data);
    }
    const cofreComoAntes = !cofreSobrescrito || cofreRestaurado;

    // 2) Linha. Uma tentativa de substituir uma conexão nunca derruba a
    //    anterior antes de completar: havendo conexão anterior válida (IDs +
    //    token no cofre, fora de 'erro') e estando o cofre exatamente como
    //    antes (intocado ou restaurado), a linha anterior volta intacta --
    //    com os IDs tentados iguais ou diferentes. Sem conexão anterior
    //    válida, a falha fica registrada como 'erro'.
    const conexaoAnteriorValida = Boolean(anterior && credencialAnterior && anterior.status !== "erro"
      && anterior.waba_id && anterior.phone_number_id);
    const restaurarLinha = conexaoAnteriorValida && cofreComoAntes;
    const reverter = restaurarLinha
      ? {
          waba_id: anterior!.waba_id, phone_number_id: anterior!.phone_number_id, business_id: anterior!.business_id,
          display_phone_number: anterior!.display_phone_number, status: anterior!.status,
          webhook_inscrito_em: anterior!.webhook_inscrito_em, conectado_em: anterior!.conectado_em,
          ultimo_erro: anterior!.ultimo_erro, token_expira_em: anterior!.token_expira_em,
        }
      : { status: "erro", ultimo_erro: falha.codigo.slice(0, 500) };
    await sb.from("integracoes_whatsapp").update(reverter).eq("user_id", userId);
    throw falha;
  }
}

// Estado para a tela. Nunca devolve token. 'conectado' só quando o status é
// 'conectado' E o token existe no cofre -- nesta fase o status para em
// 'conectando', então conectado é sempre false.
export async function estadoWhatsapp(sb: SupabaseClient, userId: string) {
  const linha = await lerLinha(sb, userId);
  if (!linha) return { habilitado: true, conectado: false, status: null };
  const credencial = Boolean(await lerCredencial(sb, userId));
  return {
    habilitado: true,
    conectado: linha.status === "conectado" && credencial,
    status: linha.status,
    waba_id: linha.waba_id,
    phone_number_id: linha.phone_number_id,
    business_id: linha.business_id,
    display_phone_number: linha.display_phone_number,
    conectado_em: linha.conectado_em,
    webhook_inscrito_em: linha.webhook_inscrito_em,
    token_expira_em: linha.token_expira_em,
    ultimo_erro: linha.ultimo_erro,
    atualizado_em: linha.atualizado_em,
  };
}
