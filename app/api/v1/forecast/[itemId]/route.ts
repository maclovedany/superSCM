// GET /api/v1/forecast/{itemId} — renew.prd 9.2

import { handleOutbound } from '@/lib/api/handler';
import { readPaging } from '@/lib/api/auth-model';
import { forecastForItem } from '@/lib/api/outbound';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;
  const { limit, offset } = readPaging(new URL(request.url).searchParams);

  return handleOutbound(
    request,
    { path: '/forecast/{itemId}', scope: 'forecast:read' },
    () => forecastForItem(itemId, limit, offset),
  );
}
