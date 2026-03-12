import { generateSingleEmbedding } from './embeddings.js';
import { searchSimilar } from './store.js';
import { buildTextIndex, searchText } from './text-search.js';

export async function executeSearch(query, limit = 10, allChunks = null, skipVector = false) {
  if (!query || query.trim().length === 0) {
    throw new Error('Query cannot be empty');
  }

  console.error(`Searching for: "${query}"`);

  try {
    let vectorResults = [];
    let textResults = [];

    if (allChunks && allChunks.length > 0) {
      const textIndexData = buildTextIndex(allChunks);
      textResults = searchText(query, allChunks, textIndexData);
    }

    const hasGoodTextResults = textResults.length > 0 && textResults[0].score > 0.3;
    if (!skipVector && !hasGoodTextResults) {
      try {
        const queryEmbedding = await generateSingleEmbedding(query);
        vectorResults = await searchSimilar(queryEmbedding, limit * 2);
      } catch (e) {
        console.warn(`Vector search unavailable: ${e.message}`);
      }
    }

    if (vectorResults.length > 0 && textResults.length > 0) {
      return mergeSearchResults(vectorResults, textResults.slice(0, limit * 2), limit);
    }

    const allResults = vectorResults.length > 0 ? vectorResults : textResults;
    return allResults.slice(0, limit);
  } catch (error) {
    console.error('Search error:', error.message);
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

  vectorResults.forEach((result) => {
    const key = `${result.file_path}:${result.chunk_index}`;
    merged.set(key, {
      ...result,
      vectorScore: result.score || 0,
      textScore: 0,
      finalScore: (result.score || 0) * 0.8
    });
  });

  textResults.forEach((result) => {
    const key = `${result.file_path}:${result.chunk_index || 0}`;
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.textScore = result.score || 0;
      existing.finalScore = (existing.vectorScore * 0.8) + (result.score * 0.2);
    } else {
      const textScore = result.score || 0;
      const finalScore = Math.max(textScore * 0.2, textScore > 0.7 ? 0.4 : 0);
      merged.set(key, {
        ...result,
        vectorScore: 0,
        textScore,
        finalScore
      });
    }
  });

  return Array.from(merged.values())
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
}

export function formatResults(results) {
  if (results.length === 0) {
    return 'No results found.';
  }

  const lines = [];
  lines.push(`\nFound ${results.length} result${results.length !== 1 ? 's' : ''}:\n`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const scoreValue = result.finalScore !== undefined ? result.finalScore : (result.score || 0);
    const scorePercent = (scoreValue * 100).toFixed(1);

    lines.push(`${i + 1}. ${result.file_path}:${result.line_start}-${result.line_end} (score: ${scorePercent}%)`);

    const codeLines = result.content.split('\n').slice(0, 3);
    for (const line of codeLines) {
      lines.push(`   > ${line.slice(0, 80)}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
