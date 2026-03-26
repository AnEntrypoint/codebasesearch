import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { isCodeFile, shouldIgnoreDirectory, shouldIgnore, loadIgnorePatterns } from '../src/ignore-parser.js';

describe('isCodeFile', () => {
  const codeExts = [
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.c', '.cpp',
    '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.sh', '.lua', '.r',
    '.jl', '.dart', '.ex', '.hs', '.clj', '.vue', '.svelte', '.css', '.html',
    '.sql', '.md', '.yaml', '.toml', '.xml',
  ];

  for (const ext of codeExts) {
    test(`accepts ${ext}`, () => assert.equal(isCodeFile(`file${ext}`), true));
  }

  test('rejects no extension', () => assert.equal(isCodeFile('Makefile'), false));
  test('rejects hidden no ext', () => assert.equal(isCodeFile('.gitignore'), false));
  test('rejects binary .exe', () => assert.equal(isCodeFile('app.exe'), false));
  test('rejects .png', () => assert.equal(isCodeFile('image.png'), false));
  test('handles nested paths', () => assert.equal(isCodeFile('src/lib/foo.ts'), true));
  test('handles windows paths', () => assert.equal(isCodeFile('src\\lib\\foo.ts'), true));
  test('handles multiple dots', () => assert.equal(isCodeFile('file.test.js'), true));
  test('case insensitive ext', () => assert.equal(isCodeFile('FILE.JS'), true));
});

describe('shouldIgnoreDirectory', () => {
  const ignoredDirs = [
    'node_modules', '.git', 'dist', 'build', '.cache', 'coverage',
    '__pycache__', '.venv', '.next', '.nuxt', 'target', 'tmp',
  ];

  for (const dir of ignoredDirs) {
    test(`ignores ${dir}`, () => assert.equal(shouldIgnoreDirectory(dir), true));
  }

  test('allows src', () => assert.equal(shouldIgnoreDirectory('src'), false));
  test('allows lib', () => assert.equal(shouldIgnoreDirectory('lib'), false));
  test('detects nested ignored', () => assert.equal(shouldIgnoreDirectory('foo/node_modules/bar'), true));
  test('handles windows paths', () => assert.equal(shouldIgnoreDirectory('foo\\node_modules\\bar'), true));
});

describe('shouldIgnore', () => {
  const patterns = new Set(['package-lock.json', 'yarn.lock']);

  test('ignores file matching pattern', () => {
    assert.equal(shouldIgnore('package-lock.json', patterns), true);
  });

  test('ignores file in ignored directory', () => {
    assert.equal(shouldIgnore('node_modules/dep.js', new Set()), true);
  });

  test('ignores non-code file', () => {
    assert.equal(shouldIgnore('image.png', new Set()), true);
  });

  test('allows code file not matching patterns', () => {
    assert.equal(shouldIgnore('src/foo.js', new Set()), false);
  });

  test('handles directory mode', () => {
    assert.equal(shouldIgnore('node_modules', new Set(), true), true);
    assert.equal(shouldIgnore('src', new Set(), true), false);
  });

  test('matches pattern with slash', () => {
    assert.equal(shouldIgnore('foo/bar.js', new Set(['foo/bar.js']), false), true);
  });

  test('checks ancestor directories', () => {
    assert.equal(shouldIgnore('dist/bundle.js', new Set()), true);
  });
});

describe('loadIgnorePatterns', () => {
  test('returns Set from real project', () => {
    const patterns = loadIgnorePatterns('/home/user/codebasesearch');
    assert.equal(patterns instanceof Set, true);
    assert.equal(patterns.size > 0, true);
  });

  test('handles nonexistent directory', () => {
    const patterns = loadIgnorePatterns('/tmp/nonexistent-dir-xyz');
    assert.equal(patterns instanceof Set, true);
    assert.equal(patterns.size > 0, true);
  });
});
