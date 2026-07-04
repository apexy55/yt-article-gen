// In-memory session store for generation contexts
// Cloudflare Workers maintain module-level state per isolate

export interface GenerationContext {
  subtitles: string;
  article: string;
  userPrompt?: string;
  createdAt: number;
}

const store = new Map<string, GenerationContext>();

function cleanup() {
  const now = Date.now();
  for (const [key, val] of store.entries()) {
    if (now - val.createdAt > 3_600_000) store.delete(key);
  }
}

export function saveContext(sessionId: string, ctx: GenerationContext): void {
  cleanup();
  store.set(sessionId, ctx);
}

export function getContext(sessionId: string): GenerationContext | undefined {
  return store.get(sessionId);
}

export function appendArticle(sessionId: string, chunk: string): void {
  const ctx = store.get(sessionId);
  if (ctx) ctx.article += chunk;
}

export function finalizeArticle(sessionId: string, article: string): void {
  const ctx = store.get(sessionId);
  if (ctx) ctx.article = article;
}
