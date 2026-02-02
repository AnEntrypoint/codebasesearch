export function buildTextIndex(chunks) {
  const index = new Map();
  const chunkMetadata = [];

  chunks.forEach((chunk, idx) => {
    const tokens = tokenize(chunk.content);
    const symbols = extractSymbols(chunk.content);
    const frequency = new Map();

    tokens.forEach(token => {
      frequency.set(token, (frequency.get(token) || 0) + 1);
      if (!index.has(token)) {
        index.set(token, []);
      }
      index.get(token).push(idx);
    });

    chunkMetadata[idx] = {
      tokens,
      symbols,
      frequency,
      isCode: isCodeFile(chunk.file_path),
    };
  });

  return { index, chunkMetadata };
}

export function searchText(query, chunks, indexData) {
  const { index, chunkMetadata } = indexData;
  const queryTokens = tokenize(query);
  const querySymbols = extractSymbols(query);
  const chunkScores = new Map();

  chunks.forEach((chunk, idx) => {
    let score = 0;

    queryTokens.forEach(token => {
      if (index.has(token)) {
        if (index.get(token).includes(idx)) {
          const freq = chunkMetadata[idx].frequency.get(token) || 1;
          const boost = token.length > 4 ? 1.5 : 1;
          score += boost * freq;
        }
      }
    });

    querySymbols.forEach(symbol => {
      if (chunkMetadata[idx].symbols.includes(symbol)) {
        score += 5;
      }
    });

    const exactMatch = chunk.content.includes(query);
    if (exactMatch) {
      score += 10;
    }

    if (chunkMetadata[idx].isCode) {
      score *= 1.2;
    }

    if (score > 0) {
      chunkScores.set(idx, score);
    }
  });

  const results = Array.from(chunkScores.entries())
    .map(([idx, score]) => ({
      ...chunks[idx],
      score: Math.min(score / 100, 1),
      _rawScore: score,
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b._rawScore - a._rawScore);

  return results;
}

function tokenize(text) {
  const tokens = new Set();

  text.toLowerCase().split(/\s+/).forEach(word => {
    if (word.length === 0) return;

    tokens.add(word.replace(/[^\w]/g, ''));

    const camelCaseTokens = word.match(/[a-z]+|[A-Z][a-z]*|[0-9]+/g) || [];
    camelCaseTokens.forEach(t => {
      if (t.length > 1) tokens.add(t.toLowerCase());
    });

    const snakeCaseTokens = word.split(/[-_]/).filter(t => t.length > 0);
    snakeCaseTokens.forEach(t => {
      if (t.length > 1) tokens.add(t.toLowerCase());
    });
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
