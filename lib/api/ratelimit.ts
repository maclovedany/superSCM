// 호출 제한 — renew.prd 9.2 "Rate limit 을 적용한다"
//
// 키마다 분당 60회. 초과하면 429 입니다.
//
// ★ 한계 — 이 카운터는 **서버 인스턴스 메모리**에 있습니다.
//   Vercel 서버리스는 요청마다 다른 인스턴스로 갈 수 있고, 인스턴스가 잠들면
//   카운터가 사라집니다. 그래서 실제 상한은 "인스턴스 수 × 60/분" 이며,
//   이 값은 남용을 완전히 막는 장치가 아니라 사고로 인한 폭주를 늦추는 장치입니다.
//   공유 카운터가 필요해지면 Postgres 나 Redis 로 옮겨야 합니다.
//   (지시서 확정 사항 — 지금은 공유 상태를 만들지 않습니다.)

const WINDOW_MS = 60_000;

/** 키 하나당 분당 호출 수 */
export const LIMIT_PER_KEY = 60;

/**
 * 인증 **전에** IP 하나당 분당 호출 수.
 *
 * 인증 뒤에만 세면 인증에 실패하는 요청은 한 번도 세지 않게 됩니다 —
 * 즉 미인증 폭주를 전혀 막지 못합니다. 그래서 인증보다 앞에 한 겹을 둡니다.
 *
 * 키 상한보다 넉넉하게 잡습니다. 여러 연동이 같은 NAT 뒤에 있을 수 있어서,
 * 정상 트래픽이 이 겹에 먼저 걸리면 안 됩니다. 이 겹은 폭주만 잡습니다.
 */
export const LIMIT_PER_IP = 120;

const LIMIT_PER_WINDOW = LIMIT_PER_KEY;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** 다음 창이 열릴 때까지 남은 초. 429 의 Retry-After 에 씁니다 */
  retryAfterSeconds: number;
};

/**
 * 한 번 부를 때마다 카운터가 1 올라갑니다. 판정과 증가를 나누지 않은 이유는,
 * 나누면 "판정만 하고 증가를 잊는" 경로가 생기기 때문입니다.
 */
export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  limit: number = LIMIT_PER_WINDOW,
): RateLimitResult {
  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, limit, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, limit, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/**
 * 지난 창을 지웁니다. Map 이 무한히 자라지 않게 하기 위해서입니다.
 *
 * for…of 로 Map 반복자를 돌면 tsconfig target 이 es5 라 TS2802 가 납니다 (error.md #21).
 * Array.from 으로 받습니다.
 */
function sweep(now: number) {
  if (buckets.size < 256) return;
  for (const entry of Array.from(buckets.entries())) {
    if (entry[1].resetAt <= now) buckets.delete(entry[0]);
  }
}

/** 테스트용. 운영 코드에서는 부르지 않습니다 */
export function resetRateLimits() {
  buckets.clear();
}
