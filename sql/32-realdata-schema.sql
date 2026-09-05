-- ──────────────────────────────────────────────────────────────
-- sql/32 — 실데이터 raw 스키마 (6회차 `03. DB적재_SQL/01-schema.sql` 의 저장소 사본)
--
-- ★ 원본과 다른 점: drop 이 없습니다. 이미 적재된 데이터를 지우지 않도록
--   create table if not exists 로 바꿨습니다. 처음 까는 DB 에서는 빈 테이블을 만들고,
--   데이터는 6회차 02-data-*.sql 로 넣습니다 (하네스는 REALDATA_SQL_DIR 에서 읽습니다).
--   운영 DB 처럼 이미 있는 곳에서는 아무것도 바꾸지 않습니다.
-- ★ 원본이 지우던 외부 뷰(v_realdata_kpi · v_shipment_trend …)는 sql/33 이 다시 만듭니다.
-- ──────────────────────────────────────────────────────────────

-- ============================================================
-- 01. raw 스키마 — 실데이터 원본 적재용 테이블
--
--   실행 위치 : Supabase → SQL Editor → 파일 전체를 붙여넣고 실행
--   선행 조건 : 5회차 STEP 2 (sql/03-auth.sql · 04-rls.sql) 적용 완료
--
--   원칙 ①  raw 는 CSV 원본 그대로입니다. 적재 후 수정하지 않습니다.
--   원칙 ②  화면과 Tool 은 raw 를 직접 조회하지 않습니다. analytics 뷰만 읽습니다.
--   원칙 ③  컬럼 순서 = CSV 컬럼 순서입니다.
--           \copy 는 이름이 아니라 "위치"로 매핑하므로 순서를 바꾸면 값이 밀립니다.
--
--   벤더가 준 schema.sql 은 SQLite 기준입니다. 이 파일은 그것을
--   PostgreSQL(Supabase) + 스키마 계층 + RLS 규칙에 맞게 옮긴 것입니다.
-- ============================================================

create schema if not exists raw;
create schema if not exists core;
create schema if not exists analytics;

-- ------------------------------------------------------------
-- 기존 객체 정리 (재실행 가능하게)
-- ------------------------------------------------------------
-- ★ 5회차 뷰(v_sku_demand_profile · v_demand_profile_kpi · v_stockout_risk 등)는
--   여기서 지우지 않습니다. 기존 화면이 아직 읽고 있습니다.


-- ------------------------------------------------------------
-- 마스터 (dim)
-- ------------------------------------------------------------

-- 품목·부품·옵션 통합 마스터 · 93,868행
create table if not exists raw.dim_item (
    item_code     text primary key,   -- 품목 코드 (익명화)
    hoc_code      text,               -- 최종 발주 코드 (XCN 대표코드)
    description   text,
    family        text,               -- 적용 제품군
    item_type     text,               -- PART / SUPPLY / OPTION / BOM / MACHINE
    source_types  text                -- 여러 파일에 등장 시 '|' 구분
);
comment on table raw.dim_item is '품목 통합 마스터. 실데이터 원본. 수정 금지';

-- 기종 통합 마스터 · 145행
create table if not exists raw.dim_model (
    model_key     text primary key,   -- 파일 표기 그대로 'MDL193-3(2697-3697)'
    model_base    text,               -- 'MDL193' — 파일 간 조인은 반드시 이걸로
    biz           text,               -- DT / GC / PRT
    iot_code      text,               -- 기계 본체 코드
    sources       text
);
comment on column raw.dim_model.model_base is
  'NULL/빈값인 8행은 기종이 아니라 Option MAP 헤더에서 온 그룹 키(DT Common · Newline Q+ 02" 등). 조회 시 반드시 제외';

-- ------------------------------------------------------------
-- 사실 (fact) — 수치는 원본값. 오프셋 없음
-- ------------------------------------------------------------

-- 부품·소모품·옵션 월별 출고 실적 · 103,795행 (와이드 → 롱 변환 결과)
-- ★ 수량 0인 달은 저장하지 않습니다(희소 저장). 0이 필요하면 달력과 LEFT JOIN.
create table if not exists raw.fact_shipment (
    item_code   text          not null,
    ym          char(7)       not null,   -- 'YYYY-MM'
    qty         numeric(18,4) not null,
    item_type   text          not null,   -- PART / SUPPLY / OPTION
    source_file text          not null
);
comment on table raw.fact_shipment is
  '월별 출고 실적. 수량 0인 달은 미저장. PART 2023-04~2026-07 / OPTION 2020-01~2026-07';

-- 기계 월별 OL(계획) 대비 실적 · 2,765행
create table if not exists raw.fact_mc_plan_actual (
    fy_sheet   text,                      -- FY23 / FY24 / FY25 / FY26-to202606
    model_key  text          not null,
    model_base text,
    biz        text,
    iot_code   text,
    ym         char(7)       not null,
    sales_ol   numeric(18,4),             -- 영업 OL
    scm_ol     numeric(18,4),             -- SCM 조정 OL
    act        numeric(18,4)              -- 실적
);
comment on table raw.fact_mc_plan_actual is
  '기계 OL vs 실적. Bias = SUM(ol-act)/SUM(act), 양수가 과대예측';

-- ------------------------------------------------------------
-- 브릿지 (다대다 관계)
-- ------------------------------------------------------------

-- 기종 → 구성 품목 · 7,157행 (TOTAL_BOM 15시트 + GC-BOM 13시트 통합)
create table if not exists raw.bridge_bom (
    model_key   text,
    model_base  text,
    bom_group   text,                     -- STANDARD / FAX KIT / 단품Option / 소모품 KIT …
    item_code   text,
    qty         numeric(18,4),
    active      text,                     -- O / X / △ / 빈값 (GC-BOM만 채워짐)
    start_date  text,                     -- 원본에 문자열·날짜형이 섞여 있어 text 로 통일
    end_date    text,
    source_file text
);

-- Neutral 품목 → SCC 교체 구성품 · 88행
-- ★ GC-BOM 'SCC' 시트만 컬럼 구조가 달라(6열) 별도 테이블로 분리한 것입니다.
create table if not exists raw.bridge_scc_config (
    model_key         text,
    model_base        text,
    neutral_item_code text,               -- 기준이 되는 중립 사양 본체
    neutral_desc      text,
    scc_item_code     text,               -- 교체 투입되는 구성품
    scc_desc          text,
    qty               numeric(18,4)
);

-- 기종 → CAP 부번(판매 구성 단위) · 106행
create table if not exists raw.bridge_mc_cap (
    model_key         text,
    model_base        text,
    predecessor_model text,               -- 전임기
    cap_item_code     text,
    cap_item_name     text,
    neutral_item_code text,
    remark            text
);

-- CAP 부번 → 필수 투입 옵션 / SCC·Label · 646행
create table if not exists raw.bridge_cap_option (
    model_key        text,
    cap_item_code    text,
    option_item_code text,
    option_desc      text,
    role             text                 -- MUST_OPTION(340) / SCC/LABEL(306)
);

-- 옵션 → 장착 가능 기종 · 972행
create table if not exists raw.bridge_option_model (
    item_code  text,
    model_key  text,
    model_base text,
    link_type  text,                      -- 셀 원문 (예: 'MDL142(BOM)')
    cat        text,
    common     text,                      -- COMMON(597) / UNIQUE(375)
    detail     text
);

-- 부품 XCN 연계 · 20,760행 (설계변경으로 코드가 바뀐 부품들의 연결)
-- ★ 출고 Trend 는 hoc_item 으로 합산해서 봐야 하고, 발주는 hoc_item 으로 합니다.
create table if not exists raw.bridge_xcn (
    family       text,
    related_item text,                    -- 구/연계 코드 (출고 이력이 흩어져 있음)
    related_desc text,
    hoc_item     text,                    -- 최종 발주 코드
    hoc_desc     text
);

-- ------------------------------------------------------------
-- 인덱스
-- ------------------------------------------------------------
create index if not exists ix_ship_item      on raw.fact_shipment (item_code);
create index if not exists ix_ship_ym        on raw.fact_shipment (ym);
create index if not exists ix_ship_type_ym   on raw.fact_shipment (item_type, ym);
create index if not exists ix_mc_model       on raw.fact_mc_plan_actual (model_base, ym);
create index if not exists ix_mc_fy          on raw.fact_mc_plan_actual (fy_sheet);
create index if not exists ix_bom_model      on raw.bridge_bom (model_base);
create index if not exists ix_bom_item       on raw.bridge_bom (item_code);
create index if not exists ix_scc_neutral    on raw.bridge_scc_config (neutral_item_code);
create index if not exists ix_scc_model      on raw.bridge_scc_config (model_base);
create index if not exists ix_cap_model      on raw.bridge_mc_cap (model_base);
create index if not exists ix_capopt_cap     on raw.bridge_cap_option (cap_item_code);
create index if not exists ix_optmodel       on raw.bridge_option_model (item_code, model_base);
create index if not exists ix_xcn_rel        on raw.bridge_xcn (related_item);
create index if not exists ix_xcn_hoc        on raw.bridge_xcn (hoc_item);
create index if not exists ix_item_type      on raw.dim_item (item_type);
create index if not exists ix_item_hoc       on raw.dim_item (hoc_code);

-- ------------------------------------------------------------
-- RLS — raw 는 앱에서 직접 못 읽습니다 (fail-closed)
--
--   정책을 하나도 만들지 않고 RLS 만 켭니다. 그러면 authenticated 는 0행을 봅니다.
--   analytics 뷰는 뷰 소유자(postgres) 권한으로 실행되므로 정상 동작합니다
--   (PostgreSQL 15 기준 view 의 security_invoker 기본값은 false).
-- ------------------------------------------------------------
alter table raw.dim_item            enable row level security;
alter table raw.dim_model           enable row level security;
alter table raw.fact_shipment       enable row level security;
alter table raw.fact_mc_plan_actual enable row level security;
alter table raw.bridge_bom          enable row level security;
alter table raw.bridge_scc_config   enable row level security;
alter table raw.bridge_mc_cap       enable row level security;
alter table raw.bridge_cap_option   enable row level security;
alter table raw.bridge_option_model enable row level security;
alter table raw.bridge_xcn          enable row level security;

-- ------------------------------------------------------------
-- 확인
-- ------------------------------------------------------------
select table_name,
       (select count(*) from information_schema.columns c
         where c.table_schema = 'raw' and c.table_name = t.table_name) as n_cols
from information_schema.tables t
where table_schema = 'raw'
order by table_name;
-- 기대: 10개 테이블
