import { parentPort } from 'worker_threads';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { loadIgnorePatterns } from './ignore-parser.js';
import { scanRepository } from './scanner.js';
import { buildTextIndex, searchText } from './text-search.js';

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
      return { error: 'No code chunks found', chunks: [], index: null };
    }

    const index = buildTextIndex(chunks);
    const indexData = { chunks, index };
    indexCache.set(cacheKey, indexData);

    return indexData;
  } catch (error) {
    return { error: error.message, chunks: [], index: null };
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

    const results = searchText(query, indexData.chunks, indexData.index);

    return {
      query,
      repository: absolutePath,
      resultsCount: results.length,
      results: results.slice(0, 10).map((result, idx) => ({
        rank: idx + 1,
        file: result.file_path,
        lines: `${result.line_start}-${result.line_end}`,
        score: (result.score * 100).toFixed(1),
        snippet: result.content.split('\n').slice(0, 3).join('\n'),
      })),
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
