-- INTEGRAÇÃO META WHATSAPP — FASE 1: infraestrutura de banco.
--
-- ⚠️ ESTE ARQUIVO AINDA NÃO FOI EXECUTADO. Fica LOCAL até autorização
-- explícita de rodar no Supabase (mesma disciplina de todo o projeto).
--
-- ⚠️ ESCOPO ESTRITO: só banco, aditivo. Nenhum frontend, backend, webhook
-- ou chamada à Meta é criado ou alterado nesta rodada. Nenhuma linha real
-- é gravada por esta migration.
--
-- O QUE FAZ
--   1. public.integracoes_credenciais.provedor passa a aceitar também
--      'meta_whatsapp' (o token da Meta ficará no cofre, cifrado, como
--      Anthropic e Zenvia -- nunca na tabela nova).
--   2. Cria public.integracoes_whatsapp: SÓ identificadores e estado da
--      conexão, uma linha por conta (user_id). Nenhum token, nenhum
--      segredo, nenhum conteúdo de mensagem, nenhum payload de webhook.
--   3. RLS ativo, sem nenhuma policy; anon/authenticated sem privilégio
--      algum; só service_role (backend do ink-system-implementacoes) lê e
--      escreve -- mesmo modelo de integracoes_credenciais.
--
-- DECISÕES DE MODELAGEM (para revisão)
--   - waba_id e phone_number_id são UNIQUE e NULLABLE. Unicidade impede que
--     um mesmo número/WABA fique ligado a duas contas ao mesmo tempo (o
--     webhook da Meta é uma URL única por app e é roteado por esses IDs --
--     ambiguidade aqui = evento entregue à conta errada). NULL é permitido
--     para que uma conexão desconectada possa liberar os IDs sem apagar o
--     registro; em Postgres, vários NULL não conflitam em UNIQUE.
--   - status = 'conectado' EXIGE waba_id, phone_number_id e conectado_em
--     preenchidos (constraint integracoes_whatsapp_conectado_completo).
--   - IDs da Meta são strings numéricas: validadas por formato (só dígitos,
--     até 32) para barrar lixo vindo do navegador na origem.
--   - ultimo_erro é limitado a 500 caracteres e destina-se só a código/
--     descrição técnica de falha -- NUNCA texto de mensagem nem payload.
--   - atualizado_em é mantido por trigger próprio desta tabela (função
--     dedicada, sem depender de funções de outras migrations).
--   - user_id -> auth.users ON DELETE CASCADE, igual ao cofre: conta
--     removida leva junto seus metadados de integração.
--
-- ROLLBACK (não executado aqui, só documentado -- rodar como bloco único,
-- somente mediante decisão explícita de abandonar a Fase 1):
--   begin;
--   do $rb$ begin
--     if exists (select 1 from public.integracoes_credenciais where provedor = 'meta_whatsapp') then
--       raise exception 'Rollback abortado: existem credenciais meta_whatsapp no cofre. Desconectar/remover antes.';
--     end if;
--   end $rb$;
--   drop table if exists public.integracoes_whatsapp;              -- leva junto o trigger trg_integracoes_whatsapp_atualizado_em
--   drop function if exists public.integracoes_whatsapp_tocar_atualizado_em();  -- só depois da tabela (trigger dependente)
--   alter table public.integracoes_credenciais drop constraint integracoes_credenciais_provedor_check;
--   alter table public.integracoes_credenciais add constraint integracoes_credenciais_provedor_check
--     check (provedor in ('anthropic', 'zenvia'));
--   commit;
-- Seguro enquanto nenhum código gravar nestas estruturas: nenhum fluxo em
-- produção lê integracoes_whatsapp nem usa provedor 'meta_whatsapp' ainda.
--
-- TRANSAÇÃO INTEGRAL — PARTE 0 a PARTE 5 rodam dentro de uma única
-- transação explícita. Qualquer RAISE EXCEPTION em qualquer precheck
-- aborta TUDO, sem deixar objetos pela metade. PARTE 6 (postchecks) é só
-- leitura e roda fora da transação, quantas vezes quiser.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 0 — PRECHECKS (fail-closed)
-- ═══════════════════════════════════════════════════════════════════════════

-- 0.1 — objetos novos não podem existir. Nome coincidente não prova que é
-- desta migration: se existir, abortar e auditar manualmente.
do $precheck_objetos_novos$
begin
  if to_regclass('public.integracoes_whatsapp') is not null then
    raise exception 'Abortando: public.integracoes_whatsapp já existe. Auditar manualmente antes de prosseguir.';
  end if;
  if to_regprocedure('public.integracoes_whatsapp_tocar_atualizado_em()') is not null then
    raise exception 'Abortando: função public.integracoes_whatsapp_tocar_atualizado_em() já existe. Auditar manualmente.';
  end if;
  raise notice 'PRECHECK 0.1 ok: nenhum objeto novo pré-existente.';
end $precheck_objetos_novos$;

-- 0.2 — dependências existem: cofre e auth.users.
do $precheck_dependencias$
begin
  if to_regclass('public.integracoes_credenciais') is null then
    raise exception 'Abortando: public.integracoes_credenciais não existe (cofre ausente).';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Abortando: auth.users não existe.';
  end if;
  raise notice 'PRECHECK 0.2 ok: cofre e auth.users presentes.';
end $precheck_dependencias$;

-- 0.3 — o cofre tem RLS ativo (premissa de segurança herdada pela Fase 1).
do $precheck_rls_cofre$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.integracoes_credenciais'::regclass) then
    raise exception 'Abortando: RLS está DESLIGADO em public.integracoes_credenciais -- corrigir o cofre antes de ampliar provedores.';
  end if;
  raise notice 'PRECHECK 0.3 ok: RLS ativo no cofre.';
end $precheck_rls_cofre$;

-- 0.4 — nenhum valor de provedor fora do conjunto novo (não deveria existir,
-- a constraint atual já impede; confirmado contra o dado real).
do $precheck_valores_provedor$
declare
  v_fora text;
begin
  select string_agg(distinct provedor, ', ') into v_fora
  from public.integracoes_credenciais
  where provedor not in ('anthropic', 'zenvia', 'meta_whatsapp');
  if v_fora is not null then
    raise exception 'Abortando: provedores inesperados no cofre: %.', v_fora;
  end if;
  raise notice 'PRECHECK 0.4 ok: todos os provedores atuais cabem na nova constraint.';
end $precheck_valores_provedor$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 1 — CONSTRAINT DE PROVEDOR NO COFRE
-- ═══════════════════════════════════════════════════════════════════════════
-- A constraint original foi criada inline, sem nome explícito
-- (scripts/2026-08-20_integracoes_credenciais.sql:3). Em vez de presumir o
-- nome gerado pelo Postgres, localiza pelo catálogo e EXIGE exatamente uma
-- constraint CHECK sobre provedor, com a definição exata conhecida. Qualquer
-- divergência aborta (o banco não está no estado que esta migration assume).
do $parte1_trocar_constraint$
declare
  v_qtd        int;
  v_nome       text;
  v_definicao  text;
  v_esperada   constant text := 'CHECK ((provedor = ANY (ARRAY[''anthropic''::text, ''zenvia''::text])))';
begin
  select count(*) into v_qtd
  from pg_constraint
  where conrelid = 'public.integracoes_credenciais'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%provedor%';

  if v_qtd <> 1 then
    raise exception 'Abortando: esperava exatamente 1 CHECK sobre provedor em integracoes_credenciais, encontrei %.', v_qtd;
  end if;

  select conname, pg_get_constraintdef(oid) into v_nome, v_definicao
  from pg_constraint
  where conrelid = 'public.integracoes_credenciais'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%provedor%';

  if v_definicao <> v_esperada then
    raise exception 'Abortando: CHECK de provedor (%) com definição inesperada: % -- esperado: %', v_nome, v_definicao, v_esperada;
  end if;

  execute format('alter table public.integracoes_credenciais drop constraint %I', v_nome);
  raise notice 'PARTE 1: constraint antiga % removida (definição conferida).', v_nome;
end $parte1_trocar_constraint$;

alter table public.integracoes_credenciais
  add constraint integracoes_credenciais_provedor_check
  check (provedor in ('anthropic', 'zenvia', 'meta_whatsapp'));

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 2 — TABELA public.integracoes_whatsapp
-- ═══════════════════════════════════════════════════════════════════════════

create table public.integracoes_whatsapp (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  waba_id               text,
  phone_number_id       text,
  business_id           text,
  display_phone_number  text,
  status                text not null default 'conectando',
  webhook_inscrito_em   timestamptz,
  conectado_em          timestamptz,
  ultimo_erro           text,
  token_expira_em       timestamptz,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),

  constraint integracoes_whatsapp_waba_id_unique         unique (waba_id),
  constraint integracoes_whatsapp_phone_number_id_unique unique (phone_number_id),

  constraint integracoes_whatsapp_status_check
    check (status in ('conectando', 'conectado', 'erro', 'desconectado')),
  constraint integracoes_whatsapp_conectado_completo
    check (status <> 'conectado' or (waba_id is not null and phone_number_id is not null and conectado_em is not null)),

  constraint integracoes_whatsapp_waba_id_formato
    check (waba_id is null or waba_id ~ '^[0-9]{1,32}$'),
  constraint integracoes_whatsapp_phone_number_id_formato
    check (phone_number_id is null or phone_number_id ~ '^[0-9]{1,32}$'),
  constraint integracoes_whatsapp_business_id_formato
    check (business_id is null or business_id ~ '^[0-9]{1,32}$'),
  constraint integracoes_whatsapp_display_phone_tamanho
    check (display_phone_number is null or char_length(display_phone_number) <= 32),
  constraint integracoes_whatsapp_ultimo_erro_tamanho
    check (ultimo_erro is null or char_length(ultimo_erro) <= 500)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 3 — atualizado_em automático (função dedicada desta tabela)
-- ═══════════════════════════════════════════════════════════════════════════

create function public.integracoes_whatsapp_tocar_atualizado_em()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  new.atualizado_em := now();
  return new;
end;
$fn$;

revoke all on function public.integracoes_whatsapp_tocar_atualizado_em() from public, anon, authenticated;

create trigger trg_integracoes_whatsapp_atualizado_em
  before update on public.integracoes_whatsapp
  for each row execute function public.integracoes_whatsapp_tocar_atualizado_em();

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 4 — RLS E PRIVILÉGIOS (somente backend / service_role)
-- ═══════════════════════════════════════════════════════════════════════════
-- RLS ligado e NENHUMA policy: anon/authenticated não enxergam nenhuma
-- linha mesmo que algum grant apareça no futuro. O revoke explícito é
-- necessário porque os default privileges do Supabase concedem acesso a
-- anon/authenticated em tabelas novas do schema public. service_role
-- ignora RLS por natureza e recebe só o necessário.

alter table public.integracoes_whatsapp enable row level security;

revoke all on public.integracoes_whatsapp from public, anon, authenticated;
grant select, insert, update, delete on public.integracoes_whatsapp to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 5 — DOCUMENTAÇÃO NO CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════════

comment on table public.integracoes_whatsapp is
  'Metadados da conexão WhatsApp Business (Meta Embedded Signup), uma linha '
  'por conta. SÓ identificadores e estado -- nunca token (fica cifrado em '
  'integracoes_credenciais, provedor meta_whatsapp), nunca conteúdo de '
  'mensagem, nunca payload de webhook. Acesso exclusivo do backend '
  '(service_role) do ink-system-implementacoes; RLS sem policies.';
comment on column public.integracoes_whatsapp.waba_id is
  'WhatsApp Business Account ID (numérico). UNIQUE: roteia o webhook único do app para a conta certa.';
comment on column public.integracoes_whatsapp.phone_number_id is
  'Phone Number ID da Cloud API (numérico). UNIQUE pelo mesmo motivo do waba_id.';
comment on column public.integracoes_whatsapp.ultimo_erro is
  'Só código/descrição técnica da última falha (até 500 caracteres). Nunca texto de mensagem nem payload.';
comment on column public.integracoes_whatsapp.token_expira_em is
  'Expiração informada pela Meta para o token guardado no cofre; NULL quando não expira ou não informada.';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 6 — POSTCHECKS (somente leitura; rodar depois do commit)
-- ═══════════════════════════════════════════════════════════════════════════

-- 6.1 — constraint nova do cofre (esperado: 1 linha, com os 3 provedores)
select conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.integracoes_credenciais'::regclass
  and contype = 'c';

-- 6.2 — colunas da tabela nova (esperado: 12 colunas, na ordem do CREATE)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'integracoes_whatsapp'
order by ordinal_position;

-- 6.3 — constraints da tabela nova (esperado: PK, FK, 2 UNIQUE, 7 CHECK;
-- em Postgres 18+ aparecem também linhas contype 'n' para os NOT NULL)
select conname, contype, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.integracoes_whatsapp'::regclass
order by contype, conname;

-- 6.4 — RLS ligado e zero policies (esperado: rls_ativo = true, policies = 0)
select
  (select relrowsecurity from pg_class where oid = 'public.integracoes_whatsapp'::regclass) as rls_ativo,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'integracoes_whatsapp') as policies;

-- 6.5 — privilégios (esperado: o dono da tabela -- normalmente postgres -- e
-- service_role com SELECT/INSERT/UPDATE/DELETE; NENHUMA linha para anon,
-- authenticated ou PUBLIC)
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'integracoes_whatsapp'
group by grantee
order by grantee;

-- 6.6 — trigger presente (esperado: 1 linha, BEFORE UPDATE)
select tgname, pg_get_triggerdef(oid) as definicao
from pg_trigger
where tgrelid = 'public.integracoes_whatsapp'::regclass and not tgisinternal;

-- 6.7 — cofre intacto (esperado: mesmas contagens de antes, ex.: anthropic | 1)
select provedor, count(*) from public.integracoes_credenciais group by provedor order by provedor;
