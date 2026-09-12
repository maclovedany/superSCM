-- 차트 데이터 레이어 — 수요(실적 vs 예측) 시계열 · 출고 월별 롤업 · 출고 품목×월
--
-- 배경 — styles/chart.css는 2줄, components/chart/forecast-overlay-chart.tsx는 어디서도 import되지
-- 않는 죽은 코드다. 화면에 차트가 하나도 없다. 막고 있는 것은 컴포넌트가 아니라 데이터다 —
-- analytics.v_shipment_trend는 품목당 "집계 1행"(avg_3m·avg_6m·avg_12m)이지 월별 시계열이 아니고,
-- 실적(raw.usage_history)과 예측(analytics.v_forecast_result)을 한 그리드에 놓고 갭을 갭으로
-- 보여주는 뷰가 전혀 없다. 이 마이그레이션은 차트 컴포넌트를 만들지 않는다(다른 트랙) — 그 컴포넌트가
-- 읽을 뷰 3개만 만든다.
--
-- 실측(배포 DB 스냅샷, 2026-09-13) — 이 뷰들의 설계 근거:
--   · raw.usage_history(batch_id is not null): 120행 · 품목 10개 · 12개월(2025-10~2026-09), 달마다 10행.
--   · analytics.v_forecast_result: 450행 · 품목 10개 · 모델 5개 · 9개월(2026-07~2027-03).
--     p80·p90은 450행 중 270행만 있다 — 180행은 밴드가 없다(모델 특성상 계산되지 않음, 데이터 결손이 아니다).
--   · 실적·예측 겹치는 구간은 2026-07~2026-09 — 이 3개월이 "실적 대 예측" 비교 창이다.
--   · raw.fact_shipment: 103,795행 · 79개월(2020-01~2026-07) · 품목 11,111개. 2026-07 한 달만
--     672,275로 직전 5개월(83k~112k) 대비 8배 튄다 — 스무딩·제외하지 않고 그대로 노출한다(아래 ②).
--   · PostgREST는 응답을 1000행으로 자른다(analytics.v_shipment_trend 실측: 10,228행 중 1000행만
--     반환). ③(품목×월, 103,784행)은 반드시 item_code 필터와 함께만 조회한다 — 주석 · 저장소 함수
--     양쪽에 명시한다.
--
-- 권한 — 셋 다 STOCK_VIEW_ALL로 연다. analytics.v_inventory_performance와 같은 근거: SCM팀
-- (SCM_PLANNER·SCM_LEAD)만 갖는 "SCM 전체 조회" 권한이고, 이 저장소에 아직 DEMAND_VIEW·
-- SHIPMENT_VIEW 같은 전용 권한 코드가 없다. 수요 시계열과 출고 롤업이 "같은 이유로" 같은 권한을
-- 쓰는 것은 아니다 — 수요 시계열은 core.forecast_result·raw.usage_history(원가·수요 민감 정보,
-- v_inventory_performance와 같은 성격)를 직접 다루고, 출고 롤업·품목별 시계열은
-- core.v_shipment_by_hoc(이미 analytics.v_shipment_trend가 STOCK_VIEW_ALL 없이도 authenticated
-- 전체에 열려 있던 데이터)를 다룬다. 기존 v_shipment_trend와 다르게 이번엔 security_invoker와
-- 권한 게이트를 붙인다 — "RLS 기반 원본 위에 새로 얹는 analytics 뷰는 security_invoker = true +
-- 권한 게이트"라는 규칙(v_inventory_performance 이후 확립)을 새 뷰에도 지킨다. 기존 화면
-- (getShipmentTrends)의 조회 범위는 이 마이그레이션이 바꾸지 않는다 — v_shipment_trend는 그대로
-- 둔다. 새 전용 권한 코드(예: SHIPMENT_VIEW)를 추가하는 것은 이 작업 범위 밖이다(권한 체계 변경은
-- core.permission·core.role_permission과 그 테스트까지 건드리는 별도 판단이 필요하다) — report에
-- 남긴다.
--
-- ── raw RLS 우회 계층 — core.v_demand_actual_monthly ───────────────────────
--
-- raw.usage_history는 RLS가 켜져 있고(STEP 3, 20260828000200) 이 테이블에 대한 select 정책이
-- 전혀 없다 — invoker 권한으로 읽으면 무조건 0행이다. core.v_train_demand·core.v_test_actual·
-- core.v_shipment_by_hoc와 같은 이유로, 이 새 core 뷰도 security_invoker를 붙이지 않는다
-- (기본값 = definer 방식, 뷰 소유자 권한으로 raw를 읽는다). analytics 레이어의
-- "security_invoker = true 규칙"은 analytics 뷰에 적용되는 규칙이지 이 core 우회 계층에는
-- 적용되지 않는다 — 우회 계층 자체가 RLS를 뚫는 존재 이유이기 때문이다(기존 v_shipment_by_hoc도
-- 같은 이유로 security_invoker가 없다).
create or replace view core.v_demand_actual_monthly as
select
  u.item_id,
  date_trunc('month', u.use_date)::date as period,
  sum(u.qty)                            as actual_qty,
  count(*)::int                         as n_rows
from raw.usage_history u
where u.batch_id is not null
group by u.item_id, date_trunc('month', u.use_date)::date;

comment on view core.v_demand_actual_monthly is
  '출처 확인된(batch_id is not null) 사용 실적만 월 단위로 합산. security_invoker 없음 —
  raw.usage_history에 select 정책이 없어(RLS 켜짐 + 정책 0개) invoker 권한으로 읽으면 0행이 된다.
  core.v_test_actual·core.v_shipment_by_hoc와 같은 우회 계층';

grant select on core.v_demand_actual_monthly to authenticated;
revoke all on core.v_demand_actual_monthly from anon;


-- ── ① analytics.v_demand_series — 수요 실적 vs 예측(Champion) 시계열 ──────
--
-- 그리드 = 품목별 (실적이 있던 달 ∪ Champion 모델의 예측이 있던 기간). 교집합이 아니라 합집합이라
-- "실적만 있고 예측 없음" · "예측만 있고 실적 없음(미래 구간)" 두 쪽 다 행이 남는다 — 화면은 이
-- 갭을 이어 그리지 않고 끊어서 그려야 한다.
--
-- Champion 모델 판정은 analytics.v_champion_model(품목당 최신 선정 1행, STEP 7)을 그대로 따른다 —
-- 여기서 다시 채점하지 않는다. 예측 행은 (item_id, champion_model_id, model_version)이 모두 같은
-- core.forecast_result 행만 붙인다 — model_version까지 맞추는 이유는, 앞으로 Forecast Run이
-- 여러 번 쌓이면 같은 model_id라도 버전이 다른 예측이 섞일 수 있기 때문이다(지금 배포 데이터는
-- Run이 하나뿐이라 겹치지 않지만, 조건을 느슨하게 두면 다음 Run부터 조용히 틀린 값을 합칠 위험이
-- 있다).
--
-- 사유 코드 3개 — 값 하나가 비는 이유마다 서로 다른 사실만 주장한다(구조적 조건과 데이터 조건을
-- 섞지 않는다):
--   actual_reason_code    NO_ACTUAL_USAGE          이 (품목,월)에 출처 확인된 실적이 없다
--   predicted_reason_code NO_CHAMPION_SELECTION    이 품목은 Backtest·Champion 선정 자체를 받은 적이 없다
--                          NO_CHAMPION_MODEL        Backtest는 됐지만 유효 후보가 없었다(core.run_backtest의
--                                                   NO_VALID_CANDIDATE — champion_model_id가 null)
--                          PERIOD_NOT_FORECASTED    Champion 모델은 있지만 이 기간엔 그 모델의 예측 행이 없다
--   band_reason_code      predicted_qty가 없으면 predicted_reason_code를 그대로 물려받는다(예측이
--                          없는데 밴드만 있을 수 없다 — v_inventory_performance의 계단식 사유코드와
--                          같은 원칙). predicted_qty는 있는데 p80·p90 중 하나라도 없으면
--                          BAND_UNAVAILABLE — ★ 이 경우 절대 null을 다른 값으로 채우지 않는다.
--                          실측 450행 중 180행이 이 경로다.
create or replace view analytics.v_demand_series
with (security_invoker = true)
as
with actual as (
  select item_id, period, actual_qty
  from core.v_demand_actual_monthly
),
champion as (
  select item_id, champion_model_id, model_version
  from analytics.v_champion_model
),
forecast as (
  select f.item_id, f.period, f.model_id, f.predicted_qty, f.p80, f.p90
  from core.forecast_result f
  join champion c
    on c.item_id = f.item_id
   and c.champion_model_id = f.model_id
   and c.model_version = f.model_version
),
periods as (
  select item_id, period from actual
  union
  select item_id, period from forecast
),
joined as (
  select
    p.item_id,
    p.period,
    a.actual_qty,
    f.model_id,
    f.predicted_qty,
    f.p80,
    f.p90,
    (c.item_id is not null) as has_champion_row,
    c.champion_model_id
  from periods p
  left join actual a    on a.item_id = p.item_id and a.period = p.period
  left join forecast f  on f.item_id = p.item_id and f.period = p.period
  left join champion c  on c.item_id = p.item_id
),
reasoned as (
  select
    j.*,
    case when j.actual_qty is not null then null
         else 'NO_ACTUAL_USAGE'
    end as actual_reason_code,
    case
      when j.predicted_qty is not null then null
      when not j.has_champion_row      then 'NO_CHAMPION_SELECTION'
      when j.champion_model_id is null then 'NO_CHAMPION_MODEL'
      else 'PERIOD_NOT_FORECASTED'
    end as predicted_reason_code
  from joined j
)
select
  r.item_id,
  im.item_name,
  r.period,
  r.actual_qty,
  r.actual_reason_code,
  r.model_id,
  r.predicted_qty,
  r.predicted_reason_code,
  r.p80,
  r.p90,
  case
    when r.p80 is not null and r.p90 is not null then null
    when r.predicted_qty is null                  then r.predicted_reason_code
    else 'BAND_UNAVAILABLE'
  end as band_reason_code
from reasoned r
left join core.v_item_master im on im.item_id = r.item_id
where core.has_permission('STOCK_VIEW_ALL');

comment on view analytics.v_demand_series is
  '수요 실적(raw.usage_history, 출처 확인분만) vs 예측(Champion 모델, analytics.v_champion_model
  기준) 월별 시계열. 실적 달과 예측 기간의 합집합이라 한쪽만 있는 달도 행이 남는다(화면은 이를
  이어 그리지 않고 끊는다). p80·p90 결손은 절대 다른 값으로 채우지 않고 band_reason_code로만
  드러난다. STOCK_VIEW_ALL(SCM팀)만 조회 — v_inventory_performance와 같은 근거(원가·수요 민감
  정보라 부서별 조회 범위를 두지 않는다). security_invoker';

grant select on analytics.v_demand_series to authenticated;
revoke all on analytics.v_demand_series from anon;


-- ── ②③ 출고 월별 뷰 — core.v_shipment_by_hoc 재사용 ───────────────────────
--
-- 왜 core.v_shipment_by_hoc인가 — analytics.v_shipment_trend가 이미 이 뷰를 거쳐 XCN 합산을
-- 반영한다. 같은 원본을 다시 만들면 두 화면의 숫자가 갈라질 수 있다(realdata/05-analytics-views.sql
-- 머리 주석 참고). qty는 그룹별 합산이라 재그룹핑해도(월 전체 · 품목구분×월) 총량은 보존된다 —
-- HOC 대표코드로 묶는다고 총 출고량이 늘거나 줄지 않는다.
--
-- 이동평균 대비 배수 — v_shipment_trend가 "최근 3개월 ÷ 12개월 평균"을 품목당 1개 스냅샷으로
-- 보여주는 것과 달리, 여기서는 매달 "직전 6개월 평균 대비 이번 달"을 윈도우 함수로 계산해 둔다.
-- 2026-07을 하드코딩해 표시하지 않는다 — 이 비율이 그 달에 자연히 커진다(실측 8배 안팎). 앞 6개
-- 달이 다 차지 않은 시계열 시작 구간(TOTAL 기준 첫 6개월 · ITEM_TYPE 기준 그 구분이 처음 등장한
-- 뒤 6개월)은 트렌드 비율이 부정확하므로 INSUFFICIENT_TRAILING_HISTORY로 null 처리한다.

create or replace view analytics.v_shipment_monthly_rollup
with (security_invoker = true)
as
with total_level as (
  select 'TOTAL'::text as level, null::text as item_type, ym, sum(qty) as qty
  from core.v_shipment_by_hoc
  group by ym
),
item_type_level as (
  select 'ITEM_TYPE'::text as level, item_type, ym, sum(qty) as qty
  from core.v_shipment_by_hoc
  group by item_type, ym
),
combined as (
  select * from total_level
  union all
  select * from item_type_level
),
windowed as (
  select
    c.*,
    avg(c.qty) over (
      partition by c.level, c.item_type
      order by c.ym
      rows between 6 preceding and 1 preceding
    ) as trailing_6m_avg,
    count(*) over (
      partition by c.level, c.item_type
      order by c.ym
      rows between 6 preceding and 1 preceding
    ) as trailing_6m_n
  from combined c
)
select
  w.level,
  w.item_type,
  w.ym,
  w.qty,
  case when w.trailing_6m_n >= 3 then round(w.qty / nullif(w.trailing_6m_avg, 0), 2) end as qty_vs_trailing_6m_avg,
  case when w.trailing_6m_n < 3 then 'INSUFFICIENT_TRAILING_HISTORY' end as trend_reason_code
from windowed w
where core.has_permission('STOCK_VIEW_ALL');

comment on view analytics.v_shipment_monthly_rollup is
  '출고 월별 총합(TOTAL) · 품목구분×월(ITEM_TYPE) 롤업 — 79 + 159 = 238행. core.v_shipment_by_hoc를
  그대로 재집계해 analytics.v_shipment_trend와 총량이 갈리지 않는다. qty_vs_trailing_6m_avg는
  직전 6개월(최소 3개월 관측) 평균 대비 이번 달 배수로, 특정 달을 하드코딩해 표시하지 않고도
  2026-07 같은 이상치를 화면이 계산으로 드러낼 수 있게 한다. 트렌드 판단에 쓸 관측치가 3개월
  미만이면 INSUFFICIENT_TRAILING_HISTORY. STOCK_VIEW_ALL만 조회. security_invoker';

grant select on analytics.v_shipment_monthly_rollup to authenticated;
revoke all on analytics.v_shipment_monthly_rollup from anon;


create or replace view analytics.v_shipment_monthly_item
with (security_invoker = true)
as
select
  h.hoc_item  as item_code,
  h.item_type,
  h.ym,
  h.qty,
  h.n_source_codes
from core.v_shipment_by_hoc h
where core.has_permission('STOCK_VIEW_ALL');

comment on view analytics.v_shipment_monthly_item is
  '출고 품목×월 — 대표코드(HOC) 기준. 실측 규모가 10만 행대라 PostgREST 1000행 상한(실측:
  v_shipment_trend가 10,228행 중 1000행만 반환)에 곧바로 걸린다 — ★ 반드시 item_code(hoc_item)
  eq 필터와 함께만 조회한다. 필터 없는 조회는 화면·저장소 양쪽에서 금지한다(lib 저장소 함수는
  itemCode를 선택 인자가 아니라 필수 인자로 받는다). STOCK_VIEW_ALL만 조회. security_invoker';

grant select on analytics.v_shipment_monthly_item to authenticated;
revoke all on analytics.v_shipment_monthly_item from anon;
