const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash';

export async function streamArticle(
  subtitles: string,
  userPrompt: string | undefined,
  apiKey: string,
  onChunk: (text: string) => void | Promise<void>
): Promise<string> {
  const constraint = userPrompt
    ? `\n\n用户要求（请尽量满足，但不超出范围）：\n${userPrompt}`
    : '';
  const prompt = `你是专业内容创作者。请基于以下YouTube字幕，生成一篇精彩的中文视频对话内容文章。

要求：
1. 文章必须按章节组织，每个章节标题使用 <h2 data-section="true"> 标签，并包含唯一的 id 属性
2. 文章使用完整HTML格式（段落用<p>，重点用<strong>，列表用<ul><li>等）
3. 文章要生动、有洞察力，体现视频核心观点
4. 文章开头加<p class="summary">摘要</p>${constraint}

重要：
- 直接输出HTML内容，不要用markdown代码块包裹
- 不要输出 \`\`\`html 或 \`\`\` 等标记
- 不要包含<!DOCTYPE>或<html>外层标签
- 第一个字符必须是（HTML标签）

视频字幕：
${subtitles}`;

  const resp = await fetch(
    `${GEMINI_API}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      }),
    }
  );
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API 错误 ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let leftover = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const raw = decoder.decode(value, { stream: true });
    leftover += raw;
    const lines = leftover.split('\n');
    leftover = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        let text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (!text) continue;
        text = text
          .replace(/^```html\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '');
        full += text;
        await onChunk(text);
      } catch { /* parse error, skip */ }
    }
  }
  return full;
}

export async function generate5W1H(
  sectionTitle: string,
  sectionContent: string,
  _sessionId: string,
  apiKey: string
): Promise<{ who: string; what: string; when: string; where: string; why: string; how: string }> {
  const content = (sectionContent || '').trim();
  const context = content.length > 10 ? content.slice(0, 1500) : sectionTitle;

  const prompt = `You are analyzing a Chinese article section. Provide a 5W1H analysis in Chinese.

Section title: ${sectionTitle}
Section text: ${context}

Respond with ONLY this JSON (fill in actual Chinese content for each field, 20-50 chars each):
{"who":"who is involved","what":"what happened","when":"time context","where":"location/domain","why":"reason/importance","how":"method/mechanism"}

Replace the English placeholder values with real Chinese analysis based on the section. Do not return empty strings.`;

  try {
    const resp = await fetch(
      `${GEMINI_API}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 600,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!resp.ok) throw new Error(`Gemini API 错误 ${resp.status}`);
    const data: any = await resp.json();
    // Handle both regular and thinking model response formats
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    let raw = '';
    for (const part of parts) {
      if (part.text && !part.thought) raw += part.text;
    }
    raw = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    console.error('[5W1H raw]', raw.slice(0, 200));

    const fallback = `本章节${sectionTitle}相关`;
    if (!raw) return { who: fallback, what: fallback, when: fallback, where: fallback, why: fallback, how: fallback };

    const p = JSON.parse(raw);
    const ok = (v: unknown) => { const s = String(v ?? '').trim(); return s.length > 3 && s !== '未提及' && s !== '-' && s !== '–' && s !== 'who is involved' && s !== 'what happened' && s !== 'time context' && s !== 'location/domain' && s !== 'reason/importance' && s !== 'method/mechanism'; };
    return {
      who: ok(p.who) ? String(p.who) : `本次讨论主要涉及${sectionTitle}相关人群`,
      what: ok(p.what) ? String(p.what) : `本章节探讨${sectionTitle}`,
      when: ok(p.when) ? String(p.when) : '当代AI技术发展时期',
      where: ok(p.where) ? String(p.where) : '全球科技与商业领域',
      why: ok(p.why) ? String(p.why) : `${sectionTitle}对于理解这一领域至关重要`,
      how: ok(p.how) ? String(p.how) : '通过深入分析和实践验证实现',
    };
  } catch (err: any) {
    console.error('[5W1H error]', err.message);
    const fb = `本章节${sectionTitle}相关`;
    return { who: fb, what: fb, when: fb, where: fb, why: fb, how: fb };
  }
}
