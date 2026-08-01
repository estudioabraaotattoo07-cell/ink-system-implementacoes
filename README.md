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

Fundação (Bloco 4.7) — sem nenhuma funcionalidade de negócio ainda. Só
conexão com o Supabase, autenticação e a rota `/api/health`.
