import { pipeline, env } from '@huggingface/transformers';

// Force WASM backend only - disable onnxruntime-node to avoid memory issues on Windows
try {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.ort = null;
} catch (e) {
  // Continue even if env config fails
}

let modelCache = null;

async function getModel() {
  if (modelCache) {
    return modelCache;
  }

  console.error('Loading embeddings model (this may take a moment on first run)...');
  modelCache = await pipeline(
    'feature-extraction',
    'Xenova/universal-minilm-l6-v2'
  );

  return modelCache;
}

async function meanPooling(modelOutput, attentionMask) {
  // Get token embeddings from model output
  const tokenEmbeddings = modelOutput.data;
  const embeddingDim = modelOutput.dims[modelOutput.dims.length - 1];
  const batchSize = modelOutput.dims[0];
  const seqLength = modelOutput.dims[1];

  const pooled = [];

  for (let b = 0; b < batchSize; b++) {
    let sum = new Array(embeddingDim).fill(0);
    let count = 0;

    for (let s = 0; s < seqLength; s++) {
      const tokenIdx = b * seqLength + s;
      const maskValue = attentionMask[tokenIdx] || 1;

      if (maskValue > 0) {
        const tokenStart = tokenIdx * embeddingDim;
        for (let d = 0; d < embeddingDim; d++) {
          sum[d] += tokenEmbeddings[tokenStart + d] * maskValue;
        }
        count += maskValue;
      }
    }

    const normalized = sum.map(v => v / Math.max(count, 1e-9));
    pooled.push(normalized);
  }

  return pooled;
}

export async function generateEmbeddings(texts) {
  const model = await getModel();

  if (!Array.isArray(texts)) {
    texts = [texts];
  }

  // Generate embeddings for all texts
  const embeddings = await model(texts, {
    pooling: 'mean',
    normalize: true
  });

  // Convert to regular arrays
  const result = [];

  // embeddings is a Tensor, convert to array
  if (embeddings && embeddings.data) {
    const data = Array.from(embeddings.data);
    const shape = embeddings.dims;

    // Shape is [batchSize, embeddingDim]
    if (shape && shape.length === 2) {
      const [batchSize, embeddingDim] = shape;
      for (let i = 0; i < batchSize; i++) {
        const start = i * embeddingDim;
        const end = start + embeddingDim;
        result.push(data.slice(start, end));
      }
    } else {
      // Fallback: assume single embedding
      result.push(data);
    }
  } else if (Array.isArray(embeddings)) {
    // Already an array
    for (const emb of embeddings) {
      if (emb.data) {
        result.push(Array.from(emb.data));
      } else {
        result.push(Array.from(emb));
      }
    }
  }

  return result;
}

export async function generateSingleEmbedding(text) {
  const embeddings = await generateEmbeddings([text]);
  return embeddings[0];
}
