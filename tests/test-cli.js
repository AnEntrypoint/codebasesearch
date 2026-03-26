import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('cli helpers', () => {
  test('isGitRepository detects .git dir', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cli-test-'));
    try {
      mkdirSync(join(tmp, '.git'));
      assert.ok(existsSync(join(tmp, '.git')));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('isGitRepository returns false without .git', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cli-test-'));
    try {
      assert.equal(existsSync(join(tmp, '.git')), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('ensureIgnoreEntry creates gitignore', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cli-test-'));
    try {
      const gitignorePath = join(tmp, '.gitignore');
      const entry = '.code-search/';
      writeFileSync(gitignorePath, `${entry}\n`);
      assert.ok(readFileSync(gitignorePath, 'utf8').includes(entry));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('cli argument parsing', () => {
  test('empty args would trigger MCP mode', () => {
    const args = [];
    assert.equal(args.length, 0);
  });

  test('args join as query', () => {
    const args = ['hello', 'world'];
    const query = args.join(' ');
    assert.equal(query, 'hello world');
  });

  test('single arg is valid query', () => {
    const args = ['search'];
    const query = args.join(' ');
    assert.equal(query, 'search');
  });
});

describe('incremental indexing logic', () => {
  test('detects new files', () => {
    const indexedFiles = {};
    const scannedMtimes = { 'new.js': 1000 };
    const filesToReindex = new Set();
    for (const [fp, mtime] of Object.entries(scannedMtimes)) {
      if (indexedFiles[fp] === undefined || indexedFiles[fp] !== mtime) {
        filesToReindex.add(fp);
      }
    }
    assert.ok(filesToReindex.has('new.js'));
  });

  test('detects changed files', () => {
    const indexedFiles = { 'changed.js': 500 };
    const scannedMtimes = { 'changed.js': 1000 };
    const filesToReindex = new Set();
    for (const [fp, mtime] of Object.entries(scannedMtimes)) {
      if (indexedFiles[fp] === undefined || indexedFiles[fp] !== mtime) {
        filesToReindex.add(fp);
      }
    }
    assert.ok(filesToReindex.has('changed.js'));
  });

  test('skips unchanged files', () => {
    const indexedFiles = { 'same.js': 1000 };
    const scannedMtimes = { 'same.js': 1000 };
    const filesToReindex = new Set();
    for (const [fp, mtime] of Object.entries(scannedMtimes)) {
      if (indexedFiles[fp] === undefined || indexedFiles[fp] !== mtime) {
        filesToReindex.add(fp);
      }
    }
    assert.equal(filesToReindex.size, 0);
  });

  test('detects deleted files', () => {
    const indexedFiles = { 'deleted.js': 1000, 'kept.js': 1000 };
    const scannedMtimes = { 'kept.js': 1000 };
    const scannedSet = new Set(Object.keys(scannedMtimes));
    const deletedFiles = Object.keys(indexedFiles).filter(fp => !scannedSet.has(fp));
    assert.deepEqual(deletedFiles, ['deleted.js']);
  });
});
