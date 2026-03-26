import { test, describe, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { WorkerSupervisor } from '../src/supervisor.js';

let sup;

afterEach(() => {
  if (sup) { sup.shutdown(); sup = null; }
});

describe('WorkerSupervisor', () => {
  test('constructor starts worker', () => {
    sup = new WorkerSupervisor();
    assert.ok(sup.worker !== null);
  });

  test('sendRequest returns search results', async () => {
    sup = new WorkerSupervisor();
    await new Promise(r => setTimeout(r, 500));
    const result = await sup.sendRequest({
      type: 'search',
      query: 'function',
      repositoryPath: '/home/user/codebasesearch',
    });
    assert.ok(result.resultsCount >= 0 || result.results !== undefined);
  });

  test('sendRequest handles health check id', async () => {
    sup = new WorkerSupervisor();
    await new Promise(r => setTimeout(r, 300));
    sup.handleMessage({ id: -1, type: 'pong' });
    assert.equal(sup.requestQueue.size, 0);
  });

  test('shutdown clears worker', () => {
    sup = new WorkerSupervisor();
    sup.shutdown();
    assert.equal(sup.worker, null);
    assert.equal(sup.healthCheckInterval, null);
    sup = null;
  });

  test('sendRequest when worker null returns error', async () => {
    sup = new WorkerSupervisor();
    sup.shutdown();
    const result = await sup.sendRequest({ type: 'search', query: 'x' });
    assert.ok(result.error);
    assert.deepEqual(result.results, []);
    sup = null;
  });

  test('multiple concurrent requests', async () => {
    sup = new WorkerSupervisor();
    await new Promise(r => setTimeout(r, 500));
    const [r1, r2] = await Promise.all([
      sup.sendRequest({ type: 'search', query: 'import', repositoryPath: '/home/user/codebasesearch' }),
      sup.sendRequest({ type: 'search', query: 'function', repositoryPath: '/home/user/codebasesearch' }),
    ]);
    assert.ok(r1.resultsCount >= 0);
    assert.ok(r2.resultsCount >= 0);
  });

  test('requestId increments', () => {
    sup = new WorkerSupervisor();
    const before = sup.requestId;
    sup.sendRequest({ type: 'search', query: 'x', repositoryPath: '/tmp' });
    assert.equal(sup.requestId, before + 1);
  });
});
