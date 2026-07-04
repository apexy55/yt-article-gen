export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
  } catch { /* invalid url */ }
  return null;
}

// Strategy 1: kome.ai free transcript proxy
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

// Strategy 2: Tactiq free transcript API
async function fetchViaTactiq(videoId: string): Promise<string | null> {
  const resp = await fetch('https://tactiq-apps-prod.tactiq.io/transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoUrl: `https://www.youtube.com/watch?v=${videoId}`, langCode: 'en' }),
  });
  if (!resp.ok) return null;
  const data: any = await resp.json();
  const segments: any[] = data?.captions ?? [];
  if (!segments.length) return null;
  return segments
    .map((s: any) => {
      const secs = Math.floor((s.start ?? 0));
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const sec = String(secs % 60).padStart(2, '0');
      return `[${m}:${sec}] ${s.text ?? ''}`;
    })
    .join('\n');
}

// Strategy 3: yt.lemnoslife.com unofficial API
async function fetchViaLemnoslife(videoId: string): Promise<string | null> {
  const resp = await fetch(`https://yt.lemnoslife.com/videos?part=transcript&id=${videoId}`);
  if (!resp.ok) return null;
  const data: any = await resp.json();
  const items: any[] = data?.items ?? [];
  if (!items.length) return null;
  const segments: any[] = items[0]?.transcript?.transcriptCues ?? [];
  if (!segments.length) return null;
  return segments
    .map((s: any) => {
      const secs = Math.floor((s.cueOffsetMs ?? 0) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const sec = String(secs % 60).padStart(2, '0');
      return `[${m}:${sec}] ${s.cueText ?? ''}`;
    })
    .join('\n');
}

export async function fetchSubtitles(videoId: string): Promise<string> {
  const errors: string[] = [];

  try {
    const result = await fetchViaKome(videoId);
    if (result) return result;
    errors.push('kome: empty response');
  } catch (e: any) { errors.push(`kome: ${e.message}`); }

  try {
    const result = await fetchViaTactiq(videoId);
    if (result) return result;
    errors.push('tactiq: empty response');
  } catch (e: any) { errors.push(`tactiq: ${e.message}`); }

  try {
    const result = await fetchViaLemnoslife(videoId);
    if (result) return result;
    errors.push('lemnoslife: empty response');
  } catch (e: any) { errors.push(`lemnoslife: ${e.message}`); }

  throw new Error(`No captions available for this video. Attempts: ${errors.join('; ')}`);
}
