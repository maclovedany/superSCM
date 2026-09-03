'use client';

// 시나리오 파라미터 폼 — renew.prd 25.1
//
// 여기서 계산하지 않습니다. 값을 모아 Server Action 에 넘기면, 액션이 URL 을 만들고
// 서버 컴포넌트가 그 URL 로 rpc 를 부릅니다. 클라이언트 state 는 폼 입력값뿐입니다.
//
// defaultValue 로 채우는 이유 — 프리셋 칩과 결과 URL 이 모두 서버에서 값을 내려주고,
// 사용자는 그 위에서 고칩니다. 값을 클라이언트가 들고 있으면 뒤로가기가 어긋납니다.

import { useActionState } from 'react';
import { PlayCircle, TriangleAlert } from 'lucide-react';
import type { WhatIfParams } from '@/lib/what-if-model';
import { runScenario } from './actions';
import { EMPTY_WHAT_IF } from './state';

/** 숫자 칸 하나. 값이 없으면 빈 칸입니다 — 0 을 미리 채우지 않습니다 */
function NumberField({
  name,
  label,
  hint,
  value,
  step = '1',
}: {
  name: string;
  label: string;
  hint: string;
  value: number | undefined;
  step?: string;
}) {
  return (
    <div className="field">
      <label className="t-label" htmlFor={`wi-${name}`}>
        {label}
      </label>
      <input
        id={`wi-${name}`}
        name={name}
        type="number"
        step={step}
        inputMode="decimal"
        defaultValue={value ?? ''}
        placeholder="—"
      />
      <span className="t-sm text-3">{hint}</span>
    </div>
  );
}

function PeriodField({
  name,
  label,
  hint,
  value,
}: {
  name: string;
  label: string;
  hint: string;
  value: string | undefined;
}) {
  return (
    <div className="field">
      <label className="t-label" htmlFor={`wi-${name}`}>
        {label}
      </label>
      <input
        id={`wi-${name}`}
        name={name}
        type="month"
        defaultValue={value ?? ''}
        placeholder="YYYY-MM"
      />
      <span className="t-sm text-3">{hint}</span>
    </div>
  );
}

export default function WhatIfForm({
  itemId,
  defaults,
}: {
  itemId: string;
  /** 프리셋 칩이나 지금 보고 있는 시나리오에서 온 값 */
  defaults: WhatIfParams;
}) {
  const [state, action, pending] = useActionState(runScenario, EMPTY_WHAT_IF);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <input type="hidden" name="item" value={itemId} />

      <div className="grid grid-3">
        <NumberField
          name="demand_pct"
          label="수요 증감 (%)"
          hint="+20 이면 예측 수요를 20% 올립니다. −20 은 반대"
          value={defaults.demand_pct}
        />
        <NumberField
          name="lead_time_days"
          label="리드타임 (일)"
          hint="절대값. 이 칸이 아래 증감보다 우선합니다"
          value={defaults.lead_time_days}
        />
        <NumberField
          name="lead_time_pct"
          label="리드타임 증감 (%)"
          hint="두 배면 100. 위 칸이 비어 있을 때만 씁니다"
          value={defaults.lead_time_pct}
        />
        <NumberField
          name="open_po_delay_days"
          label="입고 지연 (일)"
          hint="진행 중 선적의 도착을 미룹니다"
          value={defaults.open_po_delay_days}
        />
        <NumberField
          name="service_level"
          label="서비스 수준"
          hint="비율입니다. 95% 는 0.95 (95 로 넣어도 됩니다)"
          value={defaults.service_level}
          step="0.01"
        />
        <NumberField
          name="extra_order_qty"
          label="대형 계약 수량"
          hint="그 기간 적용수요에 더합니다"
          value={defaults.extra_order_qty}
        />
        <PeriodField
          name="extra_order_period"
          label="대형 계약 기간"
          hint="비우면 모든 기간"
          value={defaults.extra_order_period}
        />
        <NumberField
          name="promotion_pct"
          label="프로모션 증감 (%)"
          hint="그 기간 예측 수요에 곱합니다"
          value={defaults.promotion_pct}
        />
        <PeriodField
          name="promotion_period"
          label="프로모션 기간"
          hint="비우면 모든 기간"
          value={defaults.promotion_period}
        />
      </div>

      <label className="t-sm" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
        <input
          type="checkbox"
          name="supplier_unavailable"
          defaultChecked={defaults.supplier_unavailable === true}
        />
        공급처 사용 불가 — 입고예정을 없애고 신규 발주도 불가로 봅니다 (읽을 값은 결품 예상일)
      </label>

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="btn primary lg" disabled={pending || itemId === ''}>
          <PlayCircle size={15} aria-hidden />
          {pending ? '계산 중…' : '시나리오 실행'}
        </button>
        <span className="t-sm text-3">
          빈 칸은 기준(Base)과 같습니다. 실제 데이터는 바뀌지 않습니다
        </span>
      </div>

      {state.error && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {state.error}
        </p>
      )}
    </form>
  );
}
