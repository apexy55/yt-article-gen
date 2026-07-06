const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash';

export async function streamArticle(
  subtitles: string,
  userPrompt: string | undefined,
  apiKey: string,
  onChunk: (text: string) => void | Promise<void>
): Promise<string> {
  const constraint = userPrompt
    ? `\n\n用户要求（请尽量满足，但不超出范围）：  \n${userPrompt}`
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
  const prompt = `你是一位专业内容分析师。请对以下文章章节进行5W1H分析。

章节标题：${sectionTitle}
章节内容：${sectionContent.slice(0, 1500)}

要求：
- 输出中文JSON对象，包含who/what/when/where/why/how六个字段
- 每个字段必须提供具体内容，不能留空或写“未提及”
- 如果章节没有明确提及该信息，则基于文章主题和上下文进行合理推断和总结
- 每个字段不超过50字，言简意赅
- 字段含义：
  - who：涉及的主要人物、机构、群体（如无明确主语，写主要讨论对象）
  - what：当前章节的核心事件、现象或观点是什么
  - when：时间背景或发展阶段（如无明确时间，写当前阶段或近年趋势）
  - where：涉及的地点、领域或场景（如无明确地点，写应用领域或市场范围）
  - why：深层原因、动机或重要性
  - how：具体方式、路径或实现机制
- 直接输出JSON，不要包裹在代码块中`;

  const resp = await fetch(
    `${GEMINI_API}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 512 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`Gemini API 错误 ${resp.status}`);
  const data: any = await resp.json();
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const extract = (key: string) => {
      const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i'));
      return m ? m[1] : '-';
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
