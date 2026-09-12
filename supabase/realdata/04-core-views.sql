-- ============================================================
-- 03. core 스키마 — 정제와 기준
--
--   raw 의 원본을 "업무 규칙을 한 번 적용한" 형태로 바꿉니다.
--   같은 정제 규칙이 화면마다 흩어지면 같은 지표가 화면마다 다른 숫자로 나옵니다.
--   그래서 규칙은 여기 한 곳에만 둡니다.
--
--   선행: 01-schema.sql · CSV 적재 · 03-verify.sql 통과
-- ============================================================

-- ------------------------------------------------------------
-- 재실행 안전 — 이 파일이 만드는 뷰를 먼저 지웁니다.
--   create or replace 는 컬럼 구성이 바뀌면 실패합니다
--   (ERROR: cannot drop columns from view).
-- ------------------------------------------------------------
drop view if exists core.v_option_commonality cascade;
drop view if exists core.v_shipment_by_hoc    cascade;
drop view if exists core.v_part_linkage       cascade;
drop view if exists core.v_model              cascade;
drop view if exists core.v_item               cascade;
drop view if exists core.v_ym_calendar        cascade;

-- ------------------------------------------------------------
-- v_ym_calendar — 데이터에 존재하는 모든 월
--
--   fact_shipment 는 수량 0인 달을 저장하지 않습니다(희소 저장).
--   "최근 3개월 평균"처럼 0을 포함해야 하는 계산은 이 달력과 이어 붙입니다.
-- ------------------------------------------------------------
create or replace view core.v_ym_calendar as
select distinct ym from raw.fact_shipment;

comment on view core.v_ym_calendar is '출고 데이터에 존재하는 월 목록. 희소 저장 보정용';


-- ------------------------------------------------------------
-- v_item — 품목 마스터 (발주 코드 보정)
--
--   hoc_code 가 비어 있으면 자기 자신이 대표코드입니다.
-- ------------------------------------------------------------
create or replace view core.v_item as
select item_code,
       coalesce(nullif(btrim(hoc_code), ''), item_code) as hoc_code,
       description,
       family,
       item_type,
       source_types
from raw.dim_item;


-- ------------------------------------------------------------
-- v_model — 기종 마스터 (기종이 아닌 행 제거)
--
--   ★ dim_model 8행은 'DT Common' · 'Newline Q+ 02"' 같은 Option MAP 헤더 그룹 키입니다.
--     기종이 아니므로 여기서 걸러 냅니다. 이후 조회는 전부 이 뷰를 씁니다.
-- ------------------------------------------------------------
create or replace view core.v_model as
select model_key,
       model_base,
       nullif(btrim(biz), '')      as biz,
       nullif(btrim(iot_code), '') as iot_code,
       sources
from raw.dim_model
where model_base is not null
  and btrim(model_base) <> '';


-- ------------------------------------------------------------
-- v_part_linkage — XCN 연계 (구코드 → 대표코드)
--
--   설계변경으로 부품 코드가 계속 바뀝니다.
--   출고 Trend 는 연계 코드의 "합계"로 봐야 하고, 발주는 hoc_item 으로 합니다.
--
--   ★★ fix round(supabase/migrations/20260912001100_hoc_fanout_fix.sql과 같은 정의 —
--   고칠 때 두 파일을 함께 고친다) — 원래 정의(select distinct related_item, hoc_item)는
--   raw.bridge_xcn에서 같은 related_item이 서로 다른 hoc_item 두 개를 가리키는 454건
--   (20,306개 related_item 중, 실측)을 그대로 통과시켰다. core.v_shipment_by_hoc가 이 뷰를
--   left join한 뒤 sum(qty)를 내므로, 팬아웃된 related_item의 출고 실적 전량이 두 hoc_item
--   양쪽에 각각 통째로 합산돼(관계가 아니라 결함) 총량이 956만큼 부풀었다(raw.fact_shipment
--   4,710,425 vs core.v_shipment_by_hoc 4,711,381, analytics.v_shipment_trend도 동일하게
--   부풀어 있었다 — 기존 화면이 이미 틀린 값을 보여주고 있었다).
--
--   454건 중 451건은 "family·설명 중 하나 이상 채워진 행 1 + 전부 빈 행 1" 단일 서명이고
--   1건(051K40992)은 완전성(채워진 칸 수)으로 가려진다. 진짜 모호한 2건(285K38666 —
--   두 행 다 전부 빔, 893K40191 — 두 행 다 채워져 있지만 서로 다른 기종의 서로 다른 부품)은
--   완전성 최댓값이 서로 다른 hoc_item에 걸려 임의로 고를 근거가 없다 — 뷰에서 뺀다(아래
--   n_distinct_hoc = 1 조건). core.v_shipment_by_hoc의 coalesce(x.hoc_item, f.item_code)가
--   그 2개 코드를 XCN 미적용(자기 코드가 대표코드)으로 되돌릴 뿐이라 총량은 그대로 보존된다.
-- ------------------------------------------------------------
create or replace view core.v_part_linkage as
with scored as (
  select
    related_item,
    hoc_item,
    (
      (case when nullif(btrim(coalesce(family,       '')), '') is not null then 1 else 0 end) +
      (case when nullif(btrim(coalesce(related_desc, '')), '') is not null then 1 else 0 end) +
      (case when nullif(btrim(coalesce(hoc_desc,     '')), '') is not null then 1 else 0 end)
    ) as completeness
  from raw.bridge_xcn
  where related_item is not null
    and hoc_item     is not null
),
ranked as (
  select related_item, hoc_item,
         rank() over (partition by related_item order by completeness desc) as rnk
  from scored
),
winners as (
  select distinct related_item, hoc_item
  from ranked
  where rnk = 1
),
winner_counts as (
  select related_item, count(distinct hoc_item) as n_distinct_hoc
  from winners
  group by related_item
)
select w.related_item, w.hoc_item
from winners w
join winner_counts c
  on c.related_item = w.related_item
 and c.n_distinct_hoc = 1;


-- ------------------------------------------------------------
-- v_shipment_by_hoc — ★ XCN 을 반영한 대표코드 기준 월별 출고량
--
--   데이터 설명 원문:
--     "출고 Trend 확인시에는 연계된 부품코드의 합계 출고량을 봐야 하고
--      발주시에는 최종 부품코드(HOC Code)로 발주가 진행됨"
--
--   ★ 이 뷰를 쓰지 않고 raw.fact_shipment 를 직접 읽으면
--     살아 있는 부품이 "단종"으로 보이고 수요가 절반으로 줄어 보입니다.
--
--   PART 만 XCN 이 적용됩니다. SUPPLY · OPTION 은 자기 코드가 곧 대표코드입니다.
-- ------------------------------------------------------------
create or replace view core.v_shipment_by_hoc as
select coalesce(x.hoc_item, f.item_code) as hoc_item,
       f.item_type,
       f.ym,
       sum(f.qty)                        as qty,
       count(*)                          as n_source_codes
from raw.fact_shipment f
left join core.v_part_linkage x
       on x.related_item = f.item_code
      and f.item_type    = 'PART'
group by 1, 2, 3;

comment on view core.v_shipment_by_hoc is
  'XCN 연계를 합산한 대표코드 기준 월별 출고량. Tool 은 반드시 이 뷰를 읽는다';


-- ------------------------------------------------------------
-- v_option_commonality — 옵션이 몇 개 기종에 공용인가
--
--   Common 품을 기종별로 나눠 세면 이중 계상됩니다. 먼저 이 뷰로 판정합니다.
-- ------------------------------------------------------------
create or replace view core.v_option_commonality as
select item_code,
       count(distinct model_base) filter (where model_base is not null) as n_models,
       max(common)                                                       as common_flag
from raw.bridge_option_model
group by item_code;


-- ------------------------------------------------------------
-- 확인
-- ------------------------------------------------------------
select 'v_model'              as 뷰, count(*) as 행수 from core.v_model
union all select 'v_part_linkage',    count(*) from core.v_part_linkage
union all select 'v_shipment_by_hoc', count(*) from core.v_shipment_by_hoc
union all select 'v_option_commonality', count(*) from core.v_option_commonality
union all select 'v_ym_calendar',     count(*) from core.v_ym_calendar;
-- 기대: v_model 137 · v_ym_calendar 79 · v_shipment_by_hoc 는 원본보다 약간 적음
--             (연계 코드가 대표코드로 합쳐지므로)

-- XCN 합산이 실제로 동작하는지 — 대표코드 556K59129 는 연계 코드가 5개입니다
select hoc_item, ym, qty, n_source_codes
from core.v_shipment_by_hoc
where hoc_item = '556K59129'
order by ym;
