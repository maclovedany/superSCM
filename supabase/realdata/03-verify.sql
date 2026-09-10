-- ============================================================
-- 03. 적재 검증
--
--   여기까지 왔다면 아래를 끝낸 상태여야 합니다.
--     01-schema.sql          테이블 10개 생성
--     02-data-01 ~ 02-data-09.sql   데이터 적재 (9개 전부, 번호 순서대로)
--
--   ★ 하나라도 건너뛰면 아래 ① 검증에서 "불일치"로 잡힙니다.
--   ★ 같은 파일을 두 번 실행해도 "불일치"로 잡힙니다(행이 두 배가 됩니다).
--     그때는 01-schema.sql 부터 다시 실행하세요. 테이블을 비우고 다시 만듭니다.
--
--   왜 CSV 가 아니라 INSERT 파일인가
--     SQL 로는 여러분 PC 의 CSV 를 읽을 수 없습니다.
--     `COPY ... FROM '경로'` 는 DB 서버의 파일을 읽고(Supabase 에서는 접근 불가),
--     `\copy` 는 psql 이라는 프로그램의 명령이지 SQL 이 아닙니다.
--     그래서 데이터를 INSERT 문으로 구워 두었습니다. 모두가 똑같은 것을 실행합니다.
-- ============================================================

-- ============================================================
-- 검증 ① — 행수가 기대와 맞는가
-- ============================================================
with expected(t, n) as (values
    ('dim_item',             93868),
    ('dim_model',              145),
    ('fact_shipment',       103795),
    ('fact_mc_plan_actual',   2765),
    ('bridge_bom',            7157),
    ('bridge_scc_config',       88),
    ('bridge_mc_cap',          106),
    ('bridge_cap_option',      646),
    ('bridge_option_model',    972),
    ('bridge_xcn',           20760)
),
actual(t, n) as (
    select 'dim_item',            count(*) from raw.dim_item
    union all select 'dim_model',            count(*) from raw.dim_model
    union all select 'fact_shipment',        count(*) from raw.fact_shipment
    union all select 'fact_mc_plan_actual',  count(*) from raw.fact_mc_plan_actual
    union all select 'bridge_bom',           count(*) from raw.bridge_bom
    union all select 'bridge_scc_config',    count(*) from raw.bridge_scc_config
    union all select 'bridge_mc_cap',        count(*) from raw.bridge_mc_cap
    union all select 'bridge_cap_option',    count(*) from raw.bridge_cap_option
    union all select 'bridge_option_model',  count(*) from raw.bridge_option_model
    union all select 'bridge_xcn',           count(*) from raw.bridge_xcn
)
select e.t                     as 테이블,
       e.n                     as 기대,
       a.n                     as 실제,
       case when e.n = a.n then 'OK' else '★ 불일치' end as 판정
from expected e join actual a on a.t = e.t
order by e.t;


-- ============================================================
-- 검증 ② — 기간과 유형이 맞는가
-- ============================================================
select item_type,
       count(*)                  as 행수,
       count(distinct item_code) as 품목수,
       min(ym)                   as 시작,
       max(ym)                   as 끝
from raw.fact_shipment
group by item_type
order by 행수 desc;
-- 기대
--   PART    51,597행 · 6,885품목 · 2023-04 ~ 2026-07
--   OPTION  34,568행 · 3,596품목 · 2020-01 ~ 2026-07
--   SUPPLY  17,630행 ·   634품목 · 2023-04 ~ 2026-07


-- ============================================================
-- 검증 ③ — 고아 키가 얼마나 되는가
--   (0이 아니어도 괜찮습니다. "얼마나 되는지 알고 시작"하는 것이 목적입니다)
-- ============================================================
select 'fact_shipment → dim_item'   as 관계,
       count(*) filter (where i.item_code is null) as 고아행,
       count(*)                                     as 전체
from raw.fact_shipment f
left join raw.dim_item i on i.item_code = f.item_code
union all
select 'bridge_bom → dim_item',
       count(*) filter (where i.item_code is null), count(*)
from raw.bridge_bom b
left join raw.dim_item i on i.item_code = b.item_code
union all
select 'bridge_xcn.hoc → dim_item',
       count(*) filter (where i.item_code is null), count(*)
from raw.bridge_xcn x
left join raw.dim_item i on i.item_code = x.hoc_item;


-- ============================================================
-- 검증 ④ — 기종 표기 불일치 (알려진 한계)
--   BOM 과 MC 실적을 model_base 로 조인했을 때 공통 기종이 몇 개인가
-- ============================================================
select count(*) as 공통_기종수
from (select distinct model_base from raw.bridge_bom          where model_base is not null) b
join (select distinct model_base from raw.fact_mc_plan_actual where model_base is not null) m
  using (model_base);
-- 기대: 20개
-- 나머지는 한쪽 파일에만 존재합니다(단종 기종 · 아직 실적 없는 신기종).
-- 실제 매핑 관계는 현업 확인이 필요하며, 확정되면 dim_model 에 매핑 컬럼을 추가하십시오.


-- ============================================================
-- 검증 ⑤ — 기종이 아닌 행 (걸러야 하는 것)
-- ============================================================
select count(*) as model_base_없는_행
from raw.dim_model where model_base is null or btrim(model_base) = '';
-- 기대: 8개. 'DT Common' · 'Newline Q+ 02"' 같은 Option MAP 헤더 그룹 키입니다.
--       (biz 가 빈 행은 38개로 별개입니다. 그건 기종이 맞고 사업부만 미분류입니다)
-- 이후 모든 조회에서 core.v_model 을 쓰면 자동으로 걸러집니다.
