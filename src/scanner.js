import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { shouldIgnore } from './ignore-parser.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx',
  '.py', '.pyw',
  '.go',
  '.rs',
  '.java', '.kt', '.scala',
  '.cpp', '.cc', '.cxx', '.h', '.hpp',
  '.c', '.h',
  '.rb',
  '.php',
  '.cs',
  '.swift',
  '.m', '.mm',
  '.sh', '.bash',
  '.sql',
  '.r', '.R',
  '.lua',
  '.pl',
  '.groovy',
  '.gradle',
  '.xml',
  '.json',
  '.yaml', '.yml',
  '.toml',
  '.html', '.htm',
  '.css', '.scss', '.sass',
  '.vue'
]);

function getFileExtension(filePath) {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.substring(lastDot).toLowerCase();
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
        // Recursively walk subdirectories
        files.push(...walkDirectory(fullPath, ignorePatterns, relPath));
      } else if (entry.isFile()) {
        const ext = getFileExtension(entry.name);
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          files.push({
            fullPath,
            relativePath: normalizedRelPath
          });
        }
      }
    }
  } catch (e) {
    // Ignore read errors for individual directories
  }

  return files;
}

function chunkContent(content, chunkSize = 1000, overlapSize = 200) {
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
      const mtime = statSync(file.fullPath).mtime.getTime();

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
