'use client';

// 기간 한 줄의 Forecast Override 입력 폼 — renew.prd 17장
//
// AI 예측을 고치는 것이 아니라 증감을 얹습니다. 그래서 입력 칸의 이름이 "증감" 입니다.
// 음수도 정상 입력입니다 (renew.prd 17.1 의 +300 / −300).
//
// "기타" 를 고르면 사유 텍스트가 필수가 됩니다 (renew.prd 17.2).
// 브라우저가 먼저 막고, Server Action 이 한 번 더 막고, DB 함수가 마지막으로 막습니다.
//
// ★ 이 화면의 Primary 버튼은 STEP 13 의 승인 버튼입니다 (design.md §14-8).
//   저장·해제는 secondary · ghost 로 둡니다.
//
// 사유 코드는 lib/override-model.ts 에서 가져옵니다. lib/override.ts 를 부르면
// 서버 전용 Supabase 클라이언트가 클라이언트 번들로 따라 들어옵니다.

import { useActionState, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { REASON_CODES, requiresReasonText } from '@/lib/override-model';
import { clearOverride, setOverride } from './actions';
import { EMPTY_OVERRIDE_ACTION } from './state';

export default function OverrideRowForm({
  itemId,
  period,
  overrideQty,
  reasonCode,
  reasonText,
  hasOverride,
}: {
  itemId: string;
  /** 'YYYY-MM-DD' — DB 함수의 p_period 로 그대로 넘어갑니다 */
  period: string;
  overrideQty: number | null;
  reasonCode: string | null;
  reasonText: string | null;
  hasOverride: boolean;
}) {
  const [saveState, saveAction, savePending] = useActionState(setOverride, EMPTY_OVERRIDE_ACTION);
  const [clearState, clearAction, clearPending] = useActionState(
    clearOverride,
    EMPTY_OVERRIDE_ACTION,
  );
  const [reason, setReason] = useState(reasonCode ?? '');

  const label = period.slice(0, 7);
  const textRequired = requiresReasonText(reason);

  return (
    <div className="row-form">
      <div className="row-form-line">
        <form action={saveAction} className="row-form-line">
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="period" value={period} />

          <input
            name="overrideQty"
            type="number"
            step={1}
            className="select qty"
            defaultValue={overrideQty ?? ''}
            placeholder="증감"
            aria-label={`${label} 증감 수량`}
            required
          />

          <select
            name="reasonCode"
            className="select code"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label={`${label} 보정 사유`}
            required
          >
            <option value="">사유 선택</option>
            {REASON_CODES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>

          <input
            name="reasonText"
            className="select reason"
            defaultValue={reasonText ?? ''}
            placeholder={textRequired ? '사유 (필수)' : '메모 (선택)'}
            aria-label={`${label} 사유 설명`}
            required={textRequired}
          />

          <button
            type="submit"
            className="btn secondary icon"
            aria-label={`${label} 보정 저장`}
            title="AI 예측에 증감을 얹어 Consensus 를 저장합니다"
            disabled={savePending || clearPending}
          >
            <Check size={14} aria-hidden />
          </button>
        </form>

        <form action={clearAction}>
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="period" value={period} />
          <button
            type="submit"
            className="btn ghost icon"
            aria-label={`${label} 보정 해제`}
            title="보정을 해제하고 AI 예측을 그대로 씁니다"
            disabled={savePending || clearPending || !hasOverride}
          >
            <RotateCcw size={14} aria-hidden />
          </button>
        </form>
      </div>

      {(saveState.error || clearState.error) && (
        <span className="t-sm" style={{ color: 'var(--crit-fg)' }} role="alert">
          {saveState.error ?? clearState.error}
        </span>
      )}
      {(saveState.message || clearState.message) && (
        <span className="t-sm" style={{ color: 'var(--safe-fg)' }}>
          {saveState.message ?? clearState.message}
        </span>
      )}
    </div>
  );
}
