// KPI 카드 — design.md §6.4
//
// 값이 없으면 숫자를 지어내지 않고 EmptyValue 를 씁니다.
//
// ★ filter 를 주면 카드가 눌러집니다.
//   누르면 같은 화면의 목록이 그 카드의 데이터로 좁혀집니다 (design.md §6.4).
//   목록으로 좁힐 수 없는 카드(합계·기간 등)에는 filter 를 주지 않습니다.
//   누를 수 없는 카드를 누르게 만들면 더 나쁩니다.
//
// ★ href 를 주면 카드가 다른 화면으로 가는 링크가 됩니다 (renew.prd 28.1 의 대시보드).
//   대시보드는 자기 화면에 목록을 두지 않고 각 화면으로 보냅니다. 그 카드에는
//   좁힐 목록이 없으므로 filter 가 아니라 href 입니다.
//   filter 와 href 는 함께 쓸 수 없습니다 — 타입이 그것을 막습니다.
//   filter 는 "여기서 좁힌다"(선택 상태가 남습니다), href 는 "저기로 간다"(상태가 없습니다).

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import EmptyValue from './empty-value';
import { filterHref } from '@/lib/filter';
import type { ReasonCode } from '@/lib/status';

export type KpiTone = 'default' | 'warn' | 'crit';

export type KpiFilter = {
  /** lib/filter.ts 의 FilterSpec.key 와 같아야 합니다 */
  key: string;
  active: boolean;
  /** 쿼리 파라미터 이름. 한 화면에 필터가 둘 이상일 때만 바꿉니다 */
  param?: string;
};

type KpiCardBase = {
  label: string;
  /** null 이면 산출 불가로 표시됩니다 */
  value: string | number | null;
  unit?: string;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  foot?: string;
  icon?: LucideIcon;
  tone?: KpiTone;
  reason?: ReasonCode | null;
};

/**
 * 둘 중 하나만. 카드가 "여기서 좁히기" 와 "저기로 가기" 를 동시에 할 수는 없습니다.
 * `never` 를 쓴 이유는 둘 다 넘긴 호출을 타입 검사 단계에서 잡기 위해서입니다.
 */
type KpiCardProps = KpiCardBase &
  ({ filter?: KpiFilter; href?: never } | { filter?: never; href?: string });

export default function KpiCard({
  label,
  value,
  unit,
  delta,
  foot,
  icon: Icon,
  tone = 'default',
  reason = null,
  filter,
  href,
}: KpiCardProps) {
  const toneClass = tone === 'default' ? '' : ` ${tone}`;

  const body = (
    <>
      <header className="kpi-head">
        <span>{label}</span>
        {Icon && <Icon size={15} className="kpi-head-icon" aria-hidden />}
      </header>

      <div className="kpi-value">
        {value === null ? (
          <span className="kpi-number">
            <EmptyValue reason={reason} />
          </span>
        ) : (
          <>
            <span className="kpi-number">{value}</span>
            {unit && <span className="kpi-unit">{unit}</span>}
            {delta && <span className={`kpi-delta ${delta.direction}`}>{delta.value}</span>}
          </>
        )}
      </div>

      {foot && <p className="kpi-foot">{foot}</p>}
    </>
  );

  // 다른 화면으로 가는 링크. 선택 상태가 없으므로 aria-pressed 를 붙이지 않습니다 —
  // 토글이 아니라 이동입니다. 화면이 바뀌므로 scroll 도 막지 않습니다.
  if (href) {
    return (
      <Link href={href} className={`kpi${toneClass} clickable linked`}>
        {body}
      </Link>
    );
  }

  if (!filter) {
    return <article className={`kpi${toneClass}`}>{body}</article>;
  }

  const selected = filter.active ? ' selected' : '';

  return (
    <Link
      href={filterHref(filter.key, filter.active, filter.param)}
      className={`kpi${toneClass} clickable${selected}`}
      aria-pressed={filter.active}
      // 카드를 눌렀을 때 화면이 위로 튀지 않게 합니다
      scroll={false}
    >
      {body}
    </Link>
  );
}
