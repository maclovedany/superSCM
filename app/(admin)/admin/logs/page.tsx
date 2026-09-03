// 시스템 로그 — renew.prd 31.1
//
// "모든 수정과 승인에 근거와 이력이 남는다."
//
// 감사 로그(core.audit_log) · 외부 API 호출(core.api_log) · AI 답변(core.agent_message)
// 세 갈래를 한 표로 봅니다. 합치는 일은 SQL 이 합니다 (analytics.v_system_log).
// 뷰가 최근 1,000건으로 이미 잘라 두었으므로, 갈래 필터와 검색은 그 안에서 걸립니다.
//
// ★ 관리자에게만 행이 나옵니다. 뷰 안에서 core.is_admin() 이 막습니다 — 화면이 아니라
//   DB 가 막아야 URL 을 직접 열어도 새지 않습니다.

import { Bot, PlugZap, ScrollText, Search } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { requireAdmin } from '@/lib/auth';
import { detailSummary, getSystemLogs, logKindLabel, type SystemLogRow } from '@/lib/admin-ops';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import type { Tone } from '@/lib/status';

export const dynamic = 'force-dynamic';

/** analytics.v_system_log 가 뷰 안에서 자르는 건수와 같아야 합니다 (sql/27 §8-5) */
const SYSTEM_LOG_LIMIT = 1000;

const KIND_TONE: Record<string, Tone> = {
  AUDIT: 'info',
  API: 'plain',
  AGENT: 'safe',
};

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<SystemLogRow>[] = [
  { key: 'all', label: '전체 기록', match: null },
  { key: 'audit', label: '감사 로그', match: (row) => row.kind === 'AUDIT' },
  { key: 'api', label: '외부 API', match: (row) => row.kind === 'API' },
  { key: 'agent', label: 'AI 답변', match: (row) => row.kind === 'AGENT' },
];

const columns: Column<SystemLogRow>[] = [
  {
    key: 'at',
    label: '시각',
    variant: 'num',
    render: (row) => (row.at ? row.at.slice(0, 19).replace('T', ' ') : '—'),
  },
  {
    key: 'kind',
    label: '갈래',
    render: (row) => (
      <Badge tone={row.kind === null ? 'unknown' : KIND_TONE[row.kind]}>
        {logKindLabel(row.kind) ?? '알 수 없음'}
      </Badge>
    ),
  },
  {
    key: 'actor',
    label: '누가',
    render: (row) => row.actor?.split('@')[0] ?? <span className="text-3">—</span>,
  },
  { key: 'action', label: '무엇을', variant: 'code', render: (row) => row.action ?? '—' },
  {
    key: 'target',
    label: '대상',
    variant: 'code',
    render: (row) => row.target ?? <span className="text-3">—</span>,
  },
  {
    key: 'detail',
    label: '내용',
    render: (row) => {
      const summary = detailSummary(row.detail);
      return summary === null ? <span className="text-3">—</span> : <span className="t-sm">{summary}</span>;
    },
  },
];

function param(params: SearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function SystemLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const activeFilter = readFilter(params);
  const q = (param(params, 'q') ?? '').trim();

  // 검색은 SQL 이 합니다 (뷰가 만든 search_text 한 컬럼). 갈래는 받아 온 목록에서
  // 좁힙니다 — 그래야 카드의 건수와 목록이 같은 집합을 셉니다.
  //
  // ★ 뷰가 자른 것과 같은 1,000 을 명시합니다 (STEP 20 수정 라운드 1).
  //   기본값 300 으로 두면 머리글 칩은 "최근 1,000건" 인데 "전체 기록" 카드는 많아야
  //   300 을 세어, 화면이 스스로와 어긋납니다.
  const { rows, error } = await getSystemLogs(null, q === '' ? null : q, SYSTEM_LOG_LIMIT);

  const header = (
    <PageHeader
      title="시스템 로그"
      subtitle="누가 · 언제 · 무엇을 바꿨는지, 외부에서 무엇을 불렀는지, AI 가 무엇을 답했는지를 한 표로 봅니다."
      meta={
        <>
          <MetaChip>PRD 31.1</MetaChip>
          <MetaChip>STEP 20</MetaChip>
          <MetaChip>{`최근 ${SYSTEM_LOG_LIMIT.toLocaleString()}건`}</MetaChip>
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

  const audit = rows.filter((row) => row.kind === 'AUDIT').length;
  const api = rows.filter((row) => row.kind === 'API').length;
  const agent = rows.filter((row) => row.kind === 'AGENT').length;
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="전체 기록"
          value={rows.length}
          unit="건"
          icon={ScrollText}
          foot={
            q === ''
              ? `최근 ${SYSTEM_LOG_LIMIT.toLocaleString()}건 안`
              : `"${q}" 로 검색한 결과`
          }
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="감사 로그"
          value={audit}
          unit="건"
          icon={ScrollText}
          foot="사람이 바꾼 것"
          filter={{ key: 'audit', active: activeFilter === 'audit' }}
        />
        <KpiCard
          label="외부 API"
          value={api}
          unit="건"
          icon={PlugZap}
          foot="API 키로 들어온 호출"
          filter={{ key: 'api', active: activeFilter === 'api' }}
        />
        <KpiCard
          label="AI 답변"
          value={agent}
          unit="건"
          icon={Bot}
          foot="Agent 가 낸 답"
          filter={{ key: 'agent', active: activeFilter === 'agent' }}
        />
      </div>

      <Panel title="검색">
        {/*
          평범한 GET 폼입니다. 상태가 URL 에 남아 링크를 공유할 수 있고, 화면은
          서버 컴포넌트로 남습니다 (lib/filter.ts 의 KPI 필터와 같은 이유).
        */}
        <form method="get" style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          {activeFilter && <input type="hidden" name="filter" value={activeFilter} />}
          <div className="field" style={{ flex: '1 1 18rem' }}>
            <label className="t-label" htmlFor="q">
              사용자 · 동작 · 대상 · 내용
            </label>
            <input id="q" name="q" defaultValue={q} placeholder="예: ITEM003 · 승인 · admin@" />
          </div>
          <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'flex-end' }}>
            <button type="submit" className="btn primary">
              <Search size={15} aria-hidden />
              찾기
            </button>
          </div>
        </form>
      </Panel>

      <InsightBanner eyebrow="AUDIT TRAIL">
        감사 로그는 <b>전/후 값을 함께</b> 남깁니다. 판정이 왜 달라졌는지를 나중에 찾을 수 있어야 하기
        때문입니다. 이 표는 최근 <b>{SYSTEM_LOG_LIMIT.toLocaleString()}건</b> 만 보여 줍니다 — 그보다 오래된 기록은 지워지지 않고{' '}
        <span className="t-code">core.audit_log</span> 에 그대로 남아 있습니다.
      </InsightBanner>

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      <Panel title="기록" actions={<span className="t-label">최근 순</span>} flush>
        {rows.length === 0 ? (
          <EmptyState
            title={q === '' ? '아직 기록이 없습니다' : `"${q}" 에 해당하는 기록이 없습니다`}
            desc={
              q === ''
                ? '정책값을 바꾸거나 승인을 처리하면 여기에 남습니다.'
                : '검색어를 지우면 전체 기록으로 돌아갑니다.'
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 기록이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(row) => row.logId}
            caption="analytics.v_system_log — 감사 · 외부 API · AI 답변"
          />
        )}
      </Panel>
    </>
  );
}
