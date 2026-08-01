import { NextRequest, NextResponse } from "next/server";
import { renderizarPreview } from "@/lib/site-publico/dados";

// Prévia ao vivo (aba "Meu Site" do CRM) — Bloco 4.8.
// Equivalente a inq-saas/api/lead.js?acao=preview (linhas 1174-1187).
// Sem autenticação: preserva o comportamento atual do inq-saas (a rota
// original também não exige token) — não é um endurecimento deste bloco.
// Dispatcher único por verbo, igual ao original, pra devolver o mesmo corpo
// JSON de erro em qualquer método que não seja POST.
async function handler(req: NextRequest) {
  const method = req.method;
  const corpo = method === "POST" ? await req.json().catch(() => ({})) : {};
  const { site, cfg, artistas, slug } = corpo || {};
  const { status, contentType, body } = await renderizarPreview({ method, site, cfg, artistas, slug });
  return new NextResponse(body, { status, headers: { "Content-Type": `${contentType}; charset=utf-8` } });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
