'use client';

// 발주 승인 폼 — renew.prd 23장
//
// "추천 확인 → 필요시 수정 → 수정 사유 입력 → 승인".
// 승인 수량의 기본값은 AI 추천 수량입니다. 사람이 그것을 보고 고칩니다.
//
// ★ 이 화면의 Primary 버튼은 여기 하나뿐입니다 (design.md §14-8).
//   ② Consensus 의 보정 버튼은 secondary · ghost 입니다.
//
// ★ '추천대로' 는 추천 수량을 그대로 승인했을 때만 고를 수 있습니다.
//   수량을 바꿨는데 '추천대로' 로 저장되면 왜 바꿨는지가 기록에서 사라집니다 (renew.prd 23.1).
//   브라우저가 먼저 막고, Server Action 이 형식을 보고, DB 함수가 추천 수량을 직접 읽어
//   마지막으로 막습니다 — 화면이 보낸 추천값을 믿지 않기 위해서입니다.
//
// 사유 코드는 lib/approval-model.ts 에서 가져옵니다. lib/approval.ts 를 부르면
// 서버 전용 Supabase 클라이언트가 클라이언트 번들로 따라 들어옵니다.

import { useActionState, useState } from 'react';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import {
  APPROVAL_REASON_CODES,
  DECISIONS,
  DECISION_LABEL,
  canUseAsRecommended,
  requiresApprovalReasonText,
  type Decision,
} from '@/lib/approval-model';
import { approveRecommendation } from './actions';
import { EMPTY_APPROVAL_ACTION } from './state';

/** 결정마다 버튼이 말하는 결과가 다릅니다 (design.md §12 — 행동은 결과를 말합니다) */
const SUBMIT_LABEL: Record<Decision, string> = {
  APPROVED: '발주 승인',
  REJECTED: '발주 반려',
  DEFERRED: '결정 보류',
};

export default function ApprovalForm({
  itemId,
  recommendedQty,
}: {
  itemId: string;
  /** AI 추천 수량. 산출하지 못했으면 null 입니다 */
  recommendedQty: number | null;
}) {
  const [state, action, pending] = useActionState(approveRecommendation, EMPTY_APPROVAL_ACTION);
  const [decision, setDecision] = useState<Decision>('APPROVED');
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState(recommendedQty === null ? '' : String(recommendedQty));

  /**
   * 결정을 바꾸면 수량 칸도 따라갑니다.
   *
   * ★ 반려 · 보류는 "이만큼 승인했다" 가 없는 결정입니다. 추천값이 칸에 남아 있으면
   *   1,000 을 반려했는데 승인 수량 1,000 · 조정량 0 으로 저장되어, 이력이
   *   '반려 · 수량 1,000' 으로 읽힙니다. 칸을 비우고 잠급니다.
   *   승인으로 돌아오면 추천값을 다시 채웁니다 — 다시 입력하게 만들 이유가 없습니다.
   */
  function changeDecision(next: Decision): void {
    setDecision(next);
    setQty(next === 'APPROVED' && recommendedQty !== null ? String(recommendedQty) : '');
  }

  const qtyDisabled = decision !== 'APPROVED';
  const textRequired = requiresApprovalReasonText(reason);
  const approvedQty = qty.trim() === '' ? null : Number(qty);
  const qtyIsNumber = approvedQty !== null && Number.isFinite(approvedQty);

  // 추천을 그대로 승인하는 경우인가. DB 함수와 같은 판정입니다.
  const asRecommendedOk = canUseAsRecommended(
    decision,
    qtyIsNumber ? approvedQty : null,
    recommendedQty,
  );

  // 저장하기 전에 사람이 읽고 고칠 수 있게, 막히는 이유를 미리 말합니다.
  let blocked: string | null = null;
  if (reason === '') {
    blocked = '사유를 선택해주세요.';
  } else if (reason === 'AS_RECOMMENDED' && !asRecommendedOk) {
    blocked =
      recommendedQty === null
        ? '이 품목은 추천 수량을 산출하지 못했습니다. 추천대로 대신 다른 사유를 골라주세요.'
        : decision === 'APPROVED'
          ? `추천 ${recommendedQty.toLocaleString()} 와 승인 수량이 다릅니다. 수정한 사유를 골라주세요.`
          : '추천대로 는 승인일 때만 고를 수 있습니다. 반려 · 보류 사유를 골라주세요.';
  } else if (decision === 'APPROVED' && !qtyIsNumber) {
    blocked = '승인 수량을 입력해주세요.';
  } else if (qtyIsNumber && approvedQty < 0) {
    blocked = '승인 수량은 0 보다 작을 수 없습니다.';
  }

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <input type="hidden" name="itemId" value={itemId} />

      <div className="grid grid-3">
        <div className="field">
          <label className="t-label" htmlFor="decision">
            결정
          </label>
          <select
            id="decision"
            name="decision"
            className="select"
            value={decision}
            onChange={(event) => changeDecision(event.target.value as Decision)}
          >
            {DECISIONS.map((item) => (
              <option key={item} value={item}>
                {DECISION_LABEL[item]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="t-label" htmlFor="approvedQty">
            승인 수량
          </label>
          <input
            id="approvedQty"
            name="approvedQty"
            type="number"
            step={1}
            min={0}
            className="select"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            placeholder={
              qtyDisabled
                ? '0 으로 저장됩니다'
                : recommendedQty === null
                  ? '추천 없음'
                  : String(recommendedQty)
            }
            disabled={qtyDisabled}
            required={!qtyDisabled}
          />
        </div>

        <div className="field">
          <label className="t-label" htmlFor="reasonCode">
            사유
          </label>
          <select
            id="reasonCode"
            name="reasonCode"
            className="select"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          >
            <option value="">사유 선택</option>
            {APPROVAL_REASON_CODES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label className="t-label" htmlFor="reasonText">
          사유 설명 {textRequired ? '(필수)' : '(선택)'}
        </label>
        <input
          id="reasonText"
          name="reasonText"
          placeholder={
            textRequired
              ? '무엇이 기타인지 적어주세요'
              : '예: 분기 예산 한도로 절반만 발주합니다'
          }
          required={textRequired}
        />
      </div>

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn primary lg" disabled={pending || blocked !== null}>
          <CheckCircle2 size={15} aria-hidden />
          {pending ? '저장하는 중…' : SUBMIT_LABEL[decision]}
        </button>
        <span className="t-sm text-3">
          {recommendedQty === null
            ? '추천 수량을 산출하지 못한 품목입니다'
            : `AI 추천 ${recommendedQty.toLocaleString()} · 저장하면 지금의 계산 근거가 함께 남습니다`}
        </span>
      </div>

      {blocked && (
        <p className="t-sm text-3" role="status">
          {blocked}
        </p>
      )}

      {state.error && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {state.error}
        </p>
      )}
      {state.message && (
        <div className="insight">
          <div className="insight-head">저장했습니다</div>
          <div className="insight-body">{state.message}</div>
        </div>
      )}
    </form>
  );
}
