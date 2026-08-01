// Portado de inq-saas/api/lead.js (linhas 124-126) — Bloco 4.8.
// Origem oficial: inq-saas em produção. A cópia anterior deste arquivo em
// ink-system-plataform (Bloco 4.1) NÃO é usada como base — a auditoria desta
// rodada confirmou que ela diverge de propósito do inq-saas (CSS próprio,
// sem PAGE_LOGO). Aqui o comportamento é reconstruído 100% idêntico ao
// inq-saas atual, incluindo PAGE_STYLE e PAGE_LOGO (lead.js:14-29), que só
// esta página do site público usa dentro do escopo do Bloco 4.8 (as demais
// páginas que compartilham PAGE_STYLE — confirmação, avaliação NPS, resposta
// ao Google — são fluxos transacionais fora do escopo de "Meu Site").
const PAGE_STYLE = `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,serif;background:radial-gradient(ellipse 700px 420px at 50% -5%, rgba(139,92,222,0.3), transparent 65%), #0A0A0A;color:#E8E2D9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:radial-gradient(ellipse 320px 160px at 50% -10%, rgba(139,92,222,0.22), transparent 70%), linear-gradient(180deg, #1A1A1A, #0F0F0F);border:1.5px solid rgba(201,168,76,0.4);border-radius:20px;max-width:460px;width:100%;padding:40px 32px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,0.75), 0 0 34px rgba(201,168,76,0.16)}
.logo-img{width:min(220px,70%);height:auto;margin:0 auto 24px}
h1{font-size:20px;font-weight:normal;color:#E8E2D9;line-height:1.5;margin-bottom:12px}
.sub{font-size:14px;color:#A09585;line-height:1.7;margin-bottom:24px}
.icon{font-size:48px;margin-bottom:16px}
.caixa{background:#050505;border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:14px;font-size:13px;color:#C9BFB2;text-align:left;line-height:1.7;margin-bottom:12px;white-space:pre-wrap;box-shadow:inset 0 2px 6px rgba(0,0,0,0.5)}
textarea{width:100%;background:#050505;border:1px solid rgba(201,168,76,0.15);border-radius:8px;color:#E8E2D9;font-family:Georgia,serif;font-size:14px;padding:12px;resize:vertical;min-height:100px;margin-bottom:16px;box-shadow:inset 0 2px 6px rgba(0,0,0,0.5)}
button,button[type=submit],.btn-g{display:block;width:100%;background:linear-gradient(135deg,#E8C97A,#C9A84C 45%,#8a6a24);color:#17140A;border:1px solid rgba(255,224,160,0.6);border-radius:999px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:Georgia,serif;text-decoration:none;box-shadow:0 4px 16px rgba(201,168,76,0.3),inset 0 1px 0 rgba(255,255,255,0.35);margin-bottom:8px}
.btn-copy{background:rgba(255,255,255,0.03);color:var(--gold,#C9A84C);border:1px solid rgba(201,168,76,0.4);border-radius:999px;padding:10px 20px;font-size:13px;cursor:pointer;width:100%;font-family:Georgia,serif}
.nota-btn,.notas a{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:999px;text-decoration:none;font-size:15px;font-weight:bold;margin:4px;border:1px solid rgba(201,168,76,0.2)}
.baixa,.nota-baixa{background:#050505;color:#A09585}
.alta,.nota-alta{background:linear-gradient(135deg,#E8C97A,#C9A84C 45%,#8a6a24);color:#17140A;border-color:rgba(255,224,160,0.6)}
.footer{font-size:11px;color:#4a4235;margin-top:28px;letter-spacing:.05em;text-transform:uppercase}`;
const PAGE_LOGO = `<img class="logo-img" src="https://inq-saas.vercel.app/logo-ink-system.png" alt="INK SYSTEM">`;

export function paginaSiteIndisponivel() {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Site indisponível</title><style>${PAGE_STYLE}</style></head><body><div class="card">${PAGE_LOGO}<div class="icon">🖤</div><h1>Este site não está disponível no momento.</h1><div class="footer">Powered by INK SYSTEM</div></div></body></html>`;
}
