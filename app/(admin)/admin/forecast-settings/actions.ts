'use server';

// 운영 학습 종료일 저장 — renew.prd 12.1 · 8.6
//
// 학습/검증 경계(train_end)와 운영 학습 종료일(production_train_end)은 다른 것입니다.
//   train_end             모델을 고르기 위한 경계입니다. 백테스트가 이 뒤를 정답으로 씁니다.
//   production_train_end  운영 예측이 학습할 마지막 날입니다. 보통 데이터의 마지막 날입니다.
//
// 두 값을 한 컬럼에 겹쳐 두면 백테스트가 자기가 맞혀야 할 답을 학습하게 됩니다.
// 그래서 컬럼이 둘이고, 이 화면이 뒤쪽 하나만 고칩니다.

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isIsoDate } from '@/lib/admin-ops-model';
import type { ProductionTrainEndActionState } from './state';

export async function saveProductionTrainEnd(
  _prev: ProductionTrainEndActionState,
  formData: FormData,
): Promise<ProductionTrainEndActionState> {
  let actor;
  try {
    actor = await requireAdminOrThrow();
  } catch {
    return { error: '관리자 권한이 필요합니다.', message: null };
  }

  const value = String(formData.get('productionTrainEnd') ?? '').trim();
  if (!isIsoDate(value)) {
    return { error: '날짜를 YYYY-MM-DD 로 입력하세요.', message: null };
  }

  try {
    const supabase = await createSupabaseServerClient();

    const { data: before, error: readError } = await supabase
      .schema('core')
      .from('forecast_setting')
      .select('id, train_start, train_end, production_train_end')
      .eq('id', 1)
      .maybeSingle();

    if (readError) return { error: `조회에 실패했습니다: ${readError.message}`, message: null };
    if (!before) {
      return {
        error: '예측 설정이 없습니다. sql/06-core-extend.sql 을 먼저 실행하세요.',
        message: null,
      };
    }

    const trainStart = String(before.train_start ?? '');
    const trainEnd = String(before.train_end ?? '');

    // 학습 시작보다 앞이면 학습 구간이 비어 예측이 한 행도 나오지 않습니다.
    if (trainStart !== '' && value < trainStart) {
      return { error: `학습 시작(${trainStart})보다 앞설 수 없습니다.`, message: null };
    }
    // 검증 경계보다 앞이면 운영 실행이 검증 실행보다 적게 학습하게 되어, 운영 예측이
    // 오늘 이후를 덮지 못합니다. 그 상태를 조용히 저장하지 않습니다.
    if (trainEnd !== '' && value < trainEnd) {
      return {
        error: `검증 학습 종료일(${trainEnd})보다 앞설 수 없습니다. 운영 예측이 오늘 이후를 덮지 못합니다.`,
        message: null,
      };
    }

    const { error } = await supabase
      .schema('core')
      .from('forecast_setting')
      .update({
        production_train_end: value,
        updated_by: actor.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);

    if (error) return { error: `저장에 실패했습니다: ${error.message}`, message: null };

    await writeAuditLog(actor, {
      action: 'FORECAST_SETTING_PRODUCTION_TRAIN_END',
      targetType: 'core.forecast_setting',
      targetId: '1',
      before,
      after: { production_train_end: value },
    });

    revalidatePath('/admin/forecast-settings');
    revalidatePath('/admin/forecast-runs');

    return {
      error: null,
      message: `운영 학습 종료일을 ${value} 로 저장했습니다. 예측 실행 화면에서 운영 실행을 한 번 돌리세요.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '저장에 실패했습니다.', message: null };
  }
}
