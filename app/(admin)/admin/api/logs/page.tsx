// API 호출 기록 — renew.prd 9
//
// 외부 연동이 무엇을 언제 불렀고 몇 행이 들어갔는지 봅니다.
//
// ★ 이 화면에 키 원문도 해시도 나오지 않습니다. analytics.v_api_log 에 두 컬럼이 없습니다.
//
// ★ 인증되지 않은 호출은 이 표에 **없습니다.** 아무나 부를 수 있는 경로라
//   행으로 남기면 이 테이블을 무한히 키우고 아래 KPI 를 마음대로 흔들 수 있습니다.
//   그래서 core.api_anon_stat 에 (날짜, 상태코드) 카운터로만 세고,
//   그 합계를 '인증 실패' 카드에 보여줍니다 (sql/26 §1).

import { Activity, AlertTriangle, ServerCrash, Rows3, KeyRound } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { type Column, formatNumber } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { getApiKpi, getApiLogs, type ApiLogRow } from '@/lib/api/keys';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import type { Tone } from '@/lib/status';

export const dynamic = 'force-dynamic';

function toneOf(status: number | null): Tone {
  if (status === null) return 'unknown';
  if (status >= 500) return 'crit';
  if (status === 429) return 'warn';
  if (status >= 400) return 'warn';
  return 'safe';
}

/** 오늘 안에 일어난 호출인가. KPI 는 DB 가 세고, 목록 필터는 여기서 같은 기준을 씁니다 */
function isToday(row: ApiLogRow): boolean {
  if (!row.at) return false;
  return row.at.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<ApiLogRow>[] = [
  { key: 'all', label: '전체 호출', match: null },
  { key: 'today', label: '오늘 호출', match: isToday },
  {
    key: 'client',
    label: '거절된 호출 (4xx)',
    match: (row) => row.status !== null && row.status >= 400 && row.status <= 499,
  },
  { key: 'server', label: '서버 오류 (5xx)', match: (row) => row.status !== null && row.status >= 500 },
];

const COLUMNS: Column<ApiLogRow>[] = [
  {
    key: 'at',
    label: '시각',
    render: (row) => (row.at ? <span>{row.at.slice(0, 19).replace('T', ' ')}</span> : <EmptyValue />),
  },
  {
    key: 'integrationName',
    label: '연동',
    variant: 'strong',
    render: (row) =>
      row.integrationName ? (
        <span>{row.integrationName}</span>
      ) : (
        // 키가 폐기되어 이름을 잃은 행입니다. 지어내지 않습니다.
        <EmptyValue />
      ),
  },
  { key: 'method', label: '메서드', variant: 'code', render: (row) => row.method ?? '—' },
  { key: 'path', label: '경로', variant: 'code', render: (row) => row.path ?? '—' },
  {
    key: 'status',
    label: '상태',
    render: (row) =>
      row.status === null ? <EmptyValue /> : <Badge tone={toneOf(row.status)}>{row.status}</Badge>,
  },
  {
    key: 'durationMs',
    label: '소요',
    align: 'right',
    variant: 'num',
    render: (row) => (row.durationMs === null ? <EmptyValue align="right" /> : formatNumber(row.durationMs, 'ms')),
  },
  {
    key: 'received',
    label: '받음',
    align: 'right',
    variant: 'num',
    render: (row) => (row.received === null ? <EmptyValue align="right" /> : formatNumber(row.received)),
  },
  {
    key: 'accepted',
    label: '적재',
    align: 'right',
    variant: 'num',
    render: (row) => (row.accepted === null ? <EmptyValue align="right" /> : formatNumber(row.accepted)),
  },
  {
    key: 'rejected',
    label: '거절',
    align: 'right',
    variant: 'num',
    render: (row) =>
      row.rejected === null ? (
        <EmptyValue align="right" />
      ) : (
        <span className={row.rejected > 0 ? 'hl-warn' : undefined}>{formatNumber(row.rejected)}</span>
      ),
  },
  {
    key: 'batchId',
    label: '배치',
    variant: 'code',
    render: (row) => (row.batchId ? <span>{row.batchId}</span> : <EmptyValue />),
  },
];

export default async function ApiLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { data: kpi, error: kpiError }] = await Promise.all([
    getApiLogs(500),
    getApiKpi(),
  ]);

  const header = (
    <PageHeader
      title="API 호출 기록"
      subtitle="외부 연동이 무엇을 언제 불렀고 몇 행이 들어갔는지 봅니다. 인증에 실패한 호출도 남습니다."
      meta={
        <>
          <MetaChip>PRD 9</MetaChip>
          <MetaChip>STEP 19</MetaChip>
        </>
      }
    />
  );

  if (error) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={error} />
        </Panel>
      </>
    );
  }

  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="오늘 호출"
          value={kpi?.callsToday ?? null}
          unit="건"
          icon={Activity}
          foot={kpiError ? '조회하지 못했습니다' : `누적 ${(kpi?.callsTotal ?? 0).toLocaleString()}건`}
          filter={{ key: 'today', active: activeFilter === 'today' }}
        />
        <KpiCard
          label="오늘 거절 (4xx)"
          value={kpi?.clientErrorToday ?? null}
          unit="건"
          icon={AlertTriangle}
          tone={(kpi?.clientErrorToday ?? 0) > 0 ? 'warn' : 'default'}
          foot="인증 · 권한 · 본문 오류"
          filter={{ key: 'client', active: activeFilter === 'client' }}
        />
        <KpiCard
          label="오늘 서버 오류 (5xx)"
          value={kpi?.serverErrorToday ?? null}
          unit="건"
          icon={ServerCrash}
          tone={(kpi?.serverErrorToday ?? 0) > 0 ? 'crit' : 'default'}
          foot="우리 쪽 문제입니다"
          filter={{ key: 'server', active: activeFilter === 'server' }}
        />
        <KpiCard
          label="오늘 적재된 행"
          value={kpi?.acceptedToday ?? null}
          unit="행"
          icon={Rows3}
          foot={`거절 ${(kpi?.rejectedToday ?? 0).toLocaleString()}행 · 사용 중인 키 ${(kpi?.activeKeys ?? 0).toLocaleString()}개`}
        />
        <KpiCard
          label="오늘 인증 실패"
          value={kpi?.anonToday ?? null}
          unit="건"
          icon={KeyRound}
          tone={(kpi?.anonToday ?? 0) > 0 ? 'warn' : 'default'}
          foot="아래 표에 나오지 않습니다 (건수만 셉니다)"
        />
      </div>

      <InsightBanner eyebrow="API LOG">
        <b>4xx 가 늘면 연동 쪽</b> 문제입니다 — 만료된 키(401) · 권한이 없는 경로(403) ·
        분당 한도 초과(429)를 먼저 보세요. <b className="hl-crit">5xx</b> 는 우리 쪽 문제이므로 배치 번호로
        적재 이력을 따라가면 어디서 멈췄는지 보입니다. 같은{' '}
        <span className="t-code">Idempotency-Key</span> 로 다시 들어온 요청은 적재하지 않고 지난 응답을
        그대로 돌려주므로, 재시도해도 행이 두 번 들어가지 않습니다.
      </InsightBanner>

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      <Panel
        title="최근 호출"
        actions={<span className="t-label">analytics.v_api_log — 최근 500건</span>}
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            title="호출 기록이 없습니다"
            desc="아직 외부 시스템이 /api/v1 을 부르지 않았습니다. sql/26-api.sql 을 실행했는지도 확인해주세요."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 호출이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={visible}
            rowKey={(row) => String(row.id)}
            caption="analytics.v_api_log — API 호출 기록"
          />
        )}
      </Panel>
    </>
  );
}
