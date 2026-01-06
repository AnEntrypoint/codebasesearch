#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { cwd } from 'process';
import { join, resolve } from 'path';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { loadIgnorePatterns } from './src/ignore-parser.js';
import { scanRepository } from './src/scanner.js';
import { generateEmbeddings } from './src/embeddings.js';
import { initStore, upsertChunks, closeStore } from './src/store.js';
import { executeSearch } from './src/search.js';

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

class CodeSearchManager {
  async search(repositoryPath, query) {
    const absolutePath = resolve(repositoryPath);

    if (!existsSync(absolutePath)) {
      return {
        error: `Repository path not found: ${absolutePath}`,
        results: [],
      };
    }

    try {
      // Ensure .code-search/ is in .gitignore
      await ensureIgnoreEntry(absolutePath);

      // Load ignore patterns
      const ignorePatterns = loadIgnorePatterns(absolutePath);
      const dbPath = join(absolutePath, '.code-search');

      // Initialize store
      await initStore(dbPath);

      // Scan repository
      const chunks = scanRepository(absolutePath, ignorePatterns);

      if (chunks.length === 0) {
        await closeStore();
        return {
          query,
          results: [],
          message: 'No code chunks found in repository',
        };
      }

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
        vector: allEmbeddings[idx],
      }));

      // Upsert to store
      await upsertChunks(chunksWithEmbeddings);

      // Execute search
      const results = await executeSearch(query);

      // Format results
      const formattedResults = results.map((result, idx) => ({
        rank: idx + 1,
        file: result.file_path,
        lines: `${result.line_start}-${result.line_end}`,
        score: (result.score * 100).toFixed(1),
        snippet: result.content.split('\n').slice(0, 3).join('\n'),
      }));

      await closeStore();

      return {
        query,
        repository: absolutePath,
        resultsCount: formattedResults.length,
        results: formattedResults,
      };
    } catch (error) {
      await closeStore().catch(() => {});
      return {
        error: error.message,
        results: [],
      };
    }
  }
}

const manager = new CodeSearchManager();

const server = new Server(
  {
    name: 'code-search-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search',
        description:
          'Search through a code repository using semantic search with Jina embeddings. Automatically indexes the repository before searching.',
        inputSchema: {
          type: 'object',
          properties: {
            repository_path: {
              type: 'string',
              description:
                'Absolute or relative path to the repository to search in (defaults to current directory)',
            },
            query: {
              type: 'string',
              description:
                'Natural language search query (e.g., "authentication middleware", "database connection")',
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== 'search') {
    return {
      content: [
        {
          type: 'text',
          text: `Unknown tool: ${name}`,
        },
      ],
      isError: true,
    };
  }

  const query = args?.query;
  const repositoryPath = args?.repository_path || cwd();

  if (!query || typeof query !== 'string') {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: query is required and must be a string',
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await manager.search(repositoryPath, query);

    if (result.error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${result.error}`,
          },
        ],
        isError: true,
      };
    }

    const text =
      result.resultsCount === 0
        ? `No results found for query: "${query}"\nRepository: ${result.repository}`
        : `Found ${result.resultsCount} result${result.resultsCount !== 1 ? 's' : ''} for query: "${query}"\nRepository: ${result.repository}\n\n${result.results
            .map(
              (r) =>
                `${r.rank}. ${r.file}:${r.lines} (score: ${r.score}%)\n${r.snippet
                  .split('\n')
                  .map((line) => `   ${line}`)
                  .join('\n')}`
            )
            .join('\n\n')}`;

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main() {
  await startMcpServer();
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
