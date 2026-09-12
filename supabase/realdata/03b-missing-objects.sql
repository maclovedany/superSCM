-- 배포 DB 에만 있던 객체의 정의 (Phase 0 · 2026-09-11)
--
-- 4~5회차 수업에서 SQL Editor 로 직접 만들어 저장소에 없던 것들입니다.
-- supabase/schema-dump/2026-09-11.sql 에서 그대로 뽑았습니다 — 손으로 고치지 않았습니다.
--
-- ★ 실행 순서 — 이 파일은 supabase/realdata/01-schema.sql 뒤, 04-core-views.sql 앞에 옵니다.
--   raw 테이블 8개가 먼저 있어야 core 뷰가 만들어집니다.
--
-- ★ core.v_item_master 가 여기 있습니다. supabase/migrations 의 STEP 5·6 이 이 뷰에
--   의존하는데 정의가 저장소 어디에도 없었습니다. 이것 없이 새 환경에서 STEP 5 를 돌리면
--   relation "core.v_item_master" does not exist 로 죽습니다.
--
-- ★ raw.inventory 의 컬럼은 전부 text 이고 한국어입니다 (품목코드 · 창고 · 현재고 ·
--   기준일자 · 안전재고). 5회차 더미 데이터의 모양이며 재고 "상태" 컬럼이 없습니다.
--   stage1 §6 이 요구하는 검사대기 · 불량 · 서비스센터 · 파트너 · 이동중 구분을
--   이 구조로는 할 수 없습니다. refactor.md Phase 4 는 새 구조가 필요합니다.
--
-- ★ core.v_inbound_qty 는 IN_TRANSIT 선적을 더합니다. stage1 §6 은 창고 입고 완료분만
--   반영하라고 합니다. 이 뷰를 발주 계산에 그대로 쓰면 규칙과 어긋납니다 (gap.md 6.3).

-- ── raw.usage_history ─────────────────────────
CREATE TABLE raw.usage_history (
    usage_id text,
    item_id text,
    use_date date,
    qty numeric,
    warehouse text,
    note text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);

-- ── raw.item_master ─────────────────────────
CREATE TABLE raw.item_master (
    "품목코드" text,
    "품목명" text,
    "품목구분" text,
    "단위" text,
    "표준단가" text,
    "사용여부" text,
    supplier_id text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);

-- ── core.v_item_master ─────────────────────────
CREATE VIEW core.v_item_master AS
 SELECT DISTINCT ON (item_id) item_id,
    item_name,
    item_type,
    supplier_id,
    unit,
    is_active
   FROM ( SELECT upper(regexp_replace(item_master."품목코드", '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
            item_master."품목명" AS item_name,
            item_master."품목구분" AS item_type,
            item_master.supplier_id,
            item_master."단위" AS unit,
            item_master."사용여부" AS is_active,
                CASE
                    WHEN (item_master."품목코드" = upper(regexp_replace(item_master."품목코드", '[\s\-_]'::text, ''::text, 'g'::text))) THEN 0
                    ELSE 1
                END AS pref
           FROM raw.item_master) t
  ORDER BY item_id, pref;

-- ── raw.shipment_log ─────────────────────────
CREATE TABLE raw.shipment_log (
    shipment_id text,
    po_no text,
    item_id text,
    supplier_id text,
    country text,
    transport_mode text,
    order_date date,
    due_date date,
    supplier_ship_date date,
    port_departure_date date,
    port_arrival_date date,
    customs_clear_date date,
    warehouse_receipt_date date,
    qc_release_date date,
    qty numeric,
    warehouse text,
    status text,
    incident_note text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);

-- ── core.v_fact_shipment ─────────────────────────
-- ★ 2026-09-12 보정(Task 16, supabase/migrations/20260912000800_fix_open_po_qty_cast.sql) —
--   이 뷰(그리고 아래 core.v_inbound_qty)는 이 파일이 정본이다. 적용 순서(realdata →
--   migrations)상 그 마이그레이션의 create or replace가 나중에 이겨 배포 DB는 항상 게이트가
--   걸린 최종 정의를 쓰지만, 이 파일을 단독으로 재실행하는 것이 문서화된 복구 절차이므로
--   이 파일 자체의 정의도 같은 게이트를 가져야 한다 — 그러지 않으면 단독 재실행 때 게이트가
--   조용히 사라져 출처 없는 raw.shipment_log(2,864행 전부 batch_id null, IN_TRANSIT 117행·
--   수량 합 12,137)가 다시 실적처럼 보인다. **이 뷰를 고칠 때는 반드시 그 마이그레이션의
--   같은 정의도 함께 고친다.** batch_id 추가는 열 구성 확대가 아니라(그 마이그레이션이
--   이 뷰를 create or replace로 재정의하기 전까지 저장소 마이그레이션에 이 뷰가 아예 없었다)
--   출처 게이트를 위한 것이다.
CREATE OR REPLACE VIEW core.v_fact_shipment AS
 SELECT shipment_id,
    upper(regexp_replace(COALESCE(po_no, ''::text), '[\s\-_]'::text, ''::text, 'g'::text)) AS po_no,
    upper(regexp_replace(COALESCE(item_id, ''::text), '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
    supplier_id,
    country,
        CASE upper(TRIM(BOTH FROM transport_mode))
            WHEN '해상'::text THEN 'SEA'::text
            WHEN '항공'::text THEN 'AIR'::text
            ELSE upper(TRIM(BOTH FROM transport_mode))
        END AS transport_mode,
    order_date,
    due_date,
    supplier_ship_date,
    port_departure_date,
    port_arrival_date,
    customs_clear_date,
    warehouse_receipt_date,
    qc_release_date,
    qty,
    status,
    NULLIF(TRIM(BOTH FROM COALESCE(incident_note, ''::text)), ''::text) AS incident_note,
    (supplier_ship_date - order_date) AS seg_order_to_ship,
    (qc_release_date - supplier_ship_date) AS seg_ship_to_receive,
    (qc_release_date - order_date) AS lt_total,
        CASE
            WHEN (status = 'IN_TRANSIT'::text) THEN 'IN_TRANSIT'::text
            WHEN ((order_date IS NULL) OR (qc_release_date IS NULL)) THEN 'MISSING_DATE'::text
            WHEN (qc_release_date < warehouse_receipt_date) THEN 'IMPOSSIBLE_ORDER'::text
            WHEN (warehouse_receipt_date < order_date) THEN 'IMPOSSIBLE_ORDER'::text
            ELSE 'OK'::text
        END AS quality_flag,
    batch_id
   FROM raw.shipment_log s;

-- ── core.v_shipment_valid ─────────────────────────
CREATE VIEW core.v_shipment_valid AS
 SELECT shipment_id,
    po_no,
    item_id,
    supplier_id,
    country,
    transport_mode,
    order_date,
    due_date,
    supplier_ship_date,
    port_departure_date,
    port_arrival_date,
    customs_clear_date,
    warehouse_receipt_date,
    qc_release_date,
    qty,
    status,
    incident_note,
    seg_order_to_ship,
    seg_ship_to_receive,
    lt_total,
    quality_flag
   FROM core.v_fact_shipment
  WHERE ((status = 'COMPLETED'::text) AND (quality_flag = 'OK'::text) AND (lt_total > 0));

-- ── raw.supplier_master ─────────────────────────
CREATE TABLE raw.supplier_master (
    "공급업체코드" text,
    "공급업체명" text,
    "국가" text,
    "표준리드타임(일)" text,
    "담당자" text,
    "사용여부" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);

-- ── core.v_leadtime_stat ─────────────────────────
CREATE VIEW core.v_leadtime_stat AS
 SELECT v.supplier_id,
    s."공급업체명" AS supplier_name,
    v.country,
    count(*) AS n_samples,
    round(avg(v.seg_order_to_ship), 1) AS avg_order_to_ship,
    round(avg(v.seg_ship_to_receive), 1) AS avg_ship_to_receive,
    round(avg(v.lt_total), 1) AS mean_days,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.lt_total)::double precision)))::integer AS p50_days,
    (percentile_cont((0.8)::double precision) WITHIN GROUP (ORDER BY ((v.lt_total)::double precision)))::integer AS p80_days,
    (percentile_cont((0.9)::double precision) WITHIN GROUP (ORDER BY ((v.lt_total)::double precision)))::integer AS p90_days,
    round(stddev_samp(v.lt_total), 1) AS std_days,
    max(v.lt_total) AS max_days,
        CASE
            WHEN (count(*) >= 30) THEN 'HIGH'::text
            WHEN (count(*) >= 10) THEN 'MEDIUM'::text
            ELSE 'LOW'::text
        END AS confidence
   FROM (core.v_shipment_valid v
     JOIN raw.supplier_master s ON ((s."공급업체코드" = v.supplier_id)))
  GROUP BY v.supplier_id, s."공급업체명", v.country;

-- ── analytics.v_leadtime_gap ─────────────────────────
CREATE VIEW analytics.v_leadtime_gap AS
 SELECT m."공급업체코드" AS supplier_id,
    m."공급업체명" AS supplier_name,
    m."국가" AS country,
    (m."표준리드타임(일)")::integer AS std_lead_time,
    s.n_samples,
    s.avg_order_to_ship,
    s.avg_ship_to_receive,
    s.mean_days,
    s.p50_days,
    s.p80_days,
    s.p90_days,
    s.std_days,
    (s.p80_days - (m."표준리드타임(일)")::integer) AS gap_days,
    s.confidence
   FROM (raw.supplier_master m
     JOIN core.v_leadtime_stat s ON ((s.supplier_id = m."공급업체코드")))
  WHERE (m."사용여부" = 'Y'::text);

-- ── core.leadtime_plan ─────────────────────────
CREATE TABLE core.leadtime_plan (
    supplier_id text NOT NULL,
    planned_lead_time integer,
    basis text,
    service_level numeric,
    confirmed_reason text,
    confirmed_at timestamp with time zone DEFAULT now()
);

-- ── core.usage_profile ─────────────────────────
CREATE TABLE core.usage_profile (
    item_id text NOT NULL,
    valid_days integer,
    daily_usage_avg numeric,
    daily_usage_sd numeric,
    cv numeric,
    confirmed_at timestamp with time zone DEFAULT now()
);

-- ── core.v_leadtime_effective ─────────────────────────
CREATE VIEW core.v_leadtime_effective AS
 SELECT st.supplier_id,
    st.supplier_name,
    st.country,
    st.n_samples,
    st.p80_days,
    p.planned_lead_time,
    COALESCE(p.planned_lead_time, st.p80_days) AS effective_lead_time,
        CASE
            WHEN (p.planned_lead_time IS NOT NULL) THEN '확정값'::text
            ELSE '실적 P80'::text
        END AS source
   FROM (core.v_leadtime_stat st
     LEFT JOIN core.leadtime_plan p ON ((p.supplier_id = st.supplier_id)));

-- ── core.v_inbound_qty ─────────────────────────
-- ★ 2026-09-12 보정 — core.v_fact_shipment와 같은 이유로 이 정의도 출처 게이트를 갖는다.
--   supabase/migrations/20260912000800_fix_open_po_qty_cast.sql의 같은 뷰 정의를 함께 고친다.
--   raw.shipment_log.batch_id를 채우는 적재 경로가 아직 없어(commit_import_batch에 shipment
--   분기 없음) 지금은 이 뷰가 전 품목 null을 낸다 — 지어낸 12,137 EA를 보여주는 것보다 낫다.
CREATE OR REPLACE VIEW core.v_inbound_qty AS
 SELECT f.item_id,
    CASE WHEN bool_or(f.batch_id IS NULL) THEN NULL
         ELSE sum(f.qty) FILTER (WHERE f.batch_id IS NOT NULL)
    END AS inbound_qty,
    CASE WHEN bool_or(f.batch_id IS NULL) THEN NULL
         ELSE count(*) FILTER (WHERE f.batch_id IS NOT NULL)
    END AS inbound_shipments,
    CASE WHEN bool_or(f.batch_id IS NULL) THEN NULL
         ELSE min((f.order_date + COALESCE(( SELECT e.effective_lead_time
                FROM core.v_leadtime_effective e
               WHERE (e.supplier_id = f.supplier_id)), 30))) FILTER (WHERE f.batch_id IS NOT NULL)
    END AS earliest_eta
   FROM core.v_fact_shipment f
  WHERE (status = 'IN_TRANSIT'::text)
  GROUP BY f.item_id;

-- ── raw.inventory ─────────────────────────
CREATE TABLE raw.inventory (
    "품목코드" text,
    "창고" text,
    "현재고" text,
    "기준일자" text,
    "안전재고" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);

-- ── core.v_stock_on_hand ─────────────────────────
CREATE VIEW core.v_stock_on_hand AS
 SELECT upper(regexp_replace("품목코드", '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
    sum((NULLIF("현재고", ''::text))::numeric) AS current_stock
   FROM raw.inventory
  GROUP BY (upper(regexp_replace("품목코드", '[\s\-_]'::text, ''::text, 'g'::text)));

-- ── core.v_usage_effective ─────────────────────────
CREATE VIEW core.v_usage_effective AS
 WITH calc AS (
         SELECT upper(regexp_replace(usage_history.item_id, '[\s\-_]'::text, ''::text, 'g'::text)) AS item_id,
            count(*) AS valid_days,
            round(avg(usage_history.qty), 2) AS daily_usage_avg,
            round(stddev_samp(usage_history.qty), 2) AS daily_usage_sd
           FROM raw.usage_history
          WHERE ((usage_history.qty >= (0)::numeric) AND (COALESCE(usage_history.note, ''::text) !~~* '%프로젝트%'::text))
          GROUP BY (upper(regexp_replace(usage_history.item_id, '[\s\-_]'::text, ''::text, 'g'::text)))
        )
 SELECT c.item_id,
    COALESCE((p.valid_days)::bigint, c.valid_days) AS valid_days,
    COALESCE(p.daily_usage_avg, c.daily_usage_avg) AS daily_usage_avg,
    COALESCE(p.daily_usage_sd, c.daily_usage_sd) AS daily_usage_sd,
    round(COALESCE(p.daily_usage_avg, c.daily_usage_avg), 2) AS usage_used,
    round((COALESCE(p.daily_usage_sd, c.daily_usage_sd) / NULLIF(COALESCE(p.daily_usage_avg, c.daily_usage_avg), (0)::numeric)), 2) AS cv,
        CASE
            WHEN (p.item_id IS NOT NULL) THEN '확정값'::text
            ELSE '정제 기준'::text
        END AS source
   FROM (calc c
     LEFT JOIN core.usage_profile p ON ((p.item_id = c.item_id)));

-- ── analytics.v_stockout_risk ─────────────────────────
CREATE VIEW analytics.v_stockout_risk AS
 WITH base AS (
         SELECT i.item_id,
            i.item_name,
            i.supplier_id,
            COALESCE(st.current_stock, (0)::numeric) AS current_stock,
            COALESCE(ib.inbound_qty, (0)::numeric) AS inbound_qty,
            ue.daily_usage_avg,
            ue.cv,
            le.effective_lead_time
           FROM ((((core.v_item_master i
             LEFT JOIN core.v_stock_on_hand st ON ((st.item_id = i.item_id)))
             LEFT JOIN core.v_inbound_qty ib ON ((ib.item_id = i.item_id)))
             LEFT JOIN core.v_usage_effective ue ON ((ue.item_id = i.item_id)))
             LEFT JOIN core.v_leadtime_effective le ON ((le.supplier_id = i.supplier_id)))
          WHERE (i.is_active = 'Y'::text)
        )
 SELECT item_id,
    item_name,
    supplier_id,
    current_stock,
    inbound_qty,
    (current_stock + inbound_qty) AS available_qty,
    daily_usage_avg,
    cv,
    effective_lead_time AS planned_lead_time,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) > (0)::numeric) THEN round(((current_stock + inbound_qty) / daily_usage_avg), 1)
            ELSE NULL::numeric
        END AS stockout_days,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) > (0)::numeric) THEN (CURRENT_DATE + (floor(((current_stock + inbound_qty) / daily_usage_avg)))::integer)
            ELSE NULL::date
        END AS stockout_date,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) = (0)::numeric) THEN 'UNKNOWN'::text
            WHEN (effective_lead_time IS NULL) THEN 'UNKNOWN'::text
            WHEN (((current_stock + inbound_qty) / daily_usage_avg) <= (effective_lead_time)::numeric) THEN 'CRITICAL'::text
            ELSE 'SAFE'::text
        END AS risk_status,
        CASE
            WHEN (COALESCE(daily_usage_avg, (0)::numeric) = (0)::numeric) THEN 'NO_USAGE'::text
            WHEN (effective_lead_time IS NULL) THEN 'NO_LEADTIME'::text
            ELSE NULL::text
        END AS reason
   FROM base;

-- ── analytics.v_stockout_kpi ─────────────────────────
CREATE VIEW analytics.v_stockout_kpi AS
 SELECT count(*) AS n_items,
    count(*) FILTER (WHERE (risk_status = 'CRITICAL'::text)) AS n_critical,
    count(*) FILTER (WHERE (risk_status = 'SAFE'::text)) AS n_safe,
    count(*) FILTER (WHERE (risk_status = 'UNKNOWN'::text)) AS n_unknown,
    count(*) FILTER (WHERE (stockout_days <= (30)::numeric)) AS n_within_30d,
    round(avg(stockout_days), 1) AS avg_stockout_days
   FROM analytics.v_stockout_risk;

-- ── analytics.v_usage_anomaly ─────────────────────────
CREATE VIEW analytics.v_usage_anomaly AS
 WITH stat AS (
         SELECT usage_history.item_id,
            avg(usage_history.qty) AS avg_qty,
            stddev_samp(usage_history.qty) AS sd_qty
           FROM raw.usage_history
          GROUP BY usage_history.item_id
        )
 SELECT u.usage_id,
    u.item_id,
    u.use_date,
    u.qty,
    round(s.avg_qty, 1) AS avg_qty,
    round((u.qty / NULLIF(s.avg_qty, (0)::numeric)), 1) AS ratio,
    u.note,
        CASE
            WHEN (u.qty < (0)::numeric) THEN 'RETURN'::text
            WHEN (COALESCE(u.note, ''::text) ~~* '%프로젝트%'::text) THEN 'PROJECT'::text
            ELSE 'UNEXPLAINED'::text
        END AS anomaly_type
   FROM (raw.usage_history u
     JOIN stat s ON ((s.item_id = u.item_id)))
  WHERE ((u.qty > (s.avg_qty + ((3)::numeric * s.sd_qty))) OR (u.qty < (0)::numeric));

-- ── analytics.v_usage_profile ─────────────────────────
CREATE VIEW analytics.v_usage_profile AS
 SELECT u.item_id,
    i.item_name,
    i.item_type,
    i.supplier_id,
    u.valid_days,
    u.daily_usage_avg,
    u.daily_usage_sd,
    u.cv,
        CASE
            WHEN (u.cv >= 0.5) THEN '변동 큼'::text
            WHEN (u.cv >= 0.3) THEN '보통'::text
            ELSE '안정'::text
        END AS stability,
    u.source
   FROM (core.v_usage_effective u
     JOIN core.v_item_master i ON ((i.item_id = u.item_id)));

-- ── core.supplier_alias ─────────────────────────
CREATE TABLE core.supplier_alias (
    alias text NOT NULL,
    supplier_id text
);

-- ── raw.forecast ─────────────────────────
CREATE TABLE raw.forecast (
    "품목코드" text,
    "품목명" text,
    "2026-09" text,
    "2026-10" text,
    "2026-11" text,
    "2026-12" text,
    "2027-01" text,
    "2027-02" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);

-- ── raw.goods_receipt ─────────────────────────
CREATE TABLE raw.goods_receipt (
    "입고번호" text,
    "발주번호" text,
    "품목코드" text,
    "입고수량" text,
    "입고일" text,
    "입고창고" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);

-- ── raw.purchase_order ─────────────────────────
CREATE TABLE raw.purchase_order (
    "발주번호" text,
    "발주일" text,
    "공급업체" text,
    "품목코드" text,
    "발주수량" text,
    "단가" text,
    "납기예정일" text,
    "발주담당" text,
    batch_id uuid,
    source_type text,
    loaded_at timestamp with time zone DEFAULT now(),
    source_record_id text
);
