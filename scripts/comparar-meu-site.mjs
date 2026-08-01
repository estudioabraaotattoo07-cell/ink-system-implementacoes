// Harness de comparação automática — Bloco 4.8.
//
// Objetivo: provar que lib/site-publico/dados.js (renderizarSite/
// renderizarPreview), rodando neste projeto, se comporta exatamente como
// inq-saas/api/lead.js (acao==="site" [:1088-1107] e acao==="preview"
// [:1174-1187]) hoje em produção.
//
// Como funciona: intercepta global.fetch (mesmo padrão do harness de
// fixtures do Bloco 4.6 em inq-saas) simulando o Postgrest do Supabase com
// um banco fixture em memória, e roda o código real deste projeto contra
// cenários que cobrem toda ramificação de decisão descrita em lead.js. Não
// toca o Supabase de produção, não depende de nenhum tenant real, é
// reprodutível a qualquer momento (inclusive antes do corte de tráfego do
// Bloco 4.9).
//
// Rodar: node --import ./scripts/_harness/register-hook.mjs scripts/comparar-meu-site.mjs

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://harness.invalid.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "harness-fake-key-nao-e-segredo-real";
process.env.DEMO_USER_ID = "uid-demo";

// ── Banco fixture em memória ────────────────────────────────────────────────
const DB = {
  ink_clientes: [
    { slug: "ativo-completo", auth_user_id: "uid-1", status: "ativo", plano: "Ouro" },
    { slug: "inativo", auth_user_id: "uid-2", status: "inativo", plano: "Bronze" },
    { slug: "conta-demo", auth_user_id: "uid-demo", status: "ativo", plano: "Prata" },
    { slug: "sem-site-criado", auth_user_id: "uid-3", status: "ativo", plano: "Bronze" },
    { slug: "nao-publicado", auth_user_id: "uid-4", status: "ativo", plano: "Bronze" },
    { slug: "preview-tenant", auth_user_id: "uid-5", status: "ativo", plano: "Ouro" },
  ],
  site_conteudo: [
    {
      user_id: "uid-1", publicado: true,
      hero_frase: "Primeira linha\nSegunda linha", hero_botao_texto: "Agende agora",
      manifesto_frase: "Nossa arte, sua história.", como_titulo: null, como_passos: null,
      banner_foto_url: null, banner_titulo: null, banner_texto: null,
      depoimentos: [{ texto: "Adorei o resultado!", autor: "Cliente Fixture", estrelas: 5 }],
      estilo: {}, hero_foto_url: "https://x.test/hero.jpg",
    },
    { user_id: "uid-4", publicado: false, hero_frase: "rascunho" },
  ],
  configuracoes: [
    { user_id: "uid-1", studio_name: "Estúdio Fixture", studio_tel: "27999999999", studio_city: "Vila Velha", studio_estado: "ES", categoria_negocio: "Estúdio de tatuagem", meta_pixel_id: "", servico_opts: [{ nome: "Tatuagem" }] },
    { user_id: "uid-4", studio_name: "Estúdio Não Publicado" },
  ],
  artistas: [
    { user_id: "uid-1", id: "art-1", nome: "Fulano de Tal", insta: "@fulano", foto_site_url: "https://x.test/foto.jpg", bio_site: "Bio curta de teste", portfolio_fotos: ["https://x.test/1.jpg", "https://x.test/2.jpg"], botao_social_label: null, ordem_site: 1, servicos_atendidos: [], ativo: true },
  ],
  campanhas: [
    { user_id: "uid-1", id: "camp-1", nome: "Julho", palavra_chave: "julho", link_divulgacao: "https://wa.me/x", credito_tipo: null, credito_valor: null, credito_prazo_dias: null, data_inicio: null, data_fim: null },
    { user_id: "uid-5", id: "camp-2", nome: "Preview", palavra_chave: "preview", link_divulgacao: "https://wa.me/y", credito_tipo: null, credito_valor: null, credito_prazo_dias: null, data_inicio: null, data_fim: null },
  ],
  site_stats: [],
};

// ── Mock de fetch, emulando o protocolo real do Postgrest (verificado no
// código-fonte instalado de @supabase/postgrest-js/dist/index.cjs desta
// rodada: .single() pede Accept "application/vnd.pgrst.object+json" e o
// servidor devolve objeto solto (200) ou erro (406) fora dessa cardinalidade;
// .maybeSingle()/select simples sempre devolvem array, desembrulhado no
// cliente) ────────────────────────────────────────────────────────────────
function aplicarFiltros(linhas, params) {
  let resultado = linhas;
  for (const [chave, valor] of params.entries()) {
    if (chave === "select" || chave === "order" || chave === "limit") continue;
    if (valor.startsWith("eq.")) {
      const alvo = valor.slice(3);
      resultado = resultado.filter(l => String(l[chave]) === alvo);
    }
  }
  return resultado;
}

global.fetch = async (urlStr, opts = {}) => {
  const url = new URL(urlStr);
  const tabela = url.pathname.replace("/rest/v1/", "");
  const metodo = (opts.method || "GET").toUpperCase();
  const accept = new Headers(opts.headers || {}).get("Accept") || "";
  const esperaObjeto = accept.startsWith("application/vnd.pgrst.object+json");

  if (!(tabela in DB)) {
    return new Response(JSON.stringify({ message: `tabela fixture não configurada: ${tabela}` }), { status: 500 });
  }

  if (metodo === "POST") {
    // insert -- usado só por site_stats nesta harness.
    const corpo = JSON.parse(opts.body);
    DB[tabela].push(corpo);
    return new Response("[]", { status: 201 });
  }
  if (metodo === "PATCH") {
    // update -- usado só por site_stats nesta harness.
    const corpo = JSON.parse(opts.body);
    const linhas = aplicarFiltros(DB[tabela], url.searchParams);
    linhas.forEach(l => Object.assign(l, corpo));
    return new Response("[]", { status: 200 });
  }

  const linhas = aplicarFiltros(DB[tabela], url.searchParams);
  if (esperaObjeto) {
    if (linhas.length === 1) return new Response(JSON.stringify(linhas[0]), { status: 200 });
    return new Response(JSON.stringify({ code: "PGRST116", details: `Results contain ${linhas.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" }), { status: 406 });
  }
  return new Response(JSON.stringify(linhas), { status: 200 });
};

// ── Harness ──────────────────────────────────────────────────────────────
const { renderizarSite, renderizarPreview } = await import("../lib/site-publico/dados.js");
const { paginaSiteIndisponivel } = await import("../lib/site-publico/paginaSiteIndisponivel.js");
const { paginaSitePremium } = await import("../lib/site-publico/paginaSitePremium.js");

let total = 0, falhas = 0;
function checar(nome, condicao, detalhe) {
  total++;
  if (condicao) {
    console.log(`  OK  ${nome}`);
  } else {
    falhas++;
    console.log(`FALHA ${nome}${detalhe ? " — " + detalhe : ""}`);
  }
}

const HTML_INDISPONIVEL = paginaSiteIndisponivel();

console.log("\n=== acao===\"site\" (lead.js:1088-1107) → renderizarSite() ===\n");

{
  const r = await renderizarSite({ slug: "", userAgent: "Mozilla/5.0" });
  checar("slug vazio -> 400 + página indisponível", r.status === 400 && r.body === HTML_INDISPONIVEL);
}
{
  const r = await renderizarSite({ slug: "slug-que-nao-existe", userAgent: "Mozilla/5.0" });
  checar("tenant não encontrado -> 404 + indisponível", r.status === 404 && r.body === HTML_INDISPONIVEL);
}
{
  const r = await renderizarSite({ slug: "inativo", userAgent: "Mozilla/5.0" });
  checar("tenant status!=ativo -> 404 + indisponível", r.status === 404 && r.body === HTML_INDISPONIVEL);
}
{
  const r = await renderizarSite({ slug: "conta-demo", userAgent: "Mozilla/5.0" });
  checar("uid===DEMO_USER_ID -> 404 + indisponível", r.status === 404 && r.body === HTML_INDISPONIVEL);
}
{
  const r = await renderizarSite({ slug: "sem-site-criado", userAgent: "Mozilla/5.0" });
  checar("site_conteudo inexistente -> 404 + indisponível", r.status === 404 && r.body === HTML_INDISPONIVEL);
}
{
  const r = await renderizarSite({ slug: "nao-publicado", userAgent: "Mozilla/5.0" });
  checar("site.publicado===false -> 404 + indisponível", r.status === 404 && r.body === HTML_INDISPONIVEL);
}
{
  const antesStats = DB.site_stats.length;
  const r = await renderizarSite({ slug: "ativo-completo", userAgent: "Mozilla/5.0 (visitante real)" });
  const esperado = paginaSitePremium(
    DB.site_conteudo.find(s => s.user_id === "uid-1"),
    DB.configuracoes.find(c => c.user_id === "uid-1"),
    DB.artistas.filter(a => a.user_id === "uid-1"),
    "ativo-completo",
    [DB.campanhas.find(c => c.id === "camp-1")],
    "Ouro"
  );
  checar("happy path -> 200 + HTML completo idêntico a paginaSitePremium()", r.status === 200 && r.body === esperado);
  checar("happy path -> contentType text/html", r.contentType === "text/html");
  checar("happy path -> registrarVisita gravou em site_stats", DB.site_stats.length === antesStats + 1);
}
{
  const antesStats = DB.site_stats.length;
  await renderizarSite({ slug: "ativo-completo", userAgent: "Mozilla/5.0 facebookexternalhit/1.1 (+bot)" });
  checar("visita de bot conhecido -> NÃO incrementa site_stats (lead.js:1040/1053)", DB.site_stats.length === antesStats);
}

console.log("\n=== acao===\"preview\" (lead.js:1174-1187) → renderizarPreview() ===\n");

{
  const r = await renderizarPreview({ method: "GET", site: {}, cfg: {}, artistas: [], slug: "" });
  checar("método != POST -> 405 + {error:\"Method not allowed\"} idêntico", r.status === 405 && r.contentType === "application/json" && r.body === JSON.stringify({ error: "Method not allowed" }));
}
{
  const siteDraft = { hero_frase: "Rascunho ainda não salvo" };
  const cfgDraft = { studio_name: "Rascunho Estúdio" };
  const r = await renderizarPreview({ method: "POST", site: siteDraft, cfg: cfgDraft, artistas: [], slug: "" });
  const esperado = paginaSitePremium(siteDraft, cfgDraft, [], "", [], null);
  checar("POST sem slug -> renderiza rascunho direto (sem tocar banco), idêntico a paginaSitePremium()", r.status === 200 && r.body === esperado);
}
{
  const r = await renderizarPreview({ method: "POST", site: {}, cfg: {}, artistas: [], slug: "preview-tenant" });
  const esperado = paginaSitePremium({}, {}, [], "preview-tenant", [DB.campanhas.find(c => c.id === "camp-2")], "Ouro");
  checar("POST com slug encontrado -> aplica campanhasAtivas + plano do tenant", r.status === 200 && r.body === esperado);
}
{
  const r = await renderizarPreview({ method: "POST", site: {}, cfg: {}, artistas: [], slug: "slug-inexistente" });
  const esperado = paginaSitePremium({}, {}, [], "slug-inexistente", [], null);
  checar("POST com slug não encontrado -> cai para campanhasAtivas=[] e plano=null", r.status === 200 && r.body === esperado);
}

console.log(`\n${total - falhas}/${total} verificações OK.`);
if (falhas > 0) {
  console.log(`${falhas} falha(s).`);
  process.exit(1);
}
console.log("Comparação automática do Bloco 4.8: nenhuma divergência encontrada.");
