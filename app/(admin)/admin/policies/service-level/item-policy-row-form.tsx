'use client';

// 품목 한 줄의 정책 편집 폼 — renew.prd 7.5 · 21.2 · 22.1
//
// 빈 칸은 null 로 저장됩니다. MOQ 가 비어 있으면 "최소 주문 수량 제약 없음" 이고,
// 0 이면 "0개부터 주문 가능" 입니다. 둘은 다른 뜻이라 0 으로 채우지 않습니다.

import { useActionState } from 'react';
import { Check } from 'lucide-react';
import { saveItemPolicy } from './actions';
import { EMPTY_POLICY_ACTION } from './state';
import type { ItemPolicy } from '@/lib/recommendation-model';

export default function ItemPolicyRowForm({ row }: { row: ItemPolicy }) {
  const [state, action, pending] = useActionState(saveItemPolicy, EMPTY_POLICY_ACTION);

  return (
    <form action={action} className="row-form">
      <input type="hidden" name="itemId" value={row.itemId} />

      <div className="row-form-line">
        <select
          name="itemGrade"
          className="select qty"
          defaultValue={row.itemGrade ?? ''}
          aria-label={`${row.itemId} 등급`}
        >
          <option value="">등급 없음</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
        <input
          name="moq"
          type="number"
          min={0}
          step={1}
          className="select qty"
          defaultValue={row.moq ?? ''}
          placeholder="MOQ"
          aria-label={`${row.itemId} MOQ`}
        />
        <input
          name="packSize"
          type="number"
          min={0}
          step={1}
          className="select qty"
          defaultValue={row.packSize ?? ''}
          placeholder="포장"
          aria-label={`${row.itemId} 포장 단위`}
        />
        <input
          name="serviceLevel"
          type="number"
          min={0}
          max={1}
          step={0.005}
          className="select qty"
          defaultValue={row.itemServiceLevel ?? ''}
          placeholder="개별 SL"
          aria-label={`${row.itemId} 개별 서비스 수준`}
        />
        <button
          type="submit"
          className="btn secondary icon"
          aria-label="저장"
          disabled={pending}
        >
          <Check size={14} aria-hidden />
        </button>
      </div>

      {state.error && (
        <span className="t-sm" style={{ color: 'var(--crit-fg)' }}>
          {state.error}
        </span>
      )}
      {state.message && (
        <span className="t-sm" style={{ color: 'var(--safe-fg)' }}>
          {state.message}
        </span>
      )}
    </form>
  );
}
