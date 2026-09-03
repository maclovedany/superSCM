import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getServiceHealth,
  getServiceRun,
  isServiceConfigured,
  runPythonForecast,
  SERVICE_STATE_LABEL,
  SERVICE_STATE_TONE,
} from './forecast-service.ts';

// renew.prd 31.4 — "Python 예측 서버가 중단되어도 이미 저장된 예측 결과는 계속 조회된다."
//
// 그래서 이 모듈의 함수는 어떤 경우에도 throw 하지 않아야 합니다.
// 하나라도 throw 하면 관리자 화면 전체가 500 으로 죽습니다.

function withEnv(url: string | undefined, run: () => Promise<void>): Promise<void> {
  const before = process.env.FORECAST_SERVICE_URL;
  if (url === undefined) delete process.env.FORECAST_SERVICE_URL;
  else process.env.FORECAST_SERVICE_URL = url;
  return run().finally(() => {
    if (before === undefined) delete process.env.FORECAST_SERVICE_URL;
    else process.env.FORECAST_SERVICE_URL = before;
  });
}

test('환경변수가 없으면 미설정으로 돌려주고 throw 하지 않는다', async () => {
  await withEnv(undefined, async () => {
    assert.equal(isServiceConfigured(), false);

    const health = await getServiceHealth();
    assert.equal(health.configured, false);
    assert.equal(health.state, 'UNCONFIGURED');
    assert.equal(health.ok, false);
    assert.deepEqual(health.models, []);
    assert.equal(health.error, null);
  });
});

test('미설정 상태에서 실행을 눌러도 예외 대신 사유를 돌려준다', async () => {
  await withEnv(undefined, async () => {
    const result = await runPythonForecast('run_20250101000000_000', '메모');
    assert.equal(result.ok, false);
    assert.ok(result.error);

    const status = await getServiceRun('run_20250101000000_000');
    assert.equal(status.ok, false);
    assert.ok(status.error);
  });
});

test('서비스가 응답하지 않으면 응답 없음으로 표시한다', async () => {
  // 열려 있지 않은 포트. 연결이 즉시 거절되므로 테스트가 빨리 끝납니다.
  await withEnv('http://127.0.0.1:9', async () => {
    assert.equal(isServiceConfigured(), true);

    const health = await getServiceHealth();
    assert.equal(health.configured, true);
    assert.equal(health.state, 'UNREACHABLE');
    assert.ok(health.error);

    const result = await runPythonForecast('run_20250101000000_000');
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });
});

test('끝의 슬래시가 있어도 설정된 것으로 본다', async () => {
  await withEnv('https://example.invalid/', async () => {
    assert.equal(isServiceConfigured(), true);
  });
});

test('상태 문구와 색은 세 가지뿐이다', () => {
  assert.deepEqual(Object.keys(SERVICE_STATE_LABEL).sort(), [
    'CONFIGURED',
    'UNCONFIGURED',
    'UNREACHABLE',
  ]);
  assert.equal(SERVICE_STATE_LABEL.UNCONFIGURED, '미설정');
  assert.equal(SERVICE_STATE_LABEL.UNREACHABLE, '응답 없음');
  assert.equal(SERVICE_STATE_TONE.CONFIGURED, 'safe');
});
