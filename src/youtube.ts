export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch { /* invalid url */ }
  return null;
}

// Helper: extract caption tracks from YouTube page HTML using bracket-balanced parsing
function extractTracksFromHtml(html: string): any[] | null {
  // Try ytInitialPlayerResponse first (grab large JSON blob)
  const prIdx = html.indexOf('ytInitialPlayerResponse');
  if (prIdx !== -1) {
    const braceStart = html.indexOf('{', prIdx);
    if (braceStart !== -1) {
      let depth = 0;
      let i = braceStart;
      for (; i < Math.min(html.length, braceStart + 2000000); i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      try {
        const playerData = JSON.parse(html.slice(braceStart, i + 1));
        const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks?.length) return tracks;
      } catch { /* ignore, try fallback */ }
    }
  }
  // Fallback: find captionTracks array
  const ctIdx = html.indexOf('"captionTracks"');
  if (ctIdx === -1) return null;
  const arrStart = html.indexOf('[', ctIdx);
  if (arrStart === -1) return null;
  let depth = 0;
  let i = arrStart;
  for (; i < html.length; i++) {
    if (html[i] === '[' || html[i] === '{') depth++;
    else if (html[i] === ']' || html[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  try {
    return JSON.parse(html.slice(arrStart, i + 1));
  } catch {
    return null;
  }
}

// Strategy 1: Fetch YouTube page HTML (with consent cookie bypass)
async function fetchViaYouTubePage(videoId: string): Promise<string | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Cookie': 'CONSENT=YES+cb; YSC=DwKYllHNwuw; VISITOR_INFO1_LIVE=oKckVSqvaGw',
  };
  const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { headers });
  if (!pageResp.ok) throw new Error(`HTTP ${pageResp.status}`);
  const html = await pageResp.text();

  // Check if we got a consent page
  if (html.includes('consent.youtube.com') && !html.includes('ytInitialPlayerResponse')) {
    throw new Error('consent-page: YouTube requires consent');
  }

  const tracks = extractTracksFromHtml(html);
  if (!tracks || !tracks.length) {
    // Include diagnostic info in error
    const hasPlayer = html.includes('ytInitialPlayerResponse');
    const hasCaptions = html.includes('captionTracks');
    throw new Error(`no-tracks: hasPlayer=${hasPlayer}, hasCaptions=${hasCaptions}, htmlLen=${html.length}`);
  }

  const preferred = tracks.find((t: any) => t.languageCode === 'en' && !t.kind)
    || tracks.find((t: any) => t.languageCode === 'en')
    || tracks[0];

  let baseUrl: string = preferred?.baseUrl ?? '';
  if (!baseUrl) throw new Error('no-baseUrl in track');
  baseUrl = baseUrl.replace(/\\u0026/g, '&');

  const captionResp = await fetch(baseUrl + '&fmt=json3', { headers });
  if (!captionResp.ok) throw new Error(`caption HTTP ${captionResp.status}`);
  const captionData: any = await captionResp.json();

  const events: any[] = captionData?.events ?? [];
  const lines = events
    .filter((e: any) => e.segs)
    .map((e: any) => {
      const secs = Math.floor((e.tStartMs ?? 0) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      const text = e.segs.map((seg: any) => seg.utf8 ?? '').join('').trim();
      return text ? `[${m}:${s}] ${text}` : null;
    })
    .filter(Boolean);

  if (!lines.length) throw new Error('no caption events in json3');
  return lines.join('\n');
}

// Strategy 2: InnerTube API (Android client)
async function fetchViaInnerTube(videoId: string): Promise<string | null> {
  const playerResp = await fetch(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '19.09.37',
        'Cookie': 'CONSENT=YES+cb',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
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
  if (!captionResp.ok) throw new Error(`caption HTTP ${captionResp.status}`);
  const captionData: any = await captionResp.json();

  const events: any[] = captionData?.events ?? [];
  const lines = events
    .filter((e: any) => e.segs)
    .map((e: any) => {
      const secs = Math.floor((e.tStartMs ?? 0) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      const text = e.segs.map((seg: any) => seg.utf8 ?? '').join('').trim();
      return text ? `[${m}:${s}] ${text}` : null;
    })
    .filter(Boolean);

  if (!lines.length) throw new Error('no caption events in json3');
  return lines.join('\n');
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
    errors.push('ytpage: empty response');
  } catch (e: any) { errors.push(`ytpage: ${e.message}`); }
  try {
    const result = await fetchViaInnerTube(videoId);
    if (result) return result;
    errors.push('innertube: empty response');
  } catch (e: any) { errors.push(`innertube: ${e.message}`); }
  try {
    const result = await fetchViaKome(videoId);
    if (result) return result;
    errors.push('kome: empty response');
  } catch (e: any) { errors.push(`kome: ${e.message}`); }
  throw new Error(`No captions available for this video. Attempts: ${errors.join('; ')}`);
}
