# yt-article-gen

YouTube 字幕转中文文章生成器，基于 Cloudflare Workers + Gemini AI。

## 功能特性

- 输入 YouTube 视频链接，自动获取字幕
- 调用 Gemini 2.5 Flash API，**流式输出**生成中文文章（一边生成一边展示）
- 支持自然语言**生成要求**（风格、受众、约束条件等）
- 每个章节内置 **[5W1H]** 按鈕，点击可生成结构化 Who/What/When/Where/Why/How 总结
- 5W1H 请求使用服务端保存的上下文，无需重新提交文章
- 字幕获取失败时自动回退至内置示例字幕

## 技术架构

- **运行时**: Cloudflare Workers (Edge)
- **语言**: TypeScript
- **AI**: Google Gemini 1.5 Flash (Free API)
- **前端**: 原生 HTML/CSS/JS，内联于 Worker 返回

## 部署指南

### 1. 克隆仓库

```bash
git clone https://github.com/apexy55/yt-article-gen.git
cd yt-article-gen
npm install
```

### 2. 设置 Gemini API Key

前往 [Google AI Studio](https://aistudio.google.com/api-keys) 获取免费 API Key，然后：

```bash
npx wrangler secret put GEMINI_API_KEY
# 输入你的 API Key 并回车
```

### 3. 本地开发

```bash
npm run dev
```

### 4. 部署到 Cloudflare Workers

```bash
npm run deploy
```

部署后获得公开访问 URL，格式如：
`https://yt-article-gen.<your-subdomain>.workers.dev`

## 模块说明

| 文件 | 说明 |
|---|---|
| `src/index.ts` | 主入口，Worker 路由（GET /、POST /generate、POST /5w1h） |
| `src/youtube.ts` | YouTube 字幕获取（解析 ytInitialPlayerResponse） |
| `src/gemini.ts` | Gemini API 流式生成 + 5W1H 生成 |
| `src/store.ts` | 内存 Session 存储（保存上下文工 5W1H 使用） |
| `src/frontend.ts` | 完整 HTML 前端（内联返回） |

## 主要工程亮点

- **流式输出**: 使用 `TransformStream` 实现真正的流式 HTTP 响应
- **无外部依赖**: 除 wrangler 外，全部模块均为原生 TS
- **5W1H 不重提交文章**: 服务端用 Map 缓存本次生成上下文，仅传入章节标题+内容
- **字幕抗险性**: 主动 fallback 到内置示例，避免 YouTube 反爬虫导致空白
- **面向产品的前端**: 无框架依赖，原生 CSS + 优雅 UI
