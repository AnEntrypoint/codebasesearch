export function buildTextIndex(chunks) {
  const index = new Map();
  const chunkMetadata = new Array(chunks.length);

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const frequency = tokenizeToFrequency(chunk.content, index, idx);
    const fileNameTokens = new Set(tokenize(chunk.file_path));
    const symbols = new Set(extractSymbols(chunk.content));

    chunkMetadata[idx] = {
      fileNameTokens,
      symbols,
      frequency,
      isCode: isCodeFile(chunk.file_path),
      contentLower: chunk.content.toLowerCase(),
    };
  }

  // Precompute IDF for each token: log((N+1)/(df+1))
  const N = chunks.length;
  const idf = new Map();
  for (const [token, docSet] of index) {
    idf.set(token, Math.log((N + 1) / (docSet.size + 1)) + 1);
  }

  return { index, chunkMetadata, idf };
}

function tokenizeToFrequency(text, index, chunkIdx) {
  const frequency = new Map();

  for (const word of text.split(/\s+/)) {
    if (word.length === 0) continue;

    const hasUpperCase = word !== word.toLowerCase();
    if (hasUpperCase) {
      const camelTokens = word.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)|[0-9]+/g);
      if (camelTokens) {
        for (const t of camelTokens) {
          if (t.length > 1) frequency.set(t.toLowerCase(), (frequency.get(t.toLowerCase()) || 0) + 1);
        }
      }
    }

    const cleaned = word.replace(/[^\w]/g, '').toLowerCase();
    if (cleaned.length > 1) {
      frequency.set(cleaned, (frequency.get(cleaned) || 0) + 1);
      if (word.includes('-') || word.includes('_') || word.includes('.')) {
        for (const part of word.split(/[-_.]/)) {
          const partCleaned = part.replace(/[^\w]/g, '').toLowerCase();
          if (partCleaned.length > 1 && partCleaned !== cleaned) frequency.set(partCleaned, (frequency.get(partCleaned) || 0) + 1);
        }
      }
    }
  }

  for (const token of frequency.keys()) {
    let docSet = index.get(token);
    if (!docSet) { docSet = new Set(); index.set(token, docSet); }
    docSet.add(chunkIdx);
  }

  return frequency;
}

export function searchText(query, chunks, indexData) {
  const { index, chunkMetadata, idf } = indexData;
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

  const queryLower = query.toLowerCase();

  let scoringCandidates = candidates;
  if (candidates.size > 500) {
    const ranked = Array.from(candidates).sort((a, b) => {
      let aSum = 0, bSum = 0;
      for (const token of queryTokens) {
        if (index.has(token)) {
          if (index.get(token).has(a)) aSum += idf.get(token) || 1;
          if (index.get(token).has(b)) bSum += idf.get(token) || 1;
        }
      }
      return bSum - aSum;
    });
    scoringCandidates = new Set(ranked.slice(0, 500));
  }

  for (const idx of scoringCandidates) {
    const chunk = chunks[idx];
    const meta = chunkMetadata[idx];
    let score = 0;

    if (queryTokens.length > 1 && meta.contentLower.includes(queryLower)) {
      score += 30;
    }

    // Symbol match in content - function/class named after query terms
    querySymbols.forEach(symbol => {
      if (meta.symbols.has(symbol)) score += 10;
    });

    // Filename token match - strong signal that this file is about the query topic
    let fileNameMatches = 0;
    queryTokens.forEach(token => {
      if (meta.fileNameTokens.has(token)) fileNameMatches++;
    });
    if (fileNameMatches > 0) {
      score += fileNameMatches * 10;
    }

    // TF-IDF scoring: reward rare tokens that appear in this chunk
    queryTokens.forEach(token => {
      if (index.has(token) && index.get(token).has(idx)) {
        const tf = Math.min(meta.frequency.get(token) || 1, 5);
        const tokenIdf = idf ? (idf.get(token) || 1) : 1;
        const lengthBoost = token.length > 4 ? 1.5 : 1;
        score += lengthBoost * tf * tokenIdf;
      }
    });

    // Code file boost
    if (meta.isCode) score *= 1.2;

    if (score > 0) chunkScores.set(idx, score);
  }

  const entries = Array.from(chunkScores.entries()).sort((a, b) => b[1] - a[1]);
  const maxScore = entries.length > 0 ? entries[0][1] : 1;

  const results = entries.map(([idx, score]) => ({
    ...chunks[idx],
    score: score / maxScore,
    _rawScore: score,
  }));

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
