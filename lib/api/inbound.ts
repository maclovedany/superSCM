// Inbound — 외부 시스템이 데이터를 넣습니다. renew.prd 9.1
//
// ★ 파일 업로드와 **같은 파이프라인**을 지납니다 (renew.prd 9.1).
//   "API 입력도 File Upload 와 동일한 Validation Pipeline 을 통과한다."
//
//     data[]  →  autoMap + 저장된 매핑        lib/import/schema.ts · core.column_mapping
//             →  core.api_validation_context  loadValidationContext 와 **같은 네 곳**을 읽습니다
//             →  validate()                   lib/import/validate.ts  (★ 유일한 검증 경로)
//             →  core.api_stage_batch()       upload_batch/import_staging/validation_error
//             →  core.api_import_commit()     core.import_commit_internal 의 같은 본문
//
//   lib/import/* 를 고치지 않았습니다. 두 경로가 다른 규칙을 쓰면
//   "파일로는 되는데 API 로는 안 된다" 가 생깁니다.
//
// ★ 검증 재료를 못 읽으면 **503 입니다.** 빈 마스터 집합으로는 검증하지 않습니다.
//   lib/import/validate.ts 는 `knownItemIds.size > 0` 일 때만 UNKNOWN_ITEM 을 봅니다.
//   즉 마스터를 못 읽으면 검사가 조용히 꺼지고, 파일이면 거절될 행이 API 로는 들어갑니다.
//   그 상태로 200 을 돌려주느니 503 으로 멈추는 편이 낫습니다.
//
// ★ 멱등성 (renew.prd 9.1 "같은 요청을 반복해도 중복 적재되지 않는다")
//   upsert 모드는 키 기준으로 덮어쓰므로 반복해도 늘지 않습니다.
//   append 모드는 그렇지 않으므로 `Idempotency-Key` 헤더를 씁니다. 같은 키로 다시 들어오면
//   core.api_log 에 남겨 둔 지난 응답을 그대로 돌려주고 적재하지 않습니다.
//
// ★ Postgres 원문 오류를 외부 호출자에게 돌려주지 않습니다.
//   서버 로그에만 남기고, 호출자에게는 스스로 고칠 수 있는 문구만 보냅니다.

import { createSupabaseServerClient } from '../supabase/server';
import { validate } from '../import/validate';
import type { DataType } from '../import/types';
import {
  buildInboundResponse,
  isBlocked,
  stageableRows,
  type InboundRequest,
  type InboundResponse,
} from './inbound-model.ts';
import { buildMappingWithSaved, loadApiValidationContext } from './validation-context';
import { apiError, type ApiErrorBody, type ApiIdentity } from './auth-model.ts';

export type IngestResult = {
  status: number;
  body: InboundResponse | ApiErrorBody;
  /** 호출 기록에 남길 값 */
  log: { received: number; accepted: number; rejected: number; batchId: string | null };
  /** 멱등 재요청이라 아무 것도 적재하지 않은 경우 */
  replayed: boolean;
};

/** 이미 같은 Idempotency-Key 로 처리한 요청인가 */
async function findReplay(
  keyHash: string,
  idempotencyKey: string,
): Promise<InboundResponse | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('api_log_find_idempotent', {
      p_key_hash: keyHash,
      p_idempotency_key: idempotencyKey,
    });

    if (error) return null;

    const row = (Array.isArray(data) ? data[0] : data) as { response?: unknown } | null;
    const response = row?.response;
    if (!response || typeof response !== 'object') return null;

    return response as InboundResponse;
  } catch {
    return null;
  }
}

function failure(
  status: number,
  code: string,
  message: string,
  received: number,
  batchId: string | null = null,
): IngestResult {
  return {
    status,
    body: apiError(code, message),
    log: { received, accepted: 0, rejected: received, batchId },
    replayed: false,
  };
}

/**
 * 한 번의 Inbound 요청을 처리합니다.
 *
 * 부분 성공을 허용합니다. strict 이면 오류가 하나라도 있을 때 전량 거부합니다 (renew.prd 9.1).
 * 전량 거부일 때도 배치는 남깁니다 — 관리자가 Import History 에서 왜 거부됐는지 볼 수 있어야
 * 합니다. 적재할 수 있는 행이 0이므로 raw 에는 한 줄도 들어가지 않습니다.
 */
export async function ingest(params: {
  dataType: DataType;
  request: InboundRequest;
  identity: ApiIdentity;
  idempotencyKey: string | null;
}): Promise<IngestResult> {
  const { dataType, request, identity, idempotencyKey } = params;
  const received = request.data.length;

  // ── 0. 멱등 재요청 ───────────────────────────────────────────
  if (idempotencyKey) {
    const replay = await findReplay(identity.keyHash, idempotencyKey);
    if (replay) {
      return {
        status: 200,
        body: replay,
        log: {
          received: replay.received ?? received,
          accepted: replay.accepted ?? 0,
          rejected: replay.rejected ?? 0,
          batchId: replay.batch_id ?? null,
        },
        replayed: true,
      };
    }
  }

  // ── 1. 검증 재료 — 못 읽으면 503. 빈 집합으로 진행하지 않습니다 ──
  const { data: loaded, error: contextError } = await loadApiValidationContext(
    dataType,
    identity.keyHash,
  );

  if (!loaded) {
    console.error('[api] 검증 정보를 읽지 못했습니다:', dataType, contextError);
    return failure(
      503,
      'VALIDATION_CONTEXT_UNAVAILABLE',
      '검증에 필요한 마스터 정보를 읽지 못해 요청을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.',
      received,
    );
  }

  // ── 2. 검증 — 파일 업로드와 같은 함수 ───────────────────────
  const mapping = buildMappingWithSaved(dataType, request.data, loaded.savedMapping);
  const result = validate(dataType, request.data, mapping, loaded.context);

  const blocked = isBlocked(result, request.strict);
  const rowValid = stageableRows(result, request.strict);

  // ── 3. 적재 준비 ─────────────────────────────────────────────
  //
  // target_table · periodField · keyFields 는 보내지 않습니다.
  // core.api_stage_batch 가 data_type 에서 도출합니다 — 권한 검사와 쓰기 대상을
  // 갈라놓지 않기 위해서입니다 (sql/26 §2-2).
  const supabase = await createSupabaseServerClient();

  const { data: stageData, error: stageError } = await supabase
    .schema('core')
    .rpc('api_stage_batch', {
      p: {
        key_hash: identity.keyHash,
        data_type: dataType,
        mode: request.mode,
        period_from: request.periodFrom,
        period_to: request.periodTo,
        mapping,
        counts: {
          total: result.totalRows,
          success: blocked ? 0 : result.successRows,
          warning: result.warningRows,
          error: blocked ? result.totalRows : result.errorRows,
        },
        rows: result.rows.map((payload, index) => ({
          row_number: index + 1,
          payload,
          raw_row: request.data[index] ?? null,
          is_valid: rowValid[index] === true,
        })),
        errors: result.issues.map((issue) => ({
          row_number: issue.rowNumber,
          column_name: issue.column,
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          raw_row: issue.rowNumber > 0 ? (request.data[issue.rowNumber - 1] ?? null) : null,
        })),
      },
    });

  if (stageError) {
    console.error('[api] api_stage_batch 실패:', stageError.message);
    return failure(500, 'STAGE_FAILED', '적재 준비에 실패했습니다.', received);
  }

  const stageRow = (Array.isArray(stageData) ? stageData[0] : stageData) as
    | { ok?: boolean; batch_id?: string | null; message?: string }
    | null;

  if (stageRow?.ok !== true || !stageRow.batch_id) {
    // 이 함수가 돌려주는 거절 사유는 전부 호출자가 고칠 수 있는 내용입니다
    // (scope 부족 · 모르는 데이터 종류 · replace 기간 누락 등). 그대로 전합니다.
    const message = stageRow?.message ?? '적재 준비에 실패했습니다.';
    const status = message.indexOf('권한이 없습니다') >= 0 ? 403 : 400;
    return failure(status, status === 403 ? 'FORBIDDEN' : 'STAGE_REJECTED', message, received);
  }

  const batchId = stageRow.batch_id;

  // ── 4. 적재 — core.import_commit 과 같은 본문 (import_commit_internal) ──
  const { data: commitData, error: commitError } = await supabase
    .schema('core')
    .rpc('api_import_commit', { p_batch_id: batchId, p_key_hash: identity.keyHash });

  if (commitError) {
    console.error('[api] api_import_commit 실패:', commitError.message);
    return failure(500, 'COMMIT_FAILED', '적재에 실패했습니다.', received, batchId);
  }

  const commitRow = (Array.isArray(commitData) ? commitData[0] : commitData) as
    | { imported?: number | string; message?: string }
    | null;

  const importedRaw = Number(commitRow?.imported ?? 0);
  const imported = Number.isFinite(importedRaw) ? importedRaw : 0;

  // ★ 적재가 0인데 검증 오류도 없으면, 실패 사유가 응답에서 사라집니다 (리뷰 Important 5).
  //   200 · accepted:0 · errors:[] 를 받은 호출자는 "빈 요청" 과 "거절" 을 구분할 수 없습니다.
  //   커밋 함수가 준 사유를 담아 502 로 돌려줍니다. 그 문구는 이미
  //   core.api_import_commit 이 Postgres 원문을 걸러낸 뒤입니다 (sql/26 §7).
  if (imported === 0 && !blocked && result.errorRows === 0 && received > 0) {
    return failure(
      502,
      'COMMIT_REJECTED',
      commitRow?.message ?? '적재하지 못했습니다.',
      received,
      batchId,
    );
  }

  const body = buildInboundResponse({
    batchId,
    received,
    accepted: imported,
    issues: result.issues,
  });

  // 전량 거부(strict · 요청 단위 오류)는 422 입니다. 부분 성공은 200 입니다.
  const status = blocked ? 422 : 200;

  return {
    status,
    body,
    log: {
      received: body.received,
      accepted: body.accepted,
      rejected: body.rejected,
      batchId,
    },
    replayed: false,
  };
}
