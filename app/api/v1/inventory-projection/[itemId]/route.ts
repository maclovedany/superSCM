// GET /api/v1/inventory-projection/{itemId} — renew.prd 9.2

import { handleOutbound } from '@/lib/api/handler';
import { readPaging } from '@/lib/api/auth-model';
import { inventoryProjectionForItem } from '@/lib/api/outbound';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;
  const { limit, offset } = readPaging(new URL(request.url).searchParams);

  return handleOutbound(
    request,
    { path: '/inventory-projection/{itemId}', scope: 'recommendation:read' },
    () => inventoryProjectionForItem(itemId, limit, offset),
  );
}
