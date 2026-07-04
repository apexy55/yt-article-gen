 vc bfexport function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch {
    // invalid url
  }
  return null;
}

// Helper: call InnerTube /player with a given client config
async function innertubePlayer(videoId: string, client: { clientName: string; clientVersion: string; androidSdkVersion?: number }): Promise<any> {
  const body: any = {
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        hl: 'en',
        gl: 'US',
        ...(client.androidSdkVersion ? { androidSdkVersion: client.androidSdkVersion } : {}),
      },
    },
    videoId,
    racyCheckOk: true,
    contentCheckOk: true,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (client.clientName === 'ANDROID') {
    headers['User-Agent'] = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip';
    headers['X-YouTube-Client-Name'] = '3';
    headers['X-YouTube-Client-Version'] = client.clientVersion;
  } else if (client.clientName === 'TVHTML5') {
    headers['User-Agent'] = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1';
    headers['X-YouTube-Client-Name'] = '7';
    headers['X-YouTube-Client-Version'] = client.clientVersion;
  } else {
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    headers['X-YouTube-Client-Name'] = '1';
    headers['X-YouTube-Client-Version'] = client.clientVersion;
  }

  const resp = await fetch(
    'https://www.youtube.com/youtubei/v1/player',
    { method: 'POST', headers, body: JSON.stringify(body) }
  );
  if (!resp.ok) throw new Error(`InnerTube ${client.clientName} failed: ${resp.status}`);
  return resp.json();
}

// Parse caption lines from json3 caption data
async function fetchCaptionLines(baseUrl: string): Promise<string[]> {
  const res = await fetch(baseUrl + '&fmt=json3');
  if (!res.ok) throw new Error(`Caption fetch failed: ${res.status}`);
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

export async function fetchSubtitles(videoId: string): Promise<string> {
  // Try multiple clients in order of reliability for server-side requests
  const clients = [
    { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30 },
    { clientName: 'TVHTML5', clientVersion: '7.20240101.00.00' },
    { clientName: 'WEB', clientVersion: '2.20240101.00.00' },
  ];

  let lastError = '';

  for (const client of clients) {
    try {
      const playerData = await innertubePlayer(videoId, client);

      const tracks: any[] =
        playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

      if (!tracks.length) {
        lastError = `No captions in ${client.clientName} response`;
        continue;
      }

      // Priority: en manual > en auto > any asr > first
      const track =
        tracks.find((t: any) => t.languageCode?.startsWith('en') && !t.kind) ??
        tracks.find((t: any) => t.languageCode?.startsWith('en')) ??
        tracks.find((t: any) => t.kind === 'asr') ??
        tracks[0];

      if (!track?.baseUrl) {
        lastError = `No valid track URL from ${client.clientName}`;
        continue;
      }

      const lines = await fetchCaptionLines(track.baseUrl);
      if (!lines.length) {
        lastError = `Empty captions from ${client.clientName}`;
        continue;
      }

      return lines.join('\n');
    } catch (e: any) {
      lastError = e.message;
    }
  }

  throw new Error(lastError || 'No captions available for this video');
}
