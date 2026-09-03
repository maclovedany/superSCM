// Route Handler 공통 — renew.prd 9
//
// 모든 /api/v1 요청이 같은 순서를 지납니다.
//
//   ① 인증      Bearer → sha256 → core.api_key_authenticate       실패 401
//   ② scope     키에 그 권한이 있는가                              없으면 403
//   ③ 호출 제한 키마다 분당 60회                                    초과 429
//   ④ 처리      Inbound(검증 → 적재) 또는 Outbound(조회)
//   ⑤ 기록      core.api_log_write                                  실패해도 응답을 막지 않습니다
//
// 순서를 파일마다 다시 쓰지 않는 이유는, 한 곳을 빠뜨린 경로가 생기지 않게 하기 위해서입니다.

import { NextResponse } from 'next/server';
import type { DataType } from '../import/types';
import { authenticate, clientIp, requireScope, writeApiLog } from './auth';
import { apiError, type ApiIdentity } from './auth-model.ts';
import { ingest } from './inbound';
import { parseInboundBody } from './inbound-model.ts';
import { checkRateLimit, LIMIT_PER_IP, LIMIT_PER_KEY, type RateLimitResult } from './ratelimit';
import type { OutboundResult } from './outbound';

type Gate =
  | { ok: true; identity: ApiIdentity }
  | { ok: false; response: NextResponse; status: number; keyHash: string | null };

function tooMany(limit: RateLimitResult, keyHash: string | null): Gate {
  return {
    ok: false,
    status: 429,
    keyHash,
    response: NextResponse.json(
      apiError('RATE_LIMITED', `분당 ${limit.limit}회를 넘었습니다. 잠시 후 다시 시도해주세요.`),
      {
        status: 429,
        headers: {
          'Retry-After': String(limit.retryAfterSeconds),
          'X-RateLimit-Limit': String(limit.limit),
          'X-RateLimit-Remaining': '0',
        },
      },
    ),
  };
}

/**
 * ①②③ 을 한 번에. 통과하지 못하면 그대로 돌려줄 응답이 들어 있습니다.
 *
 * ★ 호출 제한이 **인증보다 앞**에 한 겹 있습니다 (리뷰 Important 6).
 *   인증 뒤에만 세면, 인증에 실패하는 요청은 한 번도 세지 않습니다. 그러면
 *   아무 키나 들고 오는 폭주가 제한 없이 DB 왕복 두 번(api_key_authenticate +
 *   api_log_write)씩을 만듭니다. 그래서 IP 로 먼저 한 겹, 인증 뒤에 키로 한 겹입니다.
 */
async function passGates(request: Request, scope: string): Promise<Gate> {
  // ① IP 겹 — 인증 전. 프록시 헤더가 없으면 한 통에 몰아 셉니다(느슨해지지 않는 쪽).
  const ipLimit = checkRateLimit(`ip:${clientIp(request) ?? 'unknown'}`, Date.now(), LIMIT_PER_IP);
  if (!ipLimit.allowed) return tooMany(ipLimit, null);

  // ② 인증
  const auth = await authenticate(request);
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.status,
      keyHash: null,
      response: NextResponse.json(auth.body, { status: auth.status }),
    };
  }

  // ③ scope
  const scoped = requireScope(auth.identity, scope);
  if (!scoped.ok) {
    return {
      ok: false,
      status: scoped.status,
      keyHash: auth.identity.keyHash,
      response: NextResponse.json(scoped.body, { status: scoped.status }),
    };
  }

  // ④ 키 겹
  const keyLimit = checkRateLimit(`key:${auth.identity.keyId}`, Date.now(), LIMIT_PER_KEY);
  if (!keyLimit.allowed) return tooMany(keyLimit, auth.identity.keyHash);

  return { ok: true, identity: auth.identity };
}

/** POST — renew.prd 9.1 */
export async function handleInbound(
  request: Request,
  route: { path: string; dataType: DataType; scope: string; maxBodyBytes: number },
): Promise<NextResponse> {
  const started = Date.now();
  const path = `/api/v1${route.path}`;
  const ip = clientIp(request);
  const idempotencyKey = request.headers.get('idempotency-key');

  const gate = await passGates(request, route.scope);

  if (!gate.ok) {
    await writeApiLog({
      keyHash: gate.keyHash,
      method: 'POST',
      path,
      status: gate.status,
      durationMs: Date.now() - started,
      ip,
    });
    return gate.response;
  }

  // 본문 크기 — bulk 만 25MB 입니다.
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > route.maxBodyBytes) {
    const status = 413;
    await writeApiLog({
      keyHash: gate.identity.keyHash,
      method: 'POST',
      path,
      status,
      durationMs: Date.now() - started,
      ip,
    });
    return NextResponse.json(
      apiError('PAYLOAD_TOO_LARGE', `본문이 너무 큽니다. 상한은 ${route.maxBodyBytes} 바이트입니다.`),
      { status },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    const status = 400;
    await writeApiLog({
      keyHash: gate.identity.keyHash,
      method: 'POST',
      path,
      status,
      durationMs: Date.now() - started,
      ip,
    });
    return NextResponse.json(apiError('BAD_REQUEST', 'JSON 본문을 읽지 못했습니다.'), { status });
  }

  const parsed = parseInboundBody(raw);
  if (!parsed.ok) {
    const status = 400;
    await writeApiLog({
      keyHash: gate.identity.keyHash,
      method: 'POST',
      path,
      status,
      durationMs: Date.now() - started,
      ip,
    });
    return NextResponse.json(apiError('BAD_REQUEST', parsed.message), { status });
  }

  const result = await ingest({
    dataType: route.dataType,
    request: parsed.request,
    identity: gate.identity,
    idempotencyKey,
  });

  await writeApiLog({
    keyHash: gate.identity.keyHash,
    method: 'POST',
    path,
    status: result.status,
    durationMs: Date.now() - started,
    received: result.log.received,
    accepted: result.log.accepted,
    rejected: result.log.rejected,
    batchId: result.log.batchId,
    ip,
    // 멱등 재요청은 응답을 다시 저장하지 않습니다. 처음 저장한 것 하나만 남깁니다.
    idempotencyKey: result.replayed ? null : idempotencyKey,
    response: result.replayed ? null : result.body,
  });

  return NextResponse.json(result.body, { status: result.status });
}

/** GET — renew.prd 9.2 */
export async function handleOutbound(
  request: Request,
  route: { path: string; scope: string },
  work: (identity: ApiIdentity) => Promise<OutboundResult>,
): Promise<NextResponse> {
  const started = Date.now();
  const path = `/api/v1${route.path}`;
  const ip = clientIp(request);

  const gate = await passGates(request, route.scope);

  if (!gate.ok) {
    await writeApiLog({
      keyHash: gate.keyHash,
      method: 'GET',
      path,
      status: gate.status,
      durationMs: Date.now() - started,
      ip,
    });
    return gate.response;
  }

  let result: OutboundResult;
  try {
    result = await work(gate.identity);
  } catch (error) {
    // ★ Postgres · 라이브러리 원문을 외부 호출자에게 돌려주지 않습니다 (리뷰 Minor 9 · 재리뷰 D).
    //   내부 구조가 드러나고, 호출자가 그것으로 할 수 있는 일도 없습니다.
    //   서버 로그에는 그대로 남깁니다.
    console.error('[api] 처리 중 예외:', path, error);
    result = { status: 500, body: apiError('INTERNAL_ERROR', '조회에 실패했습니다.') };
  }

  await writeApiLog({
    keyHash: gate.identity.keyHash,
    method: 'GET',
    path,
    status: result.status,
    durationMs: Date.now() - started,
    ip,
  });

  return NextResponse.json(result.body, { status: result.status });
}
