# 배포 전 확인

이 폴더를 superSCM 저장소에 복사하고 push 하면, 참가자가 목요일 아침에 `git pull` 로 받습니다.

## 복사

```bash
cd ~/superSCM
cp -r <이_폴더>/AGENTS.md <이_폴더>/SCHEMA.md .
cp -r <이_폴더>/lib/* lib/
cp -r <이_폴더>/components/analysis/* components/analysis/
cp -r <이_폴더>/docs/* docs/
cp -r <이_폴더>/sql/* sql/
mkdir -p app/analysis/leadtime
cp <이_폴더>/app/analysis/leadtime/page.tsx app/analysis/leadtime/
```

`globals.css.추가분.txt` 의 내용을 `app/globals.css` **맨 끝에** 붙여넣습니다.

> `lib/supabase/env.ts` `client.ts` `server.ts` 가 저장소에 이미 있으면 **덮어쓰지 마세요.**
> 다만 `env.ts` 가 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 를 읽는지는 확인하세요.

## ★ 정답이 섞여 있지 않은지 확인

이 세 가지가 **없어야** 참가자 실습이 성립합니다.

```bash
grep -n "StockoutRisk" lib/scm-model.ts     # 주석만 나와야 함
grep -n "getStockoutRisks" lib/scm.ts       # 주석만 나와야 함
ls app/analysis/stockout                    # No such file 이어야 함
```

`lib/scm-model.ts` 끝부분과 `lib/scm.ts` 중간에 "여기에 만듭니다" 주석이 있습니다.
참가자가 어디에 넣을지 헤매지 않도록 남겨둔 표시입니다.

## Supabase 권한 부여 (덤프를 새로 복원했다면 필수)

`dump.sql` 에는 GRANT 문이 하나도 없습니다.
덤프를 복원하면 스키마와 뷰가 전부 `postgres` 소유로만 만들어지고 `anon` 롤에는
권한이 붙지 않습니다. 이 상태에서는 Settings → API → **Exposed schemas** 에
`core`, `analytics` 를 넣어도 화면에 이 오류가 뜹니다.

```
permission denied for schema analytics   (42501)
```

> Exposed schemas 와 GRANT 는 별개입니다.
> 노출 설정은 PostgREST 가 그 스키마로 **라우팅할지**만 정하고,
> 실제 접근은 Postgres 롤 권한이 따로 필요합니다.
> 노출만 확인하고 넘어가면 이 오류를 못 찾습니다.

Supabase → **SQL Editor** 에서 실행합니다.

```
sql/01-grants.sql     읽기 권한 (필수)
sql/02-policies.sql   쓰기 정책 (앱에서 leadtime_plan / usage_profile 을 저장할 때만)
```

`01-grants.sql` 은 마지막에 확인 쿼리가 붙어 있습니다. 두 값이 모두 `true` 여야 합니다.

```
anon_schema_ok | anon_view_ok
---------------+--------------
 t             | t
```

`02-policies.sql` 은 `core.leadtime_plan` 과 `core.usage_profile` 의 RLS 정책입니다.
두 테이블은 덤프에서 RLS 만 켜져 있고 정책이 없어서, 앱에서는 읽기도 쓰기도 막힙니다.
SQL Editor / Table Editor 로만 값을 바꿀 계획이면 실행하지 않아도 됩니다.

## 빌드 확인

```bash
npm install
npm run build
```

**배포본 상태에서도 빌드가 통과해야 합니다.** 통과 확인을 마친 구성입니다.

## 실행 확인

```bash
cp .env.local.example .env.local
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

| 주소 | 기대 |
|---|---|
| `/analysis/leadtime` | 공급처 12행 |
| `/analysis/stockout` | 404 (참가자가 오후에 만듭니다) |
| `/api/health/supabase` | `{"configured": true}` |

`/analysis/leadtime` 이 "조회에 실패했습니다" 로 나오면 화면 아래 사유를 봅니다.

| 사유 | 할 일 |
|---|---|
| `permission denied for schema analytics` | `sql/01-grants.sql` 실행 |
| `Invalid schema` / 빈 배열 | Settings → API → Exposed schemas 에 `core`, `analytics` 추가 |

## push

```bash
git add .
git commit -m "4회차 준비: 분석 화면 본보기와 컨텍스트 문서"
git push origin main
```
