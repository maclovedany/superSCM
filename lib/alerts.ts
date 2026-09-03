// Alert Center 조회 — renew.prd 24장
//
// 계산은 SQL 이 끝냈습니다 (core.scan_alerts). 여기서는 조회와 정규화만 합니다.
// 타입 · 라벨 · 정규화 함수는 lib/alerts-model.ts 에 있습니다.
//
// ★ 클라이언트 컴포넌트는 이 파일을 import 하지 마세요. 서버 전용 Supabase 클라이언트가
//   따라 들어옵니다. 라벨이 필요하면 lib/alerts-model.ts 에서 직접 가져오세요.
//
// PostgREST 는 한 번에 1,000행까지 돌려줍니다. 목록 조회는 limit 을 반드시 적습니다 (공통규칙 11).

import { createSupabaseServerClient } from './supabase/server';
import type { SupabaseServerClient } from './supabase/service';
import {
  normalizeAlert,
  normalizeAlertHistory,
  normalizeAlertKpi,
  type AlertHistoryItem,
  type AlertItem,
  type AlertKpi,
} from './alerts-model';

// 라벨과 톤은 모델 파일에 있습니다. 서버 코드가 한 곳에서 가져다 쓰도록 다시 내보냅니다.
export {
  ALERT_TYPES,
  ALERT_TYPE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  alertAgeText,
  alertTypeLabel,
  toSeverity,
  type AlertHistoryItem,
  type AlertItem,
  type AlertKpi,
  type AlertSeverity,
  type AlertType,
} from './alerts-model';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'Supabase 조회에 실패했습니다.';
}

/**
 * 미해결 알림 — renew.prd 24.3 의 우선순위 내림차순.
 *
 * priority_score 가 없는 행(정렬 재료를 하나도 못 구한 알림)은 맨 뒤로 보냅니다.
 * null 을 0 으로 취급해 앞에 두면 가장 급한 알림처럼 보입니다 (design.md §8.2).
 */
export async function getAlerts(
  limit = 200,
  client?: SupabaseServerClient,
): Promise<{ rows: AlertItem[]; error: string | null }> {
  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_alert')
      .select('*')
      .order('priority_score', { ascending: false, nullsFirst: false })
      .order('detected_at', { ascending: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeAlert(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/**
 * 알림 이력. 두 뷰가 각각 최근 500건으로 잘라 둡니다.
 *
 * resolvedOnly 가 true 면 `analytics.v_alert_resolved` 를 읽습니다. /alerts 화면 하단
 * 패널이 그렇게 씁니다 — 위쪽 목록이 미해결을 이미 보여주므로 아래에서 같은 행을
 * 두 번 보여줄 이유가 없습니다.
 *
 * ★ 여기서 `v_alert_history` 를 읽고 밖에서 `resolved_at is not null` 로 거르면 안 됩니다.
 *   그 뷰는 **안에서** limit 500 을 겁니다. 미해결 알림은 모두 같은 스캔 시각을 갖고 있어
 *   정렬 앞자리를 차지하므로, 미해결이 500건을 넘으면 해결된 알림이 잘려 나간 뒤라
 *   밖에서 걸러도 한 건도 안 남습니다. 자르기 전에 거르는 뷰가 따로 있는 이유입니다.
 */
export async function getAlertHistory(
  limit = 50,
  resolvedOnly = true,
): Promise<{ rows: AlertHistoryItem[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from(resolvedOnly ? 'v_alert_resolved' : 'v_alert_history')
      .select('*')
      .order('resolved_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) return { rows: [], error: error.message };
    return {
      rows: (data ?? []).map((row) => normalizeAlertHistory(row as Record<string, unknown>)),
      error: null,
    };
  } catch (error) {
    return { rows: [], error: failure(error) };
  }
}

/** KPI 한 줄. 알림이 하나도 없어도 뷰는 항상 1행입니다 */
export async function getAlertKpi(): Promise<{ data: AlertKpi | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_alert_kpi')
      .select('*')
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    if (!data) return { data: null, error: null };
    return { data: normalizeAlertKpi(data as Record<string, unknown>), error: null };
  } catch (error) {
    return { data: null, error: failure(error) };
  }
}
