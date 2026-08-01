# ink-system-implementacoes

Terceiro pilar do ecossistema Ink System — hospeda toda funcionalidade cujo
custo operacional é pago pelo **cliente** (o tatuador), não pelo Ink System:
Meu Site (renderização e infraestrutura), landing pages, SEO, domínios de
tenant, e integrações contratadas diretamente pelo cliente (ManyChat,
OpenAI/Anthropic própria, Evolution API, N8N).

Os outros três pilares:

- **inq-saas** (`ink-system-crm`, planejado) — CRM, operação diária do estúdio.
- **ink-system-plataform** (`ink-system-plataforma`, planejado) — infraestrutura
  cujo custo é do Ink System: provisionamento, licenciamento, distribuição.
- **calma-studio** — produto totalmente independente.

Mesmo Supabase compartilhado pelos quatro. Especificação Arquitetural completa
mantida à parte (documento vivo do ecossistema) -- este README não a
substitui, só orienta quem abre o repositório pela primeira vez.

## Estado atual

Fundação (Bloco 4.7) + renderizador do "Meu Site" (Bloco 4.8), migrado de
`inq-saas`: `lib/site-publico/` e as rotas `/api/meu-site` e
`/api/meu-site/preview` — ainda sem tráfego real apontado pra cá (religação
é o Bloco 4.9). Conexão com o Supabase, autenticação e a rota `/api/health`
seguem da fundação.

Deploy: conectado ao GitHub (Bloco 4.9A) — todo push em `main` gera deploy
automático de produção na Vercel. Não usar `vercel --prod` manualmente.
