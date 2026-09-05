// API Key — renew.prd 9.3 · 31.1
//
// "원문은 생성 시 한 번만 노출한다. 이후 해시만 보관한다."
//
// 이 화면은 해시를 보여주지 않습니다. analytics.v_api_key 에 key_hash 컬럼이 아예 없습니다.
// 어느 키인지는 앞 8자(key_prefix)로 대조합니다.

import { KeyRound, ShieldCheck, Clock, Ban } from 'lucide-react';
import { kstMinute } from '@/lib/time';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { listApiKeys, type ApiKeyRow } from '@/lib/api/keys';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import type { Tone } from '@/lib/status';
import KeyCreateForm from './key-create-form';
import KeyRevokeForm from './key-revoke-form';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '사용 중',
  EXPIRED: '만료',
  REVOKED: '폐기',
  INACTIVE: '중지',
};

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'safe',
  EXPIRED: 'warn',
  REVOKED: 'crit',
  INACTIVE: 'unknown',
};

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<ApiKeyRow>[] = [
  { key: 'all', label: '전체 키', match: null },
  { key: 'active', label: '사용 중', match: (row) => row.status === 'ACTIVE' },
  { key: 'expiring', label: '만료 예정 · 만료', match: (row) => row.status === 'EXPIRED' || isExpiringSoon(row) },
  { key: 'revoked', label: '폐기', match: (row) => row.status === 'REVOKED' },
];

/** 30일 안에 만료되는가. 뷰가 status 로 만료 여부를 이미 판정했으므로 여기서는 남은 날만 봅니다 */
function isExpiringSoon(row: ApiKeyRow): boolean {
  if (!row.expiresAt || row.status !== 'ACTIVE') return false;
  const at = Date.parse(row.expiresAt);
  if (Number.isNaN(at)) return false;
  return at - Date.now() < 30 * 24 * 60 * 60 * 1000;
}

function day(value: string | null) {
  return value ? value.slice(0, 10) : null;
}

function minute(value: string | null) {
  return value ? kstMinute(value) : null;
}

const COLUMNS: Column<ApiKeyRow>[] = [
  { key: 'integrationName', label: '연동 이름', variant: 'strong', render: (row) => row.integrationName },
  { key: 'keyPrefix', label: '접두어', variant: 'code', render: (row) => `${row.keyPrefix}…` },
  {
    key: 'scope',
    label: '권한',
    render: (row) =>
      row.scope.length === 0 ? (
        <EmptyValue />
      ) : (
        <span style={{ display: 'inline-flex', gap: 'var(--s-1)', flexWrap: 'wrap' }}>
          {row.scope.map((scope) => (
            <Badge key={scope} tone="plain">
              {scope}
            </Badge>
          ))}
        </span>
      ),
  },
  {
    key: 'expiresAt',
    label: '만료',
    render: (row) => {
      const value = day(row.expiresAt);
      return value ? <span>{value}</span> : <span className="t-sm text-3">만료 없음</span>;
    },
  },
  {
    key: 'lastUsedAt',
    label: '마지막 사용',
    render: (row) => {
      const value = minute(row.lastUsedAt);
      // 한 번도 쓰이지 않은 것은 "모른다" 가 아니라 "없다" 이므로 사유 코드를 붙이지 않습니다.
      return value ? <span>{value}</span> : <span className="t-sm text-3">사용 이력 없음</span>;
    },
  },
  { key: 'callCount', label: '호출', align: 'right', variant: 'num', render: (row) => row.callCount.toLocaleString() },
  {
    key: 'status',
    label: '상태',
    render: (row) => (
      <Badge tone={STATUS_TONE[row.status] ?? 'unknown'}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
    ),
  },
  {
    key: 'revoke',
    label: '폐기',
    render: (row) => (
      <KeyRevokeForm
        keyId={row.keyId}
        integrationName={row.integrationName}
        revoked={row.status === 'REVOKED'}
      />
    ),
  },
];

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const { rows, error } = await listApiKeys();

  const header = (
    <PageHeader
      title="API Key"
      subtitle="외부 시스템 연동 키를 관리합니다. 원문은 발급할 때 한 번만 보이며, 서버에는 해시만 남습니다."
      meta={
        <>
          <MetaChip>PRD 9.3</MetaChip>
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

  const active = rows.filter((row) => row.status === 'ACTIVE').length;
  const expiring = rows.filter(isExpiringSoon).length;
  const revoked = rows.filter((row) => row.status === 'REVOKED').length;
  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="전체 키"
          value={rows.length}
          unit="개"
          icon={KeyRound}
          foot="폐기한 키도 기록으로 남습니다"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="사용 중"
          value={active}
          unit={`/ ${rows.length}`}
          icon={ShieldCheck}
          foot="지금 호출할 수 있는 키"
          filter={{ key: 'active', active: activeFilter === 'active' }}
        />
        <KpiCard
          label="30일 내 만료"
          value={expiring}
          unit="개"
          icon={Clock}
          tone={expiring > 0 ? 'warn' : 'default'}
          foot="만료 전에 새 키로 바꿔주세요"
          filter={{ key: 'expiring', active: activeFilter === 'expiring' }}
        />
        <KpiCard
          label="폐기"
          value={revoked}
          unit="개"
          icon={Ban}
          foot="되돌릴 수 없습니다"
          filter={{ key: 'revoked', active: activeFilter === 'revoked' }}
        />
      </div>

      <InsightBanner eyebrow="API KEY">
        키 원문은 <b>발급 화면에서 한 번만</b> 보입니다. 서버에는 <span className="t-code">sha256</span>{' '}
        해시와 앞 8자만 저장되므로, 잃어버린 키를 다시 꺼내볼 수는 없습니다. 유출이 의심되면{' '}
        <b className="hl-crit">폐기</b>하고 새로 발급하세요 — 폐기한 키는 다음 호출부터 즉시 막힙니다.
        모든 발급과 폐기는 감사 로그에 남으며, <b>원문은 감사 로그에도 남지 않습니다</b>.
      </InsightBanner>

      <Panel title="새 키 발급">
        <KeyCreateForm />
      </Panel>

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      <Panel
        title="발급된 키"
        actions={<span className="t-label">core.api_key — 해시는 화면에 나오지 않습니다</span>}
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            title="발급된 키가 없습니다"
            desc="위 폼에서 첫 키를 발급하세요. sql/26-api.sql 을 아직 실행하지 않았다면 먼저 실행해주세요."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 키가 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={visible}
            rowKey={(row) => row.keyId}
            caption="analytics.v_api_key — 발급된 API 키"
          />
        )}
      </Panel>
    </>
  );
}
