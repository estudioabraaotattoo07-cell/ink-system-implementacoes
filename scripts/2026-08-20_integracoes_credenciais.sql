create table if not exists public.integracoes_credenciais (
  user_id uuid not null references auth.users(id) on delete cascade,
  provedor text not null check (provedor in ('anthropic', 'zenvia')),
  credencial_cifrada text not null,
  status text not null default 'ativa',
  testado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provedor)
);
alter table public.integracoes_credenciais enable row level security;
revoke all on public.integracoes_credenciais from public, anon, authenticated;
grant select, insert, update, delete on public.integracoes_credenciais to service_role;
comment on table public.integracoes_credenciais is 'Credenciais BYOK cifradas; acesso exclusivo do ink-system-implementacoes.';

alter table public.configuracoes drop column if exists resend_api_key;
alter table public.configuracoes drop column if exists aura_api_key;
alter table public.configuracoes drop column if exists zenvia_api_key;
alter table public.configuracoes drop column if exists zenvia_numero;
