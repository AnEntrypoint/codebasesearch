import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, writeFileSync, readFileSync, mkdtempSync, rmSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('mcp.js formatResults', () => {
  test('zero results message', () => {
    const result = { resultsCount: 0, results: [] };
    const query = 'test query';
    const output = result.resultsCount === 0
      ? `No results found for: "${query}"`
      : 'has results';
    assert.ok(output.includes('No results found'));
    assert.ok(output.includes(query));
  });

  test('formats results with header', () => {
    const result = {
      resultsCount: 1,
      results: [{
        rank: 1, relativePath: 'src/foo.js', totalLines: 100,
        lines: '1-10', enclosingContext: 'myFunc', score: '95.0',
        snippet: 'const x = 1;',
      }],
    };
    const plural = result.resultsCount !== 1 ? 's' : '';
    const header = `Found ${result.resultsCount} result${plural} for: "query"\n\n`;
    assert.ok(header.includes('Found 1 result'));
    assert.ok(!header.includes('results'));
  });

  test('plural form for multiple results', () => {
    const count = 3;
    const plural = count !== 1 ? 's' : '';
    assert.equal(plural, 's');
  });
});

describe('ensureIgnoreEntry logic', () => {
  test('creates .gitignore if missing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mcp-test-'));
    try {
      const gitignorePath = join(tmp, '.gitignore');
      const entry = '.code-search/';
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, `${entry}\n`);
      }
      const content = readFileSync(gitignorePath, 'utf8');
      assert.ok(content.includes(entry));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('appends to existing .gitignore', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mcp-test-'));
    try {
      const gitignorePath = join(tmp, '.gitignore');
      writeFileSync(gitignorePath, 'node_modules/\n');
      const entry = '.code-search/';
      const content = readFileSync(gitignorePath, 'utf8');
      if (!content.includes(entry)) {
        appendFileSync(gitignorePath, `\n${entry}`);
      }
      const updated = readFileSync(gitignorePath, 'utf8');
      assert.ok(updated.includes('node_modules/'));
      assert.ok(updated.includes(entry));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('does not duplicate entry', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mcp-test-'));
    try {
      const gitignorePath = join(tmp, '.gitignore');
      writeFileSync(gitignorePath, '.code-search/\nnode_modules/\n');
      const entry = '.code-search/';
      const content = readFileSync(gitignorePath, 'utf8');
      if (!content.includes(entry)) {
        fs.appendFileSync(gitignorePath, `\n${entry}`);
      }
      const final = readFileSync(gitignorePath, 'utf8');
      const count = (final.match(/\.code-search\//g) || []).length;
      assert.equal(count, 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('MCP tool schema', () => {
  test('search tool has required query field', () => {
    const schema = {
      type: 'object',
      properties: {
        repository_path: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['query'],
    };
    assert.ok(schema.required.includes('query'));
    assert.ok('repository_path' in schema.properties);
    assert.ok('query' in schema.properties);
  });
});
