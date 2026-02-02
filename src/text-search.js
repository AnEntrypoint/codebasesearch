export function buildTextIndex(chunks) {
  const index = new Map();

  chunks.forEach((chunk, idx) => {
    const tokens = tokenize(chunk.content);
    tokens.forEach(token => {
      if (!index.has(token)) {
        index.set(token, []);
      }
      index.get(token).push(idx);
    });
  });

  return index;
}

export function searchText(query, chunks, index) {
  const queryTokens = tokenize(query);
  const chunkScores = new Map();

  queryTokens.forEach(token => {
    if (index.has(token)) {
      index.get(token).forEach(chunkIdx => {
        if (!chunkScores.has(chunkIdx)) {
          chunkScores.set(chunkIdx, 0);
        }
        chunkScores.set(chunkIdx, chunkScores.get(chunkIdx) + 1);
      });
    }
  });

  const results = Array.from(chunkScores.entries())
    .map(([idx, score]) => ({
      ...chunks[idx],
      score: score / queryTokens.length,
      matchCount: score,
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return results;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .match(/\b\w+\b/g) || [];
}
