import { connect } from 'vectordb';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

let dbConnection = null;
let tableRef = null;

export async function initStore(dbPath) {
  // Ensure directory exists
  const dbDir = join(dbPath, 'lancedb');
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  try {
    // Connect to LanceDB (embedded, file-based, no network)
    // Use absolute path for Windows compatibility
    dbConnection = await connect({
      uri: dbDir,
      mode: 'overwrite'
    });
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

    // Try to open existing table
    try {
      table = await dbConnection.openTable(tableName);
      // Overwrite existing table with new data
      await table.overwrite(data);
    } catch (e) {
      // Table doesn't exist, create new one
      table = await dbConnection.createTable(tableName, data);
    }

    tableRef = table;
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

    const results = await tableRef
      .search(query)
      .limit(limit)
      .execute();

    return results.map(result => {
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
  if (!tableRef) {
    return {};
  }

  // For now, we'll do a full reindex each time
  // This ensures the index is always up-to-date
  // Future optimization: store a metadata file with mtimes
  return {};
}

export async function closeStore() {
  // LanceDB doesn't require explicit close in embedded mode
  // But we clear references for cleanliness
  if (dbConnection) {
    dbConnection = null;
    tableRef = null;
  }
}
