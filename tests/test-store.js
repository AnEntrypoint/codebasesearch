import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initStore, getTable, upsertChunks, searchSimilar, getRowCount, getIndexedFiles, deleteChunksForFiles, closeStore } from '../src/store.js';

const VECTOR_DIM = 384;
const makeVector = (seed = 0) => Array.from({ length: VECTOR_DIM }, (_, i) => Math.sin(i + seed));
let tmp;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'store-test-'));
  await initStore(tmp);
});

afterEach(async () => {
  await closeStore();
  rmSync(tmp, { recursive: true, force: true });
});

describe('initStore', () => {
  test('creates lancedb directory', () => {
    assert.ok(existsSync(join(tmp, 'lancedb')));
  });

  test('creates mtime-index.json path', async () => {
    await upsertChunks([{
      file_path: 'x.js', chunk_index: 0, content: 'x',
      line_start: 1, line_end: 1, vector: makeVector(), mtime: 100,
    }]);
    assert.ok(existsSync(join(tmp, 'mtime-index.json')));
  });
});

describe('upsertChunks', () => {
  test('inserts and counts rows', async () => {
    await upsertChunks([{
      file_path: 'a.js', chunk_index: 0, content: 'hello',
      line_start: 1, line_end: 1, vector: makeVector(1), mtime: 100,
    }]);
    const count = await getRowCount();
    assert.ok(count >= 1);
  });

  test('no-op on empty array', async () => {
    await upsertChunks([]);
    const count = await getRowCount();
    assert.equal(count, 0);
  });

  test('stores multiple chunks', async () => {
    const chunks = Array.from({ length: 5 }, (_, i) => ({
      file_path: `file${i}.js`, chunk_index: 0, content: `code ${i}`,
      line_start: 1, line_end: 1, vector: makeVector(i), mtime: 100 + i,
    }));
    await upsertChunks(chunks);
    const count = await getRowCount();
    assert.ok(count >= 5);
  });
});

describe('searchSimilar', () => {
  test('finds similar vectors', async () => {
    const vec = makeVector(42);
    await upsertChunks([{
      file_path: 'target.js', chunk_index: 0, content: 'target code',
      line_start: 1, line_end: 1, vector: vec, mtime: 100,
    }]);
    await getTable();
    const results = await searchSimilar(vec, 5);
    assert.ok(results.length > 0);
    assert.equal(results[0].file_path, 'target.js');
    assert.ok(results[0].score > 0);
  });

  test('returns empty without table', async () => {
    const results = await searchSimilar(makeVector(), 5);
    assert.equal(results.length, 0);
  });

  test('result has expected fields', async () => {
    await upsertChunks([{
      file_path: 'f.js', chunk_index: 0, content: 'c',
      line_start: 1, line_end: 1, vector: makeVector(), mtime: 1,
    }]);
    await getTable();
    const results = await searchSimilar(makeVector(), 1);
    const r = results[0];
    assert.ok('file_path' in r);
    assert.ok('chunk_index' in r);
    assert.ok('content' in r);
    assert.ok('line_start' in r);
    assert.ok('line_end' in r);
    assert.ok('distance' in r);
    assert.ok('score' in r);
  });
});

describe('getIndexedFiles', () => {
  test('returns mtime map', async () => {
    await upsertChunks([{
      file_path: 'tracked.js', chunk_index: 0, content: 'x',
      line_start: 1, line_end: 1, vector: makeVector(), mtime: 999,
    }]);
    const indexed = await getIndexedFiles();
    assert.equal(indexed['tracked.js'], 999);
  });
});

describe('deleteChunksForFiles', () => {
  test('removes files from index', async () => {
    await upsertChunks([{
      file_path: 'del.js', chunk_index: 0, content: 'x',
      line_start: 1, line_end: 1, vector: makeVector(), mtime: 1,
    }]);
    await getTable();
    await deleteChunksForFiles(['del.js']);
    const indexed = await getIndexedFiles();
    assert.equal(indexed['del.js'], undefined);
  });

  test('no-op on empty array', async () => {
    await deleteChunksForFiles([]);
  });
});
