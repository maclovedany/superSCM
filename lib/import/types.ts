// 적재 파이프라인 공통 타입 — renew.prd 8장
//
// 이 타입들은 File Upload 와 External API(STEP 19)가 함께 씁니다.

/** renew.prd 8.1 — 지원 데이터 종류 */
export type DataType =
  | 'DEMAND'
  | 'INVENTORY'
  | 'PURCHASE_ORDER'
  | 'RECEIPT'
  | 'ITEM_MASTER'
  | 'SUPPLIER_MASTER'
  | 'EVENT'
  | 'SALES_ORDER';

/** renew.prd 8.4 */
export type ImportMode = 'append' | 'replace' | 'upsert';

/** renew.prd 8.5 */
export type SourceType =
  | 'MANUAL_CSV'
  | 'MANUAL_EXCEL'
  | 'MANUAL_JSON'
  | 'API'
  | 'ERP'
  | 'BATCH';

export type Severity = 'ERROR' | 'WARNING';

/** 검증 오류 코드. 화면 문구는 lib/import/messages 가 아니라 여기 message 에 담습니다. */
export type IssueCode =
  | 'MISSING_COLUMN'
  | 'REQUIRED'
  | 'INVALID_NUMBER'
  | 'INVALID_DATE'
  | 'NEGATIVE'
  | 'DUPLICATE'
  | 'UNKNOWN_ITEM'
  | 'UNKNOWN_SUPPLIER'
  | 'DATE_ORDER'
  | 'OUT_OF_RANGE'
  | 'UNMAPPED_COLUMN';

export type ValidationIssue = {
  /** 1부터 시작하는 데이터 행 번호. 헤더는 세지 않습니다 */
  rowNumber: number;
  column: string | null;
  severity: Severity;
  code: IssueCode;
  message: string;
};

/** 원본 한 행. 값은 파서가 준 그대로입니다 */
export type SourceRow = Record<string, unknown>;

/** 매핑을 적용한 한 행 */
export type MappedRow = Record<string, unknown>;

export type ParseResult = {
  columns: string[];
  rows: SourceRow[];
  /** 파싱 자체가 실패한 경우 */
  error: string | null;
};

/** 검증에 필요한 외부 정보. 순수 함수로 두기 위해 밖에서 주입합니다 */
export type ValidationContext = {
  knownItemIds: Set<string>;
  knownSupplierIds: Set<string>;
  /** 대상 테이블에 실제로 있는 컬럼. 없는 컬럼은 적재하지 않습니다 */
  targetColumns: Set<string>;
};

export type ValidationResult = {
  issues: ValidationIssue[];
  /** 매핑과 형 변환을 마친 행. 오류가 있어도 그대로 담깁니다(부분 성공 지원) */
  rows: MappedRow[];
  /** rows[i] 가 적재 가능한지 */
  rowValid: boolean[];
  totalRows: number;
  errorRows: number;
  warningRows: number;
  successRows: number;
};
