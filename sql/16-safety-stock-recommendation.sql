-- ★ 영업 가림막 — core.v_item_price · analytics.v_safety_stock · v_purchase_recommendation_kpi 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- STEP 10 · Safety Stock + Purchase Recommendation + SKU Detail
--
-- renew.prd 21장(Safety Stock) · 22장(Purchase Recommendation) · 29장(SKU Detail) · 18.2(신뢰도)
--   "σ_DLT = √( L × σ_d² + d² × σ_L² ) · Safety Stock = Z × σ_DLT"            (21.1)
--   "예측 정확도가 안전재고 두께를 결정한다. 예측이 잘 맞는 품목은 버퍼를 얇게,
--    자주 빗나가는 품목은 두껍게 가져간다."                                     (21.1)
--   "확정 수주가 있으면 예측보다 우선한다."                                     (22.1)
--   "Required Order Date = Stockout Date − Lead Time − Safety Buffer Days"     (22.2)
--
-- 여기서 만드는 것
--   core       service_level              등급별 서비스 수준 · Z · 적용 시작일
--   core       z_table                    서비스 수준 → Z (정규분포 분위수)
--   core       fmt_qty() · reason_label()  설명 문장 조립용 표시 함수
--   core       v_item_service_level       품목별 적용 서비스 수준과 Z (ITEM → GRADE → DEFAULT)
--   core       v_item_price               raw.item_master 의 표준단가를 숫자로
--   analytics  v_consensus_forecast       core.v_consensus_forecast 를 화면에 노출
--   analytics  v_service_level            등급별 서비스 수준 이력 + 오늘 적용 중인 행 표시
--   analytics  v_item_policy              품목 정책 + 적용 중인 서비스 수준
--   analytics  v_demand_window            리드타임+검토주기 창의 수요 (안전재고·발주 추천이 함께 씀)
--   analytics  v_safety_stock ★           σ_DLT 와 안전재고
--   analytics  v_purchase_recommendation ★ 발주 추천 (renew.prd 22.3 의 필드 전부)
--   analytics  v_purchase_recommendation_kpi
--   analytics  v_sku_detail ★             renew.prd 29장 28개 항목의 요약 한 줄
--
-- ★ sql/15-inventory-projection.sql 을 먼저 실행하세요.
--   (analytics.v_stockout_risk · v_inventory_projection · core.v_consensus_forecast 가
--    거기서 만들어집니다.)
--
-- ★ 정책값(서비스 수준 · 검토 주기 · 여유일)은 core.policy_config · core.service_level ·
--   core.item_policy 에서 읽습니다. 이 파일에 숫자를 적지 않습니다 (AGENTS.md · renew.prd 32장).
--   예외는 core.z_table 과 core.service_level 의 시드입니다 — 그건 정책이 아니라 데이터입니다.
--
-- ★★ 다시 실행할 때 (재실행 규칙) — 반드시 읽으세요
--
--   이 파일의 `drop view` 는 전부 **cascade** 입니다. cascade 가 없으면 뒤 번호
--   파일이 이 파일의 뷰 위에 뷰를 만들어 둔 순간부터
--   "cannot drop … because other objects depend on it" 으로 재실행 자체가
--   막혔습니다. 그래서 cascade 를 붙였습니다.
--
--   대신 값을 치릅니다. cascade 는 **뒤 파일이 만든 뷰까지 말없이 함께 지웁니다.**
--   analytics.v_purchase_recommendation 을 지우면 sql/19 의 v_sku_detail ·
--   v_purchase_recommendation_with_approval · v_approval_kpi 가, 그 뒤로
--   sql/21 의 v_dashboard_* 가 같이 사라집니다.
--
--   그래서 규칙은 하나뿐입니다.
--
--       이 파일을 다시 실행했으면, 이 파일보다 번호가 큰 파일을 전부
--       순서대로 다시 실행하세요. (순서는 sql/README.md)
--
--   빠뜨리면 오류는 나지 않고 화면만 조용히 비어 보입니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 테이블 ══════════════════════════════════════════════════

-- renew.prd 21.2 — "SKU 또는 Grade별로 관리한다. item_grade · service_level · z_value · 적용 시작일"
--
-- 적용 시작일을 PK 에 넣는 이유는, 서비스 수준을 올린 시점 이전의 판정을 재현할 수 있어야
-- 하기 때문입니다. 값을 덮어쓰면 "그때 왜 이 안전재고였나" 를 설명할 수 없습니다.
create table if not exists core.service_level (
  item_grade     text    not null,
  service_level  numeric not null,
  z_value        numeric not null,
  effective_from date    not null default current_date,
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (item_grade, effective_from)
);

comment on table core.service_level is
  'renew.prd 21.2 — 등급별 서비스 수준. effective_from 이 오늘 이전인 것 중 가장 최근 값을 씁니다';

-- 시드. 적용 시작일을 과거로 두어 오늘 기준 조회에 항상 걸리게 합니다.
insert into core.service_level (item_grade, service_level, z_value, effective_from) values
  ('A', 0.98, 2.0537, date '2000-01-01'),
  ('B', 0.95, 1.6449, date '2000-01-01'),
  ('C', 0.90, 1.2816, date '2000-01-01')
on conflict (item_grade, effective_from) do nothing;

-- 서비스 수준 → Z. 정규분포 분위수 표입니다.
-- 품목이 직접 지정한 service_level 이 이 표에 없으면 가장 가까운 값의 Z 를 씁니다.
create table if not exists core.z_table (
  service_level numeric primary key,
  z_value       numeric not null
);

insert into core.z_table (service_level, z_value) values
  (0.800, 0.8416),
  (0.850, 1.0364),
  (0.900, 1.2816),
  (0.950, 1.6449),
  (0.975, 1.9600),
  (0.980, 2.0537),
  (0.990, 2.3263),
  (0.995, 2.5758)
on conflict (service_level) do nothing;

comment on table core.z_table is
  'renew.prd 21.1 의 Z. 표에 없는 서비스 수준은 가장 가까운 행의 Z 를 씁니다';

-- ══ 2. 표시 함수 ═══════════════════════════════════════════════
--
-- 발주 추천의 explanation 은 SQL 이 조립합니다 (renew.prd 22.3).
-- 화면·CSV·AI Agent 가 같은 문장을 쓰려면 한 곳에서 만들어야 하기 때문입니다.

-- 수량을 천 단위로 끊어 보여줍니다. null 은 계산 불가 표기(—)와 같게 둡니다.
create or replace function core.fmt_qty(p_value numeric)
returns text
language sql
-- to_char 는 lc_numeric 에 기대므로 immutable 이 아니라 stable 입니다.
stable
as $$
  select case when p_value is null then '—'
              else to_char(round(p_value), 'FM999,999,999,990')
         end;
$$;

-- 사유 코드의 한국어 라벨. lib/status.ts 의 REASON_LABEL 과 같은 문구여야 합니다.
create or replace function core.reason_label(p_code text)
returns text
language sql
immutable
as $$
  select case p_code
           when 'NO_USAGE_HISTORY'   then '사용 이력 없음'
           when 'NO_USAGE'           then '사용 이력 없음'
           when 'NO_LEADTIME'        then '리드타임 미확정'
           when 'NO_INVENTORY_DATA'  then '재고 데이터 없음'
           when 'NO_FORECAST'        then '예측 없음'
           when 'INSUFFICIENT_SAMPLE' then '표본 부족'
           else p_code
         end;
$$;

revoke all on function core.fmt_qty(numeric)     from public, anon;
revoke all on function core.reason_label(text)   from public, anon;
grant execute on function core.fmt_qty(numeric)   to authenticated;
grant execute on function core.reason_label(text) to authenticated;

-- ══ 3. core 뷰 — 서비스 수준 · 단가 ════════════════════════════

-- ★ 이 파일이 만드는 뷰를 의존 순서의 역순으로 먼저 지웁니다.
--   컬럼을 더하거나 빼면 create or replace 가 거부하기 때문입니다 (공통규칙 15).
--   아래 core 뷰(v_item_service_level · v_item_price)에 기대는 뷰들이라
--   core 뷰를 다시 만들기 전에 치워야 합니다.
--
-- ★ 아래 두 줄은 STEP 13(sql/19-approval.sql)이 만드는 뷰입니다. 이 파일이 만드는 뷰가
--   아닌데도 여기서 지우는 이유는, 그 둘이 아래 v_purchase_recommendation 에 기대기
--   때문입니다. 지우지 않으면 v_purchase_recommendation 의 drop 이
--   "cannot drop … because other objects depend on it" 로 **실패합니다.**
--   이 파일은 트랜잭션 밖에서 도므로 그 시점에는 v_sku_detail 이 이미 지워진 뒤라,
--   SKU Detail 과 발주 추천 화면이 죽은 채로 멈춥니다.
--
--   ★★ 그래서 이 파일을 다시 실행하면 **반드시 sql/19-approval.sql 을 이어서 실행하세요.**
--      그러지 않으면 v_sku_detail 에 승인 컬럼이 없고, 발주 추천 화면이 읽는
--      v_purchase_recommendation_with_approval 과 결정 이력 화면의 v_approval_kpi 가
--      아예 없는 상태가 됩니다.
--      (v_approval_kpi 는 v_purchase_recommendation_with_approval 에 기대므로 먼저 지웁니다.)
drop view if exists analytics.v_approval_kpi cascade;
drop view if exists analytics.v_purchase_recommendation_with_approval cascade;
drop view if exists analytics.v_sku_detail cascade;
drop view if exists analytics.v_purchase_recommendation_kpi cascade;
drop view if exists analytics.v_purchase_recommendation cascade;
drop view if exists analytics.v_safety_stock cascade;
drop view if exists analytics.v_demand_window cascade;
drop view if exists analytics.v_item_policy cascade;
drop view if exists analytics.v_service_level cascade;
drop view if exists analytics.v_consensus_forecast cascade;


-- renew.prd 21.2 — 품목별로 적용할 서비스 수준과 Z.
--
-- 우선순위
--   ① core.item_policy.service_level  (품목 직접 지정) → core.z_table 최근접 Z
--   ② core.item_policy.item_grade     → core.service_level 의 오늘 이전 최신 행
--   ③ core.policy_config              SERVICE_LEVEL_DEFAULT · Z_VALUE_DEFAULT
--
-- 셋 다 없으면 service_level 도 z_value 도 null 입니다. 0 이나 임의값으로 채우지 않습니다
-- (AGENTS.md 규칙 5). 그 경우 안전재고는 산출 불가가 됩니다.
--
-- 컬럼을 더하거나 순서를 바꾸면 create or replace 가 거부하므로 먼저 지웁니다 (공통규칙 15).
-- 이 뷰에 기대는 analytics 뷰는 바로 위에서 이미 지웠으므로 cascade 가 필요 없습니다.
drop view if exists core.v_item_service_level cascade;

create view core.v_item_service_level as
with pol as (
  select max(pc.value_num) filter (where pc.key = 'SERVICE_LEVEL_DEFAULT') as sl_default,
         max(pc.value_num) filter (where pc.key = 'Z_VALUE_DEFAULT')       as z_default
    from core.policy_config pc
),
grade as (
  -- 등급마다 오늘 이전에 시작된 것 중 가장 최근 값 하나
  select distinct on (s.item_grade)
         s.item_grade, s.service_level, s.z_value
    from core.service_level s
   where s.effective_from <= current_date
   order by s.item_grade, s.effective_from desc
),
item as (
  select im.item_id,
         ip.item_grade,
         ip.service_level as item_service_level
    from core.v_item_master im
    left join core.item_policy ip on ip.item_id = im.item_id
),
nearest as (
  -- 품목이 직접 지정한 서비스 수준의 Z. 표에 없으면 가장 가까운 행을 씁니다.
  select i.item_id,
         (select z.z_value
            from core.z_table z
           order by abs(z.service_level - i.item_service_level), z.service_level
           limit 1) as z_value
    from item i
   where i.item_service_level is not null
)
select i.item_id,
       i.item_grade,
       coalesce(i.item_service_level, g.service_level, p.sl_default) as service_level,
       coalesce(n.z_value,            g.z_value,       p.z_default)  as z_value,
       case when i.item_service_level is not null then 'ITEM'
            when g.service_level      is not null then 'GRADE'
            else 'DEFAULT'
       end as source
  from item i
  cross join pol p
  left join grade   g on g.item_grade = i.item_grade
  left join nearest n on n.item_id    = i.item_id;

comment on view core.v_item_service_level is
  'renew.prd 21.2 — 품목별 적용 서비스 수준과 Z. ITEM → GRADE → DEFAULT 순으로 정합니다';

-- renew.prd 22.3 — 추천 금액을 내려면 단가가 필요합니다.
--
-- ★ raw 는 앱에서 직접 부르지 않습니다 (error.md #9). 이 core 뷰만 읽습니다.
-- ★ raw.item_master 는 한글 컬럼명을 쓸 수도, 영문 컬럼명을 쓸 수도 있습니다.
--   sql/06-core-extend.sql 의 MOQ · pack_size 이관과 같은 방식으로 후보를 훑습니다.
--   컬럼이 없으면 0행 뷰를 만들어 두어 아래 뷰들이 깨지지 않게 합니다
--   (단가를 모르면 recommended_amount 가 null 이 될 뿐입니다).
--
-- 컬럼 타입이 달라질 수 있어 replace 가 아니라 drop 후 재생성합니다.
-- 이 뷰에 기대는 analytics 뷰는 위에서 이미 지웠으므로 cascade 가 필요 없습니다.
drop view if exists core.v_item_price cascade;

do $$
declare
  code_col  text;
  price_col text;
begin
  select c.column_name into code_col
    from information_schema.columns c
   where c.table_schema = 'raw' and c.table_name = 'item_master'
     and c.column_name in ('item_id', '품목코드', 'item_code', 'ITEM_ID')
   order by array_position(array['item_id', '품목코드', 'item_code', 'ITEM_ID'], c.column_name::text)
   limit 1;

  select c.column_name into price_col
    from information_schema.columns c
   where c.table_schema = 'raw' and c.table_name = 'item_master'
     and c.column_name in ('표준단가', 'unit_price', 'standard_price', '단가')
   order by array_position(array['표준단가', 'unit_price', 'standard_price', '단가'], c.column_name::text)
   limit 1;

  if code_col is null or price_col is null then
    execute 'create view core.v_item_price as
             select null::text as item_id, null::numeric as unit_price where false';
    raise notice 'raw.item_master 에서 품목코드/단가 컬럼을 찾지 못했습니다. 추천 금액은 산출되지 않습니다';
  else
    -- 숫자로 바꿀 수 없는 값(빈 문자열 · 문자 섞임)은 0 이 아니라 null 입니다.
    -- 쉼표와 통화 기호만 걷어내고, 그래도 숫자가 아니면 포기합니다.
    execute format($f$
      create view core.v_item_price as
      select distinct on (s.item_id) s.item_id, s.unit_price
        from (
          select upper(regexp_replace(coalesce(m.%1$I::text, ''), '[\s\-_]', '', 'g')) as item_id,
                 case when btrim(regexp_replace(coalesce(m.%2$I::text, ''), '[,\s₩원]', '', 'g'))
                           ~ '^-?[0-9]+(\.[0-9]+)?$'
                      then btrim(regexp_replace(m.%2$I::text, '[,\s₩원]', '', 'g'))::numeric
                 end as unit_price
            from raw.item_master m
        ) s
       where s.item_id <> ''
       order by s.item_id, s.unit_price nulls last
    $f$, code_col, price_col);
    raise notice '단가를 raw.item_master.% 에서 읽습니다 (품목코드 컬럼 %)', price_col, code_col;
  end if;
end $$;

comment on view core.v_item_price is
  'raw.item_master 의 표준단가. 숫자로 바꿀 수 없으면 null 입니다 (0 으로 채우지 않습니다)';

-- ══ 4. analytics 뷰 ════════════════════════════════════════════

-- ── 4-1. Consensus (SKU Detail §2 가 읽습니다) ────────────────
--
-- core.v_consensus_forecast 는 core 스키마라 화면에서 부르지 않습니다.
-- Override 의 사유 코드를 함께 붙여 analytics 로 노출합니다.
-- Override 입력 폼은 STEP 12 가 붙입니다.
create view analytics.v_consensus_forecast as
select c.item_id,
       im.item_name,
       c.period,
       c.run_id,
       c.model_id,
       c.ai_qty,
       c.override_qty,
       c.consensus_qty,
       c.p80,
       c.p90,
       c.sigma,
       c.has_override,
       o.reason_code,
       o.reason_text,
       o.created_email  as override_email,
       o.created_at     as override_at,
       c.data_snapshot_at,
       c.forecast_source
  from core.v_consensus_forecast c
  left join core.v_item_master im on im.item_id = c.item_id
  left join core.forecast_override o
    on o.item_id = c.item_id
   and o.period  = c.period
   and o.superseded_at is null;

comment on view analytics.v_consensus_forecast is
  'renew.prd 17.1 — AI 예측 + Override = Consensus. SKU Detail 의 Consensus 표가 읽습니다';

-- ── 4-2. 서비스 수준 이력 (관리자 화면이 읽습니다) ─────────────
--
-- core.service_level 은 과거 행을 지우지 않고 쌓습니다. 화면은 그중 어느 행이 지금
-- 적용 중인지 표시해야 하는데, 그 판정을 여기서 냅니다.
--
-- ★ 화면에서 오늘을 다시 계산하지 않는 이유는 is_urgent 와 같습니다.
--   앱 서버는 UTC, DB 는 DB 시간대라 자정 근처에서 하루가 밀립니다.
create view analytics.v_service_level as
select s.item_grade,
       s.service_level,
       s.z_value,
       s.effective_from,
       s.updated_by,
       s.updated_at,
       -- 지금 적용 중인 행인가. 등급마다 "오늘 이전" 중 가장 최근 한 행만 true 입니다.
       -- 적용 중인 행이 아예 없으면 "모른다" 가 아니라 분명히 false 입니다.
       coalesce(
         s.effective_from = (select max(x.effective_from)
                               from core.service_level x
                              where x.item_grade = s.item_grade
                                and x.effective_from <= current_date),
         false)                                          as is_effective,
       -- 미래 날짜로 미리 넣어 둔 행
       (s.effective_from > current_date)                 as is_scheduled
  from core.service_level s;

comment on view analytics.v_service_level is
  'renew.prd 21.2 — 등급별 서비스 수준의 적용 이력. is_effective 가 오늘 적용 중인 행입니다';

-- ── 4-2b. 품목 정책 (관리자 화면이 읽습니다) ───────────────────
create view analytics.v_item_policy as
select ip.item_id,
       im.item_name,
       im.supplier_id,
       ip.item_grade,
       ip.moq,
       ip.pack_size,
       -- 품목이 직접 지정한 값. null 이면 등급/기본값을 씁니다
       ip.service_level as item_service_level,
       sl.service_level as applied_service_level,
       sl.z_value       as applied_z_value,
       sl.source        as service_level_source,
       ip.updated_at
  from core.item_policy ip
  left join core.v_item_master        im on im.item_id = ip.item_id
  left join core.v_item_service_level sl on sl.item_id = ip.item_id;

comment on view analytics.v_item_policy is
  'renew.prd 7.5 · 21.2 — 품목별 MOQ · 포장 단위 · 등급과 실제 적용 중인 서비스 수준';

-- ── 4-3. 커버 구간의 수요 ──────────────────────────────────────
--
-- renew.prd 19.3 — "계획 리드타임이 42일이면 42일 이후까지 커버해야 하는 누적 수요를
--                   기준으로 필요량을 계산한다."
--
-- 안전재고(d)와 발주 추천(창 수요)이 같은 창을 봐야 두 화면의 숫자가 어긋나지 않습니다.
-- 그래서 창을 여기 한 곳에서만 정의하고 두 뷰가 함께 읽습니다.
-- 식은 sql/15 의 analytics.v_stockout_risk 안 `lt` CTE 와 같습니다 — 월 단위 전개를
-- 창에 걸치는 일수만큼 안분해 더합니다. 그래서 demand_qty 는
-- v_stockout_risk.leadtime_demand_qty 와 같은 값이 됩니다.
--
-- ★ 다른 점 하나. 여기는 결품 판정 사유로 막지 않습니다.
--   재고 행이 없는 품목도 예측과 리드타임만 있으면 창 수요는 계산됩니다.
--   안전재고는 재고를 쓰지 않는 값이라, 재고가 없다고 안전재고까지 못 내면
--   사유 코드가 'NO_FORECAST' 라고 거짓말을 하게 됩니다.
--
-- 화면이 직접 읽는 뷰가 아니라 위 두 뷰의 재료입니다.
create view analytics.v_demand_window as
with pol as (
  -- ★ REVIEW_PERIOD_DAYS 가 없으면 창 자체가 잡히지 않습니다.
  --   0 으로 채우지 않습니다 — "검토 주기를 0 으로 뒀다" 와 "정책값이 빠졌다" 는 다릅니다.
  select max(pc.value_num) filter (where pc.key = 'REVIEW_PERIOD_DAYS') as review_period_days
    from core.policy_config pc
),
win as (
  select im.item_id,
         le.effective_lead_time                             as lead_time_days,
         p.review_period_days,
         (le.effective_lead_time + p.review_period_days)     as window_days,
         (current_date
          + (le.effective_lead_time + p.review_period_days)::int)::date as horizon_end
    from core.v_item_master im
    cross join pol p
    join core.v_leadtime_effective le on le.supplier_id = im.supplier_id
   where im.is_active = 'Y'
     and le.effective_lead_time is not null
     and p.review_period_days is not null
)
select w.item_id,
       w.lead_time_days,
       w.review_period_days,
       w.window_days,
       w.horizon_end,
       sum(p.forecast_qty     * s.share) as forecast_qty,
       sum(p.committed_so_qty * s.share) as committed_qty,
       -- 적용수요 = greatest(예측, 확정수주) + 가예약. 확정 수주가 예측보다 우선합니다
       -- (renew.prd 22.1). 그 정의는 sql/15 의 v_inventory_projection.demand_qty 에 있습니다.
       sum(p.demand_qty       * s.share) as demand_qty
  from win w
  join analytics.v_inventory_projection p on p.item_id = w.item_id
  cross join lateral (
    select greatest(0,
             least(w.horizon_end, (p.period + interval '1 month')::date - 1)
             - greatest(current_date, p.period) + 1)::numeric
           / ((p.period + interval '1 month')::date - p.period)::numeric as share
  ) s
 group by w.item_id, w.lead_time_days, w.review_period_days, w.window_days, w.horizon_end;

comment on view analytics.v_demand_window is
  'renew.prd 19.3 — 오늘부터 (리드타임 + 검토주기) 까지의 수요. 안전재고와 발주 추천의 공통 재료';

-- ── 4-4. 안전재고 ★ ───────────────────────────────────────────
--
-- renew.prd 21.1
--   σ_DLT = √( L × σ_d² + d² × σ_L² )
--   Safety Stock = Z × σ_DLT
--
--   L    계획 리드타임          core.v_leadtime_effective.effective_lead_time
--   σ_d  수요 예측 오차 표준편차 ① 백테스트 RMSE ② 예측이 낸 in-sample σ
--   d    일평균 수요            리드타임+검토주기 창의 적용수요 ÷ 그 일수
--   σ_L  리드타임 표준편차      core.v_leadtime_stat.std_days
--   Z    Service Level 계수     core.v_item_service_level
create view analytics.v_safety_stock as
-- ★ 아래 세 `materialized` CTE 는 성능을 위한 울타리입니다. **결과를 바꾸지 않습니다.**
--   빼면 계획기가 이 뷰들을 Nested Loop 안쪽에 놓고 품목 수만큼 통째로 다시 계산합니다.
--   `materialized` 는 "정확히 한 번만 계산하라" 는 지시입니다 (PostgreSQL 12+).
--
--   하네스 실측(품목 20개 · 7회 중앙값 · select *):
--     analytics.v_safety_stock                0.56초 → 0.05초
--     analytics.v_dashboard_kpi               1.99초 → 0.90초
--     analytics.v_dashboard_purchase_priority 0.96초 → 0.40초
--     analytics.v_sku_detail                  1.83초 → 0.85초
--   `except` 양방향 비교 0건 — 한 행도 다르지 않았습니다.
--   품목이 늘면 이 차이는 품목 수에 비례해 벌어집니다.
--
--   ★ 울타리를 더 치면 더 빨라지지 않습니다. analytics.v_purchase_recommendation 에
--     같은 것을 쳐 봤더니 v_dashboard_kpi 가 0.90초 → 1.10초로 오히려 느려졌습니다.
--     울타리는 계획기의 선택지를 뺏는 일이라, 옳게 고르던 자리에 치면 손해입니다.
--     반드시 재고 나서 넣으세요. 자세한 것은 error.md #30 에 있습니다.
with dw_win as materialized (
  select * from analytics.v_demand_window
),
lt_eff as materialized (
  select * from core.v_leadtime_effective
),
lt_stat as materialized (
  -- ★ sql/29 가 이 파일의 정의에서 'core.v_leadtime_stat ' 를 찾아
  --   'core.v_leadtime_stat_src ' 로 갈아끼웁니다 (영업에게 안전재고가 작아지는 것을
  --   막는 보안 치환). 그래서 **별칭 st 를 지우지 마세요** — 지우면 뒤에 공백이 사라져
  --   치환이 실패하고 sql/29 가 통째로 멈춥니다.
  select * from core.v_leadtime_stat st
),
item as (
  select i.item_id, i.item_name, i.supplier_id
    from core.v_item_master i
   where i.is_active = 'Y'
),
sig_backtest as (
  -- ① 백테스트 RMSE. 검증 구간에서 실제로 얼마나 빗나갔는지입니다.
  --   renew.prd 21.1 — "예측 정확도가 안전재고 두께를 결정한다"
  select c.item_id, c.rmse as sigma_monthly
    from core.champion_model c
   where c.rmse is not null
),
sig_insample as (
  -- ② 백테스트가 아직 없으면 예측이 스스로 낸 잔차 표준편차를 씁니다.
  --   같은 데이터로 학습하고 잰 값이라 낙관적입니다. sigma_source 로 드러냅니다.
  select a.item_id, avg(a.sigma) as sigma_monthly
    from core.v_ai_forecast a
   where a.sigma is not null
   group by a.item_id
),
base as (
  select it.item_id,
         it.item_name,
         it.supplier_id,
         sl.item_grade,
         sl.service_level,
         sl.z_value,
         sl.source              as service_level_source,
         le.effective_lead_time as lead_time_days,
         -- 표본이 1건이면 std 가 null 입니다. 아래에서 0 으로 두되,
         -- 그 사실은 lead_time_confidence 가 드러냅니다 (renew.prd 18.2).
         st.std_days            as lead_time_sd,
         st.confidence          as lead_time_confidence,
         dw.demand_qty          as window_demand_qty,
         dw.window_days,
         coalesce(sb.sigma_monthly, si.sigma_monthly) as sigma_d_monthly,
         case when sb.sigma_monthly is not null then 'BACKTEST'
              when si.sigma_monthly is not null then 'IN_SAMPLE'
         end as sigma_source
    from item it
    left join core.v_item_service_level sl on sl.item_id    = it.item_id
    left join lt_eff le                    on le.supplier_id = it.supplier_id
    left join lt_stat st                   on st.supplier_id = it.supplier_id
    left join dw_win dw                    on dw.item_id    = it.item_id
    left join sig_backtest sb              on sb.item_id    = it.item_id
    left join sig_insample si              on si.item_id    = it.item_id
),
calc as (
  select b.*,
         -- d = 리드타임+검토주기 창의 누적 적용수요 ÷ 그 일수 (analytics.v_demand_window).
         --   확정 수주가 예측보다 우선하는 정의는 그 뷰가 sql/15 의 전개에서 물려받습니다.
         --   창 일수가 0 이면 나눗셈을 하지 않고 null 로 둡니다.
         b.window_demand_qty / nullif(b.window_days, 0) as daily_demand,
         -- ★ 월 단위 오차를 일 단위로 내립니다.
         --   일별 오차가 서로 독립이라고 보면 월 분산 = 30.4 × 일 분산이므로
         --   σ_일 = σ_월 / √30.4 입니다 (30.4 = 한 달 평균 일수, 정책값이 아니라 달력 상수).
         --   실제 수요 오차에는 자기상관이 있어 이 값은 과소평가일 수 있습니다.
         --   더 정확히 하려면 일 단위 백테스트가 필요합니다.
         b.sigma_d_monthly / sqrt(30.4) as sigma_d
    from base b
),
scored as (
  select c.*,
         -- 하나라도 없으면 안전재고를 내지 않습니다. 숫자로 채우지 않습니다 (AGENTS.md 규칙 5).
         --
         -- ★ 마지막 분기(z_value 가 null)에 대하여.
         --   사유 코드는 lib/status.ts 의 다섯 종을 그대로 씁니다. 여기서 새 코드를 만들면
         --   화면·AI·CSV 가 모르는 값을 받게 되므로 늘리지 않습니다.
         --   그렇다고 'NO_LEADTIME' 처럼 사실과 다른 코드로 옮기지도 않습니다.
         --   z_value 가 null 이려면 품목 지정 · 등급 · 기본값이 모두 비어 있어야 하는데,
         --   기본값 두 행(SERVICE_LEVEL_DEFAULT · Z_VALUE_DEFAULT)은 sql/06-core-extend.sql 이
         --   심는 시드라 정상 설치에서는 없을 수 없습니다.
         --   ★ 그 두 행을 core.policy_config 에서 지우지 마세요. 지우면 모든 품목의 안전재고가
         --     '표본 부족' 으로 사라지고, 관리자는 백테스트를 보러 가지만 고칠 곳은 정책 표입니다.
         --     (analytics.v_purchase_recommendation 의 pol CTE 주석과 같은 취지)
         case
           when c.lead_time_days is null then 'NO_LEADTIME'
           when c.daily_demand   is null then 'NO_FORECAST'
           when c.sigma_d        is null then 'INSUFFICIENT_SAMPLE'
           when c.z_value        is null then 'INSUFFICIENT_SAMPLE'
           else null
         end as reason_calc
    from calc c
),
dlt as (
  select s.*,
         case when s.reason_calc is null
              then sqrt( s.lead_time_days * power(s.sigma_d, 2)
                       + power(s.daily_demand, 2) * power(coalesce(s.lead_time_sd, 0), 2) )
         end as sigma_dlt_calc
    from scored s
)
select d.item_id,
       d.item_name,
       d.supplier_id,
       d.item_grade,
       d.service_level,
       d.z_value,
       d.service_level_source,
       d.lead_time_days,
       d.lead_time_sd,
       d.lead_time_confidence,
       d.daily_demand,
       d.sigma_d_monthly,
       d.sigma_d,
       d.sigma_source,
       d.sigma_dlt_calc as sigma_dlt,
       case when d.reason_calc is null then round(d.z_value * d.sigma_dlt_calc) end as safety_stock,
       d.reason_calc as reason
  from dlt d;

comment on view analytics.v_safety_stock is
  'renew.prd 21.1 — σ_DLT 와 안전재고. σ_d 는 백테스트 RMSE, 없으면 in-sample σ 입니다';

comment on column analytics.v_safety_stock.reason is
  'NO_LEADTIME(L 없음) · NO_FORECAST(d 없음) · INSUFFICIENT_SAMPLE(σ_d 없음, 또는 Z 를 정할 수 없음). '
  'Z 를 정할 수 없는 경우는 core.policy_config 의 SERVICE_LEVEL_DEFAULT · Z_VALUE_DEFAULT 가 '
  '지워졌을 때뿐입니다 — 두 행은 sql/06-core-extend.sql 시드이므로 삭제하지 마세요';

-- ── 4-5. 발주 추천 ★ ──────────────────────────────────────────
--
-- renew.prd 22.1
--   Recommended Qty = Demand during (Lead Time + Review Period)
--                     + Safety Stock − Available Inventory − Confirmed Incoming Qty
--   "확정 수주가 있으면 예측보다 우선한다"  ← sql/15 의 demand_qty 정의를 그대로 씁니다
--
--   ★ 마지막 항의 Confirmed Incoming Qty 는 **창(리드타임 + 검토 주기) 안에 들어오는**
--     물량입니다. 진행 중 선적 전량이 아닙니다. 창 뒤에 도착하는 선적은 그 창의 수요를
--     덮지 못하므로, 전량을 빼면 딱 그만큼 발주가 모자라게 나오고 나중에 결품이 됩니다.
--     아래 win CTE 가 선적 한 건씩 ETA 를 보고 두 몫으로 가릅니다.
-- renew.prd 22.2
--   Required Order Date = Stockout Date − Lead Time − Safety Buffer Days
--
-- is_active='Y' 품목 전부가 한 줄씩 나옵니다. 발주가 필요 없으면 final_recommended_qty = 0 입니다.
-- "0" 과 "산출 불가(null)" 는 다릅니다. 후자는 reason_code 가 함께 있습니다.
create view analytics.v_purchase_recommendation as
with pol as (
  -- ★ 이 두 행을 core.policy_config 에서 지우지 마세요.
  --   REVIEW_PERIOD_DAYS 가 없으면 창 자체가 잡히지 않아 수요 합이 null 이 되고,
  --   SAFETY_BUFFER_DAYS 가 없으면 발주 권고일이 null 이 됩니다.
  --   0 으로 채우면 "여유일을 안 잡았다" 와 "정책값이 빠졌다" 가 구분되지 않습니다.
  select max(pc.value_num) filter (where pc.key = 'REVIEW_PERIOD_DAYS') as review_period_days,
         max(pc.value_num) filter (where pc.key = 'SAFETY_BUFFER_DAYS') as safety_buffer_days
    from core.policy_config pc
),
base as (
  select r.item_id,
         r.item_name,
         r.supplier_id,
         le.supplier_name,
         r.current_stock       as current_inventory,
         r.inbound_qty         as incoming_qty,
         ib.earliest_eta       as incoming_eta,
         -- 창의 "순수 예측" 과 "확정 수주" 를 따로 보여 줍니다 (renew.prd 22.3).
         dw.forecast_qty,
         dw.committed_qty,
         -- 적용수요는 결품 판정과 같은 값이어야 두 화면이 어긋나지 않습니다.
         -- 판정하지 못한 품목은 여기도 null 이고, 그때 raw/final 도 null 이 됩니다.
         r.leadtime_demand_qty as consensus_forecast,
         r.planned_lead_time   as lead_time,
         st.confidence         as lead_time_confidence,
         p.review_period_days,
         p.safety_buffer_days,
         ss.safety_stock,
         ss.reason             as safety_reason,
         r.stockout_date,
         r.risk_status,
         r.reason              as risk_reason,
         ip.moq,
         ip.pack_size,
         pr.unit_price,
         r.run_id,
         r.data_snapshot_at
    from analytics.v_stockout_risk r
    cross join pol p
    left join core.v_leadtime_effective le on le.supplier_id = r.supplier_id
    left join core.v_leadtime_stat      st on st.supplier_id = r.supplier_id
    left join core.v_inbound_qty        ib on ib.item_id     = r.item_id
    left join analytics.v_demand_window dw on dw.item_id     = r.item_id
    left join analytics.v_safety_stock  ss on ss.item_id     = r.item_id
    left join core.item_policy          ip on ip.item_id     = r.item_id
    left join core.v_item_price         pr on pr.item_id     = r.item_id
),
-- ★ 입고예정을 "창 안에 들어오는 것" 과 "창 뒤에 오는 것" 으로 가릅니다.
--
--   renew.prd 22.1 이 빼라고 한 것은 Confirmed Incoming Qty 전부가 아니라
--   리드타임 + 검토 주기 창 안에 실제로 들어오는 물량입니다. 창 뒤에 도착하는
--   선적은 그 창을 덮지 못하므로 빼면 발주량이 그만큼 모자라게 나오고,
--   모자란 만큼은 나중에 결품으로 돌아옵니다.
--
--   core.v_inbound_qty 는 품목당 한 줄로 접혀 있어(합계 + 가장 이른 ETA 하나)
--   여기서 쓸 수 없습니다. "가장 이른 ETA 가 창 안" 이라고 전량을 빼면
--   같은 오류가 그대로 남습니다. 그래서 선적 한 건씩 core.v_fact_shipment 를
--   다시 읽습니다. ETA 식은 core.v_inbound_qty(덤프) 와 **글자 그대로 같아야**
--   합니다 — 달라지면 in_window + after_window 가 incoming_qty 와 안 맞습니다.
--
--   ★ 이 ETA 는 기록된 도착 예정일이 아니라 order_date + 공급처 리드타임 추정입니다.
--     v_fact_shipment.due_date 라는 기록된 예정일이 따로 있고 둘은 이 데이터에서
--     −17 ~ +13 일 어긋납니다. 여기서 추정 쪽을 쓰는 이유는 sql/15 의 재고 전개가
--     같은 추정으로 입고를 배치하기 때문입니다. 시계를 다르게 잡으면 결품 예상일과
--     발주 추천이 서로 다른 세계를 말하게 됩니다. 기록된 예정일로 바꾸려면
--     sql/15 와 core.v_inbound_qty 를 함께 바꿔야 합니다.
--
--   ETA 를 모르는 선적(order_date 가 없는 경우)은 after_window 로 갑니다.
--   "언제 올지 모르는 물량" 을 창 안에 있다고 치면 그게 곧 이 결함이므로,
--   빼지 않는 쪽이 안전합니다. 두 값의 합은 언제나 incoming_qty 입니다.
win as (
  select b.*,
         -- 창의 끝. 화면이 오늘 날짜로 다시 계산하면 앱 서버와 DB 의 시간대가 달라
         -- 하루가 어긋나므로(is_urgent 주석 참고) 뷰가 날짜로 내려 줍니다.
         case when b.lead_time is not null and b.review_period_days is not null
              then (current_date + b.lead_time::int + b.review_period_days::int)::date
         end as incoming_window_end,
         -- 창을 모르면 어느 쪽인지도 모릅니다. 0 이 아니라 null 입니다 (AGENTS.md 규칙 5).
         case when b.lead_time is not null and b.review_period_days is not null
              then coalesce(sh.in_window_qty, 0)
         end as incoming_in_window_qty,
         case when b.lead_time is not null and b.review_period_days is not null
              then coalesce(b.incoming_qty, 0) - coalesce(sh.in_window_qty, 0)
         end as incoming_after_window_qty
    from base b
    left join lateral (
      select sum(s.qty) as in_window_qty
        from core.v_fact_shipment s
       where s.item_id = b.item_id
         and s.status  = 'IN_TRANSIT'
         and (s.order_date
              + coalesce((select e.effective_lead_time
                            from core.v_leadtime_effective e
                           where e.supplier_id = s.supplier_id), 30))
             <= current_date + b.lead_time::int + b.review_period_days::int
    ) sh on b.lead_time is not null and b.review_period_days is not null
),
calc as (
  select b.*,
         -- 결품 판정을 못 했으면 그 사유를, 판정은 했는데 안전재고를 못 냈으면 그 사유를 씁니다.
         coalesce(b.risk_reason, b.safety_reason) as reason_code,
         -- 필요량 = 창의 수요 + 안전재고 − 현재고 − **창 안에 들어오는** 입고예정.
         -- 음수면 0 입니다. 근거가 하나라도 없으면 0 이 아니라 null 입니다 (AGENTS.md 규칙 5).
         -- 창을 모르면 뺄 값도 모르므로 incoming_in_window_qty 도 함께 봅니다.
         case when coalesce(b.risk_reason, b.safety_reason) is null
                   and b.consensus_forecast      is not null
                   and b.safety_stock            is not null
                   and b.current_inventory       is not null
                   and b.incoming_in_window_qty  is not null
              then greatest(0, b.consensus_forecast + b.safety_stock
                               - b.current_inventory - b.incoming_in_window_qty)
         end as raw_recommended_qty
    from win b
),
fin as (
  select c.*,
         -- renew.prd 22.2 — Required Order Date = Stockout Date − Lead Time − Safety Buffer Days
         case when c.stockout_date is not null
               and c.lead_time is not null
               and c.safety_buffer_days is not null
              then (c.stockout_date - c.lead_time::int - c.safety_buffer_days::int)::date
         end as required_order_date,
         -- renew.prd 22.1 — "MOQ와 Pack Size를 반영해 보정한다. 필요 220개 · Pack 100 → 300개"
         case when c.raw_recommended_qty is null then null
              when c.raw_recommended_qty = 0     then 0
              when c.pack_size is null or c.pack_size <= 0
                   then greatest(c.raw_recommended_qty, coalesce(c.moq, 0))
              else ceil(greatest(c.raw_recommended_qty, coalesce(c.moq, 0)) / c.pack_size)
                   * c.pack_size
         end as final_recommended_qty
    from calc c
)
select f.item_id,
       f.item_name,
       f.supplier_id,
       f.supplier_name,
       f.current_inventory,
       -- ★ incoming_qty 는 예전 그대로 "진행 중 선적 전량" 입니다. 뜻을 바꾸지 않습니다.
       --   ATP(sql/23) · 대시보드 · 승인 Snapshot 이 같은 이름으로 같은 뜻을 읽고 있고,
       --   화면의 "입고예정" 카드도 실제로 오고 있는 물량 전부를 보여야 합니다.
       --   식에서 빠지는 값은 아래 incoming_in_window_qty 로 따로 내립니다.
       f.incoming_qty,
       -- 재고를 모르면 가용도 모릅니다. 0 으로 채우지 않습니다.
       -- ★ 이 값은 "언젠가는 있을 재고" 입니다. 창 안의 가용이 아닙니다 —
       --   창 안의 가용은 current_inventory + incoming_in_window_qty 입니다.
       case when f.current_inventory is null then null
            else f.current_inventory + coalesce(f.incoming_qty, 0)
       end as available_qty,
       f.incoming_eta,
       -- renew.prd 22.1 의 Confirmed Incoming Qty. 식에서 빼는 값은 이것입니다.
       f.incoming_window_end,
       f.incoming_in_window_qty,
       -- 창 뒤에 도착해 이번 발주로는 못 쓰는 물량. 0 보다 크면 추천 수량이
       -- 그만큼 커지는데, 화면이 이 컬럼으로 "왜 커졌는지" 를 말할 수 있습니다.
       f.incoming_after_window_qty,
       f.forecast_qty,
       f.committed_qty,
       f.consensus_forecast,
       f.lead_time,
       f.lead_time_confidence,
       f.review_period_days,
       f.safety_buffer_days,
       f.safety_stock,
       f.stockout_date,
       f.required_order_date,
       -- ★ "긴급" 판정을 뷰가 냅니다.
       --   화면에서 다시 오늘과 비교하면 앱 서버와 DB 의 시간대가 달라 하루가 어긋나고,
       --   KPI 카드의 숫자와 목록 건수가 맞지 않게 됩니다 (design.md §6.4).
       --   권고일이 없으면 긴급인지 아닌지도 모릅니다 — false 가 아니라 null 입니다.
       (f.required_order_date <= current_date)                as is_urgent,
       f.raw_recommended_qty,
       f.moq,
       f.pack_size,
       f.final_recommended_qty,
       f.unit_price,
       case when f.final_recommended_qty is null or f.unit_price is null then null
            else f.final_recommended_qty * f.unit_price
       end as recommended_amount,
       f.risk_status as risk,
       f.reason_code,
       -- renew.prd 22.3 — 사람이 읽는 근거 한 문장. 화면·CSV·AI 가 같은 문장을 씁니다.
       case
         when f.reason_code is not null or f.raw_recommended_qty is null then
           '산출할 수 없습니다: ' || coalesce(core.reason_label(f.reason_code), '근거 부족')
         -- ★ 숫자 바로 뒤에 조사를 붙이지 않습니다.
         --   '안전재고 400 를' 처럼 받침에 따라 틀리는 조사가 생기고, 400 이 아니라 401 이
         --   나오는 순간 문장이 어색해집니다. 두 분기 모두 '항목 값 · 항목 값 → 결과' 골격만 씁니다.
         -- ★ 세 번째 항목은 가용재고(현재고 + 입고예정)가 아니라 현재고입니다.
         --   입고예정을 바로 뒤에서 따로 빼므로, '가용' 이라고 쓰면 두 번 뺀 것처럼 읽힙니다.
         -- ★ 네 번째 항목은 진행 중 선적 전량(incoming_qty)이 아니라 창 안에 들어오는
         --   물량(incoming_in_window_qty)입니다. 식에서 빼는 값과 문장의 값이 다르면
         --   사람이 검산하다 막힙니다. 창 뒤에 오는 물량이 있으면 뒤에 한 마디 덧붙여
         --   "왜 카드의 입고예정보다 적게 뺐는지" 를 문장 스스로 설명합니다.
         when f.raw_recommended_qty = 0 then
           '리드타임 ' || core.fmt_qty(f.lead_time) || '일 + 검토 '
           || core.fmt_qty(f.review_period_days) || '일 동안 수요 '
           || core.fmt_qty(f.consensus_forecast) || ' · 안전재고 '
           || core.fmt_qty(f.safety_stock) || ' · 현재고 '
           || core.fmt_qty(f.current_inventory) || ' · 창 안 입고예정 '
           || core.fmt_qty(f.incoming_in_window_qty)
           || ' → 필요 0 · 지금은 발주하지 않아도 됩니다'
           || case when coalesce(f.incoming_after_window_qty, 0) > 0
                   then ' (진행 중 선적 중 ' || core.fmt_qty(f.incoming_after_window_qty)
                        || ' 은 '
                        || coalesce(to_char(f.incoming_window_end, 'YYYY-MM-DD'), '창 끝')
                        || ' 이후 도착 예정이라 빼지 않았습니다)'
                   else '' end
         else
           '리드타임 ' || core.fmt_qty(f.lead_time) || '일 + 검토 '
           || core.fmt_qty(f.review_period_days) || '일 동안 수요 '
           || core.fmt_qty(f.consensus_forecast) || ' · 안전재고 '
           || core.fmt_qty(f.safety_stock) || ' · 현재고 '
           || core.fmt_qty(f.current_inventory) || ' · 창 안 입고예정 '
           || core.fmt_qty(f.incoming_in_window_qty)
           || case when coalesce(f.incoming_after_window_qty, 0) > 0
                   then ' (창 뒤 도착 ' || core.fmt_qty(f.incoming_after_window_qty)
                        || ' 은 제외 · 창 끝 '
                        || coalesce(to_char(f.incoming_window_end, 'YYYY-MM-DD'), '—')
                        || ')'
                   else '' end
           || ' → 필요 ' || core.fmt_qty(f.raw_recommended_qty)
           || case when f.moq is null and f.pack_size is null then ''
                   else ' → '
                        || concat_ws(' · ',
                             case when f.moq is not null
                                  then 'MOQ ' || core.fmt_qty(f.moq) end,
                             case when f.pack_size is not null
                                  then '포장 ' || core.fmt_qty(f.pack_size) end)
                        || ' 적용 ' || core.fmt_qty(f.final_recommended_qty)
              end
       end as explanation,
       f.run_id,
       f.data_snapshot_at
  from fin f;

comment on view analytics.v_purchase_recommendation is
  'renew.prd 22장 — 발주 추천. MOQ · 포장 단위 반영 수량과 발주 권고일이 여기서 나옵니다';

comment on column analytics.v_purchase_recommendation.incoming_qty is
  '진행 중 선적 전량(core.v_inbound_qty). 식에서 빼는 값이 아닙니다 — 그건 incoming_in_window_qty 입니다';
comment on column analytics.v_purchase_recommendation.incoming_window_end is
  '오늘 + 리드타임 + 검토 주기. 이 날까지 도착하는 선적만 발주량에서 뺍니다';
comment on column analytics.v_purchase_recommendation.incoming_in_window_qty is
  'renew.prd 22.1 의 Confirmed Incoming Qty — 창 안에 도착하는 몫. 창을 모르면 null 입니다';
comment on column analytics.v_purchase_recommendation.incoming_after_window_qty is
  '창 뒤에 도착하거나 ETA 를 모르는 몫. incoming_in_window_qty 와 더하면 incoming_qty 입니다';

create view analytics.v_purchase_recommendation_kpi as
select count(*)                                                            as n_items,
       count(*) filter (where r.final_recommended_qty > 0)                 as n_order_needed,
       -- 발주 권고일이 오늘 이전이면 이미 늦었습니다.
       -- 화면 필터가 같은 판정을 쓰도록 뷰의 is_urgent 를 그대로 셉니다.
       count(*) filter (where r.is_urgent)                                 as n_urgent,
       count(*) filter (where r.risk = 'CRITICAL')                         as n_critical,
       count(*) filter (where r.risk = 'WARNING')                          as n_warning,
       -- ★ 화면 필터와 같은 조건이어야 카드 숫자와 목록 건수가 맞습니다 (design.md §6.4).
       --   결품은 판정했는데 안전재고를 못 낸 품목이 있습니다. risk 는 SAFE/WARNING 인데
       --   추천 수량이 null 인 경우입니다. 그 품목도 "산출 불가" 로 셉니다.
       count(*) filter (where r.risk = 'CALCULATION_UNAVAILABLE'
                           or r.final_recommended_qty is null)             as n_unknown,
       sum(r.final_recommended_qty)                                        as total_recommended_qty,
       -- 단가가 없는 품목은 합계에서 빠집니다. 빠졌다는 사실은 n_missing_price 가 알립니다
       -- (design.md §8.2 — 집계에서 제외하고 제외했음을 밝힙니다).
       sum(r.recommended_amount) filter (where r.unit_price is not null)   as total_recommended_amount,
       count(*) filter (where r.final_recommended_qty > 0
                          and r.unit_price is null)                        as n_missing_price
  from analytics.v_purchase_recommendation r;

-- ── 4-6. SKU Detail ★ ─────────────────────────────────────────
--
-- renew.prd 29장 — 28개 항목을 한 흐름으로 보여주는 화면이 읽는 요약 한 줄입니다.
-- 기간별 값(실적 · 예측 · 전개 · Consensus)은 각각의 뷰에서 따로 읽습니다.
create view analytics.v_sku_detail as
select rec.item_id,
       rec.item_name,
       rec.supplier_id,
       rec.supplier_name,
       le.country,
       dp.demand_type,
       ch.champion_model_id,
       ch.model_name        as champion_model_name,
       ch.wape              as champion_wape,
       ch.bias              as champion_bias,
       ch.selection_method  as champion_selection_method,
       rec.run_id           as forecast_run_id,
       sr.forecast_source,
       rec.data_snapshot_at,
       fr.is_stale,
       rec.current_inventory,
       rec.incoming_qty,
       rec.incoming_eta,
       -- ★ "추천 수량 근거" 표의 '− 입고예정' 칸이 빼야 하는 값은 진행 중 선적 전량이
       --   아니라 창 안에 들어오는 몫입니다. 전량을 쓰면 표의 뺄셈이 필요량과 안 맞습니다.
       --   창 뒤 몫은 그 옆에 "왜 덜 뺐는지" 를 적는 데 씁니다.
       --   ※ v_sku_detail 의 최종 정의는 sql/19-approval.sql 에 있습니다. 이 두 컬럼을
       --      화면까지 내리려면 sql/19 쪽 사본에도 같은 줄을 더해야 합니다.
       rec.incoming_window_end,
       rec.incoming_in_window_qty,
       rec.incoming_after_window_qty,
       -- ★ 지시서 목록에 없지만 하나 더 내립니다.
       --   SKU Detail §4 의 "추천 근거 표" 가 창 수요 → 안전재고 → 가용 → 입고예정 →
       --   필요량 순으로 식을 펴야 하는데, 첫 항이 없으면 근거가 끊깁니다 (renew.prd 22.3).
       --   컬럼을 더하기만 했고 기존 이름·순서는 그대로입니다.
       rec.consensus_forecast,
       rec.stockout_date,
       sr.stockout_days,
       sr.first_negative_period,
       rec.lead_time,
       le.source            as lead_time_source,
       rec.lead_time_confidence,
       rec.safety_stock,
       ss.service_level,
       ss.z_value,
       ss.sigma_dlt,
       rec.required_order_date,
       rec.is_urgent,
       rec.raw_recommended_qty,
       rec.final_recommended_qty,
       rec.moq,
       rec.pack_size,
       rec.unit_price,
       rec.recommended_amount,
       rec.risk,
       rec.reason_code,
       rec.explanation,
       coalesce(ov.n_overrides, 0) as n_overrides
  from analytics.v_purchase_recommendation rec
  left join analytics.v_stockout_risk      sr on sr.item_id    = rec.item_id
  left join analytics.v_champion_model     ch on ch.item_id    = rec.item_id
  left join analytics.v_sku_demand_profile dp on dp.item_id    = rec.item_id
  left join analytics.v_safety_stock       ss on ss.item_id    = rec.item_id
  left join core.v_leadtime_effective      le on le.supplier_id = rec.supplier_id
  left join analytics.v_forecast_run       fr on fr.run_id     = rec.run_id
  left join (
    select o.item_id, count(*) as n_overrides
      from core.forecast_override o
     where o.superseded_at is null
     group by o.item_id
  ) ov on ov.item_id = rec.item_id;

-- ★ v_sku_detail 의 최종 정의는 sql/19-approval.sql 에 있습니다.
--   여기 정의에는 승인 컬럼 5개(last_decision · last_approved_qty · last_approved_at ·
--   last_approved_email · has_active_approval)가 없습니다.
--   이 파일을 다시 실행했다면 sql/19 를 이어서 실행하세요 (위 §3 drop 목록의 주석 참고).
comment on view analytics.v_sku_detail is
  'renew.prd 29장 — 품목 하나의 예측 · 재고 · 발주 요약. 최종 정의는 sql/19-approval.sql 에 있습니다';

-- ══ 5. 권한 ════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['service_level', 'z_table'] loop
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

grant select on core.v_item_service_level to authenticated;
grant select on core.v_item_price          to authenticated;

grant select on analytics.v_consensus_forecast          to authenticated;
grant select on analytics.v_service_level               to authenticated;
grant select on analytics.v_item_policy                 to authenticated;
grant select on analytics.v_demand_window               to authenticated;
grant select on analytics.v_safety_stock                to authenticated;
grant select on analytics.v_purchase_recommendation     to authenticated;
grant select on analytics.v_purchase_recommendation_kpi to authenticated;
grant select on analytics.v_sku_detail                  to authenticated;

-- ══ 6. 확인 ════════════════════════════════════════════════════

select * from analytics.v_purchase_recommendation_kpi;

select item_id, risk, required_order_date, raw_recommended_qty, final_recommended_qty, explanation
  from analytics.v_purchase_recommendation
 order by required_order_date nulls last
 limit 20;

-- 입고예정을 창 안 · 창 뒤로 가른 결과.
--   split_ok 가 하나라도 f 면 win CTE 의 ETA 식이 core.v_inbound_qty 와 어긋난 것입니다.
--   after_window 가 전부 0 이면 이 데이터에서는 창 밖 입고가 없다는 뜻입니다 —
--   ETA 가 order_date + 리드타임 추정이라 창 끝(오늘 + 리드타임 + 검토 주기)보다
--   최소 '검토 주기' 만큼 앞서기 때문입니다. 실제 도착일이 늦어지면 그때 값이 생깁니다.
select item_id,
       incoming_qty,
       incoming_in_window_qty,
       incoming_after_window_qty,
       incoming_window_end,
       (coalesce(incoming_in_window_qty, 0) + coalesce(incoming_after_window_qty, 0)
         = coalesce(incoming_qty, 0))                          as split_ok
  from analytics.v_purchase_recommendation
 order by incoming_after_window_qty desc nulls last
 limit 20;

-- 안전재고 근거를 한눈에 (σ_d 출처가 BACKTEST 인지 IN_SAMPLE 인지 확인)
select item_id, service_level, z_value, lead_time_days, lead_time_sd, lead_time_confidence,
       daily_demand, sigma_d_monthly, sigma_d, sigma_source, sigma_dlt, safety_stock, reason
  from analytics.v_safety_stock
 order by safety_stock desc nulls last
 limit 20;

-- 창 수요가 결품 판정과 같은 값인지 (판정한 품목은 두 값이 같아야 합니다).
-- diff 가 0 이 아니면 sql/15 의 lt CTE 와 여기 v_demand_window 의 식이 어긋난 것입니다.
select w.item_id, w.window_days, round(w.demand_qty, 2) as window_demand,
       round(r.leadtime_demand_qty, 2) as risk_demand,
       round(w.demand_qty - r.leadtime_demand_qty, 6) as diff
  from analytics.v_demand_window w
  join analytics.v_stockout_risk r on r.item_id = w.item_id
 where r.leadtime_demand_qty is not null
 order by abs(w.demand_qty - r.leadtime_demand_qty) desc
 limit 10;

-- 적용 중인 서비스 수준이 어디서 왔는지
select source, count(*) from core.v_item_service_level group by source;

-- 단가를 읽었는지 (0행이면 raw.item_master 에 단가 컬럼이 없다는 뜻입니다)
select count(*) as n_prices, count(unit_price) as n_valued from core.v_item_price;
