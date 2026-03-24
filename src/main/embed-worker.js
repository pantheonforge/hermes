const { parentPort, workerData } = require('worker_threads');

let embedder = null;
let embedMethod = 'disabled';
const queue = [];
let processing = false;

const MODEL = 'fast-bge-base-en-v1.5';

async function init() {
  try {
    const mod = require('fastembed');
    const { FlagEmbedding, EmbeddingModel } = mod;
    if (FlagEmbedding?.init) {
      embedder = await FlagEmbedding.init({
        model: EmbeddingModel.BGEBaseENV15,
        ...(workerData?.cacheDir ? { cacheDir: workerData.cacheDir } : {}),
      });
      embedMethod = MODEL;
    }
  } catch (err) {
    embedder = null;
    embedMethod = 'disabled';
    console.error('[embed-worker] fastembed init failed:', err.message);
  }
  parentPort.postMessage({ type: 'ready', embedMethod });
}

async function embedTexts(texts) {
  if (!embedder || embedMethod === 'disabled') return null;
  const iter = embedder.embed(texts);
  const vectors = [];
  for await (const batch of iter) {
    for (const v of batch) vectors.push(Array.from(v));
  }
  return vectors.length === texts.length ? vectors : null;
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const { id, texts } = queue.shift();
    try {
      const vectors = await embedTexts(texts);
      parentPort.postMessage({ type: 'result', id, vectors, embedMethod });
    } catch (err) {
      parentPort.postMessage({ type: 'result', id, vectors: null, embedMethod: 'disabled', error: String(err.message) });
    }
  }
  processing = false;
}

parentPort.on('message', (msg) => {
  if (msg.type === 'embed') {
    queue.push({ id: msg.id, texts: msg.texts });
    processQueue().catch(() => {});
  } else if (msg.type === 'shutdown') {
    process.exit(0);
  }
});

init().catch((err) => {
  console.error('[embed-worker] init crash:', err.message);
  parentPort.postMessage({ type: 'ready', embedMethod: 'disabled' });
});
