import { pipeline, env } from '@huggingface/transformers';
import { rmSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Force WASM backend only - disable onnxruntime-node to avoid memory issues on Windows
try {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.ort = null;
} catch (e) {
  // Continue even if env config fails
}

let modelCache = null;
let cacheCleared = false;
let modelLoadTime = 0;

function clearModelCache() {
  const cacheDirs = [
    join(homedir(), '.cache', 'huggingface', 'transformers'),
    join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache'),
  ];

  for (const cacheDir of cacheDirs) {
    try {
      if (existsSync(cacheDir)) {
        rmSync(cacheDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore errors, continue with next cache dir
    }
  }
  console.error('Cleared corrupted model cache');
}

async function getModel(retryOnError = true) {
  if (modelCache) {
    return modelCache;
  }

  const modelStart = performance.now();
  console.error('Loading embeddings model (this may take a moment on first run)...');

  const modelLoadPromise = pipeline(
    'feature-extraction',
    'Xenova/all-minilm-l6-v2'
  );

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Model loading timeout after 5 minutes')), 300000)
  );

  try {
    modelCache = await Promise.race([modelLoadPromise, timeoutPromise]);
    modelLoadTime = performance.now() - modelStart;
  } catch (e) {
    if (retryOnError && !cacheCleared && (e.message.includes('Protobuf') || e.message.includes('parsing'))) {
      console.error('Detected corrupted cache, clearing and retrying...');
      cacheCleared = true;
      clearModelCache();
      modelCache = null;
      return getModel(false);
    }
    console.error('Error loading model:', e.message);
    throw e;
  }

  return modelCache;
}

export function getModelLoadTime() {
  return modelLoadTime;
}

export async function generateEmbeddings(texts) {
  const model = await getModel();

  if (!Array.isArray(texts)) {
    texts = [texts];
  }

  // Generate embeddings for all texts with timeout per batch
  const embeddings = await Promise.race([
    model(texts, {
      pooling: 'mean',
      normalize: true
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Embedding generation timeout')), 60000)
    )
  ]);

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
