import { parentPort } from 'worker_threads';
import { resolve, relative } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
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

function getWorkspaceFolders(workspacePath) {
  try {
    const entries = readdirSync(workspacePath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => resolve(workspacePath, e.name));
  } catch {
    return [];
  }
}

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

async function performSearchAll(workspacePaths, query, limit = 10) {
  const allResults = [];

  for (const repoPath of workspacePaths) {
    const absolutePath = resolve(repoPath);
    if (!existsSync(absolutePath)) continue;

    const indexData = await initializeIndex(absolutePath);
    if (indexData.error || !indexData.chunks) continue;

    const results = searchText(query, indexData.chunks, indexData.indexData);
    const repoName = absolutePath.split('/').pop();

    const seenFiles = new Set();
    for (const r of results) {
      if (!seenFiles.has(r.file_path)) {
        seenFiles.add(r.file_path);
        allResults.push({ ...r, repoName, repoPath: absolutePath });
      }
      if (seenFiles.size >= limit) break;
    }
  }

  allResults.sort((a, b) => b.score - a.score);
  const top = allResults.slice(0, limit);

  return {
    query,
    resultsCount: top.length,
    results: top.map((r, idx) => {
      const absoluteFilePath = resolve(r.repoPath, r.file_path);
      const totalLines = getFileTotalLines(absoluteFilePath);
      const enclosingContext = findEnclosingContext(r.content, r.line_start);
      return {
        rank: idx + 1,
        absolutePath: absoluteFilePath,
        relativePath: `${r.repoName}/${r.file_path}`,
        lines: `${r.line_start}-${r.line_end}`,
        totalLines,
        enclosingContext,
        score: (r.score * 100).toFixed(1),
        snippet: r.content.split('\n').slice(0, 30).join('\n'),
      };
    }),
  };
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    try {
      if (msg.type === 'health-check') {
        parentPort.postMessage({ id: -1, type: 'pong' });
        return;
      }

      if (msg.type === 'index-all') {
        const folders = msg.workspacePaths || getWorkspaceFolders(msg.workspacePath || '');
        let indexed = 0;
        for (const folder of folders) {
          if (existsSync(folder)) {
            await initializeIndex(folder);
            indexed++;
          }
        }
        parentPort.postMessage({ id: msg.id, result: { indexed, message: `Indexed ${indexed} repositories` } });
        return;
      }

      if (msg.type === 'search-all') {
        const folders = msg.workspacePaths || getWorkspaceFolders(msg.workspacePath || '');
        const result = await performSearchAll(folders, msg.query, msg.limit || 10);
        parentPort.postMessage({ id: msg.id, result });
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
