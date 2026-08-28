# STEP 3 데이터 모델 확장 및 학습·검증 격리 설계

## 목표

STEP 4 파일 업로드와 STEP 5·6 수요 분석 및 Forecast가 같은 원본 적재 계약을 사용하고, 학습과 검증 기간의 수요 데이터를 데이터베이스 레벨에서 분리한다.

## 결정

- `core.forecast_setting`은 활성 설정 1건만 허용한다. 기간이 비어 있거나 순서가 잘못되었거나 학습·검증 구간이 겹치면 두 격리 뷰는 0건을 반환한다.
- `raw`는 원본 보존 계층이다. 기존 raw 테이블에는 외래키가 없으므로 신규 raw 테이블도 유효하지 않은 원본 행을 적재 단계에서 차단하지 않는다.
- 정책·이상치 규칙·품목별 MOQ는 `core` 테이블에서 관리하며, `authenticated`는 읽기만 가능하고 변경은 `core.is_admin()`만 허용한다.
- 화면과 향후 AI는 `analytics.v_data_coverage` 및 core 격리 뷰를 사용한다. raw 테이블은 애플리케이션 역할에 공개하지 않는다.

## 데이터 객체

### Raw 원본 및 적재 계약

- `raw.business_event`: 프로젝트·캠페인·반품 같은 업무 이벤트 원본
- `raw.sales_order`: 주문 원본
- `raw.item_substitute`: 품목 대체 관계 원본
- 기존 raw 입력 테이블과 신규 raw 테이블: `batch_id`, `source_type`, `loaded_at`, `source_record_id`

기존 데이터 보존을 위해 추적 열은 모두 nullable이며 `loaded_at`만 `now()` 기본값을 가진다. 기존 행의 `batch_id`와 `source_record_id`는 null로 남는다.

### Core 정책 및 Forecast 설정

- `core.policy_config`: 키·값(JSONB)·설명·활성 여부로 service level, review period, safety buffer를 포함한 공통 운영 정책을 보관한다.
- `core.outlier_rule`: RETURN, PROJECT, DUPLICATE, CUSTOM 유형의 제외 규칙을 보관한다.
- `core.item_policy`: 정규화된 `item_id`별 MOQ, pack size, grade, service level을 보관한다.
- `core.forecast_setting`: singleton 활성 설정으로 train/test 기간과 DAY/WEEK/MONTH granularity를 보관한다.

### 격리 뷰

`core.v_train_demand`는 유효한 설정의 닫힌 학습 기간(`use_date >= train_start AND use_date <= train_end`)만 반환한다. `core.v_test_actual`은 같은 방식으로 검증 기간만 반환한다. 두 뷰는 모두 원본 수요값을 0으로 바꾸지 않으며, 기간·수량·품목 식별자에 null이 있으면 그대로 반환한다.

`analytics.v_data_coverage`는 원본 수요의 전체 기간, 활성 설정, train/test 행수, 기간 유효성, 격리 상태를 한 행으로 제공한다. 관리자 화면은 이 뷰와 core 정책 테이블을 사용한다.

## 데이터 흐름

```
raw.usage_history
  ├─ core.v_train_demand → Demand Profile / Forecast 모델 파라미터
  └─ core.v_test_actual  → Backtest scoring 전용 Actual
```

Forecast·Demand Profile·Backtest 학습 코드가 `raw.usage_history`를 직접 조회하는 것은 금지한다. SQL/TypeScript에 train/test 날짜를 작성하지 않으며, 미래 수요나 null→0 보정도 금지한다.

## 권한

- `anon`: `raw`, `core`, `analytics`에 대한 접근을 허용하지 않는다.
- 활성 `authenticated`: core 정책 및 analytics coverage를 읽을 수 있다.
- 활성 `ADMIN`: 정책·규칙·품목 정책·Forecast 기간 설정을 변경할 수 있다.
- raw 원본은 `authenticated`에 GRANT하지 않아 앱에서 직접 읽을 수 없다.

## 검증

- migration 정적 테스트로 raw 추적 열, 정책 테이블, 기간 설정, 두 격리 뷰, data coverage, RLS를 확인한다.
- 금지된 raw usage 직접 조회와 날짜 상수 패턴을 Forecast 관련 코드에서 검색한다.
- 수동 SQL 적용 후 SQL Editor에서 coverage와 뷰의 기간·행수를 확인한다.
