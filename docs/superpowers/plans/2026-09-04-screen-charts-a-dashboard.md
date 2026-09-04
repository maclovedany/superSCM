# 화면별 인터랙티브 차트 — Plan A (바탕 · 뷰 · 대시보드) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 차트 공통 바탕과 집계 뷰 10개를 만들고, 대시보드에 6종 차트를 넣습니다. Plan B(분석·예측 6화면) · Plan C(운영 8화면)는 여기서 만든 바탕과 뷰 위에 얹습니다.

**Architecture:** 차트는 화면별 맞춤 컴포넌트(`components/chart/<화면>-<차트>.tsx`, `'use client'`)이고, 공통은 `components/chart/_base/`(툴팁 · 프레임 · 범례 토글 · 브러시 props)와 `lib/chart-format.ts`(축 포맷) 뿐입니다. 집계는 SQL 뷰(`sql/31-chart-views.sql`)가 내고, `lib/chart-model.ts` 순수 함수가 모양만 바꿉니다. 서버 컴포넌트(page.tsx)가 조회하고 href 를 만들어 넘기며, 차트는 `router.push` 만 합니다.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · recharts 3.10.1 · Supabase PostgREST · node:test

**Spec:** `docs/superpowers/specs/2026-09-04-screen-charts-design.md`

## Global Constraints

- recharts 는 `components/chart/` 안에서만 import 합니다 (AGENTS.md 규칙 11).
- 차트 컴포넌트 안에서 계산하지 않습니다. 합계 · 평균 · 순위는 SQL 뷰가 냅니다 (AGENTS.md 규칙 2 · 79행).
- null 은 0 으로 그리지 않습니다. `connectNulls={false}` · 빈 값은 `EmptyValue` (design.md ④).
- 색만으로 구분하지 않습니다. 툴팁과 범례에 글자를 둡니다 (design.md §7.4). 원형 · 3D 없음.
- 순수 CSS + 토큰만. Tailwind 없음. 색 · 글꼴을 컴포넌트에 직접 쓰지 않습니다 (design.md).
- 모든 PostgREST 조회에 `.limit()` 을 적습니다 (1,000행 상한).
- `'use client'` 파일은 서버 전용 모듈(`lib/supabase/server`, `lib/dashboard` 등)을 import 하지 않습니다 (error.md #23). 타입은 `*-model.ts` 에서 가져옵니다.
- 상대 import 를 쓰는 순수 파일은 `.ts` 확장자를 붙입니다 (`node --test` 가 직접 읽습니다, error.md #17).
- 테스트는 `npm test` = `node --test "lib/**/*.test.ts"`. `lib/` 아래 순수 함수만 테스트할 수 있습니다.
- 커밋 메시지는 한국어, 끝에 아래 두 줄을 붙입니다.
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WDvCRXfUiCFUfhDw46Wxd6
  ```

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/chart-colors.ts` (수정) | `STATUS_COLORS` 추가 |
| `lib/chart-format.ts` (신규) | 축 · 툴팁 포맷터 순수 함수 |
| `lib/chart-format.test.ts` (신규) | 위 테스트 |
| `components/chart/_base/tooltip.tsx` (신규) | 공통 툴팁 |
| `components/chart/_base/use-series-toggle.ts` (신규) | 범례 토글 훅 |
| `components/chart/_base/period-brush.ts` (신규) | 브러시 props (점 8개 미만이면 null) |
| `components/chart/_base/click.ts` (신규) | recharts onClick 인자에서 행 꺼내기 |
| `components/chart/_base/chart-frame.tsx` (신규) | 제목 · 설명 · 빈/오류/가림 상태 껍데기 |
| `styles/chart.css` (수정) | `.grid-charts` · `.chart-card` |
| `sql/31-chart-views.sql` (신규) | 집계 뷰 10개 |
| `sql/29-sales-column-guard.sql` (수정) | 새 뷰 가림 3건 |
| `sql/README.md` · `scripts/sql-verify/run.sh` · `step.md` (수정) | 순서 · 안내 |
| `lib/chart-model.ts` (신규) | 뷰 행 → 차트 데이터 정규화 순수 함수 |
| `lib/chart-model.test.ts` (신규) | 위 테스트 |
| `lib/charts.ts` (신규) | 서버 전용 조회 함수 4개 |
| `components/chart/dashboard-demand-trend.tsx` 등 6개 (신규) | 대시보드 차트 |
| `app/(user)/dashboard/page.tsx` (수정) | 차트 띠 3×2 |
| `AGENTS.md` (수정) | 규칙 11 의 차트 목록 |

---

### Task 1: 포맷터와 상태색

**Files:**
- Modify: `lib/chart-colors.ts`
- Create: `lib/chart-format.ts`
- Test: `lib/chart-format.test.ts`

**Interfaces:**
- Produces: `STATUS_COLORS: { CRITICAL, WARNING, SAFE, INFO, UNKNOWN }` (hex 문자열), `monthTick(period: string): string`, `qtyTick(value: number): string`, `moneyTick(value: number): string`, `pctTick(value: number): string`, `formatValue(value: number | null, kind: ValueKind): string`, `type ValueKind = 'qty' | 'money' | 'pct' | 'count'`.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/chart-format.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatValue, moneyTick, monthTick, pctTick, qtyTick } from './chart-format.ts';

test('monthTick — YYYY-MM-DD 와 YYYY-MM 을 YY.MM 으로', () => {
  assert.equal(monthTick('2026-03-01'), '26.03');
  assert.equal(monthTick('2026-11'), '26.11');
  assert.equal(monthTick(''), '');
});

test('qtyTick — 천 · 만 · 억 단위로 줄인다', () => {
  assert.equal(qtyTick(0), '0');
  assert.equal(qtyTick(850), '850');
  assert.equal(qtyTick(1200), '1.2천');
  assert.equal(qtyTick(15000), '1.5만');
  assert.equal(qtyTick(230000000), '2.3억');
  assert.equal(qtyTick(-1200), '-1.2천');
});

test('moneyTick — 만원 · 억원', () => {
  assert.equal(moneyTick(9000), '9,000원');
  assert.equal(moneyTick(120000), '12만원');
  assert.equal(moneyTick(350000000), '3.5억원');
});

test('pctTick — 비율 0~1 을 퍼센트로', () => {
  assert.equal(pctTick(0.123), '12.3%');
  assert.equal(pctTick(1), '100%');
  assert.equal(pctTick(-0.05), '-5%');
});

test('formatValue — null 은 — 로, 종류별 전체 표기', () => {
  assert.equal(formatValue(null, 'qty'), '—');
  assert.equal(formatValue(1234.5, 'qty'), '1,234.5');
  assert.equal(formatValue(1234567, 'money'), '1,234,567원');
  assert.equal(formatValue(0.4567, 'pct'), '45.7%');
  assert.equal(formatValue(12, 'count'), '12건');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test lib/chart-format.test.ts`
Expected: FAIL — `Cannot find module './chart-format.ts'`

- [ ] **Step 3: 구현**

`lib/chart-format.ts`:

```ts
// 차트 축 · 툴팁 포맷 — design.md §7
//
// 순수 함수만 둡니다. 화면 값의 단위와 자릿수를 여기서 한 번만 정합니다.
// 축 눈금(tick)은 짧게, 툴팁(formatValue)은 전체 표기입니다.

export type ValueKind = 'qty' | 'money' | 'pct' | 'count';

/** '2026-03-01' · '2026-03' → '26.03'. 알 수 없는 모양은 그대로 돌려줍니다 */
export function monthTick(period: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(period);
  if (!m) return period;
  return `${m[1].slice(2)}.${m[2]}`;
}

function trimZero(value: number, digits: number): string {
  const s = value.toFixed(digits);
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** 수량 눈금. 850 · 1.2천 · 1.5만 · 2.3억 */
export function qtyTick(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${sign}${trimZero(abs / 1e8, 1)}억`;
  if (abs >= 1e4) return `${sign}${trimZero(abs / 1e4, 1)}만`;
  if (abs >= 1e3) return `${sign}${trimZero(abs / 1e3, 1)}천`;
  return `${sign}${abs.toLocaleString()}`;
}

/** 금액 눈금. 9,000원 · 12만원 · 3.5억원 */
export function moneyTick(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${sign}${trimZero(abs / 1e8, 1)}억원`;
  if (abs >= 1e4) return `${sign}${trimZero(abs / 1e4, 1)}만원`;
  return `${sign}${Math.round(abs).toLocaleString()}원`;
}

/** 비율(0~1) → 퍼센트. 소수 한 자리, 끝 0 은 뗍니다 */
export function pctTick(value: number): string {
  return `${trimZero(value * 100, 1)}%`;
}

/** 툴팁용 전체 표기. null 은 — (0 이 아닙니다, design.md ④) */
export function formatValue(value: number | null, kind: ValueKind): string {
  if (value === null || Number.isNaN(value)) return '—';
  switch (kind) {
    case 'qty':
      return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    case 'money':
      return `${Math.round(value).toLocaleString()}원`;
    case 'pct':
      return pctTick(value);
    case 'count':
      return `${value.toLocaleString()}건`;
  }
}
```

`lib/chart-colors.ts` 끝에 추가:

```ts
/**
 * 상태색 — app/globals.css 의 --crit · --warn · --info 와 같은 값입니다.
 * recharts 는 CSS 변수를 읽지 못해 값을 복제합니다. globals.css 를 바꾸면 여기도 바꾸세요.
 * 색만으로 구분하지 않습니다 — 툴팁과 범례에 상태 글자를 함께 둡니다 (design.md §7.4).
 */
export const STATUS_COLORS = {
  CRITICAL: '#dc2626',
  WARNING: '#f59e0b',
  SAFE: '#16a34a',
  INFO: '#2563eb',
  UNKNOWN: '#a1a1aa',
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;
```

- [ ] **Step 4: 통과 확인**

Run: `node --test lib/chart-format.test.ts`
Expected: 5 pass

- [ ] **Step 5: 커밋**

```bash
git add lib/chart-format.ts lib/chart-format.test.ts lib/chart-colors.ts
git commit -m "차트 바탕 — 축·툴팁 포맷터와 상태색 (lib/chart-format.ts)"
```

---

### Task 2: 공통 껍데기 — 툴팁 · 범례 토글 · 브러시 · 프레임 · CSS

**Files:**
- Create: `components/chart/_base/tooltip.tsx`
- Create: `components/chart/_base/use-series-toggle.ts`
- Create: `components/chart/_base/period-brush.ts`
- Create: `components/chart/_base/click.ts`
- Create: `components/chart/_base/chart-frame.tsx`
- Modify: `styles/chart.css` (끝에 추가)

**Interfaces:**
- Consumes: `formatValue` (Task 1), `EmptyState` · `ErrorState` (`components/ui/state.tsx`), `CHART_TOKENS` (`lib/chart-colors.ts`).
- Produces:
  - `ChartTooltip({ title, rows, note }: { title: string; rows: TooltipRow[]; note?: string })`, `type TooltipRow = { name: string; value: string; color?: string }`
  - `useSeriesToggle(ids: string[]): { hidden: Set<string>; toggle(id: string): void; visible(id: string): boolean }`
  - `clickedPayload<T>(entry: unknown): T | null` — recharts 막대 · 점 onClick 의 첫 인자에서 행 데이터를 꺼냅니다
  - `BRUSH_MIN_POINTS = 8`, `brushProps(count: number): { dataKey: 'period'; height: 22; travellerWidth: 8; stroke: string; fill: string } | null`
  - `ChartFrame({ title, desc, error, empty, masked, actions, children })`

- [ ] **Step 1: 툴팁**

`components/chart/_base/tooltip.tsx`:

```tsx
'use client';

// 공통 툴팁 — design.md §7.4 "색만으로 구분하지 않는다"
// 이름 · 값 · (있으면) 상태 글자를 한 줄씩 보여 줍니다. 값은 이미 포맷된 문자열로 받습니다.

export type TooltipRow = { name: string; value: string; color?: string };

export default function ChartTooltip({
  title,
  rows,
  note,
}: {
  title: string;
  rows: TooltipRow[];
  note?: string;
}) {
  return (
    <div className="chart-annotation" style={{ borderRadius: 'var(--r-md)' }}>
      <div style={{ marginBottom: 4, color: 'var(--text-3)' }}>{title}</div>
      {rows.map((row) => (
        <div
          key={row.name}
          style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {row.color && <span className="chart-legend-swatch" style={{ background: row.color }} />}
            {row.name}
          </span>
          <b>{row.value}</b>
        </div>
      ))}
      {note && <div style={{ marginTop: 4, color: 'var(--text-3)' }}>{note}</div>}
    </div>
  );
}
```

- [ ] **Step 2: 범례 토글 훅**

`components/chart/_base/use-series-toggle.ts`:

```ts
'use client';

import { useCallback, useState } from 'react';

/** 범례 칩을 눌러 시리즈를 숨깁니다. 재조회하지 않습니다 (renew.prd 16.5) */
export function useSeriesToggle(_ids: string[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const visible = useCallback((id: string) => !hidden.has(id), [hidden]);
  return { hidden, toggle, visible };
}
```

- [ ] **Step 3: 브러시 props**

`components/chart/_base/period-brush.ts`:

```ts
// 기간 브러시 — 시계열 차트 아래에 붙는 구간 선택.
//
// recharts 는 <Brush> 가 차트의 직접 자식이어야 알아봅니다. 감싼 컴포넌트는 무시되므로
// 여기서는 props 만 만들고, 각 차트가 `<Brush {...props} />` 를 직접 씁니다.
// 점이 8개 미만이면 브러시가 오히려 방해라 null 을 돌려줍니다 (spec §5).

import { CHART_TOKENS } from '@/lib/chart-colors';

export const BRUSH_MIN_POINTS = 8;

export function brushProps(count: number) {
  if (count < BRUSH_MIN_POINTS) return null;
  return {
    dataKey: 'period' as const,
    height: 22,
    travellerWidth: 8,
    stroke: CHART_TOKENS.axis,
    fill: 'rgba(0,0,0,0.02)',
  };
}
```

- [ ] **Step 4: 클릭 헬퍼**

`components/chart/_base/click.ts`:

```ts
// recharts 3 의 Bar · Scatter onClick 첫 인자는 버전에 따라 행 데이터 자체이거나
// { payload: 행 } 입니다. 어느 쪽이든 행을 돌려줍니다.
export function clickedPayload<T>(entry: unknown): T | null {
  if (!entry || typeof entry !== 'object') return null;
  const wrapped = entry as { payload?: T };
  return wrapped.payload ?? (entry as T);
}
```

- [ ] **Step 5: 프레임**

`components/chart/_base/chart-frame.tsx` (서버 컴포넌트, `'use client'` 없음):

```tsx
// 차트 껍데기 — 제목 · 설명 · 상태 (spec §2 · §6)
//
// 조회 실패는 ErrorState, 행 없음은 EmptyState, 영업 가림은 문구입니다.
// 차트 하나가 실패해도 옆 차트와 표는 그려집니다 — 상태를 여기서 가둡니다.

import type { ReactNode } from 'react';
import { EmptyState, ErrorState } from '@/components/ui/state';

export default function ChartFrame({
  title,
  desc,
  error = null,
  empty = null,
  masked = false,
  actions,
  children,
}: {
  title: string;
  /** 무엇을 보는 차트인지 한 줄. 툴팁이 아니라 항상 보입니다 */
  desc?: string;
  /** 조회 오류 문구. 있으면 차트 대신 ErrorState */
  error?: string | null;
  /** 행이 없을 때 제목. 있으면 차트 대신 EmptyState */
  empty?: string | null;
  /** 영업 권한으로 값이 가려진 차트 (renew.prd 4.5) */
  masked?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel chart-card">
      <header className="panel-head">
        <div>
          <h2 className="t-h2">{title}</h2>
          {desc && <p className="chart-card-desc">{desc}</p>}
        </div>
        {actions && <div className="panel-head-actions">{actions}</div>}
      </header>
      <div className="panel-body">
        {error !== null ? (
          <ErrorState detail={error} />
        ) : masked ? (
          <div className="state">
            <p className="state-title">영업 권한에서 볼 수 없습니다</p>
            <p className="state-desc">renew.prd 4.5 — 이 값은 영업 부서에 열리지 않습니다.</p>
          </div>
        ) : empty !== null ? (
          <EmptyState title={empty} />
        ) : (
          children
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: CSS**

`styles/chart.css` 끝에 추가:

```css
/* ── 차트 띠 — spec §2. 기본 2열, data-cols="3" 이면 3열, 좁으면 1열 ── */
.grid-charts {
  display: grid;
  gap: var(--s-4);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.grid-charts[data-cols="3"] {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 1159px) {
  .grid-charts[data-cols="3"] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 899px) {
  .grid-charts,
  .grid-charts[data-cols="3"] {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* 차트 카드. 높이는 각 차트가 정합니다 (기본 240px) */
.chart-card .panel-body {
  min-height: 240px;
}
.chart-card .chart-wrap {
  min-height: 0;
}
.chart-card-desc {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--text-3);
}
/* 막대 · 점을 누르면 이동하는 차트 */
.chart-clickable .recharts-bar-rectangle,
.chart-clickable .recharts-scatter-symbol {
  cursor: pointer;
}
```

- [ ] **Step 7: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add components/chart/_base styles/chart.css
git commit -m "차트 바탕 — 툴팁·범례 토글·브러시·프레임 (components/chart/_base)"
```

---

### Task 3: 집계 뷰 — `sql/31-chart-views.sql` · 가림막 · 순서

**Files:**
- Create: `sql/31-chart-views.sql`
- Modify: `sql/29-sales-column-guard.sql` (§4 블록 뒤)
- Modify: `scripts/sql-verify/run.sh:85-113` 과 `:120-131` (두 목록)
- Modify: `sql/README.md:34` 앞에 행 추가
- Modify: `step.md` 0.1-c 뒤

**Interfaces:**
- Produces: `analytics.v_chart_demand_trend(period date, kind text, qty numeric, n_items int)`, `v_chart_recommendation_by_supplier(supplier_id, supplier_name, n_items, n_urgent, total_qty, total_amount, n_missing_price)`, `v_chart_alert_by_type(type, type_label, severity, n_open, n_unacknowledged)`, `v_chart_alert_daily(day, n_detected, n_resolved)`, `v_chart_approval_monthly(month, decision, n)` (decision ∈ APPROVED · ADJUSTED · REJECTED · DEFERRED), `v_chart_champion_share(model_id, model_name, n_items, n_manual, avg_wape)`, `v_chart_order_calendar(week_start, n_items, n_urgent, total_qty, total_amount)`, `v_chart_projection_total(period, total_closing, total_receipt, total_demand, n_stockout_items, n_items)`, `v_chart_usage_heatmap(item_id, item_name, period, qty)`, `v_chart_sales_status(status, n_items)`.

- [ ] **Step 1: 뷰 파일 작성**

`sql/31-chart-views.sql`:

```sql
-- ★ 영업 가림막 — v_chart_recommendation_by_supplier · v_chart_order_calendar · v_chart_champion_share 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- 차트 집계 뷰 — docs/superpowers/specs/2026-09-04-screen-charts-design.md §3.2
--
-- ★ 이 파일은 새 계산을 하지 않습니다. 앞 파일이 만든 뷰를 기간 · 공급처 · 유형으로
--   묶어 합계와 건수를 낼 뿐입니다. 표와 차트가 같은 숫자를 말하도록 화면은 계산하지 않고
--   여기서만 냅니다 (AGENTS.md 규칙 2).
--
-- 여기서 만드는 것 (전부 analytics)
--   v_chart_demand_trend                 기간별 실적 · Consensus 합계 (대시보드 ①)
--   v_chart_recommendation_by_supplier   공급처별 추천 건수 · 수량 · 금액 (대시보드 ③ · 발주 추천)
--   v_chart_alert_by_type                열린 알림 유형 × 심각도 (대시보드 ⑤ · 알림)
--   v_chart_alert_daily                  최근 30일 일별 발생 · 해결 (알림)
--   v_chart_approval_monthly             최근 6개월 월별 결정 (대시보드 ⑥ · 결정 이력)
--   v_chart_champion_share               모델별 Champion 점유 (모델 평가)
--   v_chart_order_calendar               발주 권고일 주별 건수 · 금액 (발주 추천)
--   v_chart_projection_total             기간별 전체 재고 전개 합계 (재고 전개)
--   v_chart_usage_heatmap                품목 × 월 사용량 12개월, 상위 40품목 (수요 프로파일)
--   v_chart_sales_status                 판매 공급 상태별 품목 수 (판매)
--
-- ★ sql/23-atp-sales.sql 까지 먼저 실행하세요. 읽는 것은 전부 그 앞 파일들이 만듭니다.
--     analytics.v_dashboard_sparkline (21) · v_purchase_recommendation (16) · core.alert (20)
--     core.approval (19) · core.champion_model · core.model_config (13) · v_inventory_projection (15)
--     core.v_usage_monthly (17) · core.v_item_master (덤프) · v_sales_supply_status (23)
--
-- ★ 재실행해도 안전합니다. drop → create 순서입니다. 이 뷰 위에 뷰를 만드는 파일은 없으므로
--   혼자 다시 실행해도 됩니다. 다만 뒤에 29 → 28 을 이어서 실행하세요 (가림막 · 권한).
-- ★ 앞 파일(15 · 16 · 19 · 20 · 21 · 23)을 다시 실행하면 cascade 로 이 뷰들이 함께 지워집니다.
--   그때는 이 파일을 다시 실행하세요.
-- ──────────────────────────────────────────────────────────────


-- ══ 1. 정리 ════════════════════════════════════════════════════

drop view if exists analytics.v_chart_demand_trend               cascade;
drop view if exists analytics.v_chart_recommendation_by_supplier cascade;
drop view if exists analytics.v_chart_alert_by_type              cascade;
drop view if exists analytics.v_chart_alert_daily                cascade;
drop view if exists analytics.v_chart_approval_monthly           cascade;
drop view if exists analytics.v_chart_champion_share             cascade;
drop view if exists analytics.v_chart_order_calendar             cascade;
drop view if exists analytics.v_chart_projection_total           cascade;
drop view if exists analytics.v_chart_usage_heatmap              cascade;
drop view if exists analytics.v_chart_sales_status               cascade;


-- ══ 2. 수요 추이 — 대시보드 ① ═══════════════════════════════════
--
-- v_dashboard_sparkline 은 품목별 최근 12개월 실적 + 향후 3개월 Consensus 입니다.
-- 그것을 기간 · 종류로 합칩니다. n_items 는 그 기간에 값이 있는 품목 수입니다 —
-- 실적 12개월과 예측 3개월의 품목 수가 다르면 합계가 어긋나 보일 수 있어 함께 냅니다.

create view analytics.v_chart_demand_trend as
select s.period,
       s.kind,
       sum(s.qty)                                   as qty,
       count(*) filter (where s.qty is not null)::int as n_items
  from analytics.v_dashboard_sparkline s
 group by s.period, s.kind
 order by s.period, s.kind
 limit 100;


-- ══ 3. 공급처별 추천 — 대시보드 ③ · 발주 추천 ═══════════════════
--
-- 추천 수량이 0보다 큰 품목만 셉니다 (발주 우선순위 표와 같은 조건).
-- total_amount 는 단가가 있는 품목만 더합니다. 단가 없는 품목 수는 n_missing_price 로
-- 따로 냅니다 — "금액 0원" 과 "단가 없음" 은 다릅니다 (design.md §8.2).

create view analytics.v_chart_recommendation_by_supplier as
select r.supplier_id,
       max(r.supplier_name)                                              as supplier_name,
       count(*)::int                                                     as n_items,
       count(*) filter (where r.is_urgent = true)::int                   as n_urgent,
       sum(r.final_recommended_qty)                                      as total_qty,
       sum(r.recommended_amount) filter (where r.unit_price is not null) as total_amount,
       count(*) filter (where r.unit_price is null)::int                 as n_missing_price
  from analytics.v_purchase_recommendation r
 where r.final_recommended_qty > 0
 group by r.supplier_id
 order by total_amount desc nulls last, total_qty desc
 limit 50;


-- ══ 4. 알림 — 대시보드 ⑤ · 알림 ═══════════════════════════════

-- 열린 알림만. 유형 라벨은 core.alert_type_label() 한 곳에서 옵니다.
create view analytics.v_chart_alert_by_type as
select a.type,
       core.alert_type_label(a.type)                              as type_label,
       a.severity,
       count(*)::int                                              as n_open,
       count(*) filter (where a.acknowledged_at is null)::int     as n_unacknowledged
  from core.alert a
 where a.resolved_at is null
 group by a.type, a.severity
 order by a.type, a.severity
 limit 100;

-- 최근 30일. 알림이 없는 날도 0 으로 나와야 선이 끊기지 않으므로 날짜를 먼저 만듭니다.
-- 날짜는 한국 시간 기준입니다.
create view analytics.v_chart_alert_daily as
with days as (
  select generate_series(current_date - 29, current_date, interval '1 day')::date as day
)
select d.day,
       (select count(*) from core.alert a
         where (a.detected_at at time zone 'Asia/Seoul')::date = d.day)::int as n_detected,
       (select count(*) from core.alert a
         where a.resolved_at is not null
           and (a.resolved_at at time zone 'Asia/Seoul')::date = d.day)::int as n_resolved
  from days d
 order by d.day
 limit 31;


-- ══ 5. 월별 결정 — 대시보드 ⑥ · 결정 이력 ═════════════════════
--
-- 결정 넷 — APPROVED(추천대로) · ADJUSTED(승인이되 수량을 바꿈) · REJECTED · DEFERRED.
-- ADJUSTED 는 core.approval 의 decision 이 아니라 adjustment <> 0 인 승인입니다.
-- 결정이 없는 달도 0 으로 나오도록 달 × 결정을 먼저 만듭니다.

create view analytics.v_chart_approval_monthly as
with months as (
  select (date_trunc('month', current_date) - (interval '1 month' * g))::date as month
    from generate_series(0, 5) g
),
decisions as (
  select unnest(array['APPROVED', 'ADJUSTED', 'REJECTED', 'DEFERRED']) as decision
),
classified as (
  select date_trunc('month', a.approved_at at time zone 'Asia/Seoul')::date as month,
         case when a.decision = 'APPROVED' and coalesce(a.adjustment, 0) <> 0 then 'ADJUSTED'
              else a.decision end as decision
    from core.approval a
)
select m.month,
       d.decision,
       (select count(*) from classified c
         where c.month = m.month and c.decision = d.decision)::int as n
  from months m
 cross join decisions d
 order by m.month, d.decision
 limit 30;


-- ══ 6. 모델별 Champion 점유 — 모델 평가 ═══════════════════════

create view analytics.v_chart_champion_share as
select c.champion_model_id                                          as model_id,
       m.model_name,
       count(*)::int                                                as n_items,
       count(*) filter (where c.selection_method = 'MANUAL')::int   as n_manual,
       round(avg(c.wape), 4)                                        as avg_wape
  from core.champion_model c
  left join core.model_config m on m.model_id = c.champion_model_id
 where c.champion_model_id is not null
 group by c.champion_model_id, m.model_name
 order by n_items desc, c.champion_model_id
 limit 50;


-- ══ 7. 발주 권고일 캘린더 — 발주 추천 ═════════════════════════
--
-- 주 시작은 월요일입니다 (date_trunc('week')).

create view analytics.v_chart_order_calendar as
select date_trunc('week', r.required_order_date)::date                  as week_start,
       count(*)::int                                                     as n_items,
       count(*) filter (where r.is_urgent = true)::int                   as n_urgent,
       sum(r.final_recommended_qty)                                      as total_qty,
       sum(r.recommended_amount) filter (where r.unit_price is not null) as total_amount
  from analytics.v_purchase_recommendation r
 where r.required_order_date is not null
   and r.final_recommended_qty > 0
 group by 1
 order by 1
 limit 60;


-- ══ 8. 전체 재고 전개 합계 — 재고 전개 ════════════════════════

create view analytics.v_chart_projection_total as
select p.period,
       sum(p.closing_qty)                                   as total_closing,
       sum(p.receipt_qty)                                   as total_receipt,
       sum(p.demand_qty)                                    as total_demand,
       count(*) filter (where p.closing_qty < 0)::int       as n_stockout_items,
       count(distinct p.item_id)::int                       as n_items
  from analytics.v_inventory_projection p
 group by p.period
 order by p.period
 limit 60;


-- ══ 9. 품목 × 월 사용량 히트맵 — 수요 프로파일 ════════════════
--
-- 최근 12개월, 총량 상위 40품목. 40 × 12 = 480행이라 1,000행 상한 아래입니다.

create view analytics.v_chart_usage_heatmap as
with bound as (
  select max(u.period) as last_actual from core.v_usage_monthly u
),
top as (
  select u.item_id, sum(u.quantity) as total
    from core.v_usage_monthly u
   cross join bound b
   where u.period > (b.last_actual - interval '12 months')::date
   group by u.item_id
   order by total desc
   limit 40
)
select u.item_id,
       im.item_name,
       u.period,
       u.quantity as qty
  from core.v_usage_monthly u
  join top t on t.item_id = u.item_id
  cross join bound b
  left join core.v_item_master im on im.item_id = u.item_id
 where u.period > (b.last_actual - interval '12 months')::date
 order by u.item_id, u.period
 limit 600;


-- ══ 10. 판매 공급 상태 — 판매 ══════════════════════════════════

create view analytics.v_chart_sales_status as
select s.status,
       count(*)::int as n_items
  from analytics.v_sales_supply_status s
 group by s.status
 order by n_items desc, s.status
 limit 20;


-- ══ 11. 권한 ═══════════════════════════════════════════════════

do $$
declare v text;
begin
  foreach v in array array[
    'v_chart_demand_trend', 'v_chart_recommendation_by_supplier', 'v_chart_alert_by_type',
    'v_chart_alert_daily', 'v_chart_approval_monthly', 'v_chart_champion_share',
    'v_chart_order_calendar', 'v_chart_projection_total', 'v_chart_usage_heatmap',
    'v_chart_sales_status'
  ] loop
    execute format('grant select on analytics.%I to authenticated', v);
    execute format('revoke all on analytics.%I from anon', v);
  end loop;
end $$;


-- ══ 12. 확인 ═══════════════════════════════════════════════════
--
-- 행 수만 봅니다. 무거운 확인은 하네스에서 합니다 (error.md #28).

select 'demand_trend' as chart, count(*) from analytics.v_chart_demand_trend
union all select 'recommendation_by_supplier', count(*) from analytics.v_chart_recommendation_by_supplier
union all select 'alert_by_type',      count(*) from analytics.v_chart_alert_by_type
union all select 'alert_daily',        count(*) from analytics.v_chart_alert_daily
union all select 'approval_monthly',   count(*) from analytics.v_chart_approval_monthly
union all select 'champion_share',     count(*) from analytics.v_chart_champion_share
union all select 'order_calendar',     count(*) from analytics.v_chart_order_calendar
union all select 'projection_total',   count(*) from analytics.v_chart_projection_total
union all select 'usage_heatmap',      count(*) from analytics.v_chart_usage_heatmap
union all select 'sales_status',       count(*) from analytics.v_chart_sales_status;
```

- [ ] **Step 2: 가림막 추가**

`sql/29-sales-column-guard.sql` 의 §4 블록(`v_purchase_recommendation_kpi` 가림, 884~886행) 바로 뒤에:

```sql

-- 차트 집계 (sql/31). 공급처명과 금액은 §4 · §5 와 같은 이유로 가립니다.
-- n_missing_price 를 함께 가리는 이유는 위 v_purchase_recommendation_kpi 와 같습니다.
select core.__sales_guard('analytics', 'v_chart_recommendation_by_supplier', array[
  'supplier_name', 'total_amount', 'n_missing_price'
]);
select core.__sales_guard('analytics', 'v_chart_order_calendar', array['total_amount']);
```

§6(`v_backtest_kpi` 가림, 430행) 바로 뒤에:

```sql
select core.__sales_guard('analytics', 'v_chart_champion_share', array['avg_wape']);
```

- [ ] **Step 3: 하네스 · README · step.md 순서**

`scripts/sql-verify/run.sh` 의 `ALL_FILES=(` 목록(85~113행)에서 `27-admin-ops.sql` 다음, `29-sales-column-guard.sql` 앞에 `  31-chart-views.sql` 한 줄을 넣습니다. `ORDER=25first` 목록(120~131행)에서도 `27-admin-ops.sql` 뒤에 `31-chart-views.sql` 을 넣습니다.

`sql/README.md` 34행(`| 25 | 29-sales-column-guard.sql |`) 앞에 행을 넣고 뒤 번호를 하나씩 올립니다:

```
| 25 | `31-chart-views.sql` | 차트 집계 뷰 10개 — 기간 · 공급처 · 유형별 합계와 건수. 새 계산 없음. 앞 파일을 다시 실행했으면 이 파일도 다시 |
| 26 | `29-sales-column-guard.sql` | … (그대로) |
| 27 | `28-anon-lockdown.sql` | … (그대로) |
```

`step.md` 의 `### 0.1-c` 절 끝, `### 0.2` 앞에:

```markdown
### 0.1-d `sql/31` 이 생겼습니다 — 차트 집계 뷰 ★

화면별 차트가 읽는 집계 뷰 10개입니다. `sql/README.md` 순서대로 `31 → 29 → 28` 을 이어서 돌립니다.
`29` 는 `31` 의 뷰 세 개를 가리므로 **`31` 없이 `29` 를 돌리면 `v_chart_recommendation_by_supplier 에 없는 컬럼을 가리려 했습니다` 로 멈춥니다** (error.md #32 와 같은 원리).

```
31 → 29 → 28
```
```

- [ ] **Step 4: 하네스로 검증**

Run: `scripts/sql-verify/run.sh 31 29 28`
Expected: `pass 1 … 3 passed, 0 failed` · `pass 2 … 3 passed, 0 failed`. 실패하면 `scripts/sql-verify/logs/<timestamp>/` 의 해당 로그에서 `ERROR` 줄을 읽고 뷰 정의를 고칩니다.

그다음 전체: `scripts/sql-verify/run.sh`
Expected: 27 파일 전부 PASS, pass 3 15/15.

- [ ] **Step 5: 커밋**

```bash
git add sql/31-chart-views.sql sql/29-sales-column-guard.sql sql/README.md scripts/sql-verify/run.sh step.md
git commit -m "sql/31 — 차트 집계 뷰 10개 · sql/29 가림 3건 · 적용 순서 31 → 29 → 28"
```

---

### Task 4: 정규화 함수와 조회 함수

**Files:**
- Create: `lib/chart-model.ts`
- Test: `lib/chart-model.test.ts`
- Create: `lib/charts.ts`

**Interfaces:**
- Consumes: `num` · `text` · `count` (`lib/dashboard-model.ts`), `AccuracyRankingRow` (`lib/dashboard-model.ts`), `StockoutKpi` (`lib/scm-model.ts`), `createSupabaseServerClient` (`lib/supabase/server.ts`).
- Produces (`lib/chart-model.ts`):
  - `type DemandTrendPoint = { period: string; actual: number | null; forecast: number | null; nItems: number | null }`
  - `normalizeDemandTrend(rows: Record<string, unknown>[]): DemandTrendPoint[]` — ACTUAL/FORECAST 행을 기간별 한 행으로 피벗, 마지막 실적을 예측 시작점으로 공유(스파크라인과 같은 방식). period 는 `YYYY-MM`.
  - `type RiskMixSlice = { key: 'CRITICAL' | 'WARNING' | 'SAFE' | 'UNKNOWN'; label: string; n: number }`
  - `riskMixFromKpi(kpi: { criticalCount: number; warningCount: number; safeCount: number; unknownCount: number }): RiskMixSlice[]`
  - `type SupplierAmountRow = { supplierId: string; supplierName: string | null; nItems: number; nUrgent: number; totalQty: number | null; totalAmount: number | null; nMissingPrice: number | null }`
  - `normalizeSupplierAmount(row: Record<string, unknown>): SupplierAmountRow`
  - `type AlertTypeMixRow = { type: string; typeLabel: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; nOpen: number; nUnacknowledged: number }`
  - `normalizeAlertTypeMix(row): AlertTypeMixRow`
  - `type AlertTypeStack = { type: string; typeLabel: string; CRITICAL: number; WARNING: number; INFO: number; total: number }`
  - `pivotAlertTypeMix(rows: AlertTypeMixRow[]): AlertTypeStack[]` — 유형별 한 행, total 내림차순
  - `type ApprovalMonthlyRow = { month: string; decision: 'APPROVED' | 'ADJUSTED' | 'REJECTED' | 'DEFERRED'; n: number }`
  - `normalizeApprovalMonthly(row): ApprovalMonthlyRow`
  - `type ApprovalMonthStack = { month: string; APPROVED: number; ADJUSTED: number; REJECTED: number; DEFERRED: number }`
  - `pivotApprovalMonthly(rows: ApprovalMonthlyRow[]): ApprovalMonthStack[]` — 월 오름차순
  - `type AccuracyBar = { itemId: string; label: string; modelName: string | null; wape: number | null; side: 'best' | 'worst'; rank: number }`
  - `toAccuracyBars(rows: AccuracyRankingRow[]): AccuracyBar[]` — best(rankBest ≤ 5, rankBest 순) 다음 worst(rankWorst ≤ 5, rankWorst 순)
- Produces (`lib/charts.ts`, 서버 전용): `getDemandTrend()`, `getRecommendationBySupplier(limit = 8)`, `getAlertTypeMix()`, `getApprovalMonthly()` — 전부 `Promise<{ rows: T[]; error: string | null }>`.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/chart-model.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAlertTypeMix,
  normalizeApprovalMonthly,
  normalizeDemandTrend,
  normalizeSupplierAmount,
  pivotAlertTypeMix,
  pivotApprovalMonthly,
  riskMixFromKpi,
  toAccuracyBars,
} from './chart-model.ts';
import type { AccuracyRankingRow } from './dashboard-model.ts';

// 차트 정규화 — spec §3.4
// 여기서 지키는 것: ① 모양만 바꾼다(합계·평균 없음) ② null 은 null 로 남는다 ③ 실제 컬럼명을 쓴다

test('normalizeDemandTrend — 기간별 한 행으로 피벗하고 마지막 실적을 예측 시작점으로 공유한다', () => {
  const rows = normalizeDemandTrend([
    { period: '2026-01-01', kind: 'ACTUAL', qty: '100', n_items: 20 },
    { period: '2026-02-01', kind: 'ACTUAL', qty: '120', n_items: 20 },
    { period: '2026-03-01', kind: 'FORECAST', qty: '130', n_items: 19 },
    { period: '2026-04-01', kind: 'FORECAST', qty: null, n_items: 0 },
  ]);
  assert.deepEqual(rows.map((r) => r.period), ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.equal(rows[0].actual, 100);
  assert.equal(rows[0].forecast, null);
  // 마지막 실적(2월)을 예측 선의 시작점으로도 넣습니다 — 값을 지어내는 것이 아니라 한 점을 공유합니다
  assert.equal(rows[1].forecast, 120);
  assert.equal(rows[2].actual, null);
  assert.equal(rows[2].forecast, 130);
  assert.equal(rows[3].forecast, null);
  assert.equal(rows[2].nItems, 19);
});

test('normalizeDemandTrend — 빈 입력은 빈 배열', () => {
  assert.deepEqual(normalizeDemandTrend([]), []);
});

test('riskMixFromKpi — 네 상태를 순서대로, 라벨과 함께', () => {
  const mix = riskMixFromKpi({ criticalCount: 3, warningCount: 5, safeCount: 10, unknownCount: 2 });
  assert.deepEqual(mix.map((s) => s.key), ['CRITICAL', 'WARNING', 'SAFE', 'UNKNOWN']);
  assert.deepEqual(mix.map((s) => s.n), [3, 5, 10, 2]);
  assert.equal(mix[0].label, '위험');
  assert.equal(mix[3].label, '미판정');
});

test('normalizeSupplierAmount — 실제 컬럼명, 금액 null 은 null', () => {
  const row = normalizeSupplierAmount({
    supplier_id: 'SUP001', supplier_name: '도쿄공장', n_items: 4, n_urgent: 1,
    total_qty: '1200', total_amount: null, n_missing_price: 4,
  });
  assert.equal(row.supplierId, 'SUP001');
  assert.equal(row.supplierName, '도쿄공장');
  assert.equal(row.nItems, 4);
  assert.equal(row.nUrgent, 1);
  assert.equal(row.totalQty, 1200);
  assert.equal(row.totalAmount, null);
  assert.equal(row.nMissingPrice, 4);
});

test('pivotAlertTypeMix — 유형별 한 행, 심각도가 열, total 내림차순', () => {
  const rows = [
    { type: 'STOCKOUT', type_label: '결품 위험', severity: 'CRITICAL', n_open: 2, n_unacknowledged: 1 },
    { type: 'STOCKOUT', type_label: '결품 위험', severity: 'WARNING', n_open: 3, n_unacknowledged: 3 },
    { type: 'EXCESS_INVENTORY', type_label: '과잉 재고', severity: 'INFO', n_open: 7, n_unacknowledged: 0 },
  ].map(normalizeAlertTypeMix);
  const stacks = pivotAlertTypeMix(rows);
  assert.deepEqual(stacks.map((s) => s.type), ['EXCESS_INVENTORY', 'STOCKOUT']);
  assert.deepEqual(stacks[1], { type: 'STOCKOUT', typeLabel: '결품 위험', CRITICAL: 2, WARNING: 3, INFO: 0, total: 5 });
});

test('pivotApprovalMonthly — 월 오름차순, 결정 넷이 열', () => {
  const rows = [
    { month: '2026-08-01', decision: 'APPROVED', n: 4 },
    { month: '2026-08-01', decision: 'ADJUSTED', n: 1 },
    { month: '2026-08-01', decision: 'REJECTED', n: 0 },
    { month: '2026-08-01', decision: 'DEFERRED', n: 2 },
    { month: '2026-07-01', decision: 'APPROVED', n: 1 },
    { month: '2026-07-01', decision: 'ADJUSTED', n: 0 },
    { month: '2026-07-01', decision: 'REJECTED', n: 0 },
    { month: '2026-07-01', decision: 'DEFERRED', n: 0 },
  ].map(normalizeApprovalMonthly);
  const stacks = pivotApprovalMonthly(rows);
  assert.deepEqual(stacks.map((s) => s.month), ['2026-07', '2026-08']);
  assert.deepEqual(stacks[1], { month: '2026-08', APPROVED: 4, ADJUSTED: 1, REJECTED: 0, DEFERRED: 2 });
});

test('toAccuracyBars — 좋은 5 다음 나쁜 5, 순위대로, wape null 은 그대로', () => {
  const base: AccuracyRankingRow = {
    itemId: 'X', itemName: null, championModelId: 'MA3', modelName: 'MA3', wape: 0.1, bias: 0,
    selectionMethod: 'AUTO', rankBest: null, rankWorst: null, nRanked: 12, barPct: 10,
  };
  const rows: AccuracyRankingRow[] = [
    { ...base, itemId: 'B', itemName: '나', rankBest: 2, wape: 0.05 },
    { ...base, itemId: 'A', itemName: '가', rankBest: 1, wape: 0.04 },
    { ...base, itemId: 'Z', itemName: null, rankWorst: 1, wape: null },
    { ...base, itemId: 'Y', rankWorst: 2, wape: 0.6 },
  ];
  const bars = toAccuracyBars(rows);
  assert.deepEqual(bars.map((b) => `${b.side}:${b.itemId}:${b.rank}`), ['best:A:1', 'best:B:2', 'worst:Z:1', 'worst:Y:2']);
  assert.equal(bars[0].label, '가');
  assert.equal(bars[2].label, 'Z');
  assert.equal(bars[2].wape, null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test lib/chart-model.test.ts`
Expected: FAIL — `Cannot find module './chart-model.ts'`

- [ ] **Step 3: 구현**

`lib/chart-model.ts`:

```ts
// 차트 정규화 — spec §3.4
//
// 뷰 행 → 차트 데이터. 모양만 바꿉니다. 합계 · 평균 · 순위는 만들지 않습니다 —
// 그것은 sql/31-chart-views.sql 과 앞 파일의 뷰가 이미 냈습니다 (AGENTS.md 규칙 2).
// 이 파일은 순수합니다. 서버 전용 모듈을 import 하지 않아 클라이언트 차트도 타입을 가져갈 수 있습니다.

import { count, num, text, type AccuracyRankingRow } from './dashboard-model.ts';

// ── 대시보드 ① 수요 추이 ────────────────────────────────────────

export type DemandTrendPoint = {
  /** YYYY-MM */
  period: string;
  actual: number | null;
  forecast: number | null;
  nItems: number | null;
};

/**
 * ACTUAL / FORECAST 행을 기간별 한 행으로 피벗합니다.
 * ★ 마지막 실적 값을 예측 시리즈의 시작점으로도 넣습니다 (components/chart/sparkline.tsx 와 같은 이유).
 *   실선과 파선이 한 점을 공유해야 "예측이 다른 높이에서 갑자기 시작" 한 것처럼 보이지 않습니다.
 */
export function normalizeDemandTrend(rows: Record<string, unknown>[]): DemandTrendPoint[] {
  const byPeriod = new Map<string, DemandTrendPoint>();
  for (const row of rows) {
    const period = (text(row.period) ?? '').slice(0, 7);
    if (period === '') continue;
    let point = byPeriod.get(period);
    if (point === undefined) {
      point = { period, actual: null, forecast: null, nItems: null };
      byPeriod.set(period, point);
    }
    const qty = num(row.qty);
    if (text(row.kind) === 'ACTUAL') point.actual = qty;
    else point.forecast = qty;
    point.nItems = count(row.n_items) ?? point.nItems;
  }
  // target es5 라 Map 이터레이터 spread 는 TS2802 입니다 (error.md #21). Array.from 을 씁니다.
  const points = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
  const lastActual = points.reduce((found, p, i) => (p.actual === null ? found : i), -1);
  if (lastActual >= 0 && points[lastActual].forecast === null) {
    points[lastActual] = { ...points[lastActual], forecast: points[lastActual].actual };
  }
  return points;
}

// ── 대시보드 ② 결품 위험 분포 ──────────────────────────────────

export type RiskMixKey = 'CRITICAL' | 'WARNING' | 'SAFE' | 'UNKNOWN';
export type RiskMixSlice = { key: RiskMixKey; label: string; n: number };

export const RISK_MIX_LABEL: Record<RiskMixKey, string> = {
  CRITICAL: '위험',
  WARNING: '주의',
  SAFE: '안전',
  UNKNOWN: '미판정',
};

/** v_stockout_kpi 의 네 건수를 순서대로 놓습니다. 더하지 않습니다 */
export function riskMixFromKpi(kpi: {
  criticalCount: number;
  warningCount: number;
  safeCount: number;
  unknownCount: number;
}): RiskMixSlice[] {
  return [
    { key: 'CRITICAL', label: RISK_MIX_LABEL.CRITICAL, n: kpi.criticalCount },
    { key: 'WARNING', label: RISK_MIX_LABEL.WARNING, n: kpi.warningCount },
    { key: 'SAFE', label: RISK_MIX_LABEL.SAFE, n: kpi.safeCount },
    { key: 'UNKNOWN', label: RISK_MIX_LABEL.UNKNOWN, n: kpi.unknownCount },
  ];
}

// ── 대시보드 ③ 공급처별 추천 금액 ──────────────────────────────

export type SupplierAmountRow = {
  supplierId: string;
  supplierName: string | null;
  nItems: number;
  nUrgent: number;
  totalQty: number | null;
  /** 단가가 있는 품목만의 합. 없으면 null — 0원이 아닙니다 */
  totalAmount: number | null;
  nMissingPrice: number | null;
};

export function normalizeSupplierAmount(row: Record<string, unknown>): SupplierAmountRow {
  return {
    supplierId: text(row.supplier_id) ?? '',
    supplierName: text(row.supplier_name),
    nItems: count(row.n_items) ?? 0,
    nUrgent: count(row.n_urgent) ?? 0,
    totalQty: num(row.total_qty),
    totalAmount: num(row.total_amount),
    nMissingPrice: count(row.n_missing_price),
  };
}

// ── 대시보드 ⑤ 알림 유형 × 심각도 ─────────────────────────────

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type AlertTypeMixRow = {
  type: string;
  typeLabel: string;
  severity: AlertSeverity;
  nOpen: number;
  nUnacknowledged: number;
};

function toSeverity(value: unknown): AlertSeverity {
  return value === 'CRITICAL' || value === 'WARNING' ? value : 'INFO';
}

export function normalizeAlertTypeMix(row: Record<string, unknown>): AlertTypeMixRow {
  const type = text(row.type) ?? '';
  return {
    type,
    typeLabel: text(row.type_label) ?? type,
    severity: toSeverity(row.severity),
    nOpen: count(row.n_open) ?? 0,
    nUnacknowledged: count(row.n_unacknowledged) ?? 0,
  };
}

export type AlertTypeStack = {
  type: string;
  typeLabel: string;
  CRITICAL: number;
  WARNING: number;
  INFO: number;
  total: number;
};

/** 유형별 한 행. 심각도가 열이 됩니다. total 은 뷰가 준 건수를 옮겨 담은 것입니다 */
export function pivotAlertTypeMix(rows: AlertTypeMixRow[]): AlertTypeStack[] {
  const byType = new Map<string, AlertTypeStack>();
  for (const row of rows) {
    let stack = byType.get(row.type);
    if (stack === undefined) {
      stack = { type: row.type, typeLabel: row.typeLabel, CRITICAL: 0, WARNING: 0, INFO: 0, total: 0 };
      byType.set(row.type, stack);
    }
    stack[row.severity] = row.nOpen;
    stack.total = stack.CRITICAL + stack.WARNING + stack.INFO;
  }
  return Array.from(byType.values()).sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
}

// ── 대시보드 ⑥ 월별 결정 ───────────────────────────────────────

export type ApprovalDecision = 'APPROVED' | 'ADJUSTED' | 'REJECTED' | 'DEFERRED';
export const APPROVAL_DECISIONS: ApprovalDecision[] = ['APPROVED', 'ADJUSTED', 'REJECTED', 'DEFERRED'];
export const APPROVAL_DECISION_LABEL: Record<ApprovalDecision, string> = {
  APPROVED: '추천대로 승인',
  ADJUSTED: '수량 조정 승인',
  REJECTED: '반려',
  DEFERRED: '보류',
};

export type ApprovalMonthlyRow = { month: string; decision: ApprovalDecision; n: number };

function toDecision(value: unknown): ApprovalDecision {
  return value === 'ADJUSTED' || value === 'REJECTED' || value === 'DEFERRED' ? value : 'APPROVED';
}

export function normalizeApprovalMonthly(row: Record<string, unknown>): ApprovalMonthlyRow {
  return {
    month: (text(row.month) ?? '').slice(0, 7),
    decision: toDecision(row.decision),
    n: count(row.n) ?? 0,
  };
}

export type ApprovalMonthStack = { month: string } & Record<ApprovalDecision, number>;

export function pivotApprovalMonthly(rows: ApprovalMonthlyRow[]): ApprovalMonthStack[] {
  const byMonth = new Map<string, ApprovalMonthStack>();
  for (const row of rows) {
    let stack = byMonth.get(row.month);
    if (stack === undefined) {
      stack = { month: row.month, APPROVED: 0, ADJUSTED: 0, REJECTED: 0, DEFERRED: 0 };
      byMonth.set(row.month, stack);
    }
    stack[row.decision] = row.n;
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ── 대시보드 ④ 정확도 랭킹 ─────────────────────────────────────

export type AccuracyBar = {
  itemId: string;
  label: string;
  modelName: string | null;
  wape: number | null;
  side: 'best' | 'worst';
  rank: number;
};

/** 뷰가 매긴 rank_best · rank_worst 로 양쪽 5개씩 고르기만 합니다 */
export function toAccuracyBars(rows: AccuracyRankingRow[]): AccuracyBar[] {
  const best = rows
    .filter((r) => r.rankBest !== null && r.rankBest <= 5)
    .sort((a, b) => (a.rankBest ?? 0) - (b.rankBest ?? 0))
    .map((r): AccuracyBar => ({
      itemId: r.itemId, label: r.itemName ?? r.itemId, modelName: r.modelName, wape: r.wape,
      side: 'best', rank: r.rankBest ?? 0,
    }));
  const worst = rows
    .filter((r) => r.rankWorst !== null && r.rankWorst <= 5)
    .sort((a, b) => (a.rankWorst ?? 0) - (b.rankWorst ?? 0))
    .map((r): AccuracyBar => ({
      itemId: r.itemId, label: r.itemName ?? r.itemId, modelName: r.modelName, wape: r.wape,
      side: 'worst', rank: r.rankWorst ?? 0,
    }));
  return [...best, ...worst];
}
```

`lib/charts.ts`:

```ts
// 차트 집계 조회 — sql/31-chart-views.sql
//
// ★ 클라이언트 컴포넌트는 이 파일을 import 하지 마세요. 서버 전용 Supabase 클라이언트가 따라 들어옵니다.
//   타입은 lib/chart-model.ts 에서 가져오세요.
// 모든 조회에 limit 을 적습니다 (PostgREST 1,000행 상한).

import { createSupabaseServerClient } from './supabase/server';
import {
  normalizeAlertTypeMix,
  normalizeApprovalMonthly,
  normalizeDemandTrend,
  normalizeSupplierAmount,
  type AlertTypeMixRow,
  type ApprovalMonthlyRow,
  type DemandTrendPoint,
  type SupplierAmountRow,
} from './chart-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/** 대시보드 ① — 기간별 실적 · Consensus 합계 (15행) */
export async function getDemandTrend(): Promise<{ rows: DemandTrendPoint[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_chart_demand_trend')
      .select('*')
      .order('period', { ascending: true })
      .limit(100);
    if (error) return { rows: [], error: error.message };
    return { rows: normalizeDemandTrend((data ?? []) as Record<string, unknown>[]), error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 대시보드 ③ · 발주 추천 — 공급처별 추천, 금액 내림차순 (뷰가 정렬) */
export async function getRecommendationBySupplier(
  limit = 8,
): Promise<{ rows: SupplierAmountRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_chart_recommendation_by_supplier')
      .select('*')
      .limit(limit);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeSupplierAmount(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 대시보드 ⑤ · 알림 — 열린 알림 유형 × 심각도 */
export async function getAlertTypeMix(): Promise<{ rows: AlertTypeMixRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_chart_alert_by_type')
      .select('*')
      .limit(100);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeAlertTypeMix(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** 대시보드 ⑥ · 결정 이력 — 최근 6개월 월별 결정 (달 × 결정 4 = 24행) */
export async function getApprovalMonthly(): Promise<{ rows: ApprovalMonthlyRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_chart_approval_monthly')
      .select('*')
      .order('month', { ascending: true })
      .limit(30);
    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeApprovalMonthly(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test lib/chart-model.test.ts && npx tsc --noEmit`
Expected: 7 pass, tsc 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add lib/chart-model.ts lib/chart-model.test.ts lib/charts.ts
git commit -m "차트 데이터 — 정규화 순수 함수와 집계 조회 (lib/chart-model.ts · lib/charts.ts)"
```

---

### Task 5: 대시보드 ① 수요 추이

**Files:**
- Create: `components/chart/dashboard-demand-trend.tsx`
- Modify: `app/(user)/dashboard/page.tsx` (import · 조회 · 차트 띠)

**Interfaces:**
- Consumes: `DemandTrendPoint` (`lib/chart-model`), `getDemandTrend` (`lib/charts`), `ChartTooltip` · `brushProps` · `ChartFrame` (Task 2), `monthTick` · `qtyTick` · `formatValue` (Task 1), `ACTUAL_COLOR` · `SERIES_COLORS` · `CHART_TOKENS` (`lib/chart-colors`).
- Produces: `DashboardDemandTrend({ data, height = 280 }: { data: DemandTrendPoint[]; height?: number })`.

- [ ] **Step 1: 차트 컴포넌트**

`components/chart/dashboard-demand-trend.tsx`:

```tsx
'use client';

// 대시보드 ① 수요 추이 — spec §4.1
// 최근 12개월 실적 합계(면적 + 잉크 블랙 실선)와 향후 3개월 Consensus(파란 파선).
// 여기서 계산하지 않습니다. 합계는 analytics.v_chart_demand_trend 가 냈습니다.

import { useMemo, useState } from 'react';
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ACTUAL_COLOR, CHART_TOKENS, SERIES_COLORS } from '@/lib/chart-colors';
import { formatValue, monthTick, qtyTick } from '@/lib/chart-format';
import type { DemandTrendPoint } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';
import { brushProps } from './_base/period-brush';

const FORECAST_COLOR = SERIES_COLORS[0];

export default function DashboardDemandTrend({
  data,
  height = 280,
}: {
  data: DemandTrendPoint[];
  height?: number;
}) {
  const [showActual, setShowActual] = useState(true);
  const [showForecast, setShowForecast] = useState(true);

  // 실적이 끝나는 기간. 여기서 예측이 시작되므로 세로 안내선을 긋습니다.
  const lastActual = useMemo(
    () => [...data].reverse().find((p) => p.actual !== null)?.period ?? null,
    [data],
  );
  const brush = brushProps(data.length);

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        <button type="button" className="chart-legend-item" aria-pressed={showActual} onClick={() => setShowActual((v) => !v)}>
          <span className="chart-legend-swatch" style={{ background: ACTUAL_COLOR }} />
          실적 합계
        </button>
        <button type="button" className="chart-legend-item" aria-pressed={showForecast} onClick={() => setShowForecast((v) => !v)}>
          <span className="chart-legend-swatch" style={{ background: FORECAST_COLOR }} />
          Consensus 예측
        </button>
      </div>
      <div className="chart-wrap" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="demandTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACTUAL_COLOR} stopOpacity={0.12} />
                <stop offset="100%" stopColor={ACTUAL_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="period" tickFormatter={monthTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} />
            <YAxis tickFormatter={qtyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
            {lastActual && (
              <ReferenceLine x={lastActual} stroke={CHART_TOKENS.markerLine} strokeDasharray="3 3" label={{ value: '예측 시작', fill: CHART_TOKENS.axis, fontSize: 11, position: 'insideTopRight' }} />
            )}
            {showActual && (
              <Area type="monotone" dataKey="actual" name="실적 합계" stroke={ACTUAL_COLOR} strokeWidth={2.5} fill="url(#demandTrendFill)" dot={false} isAnimationActive={false} connectNulls={false} />
            )}
            {showForecast && (
              <Line type="monotone" dataKey="forecast" name="Consensus 예측" stroke={FORECAST_COLOR} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls={false} />
            )}
            <Tooltip
              cursor={{ stroke: CHART_TOKENS.cursor, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload as DemandTrendPoint;
                return (
                  <ChartTooltip
                    title={String(label)}
                    rows={payload.map((entry) => ({
                      name: String(entry.name),
                      value: formatValue(typeof entry.value === 'number' ? entry.value : null, 'qty'),
                      color: String(entry.color),
                    }))}
                    note={point.nItems === null ? undefined : `품목 ${point.nItems}개 합계`}
                  />
                );
              }}
            />
            {brush && <Brush {...brush} tickFormatter={monthTick} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
```

- [ ] **Step 2: 페이지에 차트 띠 추가**

`app/(user)/dashboard/page.tsx`:

import 블록에 추가:

```ts
import ChartFrame from '@/components/chart/_base/chart-frame';
import DashboardDemandTrend from '@/components/chart/dashboard-demand-trend';
import { getDemandTrend } from '@/lib/charts';
```

`DashboardPage` 안 `Promise.all` 배열에 `getDemandTrend()` 를 끝에 추가하고 구조분해에 `demandTrend` 를 받습니다:

```ts
  const [kpiResult, priority, ranking, openPo, approvals, projection, alerts, demandTrend] =
    await Promise.all([
      getDashboardKpi(),
      getDashboardPurchasePriority(),
      getDashboardAccuracyRanking(),
      getDashboardOpenPoRisk(),
      getDashboardRecentApprovals(),
      getProjectionItems(),
      getAlerts(5),
      getDemandTrend(),
    ]);
```

KPI 그리드(`</div>` 로 닫히는 `grid grid-kpi` 블록, 즉 `)}` 로 끝나는 삼항) 바로 뒤, `<div className="grid grid-rail">` 앞에 차트 띠를 넣습니다. 이번 Task 에서는 ① 하나만 넣고, Task 6~10 이 한 칸씩 채웁니다:

```tsx
      {/* ── 차트 띠 — spec §4.1. 3×2. 각 차트는 자기 뷰의 숫자만 그립니다 ── */}
      <div className="grid-charts" data-cols="3">
        <ChartFrame
          title="수요 추이"
          desc="최근 12개월 실적 합계와 향후 3개월 Consensus 예측"
          error={demandTrend.error}
          empty={demandTrend.rows.length === 0 ? '실적이 아직 없습니다' : null}
        >
          <DashboardDemandTrend data={demandTrend.rows} />
        </ChartFrame>
      </div>
```

- [ ] **Step 3: 타입 · 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 오류 없음, 전부 pass (kpi-filter 테스트는 이 화면에 이미 `// kpi-filter: 없음 —` 주석이 있어 통과합니다)

- [ ] **Step 4: 화면 확인**

dev 서버(`npm run dev`, 3000 포트)에서 `/dashboard` 를 열어 KPI 아래에 수요 추이 차트가 나오는지, 범례 칩 토글과 브러시가 동작하는지 봅니다. 로그인 계정은 사용자에게 받습니다.

- [ ] **Step 5: 커밋**

```bash
git add components/chart/dashboard-demand-trend.tsx "app/(user)/dashboard/page.tsx"
git commit -m "대시보드 ① 수요 추이 차트 — 12개월 실적 + 3개월 Consensus, 브러시"
```

---

### Task 6: 대시보드 ② 결품 위험 분포

**Files:**
- Create: `components/chart/dashboard-risk-mix.tsx`
- Modify: `app/(user)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `riskMixFromKpi` · `RiskMixSlice` (`lib/chart-model`), `getStockoutKpi(): Promise<{ data: StockoutKpi | null; error: string | null }>` (`lib/scm.ts:23`), `STATUS_COLORS`.
- Produces: `DashboardRiskMix({ slices, hrefFor, height = 240 }: { slices: RiskMixSlice[]; hrefFor: (key: RiskMixKey) => string | null; height?: number })` — 가로 스택 막대 한 줄 + 아래 상태별 건수 칩. 클릭하면 `router.push(hrefFor(key))`.

- [ ] **Step 1: 차트 컴포넌트**

`components/chart/dashboard-risk-mix.tsx`:

```tsx
'use client';

// 대시보드 ② 결품 위험 분포 — spec §4.1
// 위험 · 주의 · 안전 · 미판정 네 건수를 가로 스택 막대 하나로. 원형 대신 막대입니다 (design.md §7.4).
// 건수는 analytics.v_stockout_kpi 가 냈습니다. 여기서 더하지 않습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { RiskMixKey, RiskMixSlice } from '@/lib/chart-model';
import ChartTooltip from './_base/tooltip';

export default function DashboardRiskMix({
  slices,
  hrefFor,
  height = 240,
}: {
  slices: RiskMixSlice[];
  /** 상태를 눌렀을 때 갈 곳. null 이면 누를 수 없습니다 */
  hrefFor: (key: RiskMixKey) => string | null;
  height?: number;
}) {
  const router = useRouter();
  // recharts 는 스택을 한 행의 여러 열로 그립니다. 네 조각을 한 행으로 옮겨 담습니다.
  const row: Record<string, number | string> = { name: '품목' };
  for (const slice of slices) row[slice.key] = slice.n;
  const total = slices.reduce((sum, s) => sum + s.n, 0);

  const go = (key: RiskMixKey) => {
    const href = hrefFor(key);
    if (href) router.push(href);
  };

  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <div className="chart-wrap chart-clickable" style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[row]} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barSize={36}>
            <XAxis type="number" hide domain={[0, Math.max(total, 1)]} />
            <YAxis type="category" dataKey="name" hide />
            {slices.map((slice) => (
              <Bar
                key={slice.key}
                dataKey={slice.key}
                name={slice.label}
                stackId="mix"
                fill={STATUS_COLORS[slice.key]}
                isAnimationActive={false}
                onClick={() => go(slice.key)}
                radius={0}
              />
            ))}
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                return (
                  <ChartTooltip
                    title={`전체 ${formatValue(total, 'count')}`}
                    rows={payload.map((entry) => ({
                      name: String(entry.name),
                      value: formatValue(typeof entry.value === 'number' ? entry.value : null, 'count'),
                      color: String(entry.color),
                    }))}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* 색만으로 읽지 않도록 상태 글자와 건수를 아래 칩으로 둡니다 */}
      <div className="chart-legend">
        {slices.map((slice) => {
          const href = hrefFor(slice.key);
          const inner = (
            <>
              <span className="chart-legend-swatch" style={{ background: STATUS_COLORS[slice.key] }} />
              {slice.label} <b>{slice.n}</b>
            </>
          );
          return href ? (
            <button key={slice.key} type="button" className="chart-legend-item" onClick={() => go(slice.key)}>
              {inner}
            </button>
          ) : (
            <span key={slice.key} className="chart-legend-item">{inner}</span>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 페이지**

import 추가:

```ts
import DashboardRiskMix from '@/components/chart/dashboard-risk-mix';
import { riskMixFromKpi, type RiskMixKey } from '@/lib/chart-model';
import { getStockoutKpi } from '@/lib/scm';
```

`Promise.all` 에 `getStockoutKpi()` 를 추가하고 `stockoutKpi` 로 받습니다. 차트 띠에 ① 다음으로:

```tsx
        <ChartFrame
          title="결품 위험 분포"
          desc="재고 전개 판정별 품목 수 · 누르면 그 판정만 봅니다"
          error={stockoutKpi.error}
          empty={stockoutKpi.data === null ? '판정된 품목이 없습니다' : null}
        >
          {stockoutKpi.data !== null && (
            <DashboardRiskMix
              slices={riskMixFromKpi(stockoutKpi.data)}
              hrefFor={riskHref}
            />
          )}
        </ChartFrame>
```

`DashboardPage` 바깥(모듈 수준)에 href 규칙을 둡니다. `/analysis/stockout` 의 FilterSpec 에 있는 키만 씁니다 — `risk`(위험+주의) 와 `critical`. 안전 · 미판정 필터는 그 화면에 없으므로 null:

```ts
/**
 * 결품 위험 분포에서 누른 판정 → /analysis/stockout 의 필터.
 * ★ 그 화면 FilterSpec 에 있는 키만 씁니다 (위 ?filter= 규칙). 없는 판정은 이동하지 않습니다.
 */
function riskHref(key: RiskMixKey): string | null {
  if (key === 'CRITICAL') return '/analysis/stockout?filter=critical';
  if (key === 'WARNING') return '/analysis/stockout?filter=risk';
  return null;
}
```

두 키 모두 `app/(user)/analysis/stockout/page.tsx:148` · `:154` 에 있습니다.

- [ ] **Step 3: 타입 · 테스트 · 화면**

Run: `npx tsc --noEmit && npm test` — 오류 없음. `/dashboard` 에서 막대 조각과 칩을 눌러 이동을 확인합니다.

- [ ] **Step 4: 커밋**

```bash
git add components/chart/dashboard-risk-mix.tsx "app/(user)/dashboard/page.tsx"
git commit -m "대시보드 ② 결품 위험 분포 — 상태별 스택 막대, 누르면 결품 위험 화면으로"
```

---

### Task 7: 대시보드 ③ 공급처별 추천 금액

**Files:**
- Create: `components/chart/dashboard-supplier-amount.tsx`
- Modify: `app/(user)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `SupplierAmountRow` (`lib/chart-model`), `getRecommendationBySupplier` (`lib/charts`), `moneyTick` · `formatValue`, `SERIES_COLORS` · `STATUS_COLORS` · `CHART_TOKENS`, `isSalesUser` (`lib/auth`).
- Produces: `DashboardSupplierAmount({ rows, hrefFor, height = 240 }: { rows: SupplierAmountRow[]; hrefFor: (supplierId: string) => string; height?: number })` — 가로 막대, 금액 내림차순(뷰 순서), 긴급 건수는 막대 끝 라벨.

- [ ] **Step 1: 차트 컴포넌트**

`components/chart/dashboard-supplier-amount.tsx`:

```tsx
'use client';

// 대시보드 ③ 공급처별 추천 금액 — spec §4.1
// 금액이 큰 공급처부터 가로 막대. 순서는 뷰(v_chart_recommendation_by_supplier)가 정했습니다.
// 금액이 null(단가 없음)인 공급처는 막대 대신 "단가 없음" 으로 표시합니다 — 0원이 아닙니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, moneyTick } from '@/lib/chart-format';
import type { SupplierAmountRow } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import ChartTooltip from './_base/tooltip';

export default function DashboardSupplierAmount({
  rows,
  hrefFor,
  height = 240,
}: {
  rows: SupplierAmountRow[];
  hrefFor: (supplierId: string) => string;
  height?: number;
}) {
  const router = useRouter();
  const data = rows.map((row) => ({
    ...row,
    label: row.supplierName ?? row.supplierId,
    // 단가 없는 공급처는 축에 0 으로 서지 않게 null 로 둡니다 (design.md ④)
    amount: row.totalAmount,
    tag: row.totalAmount === null ? '단가 없음' : row.nUrgent > 0 ? `긴급 ${row.nUrgent}` : '',
  }));

  return (
    <div className="chart-wrap chart-clickable" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 8 }} barCategoryGap={6}>
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tickFormatter={moneyTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Bar dataKey="amount" name="추천 금액" isAnimationActive={false} radius={[0, 4, 4, 0]} onClick={(entry) => { const row = clickedPayload<SupplierAmountRow>(entry); if (row) router.push(hrefFor(row.supplierId)); }}>
            {data.map((row) => (
              <Cell key={row.supplierId} fill={row.nUrgent > 0 ? STATUS_COLORS.CRITICAL : SERIES_COLORS[0]} />
            ))}
            <LabelList dataKey="tag" position="right" fill={CHART_TOKENS.axis} fontSize={11} />
          </Bar>
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as SupplierAmountRow & { label: string };
              return (
                <ChartTooltip
                  title={row.label}
                  rows={[
                    { name: '추천 금액', value: formatValue(row.totalAmount, 'money') },
                    { name: '추천 수량', value: formatValue(row.totalQty, 'qty') },
                    { name: '품목', value: formatValue(row.nItems, 'count') },
                    { name: '긴급', value: formatValue(row.nUrgent, 'count'), color: STATUS_COLORS.CRITICAL },
                  ]}
                  note={row.nMissingPrice ? `단가 없는 품목 ${row.nMissingPrice}개는 금액에 없습니다` : undefined}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: 페이지**

import 추가:

```ts
import DashboardSupplierAmount from '@/components/chart/dashboard-supplier-amount';
import { getRecommendationBySupplier } from '@/lib/charts';
import { isSalesUser } from '@/lib/auth';
```

`await requireUser();` 를 `const user = await requireUser();` 로 바꾸고, `Promise.all` 에 `getRecommendationBySupplier(8)` 를 추가해 `supplierAmount` 로 받습니다. 차트 띠에:

```tsx
        <ChartFrame
          title="공급처별 추천 금액"
          desc="추천 수량이 있는 품목의 금액 합계 · 상위 8 · 빨간 막대는 긴급 포함"
          error={supplierAmount.error}
          empty={supplierAmount.rows.length === 0 ? '추천 수량이 있는 품목이 없습니다' : null}
          masked={isSalesUser(user)}
        >
          <DashboardSupplierAmount
            rows={supplierAmount.rows}
            hrefFor={(supplierId) => `/purchase-recommendation?supplier=${encodeURIComponent(supplierId)}`}
          />
        </ChartFrame>
```

`/purchase-recommendation` 에 `?supplier=` 필터가 아직 없습니다. `app/(user)/purchase-recommendation/page.tsx` 에서 — 필터 정의는 그 화면 한 곳입니다:

89행 `const activeFilter = readFilter(await searchParams);` 를

```ts
  const params = await searchParams;
  const activeFilter = readFilter(params);
  // 대시보드 "공급처별 추천 금액" 막대가 이 파라미터로 들어옵니다. 카드 필터와 함께 걸립니다.
  const supplierParam = readFilter(params, 'supplier');
```

로 바꾸고, 295행 `const visible = applyFilter(rows, FILTERS, activeFilter);` 바로 뒤에

```ts
  const shown = supplierParam === null ? visible : visible.filter((row) => row.supplierId === supplierParam);
```

를 넣고, 425행 `rows={visible}` 을 `rows={shown}` 으로 바꿉니다. 그 `DataTable` 바로 위에 필터 안내를 둡니다:

```tsx
            {supplierParam !== null && (
              <p className="t-sm text-3" style={{ padding: 'var(--s-2) var(--s-4)' }}>
                공급처 <span className="t-code">{supplierParam}</span> 만 보는 중 · <Link href="/purchase-recommendation">전체</Link>
              </p>
            )}
```

`Link` 가 import 되어 있지 않으면 `import Link from 'next/link';` 를 더합니다.

- [ ] **Step 3: 타입 · 테스트 · 화면**

Run: `npx tsc --noEmit && npm test`. `/dashboard` 에서 막대를 눌러 `/purchase-recommendation?supplier=…` 로 가고 표가 그 공급처만 남는지 확인합니다.

- [ ] **Step 4: 커밋**

```bash
git add components/chart/dashboard-supplier-amount.tsx "app/(user)/dashboard/page.tsx" "app/(user)/purchase-recommendation/page.tsx"
git commit -m "대시보드 ③ 공급처별 추천 금액 — 가로 막대, 누르면 발주 추천 공급처 필터"
```

---

### Task 8: 대시보드 ④ 정확도 랭킹 (표 → 양방향 막대)

**Files:**
- Create: `components/chart/dashboard-accuracy-ranking.tsx`
- Modify: `app/(user)/dashboard/page.tsx` — `RankRow` 함수와 "예측 정확도 랭킹" 패널의 `grid grid-2` 블록을 차트로 대체

**Interfaces:**
- Consumes: `toAccuracyBars` · `AccuracyBar` (`lib/chart-model`), `pctTick` · `formatValue`, `STATUS_COLORS` · `CHART_TOKENS`.
- Produces: `DashboardAccuracyRanking({ bars, hrefFor, height = 240 })` — 가로 막대, 좋은 5 는 초록 위쪽, 나쁜 5 는 빨강 아래쪽, 사이에 구분선.

- [ ] **Step 1: 차트 컴포넌트**

`components/chart/dashboard-accuracy-ranking.tsx`:

```tsx
'use client';

// 대시보드 ④ 예측 정확도 랭킹 — spec §4.1
// 좋은 5(초록) 와 나쁜 5(빨강) 를 한 축에. WAPE 낮을수록 정확합니다.
// 순위는 뷰(v_dashboard_accuracy_ranking)가 매겼고, 여기서는 고르기만 합니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, pctTick } from '@/lib/chart-format';
import type { AccuracyBar } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import ChartTooltip from './_base/tooltip';

export default function DashboardAccuracyRanking({
  bars,
  hrefFor,
  height = 240,
}: {
  bars: AccuracyBar[];
  hrefFor: (itemId: string) => string;
  height?: number;
}) {
  const router = useRouter();
  const data = bars.map((bar) => ({ ...bar, key: `${bar.side}-${bar.itemId}` }));
  const bestList = data.filter((d) => d.side === 'best');
  const lastBest = bestList.length > 0 ? bestList[bestList.length - 1].key : null;

  return (
    <div className="chart-wrap chart-clickable" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 8 }} barCategoryGap={4}>
          <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" tickFormatter={pctTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
          {lastBest && <ReferenceLine y={lastBest} stroke={CHART_TOKENS.markerLine} strokeDasharray="3 3" position="end" />}
          <Bar dataKey="wape" name="WAPE" isAnimationActive={false} radius={[0, 4, 4, 0]} onClick={(entry) => { const bar = clickedPayload<AccuracyBar>(entry); if (bar) router.push(hrefFor(bar.itemId)); }}>
            {data.map((bar) => (
              <Cell key={bar.key} fill={bar.side === 'best' ? STATUS_COLORS.SAFE : STATUS_COLORS.CRITICAL} />
            ))}
          </Bar>
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const bar = payload[0].payload as AccuracyBar;
              return (
                <ChartTooltip
                  title={`${bar.label} · ${bar.side === 'best' ? '정확한' : '부정확한'} ${bar.rank}위`}
                  rows={[
                    { name: 'WAPE', value: formatValue(bar.wape, 'pct') },
                    { name: 'Champion', value: bar.modelName ?? '—' },
                  ]}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: 페이지**

import 추가:

```ts
import DashboardAccuracyRanking from '@/components/chart/dashboard-accuracy-ranking';
import { toAccuracyBars } from '@/lib/chart-model';
```

기존 "예측 정확도 랭킹" 패널(`<Panel title="예측 정확도 랭킹" …>` 전체)을 주 패널에서 **지우고**, 차트 띠에 넣습니다. `best` · `worst` 변수와 `RankRow` 함수도 지웁니다(`nRanked` · `rankingOverlap` 은 남깁니다):

```tsx
        <ChartFrame
          title="예측 정확도 랭킹"
          desc={`WAPE 낮을수록 정확 · 정확한 5 (초록) · 부정확한 5 (빨강)${rankingOverlap ? ` · Champion 이 ${nRanked}개라 양쪽에 같은 품목이 있습니다` : ''}`}
          error={ranking.error}
          empty={ranking.rows.length === 0 ? '정확도를 매길 품목이 없습니다' : null}
          masked={isSalesUser(user)}
        >
          <DashboardAccuracyRanking
            bars={toAccuracyBars(ranking.rows)}
            hrefFor={(itemId) => `/model-comparison?item=${encodeURIComponent(itemId)}`}
          />
        </ChartFrame>
```

`lib/dashboard.test.ts` 는 `RankRow` 를 검사하지 않으므로 테스트 수정은 없습니다.

- [ ] **Step 3: 타입 · 테스트 · 화면**

Run: `npx tsc --noEmit && npm test`. `/dashboard` 에서 막대를 눌러 `/model-comparison?item=…` 이 열리는지 확인합니다.

- [ ] **Step 4: 커밋**

```bash
git add components/chart/dashboard-accuracy-ranking.tsx "app/(user)/dashboard/page.tsx"
git commit -m "대시보드 ④ 정확도 랭킹 — 표를 양방향 막대로, 누르면 모델 비교로"
```

---

### Task 9: 대시보드 ⑤ 알림 유형 × 심각도

**Files:**
- Create: `components/chart/alerts-type-mix.tsx` (알림 화면과 공유 — Plan C 가 재사용)
- Modify: `app/(user)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `AlertTypeStack` · `pivotAlertTypeMix` (`lib/chart-model`), `getAlertTypeMix` (`lib/charts`), `STATUS_COLORS`.
- Produces: `AlertsTypeMix({ stacks, hrefFor, height = 240 }: { stacks: AlertTypeStack[]; hrefFor: (type: string) => string | null; height?: number })` — 유형이 세로축, 심각도 스택 가로 막대.

- [ ] **Step 1: 차트 컴포넌트**

`components/chart/alerts-type-mix.tsx`:

```tsx
'use client';

// 알림 유형 × 심각도 — spec §4.1 ⑤ · §4.3 (대시보드와 알림 화면이 함께 씁니다)
// 유형마다 심각도 셋을 쌓은 가로 막대. 건수는 v_chart_alert_by_type 이 냈습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue } from '@/lib/chart-format';
import type { AlertSeverity, AlertTypeStack } from '@/lib/chart-model';
import { clickedPayload } from './_base/click';
import { useSeriesToggle } from './_base/use-series-toggle';
import ChartTooltip from './_base/tooltip';

const SEVERITIES: { key: AlertSeverity; label: string; color: string }[] = [
  { key: 'CRITICAL', label: '위험', color: STATUS_COLORS.CRITICAL },
  { key: 'WARNING', label: '주의', color: STATUS_COLORS.WARNING },
  { key: 'INFO', label: '정보', color: STATUS_COLORS.INFO },
];

export default function AlertsTypeMix({
  stacks,
  hrefFor,
  height = 240,
}: {
  stacks: AlertTypeStack[];
  hrefFor: (type: string) => string | null;
  height?: number;
}) {
  const router = useRouter();
  const { toggle, visible } = useSeriesToggle(SEVERITIES.map((s) => s.key));

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        {SEVERITIES.map((s) => (
          <button key={s.key} type="button" className="chart-legend-item" aria-pressed={visible(s.key)} onClick={() => toggle(s.key)}>
            <span className="chart-legend-swatch" style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
      <div className="chart-wrap chart-clickable" style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stacks} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }} barCategoryGap={6}>
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="typeLabel" width={96} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} />
            {SEVERITIES.filter((s) => visible(s.key)).map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="sev"
                fill={s.color}
                isAnimationActive={false}
                onClick={(entry) => {
                  const stack = clickedPayload<AlertTypeStack>(entry);
                  const href = stack ? hrefFor(stack.type) : null;
                  if (href) router.push(href);
                }}
              />
            ))}
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const stack = payload[0].payload as AlertTypeStack;
                return (
                  <ChartTooltip
                    title={`${stack.typeLabel} · 열린 알림 ${formatValue(stack.total, 'count')}`}
                    rows={SEVERITIES.map((s) => ({ name: s.label, value: formatValue(stack[s.key], 'count'), color: s.color }))}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
```

- [ ] **Step 2: 페이지**

import 추가:

```ts
import AlertsTypeMix from '@/components/chart/alerts-type-mix';
import { pivotAlertTypeMix } from '@/lib/chart-model';
import { getAlertTypeMix } from '@/lib/charts';
```

`Promise.all` 에 `getAlertTypeMix()` 를 추가해 `alertMix` 로 받습니다. 차트 띠에:

```tsx
        <ChartFrame
          title="알림 유형별 현황"
          desc="열린 알림을 유형과 심각도로 · 범례를 눌러 심각도를 끄고 켭니다"
          error={alertMix.error}
          empty={alertMix.rows.length === 0 ? '열린 알림이 없습니다' : null}
        >
          <AlertsTypeMix stacks={pivotAlertTypeMix(alertMix.rows)} hrefFor={alertTypeHref} />
        </ChartFrame>
```

모듈 수준에 — `/alerts` 의 FilterSpec 에 유형 필터는 `excess`(EXCESS_INVENTORY) 하나뿐이므로 그것만 잇습니다:

```ts
/** 알림 유형 → /alerts 의 필터. 그 화면 FilterSpec 에 있는 유형 키만 씁니다 (지금은 excess 하나) */
function alertTypeHref(type: string): string | null {
  return type === 'EXCESS_INVENTORY' ? '/alerts?filter=excess' : '/alerts';
}
```

- [ ] **Step 3: 타입 · 테스트 · 화면**

Run: `npx tsc --noEmit && npm test`. `/dashboard` 에서 범례 토글이 스택을 빼고 넣는지, 막대를 누르면 `/alerts` 로 가는지 확인합니다.

- [ ] **Step 4: 커밋**

```bash
git add components/chart/alerts-type-mix.tsx "app/(user)/dashboard/page.tsx"
git commit -m "대시보드 ⑤ 알림 유형×심각도 스택 막대 (알림 화면과 공유)"
```

---

### Task 10: 대시보드 ⑥ 월별 결정 · 차트 띠 마무리 · 문서

**Files:**
- Create: `components/chart/decision-monthly.tsx` (결정 이력 화면과 공유 — Plan C 가 재사용)
- Modify: `app/(user)/dashboard/page.tsx`
- Modify: `AGENTS.md:214-221` (규칙 11 의 차트 목록)

**Interfaces:**
- Consumes: `ApprovalMonthStack` · `pivotApprovalMonthly` · `APPROVAL_DECISIONS` · `APPROVAL_DECISION_LABEL` (`lib/chart-model`), `getApprovalMonthly` (`lib/charts`), `SERIES_COLORS` · `STATUS_COLORS`.
- Produces: `DecisionMonthly({ stacks, href, height = 240 }: { stacks: ApprovalMonthStack[]; href: string | null; height?: number })` — 세로 스택 막대 6개월, 막대를 누르면 `href` 로.

- [ ] **Step 1: 차트 컴포넌트**

`components/chart/decision-monthly.tsx`:

```tsx
'use client';

// 월별 결정 건수 — spec §4.1 ⑥ · §4.3 (대시보드와 결정 이력 화면이 함께 씁니다)
// 최근 6개월, 결정 넷을 쌓은 세로 막대. 건수는 v_chart_approval_monthly 가 냈습니다.

import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_TOKENS, SERIES_COLORS, STATUS_COLORS } from '@/lib/chart-colors';
import { formatValue, monthTick } from '@/lib/chart-format';
import { APPROVAL_DECISIONS, APPROVAL_DECISION_LABEL, type ApprovalDecision, type ApprovalMonthStack } from '@/lib/chart-model';
import { useSeriesToggle } from './_base/use-series-toggle';
import ChartTooltip from './_base/tooltip';

const DECISION_COLOR: Record<ApprovalDecision, string> = {
  APPROVED: STATUS_COLORS.SAFE,
  ADJUSTED: SERIES_COLORS[0],
  REJECTED: STATUS_COLORS.CRITICAL,
  DEFERRED: STATUS_COLORS.UNKNOWN,
};

export default function DecisionMonthly({
  stacks,
  href,
  height = 240,
}: {
  stacks: ApprovalMonthStack[];
  href: string | null;
  height?: number;
}) {
  const router = useRouter();
  const { toggle, visible } = useSeriesToggle(APPROVAL_DECISIONS);

  return (
    <>
      <div className="chart-legend" style={{ marginBottom: 'var(--s-3)' }}>
        {APPROVAL_DECISIONS.map((d) => (
          <button key={d} type="button" className="chart-legend-item" aria-pressed={visible(d)} onClick={() => toggle(d)}>
            <span className="chart-legend-swatch" style={{ background: DECISION_COLOR[d] }} />
            {APPROVAL_DECISION_LABEL[d]}
          </button>
        ))}
      </div>
      <div className={`chart-wrap${href ? ' chart-clickable' : ''}`} style={{ height: height - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stacks} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid stroke={CHART_TOKENS.grid} strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthTick} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_TOKENS.grid }} />
            <YAxis allowDecimals={false} tick={{ fill: CHART_TOKENS.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
            {APPROVAL_DECISIONS.filter(visible).map((d) => (
              <Bar key={d} dataKey={d} name={APPROVAL_DECISION_LABEL[d]} stackId="dec" fill={DECISION_COLOR[d]} isAnimationActive={false} onClick={() => href && router.push(href)} />
            ))}
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const stack = payload[0].payload as ApprovalMonthStack;
                return (
                  <ChartTooltip
                    title={monthTick(String(label))}
                    rows={APPROVAL_DECISIONS.map((d) => ({ name: APPROVAL_DECISION_LABEL[d], value: formatValue(stack[d], 'count'), color: DECISION_COLOR[d] }))}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
```

- [ ] **Step 2: 페이지**

import 추가:

```ts
import DecisionMonthly from '@/components/chart/decision-monthly';
import { pivotApprovalMonthly } from '@/lib/chart-model';
import { getApprovalMonthly } from '@/lib/charts';
```

`Promise.all` 에 `getApprovalMonthly()` 를 추가해 `approvalMonthly` 로 받습니다. 차트 띠 마지막에:

```tsx
        <ChartFrame
          title="월별 결정"
          desc="최근 6개월 발주 결정 건수 · 누르면 결정 이력으로"
          error={approvalMonthly.error}
          empty={approvalMonthly.rows.length === 0 ? '아직 내려진 결정이 없습니다' : null}
        >
          <DecisionMonthly stacks={pivotApprovalMonthly(approvalMonthly.rows)} href="/decision-history" />
        </ChartFrame>
```

파일 머리말 주석(`// kpi-filter: 없음 —` 위)에 한 줄을 더합니다:

```
// ★ 차트 띠 6종(spec §4.1)은 각자의 뷰 숫자만 그립니다. 표와 다른 값을 보이면 뷰가 다른 것이지 화면이 계산한 것이 아닙니다.
```

- [ ] **Step 3: AGENTS.md 규칙 11 갱신**

`AGENTS.md` 214~221행의 차트 목록을 다음으로 바꿉니다:

```
components/chart/_base/           공통 — 툴팁 · 범례 토글 · 브러시 props · 프레임 (차트 없음)
components/chart/forecast-overlay-chart.tsx
components/chart/projection-chart.tsx
components/chart/comparison-chart.tsx
components/chart/sparkline.tsx
components/chart/<화면>-<차트>.tsx   화면별 맞춤 차트 (docs/superpowers/specs/2026-09-04-screen-charts-design.md §4)
lib/chart-colors.ts        시리즈 · 상태 색 고정 매핑
lib/chart-format.ts        축 · 툴팁 포맷
lib/chart-model.ts         뷰 행 → 차트 데이터 (모양만 바꿉니다)
lib/charts.ts              차트 집계 조회 (서버 전용)
```

- [ ] **Step 4: 전체 검증**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: 전부 통과. build 가 `'use client'` 파일의 서버 모듈 import 를 잡으면(error.md #23) 그 import 를 `lib/chart-model` 로 바꿉니다.

`/dashboard` 를 열어 3×2 차트 띠 6개가 KPI 아래에 나오고, 창을 1100px 이하로 줄이면 2열, 880px 이하에서 1열이 되는지 봅니다. 스크린샷을 남깁니다.

- [ ] **Step 5: 커밋**

```bash
git add components/chart/decision-monthly.tsx "app/(user)/dashboard/page.tsx" AGENTS.md
git commit -m "대시보드 ⑥ 월별 결정 스택 막대 · 차트 띠 3×2 완성 · AGENTS.md 규칙 11 갱신"
```

---

## 끝나면

- 사용자에게 SQL Editor 적용을 요청합니다: `31 → 29 → 28`.
- Plan B(`docs/superpowers/plans/2026-09-04-screen-charts-b-analysis.md`) 를 이 계획의 패턴(ChartFrame + `<화면>-<차트>.tsx` + `lib/charts.ts` 조회 + `lib/chart-model.ts` 정규화 + 테스트)으로 작성합니다.
