-- ETAPA 2: execute somente depois de confirmar que Anthropic e Zenvia foram
-- recadastradas e aparecem como conectadas na aba Implementações.
alter table public.configuracoes drop column if exists resend_api_key;
alter table public.configuracoes drop column if exists aura_api_key;
alter table public.configuracoes drop column if exists zenvia_api_key;
alter table public.configuracoes drop column if exists zenvia_numero;
