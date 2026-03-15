#!/usr/bin/env node

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
import { join } from 'path';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { supervisor } from './src/supervisor.js';

function ensureIgnoreEntry(rootPath) {
  const gitignorePath = join(rootPath, '.gitignore');
  const entry = '.code-search/';
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf8');
      if (!content.includes(entry)) appendFileSync(gitignorePath, `\n${entry}`);
    } else {
      writeFileSync(gitignorePath, `${entry}\n`);
    }
  } catch (e) {}
}

function formatResults(result, query) {
  if (result.resultsCount === 0) return `No results found for: "${query}"`;
  const plural = result.resultsCount !== 1 ? 's' : '';
  const header = `Found ${result.resultsCount} result${plural} for: "${query}"\n\n`;
  const body = result.results.map((r) => {
    const pathPart = r.relativePath || r.absolutePath;
    const lineCount = r.totalLines ? ` [${r.totalLines}L]` : '';
    const ctx = r.enclosingContext ? ` (in: ${r.enclosingContext})` : '';
    const rHeader = `${r.rank}. ${pathPart}${lineCount}:${r.lines}${ctx} (score: ${r.score}%)`;
    const rBody = r.snippet.split('\n').map((line) => `   ${line}`).join('\n');
    return `${rHeader}\n${rBody}`;
  }).join('\n\n');
  return header + body;
}

function errResponse(msg) {
  return { content: [{ type: 'text', text: msg }], isError: true };
}

function okResponse(text) {
  return { content: [{ type: 'text', text }] };
}

const server = new Server({ name: 'code-search-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search',
      description: 'Search through a code repository. Automatically indexes before searching.',
      inputSchema: {
        type: 'object',
        properties: {
          repository_path: { type: 'string', description: 'Path to repository (defaults to current directory)' },
          query: { type: 'string', description: 'Natural language search query' },
        },
        required: ['query'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const query = args?.query;

  if (name !== 'search') return errResponse(`Unknown tool: ${name}`);
  if (!query || typeof query !== 'string') return errResponse('Error: query is required and must be a string');

  try {
    const repositoryPath = args?.repository_path || cwd();
    ensureIgnoreEntry(repositoryPath);
    const result = await supervisor.sendRequest({ type: 'search', query, repositoryPath });
    if (result.error) return errResponse(`Error: ${result.error}`);
    return okResponse(formatResults(result, query));
  } catch (error) {
    return errResponse(`Error: ${error.message}`);
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

process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

async function main() { await startMcpServer(); }
if (isMain) main().catch((error) => console.error('Server error:', error));
