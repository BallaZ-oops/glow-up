// Единая точка доступа к OpenAI. Ключ читается только из переменной окружения сервера.
import OpenAI from 'openai';

let client = null;

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}
export const chatModel = () => process.env.OPENAI_MODEL || 'gpt-6-luna';
export const embeddingModel = () => process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536; // размерность kb_chunks.embedding vector(1536)

export function getAI() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 45_000 });
  return client;
}

// Эмбеддинги запросов повторяются часто («сколько стоит…») — держим небольшой кэш на экземпляр функции.
const cache = new Map();
const CACHE_MAX = 300;

export async function embed(texts) {
  const out = new Array(texts.length);
  const need = [];
  texts.forEach((t, i) => {
    const hit = cache.get(t);
    if (hit) out[i] = hit; else need.push(i);
  });
  if (need.length) {
    const r = await getAI().embeddings.create({
      model: embeddingModel(),
      input: need.map((i) => texts[i]),
      dimensions: EMBEDDING_DIMS,
    });
    r.data.forEach((d, k) => {
      if (d.embedding.length !== EMBEDDING_DIMS) throw new Error(`embedding_dims_mismatch:${d.embedding.length}`);
      out[need[k]] = d.embedding;
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(texts[need[k]], d.embedding);
    });
  }
  return out;
}

export const toPgVector = (v) => JSON.stringify(v);
