import { getHTML } from './frontend';
import { fetchSubtitles, extractVideoId } from './youtube';
import { streamArticle, generate5W1H } from './gemini';
import { saveContext, getContext, appendArticle, finalizeArticle } from './store';

// Fallback subtitles for when YouTube blocks server-side fetch
const FALLBACK_SUBTITLES = `[00:00] Welcome to this conversation with Marc Andreessen, co-founder of Andreessen Horowitz.
[00:10] Today we explore the trillion-dollar question: what does AI mean for the economy?
[00:30] I think AI is the most significant technological shift since electricity or the internet.
[00:45] Every industry will be touched - healthcare, education, finance, manufacturing.
[01:00] The key insight is that intelligence itself is becoming a commodity.
[01:15] For the first time in history, you can deploy cognitive capability at near-zero marginal cost.
[01:30] Where does the trillion dollars come from? It comes from productivity gains.
[01:45] Every knowledge worker becomes 10x more productive with AI.
[02:00] And it comes from entirely new categories of products that didn't exist before.
[02:15] Think about personalized tutors for every child on earth - that's a massive new market.
[02:30] Or personal health coaches that know your complete medical history.
[03:00] There are three revenue layers: consumer subscriptions, enterprise per-token billing, and value-based pricing.
[03:20] The consumer market is moving fastest - ChatGPT hit 100 million users faster than any product ever.
[03:40] Enterprise is where the real money is. Companies will pay enormous sums for productivity gains.
[04:00] GPU costs seem astronomical, but costs are falling faster than anyone expected.
[04:30] In 2 years inference costs have dropped 100x. That collapse continues.
[04:45] As costs drop, demand expands - classic Jevons Paradox. Cheaper intelligence means more intelligence used.
[05:15] The foundation model layer is incredibly capital intensive - only a few players can compete.
[05:30] But the application layer is wide open. Thousands of startups will build valuable businesses.
[06:00] My biggest concern is regulatory overreach that locks in incumbents and prevents innovation.
[06:30] We need AI development to remain open and competitive, not become government-controlled.
[07:00] Safety is important but often used as a trojan horse to prevent competition.
[07:30] The real safety risk is not building AI fast enough - falling behind adversaries is more dangerous.
[08:00] Learn to use AI tools - they amplify whatever skills you have.
[08:30] Focus on uniquely human capabilities: creativity, judgment, relationships, leadership.`;

export interface Env {
  GEMINI_API_KEY: string;   YOUTUBE_COOKIES?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '') {
      return new Response(getHTML(), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    if (pathname === '/generate' && request.method === 'POST') {
      try {
        const body = await request.json() as { url: string; prompt?: string };
        const videoId = extractVideoId(body.url);

        let subtitles: string;
        let subtitleNote = '';
        try {
          if (!videoId) throw new Error('请提供有效的 YouTube 视频链接');
          subtitles = await fetchSubtitles(videoId, env.YOUTUBE_COOKIES);
        } catch (subErr: any) {
          subtitles = FALLBACK_SUBTITLES;
          subtitleNote = `<p style="background:#fff3cd;border:1px solid #ffc107;padding:8px 12px;border-radius:6px;color:#856404;margin-bottom:16px">⚠️ 字幕获取失败（${subErr.message}），展示以下示例内容。</p>`;
        }

        const sessionId = crypto.randomUUID();
        saveContext(sessionId, { subtitles, article: '', userPrompt: body.prompt, createdAt: Date.now() });

        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Run streaming in background - do NOT await, return the stream immediately
        (async () => {
          try {
            if (subtitleNote) {
              await writer.write(encoder.encode(subtitleNote));
            }
            await streamArticle(
              subtitles,
              body.prompt,
              env.GEMINI_API_KEY,
              async (chunk) => {
                appendArticle(sessionId, chunk);
                await writer.write(encoder.encode(chunk));
              }
            );
            finalizeArticle(sessionId);
          } catch (e: any) {
            await writer.write(encoder.encode(`<p style="color:red">生成失败: ${e.message}</p>`));
          } finally {
            await writer.close();
          }
        })();

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/plain;charset=UTF-8',
            'X-Session-Id': sessionId,
          },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (pathname === '/5w1h' && request.method === 'POST') {
      try {
        const body = await request.json() as { sessionId: string; sectionTitle: string; sectionContent: string };
        const result = await generate5W1H(
          body.sectionTitle,
          body.sectionContent,
          body.sessionId,
          env.GEMINI_API_KEY
        );

        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
