import { parentPort } from 'worker_threads';
import { resolve, relative } from 'path';
import { existsSync, readFileSync } from 'fs';
import { loadIgnorePatterns } from './ignore-parser.js';
import { scanRepository } from './scanner.js';
import { buildTextIndex, searchText } from './text-search.js';

function findEnclosingContext(content, lineStart) {
  const lines = content.split('\n');
  const targetLine = Math.min(lineStart - 1, lines.length - 1);
  const skip = new Set(['if', 'for', 'while', 'switch', 'catch', 'else']);
  for (let i = targetLine; i >= 0; i--) {
    const line = lines[i];
    const m = line.match(/(?:^|\s)(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{)/);
    if (m) {
      const name = m[1] || m[2] || m[3] || m[4];
      if (name && !skip.has(name)) return name;
    }
  }
  return null;
}

function getFileTotalLines(absoluteFilePath) {
  try {
    const content = readFileSync(absoluteFilePath, 'utf8');
    return content.split('\n').length;
  } catch {
    return null;
  }
}

let indexCache = new Map();

async function initializeIndex(repositoryPath) {
  const absolutePath = resolve(repositoryPath);
  const cacheKey = absolutePath;

  if (indexCache.has(cacheKey)) {
    return indexCache.get(cacheKey);
  }

  try {
    const ignorePatterns = loadIgnorePatterns(absolutePath);
    const chunks = scanRepository(absolutePath, ignorePatterns);

    if (chunks.length === 0) {
      return { error: 'No code chunks found', chunks: [], indexData: null };
    }

    const indexData = buildTextIndex(chunks);
    const result = { chunks, indexData };
    indexCache.set(cacheKey, result);

    return result;
  } catch (error) {
    return { error: error.message, chunks: [], indexData: null };
  }
}

async function performSearch(repositoryPath, query) {
  const absolutePath = resolve(repositoryPath);

  if (!existsSync(absolutePath)) {
    return { error: 'Repository path not found', results: [] };
  }

  try {
    const indexData = await initializeIndex(absolutePath);

    if (indexData.error) {
      return { error: indexData.error, results: [] };
    }

    const results = searchText(query, indexData.chunks, indexData.indexData);

    return {
      query,
      repository: absolutePath,
      resultsCount: results.length,
      results: results.slice(0, 10).map((result, idx) => {
        const absoluteFilePath = resolve(absolutePath, result.file_path);
        const totalLines = getFileTotalLines(absoluteFilePath);
        const enclosingContext = findEnclosingContext(result.content, result.line_start);
        const relPath = relative(absolutePath, absoluteFilePath);
        return {
          rank: idx + 1,
          absolutePath: absoluteFilePath,
          relativePath: relPath,
          lines: `${result.line_start}-${result.line_end}`,
          totalLines,
          enclosingContext,
          score: (result.score * 100).toFixed(1),
          snippet: result.content.split('\n').slice(0, 30).join('\n'),
        };
      }),
    };
  } catch (error) {
    return { error: error.message, results: [] };
  }
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    try {
      if (msg.type === 'health-check') {
        parentPort.postMessage({ id: -1, type: 'pong' });
        return;
      }

      if (msg.type === 'search') {
        const result = await performSearch(msg.repositoryPath || process.cwd(), msg.query);
        parentPort.postMessage({ id: msg.id, result });
      }
    } catch (error) {
      console.error('[Worker] Uncaught error:', error.message);
      try {
        parentPort.postMessage({
          id: msg?.id || -1,
          result: { error: error.message, results: [] }
        });
      } catch (e) {
        console.error('[Worker] Failed to send error response');
      }
    }
  });

  process.on('uncaughtException', (error) => {
    console.error('[Worker] Uncaught exception:', error.message);
    try {
      parentPort.postMessage({
        error: error.message,
        results: []
      });
    } catch (e) {}
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[Worker] Unhandled rejection:', reason);
  });
}
