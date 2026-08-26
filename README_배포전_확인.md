# 배포 전 확인

이 폴더를 superSCM 저장소에 복사하고 push 하면, 참가자가 목요일 아침에 `git pull` 로 받습니다.

## 복사

```bash
cd ~/superSCM
cp -r <이_폴더>/AGENTS.md <이_폴더>/SCHEMA.md .
cp -r <이_폴더>/lib/* lib/
cp -r <이_폴더>/components/analysis/* components/analysis/
cp -r <이_폴더>/docs/* docs/
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

## push

```bash
git add .
git commit -m "4회차 준비: 분석 화면 본보기와 컨텍스트 문서"
git push origin main
```
