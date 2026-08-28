'use client';

import { useActionState } from 'react';
import Button from '@/components/ui/button';
import { runBaselineForecastAction, type ForecastActionState } from '@/app/(admin)/admin/forecast-runs/actions';

const initialState: ForecastActionState = { error: null, success: null };

export default function ForecastRunTrigger() {
  const [state, action, pending] = useActionState(runBaselineForecastAction, initialState);
  return <form action={action} className="button-row forecast-run-form"><input className="form-input" name="note" placeholder="실행 메모 (선택)" /><Button variant="primary" type="submit" disabled={pending}>{pending ? '실행 중…' : 'SQL Baseline 실행'}</Button>{state.error ? <span className="text-danger">{state.error}</span> : null}{state.success ? <span className="text-good">{state.success}</span> : null}</form>;
}
