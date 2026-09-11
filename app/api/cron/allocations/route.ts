import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest, normalizeExpiryJobRow, summarizeExpiryJobRows } from '@/lib/orders/jobs';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Task 6 · 30일 임시배정 자동 만료. core.expire_temporary_allocations(DB 함수)만 부른다 —
// 만료 판정 · 해제 · 주문 상태 전환 · 완료 알림은 전부 그 함수 안에서 한 트랜잭션으로 끝난다.
// 신규 입고 후속 배정(AUTO/MANUAL)은 core.commit_import_batch가 입고 반영과 같은 트랜잭션에서
// 실행하므로 이 Cron이 아니라 입고 커밋 경로에서 일어난다(이 라우트는 만료만 담당).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers, process.env.CRON_SECRET ?? '')) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 401 });
  }
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.schema('core').rpc('expire_temporary_allocations', {});
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map((raw: Record<string, unknown>) => normalizeExpiryJobRow(raw));
    const summary = summarizeExpiryJobRows(rows);

    if (summary.failed > 0) return NextResponse.json(summary, { status: 500 });
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '만료 배정 처리 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
