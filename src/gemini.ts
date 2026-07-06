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
  // Use content if available, otherwise just title
  const context = sectionContent && sectionContent.trim().length > 20
    ? `章节内容：${sectionContent.slice(0, 1500)}`
    : `请基于章节标题进行合理推断`;

  const prompt = `对以下文章章节进行5W1H分析，用中文回答。

章节标题：${sectionTitle}
${context}

必须输出以下JSON，不要有其他内容：
{"who":"此处写谁参与了这个话题","what":"此处写具体话题是什么","when":"此处写时间背景","where":"此处写涉及场景","why":"此处写为什么重要","how":"此处写如何实现"}

要求：
1. 上面JSON中带尖号的文字是示例说明，你必须用真实内容替换它们
2. 每个字段20-50个中文字
3. 不得写“未提及”或留空，如找不到直接信息则基于内容推断
4. 只输出JSON对象，不要markdown标记`;

  const resp = await fetch(
    `${GEMINI_API}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`Gemini API 错误 ${resp.status}`);
  const data: any = await resp.json();
  let raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  // Strip markdown code fences if present
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

  const fallback = (key: string) => `本章节${key}相关内容`;
  try {
    const p = JSON.parse(raw);
    const ok = (v: unknown) => { const s = String(v ?? '').trim(); return s.length > 3 && s !== '未提及' && s !== '-' && s !== '–'; };
    return {
      who: ok(p.who) ? String(p.who) : fallback('Who'),
      what: ok(p.what) ? String(p.what) : fallback('What'),
      when: ok(p.when) ? String(p.when) : fallback('When'),
      where: ok(p.where) ? String(p.where) : fallback('Where'),
      why: ok(p.why) ? String(p.why) : fallback('Why'),
      how: ok(p.how) ? String(p.how) : fallback('How'),
    };
  } catch {
    // Try to extract from raw text if JSON failed
    const extract = (keys: string[]) => {
      for (const k of keys) {
        const m = raw.match(new RegExp(`"${k}"\\s*:\\s*"([^"]{4,})"`, 'i'));
        if (m) return m[1];
      }
      return '';
    };
    return {
      who: extract(['who']) || fallback('Who'),
      what: extract(['what']) || fallback('What'),
      when: extract(['when']) || fallback('When'),
      where: extract(['where']) || fallback('Where'),
      why: extract(['why']) || fallback('Why'),
      how: extract(['how']) || fallback('How'),
    };
  }
}
