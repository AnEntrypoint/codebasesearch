import { parentPort } from 'worker_threads';
import { resolve, relative } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
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
  if (fileLineCountCache.has(absoluteFilePath)) {
    return fileLineCountCache.get(absoluteFilePath);
  }
  try {
    const content = readFileSync(absoluteFilePath, 'utf8');
    const count = content.split('\n').length;
    fileLineCountCache.set(absoluteFilePath, count);
    return count;
  } catch {
    return null;
  }
}

let indexCache = new Map();
// Cache file line counts to avoid repeated disk reads on every search
const fileLineCountCache = new Map();

async function initializeIndex(repositoryPath) {
  const absolutePath = resolve(repositoryPath);

  const cached = indexCache.get(absolutePath);
  if (cached) {
    try {
      const dirStat = statSync(absolutePath);
      if (dirStat.mtimeMs <= cached.indexedAt) return cached;
    } catch {
      return cached;
    }
  }

  try {
    const ignorePatterns = loadIgnorePatterns(absolutePath);
    const chunks = scanRepository(absolutePath, ignorePatterns);

    if (chunks.length === 0) {
      return { error: 'No code chunks found', chunks: [], indexData: null };
    }

    const indexData = buildTextIndex(chunks);
    const result = { chunks, indexData, indexedAt: Date.now() };
    indexCache.set(absolutePath, result);

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

    const rawResults = searchText(query, indexData.chunks, indexData.indexData);

    // Deduplicate: keep best-scoring chunk per file, then take top results
    const bestPerFile = new Map();
    for (const r of rawResults) {
      const existing = bestPerFile.get(r.file_path);
      if (!existing || r.score > existing.score) {
        bestPerFile.set(r.file_path, r);
      }
    }
    const results = Array.from(bestPerFile.values()).sort((a, b) => b.score - a.score);

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
