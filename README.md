# code-search

Ultra-simple semantic code search with Jina embeddings and LanceDB. Supports both CLI and MCP protocol interfaces.

## Quick Start

### CLI
```bash
npx -y gxe@latest AnEntrypoint/code-search "your search query"
```

### MCP (for Claude Code & IDE plugins)
```bash
npx -y gxe@latest AnEntrypoint/code-search --mcp
e.g.:
claude mcp add -s user code-search -- npx -y gxe@latest AnEntrypoint/code-search
```

## Features

- **Semantic search** across entire repositories using Jina embeddings (512-dim vectors)
- **Embedded vector database** (LanceDB) - no external servers or setup required
- **Auto-indexing** - automatically scans and indexes repository before each search
- **Comprehensive ignore patterns** - respects .gitignore and ignores build artifacts, node_modules, etc. across all languages
- **Single-shot execution** - no persistent processes, no background daemons
- **MCP protocol support** - integrates with Claude Code and other MCP-compatible tools
- **Auto-gitignore** - automatically adds `.code-search/` to .gitignore on first run
- **Auto-recover from corruption** - automatically detects and clears corrupted model cache on Protobuf errors
- **Performance optimized** - 5MB file size limits, smart chunking, batch embedding generation

## Usage

### Search from CLI

```bash
npx -y gxe@latest AnEntrypoint/code-search "authentication middleware"
npx -y gxe@latest AnEntrypoint/code-search "database connection pool"
npx -y gxe@latest AnEntrypoint/code-search "error handling"
```

### Search from custom repository

```bash
npx -y gxe@latest AnEntrypoint/code-search --repo /path/to/repo "query"
```

**Default Search Directory**: When no path is specified, searches the **current working directory** (project root), not the Claude Code plugins directory. In Claude Code, this defaults to your project context.

### MCP Tool (in Claude Code)

The `search` tool accepts:
- `query` (required): Natural language search string
- `repository_path` (optional): Path to repository (defaults to current directory)

Example:
```
search query="middleware validation" repository_path="/path/to/repo"
```

## How It Works

1. **Scans** the repository for code files (25+ language types supported)
2. **Respects** .gitignore and comprehensive ignore patterns
3. **Chunks** large files into manageable segments
4. **Generates embeddings** using Jina embeddings v2 small (512 dimensions)
5. **Stores** vectors in embedded LanceDB database
6. **Searches** using semantic similarity
7. **Returns** ranked results with line numbers and code snippets
8. **Auto-adds** `.code-search/` to .gitignore

## Supported Languages

JavaScript, TypeScript, Python, Go, Rust, Java, C/C++, C#, Ruby, PHP, Scala, Swift, Shell, SQL, R, Lua, Perl, Groovy, XML, JSON, YAML, TOML, HTML, CSS, SCSS, Vue, and more.

## Storage

Search index is stored in `.code-search/lancedb/` (automatically added to .gitignore).

First run downloads the Jina model (~120MB) to `~/.cache/huggingface`.

## Performance

- **First run**: ~30-60s (downloads model + indexes repository)
- **Subsequent runs**: Sub-second search queries (index already exists)
- **Large repos** (10k+ files): May take 1-2 minutes for full indexing

### Technical Optimizations

- **5MB file size limit**: Files larger than 5MB are skipped to prevent memory issues
- **Smart chunking**: Files >1000 lines auto-split into overlapping chunks (200-line overlap) for better semantic context
- **Batch embedding**: Chunks processed in batches of 32 for efficient API usage
- **Binary detection**: 47 binary file extensions ignored (.zip, .exe, .jpg, .mp4, etc.)
- **Auto-recovery**: Detects Protobuf parsing errors in cached models and auto-clears corrupted cache
- **5-minute timeout**: Model loading has timeout to prevent indefinite hangs

## Installation Details

The package includes:

- **bin/code-search.js** - CLI entry point for direct use
- **mcp.js** - MCP server for integration with Claude Code
- **src/** - Core modules (embeddings, scanning, vector store, search)
- **.thornsignore** - Comprehensive ignore patterns (all languages/frameworks)

## Ignored Files & Directories

By default, the tool ignores:
- All build artifacts (dist/, build/, target/, node_modules/, etc.)
- Version control (.git/, .svn/, .hg/, etc.)
- IDE files (.vscode/, .idea/, etc.)
- Lock files (package-lock.json, yarn.lock, etc.)
- Dependencies and caches
- Test files and coverage reports
- Secrets and credentials

Configure custom ignores via `.codesearchignore` file.

## Privacy

All processing happens locally. No data is sent to external servers. The Jina model is downloaded once and cached locally.

## License

MIT
