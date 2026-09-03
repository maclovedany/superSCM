// 파일 업로드 — renew.prd 8장
//
// 브라우저에서 파싱하지 않습니다. 파일을 서버로 보내고 서버가 파싱·검증합니다.

import PageHeader, { MetaChip } from '@/components/shell/page-header';
import InsightBanner from '@/components/ui/insight-banner';
import UploadForm from './upload-form';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DATA_TYPES, TABLE_SPECS } from '@/lib/import/schema';

export const dynamic = 'force-dynamic';

/** 대상 테이블에 실제로 있는 컬럼. 화면에 몇 개인지 보여줍니다 */
async function loadTargetColumns(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .schema('analytics')
      .from('v_raw_schema')
      .select('table_name, column_name');

    const byTable = new Map<string, string[]>();
    for (const row of data ?? []) {
      const typed = row as { table_name: string; column_name: string };
      const list = byTable.get(typed.table_name) ?? [];
      list.push(typed.column_name);
      byTable.set(typed.table_name, list);
    }
    for (const type of DATA_TYPES) {
      result[type] = byTable.get(TABLE_SPECS[type].targetTable) ?? [];
    }
  } catch {
    for (const type of DATA_TYPES) result[type] = [];
  }
  return result;
}

export default async function UploadPage() {
  const targetColumnsByType = await loadTargetColumns();

  return (
    <>
      <PageHeader
        title="파일 업로드"
        subtitle="CSV · Excel · JSON 을 올리면 컬럼을 자동으로 맞추고 행 단위로 검증합니다. 오류가 있는 행은 임의로 고치지 않고 그대로 알려드립니다."
        meta={
          <>
            <MetaChip>PRD 8</MetaChip>
            <MetaChip>STEP 4</MetaChip>
          </>
        }
      />

      <InsightBanner eyebrow="IMPORT PIPELINE">
        검증 규칙은 <span className="t-code">lib/import/validate.ts</span> 한 곳에 있습니다. STEP 19 의
        External API 도 <b>같은 함수</b>를 호출하므로, 파일로 통과한 데이터는 API 로도 통과합니다. 적재한 뒤에는{' '}
        <b>배치 단위로 되돌릴 수 있습니다.</b>
      </InsightBanner>

      <UploadForm targetColumnsByType={targetColumnsByType} />
    </>
  );
}
