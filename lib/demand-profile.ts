// 수요 프로파일 조회 — renew.prd 10장
//
// 이 분류가 STEP 6 의 모델 선택과 STEP 10 의 안전재고 정책 입력이 됩니다.

import { createSupabaseServerClient } from './supabase/server';

/** Syntetos · Boylan · Croston (2005) 분류 */
export type DemandType = 'SMOOTH' | 'INTERMITTENT' | 'ERRATIC' | 'LUMPY' | 'NO_DEMAND';

export const DEMAND_TYPE_LABEL: Record<DemandType, string> = {
  SMOOTH: '평활',
  INTERMITTENT: '간헐',
  ERRATIC: '불규칙',
  LUMPY: '덩어리',
  NO_DEMAND: '수요 없음',
};

export const DEMAND_TYPE_DESC: Record<DemandType, string> = {
  SMOOTH: '꾸준하고 변동이 작습니다. 일반 시계열 모델이 잘 맞습니다',
  INTERMITTENT: '드문드문 나가지만 수량은 일정합니다. Croston 계열이 필요합니다',
  ERRATIC: '자주 나가지만 수량이 들쭉날쭉합니다',
  LUMPY: '드물게 나가고 수량도 들쭉날쭉합니다. 가장 예측하기 어렵습니다',
  NO_DEMAND: '학습 구간에 출고가 없습니다',
};

export type SkuDemandProfile = {
  itemId: string;
  itemName: string | null;
  supplierId: string | null;
  firstPeriod: string | null;
  lastPeriod: string | null;
  periods: number;
  activePeriods: number;
  zeroPeriods: number;
  totalQty: number | null;
  meanQty: number | null;
  sdQty: number | null;
  cv: number | null;
  cvSquared: number | null;
  adi: number | null;
  zeroDemandRate: number | null;
  trendPctPerPeriod: number | null;
  recentChangePct: number | null;
  peakMonth: number | null;
  peakQty: number | null;
  demandType: DemandType | null;
  demandTypeReason: string | null;
  seasonalityIndex: number | null;
  seasonalityReason: string | null;
  stability: string | null;
};

export type DemandProfileKpi = {
  items: number;
  smooth: number;
  intermittent: number;
  erratic: number;
  lumpy: number;
  noDemand: number;
  unclassified: number;
  crostonNeeded: number;
  avgCv: number | null;
  avgAdi: number | null;
  trainPeriods: number | null;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function demandType(value: unknown): DemandType | null {
  const allowed: DemandType[] = ['SMOOTH', 'INTERMITTENT', 'ERRATIC', 'LUMPY', 'NO_DEMAND'];
  return allowed.includes(value as DemandType) ? (value as DemandType) : null;
}

export async function getDemandProfiles(): Promise<{
  rows: SkuDemandProfile[];
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_sku_demand_profile')
      .select('*')
      .order('adi', { ascending: false, nullsFirst: false });

    if (error) return { rows: [], error: error.message };

    const rows = (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        itemId: String(row.item_id ?? ''),
        itemName: (row.item_name as string | null) ?? null,
        supplierId: (row.supplier_id as string | null) ?? null,
        firstPeriod: (row.first_period as string | null) ?? null,
        lastPeriod: (row.last_period as string | null) ?? null,
        periods: num(row.n_periods) ?? 0,
        activePeriods: num(row.n_active_periods) ?? 0,
        zeroPeriods: num(row.n_zero_periods) ?? 0,
        totalQty: num(row.total_qty),
        meanQty: num(row.mean_qty),
        sdQty: num(row.sd_qty),
        cv: num(row.cv),
        cvSquared: num(row.cv_squared),
        adi: num(row.adi),
        zeroDemandRate: num(row.zero_demand_rate),
        trendPctPerPeriod: num(row.trend_pct_per_period),
        recentChangePct: num(row.recent_change_pct),
        peakMonth: num(row.peak_month),
        peakQty: num(row.peak_qty),
        demandType: demandType(row.demand_type),
        demandTypeReason: (row.demand_type_reason as string | null) ?? null,
        seasonalityIndex: num(row.seasonality_index),
        seasonalityReason: (row.seasonality_reason as string | null) ?? null,
        stability: (row.stability as string | null) ?? null,
      };
    });

    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}

export async function getDemandProfileKpi(): Promise<{
  data: DemandProfileKpi | null;
  error: string | null;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_demand_profile_kpi')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };

    const row = data as Record<string, unknown>;
    return {
      data: {
        items: num(row.n_items) ?? 0,
        smooth: num(row.n_smooth) ?? 0,
        intermittent: num(row.n_intermittent) ?? 0,
        erratic: num(row.n_erratic) ?? 0,
        lumpy: num(row.n_lumpy) ?? 0,
        noDemand: num(row.n_no_demand) ?? 0,
        unclassified: num(row.n_unclassified) ?? 0,
        crostonNeeded: num(row.n_croston_needed) ?? 0,
        avgCv: num(row.avg_cv),
        avgAdi: num(row.avg_adi),
        trainPeriods: num(row.train_periods),
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.' };
  }
}
