export function buildTextIndex(chunks) {
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

export function searchText(query, chunks, indexData) {
  const { index, chunkMetadata } = indexData;
  const queryTokens = tokenize(query);
  const querySymbols = extractSymbols(query);
  const chunkScores = new Map();

  // Use index to find candidate chunks efficiently
  const candidates = new Set();
  queryTokens.forEach(token => {
    if (index.has(token)) {
      for (const idx of index.get(token)) candidates.add(idx);
    }
  });
  querySymbols.forEach(sym => {
    if (index.has(sym)) {
      for (const idx of index.get(sym)) candidates.add(idx);
    }
  });

  for (const idx of candidates) {
    const chunk = chunks[idx];
    const meta = chunkMetadata[idx];
    let score = 0;

    queryTokens.forEach(token => {
      if (index.has(token) && index.get(token).has(idx)) {
        const freq = meta.frequency.get(token) || 1;
        const lengthBoost = token.length > 4 ? 1.5 : 1;
        score += lengthBoost * Math.min(freq, 5);
      }
    });

    // Filename token match - strong signal that this file is about the query topic
    let fileNameMatches = 0;
    queryTokens.forEach(token => {
      if (meta.fileNameTokens.includes(token)) fileNameMatches++;
    });
    if (fileNameMatches > 0) {
      score += fileNameMatches * 8;
    }

    // Symbol match in content - function/class named after query terms
    querySymbols.forEach(symbol => {
      if (meta.symbols.includes(symbol)) score += 5;
    });

    // Exact phrase match
    if (chunk.content.toLowerCase().includes(query.toLowerCase())) {
      score += 15;
    }

    // Code file boost
    if (meta.isCode) score *= 1.2;

    if (score > 0) chunkScores.set(idx, score);
  }

  const results = Array.from(chunkScores.entries())
    .map(([idx, score]) => ({
      ...chunks[idx],
      score: Math.min(score / 100, 1),
      _rawScore: score,
    }))
    .sort((a, b) => b._rawScore - a._rawScore);

  return results;
}

function tokenize(text) {
  const tokens = new Set();

  text.split(/\s+/).forEach(word => {
    if (word.length === 0) return;

    // camelCase/PascalCase split BEFORE lowercasing so uppercase boundaries are visible
    const camelCaseTokens = word.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)|[0-9]+/g) || [];
    camelCaseTokens.forEach(t => {
      if (t.length > 1) tokens.add(t.toLowerCase());
    });

    // snake_case and kebab-case split
    word.split(/[-_.]/).forEach(t => {
      const cleaned = t.replace(/[^\w]/g, '').toLowerCase();
      if (cleaned.length > 1) tokens.add(cleaned);
    });

    // Full word lowercased (stripped of punctuation)
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
