-- ──────────────────────────────────────────────────────────────
-- sql/34 — 실데이터 표준 입력 계층 (docs/superpowers/specs/2026-09-05-realdata-cutover-design.md §3)
--
-- ★ 여기서 하는 일
--   1  5회차 더미 raw 테이블 8개를 지웁니다 (cascade — 그 위 뷰 사슬은 뒤 파일이 다시 만듭니다).
--   2  엔진과 화면이 "수요" 와 "품목" 을 읽는 문을 넷으로 정합니다.
--        core.v_demand_monthly   품목 × 월 수요 (부품은 XCN 대표코드로 합산 · 기종은 판매 실적)
--        core.v_item_master      대표코드 1행 (품목 · 기종)
--        core.v_item_alias       구코드 → 대표코드
--        core.v_item_hierarchy   기종 → 역할 → 구성품
--   3  재고 · 리드타임 · 발주 · 입고는 아직 데이터가 없습니다. 그것을 읽던 core 뷰는
--      같은 컬럼으로 0행을 내는 정의로 두고 [DATA_PENDING] 을 주석에 적습니다.
--      화면은 규칙대로 "산출 불가" 가 되고, analytics.v_data_availability 가 그 사실을 말합니다.
--
-- ★ 선행: sql/32 (raw 테이블) · 6회차 02-data-*.sql (데이터) · sql/33 (core.v_item · v_model ·
--   v_shipment_by_hoc · analytics.v_bom_requirement_x). 뒤: sql/07 부터 전부 다시.
-- ★ 재실행 안전. drop if exists · create or replace 만 씁니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 더미 정리 ═══════════════════════════════════════════════
--
-- 5회차 더미 raw 8개. 이름은 남기지 않습니다 — 호환 뷰로 위장하면 일별 거래 · 한국어
-- 컬럼명 · 별칭 부재라는 빚이 그대로 남습니다 (스펙 §1 스키마 결정).
-- raw.business_event · sales_order · item_substitute 는 sql/06 이 만드는 프로젝트 표라 남깁니다.

drop table if exists raw.shipment_log      cascade;
drop table if exists raw.usage_history     cascade;
drop table if exists raw.inventory         cascade;
drop table if exists raw.item_master       cascade;
drop table if exists raw.supplier_master   cascade;
drop table if exists raw.purchase_order    cascade;
drop table if exists raw.goods_receipt     cascade;
drop table if exists raw.forecast          cascade;
-- 더미 시절 "정제 기준" 표. 실데이터에는 대응물이 없습니다.
drop table if exists core.usage_profile    cascade;
-- 덤프에만 있던 더미 뷰. cascade 로 이미 사라졌을 수 있습니다.
drop view if exists analytics.v_usage_profile  cascade;
drop view if exists analytics.v_usage_anomaly  cascade;
drop view if exists core.v_usage_effective     cascade;


-- ══ 2. 코드 정규화 ═════════════════════════════════════════════
--
-- 기존 뷰들이 쓰던 식과 같습니다. 한 곳에 두어 어디서나 같은 item_id 가 나오게 합니다.

create or replace function core.norm_code(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[\s\-_]', '', 'g'));
$$;


-- ══ 3. 적재 기록 — 데이터 시각의 기준 ══════════════════════════
--
-- 더미 raw 의 loaded_at 이 없어지므로 stale 판정은 이 표를 봅니다 (sql/11 · 25 · 27).
-- 6회차 데이터를 다시 적재했으면 한 행을 더 넣으세요:
--   insert into core.realdata_load (note) values ('재적재');

create table if not exists core.realdata_load (
  id               bigserial primary key,
  loaded_at        timestamptz not null default now(),
  n_shipment_rows  bigint,
  n_items          bigint,
  data_from        char(7),
  data_to          char(7),
  note             text
);

insert into core.realdata_load (n_shipment_rows, n_items, data_from, data_to, note)
select count(*), count(distinct item_code), min(ym), max(ym), '6회차 실데이터 — sql/34 최초 기록'
  from raw.fact_shipment
having count(*) > 0
   and not exists (select 1 from core.realdata_load);


-- ══ 4. 별칭 — 구코드 → 대표코드 ═══════════════════════════════
--
-- 검색이 구코드로 들어와도 대표코드를 찾습니다. 한 별칭이 둘 이상의 대표코드에 걸리면
-- XCN 표 → dim_item 의 hoc 매핑 순으로 하나만 씁니다.

drop materialized view if exists core.mv_item_alias cascade;
create materialized view core.mv_item_alias as
with cand as (
  select core.norm_code(x.related_item) as alias_id,
         core.norm_code(x.hoc_item)     as item_id,
         x.related_item                 as alias_name,
         1                              as pref
    from raw.bridge_xcn x
   where x.related_item is not null and x.hoc_item is not null
  union all
  select core.norm_code(i.item_code), core.norm_code(i.hoc_code), i.item_code, 2
    from core.v_item i
  union all
  select core.norm_code(m.model_base), core.norm_code(m.model_base), m.model_base, 3
    from core.v_model m
)
select distinct on (alias_id) alias_id, item_id, alias_name
  from cand
 where alias_id <> '' and item_id <> ''
 order by alias_id, pref;

create unique index if not exists ux_mv_item_alias on core.mv_item_alias (alias_id);
create index        if not exists ix_mv_item_alias_item on core.mv_item_alias (item_id);

create or replace view core.v_item_alias as select * from core.mv_item_alias;

comment on view core.v_item_alias is
  '구코드(XCN 연계 · dim_item 코드) → 대표코드. 검색과 BOM 코드 정규화가 이 뷰를 거칩니다';


-- ══ 5. 품목 마스터 — 대표코드 1행 ══════════════════════════════
--
-- 컬럼은 예전 core.v_item_master 와 같습니다(item_id · item_name · item_type · supplier_id ·
-- unit · is_active). family · is_machine 을 더했습니다. supplier_id · unit 은 실데이터에 없어
-- null 입니다 — 0 이나 임의 값으로 채우지 않습니다.

drop materialized view if exists core.mv_item_master cascade;
create materialized view core.mv_item_master as
with parts as (
  select distinct on (core.norm_code(i.hoc_code))
         core.norm_code(i.hoc_code)              as item_id,
         coalesce(h.description, i.description)  as item_name,
         coalesce(h.item_type, i.item_type)       as item_type,
         coalesce(h.family, i.family)             as family
    from core.v_item i
    left join core.v_item h on h.item_code = i.hoc_code
   where core.norm_code(i.hoc_code) <> ''
   order by core.norm_code(i.hoc_code), (i.item_code = i.hoc_code) desc, i.item_code
),
machines as (
  select distinct on (core.norm_code(m.model_base))
         core.norm_code(m.model_base)                          as item_id,
         m.model_base || coalesce(' · ' || m.biz, '')          as item_name,
         'MACHINE'::text                                       as item_type,
         m.biz                                                 as family
    from core.v_model m
   order by core.norm_code(m.model_base), m.model_key
)
select p.item_id, p.item_name, p.item_type, p.family,
       false        as is_machine,
       'Y'::text    as is_active,
       null::text   as supplier_id,
       null::text   as unit
  from parts p
 where p.item_id not in (select item_id from machines)
union all
select m.item_id, m.item_name, m.item_type, m.family, true, 'Y', null, null
  from machines m;

create unique index if not exists ux_mv_item_master on core.mv_item_master (item_id);
create index        if not exists ix_mv_item_master_type on core.mv_item_master (item_type);

create or replace view core.v_item_master as select * from core.mv_item_master;

comment on view core.v_item_master is
  '대표코드 기준 품목 · 기종 마스터. supplier_id · unit 은 실데이터에 없어 null (스펙 §3)';


-- ══ 6. 월별 수요 — 하나의 사실 ═════════════════════════════════
--
-- 부품은 XCN 대표코드로 합산한 core.v_shipment_by_hoc(sql/33). 소모품 · 옵션은 자기 코드.
-- 기종은 raw.fact_mc_plan_actual 의 실적(act). 0 인 달은 행이 없습니다(원본이 희소).
-- 격자를 채우는 일은 core.v_demand_grid(sql/11)가 지금처럼 합니다.

drop materialized view if exists core.mv_demand_monthly cascade;
create materialized view core.mv_demand_monthly as
select core.norm_code(h.hoc_item)                as item_id,
       to_date(h.ym || '-01', 'YYYY-MM-DD')      as period,
       sum(h.qty)                                as qty,
       max(h.item_type)                          as item_type,
       'SHIPMENT'::text                          as source,
       sum(h.n_source_codes)::int                as n_source_codes
  from core.v_shipment_by_hoc h
 where core.norm_code(h.hoc_item) <> ''
 group by 1, 2
union all
select core.norm_code(f.model_base),
       to_date(f.ym || '-01', 'YYYY-MM-DD'),
       sum(f.act),
       'MACHINE',
       'MC_ACT',
       count(*)::int
  from raw.fact_mc_plan_actual f
 where f.act is not null
   and nullif(btrim(f.model_base), '') is not null
 group by 1, 2;

create unique index if not exists ux_mv_demand_monthly on core.mv_demand_monthly (item_id, period);
create index        if not exists ix_mv_demand_monthly_period on core.mv_demand_monthly (period);

create or replace view core.v_demand_monthly as select * from core.mv_demand_monthly;

comment on view core.v_demand_monthly is
  '★ 수요의 단일 사실. 학습(v_train_demand) · 운영(v_usage_monthly) · 실적 비교가 전부 여기서 나갑니다';


-- ══ 6b. 입력 실체화 갱신 ═══════════════════════════════════════
--
-- ★ 왜 materialized view 인가
--   v_item_master 는 dim_item 93,868행을 정규식으로 정규화해 distinct on 하고, v_demand_monthly 는
--   출고 10만 행을 정규화해 합칩니다. 뷰로 두면 조인마다 다시 계산되고, 계획기가 Nested Loop
--   안쪽에 두는 순간 5분을 넘깁니다 (refresh_forecast_current 에서 실측 · error.md #34).
--   물리 표 + 인덱스로 두면 어디서 조인해도 1초 안입니다.
--
-- ★ 6회차 데이터를 다시 적재했으면 이 함수를 부르세요. sql/34 끝에서도 한 번 부릅니다.

create or replace function core.refresh_realdata_inputs(p_note text default null)
returns table (mv text, n_rows bigint)
language plpgsql
security definer
set search_path = core, public
as $$
begin
  refresh materialized view core.mv_item_alias;
  refresh materialized view core.mv_item_master;
  refresh materialized view core.mv_demand_monthly;
  if p_note is not null then
    insert into core.realdata_load (n_shipment_rows, n_items, data_from, data_to, note)
    select count(*), count(distinct item_code), min(ym), max(ym), p_note from raw.fact_shipment;
  end if;
  return query
    select 'mv_item_alias'::text,     count(*) from core.mv_item_alias
    union all select 'mv_item_master',    count(*) from core.mv_item_master
    union all select 'mv_demand_monthly', count(*) from core.mv_demand_monthly;
end;
$$;

revoke all on function core.refresh_realdata_inputs(text) from public, anon;
grant execute on function core.refresh_realdata_inputs(text) to authenticated;


-- ══ 7. 기종 계층 — 기종 1대에 무엇이 몇 개 ═══════════════════════
--
-- analytics.v_bom_requirement_x(sql/33)와 같은 규칙. 품목코드는 별칭을 거쳐 대표코드로.
-- role 의 'SCC/LABEL' 은 식별자로 쓰기 좋게 SCC_LABEL 로 적습니다.

create or replace view core.v_item_hierarchy as
select r.model_base,
       r.model_key,
       case r.part_role when 'SCC/LABEL' then 'SCC_LABEL' else r.part_role end as role,
       coalesce(a.item_id, core.norm_code(r.item_code))  as item_id,
       r.item_code                                        as source_code,
       r.description,
       coalesce(r.qty, 1)                                 as qty_per_unit,
       r.bom_group,
       (r.common_flag = 'COMMON')                         as is_common,
       r.n_models
  from analytics.v_bom_requirement_x r
  left join core.v_item_alias a on a.alias_id = core.norm_code(r.item_code)
 where r.item_code is not null and btrim(r.item_code) <> '';

comment on view core.v_item_hierarchy is
  '기종 → 역할(CAP · NEUTRAL · MUST_OPTION · SCC_LABEL · BOM) → 구성품 · 구성수량. 종속수요 전개의 재료';


-- ══ 7b. 일평균 사용량 — 월 수요를 하루 단위로 환산 ═══════════════
--
-- 예전 core.v_usage_effective(일별 거래에서 계산)의 자리. 결품 위험(sql/15)이 daily_usage_avg ·
-- cv 를 읽습니다. 실데이터는 월 단위라 최근 12개월 월평균 ÷ 30.4 로 환산합니다 —
-- 새 숫자를 지어내는 것이 아니라 단위를 바꾸는 것이며, source 에 그 사실을 적습니다.
-- 0 인 달은 원본에 없어 12개월 고정 분모로 나눕니다(외부 v_shipment_trend 와 같은 규칙).

create or replace view core.v_usage_effective as
with bound as (select max(period) as max_p from core.v_demand_monthly),
recent as (
  select d.item_id, d.period, d.qty
    from core.v_demand_monthly d cross join bound b
   where d.qty >= 0
     and d.period > b.max_p - interval '12 months'
),
agg as (
  select r.item_id,
         count(*)                                   as n_months,
         sum(r.qty) / 12.0                          as monthly_avg,
         -- 0 인 달을 포함한 표준편차: 12개월 중 관측된 달만 있으므로 모집단식으로 보정
         sqrt(greatest(sum(r.qty * r.qty) / 12.0 - power(sum(r.qty) / 12.0, 2), 0)) as monthly_sd
    from recent r
   group by r.item_id
)
select a.item_id,
       (a.n_months * 30)::bigint                          as valid_days,
       round(a.monthly_avg / 30.4, 2)                     as daily_usage_avg,
       round(a.monthly_sd / 30.4, 2)                      as daily_usage_sd,
       round(a.monthly_avg / 30.4, 2)                     as usage_used,
       round(a.monthly_sd / nullif(a.monthly_avg, 0), 2)  as cv,
       '월평균 환산'::text                                 as source
  from agg a;

comment on view core.v_usage_effective is
  '최근 12개월 월평균을 일 단위로 환산한 사용량. 결품 위험 · 알림 룰이 읽습니다 (실데이터 전환)';


-- ══ 8. 아직 없는 데이터 — 같은 컬럼, 0행 ═══════════════════════
--
-- [DATA_PENDING] 재고 스냅샷 · 공급처 · 발주 · 입고 · 리드타임 실적이 들어오면 이 정의들을
-- 그 파일 형식에 맞는 raw 테이블 위로 다시 씁니다. 그때까지는 비어 있어서 재고 전개 ·
-- 결품 위험 · 발주 추천 · ATP · 가상 운영 · What-If · 리드타임 격차가 "산출 불가" 입니다.
-- 컬럼 이름과 타입은 예전 정의(덤프)와 같습니다 — 위 뷰들이 그대로 조인합니다.

-- [DATA_PENDING: SUPPLIER_MASTER]
create or replace view core.v_supplier_master as
select null::text as supplier_id, null::text as supplier_name, null::text as country,
       null::int  as std_lead_time, null::text as is_active
 where false;

-- [DATA_PENDING: PURCHASE_ORDER · RECEIPT · SHIPMENT_LOG]
create or replace view core.v_fact_shipment as
select null::text as shipment_id, null::text as po_no, null::text as item_id, null::text as supplier_id,
       null::text as country, null::text as transport_mode,
       null::date as order_date, null::date as due_date, null::date as supplier_ship_date,
       null::date as port_departure_date, null::date as port_arrival_date, null::date as customs_clear_date,
       null::date as warehouse_receipt_date, null::date as qc_release_date,
       null::numeric as qty, null::text as status, null::text as incident_note,
       null::int as seg_order_to_ship, null::int as seg_ship_to_receive, null::int as lt_total,
       null::text as quality_flag
 where false;

create or replace view core.v_shipment_valid as
select * from core.v_fact_shipment where false;

-- [DATA_PENDING: LEADTIME]
create or replace view core.v_leadtime_stat as
select null::text as supplier_id, null::text as supplier_name, null::text as country,
       null::bigint as n_samples, null::numeric as avg_order_to_ship, null::numeric as avg_ship_to_receive,
       null::numeric as mean_days, null::int as p50_days, null::int as p80_days, null::int as p90_days,
       null::numeric as std_days, null::int as max_days, null::text as confidence
 where false;

-- ★ 정의 문자열에 'core.v_leadtime_stat ' (뒤 공백) 이 있어야 sql/29 §3-2 의 rewrite 가 찾습니다.
create or replace view core.v_leadtime_effective as
select st.supplier_id, st.supplier_name, st.country, st.n_samples, st.p80_days,
       p.planned_lead_time,
       coalesce(p.planned_lead_time, st.p80_days) as effective_lead_time,
       case when p.planned_lead_time is not null then '확정값' else '실적 P80' end as source
  from core.v_leadtime_stat st
  left join core.leadtime_plan p on p.supplier_id = st.supplier_id;

-- [DATA_PENDING: INVENTORY]
create or replace view core.v_stock_on_hand as
select null::text as item_id, null::numeric as current_stock where false;

create or replace view core.v_inbound_qty as
select null::text as item_id, null::numeric as inbound_qty, null::bigint as inbound_shipments,
       null::date as earliest_eta
 where false;

-- 리드타임 격차 화면(lib/scm.ts)이 읽는 뷰. 예전 컬럼 그대로 0행.
create or replace view analytics.v_leadtime_gap as
select null::text as supplier_id, null::text as supplier_name, null::text as country,
       null::int as std_lead_time, null::bigint as n_samples,
       null::numeric as avg_order_to_ship, null::numeric as avg_ship_to_receive, null::numeric as mean_days,
       null::int as p50_days, null::int as p80_days, null::int as p90_days, null::numeric as std_days,
       null::int as gap_days, null::text as confidence
 where false;


-- ══ 9. 데이터 가용성 — 화면 배너의 재료 ═══════════════════════

create or replace view analytics.v_data_availability as
select 'DEMAND'::text as kind, (select count(*) from core.v_demand_monthly)::bigint as n_rows,
       null::text as needed_files, '월별 수요 (부품 · 소모품 · 옵션 · 기종 실적)'::text as note
union all
select 'ITEM', (select count(*) from core.v_item_master), null, '품목 · 기종 마스터'
union all
select 'INVENTORY', 0, 'INVENTORY (월말 재고 스냅샷)',
       '재고 전개 · 결품 위험 · 발주 추천 · ATP · 가상 운영 · What-If'
union all
select 'LEADTIME', 0, 'SUPPLIER_MASTER · PURCHASE_ORDER · RECEIPT (공급처 · 발주 · 입고 실적)',
       '리드타임 격차 · 발주 권고일'
union all
select 'PRICE', 0, 'ITEM_MASTER 단가 · MOQ · 발주단위', '추천 금액 · 발주 수량 올림';

comment on view analytics.v_data_availability is
  '데이터 종류별 행수와 필요한 파일. 0 이면 그 데이터를 기다리는 화면이 배너를 띄웁니다';


-- ══ 10. 학습 · 검증 경계를 실데이터 범위로 ══════════════════════
--
-- 더미(2024~2025) 경계가 남아 있으면 학습 격자가 비어 예측이 0행이 됩니다.
-- 경계가 데이터 범위 밖이면 다시 잡습니다 — 검증 구간은 마지막 6개월, 그 앞은 전부 학습.
-- 관리자가 화면에서 경계를 데이터 안쪽으로 조정했으면 건드리지 않습니다.
-- production_train_end 는 sql/27 이 (컬럼을 만들면서) 같은 기준으로 채웁니다.

do $$
declare
  v_min date; v_max date;
begin
  select min(period), max(period) into v_min, v_max from core.v_demand_monthly;
  if v_max is null then
    raise notice 'sql/34: 수요 데이터가 없어 forecast_setting 을 건드리지 않습니다';
    return;
  end if;

  if not exists (select 1 from core.forecast_setting where id = 1) then
    insert into core.forecast_setting (id, train_start, train_end, test_start, test_end)
    values (1, v_min,
            (date_trunc('month', v_max) - interval '6 months')::date - 1,
            (date_trunc('month', v_max) - interval '6 months')::date,
            v_max);
    raise notice 'sql/34: forecast_setting 을 실데이터 범위(% ~ %)로 만들었습니다', v_min, v_max;
    return;
  end if;

  update core.forecast_setting s
     set train_start = v_min,
         train_end   = (date_trunc('month', v_max) - interval '6 months')::date - 1,
         test_start  = (date_trunc('month', v_max) - interval '6 months')::date,
         test_end    = v_max,
         updated_at  = now()
   where s.id = 1
     and (s.test_end < v_max or s.train_start < v_min or s.test_end > v_max);
  if found then
    raise notice 'sql/34: forecast_setting 경계를 실데이터 범위(% ~ %)로 다시 잡았습니다', v_min, v_max;
  end if;
end $$;


-- ══ 11. 권한 ═══════════════════════════════════════════════════

do $$
declare v text;
begin
  foreach v in array array[
    'core.mv_item_alias', 'core.mv_item_master', 'core.mv_demand_monthly',
    'core.v_item_alias', 'core.v_item_master', 'core.v_demand_monthly', 'core.v_item_hierarchy',
    'core.v_supplier_master', 'core.v_fact_shipment', 'core.v_shipment_valid', 'core.v_leadtime_stat',
    'core.v_leadtime_effective', 'core.v_stock_on_hand', 'core.v_inbound_qty', 'core.v_usage_effective',
    'analytics.v_leadtime_gap', 'analytics.v_data_availability'
  ] loop
    execute format('grant select on %s to authenticated', v);
    execute format('revoke all on %s from anon', v);
  end loop;
end $$;

grant select on core.realdata_load to authenticated;
revoke all on core.realdata_load from anon;
alter table core.realdata_load enable row level security;
drop policy if exists realdata_load_read on core.realdata_load;
create policy realdata_load_read on core.realdata_load for select to authenticated using (true);


-- ══ 12. 확인 ═══════════════════════════════════════════════════

select 'v_item_master'    as v, count(*) from core.v_item_master
union all select 'v_item_master.MACHINE', count(*) from core.v_item_master where is_machine
union all select 'v_item_alias',     count(*) from core.v_item_alias
union all select 'v_demand_monthly', count(*) from core.v_demand_monthly
union all select 'v_demand_monthly.MACHINE', count(*) from core.v_demand_monthly where item_type = 'MACHINE'
union all select 'v_item_hierarchy', count(*) from core.v_item_hierarchy
union all select 'dummy ITEM0%',     count(*) from core.v_item_master where item_id like 'ITEM0%';

-- 외부 README 기준값 — 602K02693 최근 12개월 평균 772.3
select item_id, round(sum(qty) / 12.0, 1) as avg_12m
  from core.v_demand_monthly
 where item_id = core.norm_code('602K02693')
   and period > (select max(period) from core.v_demand_monthly) - interval '12 months'
 group by item_id;

select id, train_start, train_end, test_start, test_end from core.forecast_setting;
