-- ──────────────────────────────────────────────────────────────
-- 실데이터 3년치 적재 — 전/후 처리
--
-- 화면(/admin/data/upload)으로 파일을 올리기 "전" 과 "후" 에 실행합니다.
-- 적재 자체는 화면에서 합니다. 이 파일은 준비와 마무리만 합니다.
--
-- ⚠ 3부는 데이터를 지웁니다. 내용을 읽고 의도적으로 주석을 푸세요.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 적재 전 — 지금 무엇이 들어 있는지 ═══════════════════════
--
-- raw 테이블의 컬럼명은 프로젝트마다 다릅니다.
-- 이름을 가정하지 말고 먼저 실제 컬럼을 확인합니다.

-- (1-1) raw 테이블의 실제 컬럼 목록 ★ 이 결과를 먼저 보세요
select table_name,
       string_agg(column_name, ', ' order by ordinal_position) as columns
  from information_schema.columns
 where table_schema = 'raw'
   and table_name in ('usage_history', 'item_master', 'supplier_master',
                      'inventory', 'purchase_order', 'goods_receipt')
 group by table_name
 order by table_name;

-- (1-2) 테이블별 행 수 (컬럼명을 몰라도 됩니다)
select 'usage_history'   as t, count(*) as rows from raw.usage_history
union all select 'item_master',     count(*) from raw.item_master
union all select 'supplier_master', count(*) from raw.supplier_master
union all select 'inventory',       count(*) from raw.inventory
union all select 'purchase_order',  count(*) from raw.purchase_order
union all select 'goods_receipt',   count(*) from raw.goods_receipt;

-- (1-3) 수요 실적의 기간과 품목 수
--       usage_history 는 item_id · use_date · qty 를 쓰는 것이 확인되었습니다
select min(use_date) as from_date,
       max(use_date) as to_date,
       count(*)      as rows,
       count(distinct item_id) as items
  from raw.usage_history;

-- (1-4) 배치별 현황. 'b_initial' 이 수업용 덤프입니다.
select coalesce(batch_id, '(없음)') as batch_id,
       coalesce(source_type, '(없음)') as source_type,
       count(*) as rows,
       min(use_date) as from_date, max(use_date) as to_date
  from raw.usage_history
 group by 1, 2
 order by 3 desc;

-- ══ 2. 적재 전 — 남아 있는 미완료 배치 정리 ════════════════════
--
-- PENDING 은 검증만 하고 적재를 누르지 않은 배치입니다.
-- 임시 보관을 차지하므로 치웁니다.

update core.upload_batch
   set status = 'CANCELLED', message = '실데이터 적재 전 정리'
 where status = 'PENDING';

delete from core.import_staging
 where batch_id in (select batch_id from core.upload_batch where status = 'CANCELLED');

-- ══ 3. ⚠ 수업용 샘플 데이터 삭제 ═══════════════════════════════
--
-- 실데이터와 샘플이 섞이면 예측·백테스트가 전부 오염됩니다.
-- 3년치를 새로 넣는다면 기존 것을 반드시 지워야 합니다.
--
-- 되돌릴 수 없습니다. 위 1번 결과를 확인한 뒤 주석을 푸세요.

-- delete from raw.usage_history where batch_id = 'b_initial' or batch_id is null;
-- delete from raw.item_master     where batch_id = 'b_initial' or batch_id is null;
-- delete from raw.supplier_master where batch_id = 'b_initial' or batch_id is null;

-- 예측·백테스트 결과도 함께 지웁니다. 옛 데이터로 만든 숫자이기 때문입니다.
-- delete from core.champion_model;
-- delete from core.backtest_run;      -- model_performance 는 cascade 로 지워집니다
-- delete from core.forecast_run;      -- forecast_result 도 cascade

-- ══ 4. 적재 후 — 학습/검증 경계를 PRD 값으로 ═══════════════════
--
-- renew.prd 12.1 — TRAIN 2023.01~2024.12 · TEST 2025.01~2025.12
--
-- 실제 적재된 범위를 먼저 확인하고, 그에 맞게 값을 넣으세요.
-- 아래는 PRD 기준값입니다.

-- update core.forecast_setting
--    set train_start = '2023-01-01',
--        train_end   = '2024-12-31',
--        test_start  = '2025-01-01',
--        test_end    = '2025-12-31',
--        updated_at  = now()
--  where id = 1;

-- 데이터에서 자동으로 잡으려면 이 쪽을 쓰세요.
-- 검증 = 마지막 12개월, 학습 = 그 이전 전부.
--
-- update core.forecast_setting s
--    set train_start = d.min_date,
--        train_end   = (date_trunc('month', d.max_date) - interval '12 months')::date - 1,
--        test_start  = (date_trunc('month', d.max_date) - interval '12 months')::date,
--        test_end    = d.max_date,
--        updated_at  = now()
--   from (select min(use_date) as min_date, max(use_date) as max_date
--           from raw.usage_history) d
--  where s.id = 1;

-- ══ 5. 적재 후 — 경계 확인 ═════════════════════════════════════
--
-- train_window_ok · test_window_ok 가 둘 다 true 여야 합니다.
-- data_months 가 24 이상이어야 계절성을 학습할 수 있습니다.

select * from analytics.v_data_coverage;

-- 격리 검증 — 학습 뷰에 검증 구간이 새어 들어가지 않았는지
select case when count(*) = 0 then '통과 — 학습 뷰에 검증 구간 데이터가 없습니다'
            else '실패 — ' || count(*) || '건이 새어 들어갔습니다' end as 격리_검증
  from core.v_train_demand t, core.forecast_setting s
 where s.id = 1 and t.period > s.train_end;

-- ══ 6. 적재 후 — 수요 패턴 재확인 ══════════════════════════════
--
-- 뷰라서 자동으로 다시 계산됩니다. 실행할 것은 없고 결과만 봅니다.
-- 간헐(INTERMITTENT)·덩어리(LUMPY) 가 나타나면 STEP 8 의 Croston 계열이 필요합니다.

select * from analytics.v_demand_profile_kpi;

-- ══ 7. 적재 후 — 다시 돌릴 것 ══════════════════════════════════
--
-- 화면에서 눌러도 되고 여기서 실행해도 됩니다.
--
--   /admin/forecast-runs  → 예측 실행
--   /model-evaluation     → 백테스트 실행

-- select * from core.run_baseline_forecast('실데이터 3년치 적재 후');
-- select * from core.run_backtest(null, '실데이터 3년치 적재 후');
