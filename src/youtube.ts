export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch {
    // invalid url
  }
  return null;
}

// Call InnerTube /player with a given client
async function innertubePlayer(videoId: string, clientName: string, clientVersion: string, extra: Record<string, string> = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extra,
  };

  const body = JSON.stringify({
    context: {
      client: { clientName, clientVersion, hl: 'en', gl: 'US' },
    },
    videoId,
    racyCheckOk: true,
    contentCheckOk: true,
  });

  const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST', headers, body,
  });
  if (!resp.ok) throw new Error(`${clientName} HTTP ${resp.status}`);
  return resp.json();
}

// Parse json3 caption events into timestamped lines
async function captionLinesFromUrl(baseUrl: string): Promise<string[]> {
  const res = await fetch(baseUrl + '&fmt=json3');
  if (!res.ok) throw new Error(`Caption HTTP ${res.status}`);
  const data: any = await res.json();
  const lines: string[] = [];
  for (const event of (data.events ?? [])) {
    if (!event.segs) continue;
    const text = event.segs.map((s: any) => s.utf8 ?? '').join('').trim();
    if (!text || text === '\n') continue;
    const secs = Math.floor((event.tStartMs ?? 0) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    lines.push(`[${m}:${s}] ${text}`);
  }
  return lines;
}

// Pick best caption track: en manual > en auto > any asr > first
function pickTrack(tracks: any[]): any | null {
  return (
    tracks.find((t: any) => t.languageCode?.startsWith('en') && !t.kind) ??
    tracks.find((t: any) => t.languageCode?.startsWith('en')) ??
    tracks.find((t: any) => t.kind === 'asr') ??
    tracks[0] ??
    null
  );
}

export async function fetchSubtitles(videoId: string): Promise<string> {
  const errors: string[] = [];

  // Strategy 1: IOS client (most permissive for server-side)
  try {
    const data = await innertubePlayer(videoId, 'IOS', '19.09.3', {
      'User-Agent': 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
      'X-YouTube-Client-Name': '5',
      'X-YouTube-Client-Version': '19.09.3',
    });
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = pickTrack(tracks);
    if (track?.baseUrl) {
      const lines = await captionLinesFromUrl(track.baseUrl);
      if (lines.length) return lines.join('\n');
      errors.push('IOS: empty captions');
    } else {
      errors.push(`IOS: no tracks (${tracks.length} total)`);
    }
  } catch (e: any) { errors.push(`IOS: ${e.message}`); }

  // Strategy 2: ANDROID client
  try {
    const data = await innertubePlayer(videoId, 'ANDROID', '19.09.37', {
      'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': '19.09.37',
    });
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = pickTrack(tracks);
    if (track?.baseUrl) {
      const lines = await captionLinesFromUrl(track.baseUrl);
      if (lines.length) return lines.join('\n');
      errors.push('ANDROID: empty captions');
    } else {
      errors.push(`ANDROID: no tracks (${tracks.length} total)`);
    }
  } catch (e: any) { errors.push(`ANDROID: ${e.message}`); }

  // Strategy 3: TVHTML5 client
  try {
    const data = await innertubePlayer(videoId, 'TVHTML5', '7.20240101.00.00', {
      'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
      'X-YouTube-Client-Name': '7',
      'X-YouTube-Client-Version': '7.20240101.00.00',
    });
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = pickTrack(tracks);
    if (track?.baseUrl) {
      const lines = await captionLinesFromUrl(track.baseUrl);
      if (lines.length) return lines.join('\n');
      errors.push('TVHTML5: empty captions');
    } else {
      errors.push(`TVHTML5: no tracks`);
    }
  } catch (e: any) { errors.push(`TVHTML5: ${e.message}`); }

  // Strategy 4: Direct timedtext API (no player needed)
  try {
    const timedtextUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`;
    const res = await fetch(timedtextUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (res.ok) {
      const data: any = await res.json();
      if (data?.events?.length) {
        const lines = await captionLinesFromUrl(timedtextUrl.replace('&fmt=json3', ''));
        if (lines.length) return lines.join('\n');
      }
    }
    errors.push('timedtext: no captions');
  } catch (e: any) { errors.push(`timedtext: ${e.message}`); }

  throw new Error(`No captions available for this video. Attempts: ${errors.join('; ')}`);
}
