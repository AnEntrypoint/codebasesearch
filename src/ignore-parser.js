import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Unified whitelist of code file extensions to include (102 supported)
const CODE_EXTENSIONS = new Set([
  // JavaScript/TypeScript
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
  // Python
  '.py', '.pyw', '.pyi',
  // Java
  '.java',
  // C/C++
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx',
  // C#
  '.cs', '.csx',
  // Go
  '.go',
  // Rust
  '.rs',
  // Ruby
  '.rb', '.erb',
  // PHP
  '.php', '.phtml',
  // Swift
  '.swift',
  // Kotlin
  '.kt', '.kts',
  // Scala
  '.scala', '.sc',
  // Perl
  '.pl', '.pm',
  // Shell/Bash
  '.sh', '.bash', '.zsh', '.fish',
  // PowerShell
  '.ps1', '.psm1', '.psd1',
  // Lua
  '.lua',
  // R
  '.r', '.R',
  // MATLAB/Octave
  '.m', '.mat',
  // Julia
  '.jl',
  // Dart
  '.dart',
  // Elixir
  '.ex', '.exs',
  // Erlang
  '.erl', '.hrl',
  // Haskell
  '.hs', '.lhs',
  // Clojure
  '.clj', '.cljs', '.cljc',
  // Lisp/Scheme
  '.lisp', '.lsp', '.scm', '.ss', '.rkt',
  // Fortran
  '.f', '.for', '.f90', '.f95', '.f03',
  // Assembly
  '.asm', '.s', '.S',
  // Groovy
  '.groovy', '.gvy',
  // Visual Basic
  '.vb', '.vbs',
  // F#
  '.fs', '.fsx',
  // OCaml
  '.ml', '.mli',
  // Objective-C
  '.m', '.mm',
  // Arduino
  '.ino',
  // Vue SFC
  '.vue',
  // Svelte
  '.svelte',
  // CoffeeScript
  '.coffee',
  // Reason
  '.re', '.rei',
  // Markup/Data
  '.xml', '.xsd', '.html', '.htm', '.yml', '.yaml', '.toml',
  // Styling
  '.css', '.scss', '.sass', '.less',
  // SQL
  '.sql',
  // Markdown/Text
  '.md', '.markdown', '.txt'
]);

function loadDefaultIgnores() {
  const ignorePath = join(__dirname, '..', '.thornsignore');
  if (!existsSync(ignorePath)) {
    return getHardcodedIgnores();
  }

  try {
    const content = readFileSync(ignorePath, 'utf8');
    return parseIgnoreFile(content);
  } catch (e) {
    return getHardcodedIgnores();
  }
}

function getHardcodedIgnores() {
  return new Set([
    // Lock files / package manager artifacts
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'Cargo.lock',
    'composer.lock', 'go.sum',
    // OS files
    '.DS_Store', 'Thumbs.db', 'desktop.ini',
    // Editor swap files
    '.tern-port',
    // Compiled binary artifacts (files, not dirs)
    '*.min.js', '*.min.css', '*.bundle.js', '*.chunk.js', '*.map',
    '*.tsbuildinfo',
  ]);
}

function parseIgnoreFile(content) {
  const patterns = new Set();
  const lines = content.split('\n');

  for (let line of lines) {
    line = line.trim();

    // Skip comments and empty lines
    if (!line || line.startsWith('#')) continue;

    // Remove trailing slash for directory patterns
    if (line.endsWith('/')) {
      line = line.slice(0, -1);
    }

    // Skip negation patterns (!) for now
    if (line.startsWith('!')) continue;

    // Handle wildcards
    if (line.includes('*')) {
      // Remove trailing wildcards
      line = line.replace(/\/\*+$/, '');
    }

    if (line) {
      patterns.add(line);
    }
  }

  return patterns;
}

function loadProjectIgnores(rootPath) {
  const patterns = new Set();
  const ignoreFiles = [
    '.gitignore',
    '.dockerignore',
    '.npmignore',
    '.eslintignore',
    '.prettierignore',
    '.thornsignore',
    '.codesearchignore'
  ];

  for (const file of ignoreFiles) {
    const path = join(rootPath, file);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf8');
        const filePatterns = parseIgnoreFile(content);
        for (const pattern of filePatterns) {
          patterns.add(pattern);
        }
      } catch (e) {
        // Ignore read errors
      }
    }
  }

  return patterns;
}

export function loadIgnorePatterns(rootPath) {
  const defaultPatterns = loadDefaultIgnores();
  const projectPatterns = loadProjectIgnores(rootPath);

  // Merge both sets
  const merged = new Set([...defaultPatterns, ...projectPatterns]);
  return merged;
}

// Directories to always ignore - only clear non-source directories
const IGNORED_DIRECTORIES = new Set([
  // Dependencies
  'node_modules', 'bower_components', 'jspm_packages', 'web_modules',
  // Version control
  '.git', '.svn', '.hg', '.bzr',
  // Tool config (AI assistants, editors)
  '.claude', '.cursor', '.aider',
  // IDE
  '.vscode', '.idea', '.vs', '.atom',
  // Build outputs (unambiguous names only)
  'dist', 'dist-server', 'dist-ssr', 'dist-client',
  'build', 'built',
  'out', 'out-tsc',
  'target',
  'storybook-static', '.docusaurus', '.gatsby', '.vuepress',
  '.nuxt', '.next',
  '.tsc',
  // Cache directories
  '.cache', '.parcel-cache', '.vite', '.turbo',
  '.npm', '.yarn', '.pnp', '.pnpm-store', '.rush', '.lerna', '.nx',
  // Testing
  'coverage', '.nyc_output', '.coverage', 'htmlcov', 'test-results',
  '__tests__', '__mocks__', '__snapshots__', '__fixtures__',
  'cypress', 'playwright',
  '.tox', '.eggs', '.hypothesis', '.pyre', '.pytype',
  // Python
  '__pycache__', '.pytest_cache', '.mypy_cache', '.venv', 'venv',
  // Java/Gradle/Maven
  '.gradle', '.mvn',
  // iOS/Android
  'Pods', 'DerivedData', '.bundle', 'xcuserdata',
  // Ruby
  '.bundle', 'pkg',
  // Infrastructure
  '.terraform', '.terragrunt-cache', '.pulumi', '.serverless', '.firebase',
  '.aws', '.azure', '.gcloud', '.vercel', '.netlify',
  // Temp files
  'temp', 'tmp', '.tmp', '.temp',
  // LLM/AI artifacts
  '.llamaindex', '.chroma', '.vectorstore', '.embeddings',
  '.langchain', '.autogen', '.semantic-kernel', '.openai-cache',
  '.anthropic-cache', 'embeddings', 'vector-db', 'faiss-index',
  'chromadb', 'pinecone-cache', 'weaviate-data',
  // Package manager caches
  '.pnpm', '.bun',
  // Static/built asset directories
  'assets', 'static', 'public', 'wwwroot', 'www',
  // Misc generated
  'cmake_build_debug', 'cmake_build_release', 'CMakeFiles',
]);

export function isCodeFile(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');
  const fileName = pathParts[pathParts.length - 1];
  
  // Get file extension
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return false; // No extension or hidden file without extension
  }
  
  const ext = fileName.slice(lastDotIndex).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

export function shouldIgnoreDirectory(dirPath) {
  const normalizedPath = dirPath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');
  for (const part of pathParts) {
    if (IGNORED_DIRECTORIES.has(part)) {
      return true;
    }
  }
  return false;
}

export function shouldIgnore(filePath, ignorePatterns, isDirectory = false) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');
  const fileName = pathParts[pathParts.length - 1];

  if (isDirectory) {
    if (IGNORED_DIRECTORIES.has(fileName)) return true;
    for (const pattern of ignorePatterns) {
      if (!pattern.includes('/') && fileName === pattern) return true;
    }
    return false;
  }

  // For files: check all ancestor directories
  for (const part of pathParts.slice(0, -1)) {
    if (IGNORED_DIRECTORIES.has(part)) {
      return true;
    }
  }

  // Check if it's a code file using whitelist
  if (!isCodeFile(filePath)) {
    return true;
  }

  // Check against additional ignore patterns
  for (const pattern of ignorePatterns) {
    if (pattern.includes('/')) {
      if (normalizedPath.includes(pattern)) return true;
    } else if (fileName === pattern) {
      return true;
    } else {
      for (const part of pathParts) {
        if (part === pattern) return true;
      }
    }
  }

  return false;
}
