import { timingSafeEqual } from 'node:crypto';

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthorizedCronRequest(headers: Headers, expectedSecret: string): boolean {
  if (expectedSecret.trim() === '') return false;
  const authorization = headers.get('authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  const dedicatedHeader = headers.get('x-cron-secret') ?? '';
  return safeEqual(bearer, expectedSecret) || safeEqual(dedicatedHeader, expectedSecret);
}
