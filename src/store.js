import { createEmbedded } from 'busybase/embedded';
import { connect } from 'vectordb';
import { join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

let mtimeIndexPath = null;

function loadMtimeIndex() {
  if (!mtimeIndexPath || !existsSync(mtimeIndexPath)) return {};
  try {
    return JSON.parse(readFileSync(mtimeIndexPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveMtimeIndex(map) {
  if (!mtimeIndexPath) return;
  writeFileSync(mtimeIndexPath, JSON.stringify(map), 'utf8');
}

let bbClient = null;
let vdbConnection = null;
let tableRef = null;
let vectorSearchCache = new Map();

export async function initStore(dbPath) {
  const dbDir = join(dbPath, 'lancedb');
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  mtimeIndexPath = join(dbPath, 'mtime-index.json');
  try {
    bbClient = await createEmbedded({ dir: dbDir });
    vdbConnection = await connect({ uri: dbDir });
    console.error('Vector store initialized');
    return true;
  } catch (e) {
    console.error('Failed to initialize vector store:', e.message);
    throw e;
  }
}

export async function getTable() {
  if (!vdbConnection) throw new Error('Store not initialized. Call initStore first.');
  try {
    tableRef = await vdbConnection.openTable('code_chunks');
  } catch {
    tableRef = null;
  }
  return tableRef;
}

export async function upsertChunks(chunks) {
  if (!bbClient) throw new Error('Store not initialized');
  if (!chunks.length) return;

  const data = chunks.map(chunk => ({
    id: `${chunk.file_path}::${chunk.chunk_index}`,
    file_path: String(chunk.file_path),
    chunk_index: Number(chunk.chunk_index),
    content: String(chunk.content),
    line_start: Number(chunk.line_start),
    line_end: Number(chunk.line_end),
    vector: chunk.vector,
    mtime: Number(chunk.mtime)
  }));

  try {
    const res = await bbClient.from('code_chunks').insert(data);
    if (res.error) throw new Error(res.error.message);

    if (!tableRef && vdbConnection) {
      try { tableRef = await vdbConnection.openTable('code_chunks'); } catch {}
    }

    const mtimes = loadMtimeIndex();
    for (const chunk of data) mtimes[chunk.file_path] = chunk.mtime;
    saveMtimeIndex(mtimes);

    console.error(`Indexed ${chunks.length} chunks`);
  } catch (e) {
    console.error('Failed to upsert chunks:', e.message);
    throw e;
  }
}

export async function searchSimilar(queryEmbedding, limit = 10) {
  if (!tableRef) {
    if (!vdbConnection) { console.error('No database connection'); return []; }
    try { await getTable(); } catch { return []; }
  }
  if (!tableRef) { console.error('No index available'); return []; }

  try {
    const query = Array.isArray(queryEmbedding) ? queryEmbedding : Array.from(queryEmbedding);
    const cacheKey = query.slice(0, 20).join(',');
    const cached = vectorSearchCache.get(cacheKey);
    if (cached) return cached.slice(0, limit);

    const results = await tableRef.search(query).limit(limit).execute();
    const formattedResults = results.map(result => {
      const distance = result._distance !== undefined ? result._distance : (result.distance || 0);
      return {
        file_path: result.file_path,
        chunk_index: result.chunk_index,
        content: result.content,
        line_start: result.line_start,
        line_end: result.line_end,
        distance,
        score: distance !== null && distance !== undefined ? 1 / (1 + distance) : 0
      };
    });

    if (vectorSearchCache.size > 100) {
      vectorSearchCache.delete(vectorSearchCache.keys().next().value);
    }
    vectorSearchCache.set(cacheKey, formattedResults);
    return formattedResults;
  } catch (e) {
    console.error('Search failed:', e.message);
    return [];
  }
}

export async function getRowCount() {
  if (!tableRef) return 0;
  try { return await tableRef.countRows(); } catch { return 0; }
}

export async function getIndexedFiles() {
  return loadMtimeIndex();
}

export async function deleteChunksForFiles(filePaths) {
  if (!tableRef || !filePaths.length) return;
  try {
    const escaped = filePaths.map(p => "'" + p.replace(/'/g, "''") + "'").join(', ');
    await tableRef.delete(`file_path IN (${escaped})`);
    vectorSearchCache.clear();
    const mtimes = loadMtimeIndex();
    for (const fp of filePaths) delete mtimes[fp];
    saveMtimeIndex(mtimes);
  } catch (e) {
    console.error('Failed to delete chunks:', e.message);
  }
}

export async function closeStore() {
  bbClient = null;
  vdbConnection = null;
  tableRef = null;
}
