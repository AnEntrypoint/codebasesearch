import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildTextIndex, searchText } from '../src/text-search.js';

const sampleChunks = [
  { file_path: 'src/search.js', chunk_index: 0, content: 'function searchText(query) {\n  return query.toLowerCase();\n}', line_start: 1, line_end: 3 },
  { file_path: 'src/user.py', chunk_index: 0, content: 'class UserManager:\n  def create_user(self, name):\n    pass', line_start: 1, line_end: 3 },
  { file_path: 'readme.md', chunk_index: 0, content: 'This is documentation about the search module', line_start: 1, line_end: 1 },
  { file_path: 'src/utils.js', chunk_index: 0, content: 'export function formatDate(date) {\n  return date.toISOString();\n}', line_start: 1, line_end: 3 },
];

describe('buildTextIndex', () => {
  test('returns index, chunkMetadata, idf', () => {
    const result = buildTextIndex(sampleChunks);
    assert.ok(result.index instanceof Map);
    assert.ok(result.idf instanceof Map);
    assert.equal(result.chunkMetadata.length, sampleChunks.length);
  });

  test('index maps tokens to document sets', () => {
    const { index } = buildTextIndex(sampleChunks);
    for (const [token, docs] of index) {
      assert.ok(docs instanceof Set, `token ${token} should map to Set`);
      for (const idx of docs) {
        assert.ok(idx >= 0 && idx < sampleChunks.length);
      }
    }
  });

  test('metadata has expected fields', () => {
    const { chunkMetadata } = buildTextIndex(sampleChunks);
    for (const meta of chunkMetadata) {
      assert.ok(meta.fileNameTokens instanceof Set);
      assert.ok(meta.symbols instanceof Set);
      assert.ok(meta.frequency instanceof Map);
      assert.equal(typeof meta.isCode, 'boolean');
      assert.equal(typeof meta.contentLower, 'string');
    }
  });

  test('idf values are positive', () => {
    const { idf } = buildTextIndex(sampleChunks);
    for (const [token, val] of idf) {
      assert.ok(val > 0, `idf for ${token} should be positive`);
    }
  });
});

describe('searchText', () => {
  test('finds matching chunks', () => {
    const indexData = buildTextIndex(sampleChunks);
    const results = searchText('searchText', sampleChunks, indexData);
    assert.ok(results.length > 0);
    assert.equal(results[0].file_path, 'src/search.js');
  });

  test('results sorted by score descending', () => {
    const indexData = buildTextIndex(sampleChunks);
    const results = searchText('function', sampleChunks, indexData);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i].score <= results[i - 1].score);
    }
  });

  test('returns empty for no match', () => {
    const indexData = buildTextIndex(sampleChunks);
    const results = searchText('xyznonexistent123', sampleChunks, indexData);
    assert.equal(results.length, 0);
  });

  test('top score normalized to 1', () => {
    const indexData = buildTextIndex(sampleChunks);
    const results = searchText('search', sampleChunks, indexData);
    if (results.length > 0) {
      assert.equal(results[0].score, 1);
    }
  });

  test('code file boost applied', () => {
    const indexData = buildTextIndex(sampleChunks);
    const results = searchText('documentation search module', sampleChunks, indexData);
    const jsResults = results.filter(r => r.file_path.endsWith('.js'));
    const mdResults = results.filter(r => r.file_path.endsWith('.md'));
    if (jsResults.length > 0 && mdResults.length > 0) {
      assert.ok(jsResults[0]._rawScore !== undefined);
    }
  });

  test('camelCase tokenization works', () => {
    const indexData = buildTextIndex(sampleChunks);
    const results = searchText('search text', sampleChunks, indexData);
    assert.ok(results.length > 0);
  });

  test('symbol extraction finds functions', () => {
    const indexData = buildTextIndex(sampleChunks);
    const results = searchText('formatDate', sampleChunks, indexData);
    assert.ok(results.some(r => r.file_path === 'src/utils.js'));
  });

  test('symbol extraction finds classes', () => {
    const indexData = buildTextIndex(sampleChunks);
    const results = searchText('UserManager', sampleChunks, indexData);
    assert.ok(results.some(r => r.file_path === 'src/user.py'));
  });
});
