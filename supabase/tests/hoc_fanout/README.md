# core.v_part_linkage 팬아웃 수정 DB 검증

`supabase/migrations/20260912001100_hoc_fanout_fix.sql`(정본은
`supabase/realdata/04-core-views.sql:73` — 고칠 때 두 파일을 함께 고친다)의
`core.v_part_linkage` 재정의를 **로컬 PostgreSQL 임시 DB**에서 실제로 실행해 확인하는 테스트
전용 스크립트입니다. 마이그레이션이 아니며, Supabase(원격) 프로젝트에는 절대 실행하지 않습니다.
구조는 `supabase/tests/chart_views`와 같습니다.

## 배경

`raw.bridge_xcn`에서 같은 `related_item`이 서로 다른 `hoc_item` 두 개를 가리키는 454건
(20,306개 `related_item` 중, 배포 데이터 실측)을 원래 정의(`select distinct related_item,
hoc_item`)가 그대로 통과시켰다. `core.v_shipment_by_hoc`가 이 뷰를 `left join`한 뒤
`sum(qty)`를 내므로, 팬아웃된 품목의 출고 실적 전량이 두 대표코드 양쪽에 각각 통째로
합산됐다 — 총량은 0.02%(956/4,710,425)만 부풀지만, 품목 단위로는 전액이 가짜인 유령 계열이
최대 454개 생긴다. `analytics.v_shipment_monthly_item`(품목별 출고 차트)이 정확히 그 단위를
쓴다.

## 준비 · 실행

`supabase/tests/chart_views`와 동일합니다.

```bash
bash supabase/tests/hoc_fanout/run-all.sh
```

| 환경변수 | 뜻 |
|---|---|
| `KEEP_DB=1` | 끝난 뒤 임시 DB를 지우지 않는다(조사용, 직접 `dropdb`) |
| `LOG_DIR=…` | 로그 위치. 기본은 `mktemp`로 만든 임시 디렉터리 |

## 파일

| 파일 | 역할 |
|---|---|
| `run-all.sh` | 전체 실행과 요약, 종료 시 임시 DB 삭제(`trap`), 마지막에 fixture 3품목의 raw·대표코드 합계 대조 출력 |
| `bootstrap.sh` | `chart_views`와 동일 구조(스키마 덤프 + 전체 마이그레이션), `20260912001100`을 자기 순서에서 재적용 |
| `lib.sh` · `guard.psql` · `auth-stub.psql` | 다른 스위트와 동일 |
| `fixtures.psql` | `raw.bridge_xcn` 중복 시나리오 3개(HXCN1 완전성으로 해소 가능 · HXCN2 진짜 모호 · HXCN3 대조군)와 그 세 품목의 `raw.fact_shipment` 실적. 사용자 컨텍스트가 필요 없다(이 뷰들은 permission 게이트도 security_invoker도 없는 definer 계산 뷰) |
| `scenarios.psql` | T1 완전성 규칙으로 서술 있는 행만 남음 · T2 진짜 모호는 통째로 빠짐(임의 선택 없음) · T3 팬아웃 없이 실적이 한 대표코드에만 감 · T4 모호 품목은 자기 코드로 남고 어느 쪽으로도 합산 안 됨 · T5 XCN 연계 없는 품목 회귀 없음 · T6 raw 합계와 `core.v_shipment_by_hoc` 합계가 정확히 일치(팬아웃 전이었다면 230 vs 180으로 어긋났을 것) |

## 이 스위트가 확인하지 않는 것

- 배포 데이터 기준 정확한 454건·2건 재현 — 이 스위트는 그 **패턴의 축소판**(fixture 3품목)만
  확인한다. 배포 규모 숫자(454 중복, 2 진짜 모호, +956 초과)는 이 세션이 로컬에
  `supabase/realdata/01~05`를 실제로 적재해 직접 측정했다(`hoc-fanout-report.md` 참고) — 이
  스위트가 매번 그 전체 데이터를 적재하지는 않는다(수십 MB, 다른 스위트와 실행 시간 격차가
  커진다).
