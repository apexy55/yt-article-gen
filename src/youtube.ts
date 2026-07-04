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

export async function fetchSubtitles(videoId: string): Promise<string> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(videoUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`YouTube fetch failed: ${res.status}`);
  const html = await res.text();

  // Extract ytInitialPlayerResponse
  const jsonMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/);
  if (!jsonMatch) throw new Error('Could not parse YouTube player response');

  let playerData: any;
  try { playerData = JSON.parse(jsonMatch[1]); } catch { throw new Error('Failed to parse player JSON'); }

  const tracks: any[] =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) throw new Error('No captions found for this video');

  const track = tracks.find((t: any) => t.languageCode?.startsWith('en')) ?? tracks[0];
  const baseUrl: string = track.baseUrl;

  const captionRes = await fetch(baseUrl + '&fmt=json3');
  if (!captionRes.ok) throw new Error('Failed to fetch captions');
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
  return lines.join('\n');
}
