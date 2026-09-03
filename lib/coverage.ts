// 데이터 커버리지와 학습/검증 경계 — renew.prd 7.9 · 8.6
//
// 예측 결과에는 기준 데이터 시점을 함께 표시해야 합니다.
// 경계가 실제 데이터와 어긋나면 화면에서 드러나야 합니다.

import { createSupabaseServerClient } from './supabase/server';

export type DataCoverage = {
  dataStart: string | null;
  dataEnd: string | null;
  usageRows: number;
  dataMonths: number | null;
  granularity: 'MONTH' | 'WEEK';
  trainStart: string | null;
  trainEnd: string | null;
  testStart: string | null;
  testEnd: string | null;
  trainPeriods: number;
  trainQty: number | null;
  testPeriods: number;
  testQty: number | null;
  /** 설정한 학습 구간이 실제 데이터와 겹치는가. false 면 설정이 어긋난 것 */
  trainWindowOk: boolean;
  testWindowOk: boolean;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getDataCoverage(): Promise<{
  data: DataCoverage | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_data_coverage')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    const row = data as Record<string, unknown>;
    return {
      data: {
        dataStart: (row.data_start as string | null) ?? null,
        dataEnd: (row.data_end as string | null) ?? null,
        usageRows: num(row.usage_rows) ?? 0,
        dataMonths: num(row.data_months),
        granularity: row.granularity === 'WEEK' ? 'WEEK' : 'MONTH',
        trainStart: (row.train_start as string | null) ?? null,
        trainEnd: (row.train_end as string | null) ?? null,
        testStart: (row.test_start as string | null) ?? null,
        testEnd: (row.test_end as string | null) ?? null,
        trainPeriods: num(row.train_periods) ?? 0,
        trainQty: num(row.train_qty),
        testPeriods: num(row.test_periods) ?? 0,
        testQty: num(row.test_qty),
        trainWindowOk: row.train_window_ok !== false,
        testWindowOk: row.test_window_ok !== false,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}
