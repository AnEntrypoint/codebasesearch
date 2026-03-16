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

let dbConnection = null;
let tableRef = null;
let isFirstBatch = true;
let vectorSearchCache = new Map();

export async function initStore(dbPath) {
  // Ensure directory exists
  const dbDir = join(dbPath, 'lancedb');
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  mtimeIndexPath = join(dbPath, 'mtime-index.json');

  try {
    // Connect to LanceDB (embedded, file-based, no network)
    // Use absolute path for Windows compatibility
    dbConnection = await connect({
      uri: dbDir
    });
    isFirstBatch = true;
    console.error('Vector store initialized');
    return true;
  } catch (e) {
    console.error('Failed to initialize vector store:', e.message);
    throw e;
  }
}

export async function getTable() {
  if (!dbConnection) {
    throw new Error('Store not initialized. Call initStore first.');
  }

  const tableName = 'code_chunks';

  try {
    // Try to open existing table
    tableRef = await dbConnection.openTable(tableName);
  } catch (e) {
    // Table doesn't exist, will be created on first insert
    tableRef = null;
  }

  return tableRef;
}

export async function upsertChunks(chunks) {
  if (!dbConnection) {
    throw new Error('Store not initialized');
  }

  if (chunks.length === 0) {
    return;
  }

  const tableName = 'code_chunks';
  const data = chunks.map(chunk => ({
    file_path: String(chunk.file_path),
    chunk_index: Number(chunk.chunk_index),
    content: String(chunk.content),
    line_start: Number(chunk.line_start),
    line_end: Number(chunk.line_end),
    vector: chunk.vector,
    mtime: Number(chunk.mtime)
  }));

  try {
    let table = null;

    try {
      table = await dbConnection.openTable(tableName);
      await table.add(data);
    } catch (e) {
      if (isFirstBatch) {
        table = await dbConnection.createTable(tableName, data);
      } else {
        console.error('Failed to add to table:', e.message);
        throw e;
      }
    }
    isFirstBatch = false;

    tableRef = table;

    const mtimes = loadMtimeIndex();
    for (const chunk of data) {
      mtimes[chunk.file_path] = chunk.mtime;
    }
    saveMtimeIndex(mtimes);

    console.error(`Indexed ${chunks.length} chunks`);
  } catch (e) {
    console.error('Failed to upsert chunks:', e.message);
    throw e;
  }
}

export async function searchSimilar(queryEmbedding, limit = 10) {
  if (!tableRef) {
    if (!dbConnection) {
      console.error('No database connection');
      return [];
    }
    try {
      await getTable();
    } catch (e) {
      console.error('No index available');
      return [];
    }
  }

  if (!tableRef) {
    console.error('No index available');
    return [];
  }

  try {
    // Ensure vector is a proper array/tensor
    const query = Array.isArray(queryEmbedding) ? queryEmbedding : Array.from(queryEmbedding);

    // Check cache using 20-dimension hash for near-zero collision rate
    const cacheKey = query.slice(0, 20).join(',');
    const cached = vectorSearchCache.get(cacheKey);
    if (cached) {
      return cached.slice(0, limit);
    }

    const results = await tableRef
      .search(query)
      .limit(limit)
      .execute();

    const formattedResults = results.map(result => {
      const distance = result._distance !== undefined ? result._distance : (result.distance || 0);
      const score = distance !== null && distance !== undefined ? 1 / (1 + distance) : 0;
      return {
        file_path: result.file_path,
        chunk_index: result.chunk_index,
        content: result.content,
        line_start: result.line_start,
        line_end: result.line_end,
        distance: distance,
        score: score
      };
    });

    // Cache results (keep max 100 cached searches)
    if (vectorSearchCache.size > 100) {
      const firstKey = vectorSearchCache.keys().next().value;
      vectorSearchCache.delete(firstKey);
    }
    vectorSearchCache.set(cacheKey, formattedResults);

    return formattedResults;
  } catch (e) {
    console.error('Search failed:', e.message);
    return [];
  }
}

export async function getRowCount() {
  if (!tableRef) {
    return 0;
  }

  try {
    return await tableRef.countRows();
  } catch (e) {
    return 0;
  }
}

export async function getIndexedFiles() {
  return loadMtimeIndex();
}

export async function deleteChunksForFiles(filePaths) {
  if (!tableRef || filePaths.length === 0) {
    return;
  }

  try {
    const escaped = filePaths.map(p => `'${p.replace(/'/g, "''")}'`).join(', ');
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
  // LanceDB doesn't require explicit close in embedded mode
  // But we clear references for cleanliness
  if (dbConnection) {
    dbConnection = null;
    tableRef = null;
  }
}
