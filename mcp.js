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
import { existsSync, readFileSync, appendFileSync, writeFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { supervisor } from './src/supervisor.js';

const WORKSPACE_PATH = join(homedir(), 'workspace');

function getWorkspaceFolders() {
  try {
    return readdirSync(WORKSPACE_PATH, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => join(WORKSPACE_PATH, e.name));
  } catch { return []; }
}

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

function formatResults(result, query, scope) {
  if (result.resultsCount === 0) return `No results found${scope ? ` across ${scope}` : ''} for: "${query}"`;
  const plural = result.resultsCount !== 1 ? 's' : '';
  const header = `Found ${result.resultsCount} result${plural}${scope ? ` across ${scope}` : ''} for: "${query}"\n\n`;
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
    {
      name: 'search_workspace',
      description: 'Search across ALL repositories in ~/workspace simultaneously. Returns ranked results with repo name prefix.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          limit: { type: 'number', description: 'Max results to return (default: 10)' },
        },
        required: ['query'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const query = args?.query;

  if (!['search', 'search_workspace'].includes(name)) return errResponse(`Unknown tool: ${name}`);
  if (!query || typeof query !== 'string') return errResponse('Error: query is required and must be a string');

  try {
    if (name === 'search_workspace') {
      const result = await supervisor.sendRequest({
        type: 'search-all',
        query,
        workspacePaths: getWorkspaceFolders(),
        limit: args?.limit || 10,
      });
      if (result.error) return errResponse(`Error: ${result.error}`);
      return okResponse(formatResults(result, query, 'workspace'));
    }

    const repositoryPath = args?.repository_path || cwd();
    ensureIgnoreEntry(repositoryPath);
    const result = await supervisor.sendRequest({ type: 'search', query, repositoryPath });
    if (result.error) return errResponse(`Error: ${result.error}`);
    return okResponse(formatResults(result, query, null));
  } catch (error) {
    return errResponse(`Error: ${error.message}`);
  }
});

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const workspacePaths = getWorkspaceFolders();
  if (workspacePaths.length > 0) {
    supervisor.sendRequest({ type: 'index-all', workspacePaths })
      .then(r => console.error(`[MCP] Pre-indexed workspace: ${r.message || JSON.stringify(r)}`))
      .catch(e => console.error(`[MCP] Pre-index warning: ${e.message}`));
  }
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
