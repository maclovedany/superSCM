// GET /api/v1/atp?item_id=&qty=&date= — renew.prd 9.2
//
// 계산은 STEP 17 의 lib/atp.ts 가 합니다 (lib/api/atp-bridge.ts). SQL 이 아직 없으면 501 입니다.

import { handleOutbound } from '@/lib/api/handler';
import { apiError } from '@/lib/api/auth-model';
import { atpQuote, readAtpQuery } from '@/lib/api/atp-bridge';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const parsed = readAtpQuery(new URL(request.url).searchParams);

  return handleOutbound(request, { path: '/atp', scope: 'recommendation:read' }, async () => {
    if (!parsed.ok) {
      return { status: 400, body: apiError('BAD_REQUEST', parsed.message) };
    }
    return atpQuote(parsed.query);
  });
}
