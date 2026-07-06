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
  const prompt = `你是一位内容分析师。我需要你对一个文章章节做完整的5W1H分析。

章节标题：${sectionTitle}
章节内容：${sectionContent.slice(0, 1500)}

以下是你必须输出的JSON格式（全部字段必填完整内容）：
{
  "who": "本章节涉及的主要人物、机构或群体",
  "what": "本章节的核心事件、现象或主题",
  "when": "相关时间背景、发展阶段或时代特征",
  "where": "涉及的地点、领域、市场或应用场景",
  "why": "深层原因、动机或重要性",
  "how": "具体方式、路径或实现机制"
}

严格要求：
1. 每个字段必须写实质性的中文内容，不得写汉字“未提及”也不得留空，不得用“-”或“–”
2. 如果章节未明确说明某个维度，则基于章节内容和标题合理推断，并给出有意义的总结
3. 每个字段不超过50字
4. 只输出JSON，不要添加任何其他文字或代码块`;

  const resp = await fetch(
    `${GEMINI_API}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`Gemini API 错误 ${resp.status}`);
  const data: any = await resp.json();
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(text);
    // Replace any empty/dash values with a fallback summary
    const clean = (v: string) => (!v || v === '-' || v === '\u2013' || v === '\u2014' || v.trim() === '') ? `详见章节内容` : v;
    return {
      who: clean(parsed.who),
      what: clean(parsed.what),
      when: clean(parsed.when),
      where: clean(parsed.where),
      why: clean(parsed.why),
      how: clean(parsed.how),
    };
  } catch {
    const extract = (key: string) => {
      const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i'));
      return m?.[1] || `详见章节内容`;
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
