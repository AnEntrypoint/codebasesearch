import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { Worker } from 'worker_threads';
import { resolve } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function sendWorkerMessage(msg, timeoutMs = 15000) {
  return new Promise((res, rej) => {
    const worker = new Worker(resolve('/home/user/codebasesearch/src/search-worker.js'));
    const timer = setTimeout(() => { worker.terminate(); rej(new Error('timeout')); }, timeoutMs);
    worker.on('message', (m) => { clearTimeout(timer); worker.terminate(); res(m); });
    worker.on('error', (e) => { clearTimeout(timer); rej(e); });
    worker.postMessage(msg);
  });
}

describe('search-worker', () => {
  test('health check returns pong', async () => {
    const result = await sendWorkerMessage({ type: 'health-check', id: -1 });
    assert.equal(result.id, -1);
    assert.equal(result.type, 'pong');
  });

  test('search returns results for real repo', async () => {
    const result = await sendWorkerMessage({
      type: 'search', id: 1, query: 'function',
      repositoryPath: '/home/user/codebasesearch',
    });
    assert.equal(result.id, 1);
    assert.ok(result.result);
    assert.ok(result.result.resultsCount > 0);
  });

  test('result has expected structure', async () => {
    const result = await sendWorkerMessage({
      type: 'search', id: 2, query: 'import',
      repositoryPath: '/home/user/codebasesearch',
    });
    const r = result.result.results[0];
    assert.ok(r.rank >= 1);
    assert.ok(r.absolutePath);
    assert.ok(r.relativePath);
    assert.ok(r.lines);
    assert.ok(r.score);
    assert.ok(r.snippet);
  });

  test('nonexistent repo returns error', async () => {
    const result = await sendWorkerMessage({
      type: 'search', id: 3, query: 'test',
      repositoryPath: '/tmp/nonexistent-xyz-repo',
    });
    assert.ok(result.result.error);
  });

  test('empty repo returns error', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'empty-repo-'));
    try {
      const result = await sendWorkerMessage({
        type: 'search', id: 4, query: 'test', repositoryPath: tmp,
      });
      assert.ok(result.result.error || result.result.resultsCount === 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('enclosingContext detects functions', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ctx-test-'));
    writeFileSync(join(tmp, 'ctx.js'), 'function mySpecialFunc() {\n  const x = 1;\n  return x;\n}\n');
    try {
      const result = await sendWorkerMessage({
        type: 'search', id: 5, query: 'mySpecialFunc', repositoryPath: tmp,
      });
      const r = result.result.results?.[0];
      assert.ok(r, 'should have a result');
      assert.equal(r.enclosingContext, 'mySpecialFunc');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('deduplicates per file', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dedup-test-'));
    const lines = Array.from({ length: 200 }, (_, i) => `const line${i} = ${i};`).join('\n');
    writeFileSync(join(tmp, 'big.js'), lines);
    try {
      const result = await sendWorkerMessage({
        type: 'search', id: 6, query: 'const line', repositoryPath: tmp,
      });
      const files = result.result.results.map(r => r.relativePath);
      const unique = new Set(files);
      assert.equal(files.length, unique.size, 'should have one result per file');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
