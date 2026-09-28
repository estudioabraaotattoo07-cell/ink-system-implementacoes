-- INTEGRAÇÃO META WHATSAPP — FASE 3: sinal de vida do webhook e relógio de
-- falha do registro do número.
--
-- ✅ APLICADA E HOMOLOGADA no Supabase em 28/09/2026. Não executar de novo:
-- o precheck aborta se as colunas já existirem.
--
-- ⚠️ ORDEM OBRIGATÓRIA: aplicar ESTA migration ANTES de publicar o código da
-- Fase 3. O backend passa a ler/gravar as duas colunas; sem elas, as rotas
-- /api/whatsapp/* falhariam.
--
-- O QUE FAZ
--   Acrescenta em public.integracoes_whatsapp:
--   1. webhook_ultimo_evento_em (timestamptz, NULL): instante do último
--      evento 'messages' recebido pelo webhook para a WABA desta conta. Só
--      prova que os eventos chegam à conta certa.
--   2. registro_ultima_falha_em (timestamptz, NULL): instante da última falha
--      de POST /{phone_number_id}/register. É o ÚNICO relógio da espera de 10
--      minutos entre tentativas de registro (a Meta permite 10 por 72 h).
--      atualizado_em NÃO serve para isso: o gatilho da Fase 1 o renova em
--      qualquer UPDATE (inscrição no webhook, sinal de vida etc.), o que
--      deslocaria a referência da espera. Zerado quando o registro dá certo
--      (promoção a 'conectado') e em toda reconexão nova (Fase 2).
--
-- POLÍTICA DE DADOS: nenhum conteúdo de mensagem, payload bruto, telefone ou
-- identificador do cliente final. Só dois instantes técnicos.
--
-- Efeito colateral conhecido e aceito: o gatilho da Fase 1
-- (trg_integracoes_whatsapp_atualizado_em) também renova atualizado_em quando
-- estas colunas mudam. O backend limita o sinal de vida a no máximo 1
-- gravação por minuto por WABA.
--
-- ROLLBACK (não executado aqui, só documentado -- rodar como bloco único,
-- somente mediante decisão explícita e DEPOIS de voltar o código para a
-- versão da Fase 2, que não conhece as colunas):
--   begin;
--   alter table public.integracoes_whatsapp drop column if exists registro_ultima_falha_em;
--   alter table public.integracoes_whatsapp drop column if exists webhook_ultimo_evento_em;
--   commit;
--
-- TRANSAÇÃO INTEGRAL — PARTE 0 a PARTE 2 dentro de BEGIN/COMMIT; qualquer
-- precheck que falhe aborta tudo. PARTE 3 (postchecks) é só leitura.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 0 — PRECHECKS (fail-closed)
-- ═══════════════════════════════════════════════════════════════════════════

do $precheck_fase3$
declare
  v_existentes text;
begin
  if to_regclass('public.integracoes_whatsapp') is null then
    raise exception 'Abortando: public.integracoes_whatsapp não existe (Fase 1 não aplicada).';
  end if;
  select string_agg(column_name, ', ' order by column_name) into v_existentes
  from information_schema.columns
  where table_schema = 'public' and table_name = 'integracoes_whatsapp'
    and column_name in ('webhook_ultimo_evento_em', 'registro_ultima_falha_em');
  if v_existentes is not null then
    raise exception 'Abortando: coluna(s) já existente(s): %. Auditar manualmente antes de prosseguir.', v_existentes;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.integracoes_whatsapp'::regclass) then
    raise exception 'Abortando: RLS está DESLIGADO em public.integracoes_whatsapp -- corrigir antes.';
  end if;
  raise notice 'PRECHECK Fase 3 ok.';
end $precheck_fase3$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 1 — COLUNAS
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.integracoes_whatsapp
  add column webhook_ultimo_evento_em timestamptz null,
  add column registro_ultima_falha_em timestamptz null;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 2 — DOCUMENTAÇÃO NO CATÁLOGO
-- ═══════════════════════════════════════════════════════════════════════════

comment on column public.integracoes_whatsapp.webhook_ultimo_evento_em is
  'Instante do último evento messages recebido pelo webhook para esta WABA (no máximo 1 gravação por minuto). '
  'Só sinal de vida -- nunca conteúdo, payload ou dado do cliente final.';
comment on column public.integracoes_whatsapp.registro_ultima_falha_em is
  'Instante da última falha de registro do número (POST /register). Único relógio da espera de 10 min entre '
  'tentativas; nunca derivado de atualizado_em. Zerado no registro bem-sucedido e em toda reconexão.';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 3 — POSTCHECKS (somente leitura; rodar depois do commit)
-- ═══════════════════════════════════════════════════════════════════════════

-- 3.1 — colunas novas (esperado: 2 linhas, timestamp with time zone, YES, sem default)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'integracoes_whatsapp'
  and column_name in ('webhook_ultimo_evento_em', 'registro_ultima_falha_em')
order by column_name;

-- 3.2 — total de colunas (esperado: 14)
select count(*) as colunas
from information_schema.columns
where table_schema = 'public' and table_name = 'integracoes_whatsapp';

-- 3.3 — segurança inalterada (esperado: rls_ativo = true, policies = 0)
select
  (select relrowsecurity from pg_class where oid = 'public.integracoes_whatsapp'::regclass) as rls_ativo,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'integracoes_whatsapp') as policies;

-- 3.4 — privilégios inalterados (esperado: dono + service_role; nenhuma linha para anon, authenticated ou PUBLIC)
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'integracoes_whatsapp'
group by grantee
order by grantee;
