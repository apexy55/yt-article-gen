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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.youtube.com',
  };
  if (cookies) h['Cookie'] = cookies;
  return h;
}

// Strategy 1: Direct timedtext API
async function fetchViaTimedtext(videoId: string, cookies?: string): Promise<string | null> {
  const langs = ['en', 'en-US', 'en-GB', 'a.en'];
  for (const lang of langs) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3&xorb=2&xobt=3&xovt=3`;
      const resp = await fetch(url, {
        headers: { ...ytHeaders(cookies), 'Referer': `https://www.youtube.com/watch?v=${videoId}` },
      });
      if (!resp.ok) continue;
      const data: any = await resp.json();
      if (!data?.events?.length) continue;
      const text = eventsToText(data.events);
      if (text.length > 100) return text;
    } catch { continue; }
  }
  return null;
}

// Strategy 2: InnerTube with cookies
async function fetchViaInnerTube(videoId: string, cookies?: string): Promise<string | null> {
  try {
    const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        ...ytHeaders(cookies),
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240101.00.00',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' } },
        videoId,
      }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const tracks: any[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (!tracks.length) return null;
    const track = tracks.find((t: any) => t.languageCode?.startsWith('en') && !t.kind)
      ?? tracks.find((t: any) => t.languageCode?.startsWith('en'))
      ?? tracks[0];
    if (!track?.baseUrl) return null;
    if (!track.baseUrl.includes('youtube.com') && !track.baseUrl.includes('googlevideo.com')) return null;
    const capResp = await fetch(track.baseUrl + '&fmt=json3', { headers: ytHeaders(cookies) });
    if (!capResp.ok) return null;
    const capData: any = await capResp.json();
    const text = eventsToText(capData.events ?? []);
    return text.length > 100 ? text : null;
  } catch { return null; }
}

// Strategy 3: Page scrape
async function fetchViaPageScrape(videoId: string, cookies?: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { ...ytHeaders(cookies), 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const match = html.match(/"captionTracks":\s*\[\{"baseUrl":"([^"]+)"/);
    if (!match) return null;
    const baseUrl = match[1].replace(/\\u0026/g, '&');
    if (!baseUrl.includes('youtube.com') && !baseUrl.includes('googlevideo.com')) return null;
    const capResp = await fetch(baseUrl + '&fmt=json3', { headers: ytHeaders(cookies) });
    if (!capResp.ok) return null;
    const capData: any = await capResp.json();
    const text = eventsToText(capData.events ?? []);
    return text.length > 100 ? text : null;
  } catch { return null; }
}

export async function fetchSubtitles(videoId: string, cookies?: string): Promise<string> {
  const strategies = [
    { name: 'timedtext', fn: () => fetchViaTimedtext(videoId, cookies) },
    { name: 'innertube', fn: () => fetchViaInnerTube(videoId, cookies) },
    { name: 'page-scrape', fn: () => fetchViaPageScrape(videoId, cookies) },
  ];
  const logs: string[] = [];
  for (const { name, fn } of strategies) {
    try {
      const result = await fn();
      if (result && result.length > 100) return result;
      logs.push(`${name}: no-tracks`);
    } catch (e: any) {
      logs.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(logs.join('; '));
}
