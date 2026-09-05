# 실데이터 전환 — Plan 2 (Python 예측 서비스 전체 파이프라인)

> 스펙 `docs/superpowers/specs/2026-09-05-realdata-cutover-design.md` §6. 구현 완료 (2026-09-05).

## 한 일
| 파일 | 일 |
|---|---|
| `forecast-service/app/db.py` | `fetch_setting` 에 `production_train_end` · `fetch_grid(conn, mode)`(운영은 `v_forecast_grid` PRODUCTION) · `call_baseline_forecast` · `call_refresh_materialized` · `call_backtest` (직접 접속 · `statement_timeout = 0`) |
| `forecast-service/app/pipeline.py` | `check_run_window` 모드별 경계 · `forecast_one_model` 진행률(500 품목) + **시간 예산**(총량 큰 품목 먼저, 초과분 `TIME_BUDGET`) · `run_full` (SQL → Python → 실체화 → 검증이면 백테스트) · `run_status` 가 pipeline id 도 받음 |
| `forecast-service/app/main.py` | `POST /pipeline/run {mode, note, models}` |
| `forecast-service/tests/test_full_pipeline.py` | 단계 순서 · 운영은 백테스트 없음 · SQL 0행이면 실패 · Python 실패도 실체화 계속 · 진행률 · 예산 |
| `lib/forecast-service.ts` | `runPipeline` · `ServiceRunStatus.stage/progress` |
| `app/(admin)/admin/forecast-runs/actions.ts` | 서비스가 살아 있으면 파이프라인, 아니면 예전 RPC(SQL 5종) |

## 실측 (하네스 · 실데이터 9,772 품목 · 이 Mac)
| 단계 | 시간 |
|---|---|
| SQL 5종 (`run_baseline_forecast`) | 11초 |
| CROSTON · SBA · TSB (7,022 간헐 품목) | 33 · 14 · 14초 |
| ETS (9,772) | 49초 |
| HOLT_WINTERS · SARIMA (24개월 이상 평활 20품목) | 2 · 3초 |
| LIGHTGBM | 예산 240초에 244품목 (품목당 ~1초) → 나머지 9,528 은 TIME_BUDGET |
| 실체화 + 백테스트 | 1초 + 7초 |
| **전체** | **6분 44초** (목표 30분 이내) |

## 스펙과 다른 점
- 로컬 Docker 대신 **venv 로 직접 실행**해 검증했습니다 — 이 Mac 에 Docker 가 없습니다. Dockerfile 은 그대로 쓸 수 있습니다.
- LightGBM 은 전 품목이 아니라 **시간 예산 안의 상위 품목**만 냅니다. 스펙 §6 의 "첫 조정" 을 SARIMA 가 아니라 LightGBM 에 적용했습니다(SARIMA 는 24개월 규칙으로 이미 20품목).
