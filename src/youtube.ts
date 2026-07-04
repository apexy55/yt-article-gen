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

// Fetch subtitles using YouTube's InnerTube API (works from Cloudflare Workers)
export async function fetchSubtitles(videoId: string): Promise<string> {
  // Step 1: Call InnerTube API to get player data including caption tracks
  const innertube = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20240101.00.00',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'en',
          gl: 'US',
        },
      },
      videoId,
    }),
  });

  if (!innertube.ok) throw new Error(`InnerTube API failed: ${innertube.status}`);

  const playerData: any = await innertube.json();

  const tracks: any[] =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  if (!tracks.length) {
    // Try translation tracks as fallback
    const translationTracks: any[] =
      playerData?.captions?.playerCaptionsTracklistRenderer?.translationLanguages ?? [];
    if (!translationTracks.length) {
      throw new Error('No captions available for this video');
    }
  }

  // Priority: en manual > en auto-generated > any asr > first track
  const track =
    tracks.find((t: any) => t.languageCode?.startsWith('en') && !t.kind) ??
    tracks.find((t: any) => t.languageCode?.startsWith('en')) ??
    tracks.find((t: any) => t.kind === 'asr') ??
    tracks[0];

  if (!track) throw new Error('No caption track found');

  const baseUrl: string = track.baseUrl;
  const captionRes = await fetch(baseUrl + '&fmt=json3');
  if (!captionRes.ok) throw new Error(`Failed to fetch captions: ${captionRes.status}`);

  const captionData: any = await captionRes.json();
  const lines: string[] = [];

  for (const event of (captionData.events ?? [])) {
    if (!event.segs) continue;
    const text = event.segs.map((s: any) => s.utf8 ?? '').join('').trim();
    if (!text || text === '\n') continue;
    const secs = Math.floor((event.tStartMs ?? 0) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    lines.push(`[${m}:${s}] ${text}`);
  }

  if (!lines.length) throw new Error('Captions were empty for this video');
  return lines.join('\n');
}
