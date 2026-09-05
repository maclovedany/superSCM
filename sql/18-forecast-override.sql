-- ★ 영업 가림막 — analytics.v_forecast_value_add_by_reason · v_forecast_value_add_summary 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- STEP 12 · Forecast Override · Consensus · Forecast Value Add
--
-- renew.prd 17장
--   "AI Forecast를 수정하지 않고 별도 Override를 입력한다.
--    AI Forecast 800 + Human Override +300 = Consensus Forecast 1,100"        (17.1)
--   "reason_code를 코드 체계로 관리한다. 자유 텍스트만으로는 집계·분석이 불가능하다."  (17.2)
--   "AI Forecast 원본은 수정 불가로 보존한다."                                  (17.2)
--   "Actual 확정 후 비교한다. Human Override가 실제로 예측을 개선했는지 평가한다.
--    특정 품목에서 보정이 반복되면 모델 개선 신호로 활용한다."                     (17.3)
--
-- 여기서 만드는 것
--   core       v_actual_demand              기간별 실적. 기간이 끝났는지(is_closed)를 함께 냅니다
--   core       set_forecast_override()      Override 입력 (로그인 사용자 누구나 · renew.prd 4.3)
--   core       clear_forecast_override()    Override 해제 (본인 또는 관리자)
--   analytics  v_forecast_override          유효 + 이력 전부
--   analytics  v_forecast_value_add ★       실적이 확정된 기간의 AI vs Consensus 오차
--   analytics  v_forecast_value_add_summary 전체 1행 (STEP 15 대시보드가 읽습니다)
--   analytics  v_forecast_value_add_by_reason
--   analytics  v_override_excess            품목별 보정 반복 (STEP 14 룰이 읽습니다)
--
-- ★ sql/16-safety-stock-recommendation.sql 까지 먼저 실행하세요.
--   core.forecast_override · core.v_ai_forecast · core.v_consensus_forecast 는 sql/15 가,
--   analytics.v_consensus_forecast 는 sql/16 이 이미 만들었습니다.
--   ★ analytics.v_consensus_forecast 를 여기서 다시 만들지 않습니다 (sql/16 §4-1).
--
-- ★ AI 예측 원본(core.forecast_result)을 이 파일은 읽기만 합니다.
--   update · delete 문이 한 줄도 없습니다 (renew.prd 17.2).
--
-- ★★ 다시 실행할 때 (재실행 규칙) — 반드시 읽으세요
--
--   이 파일의 `drop view` 는 전부 **cascade** 입니다. cascade 가 없으면 뒤 번호
--   파일이 이 파일의 뷰 위에 뷰를 만들어 둔 순간부터
--   "cannot drop … because other objects depend on it" 으로 재실행 자체가
--   막혔습니다. 그래서 cascade 를 붙였습니다.
--
--   대신 값을 치릅니다. cascade 는 **뒤 파일이 만든 뷰까지 말없이 함께 지웁니다.**
--   analytics.v_forecast_override 를 지우면 sql/19 의 v_decision_history 가 같이
--   사라집니다. v_forecast_value_add_summary · v_override_excess 위에 뷰를 만든
--   파일은 지금은 없습니다 (sql/20 은 함수 안에서 읽기만 하므로 의존이 아닙니다).
--   앞으로 생기면 그때도 이 규칙이 그대로 적용됩니다.
--
--   그래서 규칙은 하나뿐입니다.
--
--       이 파일을 다시 실행했으면, 이 파일보다 번호가 큰 파일을 전부
--       순서대로 다시 실행하세요. (순서는 sql/README.md)
--
--   빠뜨리면 오류는 나지 않고 화면만 조용히 비어 보입니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. core 뷰 — 기간별 실적 ═══════════════════════════════════
--
-- Forecast Value Add 는 "실적이 확정된 기간" 만 봅니다 (renew.prd 17.3).
--
-- core.v_test_actual 은 백테스트 정답지라 core.forecast_setting 의 검증 구간
-- (test_start ~ test_end) 안쪽만 내보냅니다. Override 는 앞으로의 기간에 붙으므로
-- 그 창으로는 대부분의 Override 를 평가할 수 없습니다. 그래서 경계 없이 기간별 실적을
-- 내는 뷰를 따로 둡니다. 학습 경로는 이 뷰를 부르지 않습니다 — 학습은 여전히
-- core.v_train_demand 하나만 씁니다 (renew.prd 7.9 의 격리는 그대로입니다).
--
-- 기간 구분(월/주)은 core.forecast_setting.granularity 를 따릅니다. 예측 기간과
-- 같은 자로 잘라야 같은 (item, period) 로 맞붙습니다.
--
-- is_closed — 그 기간의 실적이 확정되었는가. 두 가지를 함께 봅니다.
--   ① 달력상 그 기간이 끝났는가          period_end <= current_date
--   ② 그 기간까지 실적이 적재되었는가    period_end <= max(use_date) + 1
--
--   ①만 보면 안 됩니다. 실적은 배치 임포트로 들어오므로 달력상 끝난 달이라도 일부만
--   적재되어 있을 수 있습니다. 그런 기간을 확정으로 채점하면 실적이 실제보다 작아
--   AI 와 Consensus 가 둘 다 과대예측한 것처럼 보입니다 (없는 실적을 0 으로 읽는 셈입니다).
--
--   least() 는 null 인 인자를 무시합니다. raw.usage_history 가 비어 있으면 ②가 null 이 되어
--   ①만 남지만, 그때는 이 뷰 자체가 0행이라 채점에 쓰이지 않습니다.

create or replace view core.v_actual_demand as
select d.item_id,
       d.period,
       d.actual_qty,
       d.tx_count,
       -- 실데이터는 월 단위라 "그 달이 데이터의 마지막 달까지 들어와 있으면" 확정입니다.
       (d.period <= (select max(m.period) from core.v_demand_monthly m)) as is_closed
  from (
    select u.item_id,
           u.period,
           (u.period + interval '1 month')::date as period_end,
           sum(u.qty)::numeric         as actual_qty,
           sum(u.n_source_codes)       as tx_count
      from core.v_demand_monthly u
     where u.qty > 0          -- 반품(음수)은 실적에서 제외 (core.v_test_actual 과 같은 규칙)
     group by 1, 2, 3
  ) d;

comment on view core.v_actual_demand is
  'renew.prd 17.3 — 기간별 실적. is_closed 가 true 인 기간만 "확정" 입니다. 학습은 이 뷰를 쓰지 않습니다';

-- ══ 2. 함수 — Override 입력 ════════════════════════════════════
--
-- renew.prd 4.3 · 17장 — Override 는 담당자(USER)도 입력할 수 있어야 합니다.
-- 그래서 첫 줄이 core.is_admin() 이 아니라 auth.uid() 확인입니다.
--
-- security definer 인 이유는 두 가지입니다.
--   ① 같은 (item, period) 에 유효 Override 는 하나뿐입니다(부분 유니크 인덱스).
--      남이 넣은 Override 를 대체하려면 그 행의 superseded_at 을 채워야 하는데,
--      core.forecast_override 의 update 정책은 본인/관리자로 막혀 있습니다 (sql/15 §7).
--      두 동작을 한 트랜잭션으로 묶는 일을 이 함수가 맡습니다.
--   ② ai_forecast · consensus_forecast 를 클라이언트가 보내지 않고 여기서 채웁니다.
--      화면이 보낸 숫자를 그대로 믿으면 "AI 가 800 이었다" 는 기록이 조작될 수 있습니다.
--
-- 주의: RETURNS TABLE 의 컬럼 이름(ok · message · prev_*)은 함수 안에서 변수가 됩니다.
--       본문에서 테이블 컬럼을 참조할 때는 항상 별칭을 붙입니다 (error.md #11).
--
-- 반환에 prev_override_qty · prev_consensus_forecast 를 함께 냅니다. 대체된 값을
-- 액션이 감사 로그의 before 로 남기기 위해서입니다 (renew.prd 31.1 — 무엇을 무엇으로 바꿨나).
-- 함수가 이미 읽은 값이라 조회가 늘지 않습니다.
--
-- ★ create or replace 는 반환 타입을 바꾸지 못합니다("cannot change return type of
--   existing function"). 옛 2컬럼 버전이 이미 설치된 DB 에서도 이 파일을 다시 돌릴 수 있도록
--   먼저 지웁니다. 바로 아래에서 권한을 다시 부여합니다.
drop function if exists core.set_forecast_override(text, date, numeric, text, text);

create or replace function core.set_forecast_override(
  p_item_id      text,
  p_period       date,
  p_override_qty numeric,
  p_reason_code  text,
  p_reason_text  text
)
returns table (ok boolean, message text, prev_override_qty numeric, prev_consensus_forecast numeric)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_uid              uuid := auth.uid();
  v_email            text;
  v_run_id           text;
  v_ai_qty           numeric;
  v_consensus        numeric;
  v_before           numeric;
  v_before_consensus numeric;
begin
  -- 로그인한 사용자 누구나 가능합니다. 관리자 전용이 아닙니다 (renew.prd 4.3).
  if v_uid is null then
    return query select false, '로그인이 필요합니다'::text, null::numeric, null::numeric;
    return;
  end if;

  if p_item_id is null or btrim(p_item_id) = '' then
    return query select false, '품목을 선택해주세요'::text, null::numeric, null::numeric;
    return;
  end if;

  if p_period is null then
    return query select false, '기간을 선택해주세요'::text, null::numeric, null::numeric;
    return;
  end if;

  if p_override_qty is null then
    return query select false, '증감 수량을 입력해주세요'::text, null::numeric, null::numeric;
    return;
  end if;

  -- renew.prd 17.2 — 사유는 코드 체계로만 저장합니다.
  -- 목록은 core.forecast_override.reason_code 의 check 제약(sql/15)과 같아야 합니다.
  if p_reason_code is null or p_reason_code not in
       ('NEW_CONTRACT','PROMOTION','NEW_PRODUCT','DISCONTINUED',
        'PROJECT','MARKET_CHANGE','DATA_ERROR','OTHER') then
    return query select false, '사유 코드를 확인해주세요'::text, null::numeric, null::numeric;
    return;
  end if;

  -- renew.prd 17.2 — "OTHER 기타 (텍스트 필수)"
  if p_reason_code = 'OTHER' and (p_reason_text is null or btrim(p_reason_text) = '') then
    return query select false, '기타 를 고르면 사유를 직접 적어야 합니다'::text,
                        null::numeric, null::numeric;
    return;
  end if;

  -- AI 예측이 있어야 Override 를 얹을 수 있습니다. 없는 기간에 증감만 넣으면
  -- Consensus 가 사람이 지어낸 숫자가 됩니다 (AGENTS.md 규칙 5).
  select a.run_id, a.predicted_qty
    into v_run_id, v_ai_qty
    from core.v_ai_forecast a
   where a.item_id = p_item_id
     and a.period  = p_period
   limit 1;

  if v_run_id is null then
    return query select false, '이 기간의 AI 예측이 없습니다'::text, null::numeric, null::numeric;
    return;
  end if;

  v_consensus := coalesce(v_ai_qty, 0) + p_override_qty;

  -- 음수 수요는 존재하지 않습니다. 0 으로 잘라 저장하면 사람이 넣은 값과
  -- 저장된 값이 달라지므로, 자르지 않고 거절합니다.
  if v_consensus < 0 then
    return query select false,
      ('Consensus 가 음수가 됩니다 (AI ' || coalesce(v_ai_qty, 0)::text ||
       ' + 증감 ' || p_override_qty::text || '). 증감 수량을 다시 확인해주세요')::text,
      null::numeric, null::numeric;
    return;
  end if;

  select au.email into v_email
    from core.app_user au
   where au.user_id = v_uid;

  -- 이전 유효 행을 먼저 대체 처리합니다. 부분 유니크 인덱스가 있어
  -- 이 순서를 지키지 않으면 insert 가 막힙니다 (sql/15 forecast_override_current_idx).
  -- 여기서 읽은 두 값은 반환에 실려 감사 로그의 before 가 됩니다.
  select o.override_qty, o.consensus_forecast
    into v_before, v_before_consensus
    from core.forecast_override o
   where o.item_id = p_item_id
     and o.period  = p_period
     and o.superseded_at is null
   limit 1;

  update core.forecast_override o
     set superseded_at = now()
   where o.item_id = p_item_id
     and o.period  = p_period
     and o.superseded_at is null;

  -- 두 사람이 같은 기간을 동시에 저장하면, 위 update 가 각자의 트랜잭션에서만 보이므로
  -- 나중에 커밋하는 쪽의 insert 가 부분 유니크 인덱스에 걸립니다.
  -- Postgres 원문("duplicate key value violates unique constraint …")을 사용자에게 보이지 않습니다.
  begin
    insert into core.forecast_override
      (item_id, period, run_id, ai_forecast, override_qty, consensus_forecast,
       reason_code, reason_text, created_by, created_email)
    values
      (p_item_id, p_period, v_run_id, v_ai_qty, p_override_qty, v_consensus,
       p_reason_code, nullif(btrim(coalesce(p_reason_text, '')), ''), v_uid, v_email);
  exception
    when unique_violation then
      return query select false,
        '같은 기간에 방금 다른 보정이 저장되었습니다. 새로고침 후 다시 시도하세요'::text,
        null::numeric, null::numeric;
      return;
  end;

  return query select true,
    (case when v_before is null then '' else '이전 보정(' || v_before::text || ')을 대체했습니다. ' end ||
     to_char(p_period, 'YYYY-MM') || ' Consensus 를 ' || v_consensus::text || ' 로 저장했습니다')::text,
    v_before, v_before_consensus;
end;
$$;

revoke all on function core.set_forecast_override(text, date, numeric, text, text) from public, anon;
grant execute on function core.set_forecast_override(text, date, numeric, text, text) to authenticated;

comment on function core.set_forecast_override(text, date, numeric, text, text) is
  'renew.prd 17.1 — AI 예측에 증감을 얹어 Consensus 를 만듭니다. AI 원본은 수정하지 않습니다';

-- ══ 3. 함수 — Override 해제 ════════════════════════════════════
--
-- 유효 행의 superseded_at 을 채웁니다. 행을 지우지 않는 이유는,
-- 해제 이력도 Forecast Value Add 의 재료이기 때문입니다 (renew.prd 17.3).

create or replace function core.clear_forecast_override(
  p_item_id text,
  p_period  date
)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_uid   uuid := auth.uid();
  v_id    bigint;
  v_owner uuid;
begin
  if v_uid is null then
    return query select false, '로그인이 필요합니다'::text;
    return;
  end if;

  if p_item_id is null or btrim(p_item_id) = '' or p_period is null then
    return query select false, '품목과 기간을 확인해주세요'::text;
    return;
  end if;

  select o.id, o.created_by
    into v_id, v_owner
    from core.forecast_override o
   where o.item_id = p_item_id
     and o.period  = p_period
     and o.superseded_at is null
   limit 1;

  -- 아무 일도 안 하고 성공했다고 말하면 화면이 거짓말을 합니다 (sql/15 set_leadtime_plan 과 같은 규칙).
  if v_id is null then
    return query select false, '해제할 보정이 없습니다'::text;
    return;
  end if;

  if v_owner is distinct from v_uid and not core.is_admin() then
    return query select false, '본인이 입력한 보정만 해제할 수 있습니다'::text;
    return;
  end if;

  update core.forecast_override o
     set superseded_at = now()
   where o.id = v_id;

  return query select true,
    (to_char(p_period, 'YYYY-MM') || ' 보정을 해제했습니다. AI 예측을 그대로 씁니다')::text;
end;
$$;

revoke all on function core.clear_forecast_override(text, date) from public, anon;
grant execute on function core.clear_forecast_override(text, date) to authenticated;

comment on function core.clear_forecast_override(text, date) is
  'renew.prd 17장 — 유효 Override 를 대체 처리합니다. 행을 지우지 않아 이력이 남습니다';

-- ══ 4. analytics 뷰 ════════════════════════════════════════════
--
-- 의존 역순으로 먼저 지웁니다 (summary · by_reason → value_add).

drop view if exists analytics.v_forecast_value_add_by_reason cascade;
drop view if exists analytics.v_forecast_value_add_summary cascade;
drop view if exists analytics.v_forecast_value_add cascade;
drop view if exists analytics.v_override_excess cascade;
drop view if exists analytics.v_forecast_override cascade;

-- ── 4-1. Override 목록 (유효 + 이력) ──────────────────────────
--
-- model_id 는 Override 행에 저장되어 있지 않습니다. run_id 로 지금의 대표 예측과
-- 맞춰 보고, 그 실행이 더 이상 최신이 아니면 null 로 둡니다. 다른 실행의 모델 이름을
-- 가져다 붙이면 "무엇을 보고 보정했는지" 가 사실과 달라집니다.

create view analytics.v_forecast_override as
select o.id,
       o.item_id,
       im.item_name,
       o.period,
       o.run_id,
       a.model_id,
       o.ai_forecast,
       o.override_qty,
       o.consensus_forecast,
       o.reason_code,
       o.reason_text,
       o.created_by,
       o.created_email,
       o.created_at,
       o.superseded_at,
       (o.superseded_at is null) as is_active
  from core.forecast_override o
  left join core.v_item_master im on im.item_id = o.item_id
  left join core.v_ai_forecast a
    on a.item_id = o.item_id
   and a.period  = o.period
   and a.run_id  = o.run_id;

comment on view analytics.v_forecast_override is
  'renew.prd 17.2 — Override 입력 이력 전부. is_active 가 지금 유효한 행입니다';

-- ── 4-2. 보정이 반복되는 품목 (STEP 14 Excessive Override 룰) ──
--
-- renew.prd 17.3 — "특정 품목에서 보정이 반복되면 모델 개선 신호로 활용한다."
-- 90일은 관찰 창의 정의이지 정책값이 아닙니다. 뷰 이름(n_recent_90d)에 들어 있어
-- 바꾸면 컬럼 이름도 함께 바뀝니다.

create view analytics.v_override_excess as
select o.item_id,
       im.item_name,
       (count(*) filter (where o.superseded_at is null))::int              as n_active,
       (count(*) filter (where o.created_at >= now() - interval '90 days'))::int as n_recent_90d,
       max(o.created_at)                                                 as last_override_at
  from core.forecast_override o
  left join core.v_item_master im on im.item_id = o.item_id
 group by o.item_id, im.item_name;

comment on view analytics.v_override_excess is
  'renew.prd 17.3 — 품목별 보정 횟수. STEP 14 의 Excessive Override 룰이 읽습니다';

-- ── 4-3. Forecast Value Add (renew.prd 17.3) ──────────────────
--
-- 실적이 확정된 기간만 봅니다. 진행 중인 달을 섞으면 Consensus 가 과대예측한 것처럼 보입니다.
--
-- ★ 어느 Override 를 쓰는가 — 그 (item, period) 에 대해 **가장 마지막에 유효했던 행** 입니다.
--   해제되었거나 다른 Override 로 대체된 행도 포함해 created_at 이 가장 큰 것을 씁니다.
--   지금 유효한 행만 보면, 실적이 나오기 전에 해제한 보정이 통째로 평가에서 빠집니다.
--
-- ai_forecast · consensus_forecast 는 Override 행에 저장된 값입니다.
-- 보정하던 그 시점의 AI 예측이라야 "사람이 무엇을 보고 고쳤나" 를 채점할 수 있습니다.
-- 지금의 core.v_ai_forecast 를 다시 읽으면 그 사이 재실행된 예측으로 채점하게 됩니다.

create view analytics.v_forecast_value_add as
with last_override as (
  select distinct on (o.item_id, o.period)
         o.id,
         o.item_id,
         o.period,
         o.ai_forecast,
         o.override_qty,
         o.consensus_forecast,
         o.reason_code,
         o.reason_text,
         o.created_email,
         o.created_at
    from core.forecast_override o
   order by o.item_id, o.period, o.created_at desc, o.id desc
)
select lo.item_id,
       im.item_name,
       lo.period,
       ad.actual_qty                              as actual,
       lo.ai_forecast,
       lo.consensus_forecast,
       lo.override_qty,
       abs(ad.actual_qty - lo.ai_forecast)        as ai_abs_error,
       abs(ad.actual_qty - lo.consensus_forecast) as consensus_abs_error,
       -- 오차를 못 구하면 "개선했다/못했다" 도 모릅니다. false 로 접지 않습니다.
       case
         when lo.ai_forecast is null or lo.consensus_forecast is null then null
         else abs(ad.actual_qty - lo.consensus_forecast) < abs(ad.actual_qty - lo.ai_forecast)
       end                                        as improved,
       lo.reason_code,
       lo.reason_text,
       lo.created_email                           as override_email,
       lo.created_at                              as override_at
  from last_override lo
  join core.v_actual_demand ad
    on ad.item_id = lo.item_id
   and ad.period  = lo.period
   and ad.is_closed
  left join core.v_item_master im on im.item_id = lo.item_id;

comment on view analytics.v_forecast_value_add is
  'renew.prd 17.3 — 실적이 확정된 기간의 AI 오차와 Consensus 오차. 보정이 실제로 도움이 됐는지 봅니다';

-- ── 4-4. 전체 요약 한 줄 (STEP 15 대시보드) ───────────────────
--
-- WAPE = Σ|실적 − 예측| / Σ실적. 품목·기간을 합쳐 한 번에 나눕니다.
-- 품목별 WAPE 를 평균 내면 수요가 작은 품목이 과하게 반영됩니다.
--
-- n_improved · n_worsened 는 오차 크기로 셉니다. 두 오차가 같은 기간(보정이 0 이거나
-- 우연히 같은 경우)은 어느 쪽에도 넣지 않습니다 — 합이 n_periods 와 다를 수 있습니다.
--
-- ★ 분자와 분모를 **같은 행 집합**으로 맞춥니다. 예측이 null 이라 채점할 수 없는 행은
--   오차(분자)에 기여하지 못하는데 실적(분모)에는 들어가서, 두 WAPE 를 함께 낮게 만듭니다.
--   그래서 세 합계 모두 "양쪽 예측이 있는 행" 으로 제한합니다.
--   n_periods 만 실적이 확정된 기간 전부를 셉니다 — WAPE 의 모수와 다를 수 있습니다.
--
-- 행이 하나도 없어도 집계라 항상 1행이 나옵니다 (n_periods = 0 · WAPE 는 null).

create view analytics.v_forecast_value_add_summary as
with agg as (
  select count(*)::int                                                        as n_periods,
         sum(v.actual) filter (where v.ai_abs_error is not null
                                 and v.consensus_abs_error is not null)       as sum_actual,
         sum(v.ai_abs_error) filter (where v.ai_abs_error is not null
                                 and v.consensus_abs_error is not null)       as sum_ai_error,
         sum(v.consensus_abs_error) filter (where v.ai_abs_error is not null
                                 and v.consensus_abs_error is not null)       as sum_consensus_error,
         (count(*) filter (where v.consensus_abs_error < v.ai_abs_error))::int as n_improved,
         (count(*) filter (where v.consensus_abs_error > v.ai_abs_error))::int as n_worsened
    from analytics.v_forecast_value_add v
)
select a.n_periods,
       round((a.sum_ai_error        / nullif(a.sum_actual, 0))::numeric, 4) as ai_wape,
       round((a.sum_consensus_error / nullif(a.sum_actual, 0))::numeric, 4) as consensus_wape,
       a.n_improved,
       a.n_worsened,
       -- 개선률 = (AI WAPE − Consensus WAPE) / AI WAPE. 분모가 같아 오차 합으로 계산해도 같습니다.
       -- 0.12 면 12% 개선입니다. 화면이 다시 나눗셈하지 않도록 여기서 냅니다 (AGENTS.md 규칙 2).
       round(((a.sum_ai_error - a.sum_consensus_error)
              / nullif(a.sum_ai_error, 0))::numeric, 4)                      as improvement_pct
  from agg a;

comment on view analytics.v_forecast_value_add_summary is
  'renew.prd 17.3 — AI WAPE 대 Consensus WAPE. STEP 15 대시보드가 읽습니다';

-- ── 4-5. 사유 코드별 (renew.prd 17.3) ─────────────────────────
--
-- "어떤 유형의 보정이 효과적이었나" 를 봅니다.
--
-- 요약 뷰와 같은 이유로 세 합계를 "양쪽 예측이 있는 행" 으로 제한합니다.

create view analytics.v_forecast_value_add_by_reason as
with scored as (
  select v.reason_code, v.actual, v.ai_abs_error, v.consensus_abs_error
    from analytics.v_forecast_value_add v
   where v.ai_abs_error is not null
     and v.consensus_abs_error is not null
),
agg as (
  select s.reason_code,
         count(*)::int              as n,
         sum(s.actual)              as sum_actual,
         sum(s.ai_abs_error)        as sum_ai_error,
         sum(s.consensus_abs_error) as sum_consensus_error
    from scored s
   group by s.reason_code
)
select a.reason_code,
       a.n,
       round((a.sum_ai_error        / nullif(a.sum_actual, 0))::numeric, 4) as ai_wape,
       round((a.sum_consensus_error / nullif(a.sum_actual, 0))::numeric, 4) as consensus_wape,
       round(((a.sum_ai_error - a.sum_consensus_error)
              / nullif(a.sum_ai_error, 0))::numeric, 4)                     as improvement_pct
  from agg a;

comment on view analytics.v_forecast_value_add_by_reason is
  'renew.prd 17.3 — 사유 코드별 개선률. 어떤 유형의 보정이 효과적이었는지 봅니다';

-- ══ 5. 권한 ════════════════════════════════════════════════════
--
-- core.forecast_override 의 테이블 권한과 RLS 는 sql/15 §7 에 있습니다.
-- 여기서는 새로 만든 뷰와 함수만 엽니다.

grant select on core.v_actual_demand                     to authenticated;

grant select on analytics.v_forecast_override            to authenticated;
grant select on analytics.v_override_excess              to authenticated;
grant select on analytics.v_forecast_value_add           to authenticated;
grant select on analytics.v_forecast_value_add_summary   to authenticated;
grant select on analytics.v_forecast_value_add_by_reason to authenticated;

-- ══ 6. 확인 ════════════════════════════════════════════════════

-- 실적이 확정된 기간이 몇 개인지 (0 이면 Value Add 표가 전부 비어 있는 것이 정상입니다)
select count(*) as n_periods, count(*) filter (where is_closed) as n_closed
  from core.v_actual_demand;

-- Override 이력
select item_id, period, ai_forecast, override_qty, consensus_forecast,
       reason_code, created_email, is_active
  from analytics.v_forecast_override
 order by created_at desc
 limit 20;

-- Consensus 가 AI + 증감과 맞는지 (0행이어야 정상입니다).
-- coalesce 는 함수의 계산식(v_consensus := coalesce(v_ai_qty, 0) + p_override_qty)과 같아야 합니다.
-- 그러지 않으면 predicted_qty 가 null 인 채로 저장된 정상 행이 오류로 잡힙니다.
select o.item_id, o.period, o.ai_forecast, o.override_qty, o.consensus_forecast,
       o.consensus_forecast - (coalesce(o.ai_forecast, 0) + o.override_qty) as diff
  from analytics.v_forecast_override o
 where o.consensus_forecast is distinct from (coalesce(o.ai_forecast, 0) + o.override_qty)
 limit 10;

-- Forecast Value Add
select * from analytics.v_forecast_value_add_summary;
select * from analytics.v_forecast_value_add_by_reason order by n desc;

select item_id, period, actual, ai_forecast, consensus_forecast,
       ai_abs_error, consensus_abs_error, improved, reason_code
  from analytics.v_forecast_value_add
 order by period desc, item_id
 limit 20;

-- 보정이 반복되는 품목 (STEP 14 가 이 뷰를 읽습니다)
select item_id, item_name, n_active, n_recent_90d, last_override_at
  from analytics.v_override_excess
 order by n_recent_90d desc, n_active desc
 limit 10;

-- 함수를 직접 시험해 보려면 (로그인 세션에서)
--   select * from core.set_forecast_override('ITEM001', date_trunc('month', current_date)::date,
--                                            300, 'NEW_CONTRACT', null);
--   select * from core.set_forecast_override('ITEM001', date_trunc('month', current_date)::date,
--                                            -99999, 'DATA_ERROR', null);   -- 음수 Consensus 로 거절
--   select * from core.clear_forecast_override('ITEM001', date_trunc('month', current_date)::date);
