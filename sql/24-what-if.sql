-- ──────────────────────────────────────────────────────────────
-- STEP 18 · What-If Simulation
--
-- renew.prd 25장
--   25.1  시나리오 7종 — 수요 ±% · 리드타임 변경 · Open PO 지연 · 서비스 수준 변경 ·
--         공급처 사용 불가 · 대형 계약 추가 · 프로모션
--   25.2  "Base Scenario 와 나란히 비교한다"
--         "★ 실제 데이터를 변경하지 않는다. 시뮬레이션 컨텍스트에서만 계산한다."
--
-- 여기서 만드는 것
--   core  wi_num() · wi_bool() · wi_month()   jsonb 파라미터를 안전하게 읽는 도우미
--   core  fn_projection(item, params)   ★ 파라미터를 받는 재고 전개 (sql/15 의 공식)
--   core  fn_scenario_summary(item, params)   한 쪽(Base 또는 시나리오)의 요약 jsonb
--   core  simulate_scenario(item, params)     ★ 기간별 Base vs 시나리오 (화면의 차트·표)
--   core  simulate_scenario_summary(item, params) ★ 요약 jsonb (화면의 KPI 카드)
--   core  what_if_log                    누가 어떤 시나리오를 돌렸는지 (감사·재현용)
--
-- sql/23-atp-sales.sql 까지 먼저 실행하세요.
--   sql/15(재고 전개 · 결품 위험) · sql/16(안전재고 · 발주 추천) 의 뷰와
--   sql/23 의 core.is_sales() 가 있어야 합니다.
--
-- ★★★ 이 파일은 데이터를 쓰지 않습니다 (renew.prd 25.2)
--
--   네 함수 모두 `stable` 입니다. PostgreSQL 이 문장 수준에서 쓰기를 막습니다 —
--   stable 함수 안에서 insert/update/delete 를 하면 실행 시점에
--   "UPDATE is not allowed in a non-volatile function" 으로 죽습니다.
--   즉 "쓰지 않는다" 가 주석의 약속이 아니라 함수의 성질입니다.
--
--   what_if_log 는 앱의 Server Action 이 따로 insert 합니다. 계산 안에서 쓰지 않습니다.
--   시나리오 결과도 저장하지 않습니다 — 결과는 URL 에만 있습니다.
--
-- ★★★ 공식은 sql/15 · sql/16 과 같아야 합니다 — 갈라지면 두 곳을 같이 고치세요
--
--   STEP 9 · 10 의 뷰는 "현재 데이터 위의 고정 계산" 입니다. 파라미터를 받을 수 없으므로
--   같은 공식을 함수로 다시 썼습니다. 뷰 정의를 복사한 것이 아니라, 아래 각 절의 머리에
--   **원본의 파일 · 절 · 행 번호를 인용**해 두었습니다.
--
--   행 번호는 2026-09-03 기준입니다. 파일이 자라면 몇 행씩 밀리므로 절 이름
--   (`v_inventory_projection` 의 `calc` CTE 등)을 함께 적었습니다. 번호가 어긋나면
--   이름으로 찾으세요.
--
--   ★ 어느 한쪽만 고치면 화면 두 곳이 다른 숫자를 말합니다. 재고 소진 위험 화면은
--     A 라고 하는데 What-If 의 Base 는 B 라고 하는 순간, 두 값 다 못 믿게 됩니다.
--     그래서 이 파일 끝에 **Base = 뷰** 를 대조하는 확인 select 를 붙였습니다.
--     공식을 고쳤으면 그 select 를 돌려 0행(불일치 없음)인지 보세요.
--
-- ★ error.md #11 — RETURNS TABLE 의 컬럼 이름은 함수 안에서 변수가 됩니다.
--   본문에서 테이블 컬럼을 참조할 때는 항상 별칭을 붙입니다.
-- ★ error.md #22 — 파일 끝 확인 블록에는 읽기 전용 select 만 둡니다.
--   여기 함수들은 관리자 전용이 아니므로 SQL Editor 에서 그대로 돌아갑니다.
--
-- 다시 실행해도 안전합니다 — create table if not exists · create or replace ·
-- drop policy if exists 로만 씁니다. drop view 가 한 줄도 없어서 앞 파일에 영향이 없습니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 파라미터 도우미 ═════════════════════════════════════════
--
-- p_params 는 화면·AI 가 만든 jsonb 입니다. 밖에서 온 값이므로 타입을 믿지 않습니다.
-- 읽을 수 없는 값은 0 으로 채우지 않고 null 을 돌려줍니다 (AGENTS.md 규칙 5) —
-- null 이면 그 항목은 "주지 않은 것" 이 되어 Base 와 같아집니다.

create or replace function core.wi_num(p_params jsonb, p_key text)
returns numeric
language sql
immutable
as $$
  select case
           when p_params is null then null
           when jsonb_typeof(p_params -> p_key) = 'number'
             then (p_params ->> p_key)::numeric
           -- 폼에서 온 값은 문자열일 수 있습니다. 숫자 모양일 때만 받습니다.
           when jsonb_typeof(p_params -> p_key) = 'string'
                and btrim(p_params ->> p_key) ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
             then btrim(p_params ->> p_key)::numeric
         end;
$$;

comment on function core.wi_num(jsonb, text) is
  'What-If 파라미터를 숫자로. 읽을 수 없으면 null (0 으로 채우지 않습니다)';

create or replace function core.wi_bool(p_params jsonb, p_key text)
returns boolean
language sql
immutable
as $$
  select case
           when p_params is null then null
           when jsonb_typeof(p_params -> p_key) = 'boolean'
             then (p_params ->> p_key)::boolean
           when lower(btrim(coalesce(p_params ->> p_key, ''))) in ('true', 't', '1')  then true
           when lower(btrim(coalesce(p_params ->> p_key, ''))) in ('false', 'f', '0') then false
         end;
$$;

comment on function core.wi_bool(jsonb, text) is
  'What-If 파라미터를 참/거짓으로. 읽을 수 없으면 null';

-- 'YYYY-MM' 또는 'YYYY-MM-DD' 를 그 달의 1일로. 재고 전개가 달 단위이기 때문입니다.
create or replace function core.wi_month(p_params jsonb, p_key text)
returns date
language sql
immutable
as $$
  select case
           when p_params is null then null
           when btrim(coalesce(p_params ->> p_key, '')) ~ '^[0-9]{4}-[0-9]{2}$'
             then date_trunc('month', (btrim(p_params ->> p_key) || '-01')::date)::date
           when btrim(coalesce(p_params ->> p_key, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             then date_trunc('month', btrim(p_params ->> p_key)::date)::date
         end;
$$;

comment on function core.wi_month(jsonb, text) is
  'What-If 파라미터를 기간(그 달 1일)으로. 읽을 수 없으면 null';

-- ══ 2. 파라미터를 받는 재고 전개 ★ ═════════════════════════════
--
-- ★ 원본 — sql/15-inventory-projection.sql §5 `analytics.v_inventory_projection`
--   (360~447행). CTE 이름(cf · span · so · alloc · grid · calc)과 창(window w)을
--   그대로 옮겼습니다. 한 품목만 보므로 partition by 만 뺐습니다.
--
--   renew.prd 19.1
--     Projected Inventory = 가용재고 + 입고예정 − 가예약 − 확정수주 − 예측수요
--   renew.prd 22.1
--     확정 수주가 있으면 예측보다 우선합니다 → greatest(예측, 확정수주) (sql/15 422행)
--   forecast 가 없는 기간은 행을 만들지 않습니다 (sql/15 352~353행 주석).
--
-- 파라미터가 손대는 곳은 딱 두 군데입니다. 나머지 산술은 위 뷰와 글자까지 같습니다.
--
--   ① receipt_qty  — open_po_delay_days 만큼 ETA 를 미루고, supplier_unavailable 이면 없앱니다
--   ② demand_qty   — demand_pct · promotion_pct 는 **예측**에 곱하고,
--                    extra_order_qty 는 **적용수요**에 더합니다
--
--   ★ 왜 곱셈은 예측에만 거는가
--     확정 수주(raw.sales_order status='CONFIRMED')는 계약입니다. "수요가 20% 늘면" 이라는
--     가정으로 계약 수량이 바뀌지는 않습니다. 그래서 곱셈은 예측 쪽에만 걸고,
--     greatest(예측, 확정수주) 규칙은 손대지 않습니다.
--
--   ★ 왜 대형 계약은 적용수요에 더하는가
--     새 계약은 "예측이 이미 보고 있던 수요" 가 아니라 그 위에 얹히는 수요입니다.
--     greatest 안에 넣으면 예측이 계약보다 크던 품목에서 계약이 통째로 사라집니다.
--
--   ★ 리드타임(lead_time_days · lead_time_pct)과 서비스 수준(service_level)은
--     여기에 영향을 주지 않습니다. 전개는 재고·입고·수요의 함수이고, 리드타임은
--     "언제까지를 덮어야 하는가"(판정·발주)만 바꿉니다. §3 에서 씁니다.

-- ★ returns table 의 컬럼을 더하거나 바꾸면 create or replace 가 거부합니다
--   ("cannot change return type of existing function"). 먼저 지웁니다 (공통규칙 14).
--   함수에는 뷰 같은 의존 기록이 없으므로 cascade 가 필요 없습니다.
drop function if exists core.fn_projection(text, jsonb);

create function core.fn_projection(p_item_id text, p_params jsonb)
returns table (
  period                date,
  period_index          int,
  opening_qty           numeric,
  receipt_qty           numeric,
  forecast_qty          numeric,
  committed_so_qty      numeric,
  soft_allocation_qty   numeric,
  demand_qty            numeric,
  closing_qty           numeric,
  cumulative_demand_qty numeric,
  data_snapshot_at      timestamptz
)
language sql
stable
security definer
set search_path = core, public
as $$
with arg as (
  -- 품목코드는 core 뷰와 같은 규칙으로 정규화합니다 (sql/15 375행 · 385행).
  select upper(regexp_replace(coalesce(p_item_id, ''), '[\s\-_]', '', 'g')) as item_id
),
knob as (
  select coalesce(core.wi_num(p_params, 'demand_pct'), 0)              as demand_pct,
         coalesce(core.wi_num(p_params, 'open_po_delay_days'), 0)      as open_po_delay_days,
         coalesce(core.wi_bool(p_params, 'supplier_unavailable'), false) as supplier_unavailable,
         core.wi_num(p_params, 'promotion_pct')                        as promotion_pct,
         core.wi_month(p_params, 'promotion_period')                   as promotion_period,
         core.wi_num(p_params, 'extra_order_qty')                      as extra_order_qty,
         core.wi_month(p_params, 'extra_order_period')                 as extra_order_period
),
cf as (
  -- 오늘이 속한 달부터. 지난 기간의 예측은 보지 않습니다 (sql/15 361~367행).
  select c.item_id, c.period, c.consensus_qty, c.data_snapshot_at
    from core.v_consensus_forecast c
    join arg a on a.item_id = c.item_id
   where c.period >= date_trunc('month', current_date)::date
),
span as (
  select min(f.period) as first_period from cf f
),
so as (
  -- 확정 수주 (sql/15 373~382행)
  select date_trunc('month', s.due_date)::date as period,
         sum(s.qty)                            as committed_qty
    from raw.sales_order s
    join arg a
      on a.item_id = upper(regexp_replace(coalesce(s.item_id, ''), '[\s\-_]', '', 'g'))
   where s.status = 'CONFIRMED'
     and s.due_date is not null
   group by 1
),
alloc as (
  -- 가예약. 유효기간이 지난 것은 이미 풀린 것으로 봅니다 (sql/15 383~390행)
  select sum(al.qty) as soft_qty
    from core.soft_allocation al
    join arg a
      on a.item_id = upper(regexp_replace(coalesce(al.item_id, ''), '[\s\-_]', '', 'g'))
   where al.status = 'RESERVED'
     and al.valid_until >= current_date
),
grid as (
  select f.period,
         row_number() over (order by f.period) as period_index,
         -- 재고 행이 없으면 0 으로 채우지 않습니다. null 로 둡니다 (sql/15 397~398행).
         soh.current_stock,
         -- 입고예정은 ETA 가 속한 달에 넣습니다. ETA 가 오늘 이전이면 첫 기간입니다
         -- (sql/15 399~404행). ★ 시나리오는 여기에 지연일을 더하고, 공급처 사용 불가면
         --   아예 넣지 않습니다. 미뤄진 ETA 가 전개 구간 밖으로 나가면 어느 기간과도
         --   같지 않으므로 그대로 사라집니다 — 마지막 달로 밀어 넣지 않습니다.
         case when ib.inbound_qty is not null
               and not k.supplier_unavailable
               and greatest(
                     date_trunc('month',
                       ib.earliest_eta + make_interval(days => round(k.open_po_delay_days)::int)
                     )::date,
                     sp.first_period) = f.period
              then ib.inbound_qty
              else 0 end                                               as receipt_qty,
         -- ★ 예측에만 거는 곱셈. 음수 수요는 만들지 않습니다.
         --
         -- ★★ 수요 손잡이를 하나도 쓰지 않으면 **곱하지 않고 그대로 둡니다.**
         --    그냥 × (1 + 0/100) 을 해도 값은 같지만 numeric 의 소수 자릿수가 늘어납니다
         --    (0/100 이 0.00000000000000000000). 그 자릿수가 뒤의 나눗셈까지 따라가
         --    창 수요의 마지막 자리가 뷰와 달라지고, Base = 뷰 확인(§7 ③)이 깨집니다.
         --    실제로 겪었습니다 — 값은 같은데 20번째 소수 자리가 달랐습니다.
         --    greatest(…, 0) 도 여기서는 걸지 않습니다. sql/15 는 음수 Consensus 를
         --    그대로 두므로(Override 로 음수가 될 수 있습니다), Base 도 그래야 합니다.
         case
           when k.demand_pct = 0 and k.promotion_pct is null
             then coalesce(f.consensus_qty, 0)
           else greatest(
                  coalesce(f.consensus_qty, 0)
                    * (1 + k.demand_pct / 100)
                    * case when k.promotion_pct is not null
                            and (k.promotion_period is null or k.promotion_period = f.period)
                           then 1 + k.promotion_pct / 100
                           else 1 end,
                  0)
         end                                                           as forecast_qty,
         coalesce(so.committed_qty, 0)                                 as committed_so_qty,
         case when f.period = sp.first_period then coalesce(al.soft_qty, 0) else 0 end
                                                                       as soft_allocation_qty,
         -- ★ 적용수요에 더하는 덧셈 (대형 계약)
         case when k.extra_order_qty is not null
               and (k.extra_order_period is null or k.extra_order_period = f.period)
              then k.extra_order_qty
              else 0 end                                               as extra_demand_qty,
         f.data_snapshot_at
    from cf f
    cross join knob k
    join core.v_item_master im on im.item_id = f.item_id and im.is_active = 'Y'
    cross join span sp
    left join core.v_stock_on_hand soh on soh.item_id = f.item_id
    left join core.v_inbound_qty   ib  on ib.item_id  = f.item_id
    left join so                       on so.period   = f.period
    left join alloc al on true
),
calc as (
  -- 적용수요 = greatest(예측, 확정수주) + 가예약 (sql/15 420~423행) + 대형 계약
  select g.*,
         greatest(g.forecast_qty, g.committed_so_qty)
           + g.soft_allocation_qty
           + g.extra_demand_qty                                        as demand_qty
    from grid g
)
select c.period,
       c.period_index::int                                             as period_index,
       -- 기초 = 현재고 + 이전 기간까지의 순증감 (sql/15 430~433행)
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
       c.data_snapshot_at
  from calc c
window w as (order by c.period rows between unbounded preceding and current row);
$$;

comment on function core.fn_projection(text, jsonb) is
  'renew.prd 19.1 · 25.1 — 파라미터를 받는 재고 전개. 공식은 sql/15 의 '
  'analytics.v_inventory_projection 과 같습니다. 빈 params 면 그 뷰와 같은 값이어야 합니다';

-- 내부 함수입니다. 화면·AI 는 아래 simulate_scenario* 만 부릅니다.
-- authenticated 에 execute 를 주지 않는 이유는, 영업 차단(§4)을 우회할 수 있는
-- 뒷문을 만들지 않기 위해서입니다. security definer 인 상위 함수가 소유자 권한으로 부릅니다.
revoke all on function core.fn_projection(text, jsonb) from public, anon;

-- ══ 3. 한 쪽(Base 또는 시나리오)의 요약 ★ ══════════════════════
--
-- ★ 원본 (공식이 갈라지면 두 곳을 같이 고치세요)
--   sql/15-inventory-projection.sql §6 `analytics.v_stockout_risk` (455~624행)
--     · neg · dated       결품 예상일 — 기말이 처음 음수가 되는 달 안에서 선형 보간 (480~507행)
--     · horizon · lt      리드타임+검토주기 창의 수요 (510~531행)
--     · scored            판정 불가 사유 5종의 우선순위 (566~577행)
--     · risk_status       4상태 (594~603행)
--   sql/16-safety-stock-recommendation.sql
--     · v_demand_window   창 수요의 일수 안분 (394~433행) — sql/15 의 lt 와 같은 식입니다
--     · v_safety_stock    σ_DLT = √(L·σ_d² + d²·σ_L²) · Safety Stock = Z·σ_DLT (449~559행)
--     · v_purchase_recommendation
--                         필요량 = 창 수요 + 안전재고 − 현재고 − 입고예정 (628~641행)
--                         발주 권고일 = 결품일 − 리드타임 − 여유일 (645~650행)
--                         MOQ · 포장 단위 보정 (651~658행)
--     · v_item_service_level 의 nearest CTE   서비스 수준 → 가장 가까운 Z (206~215행)
--
-- 반환 jsonb 의 키는 Base 와 시나리오가 **같습니다**. 화면이 두 열을 같은 코드로 그리고,
-- 차이(delta)를 키 하나로 계산할 수 있어야 하기 때문입니다.
--
-- 정책값(검토 주기 · 여유일 · 서비스 수준 · Z)은 core.policy_config · core.service_level ·
-- core.z_table 에서 읽습니다. 이 파일에 숫자를 적지 않습니다 (renew.prd 32장).

create or replace function core.fn_scenario_summary(p_item_id text, p_params jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_item        text;
  v_params      jsonb;
  v_found       boolean;
  v_supplier    text;

  -- 정책값
  v_review      numeric;
  v_buffer      numeric;

  -- 리드타임
  v_lead_base   numeric;
  v_lead        numeric;
  v_lead_sd     numeric;

  -- 서비스 수준
  v_sl_param    numeric;
  v_sl          numeric;
  v_z           numeric;

  -- 재고
  v_stock       numeric;
  -- 진행 중 선적 **전량**. 화면·AI 가 "오고 있는 물량" 으로 읽는 값이라 뜻을 바꾸지 않습니다
  -- (sql/16 도 incoming_qty 의 뜻은 그대로 두고 창 안 몫을 따로 냈습니다).
  v_incoming    numeric;
  -- ★ 그중 **창 안에 도착하는 몫**. 발주 필요량에서 빼는 값은 이쪽입니다.
  v_incoming_win numeric;
  v_unavailable boolean;
  -- 입고 지연(일). 시나리오에서 ETA 를 미루면 창 밖으로 나가는 선적이 생깁니다.
  v_delay       numeric;

  -- 전개 집계
  v_n_periods   bigint;
  v_n_valued    bigint;
  v_snapshot    timestamptz;
  v_neg_period  date;
  v_neg_open    numeric;
  v_neg_receipt numeric;
  v_neg_demand  numeric;
  v_window      numeric;
  -- 창 수요의 원본. v_window 는 판정 불가일 때 지워지지만(sql/15 615행),
  -- 안전재고의 d 는 그 사유로 막지 않습니다 (sql/16 388~391행). 그래서 따로 둡니다.
  v_window_raw  numeric;

  v_horizon_end date;
  v_demand_type text;

  -- 판정
  v_stockout    date;
  v_days        numeric;
  v_reason      text;
  v_risk        text;

  -- 안전재고
  v_sigma_m     numeric;
  -- ★ 전부 numeric 입니다. SQL 의 무점수 소수 리터럴(30.4)은 numeric 이므로
  --   sql/16 의 sigma_d = sigma_d_monthly / sqrt(30.4) 도, 그 뒤의 σ_DLT · 안전재고 ·
  --   추천 수량도 전부 numeric 으로 계산됩니다. 여기서 double precision 으로 받으면
  --   같은 식인데도 마지막 자릿수가 달라져 Base 가 뷰와 어긋납니다 (실제로 겪었습니다).
  v_sigma_d     numeric;
  v_sigma_dlt   numeric;
  v_daily       numeric;
  v_ss_reason   text;
  v_safety      numeric;

  -- 발주
  v_moq         numeric;
  v_pack        numeric;
  v_raw_qty     numeric;
  v_order_qty   numeric;
  v_req_date    date;
begin
  -- 밖에서 온 값입니다. 객체가 아니면 빈 객체로 봅니다 (Base 와 같아집니다).
  v_params := case when jsonb_typeof(p_params) = 'object' then p_params else '{}'::jsonb end;
  v_item   := upper(regexp_replace(coalesce(p_item_id, ''), '[\s\-_]', '', 'g'));

  -- ── 품목 ──
  select true, im.supplier_id
    into v_found, v_supplier
    from core.v_item_master im
   where im.item_id = v_item
     and im.is_active = 'Y';

  if not coalesce(v_found, false) then
    return jsonb_build_object('found', false);
  end if;

  -- ── 정책값 (sql/15 456~463행 · sql/16 587~595행) ──
  -- 0 으로 채우지 않습니다. 없으면 그 항목이 산출 불가가 되어 "정책값이 빠졌다" 가 드러납니다.
  select max(pc.value_num) filter (where pc.key = 'REVIEW_PERIOD_DAYS'),
         max(pc.value_num) filter (where pc.key = 'SAFETY_BUFFER_DAYS')
    into v_review, v_buffer
    from core.policy_config pc;

  -- ── 리드타임 ──
  select le.effective_lead_time into v_lead_base
    from core.v_leadtime_effective le
   where le.supplier_id = v_supplier;

  select st.std_days into v_lead_sd
    from core.v_leadtime_stat st
   where st.supplier_id = v_supplier;

  -- lead_time_days(절대값)가 lead_time_pct(배율)보다 우선합니다. 둘 다 없으면 Base 그대로.
  v_lead := coalesce(
              core.wi_num(v_params, 'lead_time_days'),
              case when core.wi_num(v_params, 'lead_time_pct') is not null
                   then v_lead_base * (1 + core.wi_num(v_params, 'lead_time_pct') / 100)
              end,
              v_lead_base);
  if v_lead is not null and v_lead < 0 then
    v_lead := 0;
  end if;

  -- ── 서비스 수준 → Z ──
  select sl.service_level, sl.z_value
    into v_sl, v_z
    from core.v_item_service_level sl
   where sl.item_id = v_item;

  v_sl_param := core.wi_num(v_params, 'service_level');
  if v_sl_param is not null then
    -- 0.95 로도 95 로도 올 수 있습니다. 표는 비율(0~1)로 저장되어 있습니다.
    if v_sl_param > 1 then
      v_sl_param := v_sl_param / 100;
    end if;
    v_sl := v_sl_param;
    -- 표에 없으면 가장 가까운 행 (sql/16 206~215행)
    select z.z_value into v_z
      from core.z_table z
     order by abs(z.service_level - v_sl_param), z.service_level
     limit 1;
  end if;

  -- ── 재고 · 입고예정 ──
  select soh.current_stock into v_stock
    from core.v_stock_on_hand soh
   where soh.item_id = v_item;

  select ib.inbound_qty into v_incoming
    from core.v_inbound_qty ib
   where ib.item_id = v_item;

  -- 진행 중 선적이 없는 것은 진짜 0 입니다 (sql/15 586~587행 — 여기만 coalesce 합니다).
  v_incoming := coalesce(v_incoming, 0);

  v_unavailable := coalesce(core.wi_bool(v_params, 'supplier_unavailable'), false);
  if v_unavailable then
    -- 공급처를 못 쓰면 진행 중 선적도 받지 못합니다. 전개에서도 §2 가 입고를 지웁니다.
    v_incoming := 0;
  end if;

  select dp.demand_type into v_demand_type
    from analytics.v_sku_demand_profile dp
   where dp.item_id = v_item;

  -- ── 창의 끝 (sql/15 510~518행 · sql/16 401~414행) ──
  if v_lead is not null and v_review is not null then
    v_horizon_end := (current_date + (v_lead + v_review)::int)::date;
  end if;

  -- ── ★ 창 안에 도착하는 입고예정 (sql/16 657~683행 `win` CTE) ──
  --
  -- renew.prd 22.1 의 "Confirmed Incoming Qty" 는 **창 안에 들어오는** 물량입니다.
  -- 창(리드타임 + 검토주기) 뒤에 도착할 배는 지금 필요한 수량을 덮어 주지 못하므로
  -- 필요량에서 빼면 안 됩니다.
  --
  -- ★★ 왜 core.v_inbound_qty 를 쓰지 않는가 (sql/16 의 같은 자리 주석과 같은 이유)
  --    그 뷰는 품목당 한 줄로 접혀 있습니다 — 합계 하나와 **가장 이른** ETA 하나뿐입니다.
  --    "가장 이른 ETA 가 창 안이니 전량을 뺀다" 로 하면 뒤따라 오는 배까지 창 안으로
  --    쳐서 같은 결함이 그대로 남습니다. 그래서 선적 한 건씩 다시 읽습니다.
  --    ETA 식은 core.v_inbound_qty 의 정의와 **글자 그대로 같아야** 합니다.
  --
  -- ★★ 시나리오는 여기에 지연일을 더합니다.
  --    이 손잡이는 전개(§2 의 receipt_qty)에서 이미 ETA 를 미뤄 입고를 뒤로 보냅니다.
  --    여기서 같이 미루지 않으면 **"배가 늦는다" 시나리오가 재고는 줄이면서 발주 수량은
  --    그대로 두는** 자기모순이 생깁니다 — 늦어서 못 쓰는 물량을 가용으로 세는 셈입니다.
  --    전개와 같은 단위(정수 일)로 미뤄 두 곳이 같은 배를 같은 날에 놓습니다.
  --
  -- ETA 를 모르는 선적(order_date 가 없는 경우)은 창 밖으로 둡니다 — 비교가 null 이라
  -- 합계에 들어가지 않습니다. "언제 올지 모르는 물량" 을 가용으로 세는 것이 이 결함의
  -- 본체이므로, 빼지 않는 쪽이 안전합니다 (sql/16 과 같은 판단).
  --
  -- 창을 모르면(리드타임이나 검토주기가 없으면) 뺄 값도 모릅니다. 0 이 아니라 null 입니다
  -- (AGENTS.md 규칙 5). 아래 필요량 계산이 그 null 을 보고 산출을 포기합니다.
  v_delay := coalesce(core.wi_num(v_params, 'open_po_delay_days'), 0);

  if v_unavailable then
    -- 공급처를 못 쓰면 받을 배가 없습니다 (위에서 v_incoming 도 0 으로 두었습니다).
    v_incoming_win := 0;
  elsif v_horizon_end is not null then
    select coalesce(sum(s.qty), 0) into v_incoming_win
      from core.v_fact_shipment s
     where s.item_id = v_item
       and s.status  = 'IN_TRANSIT'
       and (s.order_date
            + coalesce((select e.effective_lead_time
                          from core.v_leadtime_effective e
                         where e.supplier_id = s.supplier_id), 30)
            + round(v_delay)::int) <= v_horizon_end;
  end if;

  -- ── 전개를 **한 번만** 돌려 세 가지를 함께 냅니다 ──
  --   ① 기간 수 · 값이 있는 기간 수 · 기준시각   (sql/15 469~478행 proj)
  --   ② 기말이 처음 음수가 되는 기간             (sql/15 480~493행 neg)
  --   ③ 창의 수요                                (sql/15 521~531행 lt · sql/16 415~433행)
  --
  -- ★ 전개는 비쌉니다 (core.v_consensus_forecast → v_ai_forecast 가 매번 Champion 을
  --   다시 고릅니다). 이 함수는 화면 한 번에 두 번(Base · 시나리오) 불리므로,
  --   여기서 두 번 돌면 네 번이 됩니다. `materialized` 로 한 번만 돌게 못박습니다.
  with p as materialized (
    select fp.period, fp.period_index, fp.opening_qty, fp.receipt_qty,
           fp.demand_qty, fp.closing_qty, fp.data_snapshot_at
      from core.fn_projection(v_item, v_params) fp
  ),
  agg as (
    select count(*)                  as n_periods,
           count(pp.closing_qty)     as n_valued,
           max(pp.data_snapshot_at)  as snapshot
      from p pp
  ),
  neg as (
    -- demand_qty = 0 인 기간은 그 달 안에서 줄어들지 않으므로 결품 시점이 아닙니다.
    select pp.period, pp.opening_qty, pp.receipt_qty, pp.demand_qty
      from p pp
     where pp.closing_qty < 0
       and pp.demand_qty > 0
     order by pp.period
     limit 1
  ),
  win as (
    -- 월 단위 전개를 기간 일수에 비례해 일 단위로 안분해 더합니다.
    select sum(pp.demand_qty
               * greatest(0,
                   least(v_horizon_end, (pp.period + interval '1 month')::date - 1)
                   - greatest(current_date, pp.period) + 1)::numeric
               / ((pp.period + interval '1 month')::date - pp.period)::numeric)
             as window_demand
      from p pp
     where v_horizon_end is not null
  )
  select a.n_periods, a.n_valued, a.snapshot,
         n.period, n.opening_qty, n.receipt_qty, n.demand_qty,
         w.window_demand
    into v_n_periods, v_n_valued, v_snapshot,
         v_neg_period, v_neg_open, v_neg_receipt, v_neg_demand,
         v_window_raw
    from agg a
    left join neg n on true
    left join win w on true;

  v_window := v_window_raw;

  -- ── 결품 예상일 (sql/15 495~507행 dated) ──
  --   그 달에 쓸 수 있는 재고는 기초 + 그 달 입고입니다.
  --   기말 공식이 입고를 월초 도착으로 보므로 보간도 같게 봅니다.
  if v_neg_period is not null then
    v_stockout := (v_neg_period
      + greatest(0, floor((v_neg_open + v_neg_receipt)
          / (v_neg_demand
             / ((v_neg_period + interval '1 month')::date - v_neg_period)::numeric)))::int)::date;
  end if;

  -- ── 판정 불가 사유 (sql/15 566~577행) ──
  v_reason := case
                when v_stock is null                     then 'NO_INVENTORY_DATA'
                when v_lead is null                      then 'NO_LEADTIME'
                when coalesce(v_n_periods, 0) = 0        then 'NO_FORECAST'
                when v_demand_type = 'NO_DEMAND'         then 'NO_USAGE_HISTORY'
                when coalesce(v_n_valued, 0) = 0         then 'INSUFFICIENT_SAMPLE'
                else null
              end;

  v_days := (v_stockout - current_date)::numeric;

  -- 판정하지 못했으면 결품일도 내지 않습니다 (sql/15 592~593행).
  if v_reason is not null then
    v_stockout := null;
    v_days     := null;
    v_window   := null;   -- sql/15 615행 — leadtime_demand_qty 도 같이 막습니다
  end if;

  -- ── 4상태 (sql/15 594~603행) ──
  --   정책값이 없으면 두 번째 비교가 null 이라 WARNING 대역만 건너뜁니다. 그대로 옮깁니다.
  v_risk := case
              when v_reason is not null then 'CALCULATION_UNAVAILABLE'
              when v_days is null       then 'SAFE'
              when v_days < v_lead      then 'CRITICAL'
              when v_days < v_lead + v_review + v_buffer then 'WARNING'
              else 'SAFE'
            end;

  -- ── 안전재고 (sql/16 449~559행) ──
  --   d = 창의 누적 적용수요 ÷ 창 일수. 창 일수가 0 이면 나누지 않습니다.
  --   ★ 창 수요를 판정 사유로 막지 않습니다 (sql/16 388~391행과 같은 취지):
  --     재고가 없어도 안전재고는 낼 수 있어야 사유 코드가 거짓말을 하지 않습니다.
  --     그래서 위에서 지운 v_window 가 아니라 v_window_raw 를 씁니다.
  v_daily := v_window_raw / nullif(v_lead + v_review, 0);

  -- σ_d ① 백테스트 RMSE ② 없으면 예측이 낸 in-sample σ (sql/16 455~469행)
  select c.rmse into v_sigma_m
    from core.champion_model c
   where c.item_id = v_item
     and c.rmse is not null;

  if v_sigma_m is null then
    select avg(af.sigma) into v_sigma_m
      from core.v_ai_forecast af
     where af.item_id = v_item
       and af.sigma is not null;
  end if;

  -- 월 오차를 일 오차로. 30.4 는 한 달 평균 일수(달력 상수)입니다 (sql/16 503~508행).
  v_sigma_d := v_sigma_m / sqrt(30.4);

  v_ss_reason := case
                   when v_lead is null   then 'NO_LEADTIME'
                   when v_daily is null  then 'NO_FORECAST'
                   when v_sigma_d is null then 'INSUFFICIENT_SAMPLE'
                   when v_z is null      then 'INSUFFICIENT_SAMPLE'
                   else null
                 end;

  if v_ss_reason is null then
    -- σ_DLT = √( L × σ_d² + d² × σ_L² )        (renew.prd 21.1 · sql/16 536~539행)
    v_sigma_dlt := sqrt( v_lead * power(v_sigma_d, 2)
                       + power(v_daily, 2) * power(coalesce(v_lead_sd, 0), 2) );
    -- Safety Stock = Z × σ_DLT                  (sql/16 557행)
    v_safety := round(v_z * v_sigma_dlt);
  end if;

  -- ── 발주 추천 (sql/16 657~700행) ──
  select ip.moq, ip.pack_size into v_moq, v_pack
    from core.item_policy ip
   where ip.item_id = v_item;

  -- 필요량 = 창의 수요 + 안전재고 − 현재고 − **창 안에 들어오는** 입고예정. 음수면 0.
  -- 근거가 하나라도 없으면 0 이 아니라 null 입니다 (AGENTS.md 규칙 5).
  -- ★ 빼는 값이 v_incoming(전량) 이 아니라 v_incoming_win 입니다. 창을 모르면 그 값이
  --   null 이라 산출하지 않습니다 — sql/16 의 calc CTE 가 incoming_in_window_qty 를
  --   함께 보는 것과 같습니다.
  if coalesce(v_reason, v_ss_reason) is null
     and v_window is not null
     and v_safety is not null
     and v_stock  is not null
     and v_incoming_win is not null then
    v_raw_qty := greatest(0, v_window + v_safety - v_stock - v_incoming_win);
  end if;

  -- MOQ 와 포장 단위 보정 (renew.prd 22.1 — 필요 220 · Pack 100 → 300)
  v_order_qty := case
                   when v_raw_qty is null then null
                   when v_raw_qty = 0     then 0
                   when v_pack is null or v_pack <= 0
                        then greatest(v_raw_qty, coalesce(v_moq, 0))
                   else ceil(greatest(v_raw_qty, coalesce(v_moq, 0)) / v_pack) * v_pack
                 end;

  -- 발주 권고일 = 결품일 − 리드타임 − 여유일 (renew.prd 22.2 · sql/16 701~707행)
  if v_stockout is not null and v_lead is not null and v_buffer is not null then
    v_req_date := (v_stockout - v_lead::int - v_buffer::int)::date;
  end if;

  -- ★ 공급처를 쓸 수 없으면 신규 발주가 불가능합니다 (renew.prd 25.1).
  --   수량과 권고일을 0 이 아니라 null 로 둡니다 — "발주하지 않아도 된다" 가 아니라
  --   "발주할 수 없다" 이기 때문입니다. 이 시나리오에서 읽을 값은 결품 예상일입니다.
  if v_unavailable then
    v_raw_qty   := null;
    v_order_qty := null;
    v_req_date  := null;
  end if;

  return jsonb_build_object(
    'found',               true,
    'stockout_date',       v_stockout,
    'stockout_days',       v_days,
    'risk',                v_risk,
    'reason',              coalesce(v_reason, v_ss_reason),
    'safety_stock',        v_safety,
    'order_qty',           v_order_qty,
    'raw_order_qty',       v_raw_qty,
    'required_order_date', v_req_date,
    'lead_time_days',      v_lead,
    'review_period_days',  v_review,
    'safety_buffer_days',  v_buffer,
    'service_level',       v_sl,
    'z_value',             v_z,
    'window_demand_qty',   v_window,
    'daily_demand',        v_daily,
    'sigma_dlt',           v_sigma_dlt,
    'current_stock',       v_stock,
    'incoming_qty',        v_incoming,
    'moq',                 v_moq,
    'pack_size',           v_pack,
    'data_snapshot_at',    v_snapshot
  );
end;
$$;

comment on function core.fn_scenario_summary(text, jsonb) is
  'renew.prd 25.2 — 한 쪽(Base 또는 시나리오)의 요약. 빈 params 면 analytics.v_stockout_risk · '
  'v_safety_stock · v_purchase_recommendation 과 같은 값이어야 합니다 (파일 끝 확인 select)';

revoke all on function core.fn_scenario_summary(text, jsonb) from public, anon;

-- ══ 4. 화면·AI 가 부르는 함수 ★ ════════════════════════════════
--
-- ★ 영업(core.is_sales())은 부를 수 없습니다 (renew.prd 4.5).
--   시나리오 요약에 리드타임 통계(σ_L)와 발주 수량이 들어가는데, 영업에게는 가리는 값입니다
--   (lib/agent/redact.ts 와 같은 경계).
--
--   게이트는 `is distinct from false` 로 씁니다. `if core.is_sales() then` 는 값이
--   NULL 일 때 분기를 타지 않아 **조용히 열립니다** (error.md #20 의 3값 논리).
--   is_sales() 는 coalesce 로 false 를 보장하지만, 게이트는 그 보장에 기대지 않습니다.

-- ── 4-1. 기간별 Base vs 시나리오 (차트 · 표) ───────────────────
drop function if exists core.simulate_scenario(text, jsonb);

create function core.simulate_scenario(p_item_id text, p_params jsonb)
returns table (
  period            date,
  base_closing      numeric,
  scenario_closing  numeric,
  base_receipt      numeric,
  scenario_receipt  numeric,
  base_demand       numeric,
  scenario_demand   numeric,
  -- ★ 지시서가 적은 7개 뒤에 기초를 덧붙였습니다. 표가 "기초 · 입고 · 수요 · 기말" 을
  --   두 열 세트로 보여야 하는데(지시서 §4), 기초가 없으면 그 줄을 그릴 수 없습니다.
  --   앞 7개의 이름과 순서는 그대로 두었습니다.
  base_opening      numeric,
  scenario_opening  numeric
)
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_params jsonb;
begin
  if core.is_sales() is distinct from false then
    raise exception '영업 사용자는 시나리오 시뮬레이션을 사용할 수 없습니다';
  end if;

  v_params := case when jsonb_typeof(p_params) = 'object' then p_params else '{}'::jsonb end;

  -- Base 는 같은 함수를 빈 params 로 돌린 값입니다. 다른 코드 경로를 쓰지 않습니다.
  -- error.md #11 — 반환 컬럼 이름(period …)이 변수가 되므로 전부 별칭으로 한정합니다.
  return query
    select coalesce(b.period, s.period)                       as period,
           b.closing_qty, s.closing_qty,
           b.receipt_qty, s.receipt_qty,
           b.demand_qty,  s.demand_qty,
           b.opening_qty, s.opening_qty
      from core.fn_projection(p_item_id, '{}'::jsonb) b
      full join core.fn_projection(p_item_id, v_params) s on s.period = b.period
     order by 1;
end;
$$;

comment on function core.simulate_scenario(text, jsonb) is
  'renew.prd 25.2 — 기간별 Base vs 시나리오. 읽기 전용(stable)이며 실제 데이터를 바꾸지 않습니다';

revoke all on function core.simulate_scenario(text, jsonb) from public, anon;
grant execute on function core.simulate_scenario(text, jsonb) to authenticated;

-- ── 4-2. 요약 (KPI 카드) ───────────────────────────────────────
--
-- 반환 jsonb
--   { base:     { stockout_date, safety_stock, order_qty, required_order_date, risk, … },
--     scenario: { …같은 키 },
--     params_applied: { 적용된 키만 + ignored: [알 수 없는 키] },
--     data_snapshot_at }
--
-- ★ 알 수 없는 키를 조용히 버리지 않습니다. params_applied.ignored 에 담아 화면이 보여 줍니다.
--   오타 하나("demandpct")로 아무 일도 일어나지 않았는데 시나리오를 돌렸다고 믿는 것이
--   가장 나쁩니다.
create or replace function core.simulate_scenario_summary(p_item_id text, p_params jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_params  jsonb;
  v_base    jsonb;
  v_scen    jsonb;
  v_applied jsonb := '{}'::jsonb;
  v_ignored jsonb;
  v_item    text;
  v_name    text;
  v_supp    text;
begin
  if core.is_sales() is distinct from false then
    raise exception '영업 사용자는 시나리오 시뮬레이션을 사용할 수 없습니다';
  end if;

  v_params := case when jsonb_typeof(p_params) = 'object' then p_params else '{}'::jsonb end;
  v_item   := upper(regexp_replace(coalesce(p_item_id, ''), '[\s\-_]', '', 'g'));

  select im.item_name, im.supplier_id
    into v_name, v_supp
    from core.v_item_master im
   where im.item_id = v_item
     and im.is_active = 'Y';

  -- 알 수 없는 키. jsonb_object_keys 는 set-returning 이라 from 절에서 씁니다 (공통규칙 12).
  select coalesce(jsonb_agg(k.key order by k.key), '[]'::jsonb)
    into v_ignored
    from jsonb_object_keys(v_params) as k(key)
   where k.key not in ('demand_pct', 'lead_time_days', 'lead_time_pct', 'open_po_delay_days',
                       'service_level', 'supplier_unavailable',
                       'extra_order_qty', 'extra_order_period',
                       'promotion_pct', 'promotion_period');

  -- 실제로 읽힌 값만 담습니다. 값이 숫자가 아니어서 못 읽었으면 여기에도 없습니다.
  if core.wi_num(v_params, 'demand_pct') is not null then
    v_applied := v_applied || jsonb_build_object('demand_pct', core.wi_num(v_params, 'demand_pct'));
  end if;
  if core.wi_num(v_params, 'lead_time_days') is not null then
    v_applied := v_applied || jsonb_build_object('lead_time_days', core.wi_num(v_params, 'lead_time_days'));
  end if;
  if core.wi_num(v_params, 'lead_time_pct') is not null then
    v_applied := v_applied || jsonb_build_object('lead_time_pct', core.wi_num(v_params, 'lead_time_pct'));
  end if;
  if core.wi_num(v_params, 'open_po_delay_days') is not null then
    v_applied := v_applied || jsonb_build_object('open_po_delay_days', core.wi_num(v_params, 'open_po_delay_days'));
  end if;
  if core.wi_num(v_params, 'service_level') is not null then
    v_applied := v_applied || jsonb_build_object('service_level', core.wi_num(v_params, 'service_level'));
  end if;
  if core.wi_bool(v_params, 'supplier_unavailable') is not null then
    v_applied := v_applied || jsonb_build_object('supplier_unavailable', core.wi_bool(v_params, 'supplier_unavailable'));
  end if;
  if core.wi_num(v_params, 'extra_order_qty') is not null then
    v_applied := v_applied || jsonb_build_object('extra_order_qty', core.wi_num(v_params, 'extra_order_qty'));
  end if;
  if core.wi_month(v_params, 'extra_order_period') is not null then
    v_applied := v_applied || jsonb_build_object('extra_order_period', core.wi_month(v_params, 'extra_order_period'));
  end if;
  if core.wi_num(v_params, 'promotion_pct') is not null then
    v_applied := v_applied || jsonb_build_object('promotion_pct', core.wi_num(v_params, 'promotion_pct'));
  end if;
  if core.wi_month(v_params, 'promotion_period') is not null then
    v_applied := v_applied || jsonb_build_object('promotion_period', core.wi_month(v_params, 'promotion_period'));
  end if;

  v_applied := v_applied || jsonb_build_object('ignored', v_ignored);

  v_base := core.fn_scenario_summary(p_item_id, '{}'::jsonb);
  v_scen := core.fn_scenario_summary(p_item_id, v_params);

  return jsonb_build_object(
    'item_id',          v_item,
    'item_name',        v_name,
    'supplier_id',      v_supp,
    'found',            coalesce((v_base ->> 'found')::boolean, false),
    'base',             v_base,
    'scenario',         v_scen,
    'params_applied',   v_applied,
    'data_snapshot_at', v_base -> 'data_snapshot_at'
  );
end;
$$;

comment on function core.simulate_scenario_summary(text, jsonb) is
  'renew.prd 25.2 — Base 와 시나리오의 요약을 같은 키로 나란히. 읽기 전용(stable)입니다. '
  '알 수 없는 파라미터 키는 params_applied.ignored 에 담깁니다';

revoke all on function core.simulate_scenario_summary(text, jsonb) from public, anon;
grant execute on function core.simulate_scenario_summary(text, jsonb) to authenticated;

-- ══ 5. 실행 기록 ═══════════════════════════════════════════════
--
-- 누가 어떤 가정을 시험했는지는 남깁니다. **결과는 저장하지 않습니다** —
-- 같은 파라미터를 다시 넣으면 그때의 데이터로 다시 계산되어야 하고,
-- 저장한 숫자가 지금 데이터와 어긋나면 어느 쪽이 맞는지 알 수 없기 때문입니다.
--
-- 이 표에 쓰는 것은 앱의 Server Action 입니다. 계산 함수는 쓰지 않습니다 (renew.prd 25.2).

create table if not exists core.what_if_log (
  id               bigserial   primary key,
  item_id          text        not null,
  params           jsonb       not null default '{}'::jsonb,
  -- 자연어로 물어본 경우 원문. 파라미터만으로는 "무엇을 알고 싶었는지" 가 남지 않습니다
  natural_language text,
  asked_by         uuid        references auth.users(id) on delete set null,
  asked_email      text,
  asked_at         timestamptz not null default now()
);

create index if not exists what_if_log_item_idx on core.what_if_log (item_id, asked_at desc);
create index if not exists what_if_log_asked_idx on core.what_if_log (asked_at desc);

comment on table core.what_if_log is
  'renew.prd 25 — What-If 실행 기록 (감사 · 재현용). 결과는 저장하지 않습니다';

-- ══ 6. 권한 ════════════════════════════════════════════════════

grant select, insert on core.what_if_log to authenticated;
revoke all on core.what_if_log from anon;
grant usage, select on sequence core.what_if_log_id_seq to authenticated;
revoke all on sequence core.what_if_log_id_seq from anon;

alter table core.what_if_log enable row level security;

-- 자기 기록과 관리자만 봅니다. 남이 무엇을 시험해 봤는지는 보이지 않습니다.
drop policy if exists what_if_log_read_own on core.what_if_log;
create policy what_if_log_read_own on core.what_if_log
  for select to authenticated
  using (asked_by = auth.uid() or core.is_admin());

-- 남의 이름으로 기록을 심을 수 없습니다 (renew.prd 31.1).
drop policy if exists what_if_log_insert_self on core.what_if_log;
create policy what_if_log_insert_self on core.what_if_log
  for insert to authenticated
  with check (asked_by = auth.uid());

-- 기록은 고치거나 지우지 않습니다. update · delete 정책을 두지 않습니다.

-- ══ 7. 확인 ════════════════════════════════════════════════════
--
-- ★★ 가장 중요한 확인 — **Base 가 뷰와 같은가**
--
--   빈 params 로 돌린 Base 가 analytics.v_stockout_risk · v_safety_stock ·
--   v_purchase_recommendation 과 다르면, 그 위에 세운 시나리오는 전부 장식입니다.
--   아래 select 가 **0행**이어야 합니다.

-- ① 함수·표가 생겼는지
select 'core.fn_projection'              as object,
       to_regprocedure('core.fn_projection(text,jsonb)')              is not null as exists
union all
select 'core.fn_scenario_summary',
       to_regprocedure('core.fn_scenario_summary(text,jsonb)')        is not null
union all
select 'core.simulate_scenario',
       to_regprocedure('core.simulate_scenario(text,jsonb)')          is not null
union all
select 'core.simulate_scenario_summary',
       to_regprocedure('core.simulate_scenario_summary(text,jsonb)')  is not null
union all
select 'core.what_if_log',
       to_regclass('core.what_if_log')                                is not null;

-- ② 네 함수가 전부 stable 인가 (renew.prd 25.2 — 쓰기가 구조적으로 불가능해야 합니다)
--    provolatile: i=immutable · s=stable · v=volatile. 전부 's' 여야 합니다.
select p.proname, p.provolatile
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core'
   and p.proname in ('fn_projection', 'fn_scenario_summary',
                     'simulate_scenario', 'simulate_scenario_summary')
 order by p.proname;

-- ★★ 아래 ③~⑥ 은 **주석 처리해 두었습니다.** 이 파일에 붙여 두면 안 됩니다.
--
--   이유 — 이 네 확인은 품목마다 시뮬레이션을 다시 돌립니다. 20개 품목 기준
--   30~55초가 걸리고, Supabase SQL Editor 는 그 전에 끊습니다:
--     Error: SQL query ran into an upstream timeout
--   DDL 자체는 1초도 안 걸리는데, 확인 쿼리 때문에 **파일 전체가 실패**합니다.
--   error.md #22 와 같은 교훈입니다 — 파일의 일은 DDL 이고, 비싸거나 권한이
--   필요한 일은 붙여넣기 밖에 둡니다.
--
--   ★ 그래도 ③ 과 ④ 는 이 단계에서 **가장 중요한 확인**입니다.
--     빈 params 로 돌린 Base 가 뷰와 다르면 그 위에 세운 시나리오는 전부 장식입니다.
--     파일을 적용한 뒤, 아래 블록을 **하나씩 따로** 실행해 0행인지 보세요.
--     한 번에 하나면 30초 안에 끝납니다. 그래도 끊기면 psql 로 직접 붙거나
--     Supabase 대시보드에서 statement timeout 을 잠시 올리세요.
--
--   로컬에서 한 번에 확인하려면 (운영 DB 에 붙지 않습니다):
--     scripts/sql-verify/run.sh

-- -- ③ ★ Base = 뷰. 여기가 0행이어야 합니다.
-- --    simulate_scenario_summary 가 아니라 core.fn_scenario_summary 를 직접 부릅니다.
-- --    앞의 것은 Base 와 시나리오를 둘 다 계산하는데, 여기서 볼 것은 Base 뿐이라
-- --    품목 수만큼 전개를 두 번씩 돌게 됩니다. 감싼 함수는 확인 ⑥ 이 봅니다.
-- with s as (
--   select r.item_id,
--          core.fn_scenario_summary(r.item_id, '{}'::jsonb) as base
--     from analytics.v_stockout_risk r
-- ),
-- cmp as (
--   select s.item_id,
--          (s.base ->> 'stockout_date')::date        as fn_stockout_date,
--          r.stockout_date                           as view_stockout_date,
--          s.base ->> 'risk'                         as fn_risk,
--          r.risk_status                             as view_risk,
--          coalesce(s.base ->> 'reason', '')         as fn_reason,
--          coalesce(r.reason, '')                    as view_reason,
--          (s.base ->> 'safety_stock')::numeric      as fn_safety_stock,
--          ss.safety_stock                           as view_safety_stock,
--          (s.base ->> 'order_qty')::numeric         as fn_order_qty,
--          pr.final_recommended_qty                  as view_order_qty,
--          (s.base ->> 'required_order_date')::date  as fn_required_order_date,
--          pr.required_order_date                    as view_required_order_date,
--          -- ★ 여기부터 여섯 쌍은 AI 툴(lib/agent/tools.ts 의 simulateScenario)이
--          --   numbers 로 내보내는 값입니다. Guardrail 이 답변에 허용하는 숫자가
--          --   바로 이것들이라, 뷰와 어긋나면 사람이 보는 화면과 AI 가 말하는 값이
--          --   갈라집니다. 그래서 요약이 내보내는 열 가지를 전부 대조합니다.
--          --
--          -- ★ daily_demand · sigma_dlt 만 round(x, 10) 으로 감쌉니다.
--          --   값은 같은데 numeric 의 scale 이 달라 19번째 소수 자리부터 어긋나기 때문입니다
--          --   (§6 의 오류 #23 — 같은 공식을 함수로 옮길 때 생기는 자릿수 차이).
--          --   10자리면 실제 드리프트는 잡고 자릿수 잡음은 흡수합니다.
--          --   나머지 네 개는 정수에 가까운 값이라 그대로 비교합니다.
--          round((s.base ->> 'daily_demand')::numeric, 10)   as fn_daily_demand,
--          round(ss.daily_demand::numeric, 10)               as view_daily_demand,
--          round((s.base ->> 'sigma_dlt')::numeric, 10)      as fn_sigma_dlt,
--          round(ss.sigma_dlt::numeric, 10)                  as view_sigma_dlt,
--          -- 창 수요 = 리드타임+검토 구간의 적용수요. 뷰에서는 consensus_forecast 입니다
--          -- (sql/16 609행 — v_stockout_risk.leadtime_demand_qty 를 그대로 받습니다).
--          (s.base ->> 'window_demand_qty')::numeric as fn_window_demand_qty,
--          pr.consensus_forecast                     as view_window_demand_qty,
--          (s.base ->> 'raw_order_qty')::numeric     as fn_raw_order_qty,
--          pr.raw_recommended_qty                    as view_raw_order_qty,
--          (s.base ->> 'z_value')::numeric           as fn_z_value,
--          ss.z_value                                as view_z_value,
--          (s.base ->> 'current_stock')::numeric     as fn_current_stock,
--          pr.current_inventory                      as view_current_stock
--     from s
--     join analytics.v_stockout_risk            r  on r.item_id  = s.item_id
--     left join analytics.v_safety_stock        ss on ss.item_id = s.item_id
--     left join analytics.v_purchase_recommendation pr on pr.item_id = s.item_id
-- )
-- select c.*
--   from cmp c
--  where c.fn_stockout_date        is distinct from c.view_stockout_date
--     or c.fn_risk                 is distinct from c.view_risk
--     or c.fn_reason               is distinct from c.view_reason
--     or c.fn_safety_stock         is distinct from c.view_safety_stock
--     or c.fn_order_qty            is distinct from c.view_order_qty
--     or c.fn_required_order_date  is distinct from c.view_required_order_date
--     or c.fn_daily_demand         is distinct from c.view_daily_demand
--     or c.fn_sigma_dlt            is distinct from c.view_sigma_dlt
--     or c.fn_window_demand_qty    is distinct from c.view_window_demand_qty
--     or c.fn_raw_order_qty        is distinct from c.view_raw_order_qty
--     or c.fn_z_value              is distinct from c.view_z_value
--     or c.fn_current_stock        is distinct from c.view_current_stock
--  order by c.item_id;
--
-- -- ④ ★ Base 전개 = analytics.v_inventory_projection. 여기도 0행이어야 합니다.
-- with fp as (
--   select p.item_id,
--          f.period, f.opening_qty, f.receipt_qty, f.demand_qty, f.closing_qty
--     from (select distinct ip.item_id from analytics.v_inventory_projection ip) p
--     cross join lateral core.fn_projection(p.item_id, '{}'::jsonb) f
-- )
-- -- 한쪽에만 있는 행도 나오므로 키는 coalesce 로 씁니다 (안 그러면 어느 품목인지 안 보입니다).
-- select coalesce(fp.item_id, v.item_id) as item_id,
--        coalesce(fp.period,  v.period)  as period,
--        fp.opening_qty as fn_opening, v.opening_qty as view_opening,
--        fp.receipt_qty as fn_receipt, v.receipt_qty as view_receipt,
--        fp.demand_qty  as fn_demand,  v.demand_qty  as view_demand,
--        fp.closing_qty as fn_closing, v.closing_qty as view_closing
--   from fp
--   full join analytics.v_inventory_projection v
--     on v.item_id = fp.item_id and v.period = fp.period
-- -- ★ 한쪽에만 있는 행을 먼저 봅니다.
-- --   full join 이라 짝이 없으면 반대쪽 네 열이 전부 null 인데, 있는 쪽도 네 값이
-- --   모두 null 이면 아래 네 비교가 전부 거짓이 되어 그 행이 조용히 빠집니다
-- --   (재고 행이 없어 전개가 전부 null 인 품목이 그렇습니다).
-- --   기간이 통째로 빠지거나 남는 것이야말로 이 확인이 잡아야 할 어긋남입니다.
--  where fp.item_id is null
--     or v.item_id  is null
--     or fp.opening_qty is distinct from v.opening_qty
--     or fp.receipt_qty is distinct from v.receipt_qty
--     or fp.demand_qty  is distinct from v.demand_qty
--     or fp.closing_qty is distinct from v.closing_qty
--  order by 1, 2;
--
-- -- ⑤ 한 품목을 눈으로. 시나리오가 실제로 달라지는지 봅니다
-- --    (수요 +20% · 리드타임 60일 · 입고 20일 지연).
-- select w.*
--   from analytics.v_stockout_risk r
--   cross join lateral core.simulate_scenario(
--     r.item_id,
--     '{"demand_pct": 20, "lead_time_days": 60, "open_po_delay_days": 20}'::jsonb) w
--  where r.item_id = (select r2.item_id
--                       from analytics.v_stockout_risk r2
--                      where r2.risk_status <> 'CALCULATION_UNAVAILABLE'
--                      order by r2.stockout_days nulls last
--                      limit 1)
--  order by w.period
--  limit 24;
--
-- -- ⑥ 같은 품목의 요약. base 와 scenario 가 나란히 나옵니다
-- select jsonb_pretty(core.simulate_scenario_summary(
--          (select r2.item_id
--             from analytics.v_stockout_risk r2
--            where r2.risk_status <> 'CALCULATION_UNAVAILABLE'
--            order by r2.stockout_days nulls last
--            limit 1),
--          '{"demand_pct": 20, "lead_time_days": 60, "open_po_delay_days": 20, "typo_key": 1}'::jsonb));

-- ⑦ 실행 기록은 앱이 씁니다. 여기서는 표가 비어 있는 것만 확인합니다
select count(*) as what_if_log_rows from core.what_if_log;
