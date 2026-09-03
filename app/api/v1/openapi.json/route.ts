// GET /api/v1/openapi.json — renew.prd 9.2 "OpenAPI / Swagger 문서를 제공한다"
//
// 이 경로만 인증이 없습니다. 문서에는 데이터가 없고 경로 · 스키마 · 권한 이름뿐입니다.
// 연동 개발자가 키를 받기 전에 읽어야 하는 문서이기도 합니다.

import { NextResponse } from 'next/server';
import { openApiDocument } from '@/lib/api/openapi';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(openApiDocument());
}
