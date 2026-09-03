-- ──────────────────────────────────────────────────────────────
-- STEP 6 (보완) · 예측 결과 조회 뷰
--
-- sql/11 이 결과를 만들었지만 화면에서 볼 방법이 없었습니다.
-- 집계를 SQL 에서 끝냅니다. 1,000행이 넘으면 REST 기본 상한에 걸려
-- 화면에서 합계를 내면 숫자가 틀립니다 (AGENTS.md 규칙 2).
--
-- sql/11-forecast-engine.sql 을 먼저 실행하세요.
-- ──────────────────────────────────────────────────────────────

-- 품목 × 모델 요약
create or replace view analytics.v_forecast_summary as
select
  f.run_id,
  f.model_id,
  m.model_name,
  f.item_id,
  im.item_name,
  count(*)                     as n_periods,
  min(f.period)                as first_period,
  max(f.period)                as last_period,
  round(sum(f.predicted_qty), 0) as total_qty,
  round(avg(f.predicted_qty), 1) as avg_qty,
  round(max(f.sigma), 2)         as sigma,
  -- 예측구간 폭. 넓을수록 이 모델이 이 품목에서 자주 빗나갔다는 뜻입니다
  round(avg(f.p80 - f.predicted_qty), 1) as p80_margin
from core.forecast_result f
left join core.model_config m using (model_id)
left join core.v_item_master im using (item_id)
group by f.run_id, f.model_id, m.model_name, f.item_id, im.item_name;

-- 실행 × 모델 요약. 화면의 모델 선택 칩이 이 목록을 씁니다.
create or replace view analytics.v_forecast_run_model as
select
  f.run_id,
  f.model_id,
  m.model_name,
  m.family,
  count(*)                       as n_rows,
  count(distinct f.item_id)      as n_items,
  round(sum(f.predicted_qty), 0) as total_qty
from core.forecast_result f
left join core.model_config m using (model_id)
group by f.run_id, f.model_id, m.model_name, m.family;

grant select on analytics.v_forecast_summary  to authenticated;
grant select on analytics.v_forecast_run_model to authenticated;

-- 확인
select run_id, model_id, n_items, n_rows, total_qty
  from analytics.v_forecast_run_model
 order by run_id desc, model_id;
