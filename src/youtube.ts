export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch { /* invalid url */ }
  return null;
}

// Strategy 1: Fetch YouTube page HTML and extract timedtext URL from captionTracks
async function fetchViaYouTubePage(videoId: string): Promise<string | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers });
  if (!pageResp.ok) return null;
  const html = await pageResp.text();

  // Extract captionTracks JSON from the page
  const match = html.match(/"captionTracks":\s*(\[.*?\])/);
  if (!match) return null;

  let tracks: any[];
  try {
    tracks = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!tracks.length) return null;

  // Prefer English, then auto-generated, then first available
  const preferred = tracks.find((t: any) => t.languageCode === 'en' && !t.kind)
    || tracks.find((t: any) => t.languageCode === 'en')
    || tracks[0];

  const baseUrl: string = preferred?.baseUrl;
  if (!baseUrl) return null;

  // Fetch the actual captions XML
  const captionResp = await fetch(baseUrl + '&fmt=json3', { headers });
  if (!captionResp.ok) return null;
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

  if (!lines.length) return null;
  return lines.join('\n');
}

// Strategy 2: InnerTube API (Android client - less IP restricted)
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
  if (!playerResp.ok) return null;
  const playerData: any = await playerResp.json();
  const tracks: any[] = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) return null;

  const preferred = tracks.find((t: any) => t.languageCode === 'en' && !t.kind)
    || tracks.find((t: any) => t.languageCode === 'en')
    || tracks[0];

  const baseUrl: string = preferred?.baseUrl;
  if (!baseUrl) return null;

  const captionResp = await fetch(baseUrl + '&fmt=json3');
  if (!captionResp.ok) return null;
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

  if (!lines.length) return null;
  return lines.join('\n');
}

// Strategy 3: kome.ai free transcript proxy
async function fetchViaKome(videoId: string): Promise<string | null> {
  const resp = await fetch(`https://kome.ai/api/tools/youtube-transcripts?video_id=${videoId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId, format: true }),
  });
  if (!resp.ok) return null;
  const data: any = await resp.json();
  const transcript: string = data?.transcript ?? '';
  if (!transcript.trim()) return null;
  return transcript;
}

// Strategy 4: youtube-transcript.io proxy
async function fetchViaYTTranscriptIO(videoId: string): Promise<string | null> {
  const resp = await fetch(`https://www.youtube-transcript.io/api/transcript?videoId=${videoId}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!resp.ok) return null;
  const data: any = await resp.json();
  const segments: any[] = data?.transcript ?? data ?? [];
  if (!Array.isArray(segments) || !segments.length) return null;
  return segments
    .map((s: any) => {
      const secs = Math.floor(s.offset ?? s.start ?? 0);
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const sec = String(secs % 60).padStart(2, '0');
      return `[${m}:${sec}] ${s.text ?? ''}`;
    })
    .join('\n');
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
  try {
    const result = await fetchViaYTTranscriptIO(videoId);
    if (result) return result;
    errors.push('yt-transcript-io: empty response');
  } catch (e: any) { errors.push(`yt-transcript-io: ${e.message}`); }
  throw new Error(`No captions available for this video. Attempts: ${errors.join('; ')}`);
}
