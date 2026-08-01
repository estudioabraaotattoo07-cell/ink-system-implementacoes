import type { NextConfig } from "next";

// Fundação (Bloco 4.7) — sem rewrites, sem exceção de type-check. Este
// projeto nunca proxeia para outro: quem chama é sempre o CRM ou a
// Plataforma, nunca o contrário (ver Especificação Arquitetural, §5).
const nextConfig: NextConfig = {};

export default nextConfig;
