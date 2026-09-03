// 정책값 조회 — renew.prd 32장
//
// Lead Time · Service Level 같은 값을 코드에 하드코딩하지 않습니다.
// core.policy_config 를 바꾸면 화면 코드를 고치지 않아도 계산이 달라져야 합니다.

import { createSupabaseServerClient } from './supabase/server';

export type PolicyKey =
  | 'SERVICE_LEVEL_DEFAULT'
  | 'Z_VALUE_DEFAULT'
  | 'REVIEW_PERIOD_DAYS'
  | 'DELIVERY_BUFFER_DAYS'
  | 'SAFETY_BUFFER_DAYS'
  | 'SOFT_ALLOCATION_DAYS'
  | 'LEADTIME_MIN_SAMPLES'
  | 'EXCESS_STOCK_MONTHS';

export type Policy = {
  key: string;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  description: string;
  updatedAt: string | null;
};

export async function getPolicies(): Promise<{ rows: Policy[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .from('policy_config')
      .select('key, value_num, value_text, unit, description, updated_at')
      .order('key');

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        key: String(row.key),
        valueNum: row.value_num === null ? null : Number(row.value_num),
        valueText: (row.value_text as string | null) ?? null,
        unit: (row.unit as string | null) ?? null,
        description: String(row.description ?? ''),
        updatedAt: (row.updated_at as string | null) ?? null,
      };
    });

    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

/**
 * 정책값 하나를 숫자로 읽습니다.
 *
 * 값이 없으면 null 을 돌려줍니다. 기본값을 코드에 적어 두지 않습니다.
 * 계산이 불가능하면 사유와 함께 산출 불가로 표시해야 합니다 (AGENTS.md 규칙 5).
 */
export async function getPolicyNumber(key: PolicyKey): Promise<number | null> {
  const { rows } = await getPolicies();
  return rows.find((row) => row.key === key)?.valueNum ?? null;
}
