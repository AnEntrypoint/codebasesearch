#!/usr/bin/env node

// MUST patch sharp before any other imports
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');

if (fs.existsSync(distPath)) {
  let content = fs.readFileSync(distPath, 'utf-8');
  if (!content.includes('SHARP_REMOVED_FOR_WINDOWS_COMPATIBILITY')) {
    content = content.replace(/import \* as __WEBPACK_EXTERNAL_MODULE_sharp__ from "sharp";\n/, '// SHARP_REMOVED_FOR_WINDOWS_COMPATIBILITY\n');
    content = content.replace(/module\.exports = __WEBPACK_EXTERNAL_MODULE_sharp__;/g, 'module.exports = {};');
    content = content.replace(/} else \{\s*throw new Error\('Unable to load image processing library\.'\);\s*\}/, '} else {\n    loadImageFunction = async () => { throw new Error(\'Image processing unavailable\'); };\n}');
    try { fs.writeFileSync(distPath, content); } catch (e) {}
  }
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { cwd } from 'process';
import { join, existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { supervisor } from './src/supervisor.js';

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
    // Ignore write errors
  }
}

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
    await ensureIgnoreEntry(repositoryPath);
    const result = await supervisor.sendRequest({
      type: 'search',
      query,
      repositoryPath,
    });

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

const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) || 
  process.argv[1].endsWith('mcp.js') || 
  process.argv[1].endsWith('code-search-mcp')
);

if (isMain) {
  main().catch((error) => {
    console.error('Server error:', error);
  });
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

async function main() {
  await startMcpServer();
}
