// 실습용 데이터 — Task 15
//
// ★ 조회 전용 화면입니다. 실습 데이터를 **만들거나 지우는 버튼을 두지 않았습니다.** 제거는 배포
//   DB에서 여러 표를 한꺼번에 지우는 되돌릴 수 없는 작업이라, 버튼 하나로 실행되면 안 됩니다 —
//   문서화된 SQL(supabase/practice-data/99-remove.sql)로만 합니다. 이 화면은 "지금 무엇이 실습용인지"와
//   "어떻게 지우는지"를 보여 줍니다.

import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import DataTable, { type Column } from '@/components/ui/data-table';
import KpiCard from '@/components/ui/kpi-card';
import { requireAdmin } from '@/lib/auth';
import { practiceObjectKindLabel, type PracticeDataset, type PracticeObject } from '@/lib/practice/model';
import {
  getPracticeDataStatus,
  getPracticeDatasets,
  getPracticeObjects,
  getPracticeRetiredUsage,
} from '@/lib/practice/repository';

export const dynamic = 'force-dynamic';

const datasetColumns: Column<PracticeDataset>[] = [
  { key: 'label', label: '라벨', render: (row) => <b>{row.label}</b> },
  {
    key: 'active', label: '상태', align: 'center',
    render: (row) => row.active ? <span className="tag amber">적용 중</span> : <span className="tag gray">제거됨</span>,
  },
  { key: 'nObjects', label: '등기 객체', align: 'right', render: (row) => row.nObjects.toLocaleString('ko-KR') },
  { key: 'createdAt', label: '생성', render: (row) => <span className="muted">{row.createdAt ?? '—'}</span> },
  { key: 'removedAt', label: '제거', render: (row) => <span className="muted">{row.removedAt ?? '—'}</span> },
  { key: 'note', label: '설명', render: (row) => row.note ?? <span className="muted">—</span> },
];

const objectColumns: Column<PracticeObject>[] = [
  { key: 'objectKind', label: '종류', render: (row) => practiceObjectKindLabel(row.objectKind) },
  { key: 'objectKey', label: '식별자', render: (row) => <code>{row.objectKey}</code> },
  { key: 'note', label: '비고', render: (row) => row.note ?? <span className="muted">—</span> },
  { key: 'label', label: '묶음', render: (row) => <span className="muted">{row.label}</span> },
];

export default async function PracticeDataPage() {
  await requireAdmin();
  const [{ status, error: statusError }, datasets, objects, retired] = await Promise.all([
    getPracticeDataStatus(),
    getPracticeDatasets(),
    getPracticeObjects(),
    getPracticeRetiredUsage(),
  ]);
  const error = statusError ?? datasets.error ?? objects.error ?? retired.error;

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="ADMIN"
        title="실습용 데이터"
        description="수업 실습을 위해 넣은 데이터가 무엇인지, 어떤 화면의 숫자에 영향을 주는지, 어떻게 제거하는지를 봅니다."
      />
      <div className="analysis-content">
        {error ? (
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{error}</p>
            <p className="muted">20260912000400_stage1_practice_dataset.sql이 적용되었는지 확인하세요.</p>
          </div>
        ) : status === null || !status.hasPracticeData ? (
          <div className="card">
            <p className="muted">
              실습용 데이터가 없습니다. 화면의 숫자는 모두 실데이터에서 나온 것이거나, 근거가 없으면 사유 코드로 표시됩니다.
            </p>
            <p className="muted">넣으려면 <code>supabase/practice-data/README.md</code>의 순서를 따르세요.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-4">
              <KpiCard label="실습 묶음" value={status.label ?? '—'} foot={status.active ? '적용 중' : '제거됨 · 일부 기록 잔존'} status={status.active ? 'WARNING' : 'CALCULATION_UNAVAILABLE'} />
              <KpiCard label="실습 품목" value={status.nItems} foot="raw.dim_item에서 고른 실제 품목코드" />
              <KpiCard label="실습 적재 배치" value={status.nBatches} foot="STEP 4 경로로 적재됨" />
              <KpiCard label="등기 객체" value={status.nObjects} foot="제거 대상 전체" />
            </div>

            <Panel title="영향받는 화면" description="이 화면들은 상단에 '이 화면의 숫자는 실습용 데이터 기반입니다' 배너를 띄웁니다.">
              <ul className="notice-list">
                <li>재고 · 주문 가능 수량 — {status.affectsInventory ? '영향 있음' : '영향 없음'}</li>
                <li>발주계획 — {status.affectsProcurementPlan ? '영향 있음' : '영향 없음'}</li>
                <li>월말 재고 성과 — {status.affectsMonthEndKpi ? '영향 있음' : '영향 없음'}</li>
              </ul>
            </Panel>

            {retired.rows.length > 0 ? (
              <Panel
                title="정리해 보관 중인 5회차 더미 사용 이력"
                description="지우지 않고 옮겨 둔 것입니다. 실습 묶음을 제거하면 raw.usage_history로 자동 복구됩니다."
              >
                <ul className="notice-list">
                  {retired.rows.map((row) => (
                    <li key={row.label}>
                      <b>{row.retiredRows.toLocaleString('ko-KR')}행</b> 보관 중 · 기간{' '}
                      {row.minUseDate ?? '—'} ~ {row.maxUseDate ?? '—'} · 묶음 {row.label}
                      {row.retiredAt ? <span className="muted"> · {row.retiredAt}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  이 정리 덕분에 실습 학습 기간이 실제 달력 월에 놓입니다. 복구는 제거 명령이 함께 처리하므로
                  별도 작업이 필요 없습니다(<code>supabase/practice-data/00b-retire-legacy-usage.sql</code>).
                </p>
              </Panel>
            ) : null}

            <Panel title="실습 묶음">
              <DataTable columns={datasetColumns} rows={datasets.rows} rowKey={(row) => row.datasetId} empty="실습 묶음이 없습니다." />
            </Panel>

            <Panel
              title="등기된 객체"
              description="제거 절차는 이 목록에 있는 것만 지웁니다. 실데이터는 여기 없으므로 지워질 수 없습니다."
            >
              <DataTable columns={objectColumns} rows={objects.rows} rowKey={(row) => row.objectId} empty="등기된 객체가 없습니다." />
            </Panel>

            <Panel title="제거 방법" description="화면에 버튼을 두지 않았습니다 — 되돌릴 수 없는 작업이라 SQL로만 실행합니다.">
              <p className="muted">Supabase SQL Editor에서 관리자 자격으로 실행합니다.</p>
              <pre className="master-history-item">
{`select jsonb_pretty(core.remove_practice_dataset('${status.label ?? '<실습 묶음 라벨>'}', p_confirm => true));`}
              </pre>
              <p className="muted">
                무엇이 지워졌고(<code>removed</code>) 무엇이 왜 남았는지(<code>blocked</code>)를 JSON으로 돌려줍니다.
                승인된 발주계획처럼 설계상 지울 수 없는 기록과, 학생이 이미 업무를 한 품목은 남습니다 —
                그 경우 등기도 함께 남겨 화면이 계속 실습용으로 표시합니다.
                전체 절차와 확인 쿼리는 <code>supabase/practice-data/99-remove.sql</code>에 있습니다.
              </p>
            </Panel>
          </>
        )}
      </div>
    </section>
  );
}
