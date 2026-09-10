# 실데이터 적재 SQL

배포 Supabase 의 실데이터는 `supabase/migrations/` 가 아니라 **이 폴더의 SQL** 로 만들어졌습니다.
`gap.md` §10 이 지적한 "저장소만으로 배포 DB 를 재현할 수 없다" 를 닫기 위해 저장소로 옮긴 것입니다.

## 실행 순서

Supabase SQL Editor 에서 파일 하나를 통째로 붙여넣고 Run, 다음 번호로.

| 순서 | 파일 | 하는 일 |
|---|---|---|
| 1 | `01-schema.sql` | 테이블 10개 · 인덱스 · RLS. **drop 후 재생성이라 언제든 처음부터 다시 시작해도 안전** |
| 2~10 | `02-data-01.sql` ~ `02-data-25.sql` | INSERT 로 구운 실데이터 230,302행 |
| 11 | `03-verify.sql` | 행수 · 기간 · 고아키 검증 ★ 여기서 확인하고 넘어갑니다 |
| 12 | `04-core-views.sql` | `core` 정제 뷰 — XCN 합산 · 기종 정리 · 달력 |
| 13 | `05-analytics-views.sql` | `analytics` 뷰 — 화면과 Agent Tool 이 읽는 최종 형태 |
| 14 | `06-grants-and-lockdown.sql` | 권한 부여 + anon 잠금 · **항상 마지막** |
| 15 | `07-deprecate-and-agent.sql` | 5회차 더미 뷰 폐기 표시 + 대화 저장 테이블 |

`README.md` 에 원본 안내가 그대로 들어 있습니다.

## ★ 다시 실행할 때 주의

- `02-data-*.sql` 을 **두 번 실행하면 행이 두 배가 됩니다.** `03-verify.sql` 에서 행수가 기대보다 많으면 `01-schema.sql` 부터 다시 하십시오.
- `04` · `05` 만 다시 실행하는 것은 안전합니다. 뷰만 다시 만듭니다.
- 뷰 정의를 고칠 때 컬럼이 바뀌면 `create or replace view` 가 42P16 으로 죽습니다. `05` 앞머리의 정리 블록이 그것을 처리합니다.

## SQL 로는 안 되는 설정 하나

```
Supabase 대시보드 → Project Settings → API → Data API → Exposed schemas
    public, core, analytics
```

이 설정이 없으면 앱 조회가 **오류 없이 빈 배열**로 돌아옵니다.

## 아직 저장소에 없는 것

`docs/db-저장소-대조-*.md` 참조. 4~5회차에 SQL Editor 로 직접 만든 객체 8개의 정의가 저장소에 없습니다.
그중 `core.v_item_master` 는 `supabase/migrations` 의 STEP 5·6 이 의존하는 뷰입니다.
