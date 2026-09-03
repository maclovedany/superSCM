// GET /api/v1/alerts — renew.prd 9.2

import { handleOutbound } from '@/lib/api/handler';
import { readPaging } from '@/lib/api/auth-model';
import { alertList } from '@/lib/api/outbound';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { limit, offset } = readPaging(new URL(request.url).searchParams);

  return handleOutbound(
    request,
    { path: '/alerts', scope: 'alert:read' },
    () => alertList(limit, offset),
  );
}
