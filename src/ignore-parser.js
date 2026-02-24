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
    'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
    'target', 'vendor', '__pycache__', '.pytest_cache', '.mypy_cache',
    '.next', '.nuxt', '.cache', '.parcel-cache', '.vite', '.turbo',
    'coverage', '.nyc_output', '.firebase', '.terraform', '.aws',
    '.azure', '.gcloud', '.vscode', '.idea', '.vs', 'bin', 'obj',
    '.gradle', '.mvn', 'Pods', 'DerivedData', '.bundle',
    '.yarn', '.pnp', 'pnpm-lock.yaml', '.pnpm-store',
    '.tox', '.eggs', '*.egg-info', '.venv', 'venv', 'env',
    '.tsc', '.eslintcache', '.stylelintcache', '.parcel-cache',
    'temp', 'tmp', '.tmp', '.DS_Store', 'Thumbs.db',
    '.swp', '.swo', '*.swp', '*.swo', '.tern-port',
    'dist-server', 'out-tsc', '.cache', '.parcel-cache',
    'typings', '.env', '.env.local', '.env.*.local',
    // JSON files - PRIMARY PRIORITY for memory reduction
    '*.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'Gemfile.lock', 'poetry.lock', 'Pipfile.lock',
    // Lock files
    '*.lock',
    // Build outputs
    'public', 'static', 'site', '_site', '.docusaurus', '.gatsby',
    // Cache/dependency directories
    '.rush', '.lerna', '.nx',
    // IDE/editor configs
    '.cursor', '.replit', '.sublime-project', '.sublime-workspace',
    '*.iml', '.project', '.classpath', '.settings', '*.sublime-*',
    // OS files
    '.Spotlight-V100', '.Trashes', 'ehthumbs.db', '.fseventsd',
    '.TemporaryItems', '.AppleDouble', '.LSOverride', 'desktop.ini',
    // Large data files
    '*.db', '*.sqlite', '*.sqlite3', '*.bak', '*.dump',
    '*.backup', '*.data', '*.orig',
    // Logs and temp
    '*.log', 'logs', 'npm-debug.log', 'yarn-error.log',
    // Test coverage and reports
    'lcov.info', '.coverage', 'test-results',
    // Database related
    'storage', 'fixtures',
    // LLM/Vector related
    '.llamaindex', '.chroma', '.vectorstore', '.embeddings',
    '.langchain', '.autogen', '.semantic-kernel', '.openai-cache',
    '.anthropic-cache', 'embeddings', 'vector-db', 'faiss-index',
    'chromadb', 'pinecone-cache', 'weaviate-data',
    // Compiled output
    '*.min.js', '*.min.css', '*.bundle.js', '*.chunk.js', '*.map',
    // Generated/build artifacts
    '.assets', 'out-tsc', 'cmake_build_debug', 'cmake_build_release',
    // Version managers
    '.rbenv', '.nvm', '.nvmrc',
    // Ruby specific
    '*.gem', '*.rbc', '/pkg', '/spec/reports', '/spec/examples.txt',
    '/test/tmp', '/test/version_tmp', 'lib/bundler/man', '.ruby-version',
    // Go specific
    'go.work',
    // Rust specific
    'Cargo.lock', '**/*.rs.bk', '*.pdb',
    // Java specific
    '*.class', '*.jar', '*.war', '*.ear', '*.nar', '*.nupkg', '*.snupkg',
    // C# specific
    '*.suo', '*.user', '*.userosscache', '*.sln.docstates',
    'project.lock.json', 'project.fragment.lock.json', 'artifacts',
    // C/C++ specific
    '*.o', '*.a', '*.so', '*.exe', '*.obj', '*.dll', '*.dylib',
    'CMakeFiles', 'CMakeCache.txt', '*.cmake',
    // Swift/Xcode specific
    '*.xcodeproj', '*.xcworkspace', '*.moved-aside', '*.pbxuser',
    '*.mode1v3', '*.mode2v3', '*.perspectivev3',
    // Scala/SBT specific
    'lib_managed', 'src_managed', 'project/boot', 'project/plugins/project',
    '.history', '.lib',
    // PHP specific
    'composer.lock', '*.phar',
    // Docker
    '.dockerignore', 'docker-compose.override.yml', '.docker',
    // Documentation build
    'docs/_build', '.vuepress',
    // Testing frameworks
    'jest.config', 'vitest.config', 'pytest.ini', 'tox.ini',
    '__tests__', '__mocks__', 'spec', 'cypress', 'playwright',
    // Monorepo workspace patterns (implicit through directory coverage)
    '.turbo', '.nx',
    // Python package patterns
    '*.py[cod]', '*$py.class', '.Python', 'pip-log.txt',
    'pip-delete-this-directory.txt', '.hypothesis', '.pyre', '.pytype',
    '*.whl',
    // Config/metadata that are typically low-value
    '*.config.js', '*.config.ts', 'webpack.config.js', 'rollup.config.js',
    'vite.config.js', 'tsconfig.json', 'jsconfig.json', 'babel.config',
    '.babelrc', '.eslintrc', '.prettierrc', '.stylelintrc', '.editorconfig',
    '*.local', '*.development', '*.production',
    // Node specific
    '.npm', '.node_repl_history', '*.tsbuildinfo', 'yarn-error.log',
    // Documentation/reference files that don't help with search
    '*.md', '*.txt', '*.rst', '*.adoc', 'docs', 'documentation', 'wiki',
    'CHANGELOG', 'HISTORY', 'NEWS', 'UPGRADING', 'FAQ', 'CONTRIBUTING',
    'SECURITY', 'LICENSE', 'LICENCE', 'COPYRIGHT', 'NOTICE', 'AUTHORS',
    'THIRDPARTY',
    // Test and coverage files
    '*.test', '*.spec', 'test', 'tests', 'htmlcov',
    // Profiling
    '*.prof', '*.cpuprofile', '*.heapprofile',
    // Misc
    '.tern-port', 'firebase-debug.log', 'firestore-debug.log',
    'ui-debug.log', '.firebaserc', '.stackdump'
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

// Directories to always ignore
const IGNORED_DIRECTORIES = new Set([
  // Dependencies - NEVER include
  'node_modules', 'bower_components', 'jspm_packages', 'web_modules',
  // Version control
  '.git', '.svn', '.hg', '.bzr', '.vscode', '.idea', '.vs', '.atom', '.sublime-project',
  // Build outputs - comprehensive list
  'dist', 'dist-server', 'dist-ssr', 'dist-client', 'dist-server',
  'build', 'built', 'Build', 'BUILD',
  'out', 'output', 'Output', 'OUT', 'release', 'Release', 'RELEASE',
  'target', 'Target', 'TARGET',
  'bin', 'Bin', 'BIN', 'obj', 'Obj', 'OBJ',
  'public', 'static', 'assets', 'www', 'wwwroot',
  'site', '_site', '.site', '.docusaurus', '.gatsby', '.vuepress',
  'storybook-static', '.nuxt', 'nuxt', '.next', 'next',
  'out-tsc', 'tsc', '.tsc',
  // Cache directories
  '.cache', 'cache', '.parcel-cache', '.vite', 'vite', '.turbo', 'turbo',
  '.npm', '.yarn', '.pnp', '.pnpm-store', '.rush', '.lerna', '.nx',
  // Testing
  'coverage', '.nyc_output', '.coverage', 'htmlcov', 'test-results',
  'test', 'tests', 'Test', 'Tests', 'TEST', 'TESTS',
  '__tests__', '__mocks__', '__snapshots__', '__fixtures__',
  'cypress', 'playwright', 'e2e', 'integration', 'spec', 'specs',
  '.tox', '.eggs', '.hypothesis', '.pyre', '.pytype',
  // Python
  '__pycache__', '.pytest_cache', '.mypy_cache', '.venv', 'venv', 'env',
  'env.bak', 'venv.bak', '.Python', 'pip-wheel-metadata', '*.egg-info',
  // Java/Gradle/Maven
  '.gradle', '.mvn', 'gradle', 'mvn', '.settings', '.project', '.classpath',
  // iOS/Android
  'Pods', 'DerivedData', 'build', '.bundle', 'xcuserdata', '.xcodeproj', '.xcworkspace',
  // Ruby
  'vendor', '.bundle', '.ruby-version', 'pkg',
  // Rust
  'target', 'Cargo.lock',
  // Go
  'vendor', 'Godeps',
  // PHP
  'vendor', 'composer',
  // Infrastructure
  '.terraform', '.terragrunt-cache', '.pulumi', '.serverless', '.firebase',
  '.aws', '.azure', '.gcloud', '.vercel', '.netlify', '.now',
  // Docker
  '.docker', 'docker', '.dockerignore',
  // Temp files
  'temp', 'tmp', '.tmp', '.temp', 'tmpfs', 'scratch', '.scratch',
  // Documentation
  'docs', 'doc', 'documentation', 'wiki', 'guides', 'examples', 'demo', 'demos',
  'CHANGELOG', 'HISTORY', 'NEWS', 'LICENSE', 'LICENCE', 'COPYING', 'AUTHORS',
  // IDE/Editor
  '.vs', '.vscode', '.idea', '.eclipse', '.settings', '.classpath', '.project',
  // Logs
  'logs', 'log', '*.log',
  // Data/Storage
  'storage', 'data', 'database', 'db', 'fixtures', 'seeds',
  'uploads', 'files', 'media', 'resources', 'assets', 'images', 'img',
  // LLM/AI
  '.llamaindex', '.chroma', '.vectorstore', '.embeddings',
  '.langchain', '.autogen', '.semantic-kernel', '.openai-cache',
  '.anthropic-cache', 'embeddings', 'vector-db', 'faiss-index',
  'chromadb', 'pinecone-cache', 'weaviate-data',
  // Package managers
  '.yarn', '.pnpm', '.npm', '.bun',
  // Compiled outputs
  'typings', 'types', '@types', 'type-definitions',
  // Misc
  'public', 'static', 'site', '_site',
  'cmake_build_debug', 'cmake_build_release', 'CMakeFiles', 'CMakeCache.txt',
  'out-tsc', 'dist-server', 'server', 'client', 'browser', 'esm', 'cjs', 'umd', 'lib', 'es'
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

export function shouldIgnore(filePath, ignorePatterns) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');
  const fileName = pathParts[pathParts.length - 1];
  
  // Check if any directory in path should be ignored
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
    // Handle path patterns (contain /)
    if (pattern.includes('/')) {
      if (normalizedPath.includes(pattern)) {
        return true;
      }
    }
    // Handle exact file name patterns
    else if (fileName === pattern) {
      return true;
    }
    // Handle directory name patterns (match any path part)
    else {
      for (const part of pathParts) {
        if (part === pattern || part.startsWith(pattern + '/')) {
          return true;
        }
      }
    }
  }

  return false;
}
