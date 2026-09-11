// 공통 승인 저장소 — 화면 조회는 analytics, 변경은 core RPC만 사용합니다.

import { createSupabaseServerClient } from '../supabase/server';
import {
  normalizeApprovalRow,
  type ApprovalDecision,
  type ApprovalMutationResult,
  type ApprovalPayload,
  type ApprovalRow,
  type ApprovalType,
} from './model';

export type ApprovalRequestInput = {
  approvalType: ApprovalType;
  targetType: string;
  targetId: string;
  payload: ApprovalPayload;
  reasonCode?: string | null;
  reasonText?: string | null;
};

export type ApprovalDecisionInput = {
  approvalId: string;
  decision: ApprovalDecision;
  decisionComment?: string | null;
};

async function readApprovalView(view: 'v_my_approval_inbox' | 'v_approval_history'):
  Promise<{ rows: ApprovalRow[]; error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .schema('analytics')
      .from(view)
      .select('*')
      .order('requested_at', { ascending: false });
    if (error) return { rows: [], error: error.message };
    return { rows: (data ?? []).map((row) => normalizeApprovalRow(row as Record<string, unknown>)), error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : '승인 이력을 조회하지 못했습니다.' };
  }
}

export function getMyApprovalInbox() {
  return readApprovalView('v_my_approval_inbox');
}

export function getApprovalHistory() {
  return readApprovalView('v_approval_history');
}

export async function requestApproval(input: ApprovalRequestInput): Promise<ApprovalMutationResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('request_approval', {
      p_approval_type: input.approvalType,
      p_target_type: input.targetType,
      p_target_id: input.targetId,
      p_payload: input.payload,
      p_reason_code: input.reasonCode ?? null,
      p_reason_text: input.reasonText ?? null,
    });
    if (error) return { approvalId: null, error: error.message };
    return { approvalId: data ? String(data) : null, error: null };
  } catch (error) {
    return { approvalId: null, error: error instanceof Error ? error.message : '승인 요청을 저장하지 못했습니다.' };
  }
}

export async function decideApproval(input: ApprovalDecisionInput): Promise<ApprovalMutationResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.schema('core').rpc('decide_approval', {
      p_approval_id: input.approvalId,
      p_decision: input.decision,
      p_decision_comment: input.decisionComment ?? null,
    });
    if (error) return { approvalId: null, error: error.message };
    return { approvalId: data ? String(data) : null, error: null };
  } catch (error) {
    return { approvalId: null, error: error instanceof Error ? error.message : '승인 요청을 처리하지 못했습니다.' };
  }
}
