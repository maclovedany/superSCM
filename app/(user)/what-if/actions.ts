'use server';

// What-If 시나리오 실행 — renew.prd 25장
//
// ★ 이 액션은 계산하지 않습니다. 파라미터를 다듬어 URL 에 싣고 그리로 보냅니다.
//   결과는 서버 컴포넌트가 그 URL 을 읽어 rpc 로 가져옵니다 — 그래야 시나리오를
//   링크로 공유할 수 있고 뒤로가기가 동작합니다 (STEP 18 지시서 §4).
//
// ★ 실행 기록(core.what_if_log)을 남기는 곳은 여기 한 곳뿐입니다.
//   계산 함수는 `stable` 이라 쓰기 자체가 불가능합니다 (renew.prd 25.2).
//
// 권한은 서버에서 봅니다 (AGENTS.md 규칙 8).
// requireUser() 는 redirect 를 던져 액션의 try/catch 가 삼키므로 쓰지 않습니다 (공통규칙 3-4).

import { redirect } from 'next/navigation';
import { getSessionUser, isSalesUser } from '@/lib/auth';
import { extractWhatIfIntent } from '@/lib/agent/what-if-intent';
import { PARAM_KEYS, encodeParams, logWhatIf, parseParams } from '@/lib/what-if';
import type { WhatIfState } from './state';

/** 영업은 리드타임 통계와 발주 수량을 볼 수 없습니다 (renew.prd 4.5). DB 함수도 같이 막습니다 */
const SALES_BLOCKED = '영업 권한에서는 시나리오 시뮬레이션을 사용할 수 없습니다.';

function scenarioHref(itemId: string, params: Record<string, unknown>): string {
  return `/what-if?item=${encodeURIComponent(itemId)}&p=${encodeParams(params)}`;
}

/**
 * 받지 못한 값이 있으면 문구를, 없으면 null.
 *
 * ★ 수동 폼과 자연어 입력이 **같은 규칙을 씁니다.** 두 경로가 서로 다른 판정을 하면
 *   같은 값을 넣어도 한쪽은 오류, 한쪽은 조용히 통과가 되어 사용자가 무엇이 반영됐는지
 *   알 수 없게 됩니다. 범위를 벗어난 값을 버렸으면 반드시 말합니다.
 */
function rejectedMessage(ignored: string[]): string | null {
  if (ignored.length === 0) return null;
  return `받을 수 없는 값이 있습니다: ${ignored.join(' · ')}. 범위를 확인해주세요.`;
}

/** 폼에서 온 값을 파라미터로. 빈 칸과 체크 해제는 "주지 않은 것" 입니다 */
function readForm(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of PARAM_KEYS) {
    const value = formData.get(key);
    if (value !== null) raw[key] = value;
  }
  return raw;
}

export async function runScenario(_prev: WhatIfState, formData: FormData): Promise<WhatIfState> {
  const user = await getSessionUser();
  if (!user) return { error: '로그인이 필요합니다.', notice: null };
  if (isSalesUser(user)) return { error: SALES_BLOCKED, notice: null };

  const itemId = String(formData.get('item') ?? '').trim();
  if (itemId === '') return { error: '품목을 먼저 선택해주세요.', notice: null };

  const { params, ignored } = parseParams(readForm(formData));

  // 범위를 벗어난 값을 조용히 버리지 않습니다. 버리면 시나리오를 돌렸다고 믿게 됩니다.
  const rejected = rejectedMessage(ignored);
  if (rejected) return { error: rejected, notice: null };

  if (Object.keys(params).length === 0) {
    return { error: '바꿀 가정을 하나 이상 넣어주세요.', notice: null };
  }

  await logWhatIf({
    itemId,
    params,
    askedBy: user.userId,
    askedEmail: user.email,
    naturalLanguage: null,
  });

  // redirect 는 NEXT_REDIRECT 예외를 던집니다. try/catch 밖에서 부릅니다.
  redirect(scenarioHref(itemId, params));
}

/**
 * 자연어 한 줄로 시나리오를 만듭니다.
 *
 * LLM 은 파라미터만 만들고 숫자는 계산하지 않습니다 (renew.prd 26.1).
 * 실패하거나 설정되지 않았으면 사유를 돌려주고, 사용자는 아래 폼으로 그대로 진행합니다.
 */
export async function askScenario(_prev: WhatIfState, formData: FormData): Promise<WhatIfState> {
  const user = await getSessionUser();
  if (!user) return { error: '로그인이 필요합니다.', notice: null };
  if (isSalesUser(user)) return { error: SALES_BLOCKED, notice: null };

  const question = String(formData.get('question') ?? '').trim();
  if (question === '') return { error: '무엇을 바꿔 볼지 한 줄로 적어주세요.', notice: null };

  const { intent, error } = await extractWhatIfIntent(question);
  if (error || !intent) {
    return {
      error: `${error ?? '질문을 파라미터로 옮기지 못했습니다.'} 아래 폼에서 직접 넣어 주세요.`,
      notice: null,
    };
  }

  // ★ 수동 폼(위 runScenario)과 같은 검사입니다. 모델이 범위 밖의 값을 냈으면
  //   말없이 버리지 않고 그대로 돌려줍니다 — 사람이 넣었을 때는 오류인 값이
  //   AI 를 거쳤다고 통과하면, 사용자는 자기가 말한 가정이 반영된 줄 압니다.
  //   문구도 같게 두어 "왜 이건 되고 저건 안 되나" 가 생기지 않게 합니다.
  const rejectedByModel = rejectedMessage(intent.ignored);
  if (rejectedByModel) {
    return {
      error: `${rejectedByModel} AI 가 옮긴 값입니다 — 아래 폼에서 직접 넣어 주세요.`,
      notice: null,
    };
  }

  // 모델이 품목을 찾지 못했으면 화면에서 고른 품목을 씁니다.
  const itemId = intent.itemId ?? String(formData.get('item') ?? '').trim();
  if (itemId === '') {
    return {
      error: intent.itemHint
        ? `품목 "${intent.itemHint}" 을(를) 찾지 못했습니다. 위에서 품목을 골라주세요.`
        : '어떤 품목인지 알 수 없습니다. 위에서 품목을 골라주세요.',
      notice: null,
    };
  }

  await logWhatIf({
    itemId,
    params: intent.params,
    askedBy: user.userId,
    askedEmail: user.email,
    naturalLanguage: question,
  });

  redirect(scenarioHref(itemId, intent.params));
}
