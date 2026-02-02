import { parentPort } from 'worker_threads';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { loadIgnorePatterns } from './ignore-parser.js';
import { scanRepository } from './scanner.js';
import { generateEmbeddings } from './embeddings.js';
import { initStore, upsertChunks, closeStore } from './store.js';
import { executeSearch } from './search.js';

async function performSearch(repositoryPath, query) {
  const absolutePath = resolve(repositoryPath);

  if (!existsSync(absolutePath)) {
    return { error: 'Repository path not found', results: [] };
  }

  try {
    const ignorePatterns = loadIgnorePatterns(absolutePath);
    const dbPath = resolve(absolutePath, '.code-search');

    await initStore(dbPath);

    const chunks = scanRepository(absolutePath, ignorePatterns);
    if (chunks.length === 0) {
      await closeStore();
      return { query, results: [], message: 'No code chunks found' };
    }

    const batchSize = 32;
    const allEmbeddings = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batchTexts = chunks.slice(i, i + batchSize).map(c => c.content);
      const batchEmbeddings = await generateEmbeddings(batchTexts);
      allEmbeddings.push(...batchEmbeddings);
    }

    const chunksWithEmbeddings = chunks.map((chunk, idx) => ({
      ...chunk,
      vector: allEmbeddings[idx],
    }));

    await upsertChunks(chunksWithEmbeddings);
    const results = await executeSearch(query);
    await closeStore();

    return {
      query,
      repository: absolutePath,
      resultsCount: results.length,
      results: results.map((result, idx) => ({
        rank: idx + 1,
        file: result.file_path,
        lines: `${result.line_start}-${result.line_end}`,
        score: (result.score * 100).toFixed(1),
        snippet: result.content.split('\n').slice(0, 3).join('\n'),
      })),
    };
  } catch (error) {
    await closeStore().catch(() => {});
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
