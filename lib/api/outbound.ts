// Outbound — 외부 시스템이 결과를 가져갑니다. renew.prd 9.2
//
// ★ 계산을 하지 않습니다. 화면이 쓰는 lib 함수를 그대로 부르고, 응답 모양으로 옮기기만 합니다.
//   화면과 API 가 다른 숫자를 말하지 않게 하려는 것입니다 (renew.prd 32).
//
// ★ 단건 조회는 서버에서 거릅니다 (리뷰 Important 7).
//   목록 함수는 전부 limit 이 걸려 있습니다(위험 1,000 · 추천 500 · 리드타임 200).
//   그것을 받아 find 하면 상한 밖의 품목이 "없습니다"(404) 로 보입니다.
//   품목이 실제로 없는 것과 목록이 잘린 것은 다릅니다.
//
// ★ 조회는 **서버 전용 secret 키 클라이언트**로 나갑니다 (lib/supabase/service.ts).
//   Route Handler 에는 세션이 없고, sql/28-anon-lockdown.sql 이 anon 에게서 analytics 를
//   전부 거뒀기 때문입니다. secret 키는 RLS 를 우회하므로, 이 파일의 함수는
//   **lib/api/handler.ts 의 passGates() 를 통과한 뒤에만** 불립니다
//   (① IP 제한 ② API 키 해시 인증 ③ scope ④ 키별 제한).
//   handleOutbound 는 gate 를 통과하지 못하면 work() 를 아예 부르지 않습니다.
//
// ★ 키가 설정되지 않았으면 503 입니다. 조용히 빈 배열을 주지 않습니다 —
//   "설정을 빠뜨렸는데 정상으로 보이는" 상태를 만들지 않습니다.
//
// 페이징은 limit(기본 100 · 최대 1000) · offset 입니다 (renew.prd 9.2).

import { getAlerts } from '../alerts';
import { getForecastDetail, getForecastRuns } from '../forecast';
import { getInventoryProjection, getLeadtimePolicy } from '../inventory';
import { getPurchaseRecommendation, getSafetyStock } from '../recommendation';
import { getStockoutRisk } from '../scm';
import { createSupabaseServiceClient, type SupabaseServerClient } from '../supabase/service';
import { apiError, page, type ApiErrorBody } from './auth-model.ts';

export type OutboundResult = { status: number; body: unknown };

function fail(status: number, code: string, message: string): { status: number; body: ApiErrorBody } {
  return { status, body: apiError(code, message) };
}

/**
 * Outbound 조회에 쓸 클라이언트.
 *
 * 없으면 503 입니다. 이 값이 null 인 것은 "데이터가 없다" 가 아니라
 * "서버가 조회할 자격증명을 못 찾았다" 입니다. 두 가지를 섞지 않습니다.
 */
export function serviceClientOrFailure():
  | { ok: true; client: SupabaseServerClient }
  | { ok: false; result: OutboundResult } {
  const client = createSupabaseServiceClient();

  if (!client) {
    return {
      ok: false,
      result: fail(
        503,
        'SERVICE_CREDENTIALS_MISSING',
        '서버 자격증명이 설정되지 않아 조회할 수 없습니다. 관리자에게 문의해주세요.',
      ),
    };
  }

  return { ok: true, client };
}

function notFound(what: string) {
  return fail(404, 'NOT_FOUND', `${what} 에 해당하는 데이터가 없습니다.`);
}

function upstream(detail: string) {
  return fail(502, 'UPSTREAM_ERROR', detail);
}

/** GET /api/v1/forecast/{itemId} — 최근 성공한 실행의 기간별 예측 */
export async function forecastForItem(
  itemId: string,
  limit: number,
  offset: number,
): Promise<OutboundResult> {
  const gate = serviceClientOrFailure();
  if (!gate.ok) return gate.result;

  // getLatestSuccessfulRun 은 오류를 삼키고 null 을 돌려줍니다. 그러면 "조회 실패" 가
  // "실행이 없음"(404) 으로 보입니다. 여기서는 오류를 직접 봅니다 (AGENTS.md 규칙 3).
  const runs = await getForecastRuns(gate.client);
  if (runs.error) return upstream(runs.error);

  const run = runs.rows.find((row) => row.status === 'SUCCESS') ?? null;
  if (!run) return notFound('성공한 예측 실행');

  const { rows, error } = await getForecastDetail(run.runId, itemId, gate.client);
  if (error) return upstream(error);
  if (rows.length === 0) return notFound(itemId);

  return {
    status: 200,
    body: {
      item_id: itemId,
      run_id: run.runId,
      horizon: run.horizon,
      train_end: run.trainEnd,
      // renew.prd 31.5 — 예측이 어느 시점 데이터에 근거하는지 함께 돌려줍니다
      data_snapshot_at: run.dataSnapshotAt,
      ...page(rows, limit, offset),
    },
  };
}

/** GET /api/v1/inventory-projection/{itemId} */
export async function inventoryProjectionForItem(
  itemId: string,
  limit: number,
  offset: number,
): Promise<OutboundResult> {
  const gate = serviceClientOrFailure();
  if (!gate.ok) return gate.result;

  const { rows, error } = await getInventoryProjection(itemId, gate.client);
  if (error) return upstream(error);
  if (rows.length === 0) return notFound(itemId);

  return { status: 200, body: { item_id: itemId, ...page(rows, limit, offset) } };
}

/** GET /api/v1/stockout-risk/{itemId} */
export async function stockoutRiskForItem(itemId: string): Promise<OutboundResult> {
  const gate = serviceClientOrFailure();
  if (!gate.ok) return gate.result;

  // 목록을 받아 find 하지 않습니다 — 목록은 잘려 있어 상한 밖 품목이 거짓 404 가 됩니다.
  const { data, error } = await getStockoutRisk(itemId, gate.client);
  if (error) return upstream(error);
  if (!data) return notFound(itemId);

  return { status: 200, body: data };
}

/** GET /api/v1/order-recommendation/{itemId} — 추천 한 줄 + 안전재고 근거 */
export async function orderRecommendationForItem(itemId: string): Promise<OutboundResult> {
  const gate = serviceClientOrFailure();
  if (!gate.ok) return gate.result;

  const [recommendation, safety] = await Promise.all([
    getPurchaseRecommendation(itemId, gate.client),
    getSafetyStock(itemId, gate.client),
  ]);

  if (recommendation.error) return upstream(recommendation.error);
  if (safety.error) return upstream(safety.error);
  if (!recommendation.data) return notFound(itemId);

  return {
    status: 200,
    body: { recommendation: recommendation.data, safety_stock: safety.data },
  };
}

/** GET /api/v1/leadtime/{supplierId} */
export async function leadtimeForSupplier(supplierId: string): Promise<OutboundResult> {
  const gate = serviceClientOrFailure();
  if (!gate.ok) return gate.result;

  const { data, error } = await getLeadtimePolicy(supplierId, gate.client);
  if (error) return upstream(error);
  if (!data) return notFound(supplierId);

  return { status: 200, body: data };
}

/** GET /api/v1/alerts */
export async function alertList(limit: number, offset: number): Promise<OutboundResult> {
  const gate = serviceClientOrFailure();
  if (!gate.ok) return gate.result;

  // 뷰가 우선순위 내림차순으로 정렬해 둡니다. 여기서 다시 정렬하지 않습니다.
  const { rows, error } = await getAlerts(Math.min(limit + offset, 1000), gate.client);
  if (error) return upstream(error);

  return { status: 200, body: page(rows, limit, offset) };
}
