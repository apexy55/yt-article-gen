export function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>YouTube 内容文章生成器</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'PingFang SC','Helvetica Neue',Arial,sans-serif;background:#f5f6fa;color:#222;line-height:1.7}
.container{max-width:860px;margin:0 auto;padding:32px 20px}
h1{font-size:1.8rem;font-weight:700;margin-bottom:8px;color:#1a1a2e}
.subtitle{color:#888;margin-bottom:32px;font-size:.95rem}
.card{background:#fff;border-radius:12px;padding:28px;margin-bottom:24px;box-shadow:0 2px 12px rgba(0,0,0,.07)}
label{font-weight:600;display:block;margin-bottom:8px;font-size:.9rem;color:#444}
input[type=text],textarea{width:100%;border:1.5px solid #e0e0e0;border-radius:8px;padding:10px 14px;font-size:.95rem;transition:border .2s;outline:none}
input[type=text]:focus,textarea:focus{border-color:#5c6bc0}
textarea{resize:vertical;min-height:80px}
.btn{display:inline-flex;align-items:center;gap:8px;background:#5c6bc0;color:#fff;border:none;padding:11px 28px;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:background .2s}
.btn:hover{background:#3f51b5}
.btn:disabled{background:#aaa;cursor:not-allowed}
.btn-sm{padding:5px 14px;font-size:.82rem;font-weight:600;background:#5c6bc0;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-left:10px;vertical-align:middle}
.btn-sm:hover{background:#3f51b5}
#status{margin-top:16px;font-size:.9rem;color:#5c6bc0;min-height:22px}
#article-wrap{display:none}
#article{line-height:1.9}
#article h2{font-size:1.25rem;font-weight:700;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e8eaf6;display:flex;align-items:center;justify-content:space-between;gap:10px}
#article p{margin-bottom:14px;color:#333}
#article .summary{background:#e8eaf6;border-left:4px solid #5c6bc0;padding:12px 16px;border-radius:6px;margin-bottom:24px;font-style:italic}
#article strong{color:#1a1a2e}
#article ul{margin:10px 0 14px 20px}
#article li{margin-bottom:6px}
.w5h1-btn{background:#e8eaf6;color:#5c6bc0;border:1px solid #c5cae9;border-radius:5px;padding:3px 10px;font-size:.78rem;font-weight:700;cursor:pointer;white-space:nowrap}
.w5h1-btn:hover{background:#c5cae9}
.w5h1-btn.loading{opacity:.6;cursor:wait}
.w5h1-panel{background:#f3f4ff;border:1px solid #c5cae9;border-radius:8px;padding:16px 20px;margin:8px 0 20px;display:none}
.w5h1-panel table{width:100%;border-collapse:collapse}
.w5h1-panel td{padding:8px 12px;border-bottom:1px solid #e0e0e0;font-size:.9rem}
.w5h1-panel td:first-child{font-weight:700;color:#5c6bc0;width:70px;white-space:nowrap}
.w5h1-loading{color:#888;font-size:.85rem;padding:8px 0}
.fallback-hint{font-size:.82rem;color:#999;margin-top:6px}
</style>
</head>
<body>
<div class="container">
  <h1>🎥 YouTube 内容文章生成器</h1>
  <p class="subtitle">基于 Gemini AI，将 YouTube 字幕转化为深度中文文章</p>

  <div class="card">
    <label for="url">🔗 YouTube 视频链接</label>
    <input type="text" id="url" placeholder="https://www.youtube.com/watch?v=...">
    <p style="font-size:.82rem;color:#999;margin-top:6px">提示：若字幕获取失败，系统会自动使用内置示例字幕（xRh2sVcNXQ8）</p>
    <label for="prompt" style="margin-top:16px">💬 生成要求（可选）</label>
    <textarea id="prompt" placeholder="例：请用通俗易懂的语言介绍，面向初学者，强调实际行动建议…"></textarea>
    <button class="btn" id="generateBtn" onclick="generate()" style="margin-top:16px">✨ 生成文章</button>
    <div id="status"></div>
  </div>

  <div id="article-wrap">
    <div id="article" class="card"></div>
  </div>
</div>
<script>
const FALLBACK_ID = 'xRh2sVcNXQ8';
let sessionId = null;

async function generate() {
  const urlVal = document.getElementById('url').value.trim();
  const promptVal = document.getElementById('prompt').value.trim();
  const btn = document.getElementById('generateBtn');
  const status = document.getElementById('status');
  const articleDiv = document.getElementById('article');
  const articleWrap = document.getElementById('article-wrap');
  btn.disabled = true;
  status.textContent = '正在获取字幕...';
  articleDiv.innerHTML = '';
  articleWrap.style.display = 'none';
  sessionId = Math.random().toString(36).slice(2);
  const body = { url: urlVal, prompt: promptVal, sessionId };
  try {
    const resp = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) { const err = await resp.text(); throw new Error(err); }
    articleWrap.style.display = 'block';
    status.textContent = '正在生成文章...';
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      articleDiv.innerHTML = buffer;
      articleWrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    articleDiv.innerHTML = buffer;
    addSectionButtons();
    status.textContent = '✅ 文章生成完成，正在预加5W1H分析...';
    await preloadAll5W1H();
    status.textContent = '✅ 文章生成完成';
  } catch (e) {
    status.textContent = '❌ 错误：' + e.message;
  } finally {
    btn.disabled = false;
  }
}

function addSectionButtons() {
  document.querySelectorAll('#article h2[data-section]').forEach(h2 => {
    if (h2.querySelector('.w5h1-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'w5h1-btn loading';
    btn.textContent = '[5W1H]';
    const panel = document.createElement('div');
    panel.className = 'w5h1-panel';
    panel.innerHTML = '<div class="w5h1-loading">加载中...</div>';
    btn.onclick = () => {
      if (panel.style.display === 'block') {
        panel.style.display = 'none';
      } else {
        panel.style.display = 'block';
      }
    };
    h2.appendChild(btn);
    h2.insertAdjacentElement('afterend', panel);
  });
}

function buildPanelHTML(data) {
  return \`<table>
    <tr><td>Who</td><td>\${data.who || '-'}</td></tr>
    <tr><td>What</td><td>\${data.what || '-'}</td></tr>
    <tr><td>When</td><td>\${data.when || '-'}</td></tr>
    <tr><td>Where</td><td>\${data.where || '-'}</td></tr>
    <tr><td>Why</td><td>\${data.why || '-'}</td></tr>
    <tr><td>How</td><td>\${data.how || '-'}</td></tr>
  </table>\`;
}

async function preloadAll5W1H() {
  const sections = document.querySelectorAll('#article h2[data-section]');
  const promises = Array.from(sections).map(async h2 => {
    const btn = h2.querySelector('.w5h1-btn');
    const panel = h2.nextElementSibling;
    if (!btn || !panel) return;
    const sectionTitle = h2.textContent.replace('[5W1H]', '').trim();
    let content = '';
    let el = panel.nextElementSibling;
    while (el && el.tagName !== 'H2') {
      content += el.textContent + ' ';
      el = el.nextElementSibling;
    }
    try {
      const r = await fetch('/5w1h', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, sectionTitle, sectionContent: content.slice(0, 1000) })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      panel.innerHTML = buildPanelHTML(data);
      btn.classList.remove('loading');
    } catch (e) {
      panel.innerHTML = '<p style="color:red">生成失败: ' + e.message + '</p>';
      btn.classList.remove('loading');
    }
  });
  await Promise.all(promises);
}
<\/script>
</body>
</html>`;
}
