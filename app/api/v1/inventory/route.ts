// POST /api/v1/inventory — renew.prd 9.1
//
// 처리는 lib/api/handler.ts 가 합니다. 경로 · dataType · scope 는
// lib/api/openapi.ts 의 표 한 곳에서 옵니다 (문서와 구현이 갈라지지 않도록).

import { handleInbound } from '@/lib/api/handler';
import { inboundRoute } from '@/lib/api/openapi';
import { apiError } from '@/lib/api/auth-model';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const route = inboundRoute('/inventory');
  if (!route) {
    return NextResponse.json(apiError('NOT_FOUND', '알 수 없는 경로입니다.'), { status: 404 });
  }
  return handleInbound(request, route);
}
