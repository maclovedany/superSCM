# STEP 4·5 Import Pipeline 및 SKU Demand Profile 설계

## STEP 4

파일은 서버 Route Handler에서 CSV(Papa Parse)와 Excel(xlsx)을 파싱한다. 파싱 원본은 `core.import_staging` JSONB 행으로 먼저 저장하고, 사용자가 컬럼 매핑을 확인해 validation을 끝내기 전에는 raw에 쓰지 않는다. `core.upload_batch`가 상태와 건수를, `core.validation_error`가 행 단위 오류를, `core.column_mapping`이 재사용 매핑을 보관한다.

커밋과 rollback은 SECURITY DEFINER SQL 함수로 한 트랜잭션에서 수행한다. append는 새 행을 넣고, upsert는 같은 `source_record_id`의 FILE_UPLOAD 행을 교체하며, replace는 대상 raw 테이블 전체를 snapshot backup 후 교체한다. rollback은 batch 행을 삭제하고 backup 행을 복원한다. replace와 upsert가 교체한 기존 행도 backup으로 복구한다.

## STEP 5

`analytics.v_sku_demand_profile`은 `core.v_train_demand`만 사용한다. 활성 Forecast 설정의 granularity로 기간 grid를 만들고, 원본 행이 없는 grid 기간만 수요 0으로 표시한다. 원본 수량 null은 null로 유지해 계산 불가 사유를 만든다.

ADI와 CV²는 양수 수요 기간으로 계산하며 Syntetos-Boylan-Croston 기준 코드값(SMOOTH, INTERMITTENT, ERRATIC, LUMPY)을 그대로 반환한다. seasonality는 24기간 미만이면 null/INSUFFICIENT_PERIODS이고, 그 이상이면 `policy_config.SEASONALITY_INDEX_CV_THRESHOLD`(DB 기본값 0.20)를 이용한다. 동률 peak period는 가장 이른 기간을 택한다.

## 보안 및 한계

모든 mutation은 `requireAdmin()`과 DB `core.is_admin()` 정책을 같이 통과해야 한다. raw는 브라우저에 공개하지 않는다. 현재 Forecast Run 테이블이 없으므로 Import는 `forecast_stale_marked` 이력을 남기며, `core.forecast_run`과 `data_snapshot_at`가 존재하는 환경에서만 조건부 stale 업데이트를 수행한다.
