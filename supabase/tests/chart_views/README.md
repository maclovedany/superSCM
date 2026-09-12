# 차트 데이터 뷰 DB 검증 (chart-views 트랙)

`supabase/migrations/20260912001000_chart_demand_shipment_views.sql`의 `analytics.v_demand_series` ·
`analytics.v_shipment_monthly_rollup` · `analytics.v_shipment_monthly_item`(그리고 그 밑의
`core.v_demand_actual_monthly`) 계산 규칙과 RLS를 **로컬 PostgreSQL 임시 DB**에서 실제로 실행해
확인하는 테스트 전용 스크립트입니다. 마이그레이션이 아니며, Supabase(원격) 프로젝트에는 절대
실행하지 않습니다. 구조는 `supabase/tests/inventory_kpi`(Task 12)와 같습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다. DB를 만들고, fixture가 RLS를 우회해 검증용 사용자 ·
  품목 · 실적 · 예측 · 출고 초기값을 넣습니다.

## 실행

```bash
bash supabase/tests/chart_views/run-all.sh
```

종료 코드 0이면 전부 통과입니다. 실패하면 요약 아래에 실패 줄이 나오고 로그 경로가 첫 줄에 있습니다.

| 환경변수 | 뜻 |
|---|---|
| `KEEP_DB=1` | 끝난 뒤 임시 DB를 지우지 않는다(조사용, 직접 `dropdb`) |
| `LOG_DIR=…` | 로그 위치. 기본은 `mktemp`로 만든 임시 디렉터리 |

## 파일

| 파일 | 역할 |
|---|---|
| `run-all.sh` | 전체 실행과 요약, 종료 시 임시 DB 삭제(`trap`), 마지막에 뷰별 실측 행 수(fixture 기준) 출력 |
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4·7 정책 선삭제 → 전체 마이그레이션(pg_cron 확장 없는 로컬 환경에서는 20260912000100만 건너뜀) → 20260912001000(차트 데이터 뷰)은 자기 순서 자리에서 곧바로 한 번 더 적용(재실행 안전성) |
| `lib.sh` | 로컬 대상 확인(`require_local_target`) — 다른 스위트와 동일 |
| `guard.psql` | 모든 `.psql`이 먼저 포함하는 대상 DB 확인 — 동일 |
| `auth-stub.psql` | 최소 `auth.users` · `auth.uid()` 스텁(JWT claim 대역) — 동일 |
| `fixtures.psql` | 검증용 사용자 2명(SCM 품목담당자 · 마케팅 — 둘 다 세 뷰를 무게이트로 본다) · 수요 시계열용 품목 6개(각각 다른 사유 코드 시나리오, CHDEM06은 부분 밴드) · 출고용 품목 4개(CHSHIP03은 trailing 평균 0, CHSHIP04는 달력상 6년 공백), 검증 헬퍼 스키마 `chart_test` |
| `scenarios.psql` | S1·S1b 무게이트 확인(STOCK_VIEW_ALL 없는 마케팅도 막히지 않는다 — fix round 1, §3-b) · S2 실적+예측+밴드 정상(champion 모델만, decoy 제외, 출처 없는 실적 제외) · S3 Champion 선정 자체가 없음(NO_CHAMPION_SELECTION) · S4 기간 갭(실적·예측이 다른 달 — 합쳐지지 않고 둘 다 남는다) · S5 유효 후보 없음(NO_VALID_CANDIDATE → NO_CHAMPION_MODEL) · S6 밴드 둘 다 결측(BAND_UNAVAILABLE, predicted_qty는 정상) · S7·S8 출고 롤업 합계와 trailing 이상치 신호(관측치 부족 구간은 null, 스파이크 달은 계산된 배수) · S9 품목×월 필터 조회(스무딩 없음) · S10 부분 밴드(p80만 있음 — fix round 1, B-4) · S11 trailing 평균이 정확히 0이면 TRAILING_AVG_ZERO(fix round 1, B-1) · S12 달력 기준 6개월(6년 전 행을 직전 6개월로 잘못 세지 않는다 — fix round 1, B-3) |

### fix round 1(팀장 판정) 이후 바뀐 것

- 세 뷰 모두 **권한 게이트를 뺐다**(원래 STOCK_VIEW_ALL → 게이트 없음, 기존
  `v_forecast_result`·`v_champion_model`·`v_shipment_trend`와 같은 자세). S1·S1b는 이제
  "막히지 않는다"를 확인한다.
- `qty_vs_trailing_6m_avg`가 **달력 기준 RANGE 윈도우**로 바뀌었다(행 기준 `ROWS BETWEEN`이
  아니다) — 희소한 item_type에서 몇 년 전 행을 "직전 6개월"로 잘못 세는 문제를 막는다(S12).
- 관측치는 충분한데 trailing 평균이 정확히 0이면 `TRAILING_AVG_ZERO`(S11) — 재현 가능한 null에
  사유 코드가 없던 문제를 고쳤다.

## 이 스위트가 확인하지 않는 것

- **실 배포 데이터 기준 행 수** — 이 저장소에는 `raw.usage_history` · `core.forecast_result` ·
  `core.champion_model_selection` · `raw.fact_shipment`의 실제 로드 SQL이 없습니다(스키마 전용
  덤프 + 실습용 dim_item·fact_shipment INSERT뿐). 여기서 만드는 세 뷰가 배포 DB에서 실제로 몇
  행을 반환하는지는 팀장이 실제 프로젝트(Supabase)에서 직접 확인해야 합니다 — 이 스위트는 뷰의
  **계산 규칙**(사유 코드 · 갭 처리 · 권한)만 fixture로 검증합니다.
- 화면 컴포넌트 — 다른 트랙이 만듭니다. `lib/analytics/repository.ts`가 반환하는 타입만
  소비하면 됩니다.
