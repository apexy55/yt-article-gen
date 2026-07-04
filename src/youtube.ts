export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch { /* invalid url */ }
  return null;
}

// Helper: bracket-balanced extraction of an array starting at given position
function extractBalancedArray(html: string, startIdx: number): any[] | null {
  let depth = 0;
  let i = startIdx;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  try {
    return JSON.parse(html.slice(startIdx, i + 1));
  } catch {
    return null;
  }
}

// Helper: find captionTracks in YouTube page HTML
function extractTracksFromHtml(html: string): any[] | null {
  // Find all occurrences of captionTracks and try each
  let searchFrom = 0;
  while (true) {
    const ctIdx = html.indexOf('"captionTracks"', searchFrom);
    if (ctIdx === -1) break;
    const arrStart = html.indexOf('[', ctIdx);
    if (arrStart === -1) break;
    const tracks = extractBalancedArray(html, arrStart);
    if (tracks && Array.isArray(tracks) && tracks.length > 0 && tracks[0]?.baseUrl) {
      return tracks;
    }
    searchFrom = ctIdx + 1;
  }
  return null;
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

// Strategy 1: Fetch YouTube page HTML and extract caption track URLs
async function fetchViaYouTubePage(videoId: string): Promise<string | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Cookie': 'CONSENT=YES+cb.20210328-17-0; YSC=DwKYllHNwuw',
  };
  const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { headers });
  if (!pageResp.ok) throw new Error(`HTTP ${pageResp.status}`);
  const html = await pageResp.text();

  const hasPlayer = html.includes('ytInitialPlayerResponse');
  const hasCaptions = html.includes('captionTracks');

  if (!hasCaptions) {
    throw new Error(`no-captions-in-html: hasPlayer=${hasPlayer}, len=${html.length}`);
  }

  const tracks = extractTracksFromHtml(html);
  if (!tracks || !tracks.length) {
    throw new Error(`tracks-parse-failed: hasPlayer=${hasPlayer}, hasCaptions=${hasCaptions}`);
  }

  // Prefer English manual, then English auto, then first
  const preferred = tracks.find((t: any) => t.languageCode === 'en' && !t.kind)
    || tracks.find((t: any) => t.languageCode === 'en')
    || tracks[0];

  let baseUrl: string = preferred?.baseUrl ?? '';
  if (!baseUrl) throw new Error('no-baseUrl in track');
  // Decode \u0026 -> &
  baseUrl = baseUrl.replace(/\\u0026/g, '&');

  const captionResp = await fetch(baseUrl + '&fmt=json3', { headers });
  if (!captionResp.ok) throw new Error(`caption-HTTP ${captionResp.status}`);
  const captionData: any = await captionResp.json();

  const text = eventsToText(captionData?.events ?? []);
  if (!text) throw new Error('no-caption-events');
  return text;
}

// Strategy 2: InnerTube WEB client (standard public API key)
async function fetchViaInnerTube(videoId: string): Promise<string | null> {
  // Use the same API key as the YouTube web client
  const playerResp = await fetch(
    'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240101.00.00',
        'Origin': 'https://www.youtube.com',
        'Cookie': 'CONSENT=YES+cb.20210328-17-0',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'en',
          },
        },
        videoId,
      }),
    }
  );
  if (!playerResp.ok) throw new Error(`HTTP ${playerResp.status}`);
  const playerData: any = await playerResp.json();
  const tracks: any[] = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) {
    const status = playerData?.playabilityStatus?.status ?? 'unknown';
    throw new Error(`no-tracks: playabilityStatus=${status}`);
  }

  const preferred = tracks.find((t: any) => t.languageCode === 'en' && !t.kind)
    || tracks.find((t: any) => t.languageCode === 'en')
    || tracks[0];

  let baseUrl: string = preferred?.baseUrl ?? '';
  if (!baseUrl) throw new Error('no-baseUrl in track');
  baseUrl = baseUrl.replace(/\\u0026/g, '&');

  const captionResp = await fetch(baseUrl + '&fmt=json3');
  if (!captionResp.ok) throw new Error(`caption-HTTP ${captionResp.status}`);
  const captionData: any = await captionResp.json();

  const text = eventsToText(captionData?.events ?? []);
  if (!text) throw new Error('no-caption-events');
  return text;
}

// Strategy 3: kome.ai free transcript proxy
async function fetchViaKome(videoId: string): Promise<string | null> {
  const resp = await fetch(`https://kome.ai/api/tools/youtube-transcripts?video_id=${videoId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId, format: true }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data: any = await resp.json();
  const transcript: string = data?.transcript ?? '';
  if (!transcript.trim()) throw new Error('empty transcript');
  return transcript;
}

export async function fetchSubtitles(videoId: string): Promise<string> {
  const errors: string[] = [];
  try {
    const result = await fetchViaYouTubePage(videoId);
    if (result) return result;
    errors.push('ytpage: empty');
  } catch (e: any) { errors.push(`ytpage: ${e.message}`); }
  try {
    const result = await fetchViaInnerTube(videoId);
    if (result) return result;
    errors.push('innertube: empty');
  } catch (e: any) { errors.push(`innertube: ${e.message}`); }
  try {
    const result = await fetchViaKome(videoId);
    if (result) return result;
    errors.push('kome: empty');
  } catch (e: any) { errors.push(`kome: ${e.message}`); }
  throw new Error(`No captions available for this video. Attempts: ${errors.join('; ')}`);
}
