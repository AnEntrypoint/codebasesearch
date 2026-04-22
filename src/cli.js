import { cwd } from 'process';
import { join } from 'path';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { loadIgnorePatterns } from './ignore-parser.js';
import { scanRepository } from './scanner.js';
import { generateEmbeddings } from './embeddings.js';
import { initStore, upsertChunks, closeStore, getIndexedFiles, deleteChunksForFiles, getTable } from './store.js';
import { executeSearch, formatResults } from './search.js';
import { startMcpServer } from '../mcp.js';

async function isGitRepository(rootPath) {
  const gitDir = join(rootPath, '.git');
  try {
    return existsSync(gitDir);
  } catch {
    return false;
  }
}

async function ensureIgnoreEntry(rootPath) {
  const gitignorePath = join(rootPath, '.gitignore');
  const entry = '.code-search/';

  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf8');
      if (!content.includes(entry)) {
        appendFileSync(gitignorePath, `\n${entry}`);
      }
    } else {
      writeFileSync(gitignorePath, `${entry}\n`);
    }
  } catch (e) {
    // Ignore write errors, proceed with search anyway
  }
}


export async function run(args) {
  try {
    // Start MCP server if no arguments provided
    if (args.length === 0) {
      await startMcpServer();
      return;
    }

    const query = args.join(' ');
    const rootPath = cwd();

    console.log(`Code Search Tool`);
    console.log(`Root: ${rootPath}\n`);

    // Check if git repo
    const isGit = await isGitRepository(rootPath);
    if (!isGit) {
      console.warn('Warning: Not a git repository. Indexing current directory anyway.\n');
    }

    // Ensure .code-search/ is in .gitignore
    await ensureIgnoreEntry(rootPath);

    // Load ignore patterns
    const ignorePatterns = loadIgnorePatterns(rootPath);
    const dbPath = join(rootPath, '.code-search');

    // Initialize store
    await initStore(dbPath);
    await getTable();

    // Scan repository
    console.log('Scanning repository...');
    const chunks = scanRepository(rootPath, ignorePatterns);
    console.log(`Found ${chunks.length} code chunks\n`);

    // Incremental indexing: only re-embed changed/new files
    const indexedFiles = await getIndexedFiles();

    // Build per-file mtime from scanned chunks
    const scannedMtimes = {};
    for (const chunk of chunks) {
      scannedMtimes[chunk.file_path] = chunk.mtime;
    }

    // Files to re-index: new or mtime changed
    const filesToReindex = new Set();
    for (const [fp, mtime] of Object.entries(scannedMtimes)) {
      if (indexedFiles[fp] === undefined || indexedFiles[fp] !== mtime) {
        filesToReindex.add(fp);
      }
    }

    // Files deleted from disk but still in index
    const scannedSet = new Set(Object.keys(scannedMtimes));
    const deletedFiles = Object.keys(indexedFiles).filter(fp => !scannedSet.has(fp));
    const filesToDelete = [...deletedFiles, ...filesToReindex];

    if (filesToDelete.length > 0) {
      await deleteChunksForFiles(filesToDelete);
    }

    const chunksToIndex = chunks.filter(c => filesToReindex.has(c.file_path));
    console.log(`Files to re-index: ${filesToReindex.size} (${chunksToIndex.length} chunks), deleted: ${deletedFiles.length}\n`);

    let embeddingsAvailable = true;

    if (chunksToIndex.length > 0) {
      console.log('Generating embeddings and indexing...');
      const batchSize = Number(process.env.CODEBASESEARCH_BATCH_SIZE) || 128;

      try {
        let pendingUpsert = Promise.resolve();
        for (let i = 0; i < chunksToIndex.length; i += batchSize) {
          const batchChunks = chunksToIndex.slice(i, i + batchSize);
          const batchTexts = batchChunks.map(c => c.content);
          const batchEmbeddings = await generateEmbeddings(batchTexts);
          const batchWithEmbeddings = batchChunks.map((chunk, idx) => ({
            ...chunk,
            vector: batchEmbeddings[idx]
          }));
          await pendingUpsert;
          pendingUpsert = upsertChunks(batchWithEmbeddings);
        }
        await pendingUpsert;
      } catch (embeddingError) {
        console.warn(`Warning: Embedding generation failed (${embeddingError.message}). Using text-only search.\n`);
        embeddingsAvailable = false;
      }
      console.log('Index updated\n');
    } else {
      console.log('Index up-to-date, skipping embedding\n');
    }

    // Execute search with chunks for hybrid search (text-only if embeddings failed)
    const results = await executeSearch(query, 10, chunks);

    // Format and display results
    const output = formatResults(results);
    console.log(output);

    // Clean shutdown
    await closeStore();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    await closeStore().catch(() => {});
    process.exit(1);
  }
}
