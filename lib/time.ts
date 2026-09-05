// 시각 표기 — 항상 한국 시간 (Asia/Seoul)
//
// PostgREST 는 timestamptz 를 UTC ISO 문자열('2026-09-05T10:12:00+00:00')로 돌려줍니다.
// `.slice(0, 16)` 은 UTC 를 그대로 보이고, `new Date(v).toLocaleString('ko-KR')` 은 서버(Vercel = UTC)의
// 시간대를 따릅니다. 둘 다 한국 시간이 아닙니다. 여기서 시간대를 고정합니다.

const KST = 'Asia/Seoul';

function parts(value: string | Date): Record<string, string> | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  if (out.hour === '24') out.hour = '00';
  return out;
}

/** '2026-09-05 19:12' (KST). 값이 없거나 못 읽으면 null */
export function kstMinute(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const p = parts(value);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : null;
}

/** '2026-09-05 19:12:33' (KST) */
export function kstStamp(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const p = parts(value);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}` : null;
}

/** '2026-09-05' (KST 기준 날짜) */
export function kstDate(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const p = parts(value);
  return p ? `${p.year}-${p.month}-${p.day}` : null;
}
