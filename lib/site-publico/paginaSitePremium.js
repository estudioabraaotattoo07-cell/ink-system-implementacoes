// Portado de inq-saas/api/lead.js (linhas 136-1031) — Bloco 4.8.
// Origem oficial: inq-saas em produção (não a cópia de ink-system-plataform).
// Verificado nesta rodada por diff linha a linha contra o inq-saas atual —
// corpo byte-idêntico, única diferença é o esc() anexado ao final (helper
// que em lead.js é compartilhado no topo do arquivo; aqui precisa estar
// junto, porque este módulo tem que ser autocontido). Ver Auditoria
// Pós-Implementação do Bloco 4.8 para o diff completo.
// Função pura: recebe todos os dados prontos via parâmetro (site, cfg,
// artistas, slug, campanhasAtivas, plano) e devolve uma string HTML completa.
// Sem chamada ao Supabase, sem dependência de sessão, Vite ou React.
// Ainda sem tráfego real apontado pra cá — a religação é o Bloco 4.9.

// Molde "Premium" — site publico do tenant, gerado a partir de site_conteudo +
// configuracoes + artistas (colunas foto_site_url/bio_site/portfolio_fotos).
// Publicacao automatica: nao ha build, o HTML e montado na hora a cada visita.
// Mesmos limites de PLANO_LIMITES.fotosPorArtista no CRM -- serve de segunda
// trava aqui na exibição do site, caso o cadastro tenha mais fotos do que o
// plano atual permite (ex: fotos antigas de antes do limite existir, ou
// downgrade de plano depois de já ter subido mais fotos).
const FOTOS_POR_ARTISTA_PLANO = { Bronze: 5, Prata: 15, Ouro: 30 };
export function paginaSitePremium(site, cfg, artistas, slug, campanhasAtivas, plano) {
  const carrosselAutomatico = plano === "Ouro";
  const limiteFotosPlano = FOTOS_POR_ARTISTA_PLANO[plano];
  const nomeEstudio = cfg?.studio_name || "Estúdio";
  const local = [cfg?.studio_city, cfg?.studio_estado].filter(Boolean).join(" · ");
  const tel = (cfg?.studio_tel || "").replace(/\D/g, "");
  const waLink = tel ? `https://wa.me/55${tel}` : "#";
  const heroFoto = site.hero_foto_url || "";
  const linhas = (site.hero_frase || `Arte na pele, criada\na partir da sua história.`).split("\n");
  const heroHeadline = linhas.map(l => esc(l)).join("<br>");

  // Cores/estilo personalizados — exclusivo plano Ouro (trava fica no CRM,
  // aqui só aplica o que já foi salvo; sem estilo salvo = visual padrão de sempre).
  const est = site.estilo || {};
  const corFundo = /^#[0-9a-f]{3,8}$/i.test(est.corFundo || "") ? est.corFundo : "#080808";
  // Brilho de canto do fundo (superior-esquerdo + inferior-direito) — mesmo padrão
  // visual do CRM/admin, com cor e intensidade editáveis (exclusivo Ouro).
  const corBrilho = /^#[0-9a-f]{3,8}$/i.test(est.corBrilho || "") ? est.corBrilho : "#8B5CDE";
  const hexToRgb = (hex) => {
    const h = hex.replace("#", "");
    const n = h.length === 3 ? h.split("").map(c => c + c).join("") : h.slice(0, 6);
    const num = parseInt(n, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };
  const [brR, brG, brB] = hexToRgb(corBrilho);
  const intensidadeBrilhoOpacidade = { sutil: 0.14, medio: 0.24, forte: 0.36 }[est.intensidadeBrilho] || 0.24;
  const fundoComBrilho = `radial-gradient(700px 700px at -10% -10%, rgba(${brR},${brG},${brB},${intensidadeBrilhoOpacidade}), transparent 60%) fixed, radial-gradient(700px 700px at 110% 110%, rgba(${brR},${brG},${brB},${intensidadeBrilhoOpacidade}), transparent 60%) fixed, ${corFundo}`;
  const corBotao1 = /^#[0-9a-f]{3,8}$/i.test(est.corBotao1 || "") ? est.corBotao1 : "#E8C97A";
  const corBotao2 = /^#[0-9a-f]{3,8}$/i.test(est.corBotao2 || "") ? est.corBotao2 : "#8a6a24";
  const corTitulo = /^#[0-9a-f]{3,8}$/i.test(est.corTitulo || "") ? est.corTitulo : "#ffffff";
  const corCorpo = /^#[0-9a-f]{3,8}$/i.test(est.corCorpo || "") ? est.corCorpo : "rgba(255,255,255,0.38)";
  const radius = { arredondado: "14px", capsula: "999px" }[est.cantos] || "0px";
  const glow = { nenhum: "0px", suave: "10px", intenso: "26px" }[est.brilho] || "0px";
  const velocidadeMult = { lento: 1.6, normal: 1, rapido: 0.6 }[est.velocidadeCarrossel] || 1;

  // Composições de fonte prontas (título + corpo já combinados por um designer)
  // em vez de escolher cada fonte solta — mais fácil de acertar visualmente.
  // Só carrega no Google Fonts as 2 famílias da composição escolhida, não as 12.
  const FONT_PRESETS = {
    classico: { nome: "Clássico Elegante", titulo: "'Cormorant Garamond',serif", corpo: "'Montserrat',sans-serif", google: "Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Montserrat:wght@300;400;500;600" },
    editorial: { nome: "Editorial Moderno", titulo: "'Playfair Display',serif", corpo: "'Inter',sans-serif", google: "Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600" },
    minimalista: { nome: "Minimalista", titulo: "'Poppins',sans-serif", corpo: "'Inter',sans-serif", google: "Poppins:wght@300;500;600&family=Inter:wght@300;400;500" },
    vintage: { nome: "Vintage", titulo: "'Abril Fatface',serif", corpo: "'Lato',sans-serif", google: "Abril+Fatface&family=Lato:wght@300;400;600" },
    urbano: { nome: "Urbano", titulo: "'Bebas Neue',sans-serif", corpo: "'Roboto',sans-serif", google: "Bebas+Neue&family=Roboto:wght@300;400;500" },
    sofisticado: { nome: "Sofisticado", titulo: "'Cormorant',serif", corpo: "'Work Sans',sans-serif", google: "Cormorant:wght@300;500;600&family=Work+Sans:wght@300;400;500" },
    gotico: { nome: "Gótico", titulo: "'Cinzel',serif", corpo: "'Nunito Sans',sans-serif", google: "Cinzel:wght@400;600&family=Nunito+Sans:wght@300;400;600" },
    artdeco: { nome: "Art Déco", titulo: "'Poiret One',sans-serif", corpo: "'Raleway',sans-serif", google: "Poiret+One&family=Raleway:wght@300;400;500" },
    rustico: { nome: "Rústico", titulo: "'Special Elite',cursive", corpo: "'Roboto Condensed',sans-serif", google: "Special+Elite&family=Roboto+Condensed:wght@300;400;500" },
    futurista: { nome: "Futurista", titulo: "'Orbitron',sans-serif", corpo: "'Rubik',sans-serif", google: "Orbitron:wght@400;600;700&family=Rubik:wght@300;400;500" },
    autoral: { nome: "Autoral", titulo: "'Caveat',cursive", corpo: "'Montserrat',sans-serif", google: "Caveat:wght@500;700&family=Montserrat:wght@300;400;500" },
    serifmoderna: { nome: "Serifada Moderna", titulo: "'Fraunces',serif", corpo: "'DM Sans',sans-serif", google: "Fraunces:wght@400;600&family=DM+Sans:wght@300;400;500" },
  };
  const fontePreset = FONT_PRESETS[est.fontePreset] || FONT_PRESETS.classico;
  const fonteTitulo = fontePreset.titulo;
  const fonteCorpo = fontePreset.corpo;
  const googleFontsHref = `https://fonts.googleapis.com/css2?family=${fontePreset.google}&display=swap`;

  const IG_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><path d="M12 2.2c3.2 0 3.58.01 4.85.07 1.17.05 1.8.24 2.23.41.56.21.96.47 1.38.89.42.42.68.82.89 1.38.17.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.24 1.8-.41 2.23-.21.56-.47.96-.89 1.38-.42.42-.82.68-1.38.89-.42.17-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.24-2.23-.41a3.7 3.7 0 0 1-1.38-.89 3.7 3.7 0 0 1-.89-1.38c-.17-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.24-1.8.41-2.23.21-.56.47-.96.89-1.38.42-.42.82-.68 1.38-.89.42-.17 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.31-1.46.72-2.13 1.38C1.35 2.68.94 3.35.63 4.14c-.3.76-.5 1.64-.56 2.91C0 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.72 1.46 1.38 2.13.67.66 1.34 1.07 2.13 1.38.76.3 1.64.5 2.91.56C8.33 24 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.79-.31 1.46-.72 2.13-1.38.66-.67 1.07-1.34 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.13A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Z" fill="currentColor"/><path d="M12 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84Zm0 10.16A4 4 0 1 1 16 12a4 4 0 0 1-4 4Z" fill="currentColor"/><circle cx="18.41" cy="5.59" r="1.44" fill="currentColor"/></svg>`;
  const EXPAND_ICON = `<svg viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  const stripIdsComFotos = [];
  const artistasHtml = (artistas || []).map((a, artIdx) => {
    const fotosCadastradas = Array.isArray(a.portfolio_fotos) ? a.portfolio_fotos : [];
    const fotos = limiteFotosPlano !== undefined ? fotosCadastradas.slice(0, limiteFotosPlano) : fotosCadastradas;
    const stripId = `strip-${artIdx}`;
    if (fotos.length > 0) stripIdsComFotos.push(stripId);
    const igHandle = (a.insta || "").replace(/^@/, "");
    const bioLen = (a.bio_site || "").length;
    const bioFontSize = bioLen > 350 ? 11.5 : bioLen > 220 ? 12.5 : 13.5;
    // Esteira roda sozinha: a lista de fotos é duplicada e anda -50% em loop,
    // criando a ilusão de rolagem infinita sem salto no fim. Duração calculada
    // por velocidade constante (~70px/s, mesmo ritmo do site real) em vez de um
    // tempo fixo — senão poucas fotos ficam lentas e muitas fotos ficam rápidas.
    // Todas as esteiras andam pro mesmo lado (decisão 2026-07-13).
    const dir = carrosselAutomatico ? "go-right" : "";
    const largItem = 204; // 200px de foto + 4px de gap
    const duracaoSeg = Math.max(12, Math.round((fotos.length * largItem) / 70 * velocidadeMult));
    // A duplicação da lista só faz sentido pro plano Ouro, onde a esteira anda
    // sozinha e precisa do "loop" pra não dar salto no fim. Nos outros planos
    // (esteira estática, só setas manuais) duplicar só repete as mesmas fotos
    // à toa.
    const fotosStrip = fotos.length > 0
      ? (carrosselAutomatico ? [...fotos, ...fotos] : fotos).map(f => `<div class="strip-item" data-src="${esc(f)}"><img src="${esc(f)}" alt=""><div class="strip-ov"><div class="strip-exp">${EXPAND_ICON}</div></div></div>`).join("")
      : "";
    return `
    <div class="artist-row">
      <img class="artist-photo" src="${esc(a.foto_site_url || "")}" alt="${esc(a.nome)}">
      <div class="artist-info">
        <div class="artist-eyebrow">Trabalhos de:</div>
        <div class="artist-name">${esc(a.nome)}</div>
        ${a.bio_site ? `<div class="artist-tagline" style="font-size:${bioFontSize}px">${esc(a.bio_site)}</div>` : ""}
        ${igHandle ? `<a class="ig-link" href="https://instagram.com/${esc(igHandle)}" target="_blank">${IG_ICON}${esc(a.botao_social_label || ("@" + igHandle))}</a>` : ""}
        <a class="btn-gold" href="javascript:void(0)" onclick="AuraChat.abrir('${esc(a.id)}')" style="margin-top:18px">✦ Quero tatuar com ${esc((a.nome || "").split(" ")[0])}</a>
      </div>
    </div>
    ${fotos.length > 0 ? `<div class="strip-outer">
      <div class="strip-track ${dir}" id="${stripId}" style="animation-duration:${duracaoSeg}s">${fotosStrip}</div>
      <div class="strip-nav strip-nav-prev" onclick="stripArrow('${stripId}','prev')"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></div>
      <div class="strip-nav strip-nav-next" onclick="stripArrow('${stripId}','next')"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
    </div>` : ""}`;
  }).join("");

  const passosDefault = [
    { nome: "Conversa", desc: "Você conta a sua história, referências e intenção. Sem pressa." },
    { nome: "Criação", desc: "Desenvolvemos, do zero, a melhor arte pra você." },
    { nome: "Execução", desc: "Sessão focada, com técnica e atenção total ao seu conforto." },
    { nome: "Cuidado", desc: "Acompanhamento da cicatrização e garantia de resultado." },
  ];
  const comoPassos = Array.isArray(site.como_passos) && site.como_passos.length > 0 ? site.como_passos : passosDefault;
  const comoPassosHtml = comoPassos.map((p, i) => `<div class="como-step"><div class="como-num">${String(i + 1).padStart(2, "0")}</div><div class="como-name">${esc(p.nome || "")}</div><div class="como-desc">${esc(p.desc || "")}</div></div>`).join("");

  const depoimentos = Array.isArray(site.depoimentos) ? site.depoimentos : [];
  const depoimentosHtml = depoimentos.map(d => `
    <div class="depo-card">
      <div class="depo-stars">${"★".repeat(Math.max(1, Math.min(5, d.estrelas || 5)))}</div>
      <p class="depo-text">"${esc(d.texto || "")}"</p>
      <span class="depo-author">— ${esc(d.autor || "")}</span>
      ${d.imagem_url ? `<div class="depo-print-link" onclick="lbOpenImg('${esc(d.imagem_url).replace(/'/g, "\\'")}')"><img class="depo-print" src="${esc(d.imagem_url)}" alt="Print do depoimento"></div>` : ""}
    </div>`).join("");

  const ogDescricao = (site.manifesto_frase || site.hero_frase || `Arte na pele, criada a partir da sua história.`).replace(/\n/g, " ");
  const ogUrl = slug ? `https://inksystem.com.br/${esc(slug)}` : "";
  // Categoria vem de Configurações > Configurações avançadas — texto livre,
  // default cobre o único caso real hoje (estúdio de tatuagem), mas não deve
  // ser fixo no código pra não "mentir" se um dia outro segmento comprar o sistema.
  const categoriaNegocio = cfg?.categoria_negocio || "Estúdio de tatuagem";
  const localBusinessJsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: nomeEstudio,
    description: categoriaNegocio,
    ...(cfg?.studio_city ? { address: { "@type": "PostalAddress", addressLocality: cfg.studio_city, addressRegion: cfg.studio_estado || undefined } } : {}),
    ...(tel ? { telephone: `+55${tel}` } : {}),
    ...(heroFoto ? { image: heroFoto } : {}),
    ...(ogUrl ? { url: ogUrl } : {}),
  };
  const pixelId = (cfg?.meta_pixel_id || "").replace(/[^0-9]/g, "");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(nomeEstudio)} – ${esc(categoriaNegocio)}</title>
<meta name="description" content="${esc(ogDescricao)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(nomeEstudio)}">
<meta property="og:description" content="${esc(ogDescricao)}">
${heroFoto ? `<meta property="og:image" content="${esc(heroFoto)}">` : ""}
${ogUrl ? `<meta property="og:url" content="${ogUrl}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(localBusinessJsonLd)}</script>
${pixelId ? `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${esc(pixelId)}');
fbq('track', 'PageView');
</script>` : ""}
<link href="${googleFontsHref}" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--gold:${corBotao1};--gold-2:${corBotao2};--gold-dim:rgba(201,168,76,0.35);--bg:${corFundo};--off:#e8e4dc;--dim:${corCorpo};--pad:52px;--radius:${radius};--font-titulo:${fonteTitulo};--font-corpo:${fonteCorpo};--cor-titulo:${corTitulo};--glow:${glow}}
html{scroll-behavior:smooth}
body{background:${fundoComBrilho};color:var(--cor-titulo);font-family:var(--font-corpo);overflow-x:hidden}
.nav{position:fixed;top:0;left:0;right:0;z-index:300;display:flex;align-items:center;justify-content:space-between;padding:14px var(--pad);background:rgba(8,8,8,0.93);backdrop-filter:blur(14px);border-bottom:0.5px solid rgba(255,255,255,0.05)}
.nav-name{font-size:9px;font-weight:500;letter-spacing:3px;color:var(--off);text-transform:uppercase}
.nav-cta{font-size:7.5px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);padding:10px 22px;background:transparent;text-decoration:none;white-space:nowrap}
.hero{position:relative;width:100%;height:100vh;min-height:500px;overflow:hidden}
.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(0.52)}
.hero-overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(8,8,8,0.1) 0%,rgba(8,8,8,0.05) 25%,rgba(8,8,8,0.35) 55%,rgba(8,8,8,0.78) 72%,rgba(8,8,8,0.96) 87%,#080808 100%)}
.hero-text{position:absolute;bottom:0;left:0;right:0;z-index:3;text-align:center;padding:0 24px 36px}
.hero-location{font-size:8px;font-weight:400;letter-spacing:5px;color:rgba(232,228,220,0.5);text-transform:uppercase;margin-bottom:14px}
.hero-headline{font-family:var(--font-titulo);font-size:clamp(28px,5vw,64px);font-weight:300;line-height:1.02;color:var(--cor-titulo);text-transform:uppercase}
.cta-zone{background:var(--bg);padding:44px var(--pad);display:flex;justify-content:center}
.btn-gold{display:inline-flex;align-items:center;gap:10px;font-size:8px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:#000;background:linear-gradient(135deg,var(--gold),var(--gold-2));border-radius:var(--radius);padding:16px 36px;text-decoration:none;white-space:nowrap;box-shadow:0 0 var(--glow) var(--gold-dim)}
.manifesto{padding:56px var(--pad) 96px;text-align:center}
.manifesto-quote{font-family:var(--font-titulo);font-size:clamp(22px,3.8vw,48px);font-weight:300;font-style:italic;color:var(--off);line-height:1.25;max-width:820px;margin:0 auto}
.portfolio-block{padding:64px 0 0}
.artist-row{display:flex;align-items:flex-end;padding:0 var(--pad);margin-bottom:28px;gap:22px}
.artist-photo{width:140px;height:185px;object-fit:cover;flex-shrink:0;border-radius:var(--radius)}
.artist-eyebrow{font-size:7.5px;font-weight:500;letter-spacing:4px;text-transform:uppercase;color:var(--gold);margin-bottom:8px}
.artist-name{font-family:var(--font-titulo);font-size:clamp(22px,2.8vw,34px);font-weight:300;color:var(--cor-titulo);margin-bottom:6px}
.artist-tagline{font-size:10px;color:var(--dim);letter-spacing:1px;margin-bottom:12px;max-width:360px}
.ig-link{display:inline-flex;align-items:center;gap:8px;font-size:8px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:var(--gold);background:transparent;border:1px solid var(--gold);border-radius:var(--radius);padding:14px 28px;text-decoration:none;white-space:nowrap;margin-bottom:10px}
.strip-outer{overflow:hidden;position:relative;padding-bottom:40px}
.strip-nav{position:absolute;top:0;bottom:40px;width:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:15;opacity:0;transition:opacity .25s}
.strip-outer:hover .strip-nav{opacity:1}
.strip-nav svg{width:16px;height:16px;stroke:#fff;fill:none;stroke-width:2;filter:drop-shadow(0 1px 3px rgba(0,0,0,.7))}
.strip-nav-prev{left:4px}
.strip-nav-next{right:4px}
.strip-outer::before,.strip-outer::after{content:"";position:absolute;top:0;bottom:40px;width:80px;z-index:10;pointer-events:none}
.strip-outer::before{left:0;background:linear-gradient(to right,var(--bg),transparent)}
.strip-outer::after{right:0;background:linear-gradient(to left,var(--bg),transparent)}
.strip-track{display:flex;gap:4px;width:max-content}
.strip-track.go-right{animation:goRight 45s linear infinite}
.strip-track.go-left{animation:goLeft 45s linear infinite}
.strip-outer:hover .strip-track{animation-play-state:paused}
@keyframes goRight{0%{transform:translateX(-50%)}100%{transform:translateX(0)}}
@keyframes goLeft{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
.strip-item{width:200px;height:255px;flex-shrink:0;overflow:hidden;background:#111;border-radius:var(--radius);position:relative;cursor:pointer}
.strip-item img{width:100%;height:100%;object-fit:cover;pointer-events:none}
.strip-ov{position:absolute;inset:0;background:rgba(0,0,0,0);transition:background .3s;display:flex;align-items:center;justify-content:center}
.strip-item:hover .strip-ov{background:rgba(0,0,0,0.22)}
.strip-exp{opacity:0;transition:opacity .3s;width:36px;height:36px;border-radius:50%;background:rgba(201,168,76,0.9);display:flex;align-items:center;justify-content:center}
.strip-item:hover .strip-exp{opacity:1}
.strip-exp svg{width:13px;height:13px;stroke:#000;fill:none;stroke-width:2}
.depo-print-link{cursor:pointer}
.lb{position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.96);display:none;align-items:center;justify-content:center}
.lb.open{display:flex}
.lb-img{max-width:75vw;max-height:75vh;object-fit:contain;width:auto;height:auto;border-radius:var(--radius)}
.lb-close{position:absolute;top:18px;right:20px;width:40px;height:40px;cursor:pointer;display:flex;align-items:center;justify-content:center;border:0.5px solid rgba(255,255,255,0.1);transition:border-color .2s}
.lb-close:hover{border-color:var(--gold)}
.lb-close svg{width:15px;height:15px;stroke:#fff;fill:none;stroke-width:1.5}
.lb-nav{position:absolute;top:50%;transform:translateY(-50%);width:42px;height:42px;cursor:pointer;display:flex;align-items:center;justify-content:center;border:0.5px solid rgba(255,255,255,0.1);transition:border-color .2s}
.lb-nav:hover{border-color:var(--gold)}
.lb-nav svg{width:15px;height:15px;stroke:#fff;fill:none;stroke-width:1.5}
.lb-prev{left:16px}.lb-next{right:16px}
.como{padding:88px var(--pad);border-top:0.5px solid rgba(255,255,255,0.04)}
.como-title{font-family:var(--font-titulo);font-size:clamp(26px,3.8vw,44px);font-weight:300;text-align:center;margin-bottom:56px}
.como-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:40px}
.como-step{text-align:center}
.como-num{font-family:var(--font-titulo);font-size:46px;font-weight:300;color:rgba(201,168,76,0.11);margin-bottom:14px}
.como-name{font-size:8.5px;font-weight:600;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px}
.como-desc{font-size:11px;color:var(--dim);line-height:1.9}
.depo{padding:72px var(--pad);background:#0a0a0a}
.depo-title{font-family:var(--font-titulo);font-size:clamp(24px,3vw,32px);font-weight:300;text-align:center;margin-bottom:40px}
.depo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:960px;margin:0 auto}
.depo-card{padding:24px 20px;border:0.5px solid rgba(255,255,255,0.06);border-radius:var(--radius)}
.depo-stars{color:var(--gold);font-size:10px;letter-spacing:3px;margin-bottom:12px}
.depo-text{font-size:11px;color:var(--dim);line-height:1.85;font-style:italic;margin-bottom:16px}
.depo-author{font-size:7.5px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.3)}
.depo-print-link{display:block;margin-top:12px}
.depo-print{width:100%;max-height:140px;object-fit:cover;border:0.5px solid rgba(255,255,255,0.1);border-radius:var(--radius);cursor:pointer;display:block}
.banner{position:relative;width:100%;overflow:hidden}
.banner-img{display:block;width:100%;height:auto;min-height:400px;object-fit:cover;filter:brightness(0.42)}
.banner-overlay{position:absolute;inset:0;background:linear-gradient(to bottom,#080808 0%,rgba(8,8,8,0.08) 20%,rgba(8,8,8,0.08) 65%,rgba(8,8,8,0.75) 84%,#080808 100%)}
.banner-bottom{position:absolute;bottom:0;left:0;right:0;z-index:2;padding:0 var(--pad) 56px;text-align:center}
.banner-title{font-family:var(--font-titulo);font-size:clamp(28px,5vw,58px);font-weight:300;line-height:1.05;color:var(--cor-titulo);margin-bottom:14px}
.banner-body{font-size:11.5px;color:rgba(232,228,220,0.5);line-height:1.9;max-width:520px;margin:0 auto}
footer{border-top:0.5px solid rgba(255,255,255,0.06);padding:36px var(--pad) 28px;background:#050505;text-align:center}
.footer-line{font-size:9px;color:rgba(255,255,255,0.4);letter-spacing:1px;margin-bottom:6px}
.footer-bottom{margin-top:20px;font-size:7.5px;color:rgba(255,255,255,0.18);letter-spacing:1.5px}
.aura-fab{position:fixed;bottom:26px;right:26px;z-index:220;height:52px;padding:0 22px;border-radius:999px;background:linear-gradient(135deg,#E8C97A,#C9A84C 45%,#8a6a24);display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 22px rgba(201,168,76,0.4);cursor:pointer;font-size:13px;font-weight:700;letter-spacing:.03em;color:#17140A;border:none;font-family:"Montserrat",sans-serif;white-space:nowrap}
.aura-wa-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;box-sizing:border-box;background:#25D366;color:#fff;border:none;border-radius:999px;padding:11px;font-size:12px;font-weight:700;text-decoration:none;font-family:"Montserrat",sans-serif}
.aura-panel{display:none;flex-direction:column;position:fixed;bottom:26px;right:26px;z-index:230;width:340px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 60px);background:radial-gradient(ellipse 300px 160px at 50% -10%, rgba(139,92,222,0.2), transparent 70%), linear-gradient(180deg,#151515,#0A0A0A);border:1px solid rgba(201,168,76,0.35);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.6);overflow:hidden;font-family:"Montserrat",sans-serif}
.aura-head{padding:14px 16px;background:rgba(0,0,0,0.3);border-bottom:1px solid rgba(201,168,76,0.2);display:flex;justify-content:space-between;align-items:center;font-size:12px;letter-spacing:1px;color:var(--gold)}
.aura-close{cursor:pointer;color:var(--dim);font-size:14px}
.aura-progress{height:2px;background:rgba(201,168,76,0.15)}
.aura-progress-fill{height:100%;width:0%;background:var(--gold);transition:width .35s ease}
.aura-msgs{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.aura-msgs>div:first-child{margin-top:auto}
.aura-msg-bot{background:rgba(255,255,255,0.06);color:#f0ede8;padding:9px 12px;border-radius:10px 10px 10px 2px;font-size:12.5px;line-height:1.5;max-width:85%;align-self:flex-start;white-space:pre-line}
.aura-msg-user{background:var(--gold);color:#17140A;padding:9px 12px;border-radius:10px 10px 2px 10px;font-size:12.5px;line-height:1.5;max-width:85%;align-self:flex-end;font-weight:600}
.aura-input-area{padding:12px 14px;border-top:1px solid rgba(201,168,76,0.15);display:flex;gap:8px;flex-wrap:wrap}
.aura-btns{display:flex;gap:8px;flex-wrap:wrap;width:100%}
.aura-btn{background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.4);color:var(--gold);padding:8px 14px;border-radius:20px;font-size:11.5px;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-block}
.aura-btn:hover{background:rgba(201,168,76,0.2)}
.aura-text-input{flex:1;background:#050505;border:1px solid rgba(201,168,76,0.25);border-radius:20px;padding:9px 14px;color:#fff;font-size:12.5px;font-family:inherit;outline:none;min-width:0}
.aura-send-btn{background:var(--gold);color:#17140A;border:none;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:14px;flex-shrink:0}
@media(max-width:480px){.aura-panel{width:100vw;height:100vh;max-height:100vh;max-width:100vw;bottom:0;right:0;border-radius:0}}
@media(max-width:768px){:root{--pad:20px}.como-grid{grid-template-columns:repeat(2,1fr)}.depo-grid{grid-template-columns:1fr}.artist-row{flex-direction:column;align-items:flex-start;text-align:left}.strip-nav{opacity:0.85}}
</style>
</head>
<body>
<nav class="nav">
  <span class="nav-name">${esc(nomeEstudio)}</span>
  <a class="nav-cta" href="javascript:void(0)" onclick="AuraChat.abrir()">✦ Marque seu horário</a>
</nav>
<section class="hero">
  ${heroFoto ? `<img class="hero-img" src="${esc(heroFoto)}" alt="${esc(nomeEstudio)}">` : ""}
  <div class="hero-overlay"></div>
  <div class="hero-text">
    ${local ? `<p class="hero-location">${esc(local)}</p>` : ""}
    <h1 class="hero-headline">${heroHeadline}</h1>
  </div>
</section>
<div class="cta-zone"><a class="btn-gold" href="javascript:void(0)" onclick="AuraChat.abrir()">✦ ${esc(site.hero_botao_texto || "Quero tatuar com vocês!")}</a></div>
${site.manifesto_frase ? `<section class="manifesto"><blockquote class="manifesto-quote">"${esc(site.manifesto_frase)}"</blockquote></section>` : ""}
<section class="portfolio-block">${artistasHtml}</section>
<section class="como">
  <h2 class="como-title">${esc(site.como_titulo || "No estúdio é assim:")}</h2>
  <div class="como-grid">
    ${comoPassosHtml}
  </div>
</section>
${depoimentosHtml ? `<section class="depo"><h2 class="depo-title">Nossos clientes dizem:</h2><div class="depo-grid">${depoimentosHtml}</div></section>` : ""}
${site.banner_foto_url ? `<section class="banner">
  <img class="banner-img" src="${esc(site.banner_foto_url)}" alt="${esc(nomeEstudio)}">
  <div class="banner-overlay"></div>
  <div class="banner-bottom">
    ${site.banner_titulo ? `<div class="banner-title">${esc(site.banner_titulo)}</div>` : ""}
    ${site.banner_texto ? `<p class="banner-body">${esc(site.banner_texto)}</p>` : ""}
    <a class="btn-gold" href="javascript:void(0)" onclick="AuraChat.abrir()" style="margin-top:22px">✦ ${esc(site.banner_botao_texto || "Quero tatuar com vocês!")}</a>
  </div>
</section>` : ""}
<footer>
  ${local ? `<div class="footer-line">${esc(local)}</div>` : ""}
  <div class="footer-line">© ${new Date().getFullYear()} ${esc(nomeEstudio)}</div>
  <div class="footer-bottom">Powered by INK SYSTEM</div>
</footer>
<div class="lb" id="lb">
  <div class="lb-close" id="lb-x"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
  <div class="lb-nav lb-prev" id="lb-prev"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></div>
  <img class="lb-img" id="lb-img" src="" alt="">
  <div class="lb-nav lb-next" id="lb-next"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
</div>
<button id="aura-fab" class="aura-fab" onclick="AuraChat.abrir()">✦ Marque agora</button>
<div id="aura-panel" class="aura-panel">
  <div class="aura-head"><span>✦ Fale com a gente</span><span class="aura-close" onclick="AuraChat.fechar()">✕</span></div>
  <div id="aura-progress" class="aura-progress"><div id="aura-progress-fill" class="aura-progress-fill"></div></div>
  <div id="aura-msgs" class="aura-msgs"></div>
  <div id="aura-input-area" class="aura-input-area"></div>
</div>
<script>
// Lightbox das fotos (esteira de portfólio + print de depoimento) + arraste
// manual da esteira (mouse/touch) e setas laterais -- mesmo padrão do site
// real (a-casa-dos-carvalho), adaptado pra N artistas dinâmicos.
var lbImgs = [], lbIdx = 0, lbMode = "strip";
function lbOpen(src, sid) {
  lbMode = "strip";
  var t = document.getElementById(sid);
  // A esteira duplica as fotos pra rolar em loop sem salto -- remove repetidas
  // aqui pra prev/next não ficar andando em círculo duas vezes por volta.
  lbImgs = t ? Array.from(new Set(Array.from(t.querySelectorAll(".strip-item")).map(function (el) { return el.dataset.src; }))) : [src];
  lbIdx = Math.max(0, lbImgs.indexOf(src));
  document.getElementById("lb-img").src = lbImgs[lbIdx] || src;
  document.getElementById("lb-prev").style.display = "flex";
  document.getElementById("lb-next").style.display = "flex";
  document.getElementById("lb").classList.add("open");
  document.querySelectorAll(".strip-track").forEach(function (el) { el.classList.add("paused"); });
}
function lbOpenImg(src) {
  lbMode = "single";
  document.getElementById("lb-img").src = src;
  document.getElementById("lb-prev").style.display = "none";
  document.getElementById("lb-next").style.display = "none";
  document.getElementById("lb").classList.add("open");
}
function lbClose() {
  document.getElementById("lb").classList.remove("open");
  document.querySelectorAll(".strip-track").forEach(function (el) { el.classList.remove("paused"); });
}
document.getElementById("lb").addEventListener("click", function (e) { if (e.target === document.getElementById("lb")) lbClose(); });
document.getElementById("lb-x").onclick = lbClose;
document.getElementById("lb-prev").onclick = function (e) { e.stopPropagation(); lbIdx = (lbIdx - 1 + lbImgs.length) % lbImgs.length; document.getElementById("lb-img").src = lbImgs[lbIdx]; };
document.getElementById("lb-next").onclick = function (e) { e.stopPropagation(); lbIdx = (lbIdx + 1) % lbImgs.length; document.getElementById("lb-img").src = lbImgs[lbIdx]; };
document.addEventListener("keydown", function (e) {
  if (!document.getElementById("lb").classList.contains("open")) return;
  if (e.key === "Escape") lbClose();
  if (lbMode === "strip" && e.key === "ArrowLeft") { lbIdx = (lbIdx - 1 + lbImgs.length) % lbImgs.length; document.getElementById("lb-img").src = lbImgs[lbIdx]; }
  if (lbMode === "strip" && e.key === "ArrowRight") { lbIdx = (lbIdx + 1) % lbImgs.length; document.getElementById("lb-img").src = lbImgs[lbIdx]; }
});

var CLICK_THRESH = 10;
var stripArrowFns = {};
function getStripOffset(track) { return new DOMMatrix(getComputedStyle(track).transform).m41; }
function setStripOffset(track, x) { track.style.transform = "translateX(" + x + "px)"; }
// Trava o arraste/seta na ultima e primeira foto pras esteiras estaticas
// (Bronze/Prata) -- sem isso, dava pra continuar "andando" pra fundo preto
// mesmo sem mais fotos. O Ouro tem animacao propria (classe go-right) e nao
// usa essa trava, porque a lista la ja vem duplicada de proposito pro loop.
function clampStripOffset(track, outer, x) {
  if (track.classList.contains("go-right")) return x;
  var min = Math.min(0, outer.clientWidth - track.scrollWidth);
  return Math.max(min, Math.min(0, x));
}
function stripArrow(trackId, dir) {
  var fn = stripArrowFns[trackId];
  if (fn) fn(dir);
}
function setupStrip(trackId) {
  var track = document.getElementById(trackId);
  if (!track) return;
  var outer = track.closest(".strip-outer");
  var isDrag = false, startX = 0, startOffset = 0, velX = 0, lastX = 0, lastT = 0, animFrame = null, dragDist = 0;
  function startDrag(x) {
    isDrag = true; dragDist = 0; startX = x; lastX = x; lastT = Date.now();
    startOffset = getStripOffset(track); track.classList.add("paused"); track.style.transition = "none";
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  }
  function moveDrag(x) {
    if (!isDrag) return;
    dragDist = Math.abs(x - startX); velX = (x - lastX) / (Date.now() - lastT || 1) * 16;
    lastX = x; lastT = Date.now(); setStripOffset(track, clampStripOffset(track, outer, startOffset + (x - startX)));
  }
  function endDrag() {
    if (!isDrag) return; isDrag = false; track.style.transition = "";
    var vel = velX;
    function inertia() {
      if (Math.abs(vel) < 0.5) { track.classList.remove("paused"); return; }
      vel *= 0.92;
      var alvo = clampStripOffset(track, outer, getStripOffset(track) + vel);
      setStripOffset(track, alvo);
      if (alvo === 0 || alvo <= outer.clientWidth - track.scrollWidth) { track.classList.remove("paused"); return; }
      animFrame = requestAnimationFrame(inertia);
    }
    if (Math.abs(vel) > 1) inertia(); else track.classList.remove("paused");
  }
  outer.addEventListener("mousedown", function (e) { startDrag(e.pageX); e.preventDefault(); });
  document.addEventListener("mousemove", function (e) { if (isDrag) moveDrag(e.pageX); });
  document.addEventListener("mouseup", endDrag);
  outer.addEventListener("touchstart", function (e) { startDrag(e.touches[0].pageX); }, { passive: true });
  outer.addEventListener("touchmove", function (e) { moveDrag(e.touches[0].pageX); }, { passive: true });
  outer.addEventListener("touchend", endDrag);
  outer.addEventListener("mouseenter", function () { if (!isDrag) track.classList.add("paused"); });
  outer.addEventListener("mouseleave", function () { if (!isDrag && !document.getElementById("lb").classList.contains("open")) track.classList.remove("paused"); });
  Array.from(track.querySelectorAll(".strip-item")).forEach(function (item) {
    item.addEventListener("click", function () {
      if (dragDist > CLICK_THRESH) return;
      lbOpen(item.dataset.src, trackId);
    });
  });
  stripArrowFns[trackId] = function (dir) {
    track.classList.add("paused"); track.style.transition = "transform .4s ease";
    setStripOffset(track, clampStripOffset(track, outer, getStripOffset(track) + (dir === "next" ? -204 : 204)));
    setTimeout(function () { track.style.transition = ""; }, 400);
  };
}
${stripIdsComFotos.map(id => `setupStrip(${JSON.stringify(id)});`).join("\n")}
</script>
<script>
(function(){
  var API_BASE = 'https://inq-saas.vercel.app';
  var ARTISTAS = ${JSON.stringify((artistas || []).map(a => ({ id: a.id, nome: a.nome, servicos: Array.isArray(a.servicos_atendidos) ? a.servicos_atendidos : [] })))};
  var SERVICOS = ${JSON.stringify((cfg?.servico_opts || []))};
  var SLUG = ${JSON.stringify(slug || "")};
  var WA_LINK = ${JSON.stringify(waLink)};
  var NOME_ESTUDIO = ${JSON.stringify(nomeEstudio)};
  // Só a existência/link -- a palavra secreta em si nunca é exposta no HTML,
  // fica só no banco pra validação server-side (senão qualquer um vendo o
  // código-fonte da página descobriria a palavra sem precisar dela de verdade).
  var CAMPANHAS_ATIVAS = ${JSON.stringify((campanhasAtivas || []).map(c => ({ link: c.link_divulgacao || "" })))};
  var ORIGEM_SLUG = (function(){
    try { return new URLSearchParams(window.location.search).get('origem') || ''; } catch (e) { return ''; }
  })();
  var lead = {};
  var history = [];
  var aberto = false;
  var refEnviadas = 0;
  // Total estimado a partir do que já é conhecido no carregamento (quantos
  // serviços o estúdio configurou, quantos artistas existem, se há campanha
  // ativa) -- e recalibrado pra baixo em 4 pontos do fluxo (abrir, buscarCliente
  // -- 2 vezes -- e passoIdeia), sempre que a informação real derruba uma
  // pergunta que a estimativa inicial não podia prever: artista já vindo do
  // link/botão de um artista específico; artista já vindo do cadastro de um
  // cliente recorrente; cliente recorrente já vinculado a campanha; serviço
  // escolhido filtrando os candidatos a artista pra 1 só. Segue sendo uma
  // aproximação, não um contador exato -- suficiente pra uma barra discreta.
  var ETAPA_ATUAL = 0;
  var ETAPA_TOTAL = 11 + (SERVICOS.length ? 1 : 0) + (CAMPANHAS_ATIVAS.length ? 1 : 0) + (ARTISTAS.length > 1 ? 1 : 0);
  function avancarEtapa(){
    ETAPA_ATUAL++;
    var pct = Math.min(100, Math.round((ETAPA_ATUAL / ETAPA_TOTAL) * 100));
    var fill = $('aura-progress-fill');
    if (fill) fill.style.width = pct + '%';
  }

  function $(id){ return document.getElementById(id); }

  var cliqueContado = false;
  function abrir(artistaPreEscolhido){
    if (!aberto) {
      aberto = true;
      $('aura-panel').style.display = 'flex';
      $('aura-fab').style.display = 'none';
    }
    if (!cliqueContado) {
      cliqueContado = true;
      if (SLUG) fetch(API_BASE + '/api/lead?acao=track_click&slug=' + encodeURIComponent(SLUG), { method: 'POST', keepalive: true }).catch(function(){});
    }
    if ($('aura-msgs').children.length === 0) {
      if (artistaPreEscolhido) {
        lead.artista = artistaPreEscolhido;
        var artPre = ARTISTAS.filter(function(a){ return a.id === artistaPreEscolhido; })[0];
        if (artPre) lead.artistaNome = artPre.nome;
        // Mesma recalibração já usada nos outros 2 pontos: artista já resolvido
        // aqui significa que passoArtista() vai pular direto pra confirmação.
        if (ARTISTAS.length > 1) ETAPA_TOTAL--;
      }
      passoIntro();
    }
  }
  function fechar(){
    aberto = false;
    $('aura-panel').style.display = 'none';
    $('aura-fab').style.display = 'flex';
  }

  // Toda mensagem exibida passa por aqui -- então capturar a transcrição
  // completa (pra aparecer na aba Histórico da ficha) é só empilhar em cada
  // uma dessas duas funções, sem precisar duplicar em cada pergunta do fluxo.
  function botMsg(texto){
    var d = document.createElement('div');
    d.className = 'aura-msg-bot';
    d.textContent = texto;
    $('aura-msgs').appendChild(d);
    $('aura-msgs').scrollTop = $('aura-msgs').scrollHeight;
    history.push({ role: 'assistant', content: texto });
  }
  function userMsg(texto){
    var d = document.createElement('div');
    d.className = 'aura-msg-user';
    d.textContent = texto;
    $('aura-msgs').appendChild(d);
    $('aura-msgs').scrollTop = $('aura-msgs').scrollHeight;
    history.push({ role: 'user', content: texto });
  }
  function mostrarBotoes(opcoes, onEscolher){
    var area = $('aura-input-area');
    area.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'aura-btns';
    opcoes.forEach(function(op){
      var b = document.createElement('button');
      b.className = 'aura-btn';
      b.textContent = op;
      b.onclick = function(){ userMsg(op); area.innerHTML = ''; onEscolher(op); };
      wrap.appendChild(b);
    });
    area.appendChild(wrap);
  }
  function mostrarInput(placeholder, onEnviar){
    var area = $('aura-input-area');
    area.innerHTML = '';
    var inp = document.createElement('input');
    inp.className = 'aura-text-input';
    inp.placeholder = placeholder;
    var btn = document.createElement('button');
    btn.className = 'aura-send-btn';
    btn.textContent = '→';
    function enviar(){
      var v = inp.value.trim();
      if (!v) return;
      userMsg(v);
      area.innerHTML = '';
      onEnviar(v);
    }
    btn.onclick = enviar;
    inp.onkeydown = function(e){ if (e.key === 'Enter') enviar(); };
    area.appendChild(inp);
    area.appendChild(btn);
    inp.focus();
  }

  function salvar(campos){
    Object.assign(lead, campos);
    var payload = Object.assign({}, lead, { slug: SLUG, orig: 'Site', origem_slug: ORIGEM_SLUG, chat_log: history });
    delete payload._jaECliente;
    delete payload._temCampanha;
    delete payload._clienteId;
    if (lead._clienteId) payload.clienteId = lead._clienteId;
    // Depois do primeiro salvamento bem-sucedido, todas as respostas seguintes
    // dessa mesma conversa mandam o clienteId junto -- sem isso, uma resposta
    // com telefone/e-mail ainda incompletos (ex: nao digitou nada valido ainda)
    // nao encontra o registro que acabou de ser criado e cria um cliente novo
    // a cada pergunta, em vez de ir completando o mesmo.
    return fetch(API_BASE + '/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if (data && data.clienteId) lead._clienteId = data.clienteId;
        return { json: function(){ return Promise.resolve(data); } };
      })
      .catch(function(){ return { json: function(){ return Promise.resolve(null); } }; });
  }
  function waBtnHtml(){
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.95 6.45 17.5 2 12.04 2Zm5.8 14.02c-.24.68-1.4 1.32-1.94 1.4-.5.08-1.13.11-1.82-.11-.42-.13-.96-.31-1.65-.6-2.9-1.25-4.79-4.17-4.94-4.36-.14-.2-1.18-1.56-1.18-2.98s.75-2.11 1.02-2.4c.26-.28.57-.35.76-.35.19 0 .38 0 .55.01.18.01.41-.07.64.49.24.57.81 1.98.88 2.12.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.16-.29.36-.42.49-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.19-.28.37-.23.62-.14.26.09 1.63.77 1.91.91.28.14.47.21.54.33.07.12.07.68-.17 1.36Z"/></svg>';
  }

  function passoIntro(){
    var quebra = String.fromCharCode(10);
    botMsg('Vamos preparar sua ficha de atendimento' + quebra + 'Você levará aproximadamente 1 minuto.' + quebra + 'Quanto mais informações compartilhar, mais personalizado será seu atendimento.' + quebra + 'Ao final, você também poderá continuar pelo WhatsApp do estúdio caso prefira.');
    mostrarBotoes(['Começar'], function(){ passoBoasVindas(); });
  }
  function passoBoasVindas(){
    avancarEtapa();
    botMsg('Olá! Eu sou a Aura e sou responsável por cadastrar você no ecossistema do ' + NOME_ESTUDIO + '. Você já realizou algum procedimento conosco?');
    mostrarBotoes(['Já sou cliente', 'Sou novo por aqui'], function(op){
      lead._jaECliente = op.indexOf('novo') === -1;
      passoAvisoColeta();
    });
  }
  function passoAvisoColeta(){
    avancarEtapa();
    botMsg('Precisamos coletar alguns dados pra registrar sua solicitação de agendamento. Qual seu nome completo?');
    mostrarInput('Seu nome completo', function(nome){ lead.nome = nome; passoTelefone(); });
  }
  function passoTelefone(){
    avancarEtapa();
    botMsg('Muito prazer, ' + lead.nome.split(' ')[0] + '! Por gentileza, você pode me informar o seu número de WhatsApp?');
    function pedirTelefone(){
      mostrarInput('(99) 99999-9999', function(tel){
        if (tel.replace(/[^0-9]/g, '').length < 10) {
          botMsg('Esse número não parece completo — pode digitar de novo, com DDD? Ex: (27) 99999-9999');
          return pedirTelefone();
        }
        salvar({ nome: lead.nome, tel: tel });
        if (lead._jaECliente) buscarCliente(tel); else passoServico();
      });
    }
    pedirTelefone();
  }
  function buscarCliente(tel){
    botMsg('Só um instante, deixa eu conferir seu cadastro...');
    fetch(API_BASE + '/api/lead?acao=lead_busca&slug=' + encodeURIComponent(SLUG) + '&tel=' + encodeURIComponent(tel))
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (data.encontrado) {
          botMsg('Que bom te ver por aqui de novo, ' + lead.nome.split(' ')[0] + '! 🖤');
          if (!lead.artista && data.artista) {
            lead.artista = data.artista;
            // Mesma recalibração: artista já veio do cadastro do cliente
            // recorrente, então passoArtista() vai pular direto pra confirmação.
            if (ARTISTAS.length > 1) ETAPA_TOTAL--;
          }
          if (!lead.idea && data.descricao) lead.idea = data.descricao;
          if (!lead.regiao && data.regiao) lead.regiao = data.regiao;
          if (!lead.email && data.email) lead.email = data.email;
          lead._temCampanha = !!data.temCampanha;
          // Mesma lógica de recalibração: se o cliente recorrente já está
          // vinculado a uma campanha, a etapa de palavra secreta será
          // pulada -- corrige o total pra não parar em ~93% no fim.
          if (lead._temCampanha && CAMPANHAS_ATIVAS.length) ETAPA_TOTAL--;
        } else {
          botMsg('Não encontrei seu cadastro por aqui ainda — vamos preencher rapidinho!');
        }
        passoServico();
      })
      .catch(function(){ passoServico(); });
  }
  // Qual serviço o lead procura -- vem da lista que o estúdio configurou em
  // Configurações > Serviços. Sem servico cadastrado, pula (compatibilidade
  // com estúdios que ainda não usaram essa lista).
  function passoServico(){
    if (lead.servico) { salvar({ servico: lead.servico }); return passoIdeia(); }
    if (!SERVICOS.length) return passoIdeia();
    avancarEtapa();
    botMsg('Qual serviço você procura?');
    mostrarBotoes(SERVICOS.map(function(s){ return s.nome; }), function(op){
      lead.servico = op;
      salvar({ servico: op });
      passoIdeia();
    });
  }
  // Só oferece profissionais que atendem o serviço escolhido. Profissional
  // sem nenhum serviço marcado = atende todos (compatibilidade com cadastros
  // antigos). Se o filtro zerar a lista por engano, mostra todo mundo em vez
  // de travar o fluxo sem nenhuma opção.
  function passoArtista(){
    if (lead.artista) { salvar({ artista: lead.artista }); return passoConfirmacao(); }
    var candidatos = ARTISTAS;
    if (lead.servico) {
      var filtrados = ARTISTAS.filter(function(a){ return !a.servicos.length || a.servicos.indexOf(lead.servico) !== -1; });
      if (filtrados.length) candidatos = filtrados;
    }
    if (candidatos.length <= 1) {
      var unico = candidatos[0];
      if (unico) lead.artistaNome = unico.nome;
      salvar({ artista: (unico && unico.id) || '' });
      return passoConfirmacao();
    }
    avancarEtapa();
    botMsg('Vendo os trabalhos dos profissionais, com qual você se identificou mais?');
    var area = $('aura-input-area');
    area.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'aura-btns';
    candidatos.forEach(function(a, i){
      var b = document.createElement('button');
      b.className = 'aura-btn';
      b.textContent = '(' + (i + 1) + ') ' + a.nome;
      b.onclick = function(){ userMsg(a.nome); area.innerHTML = ''; lead.artistaNome = a.nome; salvar({ artista: a.id }); passoConfirmacao(); };
      wrap.appendChild(b);
    });
    area.appendChild(wrap);
  }
  function passoIdeia(){
    // Recalibra o total agora que o serviço já está resolvido -- corrige o
    // caso em que o serviço escolhido filtra os candidatos a artista pra 1
    // só, hipótese que o cálculo inicial (na abertura, sem saber o serviço)
    // não podia prever. Só ajusta pra baixo -- nunca aumenta o total.
    if (lead.servico && ARTISTAS.length > 1) {
      var candidatosReais = ARTISTAS.filter(function(a){ return !a.servicos.length || a.servicos.indexOf(lead.servico) !== -1; });
      var totalCandidatos = candidatosReais.length ? candidatosReais.length : ARTISTAS.length;
      if (totalCandidatos <= 1) ETAPA_TOTAL--;
    }
    avancarEtapa();
    if (lead.idea) { salvar({ idea: lead.idea }); return passoReferencia(); }
    var pergunta = lead.servico === 'Piercing'
      ? 'Me conta um pouco sobre o piercing que você tem em mente:'
      : 'Me conta um pouco sobre a ideia que você tem em mente:';
    botMsg(pergunta);
    mostrarInput('Sua ideia...', function(idea){ salvar({ idea: idea }); passoReferencia(); });
  }
  // Comprime e sobe uma imagem pro cliente já criado nessa conversa, sem
  // exigir login (mesmo endpoint público já usado no site da Casa dos Carvalho).
  function comprimirEEnviar(file, cb){
    var reader = new FileReader();
    reader.onload = function(ev){
      var img = new Image();
      img.onload = function(){
        var w = img.width, h = img.height, maxPx = 900;
        if (w > maxPx || h > maxPx) { if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; } else { w = Math.round(w * maxPx / h); h = maxPx; } }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var base64 = canvas.toDataURL('image/jpeg', 0.75).split(',')[1];
        fetch(API_BASE + '/api/upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: base64, mimeType: 'image/jpeg', clienteId: lead._clienteId })
        }).then(function(r){ return r.json(); }).then(function(d){ cb(!!(d && d.url)); }).catch(function(){ cb(false); });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
  // Botão explícito (em vez de abrir o seletor sozinho) -- deixa claro que é
  // uma ação da pessoa, e permite escolher várias fotos de uma vez (câmera
  // ou galeria, o próprio celular decide) em vez de uma por vez.
  function botaoEnviarImagem(onDone){
    var area = $('aura-input-area');
    area.innerHTML = '';
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.style.display = 'none';
    inp.onchange = function(){
      var files = Array.prototype.slice.call(inp.files || []);
      if (!files.length) return;
      var restante = Math.max(0, 5 - refEnviadas);
      if (files.length > restante) files = files.slice(0, restante);
      area.innerHTML = '';
      history.push({ role: 'user', content: files.length > 1 ? ('[O cliente enviou ' + files.length + ' imagens de referência]') : '[O cliente enviou uma imagem de referência]' });
      botMsg(files.length > 1 ? ('Enviando ' + files.length + ' imagens...') : 'Enviando imagem...');
      var todasOk = true;
      (function enviarUma(i){
        if (i >= files.length) return onDone(todasOk, files.length);
        comprimirEEnviar(files[i], function(ok){ if (!ok) todasOk = false; enviarUma(i + 1); });
      })(0);
    };
    var btn = document.createElement('button');
    btn.className = 'aura-btn';
    btn.innerHTML = '📷 Escolher imagens';
    btn.onclick = function(){ inp.click(); };
    area.appendChild(btn);
    area.appendChild(inp);
  }
  function passoReferencia(){
    avancarEtapa();
    var pergunta = lead.servico === 'Piercing'
      ? 'Você tem uma imagem que possa me mandar do piercing que você quer aplicar?'
      : 'Você tem uma imagem de referência?';
    botMsg(pergunta);
    mostrarBotoes(['Sim', 'Não'], function(op){
      if (op === 'Não') return passoRegiao();
      botaoEnviarImagem(function(sucesso, qtd){
        if (!sucesso) { botMsg('Não consegui enviar uma ou mais imagens — mas sem problema, seguimos!'); return passoRegiao(); }
        refEnviadas = Math.min(5, refEnviadas + (qtd || 1));
        passoMaisReferencias();
      });
    });
  }
  function passoMaisReferencias(){
    var quebra = String.fromCharCode(10);
    if (refEnviadas >= 5) {
      botMsg('✔ Referência recebida.' + quebra + refEnviadas + ' de 5 imagens enviadas.' + quebra + 'Chegamos ao limite — vamos continuar!');
      return passoRegiao();
    }
    botMsg('✔ Referência recebida.' + quebra + refEnviadas + ' de 5 imagens enviadas.' + quebra + 'Deseja enviar outra?');
    mostrarBotoes(['Sim', 'Não'], function(op){
      if (op === 'Não') return passoRegiao();
      botaoEnviarImagem(function(sucesso, qtd){
        if (!sucesso) { botMsg('Não consegui enviar uma ou mais imagens — mas sem problema, seguimos!'); return passoRegiao(); }
        refEnviadas = Math.min(5, refEnviadas + (qtd || 1));
        passoMaisReferencias();
      });
    });
  }
  function passoRegiao(){
    avancarEtapa();
    if (lead.servico === 'Consulta') return passoFaixaInvestimento();
    if (lead.regiao) { salvar({ regiao: lead.regiao }); return passoFaixaInvestimento(); }
    botMsg('Em qual região do corpo?');
    mostrarInput('Ex: braço, costas...', function(regiao){ salvar({ regiao: regiao }); passoFaixaInvestimento(); });
  }
  var FAIXAS_INVESTIMENTO = ['Até R$500', 'R$500 a R$1.500', 'R$1.500 a R$3.000', 'Acima de R$3.000', 'Ainda não sei'];
  function passoFaixaInvestimento(){
    avancarEtapa();
    botMsg('Você já tem uma faixa de investimento em mente para este projeto?');
    mostrarBotoes(FAIXAS_INVESTIMENTO, function(faixa){ salvar({ faixaInvestimento: faixa }); passoClassificacao(); });
  }
  // Consulta já É o pedido de conversa -- escolher esse serviço já responde
  // a pergunta sozinho, então pula direto pra classificação certa.
  function passoClassificacao(){
    avancarEtapa();
    if (lead.servico === 'Consulta') {
      salvar({ etapa: 'lead_morno' });
      return passoPeriodo();
    }
    var pergunta = lead.servico === 'Piercing'
      ? 'Você já decidiu e quer agendar a aplicação, ou prefere conversar com o profissional antes?'
      : 'Você já decidiu e quer agendar, ou prefere conversar antes?';
    botMsg(pergunta);
    mostrarBotoes(['🎯 Já decidi, quero agendar', '💬 Quero conversar antes'], function(op){
      var etapa = op.indexOf('conversar') !== -1 ? 'lead_morno' : 'aura_agend';
      salvar({ etapa: etapa });
      passoPeriodo();
    });
  }
  function passoPeriodo(){
    avancarEtapa();
    botMsg('Você prefere receber uma ligação em qual período do dia?');
    mostrarBotoes(['Manhã', 'Tarde', 'Noite'], function(op){
      lead.periodo_ligacao = op;
      salvar({ periodo_ligacao: op });
      passoEmail();
    });
  }
  function passoEmail(){
    avancarEtapa();
    if (lead.email) { salvar({ email: lead.email }); return passoPalavraSecreta(); }
    botMsg('Por último, qual o seu melhor e-mail?');
    mostrarInput('seu@email.com', function(email){ salvar({ email: email }); passoPalavraSecreta(); });
  }
  function passoPalavraSecreta(){
    if (!CAMPANHAS_ATIVAS.length || lead._temCampanha) return passoArtista();
    avancarEtapa();
    botMsg('Antes de fechar por aqui — você tem uma palavra secreta? 🔑');
    mostrarBotoes(['Sim', 'Não'], function(op){
      if (op === 'Sim') {
        botMsg('Qual é a palavra secreta?');
        pedirPalavraSecreta();
        return;
      }
      var comLink = CAMPANHAS_ATIVAS.filter(function(c){ return c.link; })[0];
      if (comLink) {
        botMsg('Ainda não viu? Dá uma olhada aqui 👉 ' + comLink.link + '. Se descobrir, é só escrever aqui embaixo!');
        pedirPalavraSecreta();
      } else {
        passoArtista();
      }
    });
  }
  function pedirPalavraSecreta(){
    mostrarInput('Digite aqui...', function(palavra){
      botMsg('Só um instante...');
      salvar({ palavra_secreta: palavra })
        .then(function(r){ return r && r.json ? r.json() : null; })
        .then(function(data){
          if (data && data.campanha) {
            var dataFmt = new Date(data.campanha.validade + 'T12:00:00').toLocaleDateString('pt-BR');
            var valorTxt = data.campanha.tipo === 'percentual'
              ? (data.campanha.valor + '% de desconto')
              : ('R$ ' + Number(data.campanha.valor).toFixed(2).replace('.', ',') + ' de crédito');
            botMsg('Prontinho! Você está cadastrado(a) na campanha ' + data.campanha.nome + ' e garantiu ' + valorTxt + '. 🖤 Você tem até ' + dataFmt + ' para aproveitar — é só marcar sua sessão dentro desse prazo.');
          } else {
            botMsg('Não encontrei essa por aqui, mas tudo bem — vamos continuar!');
          }
          passoArtista();
        })
        .catch(function(){ passoArtista(); });
    });
  }
  // Revisão final -- mostra um resumo do que foi coletado antes de encerrar,
  // pra pessoa confirmar ou corrigir algum campo. Evita cadastro com dado
  // errado (ex: telefone digitado errado) chegando sem chance de conserto.
  function passoConfirmacao(){
    avancarEtapa();
    var quebra = String.fromCharCode(10);
    var ideiaFinal = lead.idea || lead.ideia || '';
    var linhas = [
      'Só confirmando antes de finalizar:',
      '📋 Nome: ' + (lead.nome || '—'),
      '📱 WhatsApp: ' + (lead.tel || '—'),
      '✉️ E-mail: ' + (lead.email || '—')
    ];
    if (lead.servico) linhas.push('🛠️ Serviço: ' + lead.servico);
    linhas.push('🎨 Projeto: ' + (ideiaFinal || '—') + (lead.regiao ? ' — ' + lead.regiao : ''));
    if (lead.periodo_ligacao) linhas.push('🕐 Período preferido pra ligação: ' + lead.periodo_ligacao);
    linhas.push('');
    linhas.push('Está tudo certo?');
    botMsg(linhas.join(quebra));
    mostrarBotoes(['✅ Sim, está certo', '✏️ Preciso corrigir algo'], function(op){
      if (op.indexOf('certo') === -1) return passoEscolherCorrecao();
      // Confere de verdade se o cadastro foi salvo antes de comemorar --
      // salvar() engolia erro de rede/servidor silenciosamente, e a
      // conversa terminava com "Pronto!" mesmo sem nada ter sido salvo.
      botMsg('Só um instante...');
      salvar({ finalizado: true }).then(function(r){ return r.json(); }).then(function(data){
        if (data && data.ok) return passoFinal();
        passoErroSalvar();
      });
    });
  }
  function passoErroSalvar(){
    var area = $('aura-input-area');
    botMsg('Hmm, tivemos um problema técnico agora e não consegui confirmar se seus dados foram salvos. Pode tentar de novo, ou já chamar a gente direto no WhatsApp pra não perder seu lugar:');
    area.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'aura-btns';
    var btnTentar = document.createElement('button');
    btnTentar.className = 'aura-btn';
    btnTentar.textContent = '🔁 Tentar de novo';
    btnTentar.onclick = function(){ area.innerHTML = ''; passoConfirmacao(); };
    wrap.appendChild(btnTentar);
    area.appendChild(wrap);
    var a = document.createElement('a');
    a.href = WA_LINK !== '#' ? WA_LINK + '?text=' + encodeURIComponent(montarTextoWhatsApp()) : WA_LINK;
    a.target = '_blank'; a.className = 'aura-wa-btn';
    a.innerHTML = waBtnHtml() + 'Falar agora no WhatsApp';
    area.appendChild(a);
  }
  function passoEscolherCorrecao(){
    botMsg('Qual item você quer corrigir?');
    var opcoes = ['Nome', 'Telefone', 'E-mail'].concat(SERVICOS.length ? ['Serviço'] : []).concat(['Projeto', 'Período da ligação']);
    mostrarBotoes(opcoes, function(item){
      if (item === 'Nome') {
        botMsg('Qual é o nome completo certo?');
        mostrarInput('Seu nome completo', function(v){ lead.nome = v; salvar({ nome: v }); passoConfirmacao(); });
      } else if (item === 'Telefone') {
        botMsg('Qual é o número de WhatsApp certo?');
        mostrarInput('(99) 99999-9999', function(v){
          if (v.replace(/[^0-9]/g, '').length < 10) {
            botMsg('Esse número não parece completo — com DDD, só números.');
            return passoEscolherCorrecao();
          }
          lead.tel = v; salvar({ tel: v }); passoConfirmacao();
        });
      } else if (item === 'E-mail') {
        botMsg('Qual é o e-mail certo?');
        mostrarInput('seu@email.com', function(v){ lead.email = v; salvar({ email: v }); passoConfirmacao(); });
      } else if (item === 'Serviço') {
        botMsg('Qual é o serviço certo?');
        mostrarBotoes(SERVICOS.map(function(s){ return s.nome; }), function(v){ lead.servico = v; salvar({ servico: v }); passoConfirmacao(); });
      } else if (item === 'Período da ligação') {
        botMsg('Prefere receber a ligação em qual período?');
        mostrarBotoes(['Manhã', 'Tarde', 'Noite'], function(v){ lead.periodo_ligacao = v; salvar({ periodo_ligacao: v }); passoConfirmacao(); });
      } else {
        botMsg('Me conta de novo a ideia:');
        mostrarInput('Sua ideia...', function(v){ lead.idea = v; salvar({ idea: v }); passoConfirmacao(); });
      }
    });
  }
  function montarTextoWhatsApp(){
    var ideiaFinal = lead.idea || lead.ideia || '';
    var partes = ['Olá! Sou ' + (lead.nome || '')];
    if (lead.servico) partes.push('procurando ' + lead.servico.toLowerCase());
    if (ideiaFinal) partes.push('conversei com a Aura sobre ' + ideiaFinal);
    if (lead.regiao) partes.push('na região: ' + lead.regiao);
    if (lead.artistaNome) partes.push('Profissional de interesse: ' + lead.artistaNome);
    if (lead.email) partes.push('Meu e-mail: ' + lead.email);
    return partes.join('. ') + '.';
  }
  function passoFinal(){
    botMsg('Pronto! Já registramos os dados principais — nossa equipe vai entrar em contato com você em breve. Se quiser adiantar, pode chamar no WhatsApp do estúdio! 🖤');
    var area = $('aura-input-area');
    area.innerHTML = '';
    var a = document.createElement('a');
    a.href = WA_LINK !== '#' ? WA_LINK + '?text=' + encodeURIComponent(montarTextoWhatsApp()) : WA_LINK;
    a.target = '_blank'; a.className = 'aura-wa-btn';
    a.innerHTML = waBtnHtml() + 'Falar agora no WhatsApp';
    area.appendChild(a);
  }

  window.AuraChat = { abrir: abrir, fechar: fechar };
})();
</script>
</body>
</html>`;
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
