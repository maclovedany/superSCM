// API 문서 — renew.prd 9.2 "OpenAPI / Swagger 문서를 제공한다"
//
// ★ 외부 Swagger UI 를 CDN 으로 불러오지 않습니다.
//   관리자 화면에 남의 스크립트를 넣으면 그 스크립트가 이 페이지의 쿠키와 DOM 을 다 볼 수 있습니다.
//   여기서는 lib/api/openapi.ts 의 문서 객체를 그대로 읽어 표로 그립니다.
//
// 원본 JSON 은 /api/v1/openapi.json 에서 그대로 받아갈 수 있습니다 (인증 없음).
//
// kpi-filter: 없음 — 카드 넷은 문서의 규모(경로 수 · scope 수)를 알려줄 뿐입니다.
//   아래 표는 이미 Inbound · Outbound 로 나뉘어 있고, "scope 6종" 같은 카드는
//   경로 목록의 부분집합이 아니라 다른 표를 셉니다. 눌러도 좁힐 것이 없습니다.

import { FileJson, LockKeyhole, Upload, Download } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import InsightBanner from '@/components/ui/insight-banner';
import {
  API_BASE,
  INBOUND_ROUTES,
  OUTBOUND_ROUTES,
  openApiDocument,
} from '@/lib/api/openapi';
import { API_SCOPES, API_SCOPE_LABEL } from '@/lib/api/scopes';

export const dynamic = 'force-dynamic';

type DocRow = {
  key: string;
  method: 'POST' | 'GET';
  path: string;
  summary: string;
  scope: string;
  note: string;
};

const MB = 1024 * 1024;

const ROWS: DocRow[] = [
  ...INBOUND_ROUTES.map((route) => ({
    key: `POST ${route.path}`,
    method: 'POST' as const,
    path: `${API_BASE}${route.path}`,
    summary: route.summary,
    scope: route.scope,
    note: `${route.dataType} · 본문 상한 ${Math.round(route.maxBodyBytes / MB)}MB`,
  })),
  ...OUTBOUND_ROUTES.map((route) => ({
    key: `GET ${route.path}`,
    method: 'GET' as const,
    path: `${API_BASE}${route.path}`,
    summary: route.summary,
    scope: route.scope,
    note: route.paged ? 'limit(기본 100 · 최대 1000) · offset' : '페이징 없음',
  })),
];

const COLUMNS: Column<DocRow>[] = [
  {
    key: 'method',
    label: '메서드',
    render: (row) => <Badge tone={row.method === 'POST' ? 'info' : 'plain'}>{row.method}</Badge>,
  },
  { key: 'path', label: '경로', variant: 'code', render: (row) => row.path },
  { key: 'summary', label: '설명', variant: 'strong', render: (row) => row.summary },
  { key: 'scope', label: '필요 권한', variant: 'code', render: (row) => row.scope },
  { key: 'note', label: '비고', render: (row) => <span className="t-sm text-2">{row.note}</span> },
];

const CURL_INBOUND = `curl -X POST https://<호스트>/api/v1/demand-history \\
  -H "Authorization: Bearer sk_scm_<발급받은 키>" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 2025-03-14-erp-001" \\
  -d '{
    "mode": "upsert",
    "strict": false,
    "data": [
      { "item_id": "ITEM012", "date": "2025-03-14", "quantity": 62 }
    ]
  }'`;

const CURL_INBOUND_RESPONSE = `{
  "batch_id": "b_api_20250314_3f9c2a1b04",
  "received": 2,
  "accepted": 1,
  "rejected": 1,
  "errors": [
    { "index": 1, "field": "item_id", "code": "UNKNOWN_ITEM",
      "severity": "ERROR", "message": "품목코드 'ITEM999' 가 마스터에 없습니다." }
  ]
}`;

const CURL_REPLACE = `# mode: 'replace' — 그 기간을 지우고 다시 넣습니다. 지운 원본은 되돌릴 수 없습니다.
curl -X POST https://<호스트>/api/v1/demand-history \\
  -H "Authorization: Bearer sk_scm_<발급받은 키>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "mode": "replace",
    "period_from": "2025-03-01",
    "period_to": "2025-03-31",
    "data": [ { "item_id": "ITEM012", "date": "2025-03-14", "quantity": 62 } ]
  }'`;

const ENV_HINT = `# .env.local (로컬) · Vercel 환경변수 (배포)
SUPABASE_SECRET_KEY=sb_secret_...`;

const CURL_OUTBOUND = `curl "https://<호스트>/api/v1/order-recommendation/ITEM012" \\
  -H "Authorization: Bearer sk_scm_<발급받은 키>"

curl "https://<호스트>/api/v1/alerts?limit=50&offset=0" \\
  -H "Authorization: Bearer sk_scm_<발급받은 키>"`;

export default async function ApiDocsPage() {
  const document = openApiDocument();
  const paths = document.paths as Record<string, unknown>;
  const pathCount = Object.keys(paths).length;

  return (
    <>
      <PageHeader
        title="API 문서"
        subtitle="외부 시스템이 쓰는 경로와 권한입니다. 원본 OpenAPI 3.1 문서는 /api/v1/openapi.json 에서 받아갑니다."
        meta={
          <>
            <MetaChip>PRD 9.2</MetaChip>
            <MetaChip>OpenAPI {String(document.openapi)}</MetaChip>
          </>
        }
      />

      <div className="grid grid-kpi">
        <KpiCard label="전체 경로" value={pathCount} unit="개" icon={FileJson} foot="전부 인증이 필요합니다" />
        <KpiCard label="입력 (Inbound)" value={INBOUND_ROUTES.length} unit="개" icon={Upload} foot="renew.prd 9.1" />
        <KpiCard label="조회 (Outbound)" value={OUTBOUND_ROUTES.length} unit="개" icon={Download} foot="renew.prd 9.2" />
        <KpiCard label="권한 (scope)" value={API_SCOPES.length} unit="종" icon={LockKeyhole} foot="renew.prd 9.3" />
      </div>

      <InsightBanner eyebrow="API DOCS">
        모든 요청은 <span className="t-code">Authorization: Bearer &lt;키&gt;</span> 를 붙입니다. 키가 없거나
        틀리면 <b>401</b>, 키에 그 경로의 권한이 없으면 <b>403</b>, 분당 60회를 넘으면{' '}
        <b className="hl-warn">429</b> 입니다. 입력 경로는 <b>파일 업로드와 같은 검증</b>을 지나므로,
        화면에서 올렸을 때 걸리는 오류는 API 로도 똑같이 걸립니다.
      </InsightBanner>

      <Panel title="데이터 입력 — renew.prd 9.1" flush>
        <DataTable
          columns={COLUMNS}
          rows={ROWS.filter((row) => row.method === 'POST')}
          rowKey={(row) => row.key}
          caption="POST /api/v1/… — Inbound"
        />
      </Panel>

      <Panel title="결과 조회 — renew.prd 9.2" flush>
        <DataTable
          columns={COLUMNS}
          rows={ROWS.filter((row) => row.method === 'GET')}
          rowKey={(row) => row.key}
          caption="GET /api/v1/… — Outbound"
        />
      </Panel>

      <Panel title="권한 (scope)" flush>
        <DataTable
          columns={[
            { key: 'scope', label: 'scope', variant: 'code', render: (row: { scope: string }) => row.scope },
            {
              key: 'label',
              label: '무엇을 할 수 있나',
              render: (row: { label: string }) => row.label,
            },
          ]}
          rows={API_SCOPES.map((scope) => ({ scope, label: API_SCOPE_LABEL[scope] }))}
          rowKey={(row) => row.scope}
          caption="renew.prd 9.3 — scope 6종"
        />
      </Panel>

      <Panel title="요청 예시 — 데이터 입력">
        <p className="t-sm text-2" style={{ marginBottom: 'var(--s-3)' }}>
          같은 <span className="t-code">Idempotency-Key</span> 로 다시 보내면 적재하지 않고 지난 응답을 그대로
          돌려줍니다. 재시도해도 행이 두 번 들어가지 않습니다.
        </p>
        <code className="code-block">{CURL_INBOUND}</code>
        <p className="t-sm text-2" style={{ margin: 'var(--s-4) 0 var(--s-3)' }}>
          응답 — 부분 성공입니다. <span className="t-code">strict: true</span> 였다면 한 행도 적재하지 않고
          422 로 돌려줍니다.
        </p>
        <code className="code-block">{CURL_INBOUND_RESPONSE}</code>
        <p className="t-sm text-2" style={{ margin: 'var(--s-4) 0 var(--s-3)' }}>
          기간을 통째로 갈아끼울 때는 <span className="t-code">mode: &quot;replace&quot;</span> 에{' '}
          <span className="t-code">period_from</span> · <span className="t-code">period_to</span> 를 함께
          줍니다. <b className="hl-crit">그 기간의 기존 데이터는 지워지고 되돌릴 수 없습니다.</b> 기간을
          빼면 400 으로 거절합니다 — 실수로 지우는 일이 없도록 창을 반드시 밝히게 했습니다.
        </p>
        <code className="code-block">{CURL_REPLACE}</code>
      </Panel>

      <Panel title="요청 예시 — 결과 조회">
        <code className="code-block">{CURL_OUTBOUND}</code>
      </Panel>

      <Panel title="설정 — 조회(GET)에 필요한 서버 키">
        <p className="t-sm text-2" style={{ marginBottom: 'var(--s-3)' }}>
          조회 경로는 로그인 세션이 없어 <b>서버 전용 secret 키</b>로 DB 를 읽습니다. 이 값이 없으면
          조회 경로가 <span className="t-code">503</span> 과 &quot;서버 자격증명이 설정되지
          않았습니다&quot; 를 돌려줍니다. 입력(POST) 경로는 API 키 해시로 DB 함수를 부르므로 이 설정과
          무관하게 동작합니다.
        </p>
        <code className="code-block">{ENV_HINT}</code>
        <p className="t-sm text-2" style={{ marginTop: 'var(--s-3)' }}>
          <b className="hl-crit">이름에 NEXT_PUBLIC_ 을 붙이지 마세요.</b> 붙이면 Next.js 가 이 값을
          브라우저로 내려보내고, 방문자 누구나 접근 제어를 우회할 수 있게 됩니다. 배포 환경에서는
          Vercel 프로젝트 설정의 환경변수로 등록합니다.
        </p>
      </Panel>

      <Panel title="원본 문서">
        <p className="t-sm text-2" style={{ marginBottom: 'var(--s-3)' }}>
          OpenAPI 3.1 문서를 그대로 내려받아 코드 생성기에 넣을 수 있습니다. 이 경로만 인증이 없습니다 —
          문서에는 데이터가 없고 경로와 스키마뿐입니다.
        </p>
        <code className="code-block">curl https://&lt;호스트&gt;/api/v1/openapi.json</code>
      </Panel>
    </>
  );
}
