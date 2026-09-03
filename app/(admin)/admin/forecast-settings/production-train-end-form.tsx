'use client';

// 운영 학습 종료일 편집 — renew.prd 12.1
//
// 기본값은 데이터의 마지막 날입니다. 그날까지 학습해야 운영 예측이 오늘 이후를 덮습니다.

import { useActionState } from 'react';
import { CalendarCheck, TriangleAlert } from 'lucide-react';
import { saveProductionTrainEnd } from './actions';
import { EMPTY_PRODUCTION_TRAIN_END_ACTION } from './state';

export default function ProductionTrainEndForm({
  current,
  dataEnd,
}: {
  /** 지금 저장된 값. 비어 있으면 운영 실행이 거절됩니다 */
  current: string | null;
  /** 데이터의 마지막 날. 비어 있는 칸의 기본값으로 씁니다 */
  dataEnd: string | null;
}) {
  const [state, action, pending] = useActionState(
    saveProductionTrainEnd,
    EMPTY_PRODUCTION_TRAIN_END_ACTION,
  );

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 12rem' }}>
          <label className="t-label" htmlFor="productionTrainEnd">
            운영 학습 종료일
          </label>
          <input
            id="productionTrainEnd"
            name="productionTrainEnd"
            type="date"
            defaultValue={current ?? dataEnd ?? ''}
            required
          />
        </div>

        <button type="submit" className="btn primary" disabled={pending}>
          <CalendarCheck size={15} aria-hidden />
          {pending ? '저장하는 중…' : '저장'}
        </button>
      </div>

      <p className="t-sm text-2" style={{ margin: 0 }}>
        {current === null ? (
          <>
            <span className="hl-warn">아직 비어 있습니다.</span> 지정하기 전에는 운영 실행이 돌지 않습니다.
          </>
        ) : (
          <>
            지금 값은 <b className="text-1">{current}</b> 입니다.
          </>
        )}
        {dataEnd && (
          <>
            {' '}
            데이터의 마지막 날은 <b className="text-1">{dataEnd}</b> 입니다. 보통 이 날짜를 씁니다.
          </>
        )}
      </p>

      {state.error && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {state.error}
        </p>
      )}
      {state.message && (
        <div className="insight">
          <div className="insight-head">완료</div>
          <div className="insight-body">{state.message}</div>
        </div>
      )}
    </form>
  );
}
