import { NextRequest, NextResponse } from "next/server";
import { renderizarSite } from "@/lib/site-publico/dados";

// Site público do tenant (molde Premium) — Bloco 4.8.
// Equivalente a inq-saas/api/lead.js?acao=site (linhas 1088-1107).
// Ainda sem tráfego real apontado pra cá: o rewrite em
// ink-system-plataform/next.config.ts continua intacto, apontando pro
// inq-saas — religar tráfego é trabalho do Bloco 4.9, não deste.
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug") || "";
  const userAgent = req.headers.get("user-agent") || "";
  const { status, contentType, body } = await renderizarSite({ slug, userAgent });
  return new NextResponse(body, { status, headers: { "Content-Type": `${contentType}; charset=utf-8` } });
}
