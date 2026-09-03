'use client';

import { useActionState, useState } from 'react';
import { Check } from 'lucide-react';
import { toggleModel } from './actions';
import { EMPTY_MODEL_ACTION } from './state';
import type { ModelConfig } from '@/lib/forecast';

export default function ModelRowForm({ model }: { model: ModelConfig }) {
  const [state, action, pending] = useActionState(toggleModel, EMPTY_MODEL_ACTION);
  const [parameters, setParameters] = useState(JSON.stringify(model.parameters));

  return (
    <form action={action} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
      <input type="hidden" name="modelId" value={model.modelId} />

      <select name="enabled" defaultValue={String(model.enabled)} className="select" aria-label="사용 여부">
        <option value="true">사용</option>
        <option value="false">중지</option>
      </select>

      <input
        name="parameters"
        className="select"
        style={{ width: 190, fontFamily: 'var(--font-mono)', fontSize: 12 }}
        value={parameters}
        onChange={(event) => setParameters(event.target.value)}
        aria-label="파라미터 JSON"
        spellCheck={false}
      />

      <button type="submit" className="btn secondary icon" aria-label="저장" disabled={pending}>
        <Check size={14} aria-hidden />
      </button>

      {state.error && <span className="t-sm" style={{ color: 'var(--crit-fg)' }}>{state.error}</span>}
      {state.message && <span className="t-sm" style={{ color: 'var(--safe-fg)' }}>저장됨</span>}
    </form>
  );
}
