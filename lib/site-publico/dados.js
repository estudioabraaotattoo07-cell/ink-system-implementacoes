// Lógica de dados do "Meu Site" — Bloco 4.8.
// Portado de inq-saas/api/lead.js (blocos acao==="site" [:1088-1107] e
// acao==="preview" [:1174-1187], mais as funções de apoio incrementarStat/
// registrarVisita/campanhasAtivasHoje [:1040-1069]) — origem oficial:
// inq-saas em produção. Framework-agnostic: recebe/devolve dados simples
// ({status, contentType, body}), sem tocar Request/Response — mesmo padrão
// de lib/tenant/provisionamento (inq-saas) e lib/motor-disparos (Bloco 4.5).
//
// Fora de escopo de propósito (Bloco 4.8 só cobre site+preview): track_click/
// registrarClique (acao="track_click") é uma ação de analytics separada, não
// uma dependência da renderização em si.
import { createAdminClient } from "@/lib/supabase/admin";
import { paginaSitePremium } from "@/lib/site-publico/paginaSitePremium";
import { paginaSiteIndisponivel } from "@/lib/site-publico/paginaSiteIndisponivel";

// Construção tardia (não no import do módulo): coleta de dados de página do
// Next.js em build time importa este arquivo sem as env vars de runtime
// disponíveis -- criar o cliente aqui em cima derrubava o build ("supabaseUrl
// is required"). Mesmo problema que health/route.ts já tinha evitado
// chamando createAdminClient() dentro do handler (Bloco 4.7).
let _sb;
function sb() {
  if (!_sb) _sb = createAdminClient();
  return _sb;
}

// Mesma lista de bots de lead.js:1040 — ignora rastreadores de link preview
// (WhatsApp/Facebook/etc já abrem o link pra montar o cartão do Open Graph,
// isso não é visita de gente de verdade).
const BOT_UA_RE = /bot|crawler|spider|facebookexternalhit|whatsapp|telegrambot|slackbot|twitterbot|linkedinbot|discordbot|pinterest|embedly|quora|outbrain|redditbot|applebot|bingbot|googlebot|semrushbot|ahrefsbot|mj12bot|petalbot|preview/i;

async function incrementarStat(userId, coluna) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: existente } = await sb().from("site_stats").select("id, visitas, cliques").eq("user_id", userId).eq("dia", hoje).maybeSingle();
  if (existente) {
    await sb().from("site_stats").update({ [coluna]: (existente[coluna] || 0) + 1 }).eq("id", existente.id);
  } else {
    await sb().from("site_stats").insert({ user_id: userId, dia: hoje, visitas: coluna === "visitas" ? 1 : 0, cliques: coluna === "cliques" ? 1 : 0 });
  }
}

// userAgent é passado pela rota (extraído do header) em vez do objeto `req`
// inteiro de inq-saas -- mesmo comportamento, sem acoplar este módulo ao
// runtime HTTP.
async function registrarVisita(userId, userAgent) {
  if (BOT_UA_RE.test(userAgent || "")) return;
  await incrementarStat(userId, "visitas");
}

// Campanhas com palavra secreta que valem hoje (sem data = campanha sempre ativa).
async function campanhasAtivasHoje(userId) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data } = await sb().from("campanhas")
    .select("id, nome, palavra_chave, link_divulgacao, credito_tipo, credito_valor, credito_prazo_dias, data_inicio, data_fim")
    .eq("user_id", userId);
  return (data || []).filter(c =>
    (!c.data_inicio || c.data_inicio <= hoje) && (!c.data_fim || c.data_fim >= hoje)
  );
}

// Equivalente a inq-saas/api/lead.js:1088-1107 (acao==="site").
export async function renderizarSite({ slug, userAgent }) {
  const slugLimpo = (slug || "").trim();
  if (!slugLimpo) return { status: 400, contentType: "text/html", body: paginaSiteIndisponivel() };

  const { data: tenant } = await sb().from("ink_clientes").select("auth_user_id, status, plano").eq("slug", slugLimpo).single();
  if (!tenant || tenant.status !== "ativo") return { status: 404, contentType: "text/html", body: paginaSiteIndisponivel() };

  const uid = tenant.auth_user_id;
  // Conta demo nunca publica de verdade, mesmo com "Publicado" ligado no CRM.
  if (uid === process.env.DEMO_USER_ID) return { status: 404, contentType: "text/html", body: paginaSiteIndisponivel() };

  const [{ data: site }, { data: cfg }, { data: artistas }] = await Promise.all([
    sb().from("site_conteudo").select("*").eq("user_id", uid).single(),
    sb().from("configuracoes").select("studio_name, studio_tel, studio_city, studio_estado, categoria_negocio, meta_pixel_id, servico_opts").eq("user_id", uid).single(),
    sb().from("artistas").select("id, nome, insta, foto_site_url, bio_site, portfolio_fotos, botao_social_label, ordem_site, servicos_atendidos").eq("user_id", uid).eq("ativo", true).order("ordem_site", { ascending: true, nullsFirst: false }).order("nome"),
  ]);
  if (!site || !site.publicado) return { status: 404, contentType: "text/html", body: paginaSiteIndisponivel() };

  // Serverless: se não esperar aqui, a função pode encerrar antes do
  // registro terminar de gravar (fire-and-forget não é confiável).
  await registrarVisita(uid, userAgent).catch(() => {});
  const campanhasAtivas = await campanhasAtivasHoje(uid).catch(() => []);

  return { status: 200, contentType: "text/html", body: paginaSitePremium(site, cfg, artistas || [], slugLimpo, campanhasAtivas, tenant.plano) };
}

// Equivalente a inq-saas/api/lead.js:1174-1187 (acao==="preview").
export async function renderizarPreview({ method, site, cfg, artistas, slug }) {
  if (method !== "POST") return { status: 405, contentType: "application/json", body: JSON.stringify({ error: "Method not allowed" }) };

  let campanhasAtivas = [];
  let planoPreview = null;
  if (slug) {
    const { data: tenantPreview } = await sb().from("ink_clientes").select("auth_user_id, plano").eq("slug", slug).single();
    if (tenantPreview) {
      campanhasAtivas = await campanhasAtivasHoje(tenantPreview.auth_user_id).catch(() => []);
      planoPreview = tenantPreview.plano;
    }
  }

  return { status: 200, contentType: "text/html", body: paginaSitePremium(site || {}, cfg || {}, artistas || [], slug || "", campanhasAtivas, planoPreview) };
}
