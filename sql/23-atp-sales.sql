-- ★ 영업 가림막 — core.is_sales() 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- STEP 17 · 영업 SCM Agent — ATP + Soft Allocation
--
-- renew.prd 27장 · 4.5(정보 접근 범위) · 28.3(영업용 화면)
--   "Available to Promise = Current Available Inventory
--      + Confirmed Incoming before Target Date
--      − Committed Demand − Soft Allocation − Protected Safety Stock"        (27.3)
--   "Soft Allocation 차감이 핵심이다. 재고 500개가 있어도 300개가 이미 약속되어
--    있으면 실제로 팔 수 있는 건 200개다."                                      (27.3)
--   "가예약 수량은 ATP에서 차감되어 이중 약속을 방지한다."                        (27.6)
--   "조달 단가 · 공급처 상세 · 리드타임 통계 · 예측 정확도 — 영업 ✕"              (4.5)
--
-- ★ 계산은 전부 여기(SQL)서 합니다. TypeScript 는 조회·표시만 합니다.
--   ATP 는 "지금 팔아도 되는가" 를 묻는 값이라, 화면과 AI Agent 와 API 가
--   같은 숫자를 내야 합니다 (renew.prd 32).
--
-- 여기서 만드는 것
--   core       is_sales()                    영업 사용자 판정 (department 규칙)
--   core       policy_config 시드            ATP_PROTECT_SAFETY_STOCK
--   core       v_item_substitute             대체품 마스터 (정규화 + 품목명)
--   core       sales_inquiry                 문의 이력 (renew.prd 27.7)
--   core       check_order_feasibility()     ★ 읽기 전용. 데이터를 바꾸지 않습니다
--   core       create_soft_allocation()      ★ 유일한 쓰기. 현재 ATP 를 넘으면 거부
--   core       confirm_soft_allocation()     RESERVED → CONFIRMED
--   core       release_soft_allocation()     → RELEASED
--   core       release_expired_allocations() 만료 일괄 해제 (cron 이 부릅니다)
--   core       record_sales_inquiry()        문의 한 건 기록
--   analytics  v_atp ★                       품목 × 4구간 ATP
--   analytics  v_sales_supply_status         영업용 수급 상태 (renew.prd 28.3)
--   analytics  v_sales_promise_risk          납기 전 확보 불가 확정 수주
--   analytics  v_soft_allocation             내 가예약 (+ 남은 일수)
--   analytics  v_sales_inquiry               내 문의 이력
--   analytics  v_sales_inquiry_stats         품목별 최근 30일 문의 통계
--
-- 먼저 실행할 파일
--   sql/03-auth.sql   core.app_user · core.is_admin()
--   sql/06-core-extend.sql   core.policy_config · core.soft_allocation · raw.sales_order ·
--                            raw.item_substitute
--   sql/15-inventory-projection.sql   analytics.v_inventory_projection · v_stockout_risk
--   sql/16-safety-stock-recommendation.sql   analytics.v_safety_stock
--   (sql/20-alert.sql 을 이미 돌렸다면 이 파일 뒤에 한 번 더 돌리세요.
--    core.sales_inquiry 가 생겨야 INQUIRY_SPIKE 룰이 살아납니다 — sql/20 §룰 12.)
--
-- 다시 실행해도 안전합니다 — create table if not exists · create or replace ·
-- drop policy if exists 만 씁니다. 뷰는 컬럼을 빼지 않으므로 drop 하지 않습니다.
--
-- ★ error.md #11 — RETURNS TABLE 의 컬럼 이름은 함수 안에서 변수가 됩니다.
--   본문에서 테이블 컬럼을 참조할 때는 항상 별칭을 붙입니다.
-- ★ error.md #20 — 세 값 논리를 조건식에 흘리지 않습니다. 정책값이 없으면
--   조용히 보호를 끄지 않고 산출 불가로 드러냅니다.
-- ★ error.md #22 — 파일 끝 확인 블록에는 읽기 전용 select 만 둡니다.
--   쓰기 함수(create/confirm/release)는 여기서 부르지 않습니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 영업 사용자 판정 ════════════════════════════════════════
--
-- 지금 Role 은 ADMIN · USER 둘뿐입니다 (renew.prd 4.1 "향후 확장").
-- 영업 구분은 core.app_user.department 로 합니다.
--
--   ★ 규칙 — department 가 '영업' 으로 시작하거나 대문자로 'SALES' 를 포함하면 영업 사용자.
--     예) '영업1팀' · '영업기획' · 'Sales Planning' · 'SALES'  → 영업
--         '구매팀' · 'SCM' · 'Supply Chain'                     → 영업 아님
--
--   같은 규칙이 앱에도 있습니다 — lib/auth.ts 의 isSalesUser(user).
--   두 곳을 함께 고치세요. 한쪽만 바꾸면 화면과 DB 의 판정이 갈립니다.

create or replace function core.is_sales()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  -- ★ btrim 은 앱(lib/agent/redact.ts 의 isSalesDepartment)이 trim() 후에 견주기
  --   때문입니다. 한쪽만 다듬으면 department 가 ' 영업2팀' 인 사람이 화면에서는 영업이고
  --   DB 에서는 아닌, 규칙이 두 벌인 상태가 됩니다.
  select coalesce(
    (select btrim(u.department) <> ''
        and (btrim(u.department) like '영업%' or upper(btrim(u.department)) like '%SALES%')
       from core.app_user u
      where u.user_id = auth.uid()
        and u.active
        and u.department is not null),
    false);
$$;

comment on function core.is_sales() is
  'renew.prd 4.5 — 영업 사용자 판정. department 가 ''영업'' 으로 시작하거나 SALES 를 포함. '
  '같은 규칙이 lib/auth.ts 의 isSalesUser 에 있습니다';

revoke all on function core.is_sales() from public, anon;
grant execute on function core.is_sales() to authenticated;

-- ══ 2. 정책값 ══════════════════════════════════════════════════
--
-- renew.prd 27.3 의 Protected Safety Stock 을 켤지 끌지입니다.
-- 1 이면 안전재고를 ATP 에서 빼고(= 안전재고는 팔지 않습니다), 0 이면 빼지 않습니다.
--
-- ★ 이 행을 지우지 마세요. 없으면 "보호할지 말지" 를 알 수 없으므로 ATP 를 내지 않습니다.
--   0 으로 간주해 조용히 보호를 꺼 버리면, 안전재고까지 팔아 놓고 아무도 모릅니다
--   (error.md #20 과 같은 취지 — 빠진 설정은 드러나야 합니다).

insert into core.policy_config (key, value_num, unit, description) values
  ('ATP_PROTECT_SAFETY_STOCK', 1, '1/0',
   'ATP 에서 안전재고를 보호할지. 1=보호(안전재고는 팔지 않음) · 0=미보호. renew.prd 27.3')
on conflict (key) do nothing;

-- ══ 3. 대체품 뷰 ═══════════════════════════════════════════════
--
-- renew.prd 26.2 getAlternativeItems · 27.2 "대체품 있어?"
-- raw 는 앱에서 직접 읽지 않으므로(error.md #9) core 뷰로 감싸고, 품목코드를
-- 다른 core 뷰와 같은 규칙으로 정규화합니다.

create or replace view core.v_item_substitute as
select upper(regexp_replace(coalesce(s.item_id, ''), '[\s\-_]', '', 'g'))            as item_id,
       im.item_name,
       upper(regexp_replace(coalesce(s.substitute_item_id, ''), '[\s\-_]', '', 'g')) as substitute_item_id,
       sub.item_name                                                                 as substitute_item_name,
       sub.is_active                                                                 as substitute_is_active,
       s.priority,
       s.note
  from raw.item_substitute s
  left join core.v_item_master im
         on im.item_id = upper(regexp_replace(coalesce(s.item_id, ''), '[\s\-_]', '', 'g'))
  left join core.v_item_master sub
         on sub.item_id = upper(regexp_replace(coalesce(s.substitute_item_id, ''), '[\s\-_]', '', 'g'));

comment on view core.v_item_substitute is
  'renew.prd 7.8 · 26.2 — 대체품 마스터. 단가·공급처를 담지 않으므로 영업도 볼 수 있습니다';

-- ══ 4. 문의 이력 ═══════════════════════════════════════════════
--
-- renew.prd 27.7 — "질의 일시 · 질의자 · 품목 · 요청 수량 · 요청 납기 ·
--                   시스템 답변 · 응답 상태 · 가예약 여부 · 최종 수주 여부"
--
-- ★ sql/20-alert.sql 의 룰 12(INQUIRY_SPIKE)가 이 표를 봅니다. 그 룰은
--   item_id 와 (inquiry_date | inquired_at | asked_at | created_at) 중 하나를 찾습니다.
--   여기서 asked_at 을 쓰므로 sql/20 을 다시 실행하면 룰이 살아납니다.

create table if not exists core.sales_inquiry (
  inquiry_id         bigserial   primary key,
  asked_by           uuid        references auth.users(id) on delete set null,
  asked_email        text,
  asked_at           timestamptz not null default now(),
  item_id            text,
  requested_qty      numeric,
  requested_date     date,
  question           text,
  -- renew.prd 27.4 의 4상태. 툴이 아직 판정하지 못한 문의는 null 입니다.
  answer_status      text
    check (answer_status is null
           or answer_status in ('AVAILABLE', 'CONDITIONALLY_AVAILABLE', 'UNAVAILABLE', 'UNKNOWN')),
  answer             jsonb,
  soft_allocation_id bigint      references core.soft_allocation(allocation_id) on delete set null,
  converted_to_order boolean     not null default false
);

create index if not exists sales_inquiry_item_idx    on core.sales_inquiry (item_id, asked_at desc);
create index if not exists sales_inquiry_asked_idx   on core.sales_inquiry (asked_by, asked_at desc);
create index if not exists sales_inquiry_asked_at_idx on core.sales_inquiry (asked_at desc);

comment on table core.sales_inquiry is
  'renew.prd 27.7 — 영업 문의 이력. 자주 문의되는 품목은 수요 증가 신호입니다';

-- ══ 5. analytics.v_atp ★ ═══════════════════════════════════════
--
-- renew.prd 27.3 — 품목 × 4구간.
--
--   NOW      즉시 가능       현재 ATP
--   2W       2주 내 가능     + 2주 내 입고예정
--   1M       1개월 내 가능   + 1개월 내 입고예정
--   BEYOND   그 이후         신규 발주 시 리드타임 반영
--
-- ★ BEYOND 의 atp_qty 는 항상 null 입니다.
--   "그 이후" 는 지금 있는 재고로 답하는 값이 아니라 "발주하면 언제 확보되는가" 입니다.
--   숫자를 하나 적어 두면 영업이 그 수량을 약속합니다. 대신 날짜만 냅니다
--   (earliest_new_supply_date). AGENTS.md 규칙 5 — 계산 불가를 숫자로 채우지 않습니다.
--
-- ★ 입고예정은 core.v_inbound_qty 의 earliest_eta 하나만 봅니다.
--   그 뷰는 품목별로 진행 중 선적을 합쳐 두어 선적별 ETA 를 갖고 있지 않습니다.
--   그래서 "가장 이른 ETA 가 구간 안에 들어오면 그 품목의 입고예정 전량" 으로 셉니다.
--   낙관적인 셈법입니다 — 뒤에 오는 배까지 앞으로 당겨 셉니다. 선적 단위 ETA 가
--   필요해지면 core.v_inbound_qty 를 선적별로 늘리고 이 뷰의 join 을 바꾸세요.
--
-- ★ 가예약과 안전재고는 구간과 무관하게 같은 값을 뺍니다.
--   가예약은 지금 잡혀 있는 약속이고, 안전재고는 어느 시점에도 지켜야 하는 바닥입니다.

create or replace view analytics.v_atp as
with pol as (
  -- ★ 두 행이 다 필요합니다. 없으면 아래 reason 이 산출 불가로 드러냅니다.
  select max(pc.value_num) filter (where pc.key = 'ATP_PROTECT_SAFETY_STOCK') as protect_safety_stock,
         max(pc.value_num) filter (where pc.key = 'DELIVERY_BUFFER_DAYS')     as delivery_buffer_days
    from core.policy_config pc
),
buckets as (
  -- bucket_until 이 null 인 BEYOND 는 "상한 없음" 입니다.
  select b.bucket, b.bucket_ord, b.bucket_until
    from (values
      ('NOW'::text,    1, current_date),
      ('2W'::text,     2, current_date + 14),
      ('1M'::text,     3, (current_date + interval '1 month')::date),
      ('BEYOND'::text, 4, null::date)
    ) b(bucket, bucket_ord, bucket_until)
),
item as (
  select i.item_id, i.item_name, i.supplier_id
    from core.v_item_master i
   where i.is_active = 'Y'
),
so as (
  -- 확정 수주. 품목코드는 core 뷰와 같은 규칙으로 정규화합니다 (sql/15 의 so CTE 와 동일).
  -- ★ 납기가 이미 지난 확정 수주도 셉니다. 출하하지 않았다면 그 재고는 여전히 남의 것입니다.
  select upper(regexp_replace(coalesce(s.item_id, ''), '[\s\-_]', '', 'g')) as item_id,
         s.due_date,
         s.qty
    from raw.sales_order s
   where s.status = 'CONFIRMED'
     and s.due_date is not null
     and s.qty is not null
),
alloc as (
  -- 가예약. 유효기간이 지난 것은 이미 풀린 것으로 봅니다 (renew.prd 27.6 · sql/15 와 동일).
  select upper(regexp_replace(coalesce(a.item_id, ''), '[\s\-_]', '', 'g')) as item_id,
         sum(a.qty)                                                        as soft_qty
    from core.soft_allocation a
   where a.status = 'RESERVED'
     and a.valid_until >= current_date
   group by 1
),
snap as (
  select p.item_id, max(p.data_snapshot_at) as data_snapshot_at
    from analytics.v_inventory_projection p
   group by p.item_id
),
raw_grid as (
  select it.item_id,
         it.item_name,
         b.bucket,
         b.bucket_ord,
         b.bucket_until,
         soh.current_stock                                    as available_now,
         -- 구간 상한까지 도착하는 입고예정. BEYOND(상한 없음)는 전량입니다.
         coalesce(
           case when ib.earliest_eta is not null
                 and (b.bucket_until is null or ib.earliest_eta <= b.bucket_until)
                then ib.inbound_qty end, 0)                    as confirmed_incoming,
         coalesce(
           (select sum(s.qty)
              from so s
             where s.item_id = it.item_id
               and (b.bucket_until is null or s.due_date <= b.bucket_until)), 0)
                                                               as committed_demand,
         coalesce(al.soft_qty, 0)                              as soft_allocation,
         pol.protect_safety_stock,
         ss.safety_stock,
         ss.reason                                             as safety_stock_reason,
         le.effective_lead_time                                as lead_time,
         -- ★ 신뢰도는 표본 수에서 나온 **리드타임 통계**입니다 (core.v_leadtime_stat 의
         --   n_samples >= 30 → HIGH · >= 10 → MEDIUM · 그 밖 LOW). renew.prd 4.5 는
         --   리드타임 통계를 영업에게 ✕ 로 둡니다. 27.5 가 요구하는 "다섯 번 중 한 번은
         --   지연" 안내는 신뢰도 등급이 아니라 DELIVERY_BUFFER_DAYS 로 합니다.
         --
         --   뷰 안에서 막는 이유는 이 뷰가 authenticated 전체에 열려 있어, 앱을 거치지
         --   않고 PostgREST 로 직접 읽어도 같은 답이 나와야 하기 때문입니다.
         --   컬럼을 없애지 않고 null 로 두는 것은 이 뷰를 이미 읽고 있는 STEP 19 의
         --   /api/v1/atp 응답 모양을 깨지 않으려는 것입니다.
         case when core.is_sales() then null else st.confidence end
                                                               as lead_time_confidence,
         pol.delivery_buffer_days,
         sn.data_snapshot_at
    from item it
    cross join buckets b
    cross join pol
    left join core.v_stock_on_hand      soh on soh.item_id     = it.item_id
    left join core.v_inbound_qty        ib  on ib.item_id      = it.item_id
    left join alloc                     al  on al.item_id      = it.item_id
    left join analytics.v_safety_stock  ss  on ss.item_id      = it.item_id
    left join core.v_leadtime_effective le  on le.supplier_id  = it.supplier_id
    left join core.v_leadtime_stat      st  on st.supplier_id  = it.supplier_id
    left join snap                      sn  on sn.item_id      = it.item_id
),
scored as (
  select g.*,
         -- 판정 우선순위. 하나라도 걸리면 ATP 를 내지 않습니다.
         --
         -- ★ 두 번째 분기(정책값 없음)에 INSUFFICIENT_SAMPLE 을 쓰는 이유.
         --   사유 코드는 lib/status.ts 의 다섯 종뿐이라 새 코드를 만들지 않습니다
         --   (sql/16 의 v_safety_stock 이 z_value 누락에 대해 내린 판단과 같습니다).
         --   ATP_PROTECT_SAFETY_STOCK 행은 이 파일이 심으므로 정상 설치에서는 걸리지 않습니다.
         case
           when g.available_now is null                then 'NO_INVENTORY_DATA'
           when g.protect_safety_stock is null         then 'INSUFFICIENT_SAMPLE'
           when g.protect_safety_stock >= 1
                and g.safety_stock is null
                then coalesce(g.safety_stock_reason, 'INSUFFICIENT_SAMPLE')
           else null
         end as reason_calc,
         case when g.protect_safety_stock >= 1 then g.safety_stock else 0 end
                                                       as protected_safety_stock_calc
    from raw_grid g
)
select s.item_id,
       s.item_name,
       s.bucket,
       s.bucket_ord,
       s.bucket_until,
       s.available_now,
       s.confirmed_incoming,
       s.committed_demand,
       s.soft_allocation,
       case when s.reason_calc is null then s.protected_safety_stock_calc end
         as protected_safety_stock,
       -- renew.prd 27.3 의 식 그대로. 음수는 0 입니다 — 이미 초과 약속된 상태이지
       -- "마이너스만큼 더 팔 수 있다" 가 아닙니다.
       case
         when s.reason_calc is not null then null
         when s.bucket = 'BEYOND'       then null
         else greatest(0, s.available_now
                          + s.confirmed_incoming
                          - s.committed_demand
                          - s.soft_allocation
                          - s.protected_safety_stock_calc)
       end                                                     as atp_qty,
       -- BEYOND 전용. 지금 발주하면 리드타임 + 여유일 뒤에 받습니다 (renew.prd 27.5).
       case when s.bucket = 'BEYOND'
             and s.lead_time is not null
             and s.delivery_buffer_days is not null
            then current_date + s.lead_time + s.delivery_buffer_days::int
       end                                                     as earliest_new_supply_date,
       s.lead_time,
       s.lead_time_confidence,
       s.delivery_buffer_days,
       s.data_snapshot_at,
       s.reason_calc                                           as reason
  from scored s;

comment on view analytics.v_atp is
  'renew.prd 27.3 — 품목 × 4구간 ATP. BEYOND 의 atp_qty 는 항상 null 이고 날짜만 냅니다';

-- ══ 6. core.check_order_feasibility ★ ══════════════════════════
--
-- renew.prd 27.5 — 반환 키를 PRD 그대로 씁니다.
--
-- ★ 이 함수는 데이터를 바꾸지 않습니다. 조회만 합니다.
--   영업이 "받을 수 있어?" 를 여러 번 물어도 재고가 잠기지 않아야 합니다.
--   잠그려면 create_soft_allocation 을 따로 부릅니다 (renew.prd 27.6).
--
-- ★ 예외를 던지지 않습니다. 어떤 입력이 와도 jsonb 한 덩이를 돌려줍니다.
--   raise 를 쓰면 SQL 파일 끝의 확인 select 한 줄이 파일 전체를 되돌립니다 (error.md #22).
--
-- ★ earliest_safe_date 의 여유일 (renew.prd 27.5)
--   P80 은 다섯 번 중 한 번은 지연된다는 뜻입니다. 그대로 고객에게 안내하면
--   20% 확률로 약속을 어깁니다. 그래서 DELIVERY_BUFFER_DAYS 를 얹어 안내합니다.
--   BEYOND 의 earliest_new_supply_date 에는 이미 여유일이 들어 있어 다시 더하지 않습니다.

create or replace function core.check_order_feasibility(
  p_item_id     text,
  p_qty         numeric,
  p_target_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_item          text := upper(regexp_replace(coalesce(p_item_id, ''), '[\s\-_]', '', 'g'));
  v_target        date := coalesce(p_target_date, current_date);
  v_buffer        numeric;
  v_review        numeric;
  -- ★ analytics.v_atp 를 딱 한 번만 훑고 4구간을 jsonb 사전으로 들고 있습니다.
  --   구간마다 따로 select 하면 v_atp 밑의 v_safety_stock · v_inventory_projection 이
  --   네 번 다시 계산됩니다. 화면 한 장에서 여러 품목을 물으면 그대로 곱해집니다.
  v_all           jsonb;
  v_row           jsonb;    -- 요청 납기가 걸리는 구간
  v_beyond        jsonb;    -- BEYOND 구간 (신규 발주 안내용)
  v_bucket        text;
  v_atp           numeric;
  v_basis         numeric;  -- 실제로 견줄 수량 (BEYOND 는 1M 구간의 ATP)
  v_basis_bucket  text;
  v_safe_from     date;     -- 요청 수량이 확보되는 가장 이른 날 (여유일 전)
  v_earliest_safe date;
  v_lead          int;
  v_horizon_end   date;     -- 이 날까지의 전개만 봅니다 (아래 주석)
  v_worst         numeric;  -- 그 창 안에서 가장 낮은 기말재고
  v_after         numeric;  -- 이 주문을 받으면 남는 최저 재고
  v_safety        numeric;
  v_status        text;
  v_risk          text;
  v_feasible      boolean := false;
  v_reason        text;
begin
  if v_item = '' then
    return jsonb_build_object(
      'status', 'UNKNOWN', 'feasible', false,
      'available_qty', null, 'requested_qty', p_qty,
      'projected_inventory_after_order', null, 'safety_stock', null,
      'risk', 'CALCULATION_UNAVAILABLE', 'earliest_safe_date', null,
      'lead_time_used', null, 'lead_time_confidence', null,
      'data_snapshot_at', null, 'reason', 'NO_INVENTORY_DATA');
  end if;

  select max(pc.value_num) filter (where pc.key = 'DELIVERY_BUFFER_DAYS'),
         max(pc.value_num) filter (where pc.key = 'REVIEW_PERIOD_DAYS')
    into v_buffer, v_review
    from core.policy_config pc;

  select jsonb_object_agg(a.bucket, to_jsonb(a)) into v_all
    from analytics.v_atp a
   where a.item_id = v_item;

  if v_all is null then
    -- 품목 자체가 없습니다 (마스터에 없거나 비활성).
    return jsonb_build_object(
      'status', 'UNKNOWN', 'feasible', false,
      'available_qty', null, 'requested_qty', p_qty,
      'projected_inventory_after_order', null, 'safety_stock', null,
      'risk', 'CALCULATION_UNAVAILABLE', 'earliest_safe_date', null,
      'lead_time_used', null, 'lead_time_confidence', null,
      'data_snapshot_at', null, 'reason', 'NO_INVENTORY_DATA');
  end if;

  v_beyond := v_all -> 'BEYOND';

  -- 요청 납기가 걸리는 구간 — 상한이 납기 이상인 것 중 가장 이른 것.
  -- 어느 구간에도 안 들어가면(1개월 밖) BEYOND 입니다.
  v_bucket := case
                when v_target <= (v_all -> 'NOW' ->> 'bucket_until')::date then 'NOW'
                when v_target <= (v_all -> '2W'  ->> 'bucket_until')::date then '2W'
                when v_target <= (v_all -> '1M'  ->> 'bucket_until')::date then '1M'
                else 'BEYOND'
              end;
  v_row    := v_all -> v_bucket;
  v_reason := v_row ->> 'reason';
  v_atp    := (v_row ->> 'atp_qty')::numeric;
  v_safety := (v_row ->> 'protected_safety_stock')::numeric;
  v_lead   := (v_row ->> 'lead_time')::int;

  -- ★ 한 달 밖 납기를 "판단 불가" 로 두지 않습니다.
  --
  --   BEYOND 구간의 atp_qty 는 일부러 null 입니다 (뷰 §5 주석 — 숫자를 적어 두면
  --   영업이 그 수량을 약속합니다). 그런데 상태 분기가 그 null 을 먼저 보면,
  --   지금 재고가 넉넉한 품목도 90일 뒤 요청에는 답을 못 냅니다. 실제로 그랬습니다 —
  --   즉시 1,997 개가 있는 품목이 90일 뒤 100개 요청에 UNKNOWN 을 냈습니다.
  --
  --   납기가 멀수록 약속하기 **쉬워야** 합니다. 그래서 BEYOND 는 지금 확보된 수량 중
  --   가장 넓은 값(1M 구간의 ATP)을 기준으로 견줍니다. 신규 발주분은 여기에 더하지
  --   않습니다 — 아직 내지 않은 발주를 팔지 않기 위해서입니다. 그 몫은
  --   earliest_new_supply_date 가 따로 말합니다.
  if v_bucket = 'BEYOND' then
    v_basis        := (v_all -> '1M' ->> 'atp_qty')::numeric;
    v_basis_bucket := '1M';
    if v_safety is null then
      v_safety := (v_all -> '1M' ->> 'protected_safety_stock')::numeric;
    end if;
  else
    v_basis        := v_atp;
    v_basis_bucket := v_bucket;
  end if;

  -- 요청 수량이 확보되는 가장 이른 날. 구간을 이른 것부터 봅니다.
  v_safe_from := case
    when p_qty is null or p_qty <= 0 then null
    when (v_all -> 'NOW' ->> 'atp_qty')::numeric >= p_qty
         then (v_all -> 'NOW' ->> 'bucket_until')::date
    when (v_all -> '2W'  ->> 'atp_qty')::numeric >= p_qty
         then (v_all -> '2W'  ->> 'bucket_until')::date
    when (v_all -> '1M'  ->> 'atp_qty')::numeric >= p_qty
         then (v_all -> '1M'  ->> 'bucket_until')::date
  end;

  if v_safe_from is not null and v_buffer is not null then
    v_earliest_safe := v_safe_from + v_buffer::int;
  elsif v_safe_from is not null then
    v_earliest_safe := v_safe_from;                                 -- 여유일 정책값이 없습니다
  else
    v_earliest_safe := (v_beyond ->> 'earliest_new_supply_date')::date;  -- 여유일이 이미 들어 있습니다
  end if;

  -- ── 이 주문을 받으면 재고가 어디까지 내려가는가 ──────────
  --
  -- ★ 전개 전체(12개월)를 보지 않습니다. 리드타임 + 검토 주기까지만 봅니다.
  --   전개에는 앞으로 낼 발주가 들어 있지 않아, 재고가 넉넉한 품목도 12개월 끝에서는
  --   반드시 음수가 됩니다. 전 구간을 보면 어떤 주문도 AVAILABLE 이 될 수 없습니다.
  --   그 창은 결품 판정(analytics.v_stockout_risk)이 쓰는 창과 같습니다 (renew.prd 19.3) —
  --   그 너머의 음수는 "이 주문을 받으면 안 되는 이유" 가 아니라 "발주를 내야 하는 이유" 입니다.
  if v_lead is not null and v_review is not null then
    v_horizon_end := current_date + v_lead + v_review::int;

    select min(p.closing_qty) into v_worst
      from analytics.v_inventory_projection p
     where p.item_id = v_item
       and p.period <= v_horizon_end;
  end if;

  if v_worst is not null and p_qty is not null then
    v_after := v_worst - p_qty;
  end if;

  -- ── 판정 (renew.prd 27.4) ────────────────────────────────
  if v_reason is not null or v_basis is null or p_qty is null or p_qty <= 0 then
    -- 사유 코드를 지어내지 않습니다. reason 이 null 인 UNKNOWN 은 요청 수량이 비었거나
    -- 0 이하인 경우뿐입니다 — 부르는 쪽이 requested_qty 로 압니다.
    v_status   := 'UNKNOWN';
    v_risk     := 'CALCULATION_UNAVAILABLE';
    v_feasible := false;
  elsif v_basis >= p_qty and coalesce(v_after, 0) >= 0 then
    v_status   := 'AVAILABLE';
    v_feasible := true;
  elsif v_basis >= p_qty then
    -- 수량은 되지만 커버 구간 안에서 전개가 음수로 갑니다. 받되 후속 조치가 필요합니다.
    v_status   := 'CONDITIONALLY_AVAILABLE';
    v_feasible := true;
  elsif v_basis > 0 or v_earliest_safe is not null then
    -- 일부만 가능하거나, 납기를 미루면 가능합니다.
    v_status   := 'CONDITIONALLY_AVAILABLE';
    v_feasible := false;
  else
    v_status   := 'UNAVAILABLE';
    v_feasible := false;
  end if;

  if v_risk is null then
    v_risk := case
                when v_after is null                              then 'CALCULATION_UNAVAILABLE'
                when v_after < 0                                  then 'CRITICAL'
                when v_safety is not null and v_after < v_safety  then 'WARNING'
                else 'SAFE'
              end;
  end if;

  return jsonb_build_object(
    'status',                          v_status,
    'feasible',                        v_feasible,
    'available_qty',                   v_basis,
    'requested_qty',                   p_qty,
    'projected_inventory_after_order', v_after,
    'safety_stock',                    v_safety,
    'risk',                            v_risk,
    'earliest_safe_date',              v_earliest_safe,
    'lead_time_used',                  v_lead,
    'lead_time_confidence',            v_row ->> 'lead_time_confidence',
    'data_snapshot_at',                v_row ->> 'data_snapshot_at',
    'reason',                          v_reason,
    -- PRD 밖이지만 설명에 꼭 필요한 것들. 영업 금지 항목(단가·공급처)은 없습니다.
    'item_id',                         v_row ->> 'item_id',
    'item_name',                       v_row ->> 'item_name',
    'bucket',                          v_bucket,
    'bucket_until',                    v_row ->> 'bucket_until',
    -- available_qty 를 어느 구간에서 가져왔나. BEYOND 요청이면 '1M' 입니다 (위 주석).
    'available_qty_bucket',            v_basis_bucket,
    'target_date',                     v_target,
    'atp_now',                         (v_all -> 'NOW' ->> 'atp_qty')::numeric,
    'atp_2w',                          (v_all -> '2W'  ->> 'atp_qty')::numeric,
    'atp_1m',                          (v_all -> '1M'  ->> 'atp_qty')::numeric,
    'confirmed_incoming',              (v_row ->> 'confirmed_incoming')::numeric,
    'committed_demand',                (v_row ->> 'committed_demand')::numeric,
    'soft_allocation',                 (v_row ->> 'soft_allocation')::numeric,
    'earliest_new_supply_date',        v_beyond ->> 'earliest_new_supply_date',
    'delivery_buffer_days',            v_buffer,
    'projection_horizon_end',          v_horizon_end
  );
end;
$$;

comment on function core.check_order_feasibility(text, numeric, date) is
  'renew.prd 27.5 — 수주 가능 판정. 읽기 전용이며 예외를 던지지 않습니다';

revoke all on function core.check_order_feasibility(text, numeric, date) from public, anon;
grant execute on function core.check_order_feasibility(text, numeric, date) to authenticated;

-- ══ 7. 가예약 쓰기 함수 ════════════════════════════════════════
--
-- renew.prd 27.6 — 가예약 · 확정 · 해제.
--
-- ★ create_soft_allocation 은 이 시스템에서 ATP 를 줄이는 유일한 쓰기입니다.
--   그래서 현재 ATP(NOW 구간)를 넘는 예약을 거부합니다. 넘게 두면 두 영업이
--   같은 재고를 각각 약속하고, 뒤에 온 쪽이 출하 직전에 알게 됩니다.
--
-- ★★ 품목별 자문 잠금이 왜 필요한가 — 읽고-확인하고-쓰는 사이의 틈
--
--   ATP 를 읽고 insert 하기까지의 사이에 잠금이 없으면, 두 세션이 **같은 ATP 를 읽고
--   각각 통과합니다.** READ COMMITTED 에서는 상대 트랜잭션의 미커밋 insert 가 보이지
--   않기 때문입니다. 실제로 재현됩니다 — ATP 1,997 인 품목에 두 세션이 동시에 1,997 을
--   요청하면 둘 다 ok=true 로 서로 다른 예약 번호를 받아 3,994 가 잡힙니다.
--   renew.prd 27.6 이 막으려던 이중 약속 바로 그것입니다.
--
--   제약(check · unique)으로는 막을 수 없습니다. 조건이 "이 품목의 RESERVED 합계가
--   그 품목의 ATP 이하" 라는 여러 행에 걸친 술어이고, PostgreSQL 에 그런 제약은 없습니다.
--   그래서 품목 단위 자문 잠금을 겁니다. 트랜잭션이 끝나면 자동으로 풀립니다(_xact_).
--
--   ★ 잠금은 ATP 를 **읽기 전에** 겁니다. 읽은 뒤에 걸면 이미 낡은 값을 손에 쥔 뒤라
--     틈이 그대로 남습니다.
--   ★ 잠그는 것은 품목 하나뿐입니다. 다른 품목의 예약은 서로 기다리지 않습니다.
--   ★ 앱은 이 보장을 이 함수에 맡깁니다 (lib/atp.ts · app/(user)/sales/actions.ts 주석).
--     여기서 막지 않으면 다른 어디에서도 막지 않습니다.

create or replace function core.create_soft_allocation(
  p_item_id    text,
  p_qty        numeric,
  p_valid_days int  default null,
  p_customer   text default null
)
returns table (ok boolean, allocation_id bigint, valid_until date, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_uid    uuid := auth.uid();
  v_item   text := upper(regexp_replace(coalesce(p_item_id, ''), '[\s\-_]', '', 'g'));
  v_days   int;
  v_atp    numeric;
  v_reason text;
  v_until  date;
  v_id     bigint;
begin
  if v_uid is null then
    return query select false, null::bigint, null::date, '로그인이 필요합니다'::text;
    return;
  end if;

  if v_item = '' then
    return query select false, null::bigint, null::date, '품목코드가 없습니다'::text;
    return;
  end if;

  if p_qty is null or p_qty <= 0 then
    return query select false, null::bigint, null::date, '수량은 0보다 커야 합니다'::text;
    return;
  end if;

  -- ★ 여기서부터 이 품목의 예약은 한 번에 하나씩만 지납니다 (파일 머리 §7 주석).
  --   hashtext 는 bigint 를 내므로 품목코드가 그대로 잠금 키가 됩니다.
  --   충돌(다른 품목이 같은 해시)이 나도 결과는 옳습니다 — 잠깐 더 기다릴 뿐입니다.
  perform pg_advisory_xact_lock(hashtext('soft_alloc:' || v_item));

  -- 유효기간. 인자가 없으면 정책값(SOFT_ALLOCATION_DAYS)을 씁니다 (AGENTS.md 규칙 13).
  v_days := p_valid_days;
  if v_days is null then
    select max(pc.value_num)::int into v_days
      from core.policy_config pc
     where pc.key = 'SOFT_ALLOCATION_DAYS';
  end if;

  if v_days is null or v_days <= 0 then
    return query select false, null::bigint, null::date,
                        '가예약 유효기간을 정할 수 없습니다 (core.policy_config 의 SOFT_ALLOCATION_DAYS 확인)'::text;
    return;
  end if;

  -- 지금 팔 수 있는 수량. 여기서 이미 다른 가예약이 빠져 있습니다.
  select a.atp_qty, a.reason into v_atp, v_reason
    from analytics.v_atp a
   where a.item_id = v_item
     and a.bucket = 'NOW';

  if not found then
    return query select false, null::bigint, null::date,
                        (v_item || ' 는 품목 마스터에 없습니다')::text;
    return;
  end if;

  if v_atp is null then
    return query select false, null::bigint, null::date,
                        ('가용 수량을 산출할 수 없어 예약하지 않았습니다 (' ||
                         coalesce(v_reason, 'NO_INVENTORY_DATA') || ')')::text;
    return;
  end if;

  if p_qty > v_atp then
    return query select false, null::bigint, null::date,
                        ('가용 ' || core.fmt_qty(v_atp) || ' 를 초과합니다 (요청 ' ||
                         core.fmt_qty(p_qty) || ')')::text;
    return;
  end if;

  v_until := current_date + v_days;

  insert into core.soft_allocation as sa
         (item_id, qty, status, requested_by, customer, valid_until)
  values (v_item, p_qty, 'RESERVED', v_uid, nullif(btrim(coalesce(p_customer, '')), ''), v_until)
  returning sa.allocation_id into v_id;

  return query select true, v_id, v_until,
                      ('가예약 ' || v_id || ' · ' || to_char(v_until, 'YYYY-MM-DD') || ' 까지')::text;
end;
$$;

comment on function core.create_soft_allocation(text, numeric, int, text) is
  'renew.prd 27.6 — 가예약 생성. 현재 ATP 를 넘으면 거부합니다';

create or replace function core.confirm_soft_allocation(p_allocation_id bigint)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_stat  text;
begin
  if v_uid is null then
    return query select false, '로그인이 필요합니다'::text;
    return;
  end if;

  select sa.requested_by, sa.status into v_owner, v_stat
    from core.soft_allocation sa
   where sa.allocation_id = p_allocation_id;

  if not found then
    return query select false, '가예약을 찾을 수 없습니다'::text;
    return;
  end if;

  if not (v_owner = v_uid or coalesce(core.is_admin(), false)) then
    return query select false, '본인 가예약만 확정할 수 있습니다'::text;
    return;
  end if;

  if v_stat <> 'RESERVED' then
    return query select false, ('이미 ' || v_stat || ' 상태입니다')::text;
    return;
  end if;

  update core.soft_allocation as sa
     set status = 'CONFIRMED'
   where sa.allocation_id = p_allocation_id;

  -- renew.prd 27.7 "최종 수주 여부" — 이 예약을 만든 문의를 수주 전환으로 표시합니다.
  -- 이 줄이 없으면 analytics.v_sales_inquiry_stats 의 conversion_rate 가 영원히 0 이고,
  -- "문의 대비 수주 전환율로 예측 반영 비중을 판단한다" 가 성립하지 않습니다.
  update core.sales_inquiry as si
     set converted_to_order = true
   where si.soft_allocation_id = p_allocation_id
     and si.converted_to_order = false;

  return query select true, '수주 확정으로 전환했습니다'::text;
end;
$$;

create or replace function core.release_soft_allocation(p_allocation_id bigint)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_stat  text;
begin
  if v_uid is null then
    return query select false, '로그인이 필요합니다'::text;
    return;
  end if;

  select sa.requested_by, sa.status into v_owner, v_stat
    from core.soft_allocation sa
   where sa.allocation_id = p_allocation_id;

  if not found then
    return query select false, '가예약을 찾을 수 없습니다'::text;
    return;
  end if;

  if not (v_owner = v_uid or coalesce(core.is_admin(), false)) then
    return query select false, '본인 가예약만 해제할 수 있습니다'::text;
    return;
  end if;

  if v_stat = 'RELEASED' then
    return query select false, '이미 해제된 가예약입니다'::text;
    return;
  end if;

  update core.soft_allocation as sa
     set status      = 'RELEASED',
         released_at = now()
   where sa.allocation_id = p_allocation_id;

  return query select true, '가예약을 해제했습니다'::text;
end;
$$;

-- renew.prd 27.6 "유효기간 경과 시 자동 해제한다."
--
-- ★ 문 두 개를 지납니다 — core.scan_alerts 와 **똑같은 방식**입니다 (sql/20 §…).
--     ① 관리자인가
--     ② p_secret 이 DB 의 app.cron_secret 과 같은가
--   ②가 필요한 이유는 스케줄러 요청(app/api/cron/scan-alerts)에 로그인 세션이 없어
--   auth.uid() 가 null 이기 때문입니다.
--
--   인자 없이 anon 에게 열어 두었다가 되돌렸습니다. "만료된 것만 푼다" 는 무해해 보이지만,
--   공개 anon 키를 가진 누구나 이 쓰기를 반복해 돌릴 수 있고 그것은 쓰기 루프입니다.
--   설정이 빠졌을 때 열려 있는 상태를 만들지 않습니다.
--
-- ★ error.md #20 — 세 값 논리를 조건식에 흘리지 않습니다.
--   current_setting(..., true) 는 설정이 없으면 null 이고, `p_secret = null` 은 false 가
--   아니라 null 이라 `if not (...)` 이 분기를 타지 않습니다. 그래서 허용 플래그를
--   false 로 시작해 확실한 boolean 으로만 좁힙니다.
-- ★ 인자 없는 옛 시그니처를 먼저 지웁니다. p_secret 에 기본값이 있어 두 함수가 함께
--   있으면 core.release_expired_allocations() 호출이 모호해집니다.
drop function if exists core.release_expired_allocations();
drop function if exists core.release_expired_allocations(text);

create or replace function core.release_expired_allocations(p_secret text default null)
returns table (ok boolean, n_released int, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_n       int := 0;
  v_allowed boolean := false;
  v_cfg     text;
begin
  v_allowed := coalesce(core.is_admin(), false);

  if not v_allowed then
    v_cfg := current_setting('app.cron_secret', true);
    if v_cfg is not null and p_secret is not null then
      v_allowed := coalesce(p_secret = v_cfg, false);
    end if;
  end if;

  if not v_allowed then
    -- ok 를 따로 두는 이유 — 0건 해제와 권한 거부는 둘 다 n_released = 0 입니다.
    -- 부르는 쪽(cron 라우트)이 그 둘을 구별하지 못하면 비밀값 설정이 빠진 것을
    -- "만료된 예약이 없다" 로 읽고 조용히 넘어갑니다.
    return query select false, 0, '가예약 만료 해제 권한이 없습니다'::text;
    return;
  end if;

  with done as (
    update core.soft_allocation as sa
       set status      = 'RELEASED',
           released_at = now()
     where sa.status = 'RESERVED'
       and sa.valid_until < current_date
    returning 1
  )
  select count(*)::int into v_n from done;

  return query select true, v_n,
                      case when v_n = 0 then '만료된 가예약이 없습니다'
                           else '만료된 가예약 ' || v_n || '건을 해제했습니다' end::text;
end;
$$;

comment on function core.release_expired_allocations(text) is
  'renew.prd 27.6 — 유효기간이 지난 가예약을 일괄 해제합니다. 관리자이거나 p_secret 이 '
  'app.cron_secret 과 같아야 합니다. cron 이 알림 스캔 전에 부릅니다';

-- ══ 8. 문의 기록 함수 ══════════════════════════════════════════
--
-- 영업 툴이 불릴 때마다 한 줄 남깁니다 (renew.prd 27.7).
-- ★ 반환 컬럼 inquiry_id 가 함수 안에서 변수가 되므로 테이블 참조는 전부 별칭입니다
--   (error.md #11). 그래서 insert ... returning 도 지역 변수로 받습니다.

create or replace function core.record_sales_inquiry(
  p_item_id            text,
  p_requested_qty      numeric default null,
  p_requested_date     date    default null,
  p_question           text    default null,
  p_answer_status      text    default null,
  p_answer             jsonb   default null,
  p_soft_allocation_id bigint  default null
)
returns table (ok boolean, inquiry_id bigint, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_item   text := nullif(upper(regexp_replace(coalesce(p_item_id, ''), '[\s\-_]', '', 'g')), '');
  v_status text;
  v_id     bigint;
begin
  if v_uid is null then
    return query select false, null::bigint, '로그인이 필요합니다'::text;
    return;
  end if;

  -- 모르는 상태 문자열은 저장하지 않고 버립니다. check 제약에 걸려 문의 자체가
  -- 남지 않는 것보다, 상태만 비워 두고 기록을 남기는 편이 낫습니다.
  v_status := case when p_answer_status in
                        ('AVAILABLE', 'CONDITIONALLY_AVAILABLE', 'UNAVAILABLE', 'UNKNOWN')
                   then p_answer_status end;

  select au.email into v_email from core.app_user au where au.user_id = v_uid;

  insert into core.sales_inquiry as si
         (asked_by, asked_email, item_id, requested_qty, requested_date,
          question, answer_status, answer, soft_allocation_id)
  values (v_uid, v_email, v_item, p_requested_qty, p_requested_date,
          nullif(btrim(coalesce(p_question, '')), ''), v_status, p_answer, p_soft_allocation_id)
  returning si.inquiry_id into v_id;

  return query select true, v_id, '문의를 기록했습니다'::text;
end;
$$;

-- ══ 9. analytics 뷰 — 영업용 ═══════════════════════════════════
--
-- ★ renew.prd 4.5 — 이 절의 뷰에는 단가 · 발주 금액 · 공급처 상세 ·
--   리드타임 통계(P50/P80/P90 · 표본 수 · 표준편차) · 예측 정확도 컬럼이 없습니다.
--   영업이 화면에서 보든 AI 툴로 받든 같은 뷰를 지납니다.
--
--   lead_time 하나만 남깁니다 — "언제 받을 수 있나" 를 답하려면 필요하고,
--   그것은 4.5 의 "예상 입고일 ○" 에 해당합니다. 분위수와 표본 수는 내지 않습니다.

-- renew.prd 28.3 — 품목별 수급 상태
create or replace view analytics.v_sales_supply_status as
with atp as (
  -- ★ v_atp 를 한 번만 훑고 구간을 가로로 폅니다. bucket 별로 네 번 join 하면
  --   그 밑의 v_safety_stock · v_inventory_projection 이 네 번 다시 계산됩니다.
  select a.item_id,
         max(a.item_name)                                                  as item_name,
         max(a.atp_qty)  filter (where a.bucket = 'NOW')                   as atp_now,
         max(a.atp_qty)  filter (where a.bucket = '2W')                    as atp_2w,
         max(a.atp_qty)  filter (where a.bucket = '1M')                    as atp_1m,
         max(a.earliest_new_supply_date)                                   as earliest_new_supply_date,
         max(a.lead_time)                                                  as lead_time,
         max(a.reason)   filter (where a.bucket = 'NOW')                   as atp_reason,
         max(a.data_snapshot_at)                                           as data_snapshot_at
    from analytics.v_atp a
   group by a.item_id
)
select r.item_id,
       r.item_name,
       -- v_stockout_risk 의 4상태를 영업 표현으로 옮깁니다 (renew.prd 28.3).
       --
       -- ★ status 와 atp_* 는 서로 다른 질문에 답합니다. 함께 읽어야 합니다.
       --   status  는 앞으로의 수급 전망입니다 — '불가' 는 리드타임 안에 결품이 온다는 뜻이지
       --           "지금 한 대도 못 판다" 가 아닙니다.
       --   atp_now 는 지금 약속해도 되는 수량입니다.
       --   그래서 '불가' 인데 atp_now 가 0보다 큰 조합이 정상적으로 나옵니다 —
       --   "지금 있는 건 팔 수 있지만 다음 물량이 늦다" 입니다. 화면이 이것을 함께 보여줍니다.
       case r.risk_status
         when 'SAFE'     then '안전'
         when 'WARNING'  then '주의'
         when 'CRITICAL' then '불가'
         else null
       end                                              as status,
       r.risk_status,
       -- 결품 판정의 사유가 없으면 ATP 쪽 사유를 냅니다. 둘 다 없으면 null 입니다.
       coalesce(r.reason, a.atp_reason)                 as reason,
       a.atp_now,
       a.atp_2w,
       a.atp_1m,
       a.earliest_new_supply_date,
       a.lead_time,
       a.data_snapshot_at
  from analytics.v_stockout_risk r
  left join atp a on a.item_id = r.item_id;

comment on view analytics.v_sales_supply_status is
  'renew.prd 28.3 — 영업용 수급 상태. 단가 · 공급처 · 리드타임 통계 · 정확도 컬럼이 없습니다';

-- renew.prd 28.3 — 납기 위험 수주 건
--
-- 확정 수주를 납기 순으로 누적해 가며, 그 납기까지 확보되는 수량과 견줍니다.
-- 확보 수량 = 현재고 + 그 납기까지 도착하는 입고예정.
--
-- ★ 가예약은 빼지 않습니다. 확정 수주가 가예약보다 앞섭니다 (renew.prd 22.1 의 취지).
--   가예약이 확정 수주를 밀어내면 "이미 판 물건" 이 "팔지도 모르는 물건" 에 밀립니다.
create or replace view analytics.v_sales_promise_risk as
with so as (
  select upper(regexp_replace(coalesce(s.item_id, ''), '[\s\-_]', '', 'g')) as item_id,
         s.so_no,
         s.customer,
         s.due_date,
         s.qty
    from raw.sales_order s
   where s.status = 'CONFIRMED'
     and s.due_date is not null
     and s.qty is not null
),
cum as (
  select o.*,
         sum(o.qty) over (partition by o.item_id order by o.due_date, o.so_no
                          rows between unbounded preceding and current row) as cumulative_committed_qty
    from so o
),
sup as (
  select c.*,
         soh.current_stock
           + coalesce(case when ib.earliest_eta is not null and ib.earliest_eta <= c.due_date
                           then ib.inbound_qty end, 0)                       as supply_by_due_date
    from cum c
    left join core.v_stock_on_hand soh on soh.item_id = c.item_id
    left join core.v_inbound_qty   ib  on ib.item_id  = c.item_id
),
atp as (
  select a.item_id,
         max(a.atp_qty) filter (where a.bucket = 'NOW') as atp_now,
         max(a.earliest_new_supply_date)                as earliest_new_supply_date
    from analytics.v_atp a
   group by a.item_id
)
select s.so_no,
       s.item_id,
       im.item_name,
       s.customer,
       s.due_date,
       s.qty,
       s.cumulative_committed_qty,
       s.supply_by_due_date,
       s.cumulative_committed_qty - s.supply_by_due_date as shortfall_qty,
       (s.due_date - current_date)::int                  as days_to_due,
       a.atp_now,
       a.earliest_new_supply_date
  from sup s
  left join core.v_item_master im on im.item_id = s.item_id
  left join atp a                 on a.item_id  = s.item_id
 where s.supply_by_due_date is not null
   and s.cumulative_committed_qty > s.supply_by_due_date;

comment on view analytics.v_sales_promise_risk is
  'renew.prd 28.3 — 납기까지 재고가 확보되지 않는 확정 수주';

-- 내 가예약 (관리자는 전부)
--
-- ★ 이 프로젝트의 analytics 뷰는 소유자 권한으로 돌아 밑의 RLS 가 적용되지 않습니다.
--   그래서 뷰 안에서 직접 막습니다 (sql/22 의 v_agent_usage 와 같은 판단).
create or replace view analytics.v_soft_allocation as
select sa.allocation_id,
       sa.item_id,
       im.item_name,
       sa.qty,
       sa.status,
       sa.customer,
       sa.valid_until,
       (sa.valid_until - current_date)::int as days_left,
       sa.requested_by,
       au.email                             as requested_email,
       sa.created_at,
       sa.released_at
  from core.soft_allocation sa
  left join core.v_item_master im on im.item_id = sa.item_id
  left join core.app_user      au on au.user_id = sa.requested_by
 where sa.requested_by = auth.uid()
    or core.is_admin();

comment on view analytics.v_soft_allocation is
  'renew.prd 27.6 — 가예약 현황. 본인 것만 보입니다 (관리자는 전부)';

-- 내 문의 이력 (관리자는 전부) — renew.prd 27.7
create or replace view analytics.v_sales_inquiry as
select si.inquiry_id,
       si.asked_by,
       si.asked_email,
       si.asked_at,
       si.item_id,
       im.item_name,
       si.requested_qty,
       si.requested_date,
       si.question,
       si.answer_status,
       si.answer,
       si.soft_allocation_id,
       si.converted_to_order
  from core.sales_inquiry si
  left join core.v_item_master im on im.item_id = si.item_id
 where si.asked_by = auth.uid()
    or core.is_admin();

comment on view analytics.v_sales_inquiry is
  'renew.prd 27.7 — 문의 이력. 본인 것만 보입니다 (관리자는 전부)';

-- 품목별 최근 30일 문의 통계 — renew.prd 27.7
--
-- 개인 문장을 담지 않는 집계라 로그인 사용자 누구나 봅니다.
-- "자주 문의되는 품목은 수요 증가 신호" · "UNAVAILABLE 이 많으면 기회 손실" 을 SCM 이 봅니다.
create or replace view analytics.v_sales_inquiry_stats as
select si.item_id,
       im.item_name,
       count(*)                                                          as n_inquiries,
       count(*) filter (where si.answer_status = 'UNAVAILABLE')          as n_unavailable,
       count(*) filter (where si.answer_status = 'AVAILABLE')            as n_available,
       count(*) filter (where si.converted_to_order)                     as n_converted,
       -- 비율입니다 (0~1). 백분율로 저장하지 않습니다 — 이 프로젝트의 비율은 전부 0~1 입니다.
       round((count(*) filter (where si.converted_to_order))::numeric
             / nullif(count(*), 0), 3)                                   as conversion_rate,
       max(si.asked_at)                                                  as last_asked_at
  from core.sales_inquiry si
  left join core.v_item_master im on im.item_id = si.item_id
 where si.asked_at >= now() - interval '30 days'
   and si.item_id is not null
 group by si.item_id, im.item_name;

comment on view analytics.v_sales_inquiry_stats is
  'renew.prd 27.7 — 품목별 최근 30일 문의 수 · 불가 건수 · 수주 전환율';

-- ══ 10. 권한 ═══════════════════════════════════════════════════
--
-- 쓰기는 위 함수들로만 합니다. 표에는 select 만 줍니다.

grant select on core.sales_inquiry to authenticated;
revoke all on core.sales_inquiry from anon;
grant usage, select on sequence core.sales_inquiry_inquiry_id_seq to authenticated;

alter table core.sales_inquiry enable row level security;

drop policy if exists sales_inquiry_read_own on core.sales_inquiry;
create policy sales_inquiry_read_own on core.sales_inquiry
  for select to authenticated
  using (asked_by = auth.uid() or core.is_admin());

grant select on core.v_item_substitute to authenticated;
revoke all on core.v_item_substitute from anon;

grant select on analytics.v_atp                 to authenticated;
grant select on analytics.v_sales_supply_status to authenticated;
grant select on analytics.v_sales_promise_risk  to authenticated;
grant select on analytics.v_soft_allocation     to authenticated;
grant select on analytics.v_sales_inquiry       to authenticated;
grant select on analytics.v_sales_inquiry_stats to authenticated;

revoke all on analytics.v_atp                 from anon;
revoke all on analytics.v_sales_supply_status from anon;
revoke all on analytics.v_sales_promise_risk  from anon;
revoke all on analytics.v_soft_allocation     from anon;
revoke all on analytics.v_sales_inquiry       from anon;
revoke all on analytics.v_sales_inquiry_stats from anon;

revoke all on function core.create_soft_allocation(text, numeric, int, text) from public, anon;
grant execute on function core.create_soft_allocation(text, numeric, int, text) to authenticated;

revoke all on function core.confirm_soft_allocation(bigint) from public, anon;
grant execute on function core.confirm_soft_allocation(bigint) to authenticated;

revoke all on function core.release_soft_allocation(bigint) from public, anon;
grant execute on function core.release_soft_allocation(bigint) to authenticated;

revoke all on function core.record_sales_inquiry(text, numeric, date, text, text, jsonb, bigint)
  from public, anon;
grant execute on function core.record_sales_inquiry(text, numeric, date, text, text, jsonb, bigint)
  to authenticated;

-- 만료 해제는 스케줄러도 불러야 해서 anon 에게 execute 를 줍니다. 문은 함수 안의
-- p_secret 검사입니다 (core.scan_alerts 와 같은 구조 · 위 §7 주석).
revoke all on function core.release_expired_allocations(text) from public;
grant execute on function core.release_expired_allocations(text) to authenticated, anon;

-- ══ 11. 확인 ═══════════════════════════════════════════════════
--
-- ★ 읽기 전용 select 만 둡니다 (error.md #22).
--   쓰기 함수(create/confirm/release_soft_allocation · record_sales_inquiry ·
--   release_expired_allocations)는 여기서 부르지 않습니다. 로그인 세션에서
--   따로 실행하세요 — 파일 맨 아래에 예시를 주석으로 두었습니다.

-- 만든 것이 다 있는가
select 'core.is_sales'                       as object, to_regprocedure('core.is_sales()')                        is not null as exists
union all select 'core.check_order_feasibility', to_regprocedure('core.check_order_feasibility(text,numeric,date)') is not null
union all select 'core.create_soft_allocation',  to_regprocedure('core.create_soft_allocation(text,numeric,int,text)') is not null
union all select 'core.release_expired_allocations', to_regprocedure('core.release_expired_allocations(text)')        is not null
union all select 'core.sales_inquiry',           to_regclass('core.sales_inquiry')                                is not null
union all select 'core.v_item_substitute',       to_regclass('core.v_item_substitute')                            is not null
union all select 'analytics.v_atp',              to_regclass('analytics.v_atp')                                   is not null
union all select 'analytics.v_sales_supply_status', to_regclass('analytics.v_sales_supply_status')                 is not null
union all select 'analytics.v_sales_promise_risk',  to_regclass('analytics.v_sales_promise_risk')                  is not null
union all select 'analytics.v_soft_allocation',     to_regclass('analytics.v_soft_allocation')                     is not null
union all select 'analytics.v_sales_inquiry',       to_regclass('analytics.v_sales_inquiry')                       is not null
union all select 'analytics.v_sales_inquiry_stats', to_regclass('analytics.v_sales_inquiry_stats')                 is not null;

-- 정책값이 심어졌는가
select pc.key, pc.value_num, pc.unit, pc.description
  from core.policy_config pc
 where pc.key in ('ATP_PROTECT_SAFETY_STOCK', 'SOFT_ALLOCATION_DAYS', 'DELIVERY_BUFFER_DAYS')
 order by pc.key;

-- ATP 4구간 — 품목 3개만
select a.item_id, a.item_name, a.bucket, a.bucket_until,
       a.available_now, a.confirmed_incoming, a.committed_demand,
       a.soft_allocation, a.protected_safety_stock, a.atp_qty,
       a.earliest_new_supply_date, a.lead_time, a.lead_time_confidence, a.reason
  from analytics.v_atp a
 where a.item_id in (select i.item_id from core.v_item_master i
                      where i.is_active = 'Y' order by i.item_id limit 3)
 order by a.item_id, a.bucket_ord;

-- 산출 불가가 얼마나 되는가 (reason 이 있으면 atp_qty 가 없습니다)
select a.reason, count(*) as n
  from analytics.v_atp a
 where a.bucket = 'NOW'
 group by a.reason
 order by n desc;

-- 영업용 수급 상태
select s.item_id, s.item_name, s.status, s.atp_now, s.atp_2w, s.atp_1m,
       s.earliest_new_supply_date, s.reason
  from analytics.v_sales_supply_status s
 order by case s.status when '불가' then 1 when '주의' then 2 when '안전' then 3 else 4 end,
          s.item_id
 limit 20;

-- 납기 위험 수주 (raw.sales_order 가 비어 있으면 0행입니다)
select p.so_no, p.item_id, p.item_name, p.customer, p.due_date, p.qty,
       p.cumulative_committed_qty, p.supply_by_due_date, p.shortfall_qty, p.days_to_due
  from analytics.v_sales_promise_risk p
 order by p.due_date
 limit 20;

-- 수주 가능 판정을 실제로 한 번 실행해 봅니다 (읽기 전용입니다)
select i.item_id,
       core.check_order_feasibility(i.item_id, 100, current_date + 7) as result
  from core.v_item_master i
 where i.is_active = 'Y'
 order by i.item_id
 limit 3;

-- 내 가예약 · 내 문의 (로그인 세션에서 실행하세요. anon 은 auth.uid() 가 null 이라 0행입니다)
select * from analytics.v_soft_allocation order by created_at desc limit 20;
select * from analytics.v_sales_inquiry   order by asked_at   desc limit 20;
select * from analytics.v_sales_inquiry_stats order by n_inquiries desc limit 20;

-- 쓰기 함수를 시험하려면 로그인 세션에서 아래를 따로 실행하세요.
--
--   select * from core.create_soft_allocation('ITEM012', 10, null, '시험 고객');
--   select * from core.confirm_soft_allocation(1);
--   select * from core.release_soft_allocation(1);
--   select * from core.release_expired_allocations();          -- 관리자 세션에서
--   select * from core.record_sales_inquiry('ITEM012', 500, current_date + 14,
--            'X700 500대 가능?', 'CONDITIONALLY_AVAILABLE', '{}'::jsonb, null);
