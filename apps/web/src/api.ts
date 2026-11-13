import { createClient, type Session } from '@supabase/supabase-js';
const config = import.meta.env;
export const supabase =
  config.VITE_SUPABASE_URL && config.VITE_SUPABASE_ANON_KEY
    ? createClient(config.VITE_SUPABASE_URL, config.VITE_SUPABASE_ANON_KEY)
    : null;
export let session: Session | null = null;
export function setSession(next: Session | null) {
  session = next;
}
export async function api(path: string, init: RequestInit = {}) {
  if (!session)
    throw new Error('Connect Supabase and sign in to use live data. See README for setup.');
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${session.access_token}`,
      ...init.headers,
    },
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error +
        (data.fields
          ? `: ${data.fields.map((x: any) => `${x.path}: ${x.message}`).join(', ')}`
          : ''),
    );
  return data;
}
export async function streamReply(id: string, text: string, update: (text: string) => void) {
  if (!session) throw new Error('Sign in first');
  const response = await fetch(`/api/conversations/${id}/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error((await response.json()).error);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = '',
    answer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split('\n\n');
    pending = frames.pop()!;
    for (const frame of frames) {
      if (!frame.startsWith('data: ')) continue;
      const data = JSON.parse(frame.slice(6));
      if (data.error) throw new Error(data.error);
      if (data.delta) answer += data.delta;
      if (data.answer) answer = data.answer;
      update(answer);
    }
  }
}
