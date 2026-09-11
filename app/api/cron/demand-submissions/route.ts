import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/notifications/cron';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Task 7 · 마감일이 지났는데 제출하지 않은 부서에 반복 미제출 알림을 처음 예약한다.
// core.raise_demand_submission_reminders만 부른다 — 10분 반복 자체는 core.finish_notification
// (Task 3)이 DEMAND_SUBMISSION_OVERDUE 템플릿을 계속 재예약하며 이어간다. 제출 완료 시 중단은
// core.submit_demand_submission 안에서, 마감 후 회수 시 재개는 core.withdraw_demand_submission
// 안에서 일어난다(둘 다 이 Cron과 무관하게 그 트랜잭션에서 바로 처리된다).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers, process.env.CRON_SECRET ?? '')) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 401 });
  }
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.schema('core').rpc('raise_demand_submission_reminders', {});
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ scheduled: typeof data === 'number' ? data : 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '수요 미제출 알림 처리 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
