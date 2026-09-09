'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
export type BacktestState={error:string|null;success:string|null};
export async function runBacktestAction(_:BacktestState,formData:FormData):Promise<BacktestState>{try{await requireAdmin();const id=String(formData.get('forecastRunId')??'');if(!id)return{error:'Forecast Run을 선택하세요.',success:null};const s=await createSupabaseServerClient();const {data,error}=await s.rpc('run_backtest',{p_forecast_run_id:id});if(error)return{error:error.message,success:null};revalidatePath('/admin/backtest-runs');return{error:null,success:`Backtest Run: ${data}`};}catch(e){return{error:e instanceof Error?e.message:'Backtest 실행 실패',success:null};}}
