-- ──────────────────────────────────────────────────────────────
-- sql/36 — 더미 시절 파생 결과 비우기 (실데이터 전환 마지막 단계 · spec §8-②)
--
-- ★ 한 번만, 전환이 검증된 뒤에 돌립니다.
--   sql/34 가 더미 raw 를 지운 뒤에도 예전 예측 실행 · 백테스트 · Champion · 승인 · 알림 ·
--   시뮬레이션 · 업로드 배치 행은 그대로 남아 ITEM001~020 을 가리킵니다. 실데이터 실행을 한 번
--   돌린 뒤(검증 → 백테스트 → 운영) 이 파일로 예전 것을 비웁니다.
--
-- ★ 남기는 것 — 사용자 · 정책값 · 모델 설정 · 모델 버전 · API 키 · 에이전트 대화 · realdata_load.
-- ★ 되돌릴 수 없습니다. 아래 확인 쿼리 ①을 먼저 실행해 무엇이 지워지는지 보고 결정하세요.
-- ──────────────────────────────────────────────────────────────

-- ① 지워질 것 — 더미 품목(ITEM0…)을 가리키는 행수. 실데이터 실행만 남았다면 여기 숫자가 0 이어야 정상입니다.
select 'forecast_run(더미 시절)' as what, count(*) from core.forecast_run r
  where not exists (select 1 from core.forecast_result f join core.v_item_master im on im.item_id = f.item_id where f.run_id = r.run_id)
union all select 'forecast_result ITEM0%', count(*) from core.forecast_result where item_id like 'ITEM0%'
union all select 'champion_model ITEM0%',  count(*) from core.champion_model  where item_id like 'ITEM0%'
union all select 'approval ITEM0%',        count(*) from core.approval        where item_id like 'ITEM0%'
union all select 'alert ITEM0%',           count(*) from core.alert           where item_id like 'ITEM0%'
union all select 'forecast_override ITEM0%', count(*) from core.forecast_override where item_id like 'ITEM0%'
union all select 'upload_batch',           count(*) from core.upload_batch;

-- ② 비우기 — 더미 품목을 가리키는 행과 더미 시절 실행만 지웁니다. 실데이터 행은 남습니다.
--    (주석을 풀고 실행하세요. 전체 트랜잭션이라 중간에 실패하면 아무것도 지워지지 않습니다.)
--
-- begin;
-- delete from core.forecast_override where item_id like 'ITEM0%';
-- delete from core.approval          where item_id like 'ITEM0%';
-- delete from core.alert             where item_id like 'ITEM0%';
-- delete from core.champion_model    where item_id like 'ITEM0%';
-- delete from core.model_performance where item_id like 'ITEM0%';
-- delete from core.forecast_result   where item_id like 'ITEM0%';
-- -- 결과가 하나도 남지 않은 실행(더미 시절 실행)은 통째로 — cascade 로 backtest · simulation 도 따라갑니다
-- delete from core.forecast_run r
--   where not exists (select 1 from core.forecast_result f where f.run_id = r.run_id);
-- delete from core.backtest_run b
--   where not exists (select 1 from core.model_performance p where p.backtest_run_id = b.backtest_run_id);
-- delete from core.simulation_run s
--   where not exists (select 1 from core.forecast_run r where r.run_id = s.forecast_run_id);
-- delete from core.what_if_log where item_id like 'ITEM0%';
-- delete from core.import_staging where batch_id in (select batch_id from core.upload_batch);
-- delete from core.upload_batch;
-- select core.refresh_forecast_current() as forecast_current_rows, core.build_dependent_demand() as dependent_demand_rows;
-- commit;

-- ③ 확인 — ① 을 다시 실행해 전부 0 인지 봅니다.
