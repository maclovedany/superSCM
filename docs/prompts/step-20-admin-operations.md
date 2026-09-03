# STEP 20 구현 지시서 — Admin 강화 · 운영 모니터링

> 먼저 `docs/prompts/_공통규칙.md`. 이 단계는 앞 단계들이 남긴 관리자 화면 빈자리를 채우고, 데이터 갱신 → 예측 stale 흐름을 완성합니다. 앞 보고서들(특히 `task-08` · `task-14` · `task-16` · `task-19`)의 "인터페이스" 와 "걱정되는 점" 을 읽으세요.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 20** 입니다. renew.prd 30.1 관리자 메뉴의 남은 항목과 31.5 데이터 품질.

## 만들 것

### 1. `sql/27-admin-ops.sql`

```
analytics.v_model_version        core.model_version + model_name + 그 버전을 쓴 run 수(core.forecast_run.models jsonb 에서) + 최근 사용 시각
analytics.v_forecast_run_detail  run 별 모델 × 품목 수 × 행 수 · 백테스트 여부(backtest_run) · 가상운영 여부(simulation_run) · stale
analytics.v_system_log           core.audit_log + core.api_log(요약) + core.agent_message(assistant 만, 요약) 을 UNION 한 통합 로그 · 최근 1000
                                 kind('AUDIT'|'API'|'AGENT') · at · actor · action · target · detail(jsonb 요약)
analytics.v_stale_summary        데이터가 바뀐 뒤 아직 재실행되지 않은 것: 최신 run 의 data_snapshot_at · 최신 loaded_at · stale 여부 · 영향 화면 목록(고정 문자열 배열)
core.notify_bulk_change()        트리거 함수 — core.upload_batch 가 IMPORTED 로 바뀔 때 imported_rows 가 policy_config BULK_CHANGE_ROWS(시드 1000) 이상이면
                                 core.alert 에 type 'BULK_DATA_CHANGE' (INFO) 를 fingerprint 'BULK_DATA_CHANGE:'||batch_id 로 insert (renew.prd 8.6 "대량 변경 시 관리자 통지" — 별도 통지 채널이 없으므로 Alert 로)
                                 + lib/alerts.ts 의 ALERT_TYPE_LABEL 에 'BULK_DATA_CHANGE' 추가 (13번째 · 시스템 알림)
core.run_baseline_forecast(p_note, p_train_end_override date default null)  ★ 운영 실행 모드
  sql/11 의 함수를 `create or replace` 로 덮어써 인자를 하나 더 받습니다. p_train_end_override 가 있으면 그 날짜까지를 학습으로 씁니다 —
  단, core.v_train_demand 는 forecast_setting 만 보므로 함수 안에서 `set local` 로 바꿀 수 없습니다.
  → 대신 `core.forecast_setting` 에 컬럼 `production_train_end date` 를 추가하고, v_train_demand 는 그대로(검증용), 새 뷰 `core.v_production_demand` (train_start ~ production_train_end) 를 만들며,
    함수는 p_mode ('VALIDATION' 기본 | 'PRODUCTION') 를 받아 PRODUCTION 이면 v_production_demand 격자로 예측합니다. run 에 mode 컬럼 추가.
  ★ 이유: 검증 모드(2023~24 로 2025 예측)의 예측은 과거 기간이라, 재고전개·발주추천이 "오늘 이후" 예측을 찾지 못해 NO_FORECAST 가 됩니다.
    운영에서는 최신 데이터까지 학습한 PRODUCTION run 이 필요하고, v_ai_forecast 는 **가장 최근 SUCCESS run 중 mode='PRODUCTION' 을 우선**하도록 sql/15 의 v_ai_forecast 를 여기서 `create or replace` 로 갱신합니다(컬럼 추가 없이 선택 규칙만).
    백테스트는 VALIDATION run 만 채점합니다 (run_backtest 에서 mode 검사 추가).
  → 이 변경은 sql/11 · 13 · 15 의 함수/뷰를 덮어씁니다. 각 원본 파일 머리에 "최종 정의는 sql/27" 주석 한 줄.
```

**1-1. 이월 항목 (STEP 11 검토에서 보류)** — `core.run_backtest()`(sql/13) 와 `core.run_virtual_operation()`(sql/17) 은 실패 시 최상위 exception 블록이 처음의 `insert … status='RUNNING'` 까지 되돌려 이력 행이 남지 않습니다. 두 함수를 이 파일에서 `create or replace` 로 덮어써, 실행 이력 insert 를 **별도 트랜잭션처럼 남기도록** 본문을 `begin … exception` 서브블록으로 감싸고 실패 시 바깥에서 `update … status='FAILED', message` 가 실제 행을 갱신하게 합니다 (원본 두 파일 머리에 "최종 정의는 sql/27" 주석 요청을 보고서에).

### 2. 화면

- `app/(admin)/admin/model-versions/page.tsx` — `Planned` 교체: 버전 표(모델 · 버전 · 정의 jsonb 요약 · 생성 · 사용 run 수) · KPI
- `app/(admin)/admin/forecast-runs/page.tsx` — 행 클릭 → `app/(admin)/admin/forecast-runs/[runId]/page.tsx` 상세(모델별 행 수 · 백테스트/가상운영 링크 · stale 배너 · mode 배지) · 실행 폼에 **모드 선택**(검증 실행 / 운영 실행) 추가 — STEP 8 이 고친 actions.ts 와 충돌하지 않게 인자만 추가
- `app/(admin)/admin/forecast-settings/page.tsx` — `production_train_end` 편집 폼(기본 = 데이터 마지막 달) · 현재 stale 요약(`v_stale_summary`)
- `app/(admin)/admin/logs/page.tsx` — `Planned` 교체: 통합 로그 표 · kind 필터 KPI · 검색(품목/사용자, 서버 컴포넌트 `?q=`)
- `app/(admin)/admin/policies/outlier/page.tsx` — `Planned` 교체: `core.outlier_rule` 표 + 사용/중지 토글 + `core.outlier_exclusion` 목록(수동 제외 추가 폼: item_id · use_date · 사유) · audit
- **stale 배너 공통화**: `components/ui/stale-banner.tsx` (서버 컴포넌트, `v_stale_summary` 읽음, stale 아니면 null 렌더) 를 만들고 `/forecast` · `/model-comparison` · `/inventory-projection` · `/purchase-recommendation` · `/dashboard` 상단에 붙입니다 (STEP 9·10·15 가 각자 만든 배너가 있으면 이 컴포넌트로 교체)
- `app/(admin)/admin/data/history/page.tsx` — 적재 완료 행에 "영향: 예측 재실행 필요" 배지(stale 이면)

### 3. `lib/admin-ops.ts`

`getModelVersions()` · `getForecastRunDetail(runId)` · `getSystemLogs(kind?, q?)` · `getStaleSummary()` · `getOutlierRules()` · `getOutlierExclusions()`.

### 4. 테스트

`lib/admin-ops.test.ts` 정규화. use-server.

## 완료 판정

- [ ] tsc · test · build · grep
- [ ] 데이터 적재 → `v_stale_summary` stale → 화면 배너 → 운영 실행 → stale 해제 흐름이 SQL 과 화면에 연결되어 있다 (보고서에 경로 서술)
- [ ] PRODUCTION run 이 v_ai_forecast 에서 우선 선택되고, 백테스트는 VALIDATION run 만 채점한다
- [ ] 대량 적재 시 Alert 가 생성된다 (트리거)
- [ ] 관리자 메뉴의 `Planned` 자리표시자가 남아 있지 않다: `grep -rn "components/ui/planned" app` → 0건 (있으면 보고서에 이유)

## 보고서

`.superpowers/sdd/step/task-20-report.md`. 메뉴: `/admin/model-versions` · `/admin/logs` · `/admin/policies/outlier` ready.
