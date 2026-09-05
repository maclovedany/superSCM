-- ──────────────────────────────────────────────────────────────
-- 성능 — 조인·필터 키 인덱스
--
-- ★ 먼저 알아 두실 것: **이 파일은 대시보드 타임아웃의 원인이 아니었습니다.**
--   원인은 계획기가 뷰를 품목 수만큼 다시 계산한 것이었고, 그 해결은
--   sql/16 의 `materialized` CTE 울타리입니다 (error.md #30).
--   여기 인덱스는 품목 20개 · 출하 2,713행 기준으로 **측정 가능한 효과가 없었습니다.**
--
--     v_dashboard_kpi               인덱스 전 0.15초 → 후 0.15초
--     v_dashboard_purchase_priority          0.40초 →    0.40초
--     v_purchase_recommendation              0.10초 →    0.11초
--
--   표가 작으면 통째로 훑는 편이 인덱스를 타는 것보다 빠릅니다. 계획기의 판단이 맞습니다.
--
-- 그럼 왜 남겨 두는가
--   실데이터가 들어오면 사정이 달라집니다. 지금 `raw` 표에는 batch_id 인덱스
--   (되돌리기용, sql/06) 뿐이고, 화면이 조인·필터에 쓰는 컬럼에는 하나도 없습니다.
--   3년치를 적재하면 usage_history 와 forecast_result 가 수십 배로 늘고, 그때는
--   전체 스캔 비용이 그대로 곱해집니다. 미리 깔아 두는 보험입니다.
--
--   실측으로 확인된 사용 예: 계획기가 shipment_log_supplier_idx 를
--   Bitmap Index Scan 으로 실제로 골랐습니다 (전체 스캔 대신).
--
-- 이 파일의 성격
--   전부 `create index if not exists` 입니다. 순서에 무관하고, 여러 번 실행해도
--   안전하며, 뒤 파일에 영향을 주지 않습니다(뷰를 만들지도 지우지도 않습니다).
--   `sql/28-anon-lockdown.sql` 뒤에 실행해도 됩니다 — 권한을 건드리지 않습니다.
--   **선택 사항입니다.** 지금 안 돌려도 화면은 정상 동작합니다.
--
-- 앞선 파일이 전부 적용된 뒤에 실행하세요.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. raw.usage_history ═══════════════════════════════════════
--
-- core.v_train_demand · v_test_actual · v_usage_monthly · v_usage_effective 가
-- 전부 item_id 로 묶고 use_date 로 자릅니다.


-- 정규화한 품목코드로 조인하는 경로(core.v_usage_effective)를 위한 식 인덱스.
-- 식이 뷰의 것과 **글자까지 같아야** 계획기가 씁니다.

-- ══ 2. raw.shipment_log ════════════════════════════════════════
--
-- core.v_fact_shipment 이 status 로 거르고(IN_TRANSIT · COMPLETED),
-- 품목·공급처로 묶습니다. 가장 많이 훑히는 표입니다.





-- ══ 3. 마스터 · 재고 ═══════════════════════════════════════════
--
-- 한글 컬럼입니다. core.v_item_master · v_stock_on_hand 가 정규화해서 씁니다.




-- ══ 4. 발주 · 입고 ═════════════════════════════════════════════
--
-- STEP 11 의 가상 운영이 발주번호로 잇습니다 (core.v_purchase_order · v_goods_receipt).



-- ══ 5. core — 예측 결과 ════════════════════════════════════════
--
-- 기본키가 (run_id, model_id, item_id, period) 라 run_id 로 시작하는 조회는 이미
-- 덮입니다. 모자란 것은 "한 run 의 한 품목" 을 곧바로 찾는 경로입니다 —
-- core.v_ai_forecast 와 v_consensus_forecast 가 그렇게 읽습니다.

create index if not exists forecast_result_run_item_idx
  on core.forecast_result (run_id, item_id, period);

-- 성공한 실행 중 가장 최근을 고르는 조회(core.v_ai_forecast · analytics 뷰들).
create index if not exists forecast_run_status_started_idx
  on core.forecast_run (status, started_at desc);

-- ══ 6. 확인 ════════════════════════════════════════════════════

select schemaname, tablename, indexname
  from pg_indexes
 where (schemaname = 'raw')
    or (schemaname = 'core' and indexname in
          ('forecast_result_run_item_idx', 'forecast_run_status_started_idx'))
 order by schemaname, tablename, indexname;

-- 인덱스는 통계가 있어야 쓰입니다. 대량 적재 뒤에는 한 번 돌려주세요.
analyze;
