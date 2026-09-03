// GET /api/v1/order-recommendation/{itemId} — renew.prd 9.2

import { handleOutbound } from '@/lib/api/handler';
import { orderRecommendationForItem } from '@/lib/api/outbound';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;

  return handleOutbound(
    request,
    { path: '/order-recommendation/{itemId}', scope: 'recommendation:read' },
    () => orderRecommendationForItem(itemId),
  );
}
