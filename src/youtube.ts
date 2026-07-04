export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch { /* invalid url */ }
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

// Helper: fetch captions from a baseUrl
async function fetchCaptionsFromUrl(baseUrl: string): Promise<string | null> {
  const url = baseUrl.replace(/\\u0026/g, '&') + '&fmt=json3';
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
  apiKey: string,
  userAgent: string,
  clientNameNum: string,
  extraClientFields?: Record<string, unknown>
): Promise<string | null> {
  const resp = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        'X-YouTube-Client-Name': clientNameNum,
        'X-YouTube-Client-Version': clientVersion,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName,
            clientVersion,
            hl: 'en',
            ...extraClientFields,
          },
        },
        videoId,
      }),
    }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data: any = await resp.json();
  const tracks: any[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) {
    const status = data?.playabilityStatus?.status ?? 'unknown';
    const reason = data?.playabilityStatus?.reason ?? '';
    throw new Error(`no-tracks: ${status}${reason ? ' - ' + reason.slice(0, 80) : ''}`);
  }
  const preferred = tracks.find((t: any) => t.languageCode === 'en' && !t.kind)
    || tracks.find((t: any) => t.languageCode === 'en')
    || tracks[0];
  const text = await fetchCaptionsFromUrl(preferred.baseUrl);
  if (!text) throw new Error('no-caption-events');
  return text;
}

// Strategy 1: TVHTML5 Simply Embedded Player (often bypasses restrictions)
async function fetchViaTVHTML5(videoId: string): Promise<string | null> {
  return fetchViaInnerTubeClient(
    videoId,
    'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    '2.0',
    'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1',
    '85',
    { thirdParty: { embedUrl: 'https://www.youtube.com/' } }
  );
}

// Strategy 2: iOS client
async function fetchViaIOS(videoId: string): Promise<string | null> {
  return fetchViaInnerTubeClient(
    videoId,
    'IOS',
    '19.09.3',
    'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    'com.google.ios.youtube/19.09.3 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
    '5',
    { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '17.5.1.21F90' }
  );
}

// Strategy 3: WEB client with public key
async function fetchViaWEB(videoId: string): Promise<string | null> {
  return fetchViaInnerTubeClient(
    videoId,
    'WEB',
    '2.20240101.00.00',
    'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '1'
  );
}

// Strategy 4: ANDROID client
async function fetchViaANDROID(videoId: string): Promise<string | null> {
  return fetchViaInnerTubeClient(
    videoId,
    'ANDROID',
    '19.09.37',
    'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
    '3',
    { androidSdkVersion: 30 }
  );
}

export async function fetchSubtitles(videoId: string): Promise<string> {
  const errors: string[] = [];
  const strategies = [
    { name: 'tvhtml5', fn: () => fetchViaTVHTML5(videoId) },
    { name: 'ios', fn: () => fetchViaIOS(videoId) },
    { name: 'android', fn: () => fetchViaANDROID(videoId) },
    { name: 'web', fn: () => fetchViaWEB(videoId) },
  ];
  for (const { name, fn } of strategies) {
    try {
      const result = await fn();
      if (result) return result;
      errors.push(`${name}: empty`);
    } catch (e: any) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`No captions available for this video. Attempts: ${errors.join('; ')}`);
}
