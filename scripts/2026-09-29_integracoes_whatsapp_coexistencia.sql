-- INTEGRAÇÃO META WHATSAPP — COEXISTÊNCIA: modo de conexão da linha.
--
-- 🟠 ALTERAÇÃO CONTROLADA — APLICADA E HOMOLOGADA no Supabase em 29/09/2026
-- (prechecks e postchecks conferidos). Não reexecutar: o precheck aborta se a
-- coluna já existir. Só executar (em outro ambiente) mediante autorização
-- explícita, no SQL Editor do Supabase, como bloco único.
--
-- ⚠️ ORDEM OBRIGATÓRIA: aplicar ESTA migration ANTES de publicar o código de
-- Coexistência. O backend passa a ler/gravar modo_conexao; sem a coluna, as
-- rotas /api/whatsapp/* falhariam (a leitura da linha erra).
--
-- O QUE FAZ
--   Acrescenta em public.integracoes_whatsapp UMA coluna:
--   modo_conexao text NOT NULL DEFAULT 'padrao'
--     'padrao'       -- Embedded Signup comum (waba_id + phone_number_id no
--                       retorno); a ativação pode pedir PIN e chamar /register.
--     'coexistencia' -- onboarding do app WhatsApp Business (só waba_id no
--                       retorno; o backend descobre o número). A ativação NUNCA
--                       chama /register nem exige PIN.
--   Todas as linhas já existentes recebem 'padrao' (correto: a Coexistência
--   não existia). O DEFAULT é só para essas linhas e para inserts que não
--   informam o modo; o backend grava o modo explicitamente em toda conexão.
--   Nenhuma outra estrutura é alterada (colunas, constraints, gatilho, RLS e
--   privilégios ficam como estão).
--
-- POLÍTICA DE DADOS: só um rótulo técnico do modo. Nenhum conteúdo de mensagem,
-- histórico ou dado do cliente final.
--
-- ROLLBACK (não executado aqui, só documentado -- somente mediante decisão
-- explícita e DEPOIS de voltar o código para a versão anterior à Coexistência):
--   1) Conferir que NÃO há linha em coexistência (senão, ao perder o rótulo, o
--      código antigo trataria o número como 'padrao' e poderia tentar /register):
--        select user_id, status from public.integracoes_whatsapp where modo_conexao = 'coexistencia';
--      Se houver, tratar antes (desconectar/apagar a linha e a credencial daquele
--      usuário) -- decisão separada.
--   2) begin;
--      alter table public.integracoes_whatsapp drop constraint if exists integracoes_whatsapp_modo_conexao_check;
--      alter table public.integracoes_whatsapp drop column if exists modo_conexao;
--      commit;
--
-- TRANSAÇÃO INTEGRAL — PARTE 0 a PARTE 2 dentro de BEGIN/COMMIT; qualquer
-- precheck que falhe aborta tudo. PARTE 3 (postchecks) é só leitura.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 0 — PRECHECKS (fail-closed)
-- ═══════════════════════════════════════════════════════════════════════════

do $precheck_coexistencia$
declare
  v_colunas integer;
begin
  if to_regclass('public.integracoes_whatsapp') is null then
    raise exception 'Abortando: public.integracoes_whatsapp não existe (Fase 1 não aplicada).';
  end if;
  -- Fase 3 aplicada (as duas colunas dela existem) e coluna nova ainda não.
  select count(*) into v_colunas
  from information_schema.columns
  where table_schema = 'public' and table_name = 'integracoes_whatsapp'
    and column_name in ('webhook_ultimo_evento_em', 'registro_ultima_falha_em');
  if v_colunas <> 2 then
    raise exception 'Abortando: Fase 3 não aplicada (esperava 2 colunas dela, achei %).', v_colunas;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'integracoes_whatsapp' and column_name = 'modo_conexao'
  ) then
    raise exception 'Abortando: coluna modo_conexao já existe. Auditar manualmente antes de prosseguir.';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.integracoes_whatsapp'::regclass and conname = 'integracoes_whatsapp_modo_conexao_check'
  ) then
    raise exception 'Abortando: constraint integracoes_whatsapp_modo_conexao_check já existe.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.integracoes_whatsapp'::regclass) then
    raise exception 'Abortando: RLS está DESLIGADO em public.integracoes_whatsapp -- corrigir antes.';
  end if;
  raise notice 'PRECHECK Coexistência ok.';
end $precheck_coexistencia$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 1 — COLUNA E CONSTRAINT
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.integracoes_whatsapp
  add column modo_conexao text not null default 'padrao';

alter table public.integracoes_whatsapp
  add constraint integracoes_whatsapp_modo_conexao_check
  check (modo_conexao in ('padrao', 'coexistencia'));

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 2 — DOCUMENTAÇÃO NO CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════════

comment on column public.integracoes_whatsapp.modo_conexao is
  'Modo da conexão: padrao (Embedded Signup comum; ativação pode pedir PIN e /register) ou coexistencia '
  '(número já ativo no app WhatsApp Business; a ativação nunca chama /register nem exige PIN).';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 3 — POSTCHECKS (somente leitura; rodar depois do commit)
-- ═══════════════════════════════════════════════════════════════════════════

-- 3.1 — coluna nova (esperado: 1 linha, text, NO, default 'padrao'::text)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'integracoes_whatsapp' and column_name = 'modo_conexao';

-- 3.2 — total de colunas (esperado: 15)
select count(*) as colunas
from information_schema.columns
where table_schema = 'public' and table_name = 'integracoes_whatsapp';

-- 3.3 — constraint (esperado: 1 linha, CHECK ((modo_conexao = ANY (ARRAY['padrao'::text, 'coexistencia'::text]))))
select conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.integracoes_whatsapp'::regclass and conname = 'integracoes_whatsapp_modo_conexao_check';

-- 3.4 — linhas existentes (esperado: todas 'padrao'; nenhuma 'coexistencia' ainda)
select modo_conexao, count(*) as linhas
from public.integracoes_whatsapp
group by modo_conexao
order by modo_conexao;

-- 3.5 — segurança inalterada (esperado: rls_ativo = true, policies = 0)
select
  (select relrowsecurity from pg_class where oid = 'public.integracoes_whatsapp'::regclass) as rls_ativo,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'integracoes_whatsapp') as policies;

-- 3.6 — privilégios inalterados (esperado: dono + service_role; nenhuma linha para anon, authenticated ou PUBLIC)
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'integracoes_whatsapp'
group by grantee
order by grantee;
