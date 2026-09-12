// 데이터 관리 — 파일 적재와 이력
//
// ★ Task 15 — 실습용으로 적재된 배치는 이력 행에 '실습용' 배지를 붙입니다. 파일명에도
//   '[실습용 …]' 접두어가 붙어 있지만, 파일명은 올린 사람이 아무렇게나 적을 수 있으므로 배지는
//   등기부(core.practice_object)를 보고 답합니다 — 이름이 아니라 등록 사실이 근거입니다.

import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import ImportManager from '@/components/admin/import-manager';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getPracticeBatchIds } from '@/lib/practice/repository';

export default async function DataManagementPage() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const [{ data }, practiceBatchIds] = await Promise.all([
    supabase
      .schema('core')
      .from('upload_batch')
      .select('batch_id,file_name,import_type,import_mode,total_rows,success_rows,warning_rows,error_rows,status,uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(20),
    getPracticeBatchIds(),
  ]);

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="데이터 관리" description="파일 적재 전 Preview·매핑·검증을 확인합니다." />
      <Panel title="File Upload"><ImportManager /></Panel>
      <Panel title="Import History" description="'실습용' 배지가 붙은 배치는 수업 실습용으로 넣은 데이터입니다(실제 실적이 아닙니다).">
        <div className="analysis-table-wrap">
          <table className="analysis-table">
            <thead>
              <tr><th>파일</th><th>타입</th><th>모드</th><th>총 행</th><th>성공</th><th>경고</th><th>오류</th><th>상태</th></tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.batch_id}>
                  <td>
                    {r.file_name}
                    {practiceBatchIds.has(String(r.batch_id))
                      ? <> <span className="tag amber" title="실습용 데이터 묶음이 적재한 배치입니다.">실습용</span></>
                      : null}
                  </td>
                  <td>{r.import_type}</td>
                  <td>{r.import_mode}</td>
                  <td>{r.total_rows}</td>
                  <td>{r.success_rows}</td>
                  <td>{r.warning_rows}</td>
                  <td>{r.error_rows}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}
