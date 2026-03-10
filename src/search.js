import { generateSingleEmbedding } from './embeddings.js';
import { searchSimilar } from './store.js';
import { searchText } from './text-search.js';

export async function executeSearch(query, limit = 10, allChunks = null) {
  if (!query || query.trim().length === 0) {
    throw new Error('Query cannot be empty');
  }

  console.error(`Searching for: "${query}"`);

  try {
    // Generate embedding for query
    const queryEmbedding = await generateSingleEmbedding(query);

    // Search vector store
    const vectorResults = await searchSimilar(queryEmbedding, limit * 2);

    // If we have chunks for text search, perform hybrid search
    if (allChunks && allChunks.length > 0) {
      const textIndexData = buildTextIndex(allChunks);
      const textResults = searchText(query, allChunks, textIndexData);

      // Merge results: vector + text with boosting
      const merged = mergeSearchResults(vectorResults, textResults.slice(0, limit * 2), limit);
      return merged;
    }

    return vectorResults.slice(0, limit);
  } catch (error) {
    console.error('Search error:', error.message);
    // Fall back to text search if embeddings fail
    if (allChunks && allChunks.length > 0) {
      const textIndexData = buildTextIndex(allChunks);
      const textResults = searchText(query, allChunks, textIndexData);
      return textResults.slice(0, limit);
    }
    throw error;
  }
}

function mergeSearchResults(vectorResults, textResults, limit) {
  const merged = new Map();

  // Add vector results with vector score (80% weight)
  vectorResults.forEach((result, idx) => {
    const key = `${result.file_path}:${result.chunk_index}`;
    merged.set(key, {
      ...result,
      vectorScore: result.score || 0,
      textScore: 0,
      finalScore: (result.score || 0) * 0.8
    });
  });

  // Add/update with text results (20% weight)
  textResults.forEach((result, idx) => {
    const key = `${result.file_path}:${result.chunk_index || 0}`;
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.textScore = result.score || 0;
      existing.finalScore = (existing.vectorScore * 0.8) + (result.score * 0.2);
    } else {
      merged.set(key, {
        ...result,
        vectorScore: 0,
        textScore: result.score || 0,
        finalScore: (result.score || 0) * 0.2
      });
    }
  });

  // Sort by final score and return top results
  return Array.from(merged.values())
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
}

function buildTextIndex(chunks) {
  const index = new Map();
  const chunkMetadata = [];

  chunks.forEach((chunk, idx) => {
    const tokens = tokenize(chunk.content);
    const fileNameTokens = tokenize(chunk.file_path);
    const symbols = extractSymbols(chunk.content);
    const frequency = new Map();

    tokens.forEach(token => {
      frequency.set(token, (frequency.get(token) || 0) + 1);
      if (!index.has(token)) {
        index.set(token, new Set());
      }
      index.get(token).add(idx);
    });

    chunkMetadata[idx] = {
      tokens,
      fileNameTokens,
      symbols,
      frequency,
      isCode: isCodeFile(chunk.file_path),
    };
  });

  return { index, chunkMetadata };
}

function tokenize(text) {
  const tokens = new Set();

  text.split(/\s+/).forEach(word => {
    if (word.length === 0) return;

    // camelCase/PascalCase split
    const camelCaseTokens = word.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)|[0-9]+/g) || [];
    camelCaseTokens.forEach(t => {
      if (t.length > 1) tokens.add(t.toLowerCase());
    });

    // snake_case and kebab-case split
    word.split(/[-_.]/).forEach(t => {
      const cleaned = t.replace(/[^\w]/g, '').toLowerCase();
      if (cleaned.length > 1) tokens.add(cleaned);
    });

    // Full word
    const cleaned = word.replace(/[^\w]/g, '').toLowerCase();
    if (cleaned.length > 1) tokens.add(cleaned);
  });

  return Array.from(tokens).filter(t => t.length > 1);
}

function extractSymbols(text) {
  const symbols = new Set();

  const functionMatches = text.match(/(?:async\s+)?function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(/g) || [];
  functionMatches.forEach(match => {
    const name = match.match(/\w+(?=\s*[=\(])/)?.[0];
    if (name) symbols.add(name.toLowerCase());
  });

  const classMatches = text.match(/class\s+(\w+)/g) || [];
  classMatches.forEach(match => {
    const name = match.match(/\w+$/)?.[0];
    if (name) symbols.add(name.toLowerCase());
  });

  const exportMatches = text.match(/export\s+(?:async\s+)?(?:function|class)\s+(\w+)/g) || [];
  exportMatches.forEach(match => {
    const name = match.match(/\w+$/)?.[0];
    if (name) symbols.add(name.toLowerCase());
  });

  return Array.from(symbols);
}

function isCodeFile(filePath) {
  const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.rb'];
  return codeExtensions.some(ext => filePath.endsWith(ext));
}

export function formatResults(results) {
  if (results.length === 0) {
    return 'No results found.';
  }

  const lines = [];
  lines.push(`\nFound ${results.length} result${results.length !== 1 ? 's' : ''}:\n`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const match = i + 1;

    // Determine which score to display (hybrid or single)
    const scoreValue = result.finalScore !== undefined ? result.finalScore : (result.score || 0);
    const scorePercent = (scoreValue * 100).toFixed(1);

    lines.push(`${match}. ${result.file_path}:${result.line_start}-${result.line_end} (score: ${scorePercent}%)`);

    // Show code snippet (first 3 lines)
    const codeLines = result.content.split('\n').slice(0, 3);
    for (const line of codeLines) {
      const trimmed = line.slice(0, 80); // Limit line length
      lines.push(`   > ${trimmed}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
