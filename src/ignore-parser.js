import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    '.gradle', '.mvn', 'Pods', 'DerivedData', '.bundle'
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

export function shouldIgnore(filePath, ignorePatterns) {
  // Normalize path to forward slashes for consistent matching across platforms
  const normalizedPath = filePath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');

  for (const pattern of ignorePatterns) {
    // Check if any part of the path matches the pattern
    for (const part of pathParts) {
      if (part === pattern) {
        return true;
      }
    }

    // Check if pattern matches the full path or a component
    if (normalizedPath.includes(pattern)) {
      // More specific matching for paths like "node_modules/something"
      const regex = new RegExp(`(^|/)${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')}(/|$)`);
      if (regex.test(normalizedPath)) {
        return true;
      }
    }
  }

  return false;
}
