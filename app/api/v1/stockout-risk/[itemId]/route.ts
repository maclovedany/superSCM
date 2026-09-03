// GET /api/v1/stockout-risk/{itemId} — renew.prd 9.2

import { handleOutbound } from '@/lib/api/handler';
import { stockoutRiskForItem } from '@/lib/api/outbound';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;

  return handleOutbound(
    request,
    { path: '/stockout-risk/{itemId}', scope: 'recommendation:read' },
    () => stockoutRiskForItem(itemId),
  );
}
