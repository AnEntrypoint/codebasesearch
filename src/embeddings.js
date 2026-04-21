import { pipeline, env } from '@huggingface/transformers';
import { rmSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEVICE_PREFERENCE = (process.env.CODEBASESEARCH_DEVICE || 'auto').toLowerCase();
const DTYPE_PREFERENCE = (process.env.CODEBASESEARCH_DTYPE || 'auto').toLowerCase();
const DEVICE_ORDER = ['cuda', 'dml', 'webgpu', 'wasm'];

let modelCache = null;
let cacheCleared = false;
let modelLoadTime = 0;
let resolvedDevice = null;
let resolvedDtype = null;

function clearModelCache() {
  const cacheDirs = [
    join(homedir(), '.cache', 'huggingface', 'transformers'),
    join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache'),
  ];
  for (const cacheDir of cacheDirs) {
    try {
      if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
    } catch {}
  }
  console.error('Cleared corrupted model cache');
}

function candidateDevices() {
  if (DEVICE_PREFERENCE !== 'auto') return [DEVICE_PREFERENCE, 'wasm'];
  return DEVICE_ORDER;
}

async function tryLoadWith(device, dtype) {
  const options = { device };
  if (dtype && dtype !== 'auto') options.dtype = dtype;
  return await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', options);
}

async function loadModel() {
  const devices = candidateDevices();
  const dtypes = DTYPE_PREFERENCE === 'auto' ? ['fp32', 'q8'] : [DTYPE_PREFERENCE];
  const errors = [];
  for (const device of devices) {
    for (const dtype of dtypes) {
      try {
        console.error(`Loading embeddings model on device=${device} dtype=${dtype}...`);
        const t0 = performance.now();
        const model = await tryLoadWith(device, dtype);
        modelLoadTime = performance.now() - t0;
        resolvedDevice = device;
        resolvedDtype = dtype;
        console.error(`Model loaded on ${device} (${dtype}) in ${modelLoadTime.toFixed(0)}ms`);
        return model;
      } catch (e) {
        errors.push(`${device}/${dtype}: ${e.message}`);
      }
    }
  }
  throw new Error('All device/dtype combinations failed:\n' + errors.join('\n'));
}

async function getModel(retryOnError = true) {
  if (modelCache) return modelCache;
  try {
    modelCache = await loadModel();
  } catch (e) {
    if (retryOnError && !cacheCleared && /Protobuf|parsing|corrupt/i.test(e.message)) {
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

export function getModelLoadTime() { return modelLoadTime; }
export function getResolvedDevice() { return resolvedDevice; }
export function getResolvedDtype() { return resolvedDtype; }

export async function generateEmbeddings(texts) {
  const model = await getModel();
  if (!Array.isArray(texts)) texts = [texts];

  const embeddings = await Promise.race([
    model(texts, { pooling: 'mean', normalize: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Embedding generation timeout')), 120000))
  ]);

  const result = [];
  if (embeddings && embeddings.data) {
    const data = embeddings.data;
    const shape = embeddings.dims;
    if (shape && shape.length === 2) {
      const [batchSize, embeddingDim] = shape;
      for (let i = 0; i < batchSize; i++) {
        result.push(Array.from(data.subarray(i * embeddingDim, (i + 1) * embeddingDim)));
      }
    } else {
      result.push(Array.from(data));
    }
  } else if (Array.isArray(embeddings)) {
    for (const emb of embeddings) {
      if (emb.data) result.push(Array.from(emb.data));
      else result.push(Array.from(emb));
    }
  }
  return result;
}

export async function generateSingleEmbedding(text) {
  const e = await generateEmbeddings([text]);
  return e[0];
}
