'use client';

import { useActionState, useState } from 'react';
import { PlayCircle, TriangleAlert } from 'lucide-react';
import { runForecast } from './actions';
import { EMPTY_RUN_ACTION, RUN_MODE_VALUES, type RunModeValue } from './state';
import { RUN_MODE_DESC, RUN_MODE_LABEL } from '@/lib/admin-ops-model';

export default function RunForm({
  enabledModels,
  productionTrainEnd,
}: {
  enabledModels: number;
  /**
   * core.forecast_setting.production_train_end. 비어 있으면 운영 실행이 거절됩니다
   * (SQL 함수가 사유를 돌려줍니다). 누르기 전에 미리 알려 주는 편이 낫습니다.
   */
  productionTrainEnd?: string | null;
}) {
  const [state, action, pending] = useActionState(runForecast, EMPTY_RUN_ACTION);
  const [mode, setMode] = useState<RunModeValue>('VALIDATION');

  const productionBlocked = mode === 'PRODUCTION' && !productionTrainEnd;

  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 12rem' }}>
          <label className="t-label" htmlFor="mode">
            실행 모드
          </label>
          <select
            id="mode"
            name="mode"
            className="select"
            value={mode}
            onChange={(event) => setMode(event.target.value as RunModeValue)}
          >
            {RUN_MODE_VALUES.map((value) => (
              <option key={value} value={value}>
                {RUN_MODE_LABEL[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ flex: '2 1 20rem' }}>
          <label className="t-label" htmlFor="note">
            메모 (선택)
          </label>
          <input id="note" name="note" placeholder="예: 8월 데이터 반영 후 재실행" />
        </div>
      </div>

      <p className="t-sm text-2" style={{ margin: 0 }}>
        {RUN_MODE_DESC[mode]}
        {mode === 'PRODUCTION' && productionTrainEnd && (
          <>
            {' '}
            지금 운영 학습 종료일은 <b className="text-1">{productionTrainEnd}</b> 입니다.
          </>
        )}
      </p>

      {productionBlocked && (
        <p className="t-sm text-2" style={{ margin: 0 }}>
          <span className="hl-warn">운영 학습 종료일이 비어 있습니다.</span> 예측 기본 설정 화면에서 먼저
          지정해야 운영 실행이 돕니다.
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="submit"
          className="btn primary lg"
          disabled={pending || enabledModels === 0 || productionBlocked}
        >
          <PlayCircle size={15} aria-hidden />
          {pending ? '실행하는 중…' : `${RUN_MODE_LABEL[mode]}`}
        </button>
        <span className="t-sm text-3">
          {enabledModels === 0
            ? '켜져 있는 모델이 없습니다. 예측 모델 화면에서 먼저 켜주세요.'
            : `사용 중인 모델 ${enabledModels}종으로 실행합니다`}
        </span>
      </div>

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
