import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { shouldIgnore } from './ignore-parser.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.pyi',
  '.go',
  '.rs',
  '.java', '.kt', '.scala',
  '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  '.c', '.h',
  '.rb', '.erb',
  '.php',
  '.cs', '.csx',
  '.swift',
  '.m', '.mm',
  '.sh', '.bash', '.zsh',
  '.sql',
  '.r', '.R',
  '.lua',
  '.pl', '.pm',
  '.groovy',
  '.gradle',
  '.xml', '.xsd',
  '.yaml', '.yml',
  '.toml',
  '.html', '.htm',
  '.css', '.scss', '.sass', '.less',
  '.vue', '.svelte',
  '.md', '.markdown'
]);

function getFileExtension(filePath) {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.substring(lastDot).toLowerCase();
}

function isBinaryFile(filePath) {
  const binaryExtensions = new Set([
    '.zip', '.tar', '.gz', '.rar', '.7z', '.iso',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico',
    '.mp3', '.mp4', '.mov', '.avi', '.flv', '.m4a',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.woff', '.woff2', '.ttf', '.otf', '.eot'
  ]);
  const ext = getFileExtension(filePath);
  return binaryExtensions.has(ext);
}

function walkDirectory(dirPath, ignorePatterns, relativePath = '') {
  const files = [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relPath = relativePath ? join(relativePath, entry.name) : entry.name;
      // Normalize to forward slashes for consistent ignore pattern matching
      const normalizedRelPath = relPath.replace(/\\/g, '/');

      // Check if should ignore
      if (shouldIgnore(normalizedRelPath, ignorePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...walkDirectory(fullPath, ignorePatterns, relPath));
      } else if (entry.isFile()) {
        const ext = getFileExtension(entry.name);
        if (SUPPORTED_EXTENSIONS.has(ext) && !isBinaryFile(entry.name)) {
          try {
            const stat = entry.isSymbolicLink ? null : statSync(fullPath);
            const maxSize = 5 * 1024 * 1024;
            if (!stat || stat.size <= maxSize) {
              files.push({
                fullPath,
                relativePath: normalizedRelPath,
                mtime: stat ? stat.mtime.getTime() : Date.now()
              });
            }
          } catch (e) {
          }
        }
      }
    }
  } catch (e) {
    // Ignore read errors for individual directories
  }

  return files;
}

function chunkContent(content, chunkSize = 1000, overlapSize = 100) {
  const lines = content.split('\n');
  const chunks = [];

  for (let i = 0; i < lines.length; i += chunkSize - overlapSize) {
    const endIdx = Math.min(i + chunkSize, lines.length);
    const chunk = lines.slice(i, endIdx).join('\n');

    if (chunk.trim().length > 0) {
      chunks.push({
        content: chunk,
        line_start: i + 1,
        line_end: endIdx
      });
    }

    // Stop if we've reached the end
    if (endIdx === lines.length) {
      break;
    }
  }

  return chunks;
}

export function scanRepository(rootPath, ignorePatterns) {
  const files = walkDirectory(rootPath, ignorePatterns);
  const chunks = [];

  for (const file of files) {
    try {
      const content = readFileSync(file.fullPath, 'utf8');
      const mtime = file.mtime;

      // For small files, treat as single chunk
      if (content.split('\n').length <= 1000) {
        chunks.push({
          file_path: file.relativePath,
          chunk_index: 0,
          content,
          line_start: 1,
          line_end: content.split('\n').length,
          mtime
        });
      } else {
        // For large files, chunk them
        const fileChunks = chunkContent(content);
        fileChunks.forEach((chunk, idx) => {
          chunks.push({
            file_path: file.relativePath,
            chunk_index: idx,
            content: chunk.content,
            line_start: chunk.line_start,
            line_end: chunk.line_end,
            mtime
          });
        });
      }
    } catch (e) {
      // Ignore read errors for individual files
    }
  }

  return chunks;
}

export function getFileStats(chunks) {
  const stats = {};
  for (const chunk of chunks) {
    if (!stats[chunk.file_path]) {
      stats[chunk.file_path] = chunk.mtime;
    }
  }
  return stats;
}
