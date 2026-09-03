// 백그라운드 알림 스캔 — renew.prd 24.4
//
// "스케줄러가 주기적으로 전체 SKU를 스캔한다."
//
// vercel.json 의 crons 가 6시간마다 이 경로를 GET 으로 부릅니다.
// Vercel Cron 은 `Authorization: Bearer ${CRON_SECRET}` 헤더를 붙여 보냅니다.
//
// ★ 문 두 개를 지납니다. 둘 다 같은 비밀값을 봅니다.
//   ① 여기 — 헤더의 Bearer 토큰이 환경변수 CRON_SECRET 과 같은가
//   ② core.scan_alerts(p_secret) — p_secret 이 DB 의 app.cron_secret 과 같은가
//
//   ②가 필요한 이유는 이 요청에 로그인 세션이 없어 core.is_admin() 이 false 이기 때문입니다.
//   DB 쪽 값은 SQL Editor 에서 한 번 심습니다 (sql/20-alert.sql 파일 머리 주석).
//
//       alter database postgres set app.cron_secret = '충분히-긴-무작위-문자열';
//
//   CRON_SECRET 을 설정하지 않으면 이 라우트는 아무도 통과시키지 않습니다.
//   "설정을 빠뜨렸는데 열려 있는" 상태를 만들지 않기 위해서입니다 (middleware.ts 와 같은 판단).
//
// ★ middleware.ts 의 PUBLIC_PATHS 에 /api/cron 이 있습니다. 없으면 로그인 없는 요청이
//   /login 으로 리다이렉트되어 스캔이 조용히 돌지 않습니다.

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { releaseExpiredAllocations } from '@/lib/atp';

// 스케줄러 호출이라 캐시하지 않습니다.
export const dynamic = 'force-dynamic';

type ScanRow = {
  n_new?: number;
  n_updated?: number;
  n_resolved?: number;
  message?: string;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  // 비밀값이 없으면 판정할 수 없습니다. 통과시키지 않습니다.
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET 이 설정되지 않았습니다.' },
      { status: 401 },
    );
  }

  const header = request.headers.get('authorization');
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: '인증에 실패했습니다.' }, { status: 401 });
  }

  try {
    // ★ 스캔 전에 만료된 가예약을 풉니다 — renew.prd 27.6 "유효기간 경과 시 자동 해제".
    //
    //   순서가 중요합니다. 만료된 예약은 재고 전개와 ATP 에서 이미 빠져 있지만
    //   status 는 아직 RESERVED 라, 먼저 풀지 않으면 SOFT_ALLOC_EXPIRING 알림이
    //   같은 예약을 스캔마다 다시 냅니다.
    //
    //   실패해도 스캔은 그대로 돕니다. 만료 해제가 안 됐다고 알림 전체를 멈출 이유가
    //   없습니다 (renew.prd 31.4 와 같은 취지). 결과는 응답에 실어 드러냅니다.
    //   ★ 같은 비밀값을 넘깁니다. 이 함수도 scan_alerts 처럼 "관리자이거나 p_secret 이
    //     app.cron_secret 과 같은가" 를 봅니다. 인자 없이 anon 에게 열어 두면 공개 키를
    //     가진 누구나 쓰기 루프를 돌릴 수 있습니다.
    const expired = await releaseExpiredAllocations(secret);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('core')
      .rpc('scan_alerts', { p_secret: secret });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const row = (Array.isArray(data) ? data[0] : data) as ScanRow | null;

    return NextResponse.json({
      ok: true,
      nNew: row?.n_new ?? 0,
      nUpdated: row?.n_updated ?? 0,
      nResolved: row?.n_resolved ?? 0,
      // ok 가 false 면 만료 해제가 권한에서 막힌 것입니다 (DB 의 app.cron_secret 미설정 등).
      // 0건 해제와 구별되어야 조용히 넘어가지 않습니다.
      expiredAllocationsOk: expired.ok,
      nExpiredAllocations: expired.released,
      expiredAllocationMessage: expired.message,
      expiredAllocationError: expired.error,
      message: row?.message ?? '알림 스캔을 실행했습니다.',
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '알림 스캔에 실패했습니다.' },
      { status: 500 },
    );
  }
}
