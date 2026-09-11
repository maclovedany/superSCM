// Task 7 — demand_line 은 부서 수요 제출 전용이며 core.upload_batch import_type 체크에는 없다.
// 관리자 일괄 적재(STEP 4)를 거치지 않고 lib/demand 가 검증 로직(IMPORT_SCHEMAS · validateRows)만
// 재사용한다. IMPORT_TYPES는 그 재사용을 위해 demand_line을 포함한 "검증 스키마 종류" 전체다.
export const IMPORT_TYPES = ['usage_history', 'inventory', 'item_master', 'supplier_master', 'purchase_order', 'goods_receipt', 'sales_order', 'business_event', 'demand_line'] as const;
export type ImportType = typeof IMPORT_TYPES[number];

// fix round 1 — admin STEP 4 배치 업로드(app/api/admin/imports/*)는 이 좁은 목록으로만
// 게이트한다. IMPORT_TYPES(위)로 게이트하면 demand_line이 통과해 core.upload_batch.import_type
// CHECK 제약(demand_line을 모른다)에서 막혀 원시 500으로 샌다 — 여기서 먼저 평범한 400으로
// 거절한다.
export const ADMIN_BATCH_IMPORT_TYPES = ['usage_history', 'inventory', 'item_master', 'supplier_master', 'purchase_order', 'goods_receipt', 'sales_order', 'business_event'] as const;
export type AdminBatchImportType = (typeof ADMIN_BATCH_IMPORT_TYPES)[number];
export type ImportMode = 'append' | 'upsert' | 'replace';
export type Severity = 'SUCCESS' | 'WARNING' | 'ERROR';
export type ImportRow = Record<string, unknown>;
export type ValidationIssue = { rowNumber: number; fieldName: string; code: string; message: string; severity: Exclude<Severity, 'SUCCESS'>; originalValue: unknown };
export type ValidatedRow = { rowNumber: number; data: ImportRow; issues: ValidationIssue[] };
export type ValidationResult = { rows: ValidatedRow[]; issues: ValidationIssue[]; summary: { totalRows: number; successRows: number; warningRows: number; errorRows: number } };
export type ImportReferences = { itemIds: Set<string>; supplierIds: Set<string>; inventoryStatuses: Set<string> };
