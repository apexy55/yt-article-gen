export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch { /* invalid url */ }
  return null;
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

function pickTrack(tracks: any[]): any | null {
  return (
    tracks.find((t: any) => t.languageCode?.startsWith('en') && !t.kind) ??
    tracks.find((t: any) => t.languageCode?.startsWith('en')) ??
    tracks.find((t: any) => t.kind === 'asr') ??
    tracks[0] ?? null
  );
}

async function tryInnerTubeClient(
  videoId: string,
  clientName: string,
  clientVersion: string,
  clientId: string,
  userAgent: string
): Promise<string | null> {
  const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      'X-YouTube-Client-Name': clientId,
      'X-YouTube-Client-Version': clientVersion,
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName,
          clientVersion,
          hl: 'en',
          gl: 'US',
          visitorData: '',
        },
        request: { useSsl: true },
        user: { lockedSafetyMode: false },
      },
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          signatureTimestamp: 19950,
          html5Preference: 'HTML5_PREF_WANTS',
        },
      },
      racyCheckOk: true,
      contentCheckOk: true,
    }),
  });

  if (!resp.ok) return null;
  const data: any = await resp.json();
  const tracks: any[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) return null;
  const track = pickTrack(tracks);
  if (!track?.baseUrl) return null;
  const lines = await captionLinesFromUrl(track.baseUrl);
  return lines.length ? lines.join('\n') : null;
}

export async function fetchSubtitles(videoId: string): Promise<string> {
  const clients: Array<[string, string, string, string]> = [
    // [clientName, clientVersion, clientId, userAgent]
    [
      'TVHTML5_SIMPLY_EMBEDDED_PLAYER', '2.0',
      '85',
      'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
    ],
    [
      'WEB_EMBEDDED_PLAYER', '2.20240101.00.00',
      '56',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    ],
    [
      'WEB_CREATOR', '1.20240101.00.00',
      '62',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    ],
    [
      'WEB', '2.20240101.00.00',
      '1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    ],
  ];

  const errors: string[] = [];
  for (const [name, version, id, ua] of clients) {
    try {
      const result = await tryInnerTubeClient(videoId, name, version, id, ua);
      if (result) return result;
      errors.push(`${name}: no tracks`);
    } catch (e: any) {
      errors.push(`${name}: ${e.message}`);
    }
  }

  throw new Error(`No captions available. Attempts: ${errors.join('; ')}`);
}
