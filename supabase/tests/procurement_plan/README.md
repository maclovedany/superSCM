# 발주계획 계산·확정·승인 DB 검증 (Task 9b)

`supabase/migrations/20260911000900_stage1_procurement_plan.sql`의 원천 게이트, Flex 클램프, MOQ 올림,
재고 전개, 확정 차단, PURCHASE_PLAN 승인 · 반려 · 불변성을 **로컬 PostgreSQL 임시 DB**에서 실제로 실행해
확인하는 테스트 전용 스크립트입니다. 마이그레이션이 아니며, Supabase(원격) 프로젝트에는 절대 실행하지 않습니다.
구조는 `supabase/tests/item_policy`(Task 9a)와 같습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`와 `PGPORT`만 바꿉니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다(DB 생성, RLS를 우회한 fixture 삽입).

## 실행

```bash
bash supabase/tests/procurement_plan/run-all.sh
PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/procurement_plan/run-all.sh
```

종료 코드 0이면 전부 통과입니다. 기본 세션 timezone은 UTC입니다(`lib.sh`).

| 환경변수 | 뜻 |
|---|---|
| `KEEP_DB=1` | 끝난 뒤 임시 DB를 지우지 않는다(조사용, 직접 `dropdb`) |
| `LOG_DIR=…` | 로그 위치. 기본은 `mktemp`로 만든 임시 디렉터리 |

## 파일

| 파일 | 역할 |
|---|---|
| `run-all.sh` | 전체 실행과 요약, 종료 시 임시 DB 삭제(`trap`) |
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → auth 스텁 → schema-dump → 전체 마이그레이션 → 0900 재적용(재실행 안전성) |
| `lib.sh` · `guard.psql` · `auth-stub.psql` | 로컬 대상 확인 · auth 스텁 — 다른 스위트와 동일 |
| `fixtures.psql` | 사용자 6명(품목담당자 2 · 팀장 · 마케팅 · ADMIN · 확정+승인 합성 계정), 품목 4개(Task 9a 승인 절차로 정책 반영), 정상 창고재고, **IMPORTED usage_history 배치 출처를 가진** 학습 사용 이력, Forecast Run · Champion 결과 행, AGREED 부서 제출, 승인된 수급회의 결과 |
| `scenarios.psql` | S1~S24 — 아래 표 |

## 시나리오

| 번호 | 확인 내용 |
|---|---|
| S1 | PLAN_CONFIRM 없으면 생성 거절 · 없는 Run · 기준월 필수 |
| S2 | 품목 4 × 6개월 라인, 입력값 스냅샷, BUILT 이력 |
| S3 | 필요량 120 · MOQ 50 → 150, 예상 월말 · DoS · 재고금액, 2개월차 시작재고 = 1개월차 예상 월말 |
| S4 | MOQ null → 1 (120.5 → 121) |
| S5 | 1개월차 ±20% 클램프, 승인 추가 수요는 클램프 뒤 가산, 미합의 · 오류 줄 · 미승인 회의 결과 제외 |
| S6 · S7 | 2~3개월차 ±30%, 4~6개월차 미적용 |
| S8 | 목표 DoS null → 계산 불가 · 확정 차단(BLOCKED, 이력, 승인 요청 없음, 차단 사유 뷰와 일치) |
| S9 | 목표 DoS를 승인 없이 직접 넣어도 승인값이 아니다(계산 불가 · 확정 차단), 재계산 = 새 버전 · 이전 버전 SUPERSEDED |
| S10 | test Actual을 바꿔도 저장된 계획은 그대로, 다시 계산하면 FORECAST_INPUT_CHANGED(롤백), 입력이 같으면 같은 결과 |
| S11 | 미확정 주문 · 영업 확률 100% 파이프라인이 있어도 발주량이 같다 |
| S12 | 목표 DoS 승인 → 전 라인 계산 → 확정 → PURCHASE_PLAN 승인 대기, 우회 승인 요청 거절 |
| S13 | 확정자 본인은 승인할 수 없다(합성 계정, 롤백) |
| S14 | 팀장 승인 → APPROVED · 최종본 · 이력 · 감사 로그 · 도메인 알림(dedupe_key 분리) |
| S15 | 승인본 라인 · 행 수정/삭제, 라인 추가, 이력 수정, 재승인 모두 거절 |
| S16 | 승인 후 재계산 = 새 버전, 승인본 그대로 · 최신 승인본 유지 |
| S17 | 반려 → REJECTED(의견) · 재확정 · 승인 대기 중 재계산 시 승인 요청 CANCELLED |
| S18 | 출처 없는 학습 행, 또는 학습 행은 검증됐지만 Champion 채점에 쓴 test 기간 행이 출처 없음 → 모든 라인 FORECAST_SOURCE_UNVERIFIED · 확정 거절(롤백) |
| S19 | 무관한 수주 적재(is_stale 켜짐) → 여전히 VERIFIED, 실행 후 기간 안 사용 이력 추가 → FORECAST_INPUT_CHANGED, 학습 · 검증 기간 변경 → FORECAST_WINDOW_CHANGED(롤백) |
| S20 | 재고 분류 불가 · 전월 계산 불가 · Champion 없음, KPI 부분 합계 금지(롤백) |
| S21 | 성공한 Run 없음 → FORECAST_SOURCE_UNVERIFIED, Run 비우면 최신 성공 실행 |
| S22 | RLS — 권한 없으면 계획 · 라인 · KPI · 차단 사유가 안 보이고 직접 쓰기 불가 |
| S23 | 달마다 작업 중 계획 1개, 계산/불가 라인의 수량 불변식, MOQ 배수, Forecast 결과 불변 |
| S24 | 승인본 1개월차 KPI 합계(발주량 326 · 예상 월말재고 1,086 · 예상 재고금액 409,500) |
| S25 | 승인된 정책 값만 — 직접 넣은 단가 → UNIT_PRICE_UNSET, 승인 후 그 단가 사용, 직접 넣은 MOQ → 1, 승인 MOQ 50 → 150, `v_item_policy` approved_* 열 · 사유(롤백) |
| S26 | 정밀도 — 반복소수 평균에서 정수 필요량(합 100 · 목표 45 → 100, 합 10 · 목표 108 → 6), 예상 DoS 원값 저장, 합 1~1000 × 목표 5종 × MOQ 3종 × 수요 2종 불일치 0건 |
| S27 | 입력 지문 — 더미로 학습한 실행 뒤 더미 삭제 → FORECAST_INPUT_CHANGED · 확정 거절, 지문 없는 실행 · Backtest → FORECAST_INPUT_UNTRACED(롤백) |

## 안전장치

- DB 이름은 `scm_test_`로 시작해야 하고, 원격 호스트를 가리키면 실행 전에 거절합니다(`lib.sh` · `guard.psql`).
- 확장자를 `.psql`로 둔 이유: `supabase test db`(pg_prove)가 이 파일들을 테스트로 실행하지 않게 하기 위해서입니다.
- 이 스위트는 자신이 만든 DB(이름이 `scm_test_procplan_`로 시작)만 정리합니다.
