# migration_rerun — 마이그레이션 재실행 안전성

`supabase/migrations/*.sql` 전체를 **파일명 순서로 두 번** 적용해, 두 번째 적용도 끝까지
성공하는지 확인합니다. 로컬 PostgreSQL 임시 DB(`scm_test_*`)에서만 돕니다.

```bash
bash supabase/tests/migration_rerun/run-all.sh
PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/migration_rerun/run-all.sh
```

기대 출력

```
pass1: PASS 24 · FAIL/ERROR 0
pass2: PASS 24 · FAIL/ERROR 0
결과: 전부 통과
```

## 왜 두 번 적용하나

사용자가 Supabase SQL Editor에서 SQL을 **직접** 적용하고, 문제가 생기면 "전체를 순서대로 다시
적용"하는 것이 이 프로젝트의 표준 복구 절차입니다(`docs/stage1-supabase-수동적용.md` §0). 그래서
모든 마이그레이션이 재실행 안전해야 합니다.

2026-09-12 최종 리뷰 시점에는 두 번째 적용에서 5개 파일이 멈췄습니다.

| 파일 | 오류 | 원인 |
|---|---|---|
| `20260828000300_step4_import_pipeline.sql` | `policy "upload_batch_active_select" ... already exists` | `create policy` 앞에 `drop policy if exists`가 없음 |
| `20260828000500_step6_baseline_forecast.sql` | `cannot change name of view column "is_stale" to "train_input_row_count"` | 0900이 `core.forecast_run`에 열을 추가해 `r.*`가 넓어짐(error.md #16) |
| `20260828000600_step7_backtest_champion.sql` | `policy "backtest_run_active_select" ... already exists` | STEP 4와 같은 원인 |
| `20260911000100_step18_master.sql` | `cannot drop columns from view` | 0850·0900·0950이 뷰 3개를 넓힘(error.md #24) |
| `20260911000850_stage1_item_policy_revision.sql` | `cannot drop columns from view` | 0900이 `analytics.v_item_policy`를 넓힘 |

해결은 error.md #29에 있습니다. 뒤 파일이 이미 넓혀 둔 뷰는 **건너뛰고**(지우지 않습니다 —
그 뷰에 의존하는 뒤 파일의 뷰까지 함께 사라지기 때문입니다), 정책은 `drop policy if exists` 뒤에
다시 만듭니다.

## 다른 스위트와 다른 점

다른 스위트의 `bootstrap.sh`는 STEP 4 · STEP 7의 정책을 미리 지우고 시작합니다(그 스위트의 관심사가
아니라서). 이 스위트는 **지우지 않습니다** — 정책 재생성이 재실행 안전한지까지 확인하는 것이
목적이기 때문입니다.
