export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch { /* invalid url */ }
  return null;
}

function eventsToText(events: any[]): string {
  return events
    .filter((e: any) => e.segs)
    .map((e: any) => {
      const secs = Math.floor((e.tStartMs ?? 0) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      const text = e.segs.map((seg: any) => seg.utf8 ?? '').join('').trim();
      return text ? `[${m}:${s}] ${text}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

function ytHeaders(cookies?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.youtube.com',
  };
  if (cookies) h['Cookie'] = cookies;
  return h;
}

async function fetchViaSupadata(videoId: string, apiKey: string): Promise<string> {
  const url = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&text=true`;
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`Supadata ${res.status}`);
  const data = await res.json() as { content?: string; error?: string };
  if (data.error) throw new Error(`Supadata error: ${data.error}`);
  if (!data.content || data.content.length < 100) throw new Error('Supadata: no-content');
  return data.content;
}

async function fetchViaTimedtext(videoId: string, cookies?: string): Promise<string> {
  const listUrl = `https://video.google.com/timedtext?type=list&v=${videoId}`;
  const listRes = await fetch(listUrl, { headers: ytHeaders(cookies) });
  const listXml = await listRes.text();
  const langMatch = listXml.match(/lang_code="([^"]+)"/);
  const lang = langMatch ? langMatch[1] : 'en';
  const transcriptUrl = `https://video.google.com/timedtext?lang=${lang}&v=${videoId}&fmt=json3`;
  const res = await fetch(transcriptUrl, { headers: ytHeaders(cookies) });
  if (!res.ok) throw new Error(`timedtext HTTP ${res.status}`);
  const data = await res.json() as { events?: any[] };
  if (!data.events?.length) throw new Error('timedtext: no-tracks');
  return eventsToText(data.events);
}

async function fetchViaInnerTube(videoId: string, cookies?: string): Promise<string> {
  const body = {
    context: { client: { clientName: 'WEB', clientVersion: '2.20240101' } },
    videoId,
  };
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
    method: 'POST',
    headers: { ...ytHeaders(cookies), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`innertube HTTP ${res.status}`);
  const data = await res.json() as any;
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('innertube: no-tracks');
  const track = tracks.find((t: any) => t.languageCode === 'en') ?? tracks[0];
  const captionRes = await fetch(track.baseUrl + '&fmt=json3', { headers: ytHeaders(cookies) });
  if (!captionRes.ok) throw new Error(`innertube caption HTTP ${captionRes.status}`);
  const captionData = await captionRes.json() as { events?: any[] };
  if (!captionData.events?.length) throw new Error('innertube: no-tracks');
  return eventsToText(captionData.events);
}

async function fetchViaPageScrape(videoId: string, cookies?: string): Promise<string> {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: ytHeaders(cookies) });
  if (!pageRes.ok) throw new Error(`page-scrape HTTP ${pageRes.status}`);
  const html = await pageRes.text();
  const match = html.match(/"captions":(\{.*?\}),"videoDetails"/);
  if (!match) throw new Error('page-scrape: no-tracks');
  const captionsData = JSON.parse(match[1]) as any;
  const tracks = captionsData?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('page-scrape: no-tracks');
  const track = tracks.find((t: any) => t.languageCode === 'en') ?? tracks[0];
  const captionRes = await fetch(track.baseUrl + '&fmt=json3', { headers: ytHeaders(cookies) });
  if (!captionRes.ok) throw new Error(`page-scrape caption HTTP ${captionRes.status}`);
  const captionData = await captionRes.json() as { events?: any[] };
  if (!captionData.events?.length) throw new Error('page-scrape: no-tracks');
  return eventsToText(captionData.events);
}

export async function fetchSubtitles(videoId: string, cookies?: string, supadataApiKey?: string): Promise<string> {
  const strategies: { name: string; fn: () => Promise<string> }[] = [];
  if (supadataApiKey) {
    strategies.push({ name: 'supadata', fn: () => fetchViaSupadata(videoId, supadataApiKey) });
  }
  strategies.push(
    { name: 'timedtext', fn: () => fetchViaTimedtext(videoId, cookies) },
    { name: 'innertube', fn: () => fetchViaInnerTube(videoId, cookies) },
    { name: 'page-scrape', fn: () => fetchViaPageScrape(videoId, cookies) },
  );
  const logs: string[] = [];
  for (const { name, fn } of strategies) {
    try {
      const result = await fn();
      if (result && result.length > 100) return result;
      logs.push(`${name}: no-content`);
    } catch (e: any) {
      logs.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(logs.join('; '));
}
