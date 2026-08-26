# 4회차 프로젝트 작업 규칙

> Codex 에게 기능을 시킬 때 이 파일과 `SCHEMA.md` 를 먼저 읽으라고 하세요.
> 그래야 12명이 각자 만들어도 같은 모양이 나옵니다.
>
> ```
> AGENTS.md 와 SCHEMA.md 를 먼저 읽어줘.
> 그다음 app/analysis/leadtime/page.tsx 를 참고해서 (요구사항)을 만들어줘.
> ```

## 이 프로젝트가 무엇인가

한국후지필름BI 의 월간 발주계획 시스템 프로토타입입니다.
해외 생산법인 12곳에서 부품을 조달하며, 매달 발주량을 계산합니다.

## 기술 스택

- Next.js 15 (App Router) · React 19 · TypeScript
- 스타일: **순수 CSS** (`app/globals.css`). Tailwind 를 쓰지 않습니다.
- DB: Supabase (PostgreSQL)
- 차트 라이브러리 없음

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

새 분석 화면을 만들 때 이 순서를 따릅니다.

```
1  lib/scm-model.ts   타입과 정규화 함수를 먼저 추가
2  lib/scm.ts         조회 함수를 추가
3  app/analysis/<이름>/page.tsx   화면을 만든다
4  components/analysis/*          껍데기와 표는 재사용
```

`app/analysis/leadtime/page.tsx` 가 본보기입니다. 같은 구조로 만듭니다.

### 정규화 함수를 두는 이유

뷰 컬럼 이름이 달라져도 화면이 깨지지 않게 하기 위해서입니다.

```ts
supplier: value(row, ['supplier_name', '법인', '공급업체명']) ?? '미정',
```

새 타입을 추가할 때도 같은 방식으로 컬럼 이름 후보를 여러 개 적어둡니다.

---

## 반드시 지킬 것

### 1. 새 CSS 프레임워크를 추가하지 않는다

Tailwind, styled-components, CSS Modules 등을 새로 넣지 마세요.
`app/globals.css` 에 이미 있는 클래스를 씁니다. 부족하면 그 파일 끝에 추가합니다.

**쓸 수 있는 클래스**

```
레이아웃   app-shell  sidebar  main  topbar  content  section
분석 화면  analysis-page  analysis-heading  analysis-table-wrap  analysis-table
카드       card  card-title  metric  metric-label  metric-value  metric-foot
그리드     grid  grid-2  grid-3  grid-4
배지       tag  tag green  tag amber  tag gray  local-badge
버튼       button  button primary  button-row
텍스트     eyebrow  muted  positive  text-good  text-danger
```

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

### 4. 기존 파일을 함부로 고치지 않는다

새 기능은 **새 파일**로 만듭니다.
`components/workflow/` 아래 6개 스텝 파일은 되도록 건드리지 마세요.

새 분석 화면 위치: `app/analysis/<기능이름>/page.tsx`

### 5. 계산 불가를 숫자로 채우지 않는다

사용 이력이 없거나 리드타임이 없으면 `null` 과 사유 코드를 돌려줍니다.

```ts
stockoutDays: number | null;
reason?: 'NO_USAGE' | 'NO_LEADTIME';
```

`999` 같은 값을 넣으면 6회차에 GPT 가 "999일 뒤에 소진됩니다" 라고 설명하게 됩니다.

### 6. 한 번에 하나씩 만든다

화면이 뜨는 것 먼저 확인하고, 그다음에 하나씩 붙입니다.

### 7. 한국어로 쓴다

화면 문구, 주석, 커밋 메시지 모두 한국어입니다. 컬럼명·변수명은 영어를 씁니다.

### 8. 변경 후 `npm run build` 를 실행한다

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

| 증상 | 원인 | 해결 |
|---|---|---|
| 환경변수 오류 | `.env.local` 미설정 | `.env.local.example` 복사 후 값 입력 |
| `relation ... does not exist` | 스키마 미지정 | `.schema('analytics')` 사용 |
| 데이터가 빈 배열 | 스키마 미노출 | Settings → API → Exposed schemas 에 `core`, `analytics` 추가 |
| 설정을 고쳤는데 그대로 | dev 서버 캐시 | `Ctrl+C` 후 `npm run dev` |
| 화면이 갱신 안 됨 | 페이지 캐시 | `export const dynamic = 'force-dynamic'` 추가 |
