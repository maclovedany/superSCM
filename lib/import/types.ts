// Task 7 — demand_line 은 부서 수요 제출 전용이며 core.upload_batch import_type 체크에는 없다.
// 관리자 일괄 적재(STEP 4)를 거치지 않고 lib/demand 가 검증 로직만 재사용한다.
export const IMPORT_TYPES = ['usage_history', 'inventory', 'item_master', 'supplier_master', 'purchase_order', 'goods_receipt', 'sales_order', 'business_event', 'demand_line'] as const;
export type ImportType = typeof IMPORT_TYPES[number];
export type ImportMode = 'append' | 'upsert' | 'replace';
export type Severity = 'SUCCESS' | 'WARNING' | 'ERROR';
export type ImportRow = Record<string, unknown>;
export type ValidationIssue = { rowNumber: number; fieldName: string; code: string; message: string; severity: Exclude<Severity, 'SUCCESS'>; originalValue: unknown };
export type ValidatedRow = { rowNumber: number; data: ImportRow; issues: ValidationIssue[] };
export type ValidationResult = { rows: ValidatedRow[]; issues: ValidationIssue[]; summary: { totalRows: number; successRows: number; warningRows: number; errorRows: number } };
export type ImportReferences = { itemIds: Set<string>; supplierIds: Set<string>; inventoryStatuses: Set<string> };
