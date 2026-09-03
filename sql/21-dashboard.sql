-- ★ 영업 가림막 — analytics.v_dashboard_kpi · v_dashboard_open_po_risk 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- STEP 15 · Dashboard
--
-- renew.prd 28장
--   28.1  상단 KPI 12종
--   28.2  하단 위젯 7종 (발주 우선순위 · 결품 위험 · 정확도 랭킹 ·
--         Open PO 위험 · 알림 · 최근 승인 · AI Agent)
--   31.4  "LLM 실패가 SCM 계산 자체를 중단시키면 안 된다"
--
-- ★ 이 파일은 새 계산을 하지 않습니다.
--   STEP 7 · 9 · 10 · 12 · 13 · 14 가 이미 만든 뷰를 한 줄로 모으고(v_dashboard_kpi),
--   하단 위젯이 읽을 목록을 정렬·절단해 둘 뿐입니다.
--   숫자의 정의를 여기서 다시 쓰면 대시보드와 상세 화면이 서로 다른 값을 말하게 됩니다.
--
-- 여기서 만드는 것
--   analytics  v_dashboard_kpi                1행 · renew.prd 28.1 의 12종 + 보조 값
--   analytics  v_dashboard_purchase_priority  발주 우선순위 상위 10
--   analytics  v_dashboard_accuracy_ranking   Champion 을 WAPE 순으로 (좋은 5 · 나쁜 5 는 화면이 자름)
--   analytics  v_dashboard_open_po_risk       진행 중 선적 중 예정일 경과 또는 7일 이내
--   analytics  v_dashboard_recent_approvals   최근 결정 10
--   analytics  v_dashboard_sparkline          품목별 최근 12개월 실적 + 향후 3개월 Consensus
--
-- ★ sql/20-alert.sql 까지 먼저 실행하세요. 이 파일이 읽는 것은 전부 그 앞 파일들이 만듭니다.
--     analytics.v_backtest_kpi · v_champion_model      (sql/13)
--     analytics.v_data_coverage                        (sql/07)
--     analytics.v_forecast_run                         (sql/11)
--     analytics.v_stockout_kpi                         (sql/15)
--     core.v_consensus_forecast                        (sql/15)
--     analytics.v_purchase_recommendation(_kpi)        (sql/16)
--     core.v_usage_monthly                             (sql/17)
--     analytics.v_approval · v_approval_kpi            (sql/19)
--     analytics.v_alert · v_alert_kpi                  (sql/20)
--     core.v_fact_shipment · core.v_item_master · raw.supplier_master  (덤프)
--
-- ★ 재실행해도 안전합니다. 컬럼을 바꿔 넣을 수 있도록 drop → create 순서입니다
--   (공통규칙 §3-15 — create or replace 는 컬럼을 빼거나 순서를 바꾸지 못합니다).
--   §1 의 drop 여섯 줄은 전부 cascade 입니다. 이 파일의 뷰 위에 뷰를 만드는 뒤 번호
--   파일은 지금 없으므로(sql/22 는 이 파일과 무관합니다), 이 파일은 혼자 다시 실행해도
--   됩니다.
--
-- ★★ 반대 방향은 규칙이 있습니다 — sql/15 · 16 · 19 · 20 을 다시 실행할 때
--
--     analytics.v_dashboard_kpi 는 v_stockout_kpi(15) · v_purchase_recommendation_kpi(16) ·
--     v_approval_kpi(19) · v_alert_kpi(20) 네 개에 한꺼번에 기댑니다. 그 네 파일이
--     쓰일 때는 없던 의존입니다. 그래서 그 파일들의 drop 은 cascade 로 바꿨고,
--     다시 실행하면 이 파일의 대시보드 뷰가 **말없이 함께 지워집니다.**
--
--     규칙은 하나입니다 — 그 네 파일 중 하나라도 다시 실행했으면
--     **이 파일(sql/21)을 마지막에 다시 실행하세요.** 더 정확히는 "다시 실행한 파일보다
--     번호가 큰 파일을 전부 순서대로" 입니다. 순서는 sql/README.md 가 기준입니다.
--
--     예전에는 네 파일의 drop 블록 맨 앞에 v_dashboard_* 를 지우는 줄을 각각 넣는 방법을
--     적어 두었습니다. 그 방식은 새 파일이 생길 때마다 앞선 파일을 전부 고쳐야 해서
--     쓰지 않기로 했습니다. cascade + 재실행 규칙으로 대체했습니다.
-- ──────────────────────────────────────────────────────────────


-- ══ 1. 정리 ════════════════════════════════════════════════════
--
-- ★ cascade 는 안전망입니다 — 지금 이 뷰들에 기대는 뷰는 없습니다.
--   앞 단계 파일(sql/15 · 16 · 19 · 20)을 다시 실행하면 이 뷰들이 그쪽 cascade 에
--   함께 지워집니다. 그때는 이 파일 전체를 다시 실행하세요 (머리말 ★★ · sql/README.md).

drop view if exists analytics.v_dashboard_sparkline         cascade;
drop view if exists analytics.v_dashboard_recent_approvals  cascade;
drop view if exists analytics.v_dashboard_open_po_risk      cascade;
drop view if exists analytics.v_dashboard_accuracy_ranking  cascade;
drop view if exists analytics.v_dashboard_purchase_priority cascade;
drop view if exists analytics.v_dashboard_kpi               cascade;


-- ══ 2. KPI 한 줄 ═══════════════════════════════════════════════
--
-- renew.prd 28.1 의 12종입니다. 전부 앞 단계의 KPI 뷰에서 그대로 옵니다.
--
-- ★ 항상 정확히 1행이어야 합니다. 화면이 "값이 없다" 와 "행이 없다" 를 구분하지 못하면
--   조회 실패가 0 으로 보입니다 (renew.prd 31.5).
--   그래서 재료를 두 갈래로 나눕니다.
--     · 집계 뷰(group by 없는 aggregate) → 언제나 1행이므로 cross join
--     · 행이 없을 수 있는 것(예측 실행 · 데이터 범위) → left join ... on true
--   analytics.v_data_coverage 는 core.forecast_setting(id=1) 이 없으면 0행입니다.
--   cross join 으로 붙이면 그 순간 대시보드 KPI 가 통째로 사라집니다.
--
-- ★ 계산 불가를 0 으로 채우지 않습니다 (AGENTS.md 규칙 5).
--   백테스트 전이면 forecast_accuracy · forecast_bias 는 null 입니다.
--   화면은 그 자리에 EmptyValue 와 사유를 그립니다.

create view analytics.v_dashboard_kpi as
with bk as (
  -- 1행 보장 — v_backtest_kpi 는 from 절이 없는 스칼라 서브쿼리 모음입니다.
  select * from analytics.v_backtest_kpi
),
ch as (
  -- v_backtest_kpi 에는 avg_abs_bias(절대값)만 있습니다. Bias 는 부호가 뜻을 갖습니다 —
  -- bias = Σ(예측−실적) / Σ실적 이므로(sql/13 §5) + 는 과대예측 · − 는 과소예측입니다. 절대값으로는
  -- "우리 예측이 어느 쪽으로 치우쳐 있는가" 를 말할 수 없어 여기서 부호 있는 평균을 냅니다.
  select round(avg(c.bias)::numeric, 4)                     as avg_bias,
         (count(*) filter (where c.bias is not null))::int  as n_bias_items
    from core.champion_model c
),
so as (
  select * from analytics.v_stockout_kpi
),
pr as (
  select * from analytics.v_purchase_recommendation_kpi
),
ap as (
  select * from analytics.v_approval_kpi
),
ak as (
  select * from analytics.v_alert_kpi
),
al as (
  -- 미해결 알림을 유형별로 셉니다.
  --
  -- ★ 과잉 재고를 v_stockout_risk.months_of_supply 로 다시 세지 않습니다.
  --   그 값은 전개 끝까지 여유인 품목에서 전개 개월 수로 포화합니다(STEP 9 보고서 §9-2).
  --   EXCESS_STOCK_MONTHS 와 곧바로 비교하면 재고가 넉넉한 품목이 전부 걸립니다.
  --   STEP 14 가 sql/20 에서 잉여 수량을 직접 비교하도록 룰을 고쳤으므로,
  --   대시보드는 그 룰이 만든 알림 수를 셉니다 — 두 화면이 같은 값을 말합니다.
  select (count(*) filter (where a.type = 'EXCESS_INVENTORY'))::int as n_excess_inventory,
         (count(*) filter (where a.type = 'OPEN_PO_DELAY'))::int    as n_delayed_open_po
    from analytics.v_alert a
),
lr as (
  -- 화면이 쓰는 예측 실행. core.v_ai_forecast 가 고르는 것과 **같은 규칙**입니다
  -- (운영 실행 우선 → 그중 가장 최근 → 없으면 가장 최근 성공 실행).
  -- 두 곳이 다른 실행을 가리키면 헤더에 적힌 run 과 화면 숫자의 출처가 어긋납니다.
  --
  -- ★ STEP 20 수정 라운드 1 — 예전에는 started_at 만 봤습니다. 운영 실행 뒤에
  --   검증 실행을 한 번 돌리면 헤더는 검증 실행을, 숫자는 운영 실행을 가리켰습니다.
  --   mode 컬럼은 sql/11-forecast-engine.sql 이 만듭니다 (이 파일보다 먼저 실행됩니다).
  --
  --   ★ (fr.mode = 'PRODUCTION') desc 형태의 괄호 있는 불린 정렬식을, 컬럼 이름이
  --   하필 `mode` 인 것과 엮여 "WITHIN GROUP is required for ordered-set aggregate
  --   mode" (42809) 로 거부하는 환경이 있었습니다. 순수 PostgreSQL 17.10 로는
  --   재현되지 않아 원인을 확정하지 못했지만(문법상 정당한 불린 비교이지 mode()
  --   집계 호출이 아닙니다), case 식으로 바꾸면 이 형태 자체가 없어져 안전합니다.
  --   (error.md #27)
  select fr.run_id,
         coalesce(fr.finished_at, fr.started_at) as run_at,
         fr.is_stale
    from analytics.v_forecast_run fr
   where fr.status = 'SUCCESS'
   order by case when fr.mode = 'PRODUCTION' then 0 else 1 end,
            fr.started_at desc
   limit 1
),
dc as (
  select cov.data_end
    from analytics.v_data_coverage cov
   limit 1
)
select
  -- ── ① 예측 품질 ────────────────────────────────────────────
  -- WAPE = Σ|A−F| / ΣA 이므로 비율입니다(sql/13 §5). 정확도도 비율입니다 —
  -- 0.87 이 87% 입니다. 화면에서 100 을 한 번만 곱하세요.
  case when bk.avg_wape is null then null
       else round(1 - bk.avg_wape, 4) end          as forecast_accuracy,
  bk.avg_wape                                      as avg_wape,
  -- null 인 이유를 화면이 말할 수 있게 함께 내립니다. 0 이면 아직 백테스트 전입니다.
  bk.n_champions                                   as n_champions,
  ch.avg_bias                                      as forecast_bias,
  ch.n_bias_items                                  as n_bias_items,

  -- ── ② 재고 위험 ────────────────────────────────────────────
  (so.n_critical + so.n_warning)::int              as n_risk_items,
  so.n_critical::int                               as n_critical_items,
  so.n_warning::int                                as n_warning_items,
  so.n_within_30d::int                             as n_stockout_30d,
  so.n_within_60d::int                             as n_stockout_60d,
  so.n_items::int                                  as n_items,
  al.n_excess_inventory,
  al.n_delayed_open_po,

  -- ── ③ 발주 ─────────────────────────────────────────────────
  pr.n_order_needed::int                           as n_recommendations,
  pr.n_urgent::int                                 as n_urgent_orders,
  pr.total_recommended_qty                         as total_recommended_qty,
  pr.total_recommended_amount                      as total_recommended_amount,
  -- 단가가 없어 금액 합계에서 빠진 품목 수. 합계가 작아 보이는 이유를 화면이 밝힙니다.
  pr.n_missing_price::int                          as n_missing_price,
  ap.pending::int                                  as n_pending_approval,

  -- ── ④ 보조 ─────────────────────────────────────────────────
  ak.n_open::int                                   as n_open_alerts,
  ak.n_unacknowledged::int                         as n_unacknowledged_alerts,
  ak.last_scan_at                                  as last_scan_at,
  lr.run_id                                        as forecast_run_id,
  lr.run_at                                        as last_forecast_run_at,
  lr.is_stale                                      as forecast_is_stale,
  dc.data_end                                      as data_end
from bk
cross join ch
cross join so
cross join pr
cross join ap
cross join ak
cross join al
left join lr on true
left join dc on true;

comment on view analytics.v_dashboard_kpi is
  'renew.prd 28.1 — 대시보드 상단 KPI 12종. 항상 1행입니다. 비율(정확도 · Bias)은 0.87 = 87% 입니다';


-- ══ 3. 발주 우선순위 상위 10 ═══════════════════════════════════
--
-- renew.prd 28.2 "Purchase Priority".
--
-- 발주가 필요한 품목(final_recommended_qty > 0)만, 발주 권고일이 이른 순입니다.
-- 권고일이 없는 품목(리드타임 미확정 등)은 맨 뒤로 보냅니다 — null 을 오늘로 읽으면
-- 산출하지 못한 품목이 가장 급한 것처럼 목록 맨 위에 섭니다 (design.md §8.2).

create view analytics.v_dashboard_purchase_priority as
select r.item_id,
       r.item_name,
       r.supplier_id,
       r.supplier_name,
       r.risk,
       r.reason_code,
       r.required_order_date,
       r.is_urgent,
       r.stockout_date,
       r.final_recommended_qty,
       r.unit_price,
       r.recommended_amount
  from analytics.v_purchase_recommendation r
 where r.final_recommended_qty > 0
 order by r.required_order_date asc nulls last,
          r.final_recommended_qty desc nulls last,
          r.item_id
 limit 10;

comment on view analytics.v_dashboard_purchase_priority is
  'renew.prd 28.2 — 발주 권고일이 이른 상위 10. 권고일이 없는 품목은 맨 뒤입니다';


-- ══ 4. 예측 정확도 랭킹 ════════════════════════════════════════
--
-- renew.prd 28.2 "Forecast Accuracy Ranking".
--
-- 화면은 좋은 5 · 나쁜 5 두 열로 자릅니다. 자르는 기준을 SQL 이 내려 주므로
-- 화면은 rank_best <= 5 · rank_worst <= 5 로 거르기만 합니다 (AGENTS.md 규칙 2).
--
-- ★ WAPE 가 없는 품목은 넣지 않습니다. 정확도를 모르는 품목의 순위는 뜻이 없고,
--   null 을 0 으로 읽으면 "가장 정확한 품목" 자리를 차지합니다.
--   빠진 품목이 몇 개인지는 v_dashboard_kpi.n_champions 와 비교하면 드러납니다.
--
-- ★ bar_pct 는 화면이 CSS 폭으로 그릴 값입니다(0–100). 차트가 아니라 막대 한 줄이라
--   recharts 를 쓰지 않지만, 폭을 정하는 나눗셈은 계산이므로 여기서 끝냅니다.
--   가장 나쁜 품목이 100% 이고 나머지는 그에 대한 상대 폭입니다.

create view analytics.v_dashboard_accuracy_ranking as
with ranked as (
  select c.item_id,
         c.item_name,
         c.champion_model_id,
         c.model_name,
         c.wape,
         c.bias,
         c.selection_method,
         -- 동점이 있어도 5개를 정확히 자를 수 있도록 rank() 가 아니라 row_number() 입니다.
         -- item_id 를 두 번째 정렬 키로 두어 재실행해도 같은 순서가 나옵니다.
         row_number() over (order by c.wape asc,  c.item_id asc)  as rank_best,
         row_number() over (order by c.wape desc, c.item_id desc) as rank_worst,
         (count(*) over ())::int                                  as n_ranked,
         max(c.wape) over ()                                      as max_wape
    from analytics.v_champion_model c
   where c.wape is not null
)
select r.item_id,
       r.item_name,
       r.champion_model_id,
       r.model_name,
       r.wape,
       r.bias,
       r.selection_method,
       r.rank_best::int  as rank_best,
       r.rank_worst::int as rank_worst,
       r.n_ranked,
       case when r.max_wape is null or r.max_wape <= 0 then null
            else round(r.wape / r.max_wape * 100, 1) end as bar_pct
  from ranked r
 order by r.rank_best;

comment on view analytics.v_dashboard_accuracy_ranking is
  'renew.prd 28.2 — Champion 을 WAPE 순으로. 화면은 rank_best/rank_worst 로 5개씩 자릅니다';


-- ══ 5. Open PO 위험 ════════════════════════════════════════════
--
-- renew.prd 28.2 "Open PO Risk".
--
-- 진행 중(IN_TRANSIT) 선적 중 예정일이 이미 지났거나 7일 안에 닥치는 것입니다.
--
-- ★ 7일은 정책값이 아니라 이 패널이 내다보는 창입니다. 발주 지연 "알림" 의 임계값은
--   core.policy_config 의 ALERT_PO_DELAY_DAYS 이고 sql/20 의 룰 6 이 그것을 씁니다.
--   여기서 그 키를 다시 읽으면 "임박한 것도 보여 주는 패널" 이 "이미 늦은 것만 보는 패널" 이
--   되어 버립니다 — 두 값은 뜻이 다릅니다. 창을 넓히려면 이 숫자를 바꾸세요.
--
-- ★ 품목 단위로 묶습니다. sql/20 의 po_delay 룰과 같은 묶음이라 알림 건수와 이 표의
--   줄 수가 어긋나지 않습니다. core.v_fact_shipment 의 선적 단위 식별자를 쓰지 않는
--   이유이기도 합니다 — 덤프에서 온 뷰라 컬럼을 가정하지 않습니다.

create view analytics.v_dashboard_open_po_risk as
with pend as (
  select s.item_id,
         max(s.supplier_id)                          as supplier_id,
         (count(*))::int                             as n_shipments,
         min(s.due_date)                             as earliest_due_date,
         -- 양수면 지난 일수, 음수면 남은 일수입니다.
         (max(current_date - s.due_date))::int       as days_late,
         sum(s.qty)                                  as open_qty
    from core.v_fact_shipment s
   where s.status = 'IN_TRANSIT'
     and s.due_date is not null
     and s.due_date <= current_date + 7
   group by s.item_id
)
select p.item_id,
       im.item_name,
       p.supplier_id,
       sm."공급업체명" as supplier_name,
       p.n_shipments,
       p.earliest_due_date,
       p.days_late,
       p.open_qty,
       (p.days_late > 0) as is_late
  from pend p
  left join core.v_item_master im on im.item_id = p.item_id
  left join raw.supplier_master sm on sm."공급업체코드" = p.supplier_id
 order by p.days_late desc, p.earliest_due_date asc, p.item_id
 limit 20;

comment on view analytics.v_dashboard_open_po_risk is
  'renew.prd 28.2 — 진행 중 선적 중 예정일 경과(days_late > 0) 또는 7일 이내. 품목 단위';


-- ══ 6. 최근 승인 ═══════════════════════════════════════════════
--
-- renew.prd 28.2 "Recent Approvals". 대체된(SUPERSEDED) 결정도 그대로 둡니다 —
-- "누가 언제 무엇을 결정했나" 가 이력이고, 지금 유효한지는 is_active 가 말합니다.

create view analytics.v_dashboard_recent_approvals as
select a.approval_id,
       a.item_id,
       a.item_name,
       a.decision,
       a.reason_code,
       a.reason_text,
       a.recommended_qty,
       a.approved_qty,
       a.adjustment,
       a.approved_email,
       a.approved_at,
       a.status,
       a.is_active
  from analytics.v_approval a
 order by a.approved_at desc nulls last, a.approval_id desc
 limit 10;

comment on view analytics.v_dashboard_recent_approvals is
  'renew.prd 28.2 — 최근 결정 10건. 대체된 결정도 포함합니다';


-- ══ 7. 스파크라인 재료 ═════════════════════════════════════════
--
-- renew.prd 28.2 의 발주 우선순위 표 안에 들어갈 소형 선입니다.
-- 최근 12개월 실적(ACTUAL) + 향후 3개월 Consensus(FORECAST) 를 한 품목의 한 줄로 잇습니다.
--
-- ★ 기준점은 오늘이 아니라 "실적이 있는 마지막 달" 입니다.
--   적재가 두 달 밀린 데이터에서 오늘을 기준으로 12개월을 자르면 앞 두 칸이 빈 채로
--   그려져 수요가 갑자기 끊긴 것처럼 보입니다.
--
-- ★ 없는 달을 0 으로 채우지 않습니다. 실적이 없는 달은 행이 없고, 선이 그 사이를
--   잇습니다. 0 을 채우면 "그 달에 안 썼다" 와 "그 달 데이터가 없다" 가 같아집니다.

create view analytics.v_dashboard_sparkline as
with bound as (
  -- 집계라 항상 1행입니다. 실적이 하나도 없으면 last_actual 이 null 입니다.
  select max(u.period) as last_actual
    from core.v_usage_monthly u
),
act as (
  select u.item_id,
         u.period,
         'ACTUAL'::text as kind,
         u.quantity     as qty
    from core.v_usage_monthly u
    cross join bound b
   where b.last_actual is not null
     and u.period >  (b.last_actual - interval '12 months')::date
     and u.period <=  b.last_actual
),
fc as (
  select c.item_id,
         c.period,
         'FORECAST'::text as kind,
         c.consensus_qty  as qty
    from core.v_consensus_forecast c
    cross join bound b
   where c.period >  coalesce(b.last_actual, date_trunc('month', current_date)::date)
     and c.period <= (coalesce(b.last_actual, date_trunc('month', current_date)::date)
                      + interval '3 months')::date
)
select a.item_id, a.period, a.kind, a.qty from act a
union all
select f.item_id, f.period, f.kind, f.qty from fc f
order by 1, 2;

comment on view analytics.v_dashboard_sparkline is
  'renew.prd 28.2 — 품목별 최근 12개월 실적 + 향후 3개월 Consensus. kind 는 ACTUAL | FORECAST';


-- ══ 8. 권한 ════════════════════════════════════════════════════
--
-- analytics 뷰는 로그인 사용자에게 select 만 엽니다 (sql/13 §8 과 같은 패턴).

grant select on analytics.v_dashboard_kpi                to authenticated;
grant select on analytics.v_dashboard_purchase_priority  to authenticated;
grant select on analytics.v_dashboard_accuracy_ranking   to authenticated;
grant select on analytics.v_dashboard_open_po_risk       to authenticated;
grant select on analytics.v_dashboard_recent_approvals   to authenticated;
grant select on analytics.v_dashboard_sparkline          to authenticated;


-- ══ 9. 확인 ════════════════════════════════════════════════════
--
-- ① KPI 는 정확히 1행이어야 합니다. 0행이면 재료 뷰 하나가 0행이라는 뜻입니다.
select count(*) as kpi_rows from analytics.v_dashboard_kpi;

-- ② 12종이 실제로 채워졌는지. null 은 "아직 계산 못 함" 이고 0 과 다릅니다.
select forecast_accuracy,
       forecast_bias,
       n_risk_items,
       n_stockout_30d,
       n_stockout_60d,
       n_excess_inventory,
       n_delayed_open_po,
       n_recommendations,
       n_urgent_orders,
       total_recommended_qty,
       total_recommended_amount,
       n_pending_approval,
       forecast_run_id,
       forecast_is_stale,
       data_end
  from analytics.v_dashboard_kpi;

-- ③ 하단 위젯의 행 수. 데이터가 없으면 0 이어도 정상입니다.
select 'purchase_priority' as widget, count(*) from analytics.v_dashboard_purchase_priority
union all select 'accuracy_ranking',  count(*) from analytics.v_dashboard_accuracy_ranking
union all select 'open_po_risk',      count(*) from analytics.v_dashboard_open_po_risk
union all select 'recent_approvals',  count(*) from analytics.v_dashboard_recent_approvals
union all select 'sparkline',         count(*) from analytics.v_dashboard_sparkline;

-- ④ 정확도 랭킹의 양 끝. 좋은 5 와 나쁜 5 가 겹치면 Champion 이 10개 미만입니다.
select rank_best, rank_worst, item_id, wape, bar_pct
  from analytics.v_dashboard_accuracy_ranking
 where rank_best <= 5 or rank_worst <= 5
 order by rank_best;

-- ⑤ 스파크라인이 한 품목에서 실적 → 예측으로 이어지는지.
select item_id, kind, count(*) as n, min(period) as from_period, max(period) as to_period
  from analytics.v_dashboard_sparkline
 group by item_id, kind
 order by item_id, kind
 limit 20;
