import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { executeSearch, formatResults } from '../src/search.js';

const sampleChunks = [
  { file_path: 'app.js', chunk_index: 0, content: 'function hello() { return "world"; }', line_start: 1, line_end: 1, mtime: 1000 },
  { file_path: 'lib.js', chunk_index: 0, content: 'export class Database { connect() {} }', line_start: 1, line_end: 1, mtime: 1000 },
  { file_path: 'util.py', chunk_index: 0, content: 'def format_string(s):\n    return s.strip()', line_start: 1, line_end: 2, mtime: 1000 },
];

describe('executeSearch', () => {
  test('throws on empty query', async () => {
    await assert.rejects(() => executeSearch(''), { message: 'Query cannot be empty' });
  });

  test('throws on whitespace query', async () => {
    await assert.rejects(() => executeSearch('   '), { message: 'Query cannot be empty' });
  });

  test('returns results with chunks', async () => {
    const results = await executeSearch('hello', 10, sampleChunks, true);
    assert.ok(results.length > 0);
    assert.equal(results[0].file_path, 'app.js');
  });

  test('respects limit', async () => {
    const results = await executeSearch('function', 1, sampleChunks, true);
    assert.ok(results.length <= 1);
  });

  test('returns empty array for no match with chunks', async () => {
    const results = await executeSearch('xyznonexistent999', 10, sampleChunks, true);
    assert.equal(results.length, 0);
  });

  test('works with skipVector', async () => {
    const results = await executeSearch('Database', 10, sampleChunks, true);
    assert.ok(results.some(r => r.file_path === 'lib.js'));
  });
});

describe('formatResults', () => {
  test('empty results message', () => {
    assert.equal(formatResults([]), 'No results found.');
  });

  test('formats single result', () => {
    const results = [{ file_path: 'a.js', line_start: 1, line_end: 5, score: 0.95, content: 'const x = 1;' }];
    const output = formatResults(results);
    assert.ok(output.includes('Found 1 result'));
    assert.ok(output.includes('a.js'));
  });

  test('formats multiple results', () => {
    const results = [
      { file_path: 'a.js', line_start: 1, line_end: 5, score: 0.9, content: 'line1' },
      { file_path: 'b.js', line_start: 10, line_end: 20, score: 0.5, content: 'line2' },
    ];
    const output = formatResults(results);
    assert.ok(output.includes('Found 2 results'));
    assert.ok(output.includes('1.'));
    assert.ok(output.includes('2.'));
  });

  test('uses finalScore when available', () => {
    const results = [{ file_path: 'a.js', line_start: 1, line_end: 1, finalScore: 0.85, score: 0.5, content: 'x' }];
    const output = formatResults(results);
    assert.ok(output.includes('85.0%'));
  });

  test('truncates long code lines', () => {
    const longLine = 'x'.repeat(200);
    const results = [{ file_path: 'a.js', line_start: 1, line_end: 1, score: 1, content: longLine }];
    const output = formatResults(results);
    const lines = output.split('\n');
    const codeLine = lines.find(l => l.startsWith('   >'));
    assert.ok(codeLine.length <= 85);
  });
});
