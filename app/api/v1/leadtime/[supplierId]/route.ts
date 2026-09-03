// GET /api/v1/leadtime/{supplierId} — renew.prd 9.2

import { handleOutbound } from '@/lib/api/handler';
import { leadtimeForSupplier } from '@/lib/api/outbound';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = await context.params;

  return handleOutbound(
    request,
    { path: '/leadtime/{supplierId}', scope: 'forecast:read' },
    () => leadtimeForSupplier(supplierId),
  );
}
