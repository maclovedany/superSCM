// 실습용 데이터 표식 저장소 — Task 15
//
// ★ 조회는 analytics 뷰만 쓴다(SCHEMA.md). 실습 묶음을 만들거나 제거하는 것은 화면에서 하지
//   않는다 — 배포 DB에 대한 파괴적 작업이라 문서화된 SQL 명령(supabase/practice-data/99-remove.sql)
//   으로만 한다. 그래서 이 파일에는 조회 함수만 있다.
// ★ 조회에 실패하면 status를 null로 돌려준다. 화면은 배너를 띄우지 않고, 실패 자체는 각 화면이
//   이미 쓰는 error 경로로 보여준다(AGENTS.md 3번 — 오류와 빈 결과를 구분한다).

import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizePracticeDataStatus,
  normalizePracticeDataset,
  normalizePracticeObject,
  type PracticeDataStatus,
  type PracticeDataset,
  type PracticeObject,
} from './model';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** 실습 데이터 현황 한 줄 — analytics.v_practice_data_status(항상 1행) */
export async function getPracticeDataStatus(): Promise<{ status: PracticeDataStatus | null; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_practice_data_status').select('*').maybeSingle();
    if (error) return { status: null, error: error.message };
    return { status: data ? normalizePracticeDataStatus(data as Record<string, unknown>) : null, error: null };
  } catch (error) {
    return { status: null, error: errorMessage(error, '실습 데이터 현황을 조회하지 못했습니다.') };
  }
}

/** 실습 묶음 목록 — analytics.v_practice_dataset */
export async function getPracticeDatasets(): Promise<{ rows: PracticeDataset[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_practice_dataset')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizePracticeDataset(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '실습 데이터 묶음을 조회하지 못했습니다.') };
  }
}

/** 등기된 실습 객체 — analytics.v_practice_object */
export async function getPracticeObjects(): Promise<{ rows: PracticeObject[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_practice_object')
      .select('*')
      .order('object_kind')
      .order('object_key');
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizePracticeObject(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: errorMessage(error, '실습 객체를 조회하지 못했습니다.') };
  }
}

/**
 * 실습 적재 배치 id 집합 — 데이터 관리 화면이 적재 이력 행에 "실습용" 배지를 붙일 때 쓴다.
 * 조회에 실패하면 빈 집합이다(배지만 안 붙고 화면은 그대로 동작한다).
 */
export async function getPracticeBatchIds(): Promise<Set<string>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_practice_object')
      .select('object_key')
      .eq('object_kind', 'UPLOAD_BATCH');
    if (error) return new Set();
    return new Set((data ?? []).map((row) => String((row as Record<string, unknown>).object_key)));
  } catch {
    return new Set();
  }
}

/**
 * 실습 품목코드 집합 — analytics.v_practice_item.
 *
 * ★ 재고 · 월말 재고 성과 화면이 "지금 보고 있는 행 중에 실습 품목이 있는가"를 가릴 때 쓴다.
 *   현황 한 줄(affects_inventory)만 보고 배너를 띄우면 실습 품목이 하나도 안 보이는 부서 화면에도
 *   경고가 붙는다 — 거짓 경고는 진짜 경고를 무디게 만든다.
 */
export async function getPracticeItemIds(): Promise<Set<string>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('analytics').from('v_practice_item').select('item_id');
    if (error) return new Set();
    return new Set((data ?? []).map((row) => String((row as Record<string, unknown>).item_id)));
  } catch {
    return new Set();
  }
}

/**
 * 등기된 실습 객체의 키 집합 — 종류별.
 *
 * ★ 조회에 실패하면 빈 집합이다. 표시가 빠질 뿐 화면은 그대로 동작한다 — 실데이터만 있는 화면에
 *   거짓 경고를 붙이지 않기 위해 "모르면 표시하지 않는다"를 택한다.
 */
async function getPracticeObjectKeys(objectKind: string): Promise<Set<string>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_practice_object')
      .select('object_key')
      .eq('object_kind', objectKind);
    if (error) return new Set();
    return new Set((data ?? []).map((row) => String((row as Record<string, unknown>).object_key)));
  } catch {
    return new Set();
  }
}

/**
 * 실습 취합 주기 id 집합.
 *
 * ★ 취합 주기는 **전역 기준월**이다. 상단바 · 사이드바에 모든 사용자에게 보이고, 월말 재고 KPI ·
 *   제출 마감 · 반복 알림이 이 값을 기준으로 계산된다. 실습 주기가 열려 있는 동안 그 사실이
 *   보이지 않으면, 실습으로 연 달이 운영 기준월처럼 읽힌다(fix round 1 · C2-1).
 */
export function getPracticeCycleIds(): Promise<Set<string>> {
  return getPracticeObjectKeys('PLANNING_CYCLE');
}

/** 실습 Forecast 실행 id 집합 */
export function getPracticeForecastRunIds(): Promise<Set<string>> {
  return getPracticeObjectKeys('FORECAST_RUN');
}

/** 실습 Backtest 실행 id 집합 */
export function getPracticeBacktestRunIds(): Promise<Set<string>> {
  return getPracticeObjectKeys('BACKTEST_RUN');
}

/** 실습 발주계획 id 집합 — analytics.v_practice_plan(is_practice = true인 것만) */
export async function getPracticePlanIds(): Promise<Set<string>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from('v_practice_plan')
      .select('plan_id')
      .eq('is_practice', true);
    if (error) return new Set();
    return new Set((data ?? []).map((row) => String((row as Record<string, unknown>).plan_id)));
  } catch {
    return new Set();
  }
}
