'use client';

// 예측 실행 폼 — 서비스에 맡긴 뒤에는 5초마다 진행 상황을 물어 "실행 중 · 단계 · 진행률" 을 보이고,
// 끝날 때까지 버튼을 잠급니다. 실행 이력에는 SQL 단계가 끝나야 행이 보이므로(함수가 한 트랜잭션),
// 그 사이의 공백을 이 폼이 메웁니다. 화면을 새로 열어도 서비스에 도는 것이 있으면 이어서 보입니다.

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, PlayCircle, TriangleAlert } from 'lucide-react';
import { pollPipeline, runForecast } from './actions';
import { EMPTY_RUN_ACTION, RUN_MODE_VALUES, STAGE_LABEL, type PipelinePoll, type RunModeValue } from './state';
import { RUN_MODE_DESC, RUN_MODE_LABEL } from '@/lib/admin-ops-model';

const POLL_MS = 5000;

export default function RunForm({
  enabledModels,
  productionTrainEnd,
  runningPipelineId = null,
}: {
  enabledModels: number;
  /**
   * core.forecast_setting.production_train_end. 비어 있으면 운영 실행이 거절됩니다
   * (SQL 함수가 사유를 돌려줍니다). 누르기 전에 미리 알려 주는 편이 낫습니다.
   */
  productionTrainEnd?: string | null;
  /** 화면을 열었을 때 서비스에 이미 돌고 있는 파이프라인 */
  runningPipelineId?: string | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(runForecast, EMPTY_RUN_ACTION);
  const [mode, setMode] = useState<RunModeValue>('VALIDATION');
  const [pipelineId, setPipelineId] = useState<string | null>(runningPipelineId);
  const [poll, setPoll] = useState<PipelinePoll | null>(null);

  // 서버 액션이 pipelineId 를 돌려주면 그것을 따라갑니다.
  useEffect(() => {
    if (state.pipelineId) setPipelineId(state.pipelineId);
  }, [state.pipelineId]);

  const running = pipelineId !== null && poll?.status !== 'SUCCESS' && poll?.status !== 'FAILED';

  useEffect(() => {
    if (!pipelineId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const next = await pollPipeline(pipelineId);
      if (cancelled) return;
      setPoll(next);
      if (next.status === 'SUCCESS' || next.status === 'FAILED') {
        router.refresh(); // 실행 이력에 행이 생겼습니다
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pipelineId, router]);

  const productionBlocked = mode === 'PRODUCTION' && !productionTrainEnd;
  const progress = poll?.progress ?? null;
  const progressText =
    progress && progress.itemsTotal && progress.itemsSeen !== null
      ? ` · ${progress.model ?? ''} ${progress.itemsSeen.toLocaleString()} / ${progress.itemsTotal.toLocaleString()} 품목 (${progress.modelIndex}/${progress.modelTotal} 모델)`
      : progress?.model
        ? ` · ${progress.model} (${progress.modelIndex}/${progress.modelTotal} 모델)`
        : '';

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
            disabled={running}
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
          <input id="note" name="note" placeholder="예: 8월 데이터 반영 후 재실행" disabled={running} />
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
          disabled={pending || running || enabledModels === 0 || productionBlocked}
        >
          {running ? <Loader2 size={15} aria-hidden className="spin" /> : <PlayCircle size={15} aria-hidden />}
          {running ? '실행 중…' : pending ? '시작하는 중…' : `${RUN_MODE_LABEL[mode]}`}
        </button>
        <span className="t-sm text-3">
          {enabledModels === 0
            ? '켜져 있는 모델이 없습니다. 예측 모델 화면에서 먼저 켜주세요.'
            : running
              ? '끝날 때까지 다시 누르지 않아도 됩니다. 5초마다 진행 상황을 갱신합니다.'
              : `사용 중인 모델 ${enabledModels}종으로 실행합니다`}
        </span>
      </div>

      {running && (
        <div className="insight" role="status">
          <div className="insight-head">실행 중 · {STAGE_LABEL[poll?.stage ?? 'QUEUED'] ?? poll?.stage ?? '대기'}</div>
          <div className="insight-body">
            {poll?.message ?? state.message ?? '서비스가 실행을 시작했습니다.'}
            {progressText}
          </div>
        </div>
      )}

      {state.error && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {state.error}
        </p>
      )}
      {!running && poll?.status === 'SUCCESS' && (
        <div className="insight">
          <div className="insight-head">완료</div>
          <div className="insight-body">{poll.message ?? '실행이 끝났습니다. 아래 실행 이력을 보세요.'}</div>
        </div>
      )}
      {!running && poll?.status === 'FAILED' && (
        <p className="login-error" role="alert">
          <TriangleAlert size={14} aria-hidden />
          {poll.message ?? '실행에 실패했습니다.'}
        </p>
      )}
      {!running && !poll && state.message && (
        <div className="insight">
          <div className="insight-head">완료</div>
          <div className="insight-body">{state.message}</div>
        </div>
      )}
    </form>
  );
}
