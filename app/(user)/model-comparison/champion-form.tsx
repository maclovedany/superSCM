'use client';

// Champion 수동 지정 — renew.prd 14.3 · 사유 필수

import { useActionState } from 'react';
import { Award } from 'lucide-react';
import { setChampion } from '../model-evaluation/actions';
import { EMPTY_BACKTEST } from '../model-evaluation/state';

export default function ChampionForm({
  itemId,
  models,
  current,
}: {
  itemId: string;
  models: { modelId: string; label: string }[];
  current: string | null;
}) {
  const [state, action, pending] = useActionState(setChampion, EMPTY_BACKTEST);

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <input type="hidden" name="itemId" value={itemId} />

      <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ minWidth: 200 }}>
          <label className="t-label" htmlFor="modelId">
            Champion 으로 지정할 모델
          </label>
          <select id="modelId" name="modelId" className="select" defaultValue={current ?? ''}>
            {models.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ flex: 1, minWidth: 280 }}>
          <label className="t-label" htmlFor="reason">
            사유 (필수)
          </label>
          <input
            id="reason"
            name="reason"
            required
            placeholder="예: 성능은 조금 낮지만 설명이 쉬워 현업이 이해합니다"
          />
        </div>

        <button type="submit" className="btn primary" disabled={pending}>
          <Award size={14} aria-hidden />
          {pending ? '지정하는 중…' : '지정'}
        </button>
      </div>

      {state.error && <span className="t-sm" style={{ color: 'var(--crit-fg)' }}>{state.error}</span>}
      {state.message && <span className="t-sm" style={{ color: 'var(--safe-fg)' }}>{state.message}</span>}
    </form>
  );
}
