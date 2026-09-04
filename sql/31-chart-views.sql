-- ★ 영업 가림막 — v_chart_recommendation_by_supplier · v_chart_order_calendar · v_chart_champion_share 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- 차트 집계 뷰 — docs/superpowers/specs/2026-09-04-screen-charts-design.md §3.2
--
-- ★ 이 파일은 새 계산을 하지 않습니다. 앞 파일이 만든 뷰를 기간 · 공급처 · 유형으로
--   묶어 합계와 건수를 낼 뿐입니다. 표와 차트가 같은 숫자를 말하도록 화면은 계산하지 않고
--   여기서만 냅니다 (AGENTS.md 규칙 2).
--
-- 여기서 만드는 것 (전부 analytics)
--   v_chart_demand_trend                 기간별 실적 · Consensus 합계 (대시보드 ①)
--   v_chart_recommendation_by_supplier   공급처별 추천 건수 · 수량 · 금액 (대시보드 ③ · 발주 추천)
--   v_chart_alert_by_type                열린 알림 유형 × 심각도 (대시보드 ⑤ · 알림)
--   v_chart_alert_daily                  최근 30일 일별 발생 · 해결 (알림)
--   v_chart_approval_monthly             최근 6개월 월별 결정 (대시보드 ⑥ · 결정 이력)
--   v_chart_champion_share               모델별 Champion 점유 (모델 평가)
--   v_chart_order_calendar               발주 권고일 주별 건수 · 금액 (발주 추천)
--   v_chart_projection_total             기간별 전체 재고 전개 합계 (재고 전개)
--   v_chart_usage_heatmap                품목 × 월 사용량 12개월, 상위 40품목 (수요 프로파일)
--   v_chart_sales_status                 판매 공급 상태별 품목 수 (판매)
--
-- ★ sql/23-atp-sales.sql 까지 먼저 실행하세요. 읽는 것은 전부 그 앞 파일들이 만듭니다.
--     analytics.v_dashboard_sparkline (21) · v_purchase_recommendation (16) · core.alert (20)
--     core.approval (19) · core.champion_model · core.model_config (13) · v_inventory_projection (15)
--     core.v_usage_monthly (17) · core.v_item_master (덤프) · v_sales_supply_status (23)
--
-- ★ 재실행해도 안전합니다. drop → create 순서입니다. 이 뷰 위에 뷰를 만드는 파일은 없으므로
--   혼자 다시 실행해도 됩니다. 다만 뒤에 29 → 28 을 이어서 실행하세요 (가림막 · 권한).
-- ★ 앞 파일(15 · 16 · 19 · 20 · 21 · 23)을 다시 실행하면 cascade 로 이 뷰들이 함께 지워집니다.
--   그때는 이 파일을 다시 실행하세요.
-- ──────────────────────────────────────────────────────────────


-- ══ 1. 정리 ════════════════════════════════════════════════════

drop view if exists analytics.v_chart_demand_trend               cascade;
drop view if exists analytics.v_chart_recommendation_by_supplier cascade;
drop view if exists analytics.v_chart_alert_by_type              cascade;
drop view if exists analytics.v_chart_alert_daily                cascade;
drop view if exists analytics.v_chart_approval_monthly           cascade;
drop view if exists analytics.v_chart_champion_share             cascade;
drop view if exists analytics.v_chart_order_calendar             cascade;
drop view if exists analytics.v_chart_projection_total           cascade;
drop view if exists analytics.v_chart_usage_heatmap              cascade;
drop view if exists analytics.v_chart_sales_status               cascade;


-- ══ 2. 수요 추이 — 대시보드 ① ═══════════════════════════════════
--
-- v_dashboard_sparkline 은 품목별 최근 12개월 실적 + 향후 3개월 Consensus 입니다.
-- 그것을 기간 · 종류로 합칩니다. n_items 는 그 기간에 값이 있는 품목 수입니다 —
-- 실적 12개월과 예측 3개월의 품목 수가 다르면 합계가 어긋나 보일 수 있어 함께 냅니다.

create view analytics.v_chart_demand_trend as
select s.period,
       s.kind,
       sum(s.qty)                                   as qty,
       count(*) filter (where s.qty is not null)::int as n_items
  from analytics.v_dashboard_sparkline s
 group by s.period, s.kind
 order by s.period, s.kind
 limit 100;


-- ══ 3. 공급처별 추천 — 대시보드 ③ · 발주 추천 ═══════════════════
--
-- 추천 수량이 0보다 큰 품목만 셉니다 (발주 우선순위 표와 같은 조건).
-- total_amount 는 단가가 있는 품목만 더합니다. 단가 없는 품목 수는 n_missing_price 로
-- 따로 냅니다 — "금액 0원" 과 "단가 없음" 은 다릅니다 (design.md §8.2).

create view analytics.v_chart_recommendation_by_supplier as
select r.supplier_id,
       max(r.supplier_name)                                              as supplier_name,
       count(*)::int                                                     as n_items,
       count(*) filter (where r.is_urgent = true)::int                   as n_urgent,
       sum(r.final_recommended_qty)                                      as total_qty,
       sum(r.recommended_amount) filter (where r.unit_price is not null) as total_amount,
       count(*) filter (where r.unit_price is null)::int                 as n_missing_price
  from analytics.v_purchase_recommendation r
 where r.final_recommended_qty > 0
 group by r.supplier_id
 order by total_amount desc nulls last, total_qty desc
 limit 50;


-- ══ 4. 알림 — 대시보드 ⑤ · 알림 ═══════════════════════════════

-- 열린 알림만. 유형 라벨은 core.alert_type_label() 한 곳에서 옵니다.
create view analytics.v_chart_alert_by_type as
select a.type,
       core.alert_type_label(a.type)                              as type_label,
       a.severity,
       count(*)::int                                              as n_open,
       count(*) filter (where a.acknowledged_at is null)::int     as n_unacknowledged
  from core.alert a
 where a.resolved_at is null
 group by a.type, a.severity
 order by a.type, a.severity
 limit 100;

-- 최근 30일. 알림이 없는 날도 0 으로 나와야 선이 끊기지 않으므로 날짜를 먼저 만듭니다.
-- 날짜는 한국 시간 기준입니다.
create view analytics.v_chart_alert_daily as
with days as (
  select generate_series(current_date - 29, current_date, interval '1 day')::date as day
)
select d.day,
       (select count(*) from core.alert a
         where (a.detected_at at time zone 'Asia/Seoul')::date = d.day)::int as n_detected,
       (select count(*) from core.alert a
         where a.resolved_at is not null
           and (a.resolved_at at time zone 'Asia/Seoul')::date = d.day)::int as n_resolved
  from days d
 order by d.day
 limit 31;


-- ══ 5. 월별 결정 — 대시보드 ⑥ · 결정 이력 ═════════════════════
--
-- 결정 넷 — APPROVED(추천대로) · ADJUSTED(승인이되 수량을 바꿈) · REJECTED · DEFERRED.
-- ADJUSTED 는 core.approval 의 decision 이 아니라 adjustment <> 0 인 승인입니다.
-- 결정이 없는 달도 0 으로 나오도록 달 × 결정을 먼저 만듭니다.

create view analytics.v_chart_approval_monthly as
with months as (
  select (date_trunc('month', current_date) - (interval '1 month' * g))::date as month
    from generate_series(0, 5) g
),
decisions as (
  select unnest(array['APPROVED', 'ADJUSTED', 'REJECTED', 'DEFERRED']) as decision
),
classified as (
  select date_trunc('month', a.approved_at at time zone 'Asia/Seoul')::date as month,
         case when a.decision = 'APPROVED' and coalesce(a.adjustment, 0) <> 0 then 'ADJUSTED'
              else a.decision end as decision
    from core.approval a
)
select m.month,
       d.decision,
       (select count(*) from classified c
         where c.month = m.month and c.decision = d.decision)::int as n
  from months m
 cross join decisions d
 order by m.month, d.decision
 limit 30;


-- ══ 6. 모델별 Champion 점유 — 모델 평가 ═══════════════════════

create view analytics.v_chart_champion_share as
select c.champion_model_id                                          as model_id,
       m.model_name,
       count(*)::int                                                as n_items,
       count(*) filter (where c.selection_method = 'MANUAL')::int   as n_manual,
       round(avg(c.wape), 4)                                        as avg_wape
  from core.champion_model c
  left join core.model_config m on m.model_id = c.champion_model_id
 where c.champion_model_id is not null
 group by c.champion_model_id, m.model_name
 order by n_items desc, c.champion_model_id
 limit 50;


-- ══ 7. 발주 권고일 캘린더 — 발주 추천 ═════════════════════════
--
-- 주 시작은 월요일입니다 (date_trunc('week')).

create view analytics.v_chart_order_calendar as
select date_trunc('week', r.required_order_date)::date                  as week_start,
       count(*)::int                                                     as n_items,
       count(*) filter (where r.is_urgent = true)::int                   as n_urgent,
       sum(r.final_recommended_qty)                                      as total_qty,
       sum(r.recommended_amount) filter (where r.unit_price is not null) as total_amount
  from analytics.v_purchase_recommendation r
 where r.required_order_date is not null
   and r.final_recommended_qty > 0
 group by 1
 order by 1
 limit 60;


-- ══ 8. 전체 재고 전개 합계 — 재고 전개 ════════════════════════

create view analytics.v_chart_projection_total as
select p.period,
       sum(p.closing_qty)                                   as total_closing,
       sum(p.receipt_qty)                                   as total_receipt,
       sum(p.demand_qty)                                    as total_demand,
       count(*) filter (where p.closing_qty < 0)::int       as n_stockout_items,
       count(distinct p.item_id)::int                       as n_items
  from analytics.v_inventory_projection p
 group by p.period
 order by p.period
 limit 60;


-- ══ 9. 품목 × 월 사용량 히트맵 — 수요 프로파일 ════════════════
--
-- 최근 12개월, 총량 상위 40품목. 40 × 12 = 480행이라 1,000행 상한 아래입니다.

create view analytics.v_chart_usage_heatmap as
with bound as (
  select max(u.period) as last_actual from core.v_usage_monthly u
),
top as (
  select u.item_id, sum(u.quantity) as total
    from core.v_usage_monthly u
   cross join bound b
   where u.period > (b.last_actual - interval '12 months')::date
   group by u.item_id
   order by total desc
   limit 40
)
select u.item_id,
       im.item_name,
       u.period,
       u.quantity as qty
  from core.v_usage_monthly u
  join top t on t.item_id = u.item_id
  cross join bound b
  left join core.v_item_master im on im.item_id = u.item_id
 where u.period > (b.last_actual - interval '12 months')::date
 order by u.item_id, u.period
 limit 600;


-- ══ 10. 판매 공급 상태 — 판매 ══════════════════════════════════

create view analytics.v_chart_sales_status as
select s.status,
       count(*)::int as n_items
  from analytics.v_sales_supply_status s
 group by s.status
 order by n_items desc, s.status
 limit 20;


-- ══ 11. 권한 ═══════════════════════════════════════════════════

do $$
declare v text;
begin
  foreach v in array array[
    'v_chart_demand_trend', 'v_chart_recommendation_by_supplier', 'v_chart_alert_by_type',
    'v_chart_alert_daily', 'v_chart_approval_monthly', 'v_chart_champion_share',
    'v_chart_order_calendar', 'v_chart_projection_total', 'v_chart_usage_heatmap',
    'v_chart_sales_status'
  ] loop
    execute format('grant select on analytics.%I to authenticated', v);
    execute format('revoke all on analytics.%I from anon', v);
  end loop;
end $$;


-- ══ 12. 확인 ═══════════════════════════════════════════════════
--
-- 행 수만 봅니다. 무거운 확인은 하네스에서 합니다 (error.md #28).

select 'demand_trend' as chart, count(*) from analytics.v_chart_demand_trend
union all select 'recommendation_by_supplier', count(*) from analytics.v_chart_recommendation_by_supplier
union all select 'alert_by_type',      count(*) from analytics.v_chart_alert_by_type
union all select 'alert_daily',        count(*) from analytics.v_chart_alert_daily
union all select 'approval_monthly',   count(*) from analytics.v_chart_approval_monthly
union all select 'champion_share',     count(*) from analytics.v_chart_champion_share
union all select 'order_calendar',     count(*) from analytics.v_chart_order_calendar
union all select 'projection_total',   count(*) from analytics.v_chart_projection_total
union all select 'usage_heatmap',      count(*) from analytics.v_chart_usage_heatmap
union all select 'sales_status',       count(*) from analytics.v_chart_sales_status;
