-- ──────────────────────────────────────────────────────────────
-- sql/33 — 실데이터 core · analytics 뷰 (6회차 `04-core-views.sql` + `05-analytics-views.sql` 사본)
--
-- 그대로입니다. XCN 합산(core.v_shipment_by_hoc) · 기종 정리(core.v_model) · 수요 유형
-- (analytics.v_item_demand_profile) · OL 정확도 · BOM 전개(analytics.v_bom_requirement_x) 를
-- 만듭니다. sql/34 의 표준 입력 뷰가 이 위에 섭니다. AI Agent Tool 도 이 뷰들을 읽습니다.
-- 재실행 안전 — 두 파일 모두 자기 뷰를 먼저 지웁니다.
-- ──────────────────────────────────────────────────────────────

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
-- ------------------------------------------------------------
create or replace view core.v_part_linkage as
select distinct
       related_item,
       hoc_item
from raw.bridge_xcn
where related_item is not null
  and hoc_item     is not null;


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


-- ============================================================
-- 04. analytics 스키마 — 화면과 AI Tool 이 조회하는 뷰
--
--   ★ 오늘 만들 Tool 4개는 전부 이 파일의 뷰만 읽습니다.
--     lib/agent/ 안에는 SQL 이 한 줄도 없어야 합니다.
--
--   ┌ Tool ─────────────────┬ 읽는 뷰 ──────────────────────────┐
--   │ getShipmentTrend      │ analytics.v_shipment_trend        │
--   │ getDemandProfile      │ analytics.v_item_demand_profile   │
--   │ getOlAccuracy         │ analytics.v_ol_accuracy           │
--   │ getBomRequirement     │ analytics.v_bom_requirement_x     │
--   │ (선택) getPartLinkage │ analytics.v_part_linkage          │
--   └───────────────────────┴───────────────────────────────────┘
--
--   ★ 왜 v_item_demand_profile 인가 (v_sku_demand_profile 이 아니라)
--     5회차 STEP 5 가 이미 analytics.v_sku_demand_profile 과
--     analytics.v_demand_profile_kpi 를 만들어 두었습니다. 컬럼 구성이 달라
--     create or replace 가 "cannot drop columns from view" 로 실패하고,
--     강제로 덮으면 /analysis/demand-profile 화면이 죽습니다.
--     그래서 새 데이터용 뷰는 이름을 달리 합니다. 5회차 화면은 그대로 살아 있고,
--     7회차에서 화면을 이 뷰로 이관한 뒤 옛 뷰를 지웁니다.
--
--   선행: 04-core-views.sql
-- ============================================================

-- ------------------------------------------------------------
-- 재실행 안전 — 이 파일이 만드는 뷰를 먼저 지웁니다.
--   create or replace 는 컬럼이 바뀌면 실패합니다. 뷰 정의를 고칠 때마다
--   이 블록이 없으면 "cannot drop columns from view" 를 만나게 됩니다.
--   ★ 5회차 뷰(v_sku_demand_profile · v_demand_profile_kpi)는 건드리지 않습니다.
-- ------------------------------------------------------------
drop view if exists analytics.v_realdata_kpi          cascade;
drop view if exists analytics.v_part_linkage          cascade;
drop view if exists analytics.v_bom_requirement_x     cascade;
drop view if exists analytics.v_bom_requirement       cascade;
drop view if exists analytics.v_ol_accuracy_fy        cascade;
drop view if exists analytics.v_ol_accuracy           cascade;
drop view if exists analytics.v_item_demand_kpi       cascade;
drop view if exists analytics.v_item_demand_profile   cascade;
drop view if exists analytics.v_shipment_trend        cascade;


-- ============================================================
-- ① v_shipment_trend — 월별 출고 추이와 이동평균
--
--   ★ core.v_shipment_by_hoc 를 읽습니다 (XCN 합산 반영).
--   ★ 0인 달은 저장되어 있지 않으므로, 이동평균은 "합계 ÷ 고정 개월수" 로 냅니다.
--     그래야 출고가 없던 달이 0으로 반영됩니다. 관측된 달만 평균 내면 값이 부풀립니다.
-- ============================================================
create or replace view analytics.v_shipment_trend as
with bound as (
    select max(ym) as max_ym,
           max(substring(ym from 1 for 4)::int * 12
             + substring(ym from 6 for 2)::int) as max_idx
    from raw.fact_shipment
),
s as (
    select h.hoc_item,
           h.item_type,
           h.ym,
           h.qty,
           substring(h.ym from 1 for 4)::int * 12
         + substring(h.ym from 6 for 2)::int as idx
    from core.v_shipment_by_hoc h
)
select s.hoc_item                                                as item_code,
       i.description,
       i.family,
       max(s.item_type)                                          as item_type,
       b.max_ym                                                  as data_as_of,

       count(*)::int                                             as n_months,
       min(s.ym)                                                 as first_ym,
       max(s.ym)                                                 as last_ym,
       (b.max_idx - max(s.idx))::int                             as months_since_last,
       (b.max_idx - min(s.idx) + 1)::int                         as n_span,

       round(sum(s.qty), 1)                                      as total_qty,
       round(coalesce(max(s.qty) filter (where s.idx = b.max_idx), 0), 1) as latest_qty,

       round(coalesce(sum(s.qty) filter (where s.idx > b.max_idx - 3),  0) /  3.0, 1) as avg_3m,
       round(coalesce(sum(s.qty) filter (where s.idx > b.max_idx - 6),  0) /  6.0, 1) as avg_6m,
       round(coalesce(sum(s.qty) filter (where s.idx > b.max_idx - 12), 0) / 12.0, 1) as avg_12m,

       -- 최근 3개월이 12개월 평균 대비 몇 배인가. 1.0 이면 변화 없음
       round(
           (coalesce(sum(s.qty) filter (where s.idx > b.max_idx - 3), 0) / 3.0)
         / nullif(coalesce(sum(s.qty) filter (where s.idx > b.max_idx - 12), 0) / 12.0, 0)
       , 2)                                                      as trend_3m_vs_12m,

       -- 관측 기간이 짧으면 추세를 말하지 않습니다
       case when (b.max_idx - min(s.idx) + 1) < 6
            then 'INSUFFICIENT_HISTORY' end                      as reason_code
from s
cross join bound b
left join core.v_item i on i.item_code = s.hoc_item
group by s.hoc_item, i.description, i.family, b.max_ym, b.max_idx;

comment on view analytics.v_shipment_trend is
  'XCN 합산 기준 품목별 출고 추이. 이동평균은 0인 달을 포함해 계산(합계÷고정개월수)';


-- ============================================================
-- ② v_item_demand_profile — 수요 성격 분류
--
--   Syntetos–Boylan 분류를 씁니다.
--     ADI  = 관측 기간 ÷ 수요 발생 횟수    (크면 드물게 팔린다)
--     CV²  = (표준편차 ÷ 평균)²            (크면 양이 불안정하다)
--
--     ADI < 1.32 · CV² < 0.49  →  SMOOTH        꾸준하고 안정적
--     ADI < 1.32 · CV² ≥ 0.49  →  ERRATIC       자주 팔리나 양이 흔들림
--     ADI ≥ 1.32 · CV² < 0.49  →  INTERMITTENT  드물게 팔림
--     ADI ≥ 1.32 · CV² ≥ 0.49  →  LUMPY         드물고 양도 흔들림
--
--   ★ 관측 기간은 "품목의 첫 출고월 ~ 데이터 전체의 마지막 월" 입니다.
--     전체 창(2020-01~)으로 잡으면 신제품이 전부 INTERMITTENT 로 나옵니다.
--   ★ 6개월 미만이면 유형을 추정하지 않고 null + INSUFFICIENT_HISTORY 입니다.
--     추정해서 채우면 그 순간 우리가 환각을 만든 것입니다.
-- ============================================================
create or replace view analytics.v_item_demand_profile as
with bound as (
    select max(ym) as max_ym,
           max(substring(ym from 1 for 4)::int * 12
             + substring(ym from 6 for 2)::int) as max_idx
    from raw.fact_shipment
),
agg as (
    select h.hoc_item,
           max(h.item_type)                                       as item_type,
           b.max_ym,
           count(*)::int                                          as n_nonzero,
           (b.max_idx - min(substring(h.ym from 1 for 4)::int * 12
                          + substring(h.ym from 6 for 2)::int) + 1)::int as n_span,
           avg(h.qty)                                             as mean_nz,
           stddev_samp(h.qty)                                     as sd_nz,
           min(h.ym)                                              as first_ym,
           max(h.ym)                                              as last_ym
    from core.v_shipment_by_hoc h
    cross join bound b
    group by h.hoc_item, b.max_idx, b.max_ym
)
select a.hoc_item                                    as item_code,
       i.description,
       i.family,
       a.item_type,
       a.max_ym                                      as data_as_of,
       a.first_ym,
       a.last_ym,
       a.n_span                                      as n_periods,
       a.n_nonzero,
       round(a.mean_nz, 1)                           as mean_nonzero_qty,

       case when a.n_span >= 6
            then round(a.n_span::numeric / a.n_nonzero, 2) end          as adi,
       case when a.n_span >= 6
            then round(1 - a.n_nonzero::numeric / a.n_span, 3) end      as zero_demand_rate,
       case when a.n_span >= 6 and a.n_nonzero >= 2 and a.mean_nz > 0
            then round((a.sd_nz / a.mean_nz) ^ 2, 3) end                as cv_squared,

       case
           when a.n_span    <  6 then null
           when a.n_nonzero <  2 then null
           when a.mean_nz  <= 0  then null
           when a.n_span::numeric / a.n_nonzero < 1.32
                and (a.sd_nz / a.mean_nz) ^ 2 < 0.49 then 'SMOOTH'
           when a.n_span::numeric / a.n_nonzero < 1.32 then 'ERRATIC'
           when (a.sd_nz / a.mean_nz) ^ 2 < 0.49       then 'INTERMITTENT'
           else 'LUMPY'
       end                                           as demand_type,

       case
           when a.n_span    <  6 then 'INSUFFICIENT_HISTORY'
           when a.n_nonzero <  2 then 'INSUFFICIENT_SAMPLE'
           when a.mean_nz  <= 0  then 'NO_POSITIVE_DEMAND'
       end                                           as reason_code
from agg a
left join core.v_item i on i.item_code = a.hoc_item;

comment on view analytics.v_item_demand_profile is
  'Syntetos-Boylan 수요 유형 분류. 관측 6개월 미만은 유형 null + INSUFFICIENT_HISTORY';


-- 요약 — 유형별 품목 수
create or replace view analytics.v_item_demand_kpi as
select item_type,
       count(*)                                                as n_items,
       count(*) filter (where demand_type = 'SMOOTH')          as n_smooth,
       count(*) filter (where demand_type = 'ERRATIC')         as n_erratic,
       count(*) filter (where demand_type = 'INTERMITTENT')    as n_intermittent,
       count(*) filter (where demand_type = 'LUMPY')           as n_lumpy,
       count(*) filter (where demand_type is null)             as n_unknown,
       count(*) filter (where demand_type in ('INTERMITTENT','LUMPY')) as n_croston_candidate
from analytics.v_item_demand_profile
group by item_type;


-- ============================================================
-- ③ v_ol_accuracy — 영업 OL · SCM OL 의 예측 정확도
--
--     WAPE = Σ|OL − 실적| ÷ Σ실적      작을수록 좋다
--     Bias = Σ(OL − 실적) ÷ Σ실적      ★ 양수가 과대예측
--
--   ★ 실적(act)이 null 인 행은 채점에서 뺍니다. 0으로 채우면 정확도가 왜곡됩니다.
--   ★ Sales 와 SCM 은 채워진 행이 서로 달라 분모를 각각 따로 잡습니다.
-- ============================================================
create or replace view analytics.v_ol_accuracy as
select coalesce(nullif(btrim(model_base), ''), '(미분류)')     as model_base,
       fy_sheet,
       max(biz)                                                as biz,
       count(*)::int                                           as n_rows,
       min(ym)                                                 as first_ym,
       max(ym)                                                 as last_ym,
       round(sum(act) filter (where act is not null), 1)       as total_act,

       count(*) filter (where sales_ol is not null and act is not null)::int as n_scored_sales,
       round(sum(abs(sales_ol - act)) filter (where sales_ol is not null and act is not null)
           / nullif(sum(act)         filter (where sales_ol is not null and act is not null), 0), 3)
                                                               as sales_wape,
       round(sum(sales_ol - act)      filter (where sales_ol is not null and act is not null)
           / nullif(sum(act)          filter (where sales_ol is not null and act is not null), 0), 3)
                                                               as sales_bias,

       count(*) filter (where scm_ol is not null and act is not null)::int   as n_scored_scm,
       round(sum(abs(scm_ol - act))   filter (where scm_ol is not null and act is not null)
           / nullif(sum(act)          filter (where scm_ol is not null and act is not null), 0), 3)
                                                               as scm_wape,
       round(sum(scm_ol - act)        filter (where scm_ol is not null and act is not null)
           / nullif(sum(act)          filter (where scm_ol is not null and act is not null), 0), 3)
                                                               as scm_bias,

       case when sum(act) filter (where act is not null) is null
             or sum(act) filter (where act is not null) = 0
            then 'NO_ACTUAL' end                               as reason_code
from raw.fact_mc_plan_actual
group by 1, 2;

comment on view analytics.v_ol_accuracy is
  '기종 × 회계연도 OL 정확도. Bias 양수 = 과대예측. act null 행은 채점 제외';


-- 회계연도 전체 합 (강의 S00 실측 표와 같은 숫자가 나옵니다)
create or replace view analytics.v_ol_accuracy_fy as
select fy_sheet,
       count(*)::int                                           as n_rows,
       count(*) filter (where sales_ol is not null and scm_ol is not null and act is not null)::int
                                                               as n_scored,
       round(sum(abs(sales_ol - act)) filter (where sales_ol is not null and scm_ol is not null and act is not null)
           / nullif(sum(act)         filter (where sales_ol is not null and scm_ol is not null and act is not null), 0), 3) as sales_wape,
       round(sum(abs(scm_ol - act))   filter (where sales_ol is not null and scm_ol is not null and act is not null)
           / nullif(sum(act)         filter (where sales_ol is not null and scm_ol is not null and act is not null), 0), 3) as scm_wape,
       round(sum(sales_ol - act)      filter (where sales_ol is not null and scm_ol is not null and act is not null)
           / nullif(sum(act)         filter (where sales_ol is not null and scm_ol is not null and act is not null), 0), 3) as sales_bias,
       round(sum(scm_ol - act)        filter (where sales_ol is not null and scm_ol is not null and act is not null)
           / nullif(sum(act)         filter (where sales_ol is not null and scm_ol is not null and act is not null), 0), 3) as scm_bias
from raw.fact_mc_plan_actual
group by fy_sheet;


-- ============================================================
-- ④ v_bom_requirement — 기계 1대를 팔려면 무엇이 몇 개 필요한가
--
--   회의록 원문:
--     "CAP 을 하나 구성하기 위해 Neutral 하고 SCC 하고 필수 투입 옵션
--      요렇게가 다 돼야 된다. 이게 하나의 BOM 이다."
--     "주문은 CAP 으로 들어오지만 실제 나가는 건 그 아래 아이템들이다."
--
--   네 갈래를 하나로 모읍니다.
--     CAP         판매 구성 단위 (주문이 들어오는 코드)
--     NEUTRAL     수입하는 기본 사양 본체
--     MUST_OPTION 필수 투입 옵션        ← 기계와 1:1 로 관리되어야 함
--     SCC/LABEL   사양 교체품 · 라벨
--     BOM:*       기종 BOM 구성 (STANDARD · FAX KIT · 단품Option …)
--
--   ★ active = 'X' 인 BOM 행은 비활성이므로 제외합니다.
--   ★ common_flag 가 COMMON 인 품목은 복수 기종 공용입니다.
--     기종별로 나눠 세면 이중 계상되므로 반드시 함께 보여줍니다.
-- ============================================================
create or replace view analytics.v_bom_requirement as
with cap as (
    select model_base, model_key, cap_item_code, cap_item_name, neutral_item_code
    from raw.bridge_mc_cap
    where model_base is not null and btrim(model_base) <> ''
)
-- ① CAP 부번
select c.model_base, c.model_key, 'CAP'::text as part_role,
       c.cap_item_code as item_code,
       coalesce(nullif(btrim(c.cap_item_name), ''), i.description) as description,
       1::numeric as qty, null::text as bom_group
from cap c left join core.v_item i on i.item_code = c.cap_item_code

union all
-- ② Neutral 본체
select c.model_base, c.model_key, 'NEUTRAL',
       c.neutral_item_code, i.description, 1::numeric, null
from cap c left join core.v_item i on i.item_code = c.neutral_item_code
where c.neutral_item_code is not null and btrim(c.neutral_item_code) <> ''

union all
-- ③ CAP 에 딸리는 필수 옵션 / SCC·Label
select c.model_base, c.model_key, o.role,
       o.option_item_code,
       coalesce(nullif(btrim(o.option_desc), ''), i.description),
       1::numeric, null
from raw.bridge_cap_option o
join cap c on c.cap_item_code = o.cap_item_code
left join core.v_item i on i.item_code = o.option_item_code

union all
-- ④ 기종 BOM 구성
select b.model_base, b.model_key, 'BOM',
       b.item_code, i.description,
       coalesce(b.qty, 1), b.bom_group
from raw.bridge_bom b
left join core.v_item i on i.item_code = b.item_code
where b.model_base is not null and btrim(b.model_base) <> ''
  and coalesce(btrim(b.active), '') <> 'X';

comment on view analytics.v_bom_requirement is
  '기종 1대 판매 시 필요한 CAP · Neutral · 필수옵션 · SCC · BOM 구성 통합';


-- 공용 여부를 붙인 조회용 뷰 (Tool 은 이쪽을 읽습니다)
create or replace view analytics.v_bom_requirement_x as
select r.*,
       oc.n_models,
       oc.common_flag,
       case when oc.common_flag = 'COMMON'
            then '복수 기종 공용 — 기종별 합산 시 이중 계상 주의' end as common_note
from analytics.v_bom_requirement r
left join core.v_option_commonality oc on oc.item_code = r.item_code;


-- ============================================================
-- ⑤ v_part_linkage — XCN 대표코드 조회 (선택 Tool)
--    "이 부품, 발주는 어느 코드로 하나요?"
-- ============================================================
create or replace view analytics.v_part_linkage as
select x.related_item,
       xi.description as related_desc,
       x.hoc_item,
       hi.description as hoc_desc,
       hi.family
from core.v_part_linkage x
left join core.v_item xi on xi.item_code = x.related_item
left join core.v_item hi on hi.item_code = x.hoc_item;


-- ============================================================
-- ⑥ v_realdata_kpi — 적재 상태 한 줄 요약 (화면 상단 카드용)
-- ============================================================
create or replace view analytics.v_realdata_kpi as
select (select count(*) from raw.dim_item)                                   as n_items,
       (select count(*) from core.v_model)                                   as n_models,
       (select count(*) from raw.fact_shipment)                              as n_shipment_rows,
       (select max(ym)  from raw.fact_shipment)                              as data_as_of,
       (select min(ym)  from raw.fact_shipment)                              as data_from,
       (select count(*) from analytics.v_item_demand_profile
         where demand_type in ('INTERMITTENT','LUMPY'))                      as n_croston_candidate,
       (select count(*) from analytics.v_item_demand_profile
         where reason_code = 'INSUFFICIENT_HISTORY')                         as n_insufficient,
       (select count(*) from raw.bridge_xcn)                                 as n_xcn_links;


-- ============================================================
-- 확인 쿼리 — 강의 자료의 숫자와 맞는지 대조하세요
-- ============================================================

-- ① 러닝 예시 부품
select item_code, description, n_months, latest_qty, avg_3m, avg_6m, avg_12m, trend_3m_vs_12m
from analytics.v_shipment_trend
where item_code = '602K02693';
-- 기대: n_months 40 · latest_qty 1049 · avg_3m 779.0 · avg_6m 785.2 · avg_12m 772.3

-- ② 수요 유형 분포
select * from analytics.v_item_demand_kpi;

-- ③ OL 정확도 (강의 표와 같아야 합니다)
select fy_sheet, n_scored, sales_wape, scm_wape, sales_bias, scm_bias
from analytics.v_ol_accuracy_fy order by fy_sheet;
-- 기대: FY23 0.417 / 0.519 / -0.015 / 0.328
--       FY24 0.596 / 0.512 / -0.007 / 0.309
--       FY25 0.664 / 0.589 /  0.057 / 0.367
--       FY26 0.701 / 0.657 /  0.082 / 0.464

-- ④ BOM 전개
select part_role, count(*) from analytics.v_bom_requirement
where model_base = 'MDL222' group by 1 order by 2 desc;

-- ⑤ 적재 상태
select * from analytics.v_realdata_kpi;
