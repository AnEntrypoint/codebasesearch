import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanRepository, getFileStats } from '../src/scanner.js';

let tmp;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'scan-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('scanRepository', () => {
  test('finds code files', () => {
    writeFileSync(join(tmp, 'app.js'), 'const x = 1;\n');
    writeFileSync(join(tmp, 'lib.py'), 'x = 1\n');
    const chunks = scanRepository(tmp, new Set());
    const files = chunks.map(c => c.file_path).sort();
    assert.ok(files.includes('app.js'));
    assert.ok(files.includes('lib.py'));
  });

  test('excludes node_modules', () => {
    mkdirSync(join(tmp, 'node_modules'));
    writeFileSync(join(tmp, 'node_modules', 'dep.js'), 'module.exports = {};');
    writeFileSync(join(tmp, 'app.js'), 'const x = 1;');
    const chunks = scanRepository(tmp, new Set());
    assert.equal(chunks.every(c => !c.file_path.includes('node_modules')), true);
  });

  test('excludes non-code files', () => {
    writeFileSync(join(tmp, 'photo.png'), 'binary');
    writeFileSync(join(tmp, 'app.js'), 'const x = 1;');
    const chunks = scanRepository(tmp, new Set());
    assert.equal(chunks.every(c => !c.file_path.includes('png')), true);
  });

  test('small file is single chunk', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    writeFileSync(join(tmp, 'small.js'), lines);
    const chunks = scanRepository(tmp, new Set());
    const fileChunks = chunks.filter(c => c.file_path === 'small.js');
    assert.equal(fileChunks.length, 1);
    assert.equal(fileChunks[0].chunk_index, 0);
    assert.equal(fileChunks[0].line_start, 1);
  });

  test('large file produces multiple chunks', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    writeFileSync(join(tmp, 'big.js'), lines);
    const chunks = scanRepository(tmp, new Set());
    const fileChunks = chunks.filter(c => c.file_path === 'big.js');
    assert.ok(fileChunks.length > 1, `expected >1 chunks, got ${fileChunks.length}`);
    assert.equal(fileChunks[0].line_start, 1);
    assert.equal(fileChunks[0].line_end, 60);
  });

  test('empty directory returns empty', () => {
    const chunks = scanRepository(tmp, new Set());
    assert.equal(chunks.length, 0);
  });

  test('subdirectories are scanned', () => {
    mkdirSync(join(tmp, 'sub'));
    writeFileSync(join(tmp, 'sub', 'nested.js'), 'const x = 1;');
    const chunks = scanRepository(tmp, new Set());
    assert.ok(chunks.some(c => c.file_path === 'sub/nested.js'));
  });

  test('chunks have required fields', () => {
    writeFileSync(join(tmp, 'app.js'), 'const x = 1;');
    const chunks = scanRepository(tmp, new Set());
    const c = chunks[0];
    assert.ok('file_path' in c);
    assert.ok('chunk_index' in c);
    assert.ok('content' in c);
    assert.ok('line_start' in c);
    assert.ok('line_end' in c);
    assert.ok('mtime' in c);
  });

  test('respects custom ignore patterns', () => {
    writeFileSync(join(tmp, 'secret.js'), 'const x = 1;');
    writeFileSync(join(tmp, 'app.js'), 'const y = 2;');
    const chunks = scanRepository(tmp, new Set(['secret.js']));
    assert.equal(chunks.every(c => c.file_path !== 'secret.js'), true);
  });
});

describe('getFileStats', () => {
  test('returns file mtime map', () => {
    writeFileSync(join(tmp, 'a.js'), 'x');
    writeFileSync(join(tmp, 'b.js'), 'y');
    const chunks = scanRepository(tmp, new Set());
    const stats = getFileStats(chunks);
    assert.ok('a.js' in stats);
    assert.ok('b.js' in stats);
    assert.equal(typeof stats['a.js'], 'number');
  });
});
