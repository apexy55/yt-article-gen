const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash';

export async function streamArticle(
  subtitles: string,
  userPrompt: string | undefined,
  apiKey: string,
  onChunk: (text: string) => void
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
- 第一个字符必须是 < （HTML标签）

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
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (text) {
          // Strip markdown code fences if Gemini accidentally includes them
          const cleaned = text
            .replace(/^```html\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '');
          full += cleaned;
          onChunk(cleaned);
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  return full;
}

export async function generate5W1H(
  sectionTitle: string,
  sectionContent: string,
  sessionId: string,
  apiKey: string
): Promise<{ who: string; what: string; when: string; where: string; why: string; how: string }> {
  const prompt = `基于以下文章段落，用简洁中文回答5W1H（每项不超过50字）：
章节标题：${sectionTitle}
章节内容：${sectionContent}

请严格以JSON格式返回，不要包含任何markdown代码块标记，直接输出纯JSON，字段为：who, what, when, where, why, how
示例格式：{"who":"...","what":"...","when":"...","where":"...","why":"...","how":"..."}`;

  const resp = await fetch(
    `${GEMINI_API}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }

  const json = await resp.json();
  const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';

  // Robustly strip all markdown fences and whitespace
  const clean = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const result = JSON.parse(clean);
    return {
      who: result.who ?? '',
      what: result.what ?? '',
      when: result.when ?? '',
      where: result.where ?? '',
      why: result.why ?? '',
      how: result.how ?? '',
    };
  } catch {
    // If JSON parse fails, try to extract values with regex as last resort
    const extract = (key: string) => {
      const m = clean.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*?)"`, 'i'));
      return m?.[1] ?? '无法解析';
    };
    return {
      who: extract('who'),
      what: extract('what'),
      when: extract('when'),
      where: extract('where'),
      why: extract('why'),
      how: extract('how'),
    };
  }
}
