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
      return Number.isInteger(value)
        ? value.toLocaleString()
        : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    case 'money':
      return `${Math.round(value).toLocaleString()}원`;
    case 'pct':
      return pctTick(value);
    case 'count':
      return `${value.toLocaleString()}건`;
  }
}
