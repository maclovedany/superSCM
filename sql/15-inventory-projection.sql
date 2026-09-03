-- ★ 영업 가림막 — core.v_leadtime_effective · analytics.v_stockout_risk 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- ★ core.v_ai_forecast 의 최종 정의는 sql/27-admin-ops.sql 입니다
--   (운영 PRODUCTION 실행을 먼저 고름). 이 파일을 다시 실행했다면 sql/27 도 이어서 실행하세요.
-- STEP 9 · 리드타임 정책화 + Inventory Projection 재작성
--
-- renew.prd 17.1(Consensus 구조) · 18장(Lead Time) · 19장(Inventory Projection) · 20장(Stockout Risk)
--   "확정값이 있으면 그 값 사용, 없으면 실적 P80. 이 값을 변경하면 코드 수정 없이
--    모든 판정이 즉시 반영되어야 한다."                        (18.3)
--   "Projected Inventory = 가용재고 + 입고예정 − 가예약 − 확정수주 − 예측수요"  (19.1)
--   "계획 리드타임이 42일이면 42일 이후까지 커버해야 하는 누적 수요를 기준으로
--    필요량을 계산한다."                                         (19.3)
--
-- 여기서 만드는 것
--   core       leadtime_plan_history      계획 리드타임 변경 이력
--   core       set_leadtime_plan()        확정/해제 (사유 필수 · 관리자 전용)
--   core       forecast_override          Override 테이블 (화면은 STEP 12)
--   core       v_ai_forecast              최근 성공 실행 × 품목별 Champion/기본 모델
--   core       v_consensus_forecast       AI + Override = Consensus
--   analytics  v_leadtime_policy · v_leadtime_plan_history
--   analytics  v_inventory_projection ★   품목 × 미래 기간 재고 전개
--   analytics  v_stockout_risk ★          4상태로 재작성
--   analytics  v_stockout_kpi · v_projection_item
--
-- sql/13-backtest.sql 까지 먼저 실행하세요.
--
-- ★ 정책값(검토 주기 · 여유일)은 core.policy_config 에서 읽습니다.
--   이 파일에 숫자를 적지 않습니다 (AGENTS.md · renew.prd 32장).
--
-- ★★ 다시 실행할 때 (재실행 규칙) — 반드시 읽으세요
--
--   이 파일의 `drop view` 는 전부 **cascade** 입니다. cascade 가 없으면 뒤 번호
--   파일이 이 파일의 뷰 위에 뷰를 만들어 둔 순간부터
--   "cannot drop … because other objects depend on it" 으로 재실행 자체가
--   막혔습니다. 그래서 cascade 를 붙였습니다.
--
--   대신 값을 치릅니다. cascade 는 **뒤 파일이 만든 뷰까지 말없이 함께 지웁니다.**
--   analytics.v_stockout_risk 하나를 지우면 sql/16 의 v_purchase_recommendation ·
--   v_purchase_recommendation_kpi, sql/19 의 v_sku_detail · v_approval_kpi ·
--   v_purchase_recommendation_with_approval, sql/21 의 v_dashboard_* 가 같이
--   사라집니다. v_stockout_kpi 는 sql/21 의 v_dashboard_kpi 를 데려갑니다.
--
--   그래서 규칙은 하나뿐입니다.
--
--       이 파일을 다시 실행했으면, 이 파일보다 번호가 큰 파일을 전부
--       순서대로 다시 실행하세요. (순서는 sql/README.md)
--
--   빠뜨리면 오류는 나지 않고 화면만 조용히 비어 보입니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 테이블 ══════════════════════════════════════════════════

-- renew.prd 11.4 — "설정 변경은 코드 수정 없이 반영되며 변경 이력을 남긴다."
-- 리드타임은 결품 판정을 통째로 바꾸는 값이라, 누가 왜 바꿨는지가 남아야 합니다.
create table if not exists core.leadtime_plan_history (
  id               bigserial primary key,
  supplier_id      text not null,
  lead_time_before int,
  lead_time_after  int,
  basis            text,
  reason           text not null,
  changed_by       uuid references auth.users(id) on delete set null,
  changed_email    text,
  changed_at       timestamptz not null default now()
);

create index if not exists leadtime_plan_history_supplier_idx
  on core.leadtime_plan_history(supplier_id, changed_at desc);

comment on table core.leadtime_plan_history is
  'renew.prd 18.3 — 계획 리드타임 변경 이력. 사유 없이 바꿀 수 없습니다';

-- renew.prd 17.1 · 17.2 — AI Forecast 원본은 보존하고 Override 를 따로 쌓습니다.
-- ★ 화면은 STEP 12 에서 만듭니다. 여기서는 스키마만 둡니다
--   (STEP 3 의 core.soft_allocation 과 같은 선례).
create table if not exists core.forecast_override (
  id                 bigserial primary key,
  item_id            text not null,
  period             date not null,
  run_id             text,
  ai_forecast        numeric,
  -- 증감입니다. 음수가 들어올 수 있습니다 (renew.prd 17.1 의 +300 / −300)
  override_qty       numeric,
  consensus_forecast numeric,
  -- 자유 텍스트만으로는 집계·분석이 불가능합니다 (renew.prd 17.2)
  reason_code        text not null
    check (reason_code in ('NEW_CONTRACT','PROMOTION','NEW_PRODUCT','DISCONTINUED',
                           'PROJECT','MARKET_CHANGE','DATA_ERROR','OTHER')),
  reason_text        text,
  created_by         uuid references auth.users(id) on delete set null,
  created_email      text,
  created_at         timestamptz not null default now(),
  -- null 이면 지금 유효한 Override 입니다.
  -- 같은 item × period 에 새 Override 가 오면 이전 행의 이 값을 채웁니다.
  superseded_at      timestamptz
);

-- 같은 품목·기간에 유효한 Override 는 하나뿐입니다.
create unique index if not exists forecast_override_current_idx
  on core.forecast_override(item_id, period) where superseded_at is null;

create index if not exists forecast_override_lookup_idx
  on core.forecast_override(item_id, period);

comment on table core.forecast_override is
  'renew.prd 17장 — Human Override. AI 예측 원본(core.forecast_result)은 수정하지 않습니다';

-- ══ 2. 함수 — 계획 리드타임 확정/해제 ══════════════════════════
--
-- renew.prd 18.3 — 확정값이 있으면 그 값, 없으면 실적 P80.
-- 해제(p_planned_lead_time = null)하면 core.leadtime_plan 행을 지워
-- core.v_leadtime_effective 가 다시 실적 P80 을 쓰게 됩니다.
--
-- 주의: 반환 컬럼 이름(ok · message)은 함수 안에서 변수가 됩니다.
--       본문에서 테이블 컬럼을 참조할 때는 항상 별칭을 붙입니다 (error.md #11).

create or replace function core.set_leadtime_plan(
  p_supplier_id       text,
  p_planned_lead_time int,
  p_reason            text
)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_before int;
  v_exists boolean;
  v_email  text;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다';
  end if;

  if p_supplier_id is null or btrim(p_supplier_id) = '' then
    return query select false, '공급처를 선택해주세요'::text;
    return;
  end if;

  -- renew.prd 11.4 — 사유 없이 정책값을 바꿀 수 없습니다.
  if p_reason is null or btrim(p_reason) = '' then
    return query select false, '사유를 반드시 입력해야 합니다'::text;
    return;
  end if;

  if p_planned_lead_time is not null and p_planned_lead_time <= 0 then
    return query select false, '리드타임은 1일 이상이어야 합니다'::text;
    return;
  end if;

  select exists (
    select 1 from raw.supplier_master s where s."공급업체코드" = p_supplier_id
  ) into v_exists;

  if not v_exists then
    return query select false, ('공급처 ' || p_supplier_id || ' 를 찾을 수 없습니다')::text;
    return;
  end if;

  select lp.planned_lead_time into v_before
    from core.leadtime_plan lp
   where lp.supplier_id = p_supplier_id;

  select au.email into v_email
    from core.app_user au
   where au.user_id = auth.uid();

  if p_planned_lead_time is null then
    -- 확정값 해제 — 실적 P80 으로 되돌아갑니다.
    if v_before is null then
      return query select false, '해제할 확정값이 없습니다'::text;
      return;
    end if;

    delete from core.leadtime_plan lp where lp.supplier_id = p_supplier_id;

    insert into core.leadtime_plan_history
      (supplier_id, lead_time_before, lead_time_after, basis, reason, changed_by, changed_email)
    values (p_supplier_id, v_before, null, 'RELEASED', p_reason, auth.uid(), v_email);

    return query select true,
      (p_supplier_id || ' 의 확정값을 해제했습니다. 실적 P80 을 사용합니다')::text;
    return;
  end if;

  insert into core.leadtime_plan
    (supplier_id, planned_lead_time, basis, confirmed_reason, confirmed_at)
  values (p_supplier_id, p_planned_lead_time, 'MANUAL', p_reason, now())
  on conflict (supplier_id) do update set
    planned_lead_time = excluded.planned_lead_time,
    basis             = 'MANUAL',
    confirmed_reason  = excluded.confirmed_reason,
    confirmed_at      = now();

  insert into core.leadtime_plan_history
    (supplier_id, lead_time_before, lead_time_after, basis, reason, changed_by, changed_email)
  values (p_supplier_id, v_before, p_planned_lead_time, 'MANUAL', p_reason, auth.uid(), v_email);

  return query select true,
    (p_supplier_id || ' 의 계획 리드타임을 ' || p_planned_lead_time || '일로 확정했습니다')::text;
end;
$$;

revoke all on function core.set_leadtime_plan(text, int, text) from public, anon;
grant execute on function core.set_leadtime_plan(text, int, text) to authenticated;

-- ══ 3. core 뷰 — AI 예측 · Consensus ═══════════════════════════
--
-- renew.prd 17.1 — AI Forecast + Human Override = Consensus Forecast.
--
-- 품목마다 어느 모델을 쓸지 먼저 정합니다.
--   Champion 이 이번 실행에 결과를 갖고 있으면 Champion (source='CHAMPION')
--   아니면 core.model_config.is_default 모델          (source='DEFAULT')

create or replace view core.v_ai_forecast as
with lr as (
  -- 가장 최근에 성공한 실행 하나만 봅니다.
  select r.run_id, r.data_snapshot_at
    from core.forecast_run r
   where r.status = 'SUCCESS'
   order by r.started_at desc
   limit 1
),
dm as (
  select m.model_id
    from core.model_config m
   where m.is_default
   order by m.model_id
   limit 1
),
avail as (
  -- 이번 실행에 결과가 있는 (품목 × 모델)
  select distinct f.item_id, f.model_id
    from core.forecast_result f
    join lr on lr.run_id = f.run_id
),
champ as (
  select a.item_id, a.model_id
    from avail a
    join core.champion_model c
      on c.item_id = a.item_id
     and c.champion_model_id = a.model_id
),
pick as (
  select i.item_id,
         coalesce(ch.model_id, d.model_id) as model_id,
         case when ch.model_id is not null then 'CHAMPION' else 'DEFAULT' end as source
    from (select distinct a.item_id from avail a) i
    left join champ ch on ch.item_id = i.item_id
    left join dm d on true
)
select lr.run_id,
       p.model_id,
       f.model_version,
       f.item_id,
       f.period,
       f.predicted_qty,
       f.p50,
       f.p80,
       f.p90,
       f.sigma,
       lr.data_snapshot_at,
       p.source
  from pick p
  cross join lr
  join core.forecast_result f
    on f.run_id = lr.run_id
   and f.item_id = p.item_id
   and f.model_id = p.model_id;

comment on view core.v_ai_forecast is
  'renew.prd 17.1 — 최근 성공 실행의 품목별 대표 예측. Champion 이 없으면 기본 모델을 씁니다';

create or replace view core.v_consensus_forecast as
select a.item_id,
       a.period,
       a.run_id,
       a.model_id,
       a.predicted_qty                                as ai_qty,
       o.override_qty                                 as override_qty,
       a.predicted_qty + coalesce(o.override_qty, 0)  as consensus_qty,
       a.p80,
       a.p90,
       a.sigma,
       (o.id is not null)                             as has_override,
       a.data_snapshot_at,
       -- STEP 9 의 재고 전개가 "무엇으로 계산했는지" 를 표시하려고 함께 내립니다.
       a.source                                       as forecast_source
  from core.v_ai_forecast a
  left join core.forecast_override o
    on o.item_id = a.item_id
   and o.period  = a.period
   and o.superseded_at is null;

comment on view core.v_consensus_forecast is
  'renew.prd 17.1 — Consensus = AI + Override. 재고 전개와 발주 추천이 이 값을 씁니다';

-- ══ 4. analytics 뷰 — 리드타임 정책 ════════════════════════════

create or replace view analytics.v_leadtime_policy as
select le.supplier_id,
       le.supplier_name,
       le.country,
       g.std_lead_time,
       le.n_samples,
       st.p50_days,
       le.p80_days,
       st.p90_days,
       st.std_days,
       st.confidence,
       le.planned_lead_time,
       le.effective_lead_time,
       le.source,
       lp.confirmed_reason,
       lp.confirmed_at,
       h.last_changed_at
  from core.v_leadtime_effective le
  left join core.v_leadtime_stat  st on st.supplier_id = le.supplier_id
  left join analytics.v_leadtime_gap g on g.supplier_id = le.supplier_id
  left join core.leadtime_plan     lp on lp.supplier_id = le.supplier_id
  left join (
    select lh.supplier_id, max(lh.changed_at) as last_changed_at
      from core.leadtime_plan_history lh
     group by lh.supplier_id
  ) h on h.supplier_id = le.supplier_id;

comment on view analytics.v_leadtime_policy is
  'renew.prd 18.3 — 공급처별 실적 분위수와 적용 중인 계획 리드타임';

create or replace view analytics.v_leadtime_plan_history as
select lh.id,
       lh.supplier_id,
       sm."공급업체명" as supplier_name,
       lh.lead_time_before,
       lh.lead_time_after,
       lh.basis,
       lh.reason,
       lh.changed_by,
       lh.changed_email,
       lh.changed_at
  from core.leadtime_plan_history lh
  left join raw.supplier_master sm on sm."공급업체코드" = lh.supplier_id;

-- ══ 5. analytics 뷰 — 재고 전개 ★ ══════════════════════════════
--
-- renew.prd 19.1
--   Projected Inventory = 가용재고 + 입고예정 − 가예약 − 확정수주 − 예측수요
--
-- ★ 확정 수주가 있으면 예측보다 우선합니다 (renew.prd 22.1).
--   둘을 더하면 같은 수요를 두 번 세게 되므로 기간마다 greatest 를 씁니다.
--
-- ★ forecast 가 없는 기간은 행을 만들지 않습니다. 전개가 거기서 끊깁니다.
--   임의 값으로 이어 붙이면 "언제 결품인지" 가 지어낸 숫자가 됩니다 (AGENTS.md 규칙 5).

drop view if exists analytics.v_projection_item cascade;
drop view if exists analytics.v_stockout_kpi cascade;
drop view if exists analytics.v_stockout_risk cascade;
drop view if exists analytics.v_inventory_projection cascade;

create view analytics.v_inventory_projection as
with cf as (
  -- 오늘이 속한 달부터. 지난 기간의 예측은 보지 않습니다.
  select c.item_id, c.period, c.run_id, c.model_id,
         c.consensus_qty, c.forecast_source, c.data_snapshot_at
    from core.v_consensus_forecast c
   where c.period >= date_trunc('month', current_date)::date
),
span as (
  select f.item_id, min(f.period) as first_period
    from cf f
   group by f.item_id
),
so as (
  -- 확정 수주. 품목코드는 core 뷰와 같은 규칙으로 정규화합니다.
  select upper(regexp_replace(coalesce(s.item_id, ''), '[\s\-_]', '', 'g')) as item_id,
         date_trunc('month', s.due_date)::date                              as period,
         sum(s.qty)                                                         as committed_qty
    from raw.sales_order s
   where s.status = 'CONFIRMED'
     and s.due_date is not null
   group by 1, 2
),
alloc as (
  -- 가예약. 유효기간이 지난 것은 이미 풀린 것으로 봅니다 (renew.prd 27.6).
  select upper(regexp_replace(coalesce(a.item_id, ''), '[\s\-_]', '', 'g')) as item_id,
         sum(a.qty)                                                        as soft_qty
    from core.soft_allocation a
   where a.status = 'RESERVED'
     and a.valid_until >= current_date
   group by 1
),
grid as (
  select f.item_id,
         im.item_name,
         im.supplier_id,
         f.period,
         row_number() over (partition by f.item_id order by f.period) as period_index,
         -- 재고 행이 없으면 0 으로 채우지 않습니다. null 로 두고 사유는 v_stockout_risk 가 냅니다.
         soh.current_stock,
         -- 입고예정은 ETA 가 속한 달에 넣습니다. ETA 가 오늘 이전이면 첫 기간입니다.
         case when ib.inbound_qty is not null
               and greatest(date_trunc('month', ib.earliest_eta)::date, sp.first_period) = f.period
              then ib.inbound_qty
              else 0 end                                              as receipt_qty,
         coalesce(f.consensus_qty, 0)                                  as forecast_qty,
         coalesce(so.committed_qty, 0)                                 as committed_so_qty,
         case when f.period = sp.first_period then coalesce(al.soft_qty, 0) else 0 end
                                                                       as soft_allocation_qty,
         f.forecast_source,
         f.run_id,
         f.data_snapshot_at
    from cf f
    join core.v_item_master im on im.item_id = f.item_id and im.is_active = 'Y'
    join span sp               on sp.item_id = f.item_id
    left join core.v_stock_on_hand soh on soh.item_id = f.item_id
    left join core.v_inbound_qty   ib  on ib.item_id  = f.item_id
    left join so                       on so.item_id  = f.item_id and so.period = f.period
    left join alloc al                 on al.item_id  = f.item_id
),
calc as (
  select g.*,
         greatest(g.forecast_qty, g.committed_so_qty) + g.soft_allocation_qty as demand_qty
    from grid g
)
select c.item_id,
       c.item_name,
       c.supplier_id,
       c.period,
       c.period_index::int                                            as period_index,
       -- 기초 = 현재고 + 이전 기간까지의 순증감. 재귀 CTE 없이 누적합으로 냅니다.
       c.current_stock
         + sum(c.receipt_qty - c.demand_qty) over w
         - (c.receipt_qty - c.demand_qty)                              as opening_qty,
       c.receipt_qty,
       c.forecast_qty,
       c.committed_so_qty,
       c.soft_allocation_qty,
       c.demand_qty,
       c.current_stock + sum(c.receipt_qty - c.demand_qty) over w      as closing_qty,
       sum(c.demand_qty) over w                                        as cumulative_demand_qty,
       c.forecast_source,
       c.run_id,
       c.data_snapshot_at
  from calc c
window w as (partition by c.item_id order by c.period
             rows between unbounded preceding and current row);

comment on view analytics.v_inventory_projection is
  'renew.prd 19.1 — 품목 × 미래 기간 재고 전개. forecast 가 없는 기간은 행이 없습니다';

-- ══ 6. analytics 뷰 — 결품 위험 ★ ══════════════════════════════
--
-- renew.prd 20.1 의 4상태. 임계값은 core.policy_config 에서 읽습니다.

create view analytics.v_stockout_risk as
with pol as (
  -- ★ 이 두 행을 core.policy_config 에서 지우지 마세요.
  --   값이 없으면 WARNING 대역이 사라져 주의 품목이 전부 SAFE 로 보입니다.
  --   0 으로 채우지 않는 이유가 그것입니다 — 조용히 좁아지는 대신 대역이 통째로 없어져야
  --   "정책값이 빠졌다" 를 알아챌 수 있습니다. 두 행은 sql/06-core-extend.sql 이 심습니다.
  select max(pc.value_num) filter (where pc.key = 'REVIEW_PERIOD_DAYS') as review_period_days,
         max(pc.value_num) filter (where pc.key = 'SAFETY_BUFFER_DAYS') as safety_buffer_days
    from core.policy_config pc
),
item as (
  select i.item_id, i.item_name, i.supplier_id
    from core.v_item_master i
   where i.is_active = 'Y'
),
proj as (
  select p.item_id,
         count(*)                                            as n_periods,
         count(p.closing_qty)                                as n_valued,
         max(p.run_id)                                       as run_id,
         max(p.forecast_source)                              as forecast_source,
         max(p.data_snapshot_at)                             as data_snapshot_at
    from analytics.v_inventory_projection p
   group by p.item_id
),
neg as (
  -- 기말이 처음 음수가 되는 기간. 그 달 안에서 선형 보간합니다.
  -- demand_qty = 0 인 기간은 그 달 안에서 줄어들지 않으므로 결품 시점이 아닙니다.
  select distinct on (p.item_id)
         p.item_id,
         p.period       as first_negative_period,
         p.period_index as first_negative_index,
         p.opening_qty,
         p.receipt_qty,
         p.demand_qty
    from analytics.v_inventory_projection p
   where p.closing_qty < 0
     and p.demand_qty > 0
   order by p.item_id, p.period
),
dated as (
  -- 그 달에 쓸 수 있는 재고는 기초 + 그 달 입고입니다.
  -- 기말 공식(기초 + 입고 − 수요)이 입고를 월초 도착으로 보므로 보간도 같게 봅니다.
  -- 분자에서 입고를 빼면 배가 그 달에 도착하는데도 결품일이 앞당겨져,
  -- 주의로 충분한 품목이 위험으로 올라갑니다.
  select n.item_id,
         n.first_negative_period,
         n.first_negative_index,
         (n.first_negative_period
          + greatest(0, floor((n.opening_qty + n.receipt_qty)
              / (n.demand_qty
                 / ((n.first_negative_period + interval '1 month')::date
                    - n.first_negative_period)::numeric)))::int)::date as stockout_date
    from neg n
),
horizon as (
  -- 오늘부터 (계획 리드타임 + 검토 주기) 일까지가 커버해야 하는 구간입니다 (renew.prd 19.3).
  select im.item_id,
         (current_date
          + (le.effective_lead_time + pol.review_period_days)::int) as horizon_end
    from core.v_item_master im
    cross join pol
    join core.v_leadtime_effective le on le.supplier_id = im.supplier_id
   where le.effective_lead_time is not null
     and pol.review_period_days is not null
),
lt as (
  -- 월 단위 전개를 기간 일수에 비례해 일 단위로 안분해 더합니다.
  select p.item_id,
         sum(p.demand_qty
             * greatest(0,
                 least(h.horizon_end, (p.period + interval '1 month')::date - 1)
                 - greatest(current_date, p.period) + 1)::numeric
             / ((p.period + interval '1 month')::date - p.period)::numeric)
           as leadtime_demand_qty
    from analytics.v_inventory_projection p
    join horizon h on h.item_id = p.item_id
   group by p.item_id
),
base as (
  select it.item_id,
         it.item_name,
         it.supplier_id,
         soh.current_stock,
         ib.inbound_qty,
         ue.daily_usage_avg,
         ue.cv,
         le.effective_lead_time,
         dp.demand_type,
         pr.n_periods,
         pr.n_valued,
         pr.run_id,
         pr.forecast_source,
         pr.data_snapshot_at,
         d.first_negative_period,
         d.first_negative_index,
         d.stockout_date,
         lt.leadtime_demand_qty,
         pol.review_period_days,
         pol.safety_buffer_days
    from item it
    cross join pol
    left join core.v_stock_on_hand      soh on soh.item_id = it.item_id
    left join core.v_inbound_qty        ib  on ib.item_id  = it.item_id
    left join core.v_usage_effective    ue  on ue.item_id  = it.item_id
    left join core.v_leadtime_effective le  on le.supplier_id = it.supplier_id
    left join analytics.v_sku_demand_profile dp on dp.item_id = it.item_id
    left join proj  pr on pr.item_id = it.item_id
    left join dated d  on d.item_id  = it.item_id
    left join lt       on lt.item_id = it.item_id
),
scored as (
  select b.*,
         (b.stockout_date - current_date)::numeric as stockout_days_calc,
         -- renew.prd 20.2 의 우선순위. 하나라도 걸리면 판정하지 않습니다.
         case
           when b.current_stock is null            then 'NO_INVENTORY_DATA'
           when b.effective_lead_time is null      then 'NO_LEADTIME'
           when coalesce(b.n_periods, 0) = 0       then 'NO_FORECAST'
           when b.demand_type = 'NO_DEMAND'        then 'NO_USAGE_HISTORY'
           when coalesce(b.n_valued, 0) = 0        then 'INSUFFICIENT_SAMPLE'
           else null
         end as reason_calc
    from base b
)
select s.item_id,
       s.item_name,
       s.supplier_id,
       -- 재고 행이 없으면 0 이 아니라 null 입니다. "재고가 0" 과 "모른다" 는 다릅니다
       -- (AGENTS.md 규칙 5). 사유는 아래 reason 이 NO_INVENTORY_DATA 로 알립니다.
       s.current_stock,
       -- 진행 중 선적이 없는 것은 진짜 0 입니다. 이건 채웁니다.
       coalesce(s.inbound_qty, 0)                               as inbound_qty,
       s.current_stock + coalesce(s.inbound_qty, 0)             as available_qty,
       s.daily_usage_avg,
       s.cv,
       s.effective_lead_time                                    as planned_lead_time,
       case when s.reason_calc is null then s.stockout_days_calc end as stockout_days,
       case when s.reason_calc is null then s.stockout_date end      as stockout_date,
       case
         when s.reason_calc is not null then 'CALCULATION_UNAVAILABLE'
         when s.stockout_days_calc is null then 'SAFE'
         when s.stockout_days_calc < s.effective_lead_time::numeric then 'CRITICAL'
         -- 정책값이 없으면 이 비교가 null 이라 WARNING 대역만 건너뜁니다 (pol 주석 참조).
         when s.stockout_days_calc < s.effective_lead_time::numeric
                                     + s.review_period_days
                                     + s.safety_buffer_days then 'WARNING'
         else 'SAFE'
       end                                                      as risk_status,
       s.reason_calc                                            as reason,
       -- ── STEP 9 에서 더한 컬럼 ──
       s.run_id,
       s.forecast_source,
       s.data_snapshot_at,
       case when s.reason_calc is null then s.first_negative_period end as first_negative_period,
       case when s.reason_calc is null then s.stockout_days_calc end    as days_of_supply,
       case when s.reason_calc is null
            then coalesce(s.first_negative_index - 1, s.n_periods)::int end as months_of_supply,
       -- 판정하지 못한 품목은 이 두 값도 내지 않습니다.
       -- 소진까지가 — 인데 필요량만 숫자로 서 있으면 판정한 것처럼 읽힙니다 (design.md §8.2).
       case when s.reason_calc is null then s.leadtime_demand_qty end as leadtime_demand_qty,
       -- 필요량 = 커버해야 하는 누적 수요 − 가용재고 (renew.prd 19.3). 음수면 0 입니다.
       -- 가용재고를 모르면 필요량도 모릅니다. 0 으로 채우지 않습니다.
       case when s.reason_calc is not null
              or s.leadtime_demand_qty is null
              or s.current_stock is null then null
            else greatest(s.leadtime_demand_qty
                          - (s.current_stock + coalesce(s.inbound_qty, 0)), 0)
       end                                                      as required_qty
  from scored s;

comment on view analytics.v_stockout_risk is
  'renew.prd 20장 — 재고 전개 기반 결품 위험 4상태. 임계값은 core.policy_config 에서 옵니다';

create view analytics.v_stockout_kpi as
select count(*)                                                          as n_items,
       count(*) filter (where r.risk_status = 'CRITICAL')                as n_critical,
       count(*) filter (where r.risk_status = 'WARNING')                 as n_warning,
       count(*) filter (where r.risk_status = 'SAFE')                    as n_safe,
       count(*) filter (where r.risk_status = 'CALCULATION_UNAVAILABLE') as n_unknown,
       -- 이미 소진된 품목(stockout_days < 0)은 "앞으로 30일 안에 소진" 이 아닙니다.
       -- 그 품목은 n_critical 이 이미 세고 있습니다.
       count(*) filter (where r.stockout_days between 0 and 30)          as n_within_30d,
       count(*) filter (where r.stockout_days between 0 and 60)          as n_within_60d,
       round(avg(r.stockout_days), 1)                                    as avg_stockout_days
  from analytics.v_stockout_risk r;

-- 재고 전개 화면의 품목 선택 칩. 한 품목당 한 줄입니다.
create view analytics.v_projection_item as
select r.item_id,
       r.item_name,
       r.risk_status,
       r.stockout_date,
       r.stockout_days,
       r.reason
  from analytics.v_stockout_risk r;

-- ══ 7. 권한 ════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['leadtime_plan_history','forecast_override'] loop
    execute format('grant select, insert, update, delete on core.%I to authenticated', t);
    execute format('revoke all on core.%I from anon', t);
    execute format('alter table core.%I enable row level security', t);

    execute format('drop policy if exists %I on core.%I', t || '_read', t);
    execute format('create policy %I on core.%I for select to authenticated using (true)',
                   t || '_read', t);

    execute format('drop policy if exists %I on core.%I', t || '_write_admin', t);
    execute format('create policy %I on core.%I for all to authenticated
                      using (core.is_admin()) with check (core.is_admin())',
                   t || '_write_admin', t);
  end loop;
end $$;

grant usage, select on sequence core.leadtime_plan_history_id_seq to authenticated;
grant usage, select on sequence core.forecast_override_id_seq     to authenticated;

-- Override 는 USER 도 입력할 수 있어야 합니다 (renew.prd 4.3 · 17장).
-- 위 반복문이 건 관리자 전용 정책을 여기서 덮어씁니다.
drop policy if exists forecast_override_write_admin on core.forecast_override;

-- insert 는 로그인한 사용자 누구나 할 수 있습니다.
-- created_by 를 본인으로 강제하지 않는 이유는, 같은 item × period 의 유효 Override 가
-- 하나뿐이라(부분 유니크 인덱스) 남의 Override 를 대체하려면 이전 행을 superseded 로
-- 바꿔야 하기 때문입니다. 그 두 동작을 한 트랜잭션으로 묶는 일은 STEP 12 의
-- security definer 함수가 맡습니다. update 정책은 본인/관리자로 남겨 둡니다.
drop policy if exists forecast_override_insert_self on core.forecast_override;
drop policy if exists forecast_override_insert_any on core.forecast_override;
create policy forecast_override_insert_any on core.forecast_override
  for insert to authenticated
  with check (true);

drop policy if exists forecast_override_update_own on core.forecast_override;
create policy forecast_override_update_own on core.forecast_override
  for update to authenticated
  using (created_by = auth.uid() or core.is_admin())
  with check (created_by = auth.uid() or core.is_admin());

-- 이력은 함수(security definer)만 씁니다. 사람이 직접 고치지 못하게 둡니다.
drop policy if exists leadtime_plan_history_write_admin on core.leadtime_plan_history;

grant select on core.v_ai_forecast              to authenticated;
grant select on core.v_consensus_forecast       to authenticated;
grant select on analytics.v_leadtime_policy     to authenticated;
grant select on analytics.v_leadtime_plan_history to authenticated;
grant select on analytics.v_inventory_projection  to authenticated;
grant select on analytics.v_stockout_risk       to authenticated;
grant select on analytics.v_stockout_kpi        to authenticated;
grant select on analytics.v_projection_item     to authenticated;

-- ══ 8. 확인 ════════════════════════════════════════════════════

select * from analytics.v_stockout_kpi;

select item_id, risk_status, reason, stockout_date, planned_lead_time
  from analytics.v_stockout_risk
 order by stockout_days nulls last;

select * from analytics.v_leadtime_policy order by supplier_id;

-- 한 품목의 전개를 눈으로 검산해 보세요 (기초 + 입고 − 수요 = 기말).
select item_id, period, period_index, opening_qty, receipt_qty,
       forecast_qty, committed_so_qty, soft_allocation_qty, demand_qty,
       closing_qty, cumulative_demand_qty
  from analytics.v_inventory_projection
 order by item_id, period
 limit 50;
