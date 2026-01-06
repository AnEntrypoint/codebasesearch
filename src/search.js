import { generateSingleEmbedding } from './embeddings.js';
import { searchSimilar } from './store.js';

export async function executeSearch(query, limit = 10) {
  if (!query || query.trim().length === 0) {
    throw new Error('Query cannot be empty');
  }

  console.error(`Searching for: "${query}"`);

  // Generate embedding for query
  const queryEmbedding = await generateSingleEmbedding(query);

  // Search vector store
  const results = await searchSimilar(queryEmbedding, limit);

  return results;
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

    lines.push(`${match}. ${result.file_path}:${result.line_start}-${result.line_end} (score: ${(result.score * 100).toFixed(1)}%)`);

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
