export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch { /* invalid url */ }
  return null;
}

// Strategy 1: youtube-transcript.ai free no-auth proxy
async function fetchViaTranscriptAI(videoId: string): Promise<string | null> {
  const url = `https://youtube-transcript.ai/transcript/${videoId}.txt`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; yt-article-gen/1.0)',
      'Accept': 'text/plain, */*',
    },
    redirect: 'follow',
  });
  if (!resp.ok) return null;
  const text = await resp.text();
  if (!text || text.trim().length < 50) return null;
  return text.trim();
}

// Helper: convert caption events to timestamped text
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

// Helper: fetch captions from a baseUrl
async function fetchCaptionsFromUrl(baseUrl: string): Promise<string | null> {
  const url = baseUrl.replace(/\u0026/g, '&') + '&fmt=json3';
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data: any = await resp.json();
  return eventsToText(data?.events ?? []) || null;
}

// Helper: get caption tracks via InnerTube API with given client config
async function fetchViaInnerTubeClient(
  videoId: string,
  clientName: string,
  clientVersion: string,
  extraBody: Record<string, any> = {},
  extraHeaders: Record<string, string> = {}
): Promise<string | null> {
  const body: any = {
    videoId,
    context: {
      client: {
        clientName,
        clientVersion,
        hl: 'en',
        gl: 'US',
        ...extraBody,
      },
    },
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extraHeaders,
  };
  const resp = await fetch(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    { method: 'POST', headers, body: JSON.stringify(body) }
  );
  if (!resp.ok) return null;
  const data: any = await resp.json();
  const tracks: any[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) return null;
  const track = tracks.find((t: any) => t.languageCode === 'en') ?? tracks[0];
  const baseUrl = track?.baseUrl;
  if (!baseUrl) return null;
  return fetchCaptionsFromUrl(baseUrl);
}

async function fetchViaTVHTML5(videoId: string): Promise<string | null> {
  return fetchViaInnerTubeClient(
    videoId,
    'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    '2.0',
    { embedUrl: 'https://www.youtube.com/' },
    { 'Origin': 'https://www.youtube.com' }
  );
}

async function fetchViaIOS(videoId: string): Promise<string | null> {
  return fetchViaInnerTubeClient(
    videoId,
    'IOS',
    '19.45.4',
    {
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.1.0.22B83',
    },
    {
      'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iPhone OS 18_1_0 like Mac OS X)',
      'X-Goog-Api-Format-Version': '2',
    }
  );
}

async function fetchViaANDROID(videoId: string): Promise<string | null> {
  return fetchViaInnerTubeClient(
    videoId,
    'ANDROID',
    '19.44.38',
    { androidSdkVersion: 30, osName: 'Android', osVersion: '11' },
    {
      'User-Agent': 'com.google.android.youtube/19.44.38(Linux; U; Android 11) gzip',
      'X-Goog-Api-Format-Version': '2',
    }
  );
}

async function fetchViaWEB(videoId: string): Promise<string | null> {
  return fetchViaInnerTubeClient(
    videoId,
    'WEB',
    '2.20231121.08.00',
    {},
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
    }
  );
}

// Strategy 2: scrape the watch page for captionTracks baseUrl
async function fetchViaPageScrape(videoId: string): Promise<string | null> {
  const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!resp.ok) return null;
  const html = await resp.text();
  // Extract captionTracks JSON from the page
  const match = html.match(/"captionTracks":(\[.*?\])/);
  if (!match) return null;
  try {
    const tracks: any[] = JSON.parse(match[1]);
    if (tracks.length === 0) return null;
    const track = tracks.find((t: any) => t.languageCode === 'en') ?? tracks[0];
    const baseUrl = track?.baseUrl;
    if (!baseUrl) return null;
    return fetchCaptionsFromUrl(baseUrl);
  } catch {
    return null;
  }
}

export async function fetchSubtitles(videoId: string): Promise<string> {
  const strategies = [
    { name: 'transcript-ai', fn: () => fetchViaTranscriptAI(videoId) },
    { name: 'page-scrape', fn: () => fetchViaPageScrape(videoId) },
    { name: 'tvhtml5', fn: () => fetchViaTVHTML5(videoId) },
    { name: 'ios', fn: () => fetchViaIOS(videoId) },
    { name: 'android', fn: () => fetchViaANDROID(videoId) },
    { name: 'web', fn: () => fetchViaWEB(videoId) },
  ];

  const errors: string[] = [];
  for (const { name, fn } of strategies) {
    try {
      const result = await fn();
      if (result && result.trim().length > 50) {
        console.log(`[subtitles] success via ${name}`);
        return result;
      }
      errors.push(`${name}: no-tracks`);
    } catch (e: any) {
      errors.push(`${name}: ${e.message ?? 'ERROR'}`);
    }
  }

  throw new Error(errors.join('; '));
}
