// База знаний: гибридный поиск (векторы OpenAI + полнотекстовый Postgres) и индексация embeddings.
import { getDb } from './supabase.js';
import { aiConfigured, embed, toPgVector } from './openai.js';

const MIN_SIMILARITY = Number(process.env.KB_MIN_SIMILARITY || 0.3);

export async function searchKb(query, limit = 5) {
  const db = getDb();
  const results = [];
  const seen = new Set();
  const push = (r, extra) => {
    const key = `${r.document_id}:${String(r.content).slice(0, 60)}`;
    if (seen.has(key) || results.length >= limit) return;
    seen.add(key);
    results.push({ title: r.title, category: r.category, text: r.content, ...extra });
  };

  let vectorOk = false;
  if (aiConfigured()) {
    try {
      const [v] = await embed([query]);
      const { data, error } = await db.rpc('kb_match', {
        query_embedding: toPgVector(v), match_count: limit, min_similarity: MIN_SIMILARITY,
      });
      if (error) throw new Error(error.message);
      vectorOk = true;
      (data || []).forEach((r) => push(r, { relevance: Number(r.similarity.toFixed(2)), via: 'vector' }));
    } catch (e) {
      console.error('vector search failed, using full-text only:', e.message);
    }
  }

  const { data: fts, error: ftsErr } = await db.rpc('kb_search', { p_query: query, p_limit: limit });
  if (ftsErr) console.error('fts search failed:', ftsErr.message);
  (fts || []).forEach((r) => push(r, { via: 'keyword' }));

  return { results, vector: vectorOk };
}

// Создаёт embeddings для фрагментов, у которых их ещё нет. Повторно не пересчитывает.
export async function embedPending(maxChunks = 200) {
  if (!aiConfigured()) throw new Error('openai_not_configured');
  const db = getDb();
  const { data: chunks, error } = await db
    .from('kb_chunks').select('id,content,title_snapshot').is('embedding', null).order('id').limit(maxChunks);
  if (error) throw new Error(error.message);

  let done = 0;
  for (let i = 0; i < (chunks || []).length; i += 64) {
    const batch = chunks.slice(i, i + 64);
    const vectors = await embed(batch.map((c) => `${c.title_snapshot ? c.title_snapshot + '\n\n' : ''}${c.content}`));
    for (let j = 0; j < batch.length; j += 10) {
      await Promise.all(batch.slice(j, j + 10).map(async (c, k) => {
        const { error: e } = await db.from('kb_chunks')
          .update({ embedding: toPgVector(vectors[j + k]), embedded_at: new Date().toISOString() }).eq('id', c.id);
        if (e) throw new Error(e.message); else done++;
      }));
    }
  }
  const { count } = await db.from('kb_chunks').select('id', { count: 'exact', head: true }).is('embedding', null);
  return { embedded: done, remaining: count || 0 };
}
