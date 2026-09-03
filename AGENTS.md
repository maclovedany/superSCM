# 4회차 프로젝트 작업 규칙

> 기능을 시킬 때 이 파일과 `SCHEMA.md` · `design.md` 를 먼저 읽으라고 하세요.
> 그래야 12명이 각자 만들어도 같은 모양이 나옵니다.
>
> ```
> AGENTS.md · SCHEMA.md · design.md 를 먼저 읽어줘.
> 그다음 (요구사항)을 만들어줘.
> ```
>
> | 문서 | 담당 |
> |---|---|
> | `AGENTS.md` | 작업 규칙 (이 파일) |
> | `SCHEMA.md` | 데이터 구조 |
> | `design.md` | **화면 디자인 — 색·글꼴·컴포넌트** |
> | `step.md` | 구현 순서 |
> | `renew.prd` | 제품 요구사항 |

## 이 프로젝트가 무엇인가

한국후지필름BI 의 **AI 기반 SCM 의사결정 플랫폼** 입니다. 서비스명은 **SuperSCM** 입니다.
해외 생산법인 12곳에서 부품을 조달하며, 수요를 예측하고 · 예측을 검증하고 · 발주 시점과 수량을 추천합니다.

전체 요구사항은 `renew.prd`, 구현 순서는 `step.md` 에 있습니다.

## 기술 스택

- Next.js 15 (App Router) · React 19 · TypeScript
- 스타일: **순수 CSS + 토큰**. 기준은 `design.md` 입니다. Tailwind 를 쓰지 않습니다
- 테마: **다크 전용**. 라이트 테마를 만들지 않습니다
- 글꼴: Pretendard(한글) · Inter(영문·숫자) · JetBrains Mono(코드·수치)
- 차트: **`recharts@3.10.1`**. `components/chart/` 안에서만 import 합니다
- DB: Supabase (PostgreSQL)
- 인증: Supabase Auth + RLS

---

## 데이터 규칙

- Supabase 원본 데이터는 `raw` 스키마에서 직접 수정하지 않습니다.
- 회사 기준과 매핑은 `core`, 화면용 계산 결과는 `analytics` 를 사용합니다.
- 화면은 원칙적으로 `analytics` 만 조회합니다.
- 계산식은 화면 컴포넌트에 넣지 말고 `lib/scm.ts` 또는 순수 모델 함수에 둡니다.

## 환경변수

```
NEXT_PUBLIC_SUPABASE_URL              프로젝트 URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  publishable 키 (sb_publishable_…)
```

- `.env.local` 에만 저장하며 커밋하지 않습니다.
- **secret 키(`sb_secret_…`)를 클라이언트 코드에 넣지 않습니다.**
- Supabase 가 2025년에 키 체계를 바꿨습니다. 예전 `anon` 키는 publishable 키로 대체되었고,
  2025년 11월 이후 생성된 프로젝트에는 `anon` 이 없습니다.

## 코드 구조

새 화면을 만들 때 이 순서를 따릅니다.

```
1  SQL 뷰             analytics 에 계산 결과를 만든다
2  lib/scm-model.ts   타입과 정규화 함수를 추가
3  lib/scm.ts         조회 함수를 추가
4  app/(user|admin)/<이름>/page.tsx   서버 컴포넌트로 조회
5  components/*                       design.md 의 컴포넌트를 조립
```

**계산은 1번에서 끝냅니다.** 4·5번에서 평균을 내거나 분위수를 구하지 않습니다.

### 서버 · 클라이언트 경계

```
서버 컴포넌트      lib/scm.ts 로 조회 · 권한 검증
      ↓ props
클라이언트 컴포넌트  차트 · 토글 · 폼만 'use client'
```

차트 컴포넌트 안에서 계산하지 않습니다. 이미 계산된 값을 받아 그리기만 합니다.

### 정규화 함수를 두는 이유

뷰 컬럼 이름이 달라져도 화면이 깨지지 않게 하기 위해서입니다.

```ts
supplier: value(row, ['supplier_name', '법인', '공급업체명']) ?? '미정',
```

새 타입을 추가할 때도 같은 방식으로 컬럼 이름 후보를 여러 개 적어둡니다.

---

## 반드시 지킬 것

### 1. `design.md` 의 토큰만 쓴다

색·간격·글꼴을 화면 파일에 직접 쓰지 않습니다. **CSS 변수만 씁니다.**

```css
/* ✕ 반려 */
color: #10B981;  padding: 15px;  font-size: 13.5px;

/* ○ */
color: var(--secondary);  padding: var(--s-4);  font: var(--label);
```

스타일 파일은 네 개뿐입니다. 화면별 CSS 파일을 만들지 마세요.

```
app/globals.css        토큰 · 리셋 · 폰트
styles/shell.css       사이드바 · 탑바 · 페이지 골격
styles/components.css  카드 · 배지 · 버튼 · 표 · 알림
styles/chart.css       차트 껍데기
```

새 컴포넌트가 필요하면 `design.md` §6 에 스펙을 먼저 추가하고 만듭니다.
Tailwind · styled-components · CSS Modules 를 새로 넣지 않습니다 (`design.md` §13.1).

**기존 클래스(`card` · `metric` · `tag` · `analysis-*`)는 전부 폐기되었습니다.** 이름을 재사용하지 마세요.

### 2. 숫자 계산은 SQL 이 한다

화면 코드에서 평균을 내거나 분위수를 구하지 마세요.
계산이 필요하면 DB 에 뷰를 만들고 조회만 합니다.

### 3. 조회 오류와 빈 결과를 구분한다

```ts
if (error) return <p>조회에 실패했습니다: {error}</p>;
if (rows.length === 0) return <p>표시할 데이터가 없습니다.</p>;
```

빈 배열이 왔을 때 "데이터가 없다" 로만 표시하면,
Exposed schemas 설정 누락 같은 문제를 놓칩니다.

### 4. 새 기능은 새 파일로 만든다

`components/workflow/` 아래 6개 스텝 파일은 **하드코딩 데모이며 폐기 예정**입니다.
고치지 말고, `renew.prd` 의 화면으로 새로 만듭니다 (`step.md` STEP 1).

**화면 위치**

```
app/(auth)/…      로그인
app/(user)/…      Dashboard · Forecast · Model Comparison · Inventory · Recommendation
app/(admin)/…     Users · Models · Policies · Data · API
```

메뉴 정의는 `lib/menu.ts` 한 곳에만 둡니다.

### 5. 계산 불가를 숫자로 채우지 않는다

사용 이력이 없거나 리드타임이 없으면 `null` 과 사유 코드를 돌려줍니다.

```ts
stockoutDays: number | null;
reason?: 'NO_USAGE_HISTORY' | 'NO_LEADTIME' | 'NO_INVENTORY_DATA' | 'INSUFFICIENT_SAMPLE';
```

`999` 같은 값을 넣으면 AI Agent 가 "999일 뒤에 소진됩니다" 라고 설명하게 됩니다.

**화면에서도 숫자로 채우지 않습니다.** `—`(em dash) 와 사유 코드를 함께 표시하고,
정렬에서는 맨 뒤로 보냅니다. 표기 방법은 `design.md` §8.2 에 있습니다.

### 6. 한 번에 하나씩 만든다

화면이 뜨는 것 먼저 확인하고, 그다음에 하나씩 붙입니다.

### 7. 한국어로 쓴다

화면 문구, 주석, 커밋 메시지 모두 한국어입니다. 컬럼명·변수명은 영어를 씁니다.
버튼 문구와 오류 메시지 작성 규칙은 `design.md` §12 에 있습니다.

### 8. 권한은 서버에서 검증한다

모든 서버 컴포넌트와 Server Action 의 **첫 줄**에서 부릅니다.

```ts
const user = await requireUser();          // 화면
const actor = await requireAdminOrThrow(); // 관리자 액션
```

메뉴를 숨기는 것만으로는 부족합니다. 액션은 URL 만 알면 호출할 수 있습니다.
DB 의 RLS 가 마지막으로 막지만, 거기까지 가기 전에 서버가 먼저 막습니다.

### 9. KPI 카드는 눌러서 목록을 좁힌다

숫자를 보여줬으면 그 내역도 바로 보여줍니다.
"위험 3건" 을 보고 그 3건을 찾으러 표를 다시 뒤지게 만들지 마세요.

```tsx
const FILTERS: FilterSpec<StockoutRisk>[] = [
  { key: 'all',      label: '대상 품목', match: null },
  { key: 'critical', label: '위험',     match: (r) => r.riskStatus === 'CRITICAL' },
];

<KpiCard label="위험" value={n} filter={{ key: 'critical', active: f === 'critical' }} />
```

- 필터 상태는 **URL 쿼리**에 둡니다. 화면은 서버 컴포넌트로 남습니다
- 카드와 목록은 `FILTERS` 배열 **한 곳**을 함께 봅니다
- 필터가 걸리면 목록 위에 `FilterNotice` 를 띄웁니다
- **목록으로 좁혀지지 않는 카드에는 `filter` 를 주지 않습니다.** 눌러도 아무 일이 없으면 더 나쁩니다

자세한 규칙은 `design.md` §6.4.

### 10. 상태색을 장식으로 쓰지 않는다

초록·노랑·빨강은 `SAFE` · `WARNING` · `CRITICAL` 을 뜻합니다. 예뻐 보이라고 쓰지 않습니다.
회색은 **산출 불가** 전용입니다.

색만으로 상태를 표현하지 않습니다. 배지에는 반드시 글자가 들어갑니다.

### 11. 차트는 `components/chart/` 를 거친다

화면에서 `recharts` 를 직접 import 하지 마세요. 축 포맷과 색이 화면마다 달라집니다.

```
components/chart/forecast-overlay-chart.tsx
components/chart/projection-chart.tsx
lib/chart-colors.ts        모델별 색 고정 매핑
```

### 12. 변경 후 `npm run build` 를 실행한다

---

## 검증하는 법

코드를 못 읽어도 결과는 확인할 수 있습니다.

- **건수를 센다** — 화면 행 수가 DB 조회 결과와 같은가
- **한 건을 손으로 계산한다** — ITEM012: (723 + 361) ÷ 60.22 = 18.0일
- **극단값을 넣어본다** — 사용 이력이 없는 ITEM020 은 어떻게 표시되는가
- **말로 설명해본다** — 이 화면이 무엇을 보여주는지 한 문장으로 말할 수 있는가

**설명하지 못하는 코드는 커밋하지 마세요.**

---

## 자주 나는 오류

| 증상                          | 원인                | 해결                                                         |
| ----------------------------- | ------------------- | ------------------------------------------------------------ |
| 환경변수 오류                 | `.env.local` 미설정 | `.env.local.example` 복사 후 값 입력                         |
| `relation ... does not exist` | 스키마 미지정       | `.schema('analytics')` 사용                                  |
| 데이터가 빈 배열              | 스키마 미노출       | Settings → API → Exposed schemas 에 `core`, `analytics` 추가 |
| 설정을 고쳤는데 그대로        | dev 서버 캐시       | `Ctrl+C` 후 `npm run dev`                                    |
| 화면이 갱신 안 됨             | 페이지 캐시         | `export const dynamic = 'force-dynamic'` 추가                |

사용자가 에러가 나서 해결해달라고 요청할때에 error.md 파일을 만들어서, 매번 그 에러와 해결책을 기재하고 업데이트해줘.

에러가 발생하면 먼저, error.md 을 확인해서, 동일한 에러, 유사한 에러가 있었는지 확인하고, 그 해결책을 고려해서 적용 후, 안되는 경우, 새로운 방법을 찾아줘.
