import { getHTML } from './frontend';
import { fetchSubtitles, extractVideoId } from './youtube';
import { streamArticle, generate5W1H } from './gemini';
import { saveContext, getContext, appendArticle, finalizeArticle } from './store';

export interface Env {
  GEMINI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Serve frontend
    if (pathname === '/' || pathname === '') {
      return new Response(getHTML(), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    // POST /generate - fetch subtitles + stream article
    if (pathname === '/generate' && request.method === 'POST') {
      try {
        const body = await request.json() as { url?: string; prompt?: string; sessionId?: string };
        const sessionId = body.sessionId ?? Math.random().toString(36).slice(2);
        const videoId = body.url ? extractVideoId(body.url) : null;

        // Fetch subtitles - surface errors clearly to user
        let subtitles: string;
        try {
          if (!videoId) throw new Error('请提供有效的 YouTube 视频链接');
          subtitles = await fetchSubtitles(videoId);
        } catch (subErr: any) {
          return new Response(
            `<p style="color:red">⚠️ 字幕获取失败：${subErr.message}</p>
<p>可能原因：</p>
<ul>
  <li>该视频未开启字幕（手动或自动生成）</li>
  <li>视频为私有或已删除</li>
  <li>YouTube 拒绝了服务器请求（请稍后重试）</li>
</ul>`,
            { headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, status: 200 }
          );
        }

        saveContext(sessionId, { videoId: videoId ?? '', subtitles });

        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const ctx = async () => {
          try {
            await streamArticle(
              subtitles,
              body.prompt,
              env.GEMINI_API_KEY,
              (chunk) => {
                appendArticle(sessionId, chunk);
                writer.write(encoder.encode(chunk));
              }
            );
            finalizeArticle(sessionId);
          } catch (e: any) {
            writer.write(encoder.encode(`<p style="color:red">错误: ${e.message}</p>`));
          } finally {
            writer.close();
          }
        };

        ctx();

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

    // POST /5w1h - generate 5W1H for a section
    if (pathname === '/5w1h' && request.method === 'POST') {
      try {
        const body = await request.json() as { sessionId: string; sectionTitle: string; sectionContent: string };
        const ctx = getContext(body.sessionId);
        if (!ctx) return new Response(JSON.stringify({ error: '会话已过期，请重新生成文章' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });

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
