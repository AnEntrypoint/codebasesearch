// Windows compatibility initialization - must be first
import './init-windows.js';

import { cwd } from 'process';
import { join } from 'path';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { loadIgnorePatterns } from './ignore-parser.js';
import { scanRepository } from './scanner.js';
import { generateEmbeddings } from './embeddings.js';
import { initStore, upsertChunks, closeStore } from './store.js';
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

    // Scan repository
    console.log('Scanning repository...');
    const chunks = scanRepository(rootPath, ignorePatterns);
    console.log(`Found ${chunks.length} code chunks\n`);

    // Always reindex to ensure freshness
    console.log('Generating embeddings and indexing...');

    // Generate embeddings in batches
    const batchSize = 32;
    const chunkTexts = chunks.map(c => c.content);
    const allEmbeddings = [];

    for (let i = 0; i < chunkTexts.length; i += batchSize) {
      const batchTexts = chunkTexts.slice(i, i + batchSize);
      const batchEmbeddings = await generateEmbeddings(batchTexts);
      allEmbeddings.push(...batchEmbeddings);
    }

    // Create chunks with embeddings
    const chunksWithEmbeddings = chunks.map((chunk, idx) => ({
      ...chunk,
      vector: allEmbeddings[idx]
    }));

    // Upsert to store
    await upsertChunks(chunksWithEmbeddings);
    console.log('Index created\n');

    // Execute search
    const results = await executeSearch(query);

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
