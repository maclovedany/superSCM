// 계산 불가 표기 — design.md §8.2 ★
//
// 숫자 자리에 숫자를 넣지 않습니다.
// 값이 없는 모든 자리는 이 컴포넌트 하나만 씁니다. 화면마다 다르게 쓰면 규칙이 무너집니다.

import { REASON_LABEL, type ReasonCode } from '@/lib/status';

export default function EmptyValue({
  reason = null,
  align = 'left',
  showLabel = true,
}: {
  reason?: ReasonCode | null;
  align?: 'left' | 'right';
  /** 사유를 한국어 설명까지 보여줄지. 좁은 표에서는 코드만 보여줍니다 */
  showLabel?: boolean;
}) {
  return (
    <span className={`empty-value${align === 'right' ? ' right' : ''}`}>
      <span className="empty-value-dash" aria-label="산출 불가">
        —
      </span>
      {reason && (
        <span className="empty-value-reason" title={REASON_LABEL[reason]}>
          {showLabel ? REASON_LABEL[reason] : reason}
        </span>
      )}
    </span>
  );
}
