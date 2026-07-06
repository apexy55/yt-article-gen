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
  const prompt = `请对以下文章章节做5W1H分析，用中文回答，每项必须给出实质内容（不能留空或写"未提及"）。

章节标题：${sectionTitle}
章节内容：${sectionContent.slice(0, 2000)}

请严格按照以下格式输出，每行一个，冒号后面直接写答案（20-50字）：
WHO: （本章节涉及的主要人物、机构或群体，如无明确提及则根据内容推断）
WHAT: （本章节的核心主题或事件）
WHEN: （相关时间背景或阶段，如无明确时间则写当前时代背景）
WHERE: （涉及的地点、领域或场景，如无明确地点则写所属行业或应用场景）
WHY: （深层原因、动机或重要性）
HOW: （具体方式、路径或实现机制）

注意：每一项都必须有实质内容，基于章节内容合理推断，不得为空。`;

  const resp = await fetch(
    `${GEMINI_API}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 800 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`Gemini API 错误 ${resp.status}`);
  const data: any = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  const extract = (key: string): string => {
    const regex = new RegExp(`^${key}[:：]\\s*(.+)$`, 'im');
    const m = text.match(regex);
    const val = m?.[1]?.trim() ?? '';
    return val && val !== '-' && val !== '–' && val !== '未提及' ? val : `与${sectionTitle}相关的内容`;
  };

  return {
    who: extract('WHO'),
    what: extract('WHAT'),
    when: extract('WHEN'),
    where: extract('WHERE'),
    why: extract('WHY'),
    how: extract('HOW'),
  };
}
