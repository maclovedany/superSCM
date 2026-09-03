// API 검증 재료 — renew.prd 9.1 · 8.3
//
// ★ 왜 lib/import/repository.ts 의 loadValidationContext 를 그대로 쓰지 않는가
//
//   그 함수는 core.v_item_master · analytics.v_leadtime_gap · analytics.v_raw_schema ·
//   core.column_mapping 을 **직접 select** 합니다. Route Handler 에는 세션이 없어
//   그 조회가 anon 으로 나가는데, sql/28-anon-lockdown.sql 이 anon 에게서 뷰를 전부 거둡니다.
//
//   그리고 조용히 깨집니다. loadValidationContext 는 오류를 `.data ?? []` 로 삼켜
//   빈 집합을 돌려주고, lib/import/validate.ts 의 `size > 0` 가드가 그 빈 집합을 보고
//   UNKNOWN_ITEM · UNKNOWN_SUPPLIER · 대상 컬럼 검사를 **건너뜁니다.**
//   그러면 파일 업로드가 거절하는 행을 API 가 받아들입니다 — 규칙이 두 벌이 됩니다.
//
//   그래서 **같은 네 곳**을 키 해시로 인증한 뒤 대신 읽어주는 security definer 함수
//   (core.api_validation_context, sql/26 §7-2)를 부릅니다.
//   읽는 곳이 같으므로 규칙은 한 벌 그대로입니다. 검증 자체는 여전히
//   lib/import/validate.ts 만 합니다 — 이 파일은 재료만 모읍니다.
//
//   `lib/api/context-parity.test.ts` 가 두 파일이 같은 뷰를 보는지 대조합니다.
//
// ★ 비어 있으면 진행하지 않습니다.
//   마스터를 못 읽은 것과 "품목이 하나도 없는 것" 을 구분할 수 없으므로,
//   빈 컨텍스트로는 검증하지 않고 503 을 돌려줍니다 (ingest 가 판정합니다).

import { createSupabaseServerClient } from '../supabase/server';
import { TABLE_SPECS, autoMap } from '../import/schema';
import type { DataType, SourceRow, ValidationContext } from '../import/types';
import { collectColumns, referencedMasters } from './inbound-model.ts';

export type ApiValidationContext = {
  context: ValidationContext;
  /** renew.prd 8.2 — 관리자가 저장해 둔 매핑 규칙 */
  savedMapping: Record<string, string>;
};

/**
 * 검증 재료를 모읍니다.
 *
 * 읽지 못했으면 `null` 입니다. 빈 집합으로 대신하지 않습니다.
 */
export async function loadApiValidationContext(
  dataType: DataType,
  keyHash: string,
): Promise<{ data: ApiValidationContext | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('api_validation_context', {
      p_key_hash: keyHash,
      p_data_type: dataType,
    });

    if (error) return { data: null, error: error.message };

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          item_ids?: unknown;
          supplier_ids?: unknown;
          target_columns?: unknown;
          saved_mapping?: unknown;
        }
      | null;

    // 0행 = 키를 확인하지 못했거나 모르는 데이터 종류입니다.
    if (!row) return { data: null, error: '검증 정보를 읽지 못했습니다.' };

    const itemIds = toStringSet(row.item_ids);
    const supplierIds = toStringSet(row.supplier_ids);
    const targetColumns = toStringSet(row.target_columns);

    // ★ 대상 컬럼이 비면 적재할 컬럼을 하나도 모르는 상태입니다.
    //   실재하는 raw 테이블은 컬럼이 비는 일이 없으므로, 이것은 곧 "권한이 없어 못 읽었다" 입니다.
    //   모든 데이터 종류에 대해 검사합니다.
    if (targetColumns.size === 0) {
      return { data: null, error: '검증에 필요한 대상 테이블 정보를 읽지 못했습니다.' };
    }

    // ★ 품목 마스터는 **그 종류가 실제로 참조할 때만** 요구합니다 (재리뷰 A).
    //
    //   비었을 때 막는 이유는 validate.ts 의 `knownItemIds.size > 0` 가드 때문입니다.
    //   집합이 비면 UNKNOWN_ITEM 검사가 통째로 꺼지고, 그것은 **행을 거절하던 검사**입니다.
    //   "못 읽었다" 와 "정말 비었다" 를 구분할 수 없으므로 진행하지 않습니다.
    //
    //   그런데 ITEM_MASTER · SUPPLIER_MASTER 는 자기 id 필드의 references 가 undefined 라
    //   그 집합을 **애초에 보지 않습니다** (lib/import/schema.ts 의 `{ ...ITEM, references: undefined }`).
    //   종류를 가리지 않고 막으면 **빈 데이터베이스에서 품목 마스터를 넣어야 품목 마스터를
    //   넣을 수 있는** 상태가 됩니다 — 새 연동이 시작하는 바로 그 상태이고, 파일 업로드에는
    //   같은 차단이 없어 규칙이 두 벌이 됩니다.
    //
    //   그래서 스키마에 물어봅니다. 하드코딩하지 않습니다.
    //
    // ★ 공급처 마스터는 비어도 막지 않습니다.
    //   validate.ts 의 UNKNOWN_SUPPLIER 는 severity 'WARNING' 이고 `hasError` 를 세우지
    //   않습니다 (validate.ts §2). 즉 집합이 비어도 **적재 여부가 달라지지 않습니다** —
    //   경고 한 줄이 덜 붙을 뿐입니다. 여기서 막으면, 공급처를 아직 안 넣은 새 DB 에서
    //   `POST /api/v1/items` 가 503 이 되어 A 와 같은 교착이 한 겹 뒤로 옮겨갈 뿐입니다.
    if (referencedMasters(dataType).item && itemIds.size === 0) {
      return { data: null, error: '품목 마스터를 읽지 못했습니다.' };
    }

    const savedMapping: Record<string, string> = {};
    const raw = row.saved_mapping;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [source, target] of Object.entries(raw as Record<string, unknown>)) {
        savedMapping[source] = String(target);
      }
    }

    return {
      data: {
        context: { knownItemIds: itemIds, knownSupplierIds: supplierIds, targetColumns },
        savedMapping,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : '검증 정보를 읽지 못했습니다.',
    };
  }
}

function toStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item) => item !== null && item !== undefined).map((item) => String(item)));
}

/**
 * 자동 매핑 위에 저장해 둔 규칙을 덮어씁니다 — renew.prd 8.2.
 *
 * `app/(admin)/admin/data/upload/actions.ts` 의 파일 업로드와 **같은 순서**입니다.
 * 한쪽만 바뀌면 관리자가 고친 별칭이 파일에는 먹고 API 에는 안 먹습니다 (리뷰 Minor 8).
 */
export function buildMappingWithSaved(
  dataType: DataType,
  rows: SourceRow[],
  savedMapping: Record<string, string>,
): Record<string, string> {
  const columns = collectColumns(rows);
  const mapping: Record<string, string> = { ...autoMap(TABLE_SPECS[dataType], columns) };
  for (const column of columns) {
    if (savedMapping[column]) mapping[column] = savedMapping[column];
  }
  return mapping;
}
