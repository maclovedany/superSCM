'use server';

// 예측 실행 — renew.prd 12.2
//
// 계산은 DB 안에서 끝납니다. 앱은 방아쇠만 당깁니다.
// 학습 데이터를 앱으로 끌어오지 않으므로 격리가 유지됩니다.

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getModelConfigs } from '@/lib/forecast';
import { getServiceHealth, isServiceConfigured, runPipeline, runPythonForecast } from '@/lib/forecast-service';
import { isRunModeValue, type RunActionState } from './state';

export async function runForecast(
  _prev: RunActionState,
  formData: FormData,
): Promise<RunActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const note = String(formData.get('note') ?? '').trim() || null;

  // ── 실행 모드 (STEP 20) ────────────────────────────────────
  //
  // VALIDATION  train_end 까지 학습 → 검증 구간을 예측합니다. 백테스트가 채점합니다.
  // PRODUCTION  production_train_end 까지 학습 → 오늘 이후를 예측합니다.
  //             재고 전개 · 발주 추천 · 대시보드가 쓰는 실행입니다.
  //
  // 모드를 고르지 않은 옛 폼에서 와도 예전과 같은 뜻이 되도록 기본은 VALIDATION 입니다
  // (SQL 함수의 기본값과 같습니다).
  const rawMode = String(formData.get('mode') ?? '').trim().toUpperCase();
  const mode = rawMode === '' ? 'VALIDATION' : rawMode;
  if (!isRunModeValue(mode)) {
    return { error: '실행 모드는 검증 실행 또는 운영 실행이어야 합니다.', message: null };
  }

  try {
    // ── 전체 파이프라인 (실데이터 전환 Plan 2) ──────────────────
    //
    // 예측 서비스가 살아 있으면 서비스가 SQL 모델 → Python 모델 → 실체화 → 백테스트를
    // 직접 접속으로 한 번에 돌립니다. 11,000 품목은 PostgREST RPC 의 문장 시간 제한(30초)
    // 안에 끝나지 않으므로 이 길이 기본입니다. 서비스가 없거나 응답하지 않으면 아래의
    // 예전 길(RPC · SQL 모델만)로 내려갑니다 — 화면은 그 사실을 문구로 말합니다.
    if (isServiceConfigured()) {
      const health = await getServiceHealth();
      if (health.ok && health.db) {
        const started = await runPipeline(mode, note);
        if (started.ok) {
          await writeAuditLog(actor, {
            action: 'FORECAST_RUN',
            targetType: 'core.forecast_run',
            targetId: started.pipelineId ?? '',
            after: { mode, via: 'forecast-service', pipelineId: started.pipelineId },
          });
          revalidatePath('/admin/forecast-runs');
          const modeText = mode === 'PRODUCTION' ? '운영 실행' : '검증 실행';
          return {
            error: null,
            message:
              `${modeText}을 예측 서비스에 맡겼습니다 (${started.pipelineId ?? '-'}). ` +
              `SQL 모델 → Python 모델 → 화면 예측 표 갱신${mode === 'VALIDATION' ? ' → 백테스트' : ''} 순서로 ` +
              `돌아가며, 품목 11,000개 기준 몇 분이 걸립니다. 아래 실행 이력을 새로고침해 상태를 보세요.`,
          };
        }
        // 서비스가 요청을 받지 못했습니다. 예전 길로 내려갑니다.
      }
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .rpc('run_baseline_forecast', { p_note: note, p_mode: mode });

    if (error) return { error: `실행에 실패했습니다: ${error.message}`, message: null };

    const row = (Array.isArray(data) ? data[0] : data) as
      | { run_id?: string; n_models?: number; n_items?: number; n_rows?: number; message?: string }
      | null;

    const rows = Number(row?.n_rows ?? 0);
    if (rows === 0) {
      return { error: row?.message ?? '예측 결과가 생성되지 않았습니다.', message: null };
    }

    await writeAuditLog(actor, {
      action: 'FORECAST_RUN',
      targetType: 'core.forecast_run',
      targetId: row?.run_id ?? '',
      after: { mode, models: row?.n_models, items: row?.n_items, rows },
    });

    // ── Python 모델 이어 붙이기 (STEP 8 · renew.prd 31.4) ──────
    //
    // SQL 결과는 이미 저장되었습니다. 서비스가 없거나 실패해도 여기서 되돌리지 않습니다.
    // 같은 run_id 에 붙여야 백테스트가 SQL·Python 을 같은 조건에서 채점합니다.
    const python = await appendPythonModels(row?.run_id ?? null, note, mode);

    // 운영 실행은 화면이 쓰는 예측을 바꿉니다. 그 화면들의 캐시도 함께 비웁니다.
    revalidatePath('/admin/forecast-runs');
    revalidatePath('/admin/forecast-settings');
    if (mode === 'PRODUCTION') {
      revalidatePath('/dashboard');
      revalidatePath('/forecast');
      revalidatePath('/model-comparison');
      revalidatePath('/inventory-projection');
      revalidatePath('/purchase-recommendation');
    }

    const modeText = mode === 'PRODUCTION' ? '운영 실행' : '검증 실행';
    return {
      error: null,
      message:
        `${modeText} · ${row?.run_id} · 모델 ${row?.n_models}종 · 품목 ${row?.n_items}개 · ` +
        `${rows.toLocaleString()}행을 생성했습니다.${python}`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '실행에 실패했습니다.',
      message: null,
    };
  }
}

/**
 * Python 예측 서비스에 이어 붙이기를 요청하고, 메시지에 덧붙일 문구를 돌려줍니다.
 *
 * 서비스가 없거나 응답하지 않아도 SQL 결과는 그대로 둡니다 (renew.prd 31.4).
 * export 하지 않습니다 — 'use server' 파일은 async 함수만 export 할 수 있고,
 * 이 함수는 Server Action 이 아니라 내부 도우미이기 때문입니다.
 *
 * ★ 운영 실행에는 이어 붙이지 않습니다 (STEP 20 수정 라운드 1).
 *   forecast-service 의 check_run_window 가 run 의 train_end 를 forecast_setting.train_end
 *   와 견주는데, 운영 실행은 **설계상 그 둘이 다릅니다.** 그래서 요청은 언제나 실패하고,
 *   관리자는 성공 문구 뒤에 붙은 실패 사유를 읽게 됩니다.
 *   더 조용한 결과는 운영 실행에 Python 결과가 영영 없다는 것입니다 — Champion 이 Python
 *   모델인 품목은 core.v_ai_forecast 의 avail 에 그 모델이 없어 기본 모델로 내려앉습니다
 *   (source='DEFAULT'). 그래서 부르지 않고, **그 사실을 문구로 말합니다.**
 */
async function appendPythonModels(
  runId: string | null,
  note: string | null,
  mode: string,
): Promise<string> {
  if (!runId) return '';
  if (!isServiceConfigured()) return '';

  if (mode === 'PRODUCTION') {
    const { rows: configured } = await getModelConfigs();
    const enabled = configured.filter((model) => model.engine === 'PYTHON' && model.enabled);
    if (enabled.length === 0) return '';
    return (
      ` Python 모델 ${enabled.length}종은 붙이지 않았습니다 — 예측 서비스가 검증 경계로만` +
      ` 학습하도록 만들어져 운영 실행에는 이어 붙일 수 없습니다.` +
      ` 이 실행의 Champion 이 Python 모델인 품목은 기본 모델 예측을 씁니다.`
    );
  }

  // 켜져 있는 PYTHON 모델이 하나도 없으면 서비스를 부르지 않습니다.
  // 조회가 실패하면 목록이 비어 "켜진 모델이 없다" 와 구분되지 않으므로 사유를 남깁니다.
  const { rows: models, error } = await getModelConfigs();
  if (error) return ` 모델 설정을 읽지 못해 Python 모델은 붙이지 못했습니다: ${error}`;

  const enabledPython = models.filter((model) => model.engine === 'PYTHON' && model.enabled);
  if (enabledPython.length === 0) return '';

  const result = await runPythonForecast(runId, note);
  if (!result.ok) {
    return ` Python 모델은 붙이지 못했습니다: ${result.error ?? '알 수 없는 오류'}.`;
  }

  const names = result.models.length > 0 ? result.models.join(' · ') : `${enabledPython.length}종`;
  return ` Python 모델(${names})을 이어 붙이는 중입니다. 잠시 뒤 목록을 새로고침하세요.`;
}
