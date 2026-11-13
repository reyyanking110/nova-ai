import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './config.js';
import { AppError, db, result, type Context } from './core.js';
import { inServiceWindow } from './scheduling.js';
export function validSignature(
  body: Buffer,
  signature: string | undefined,
  secret = env.META_APP_SECRET,
) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
export async function graph(path: string, init: RequestInit = {}) {
  if (!env.WHATSAPP_ACCESS_TOKEN) throw new AppError(503, 'WhatsApp is not configured');
  const r = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, ...init.headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new AppError(502, `WhatsApp API request failed (${r.status})`);
  return r.json();
}
export async function sendText(phoneNumberId: string, to: string, text: string) {
  const ids: string[] = [];
  for (let i = 0; i < text.length; i += 4000) {
    const data = await graph(`${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'text',
        text: { body: text.slice(i, i + 4000) },
      }),
    });
    if (data.messages?.[0]?.id) ids.push(data.messages[0].id);
  }
  return ids;
}
export async function queueText(ctx: Context, text: string, key: string) {
  result(
    await db()
      .from('scheduled_jobs')
      .upsert(
        { user_id: ctx.userId, kind: 'outbound', unique_key: key, payload: { ...ctx, text } },
        { onConflict: 'unique_key', ignoreDuplicates: true },
      ),
  );
}
export async function sendTemplate(
  phoneNumberId: string,
  to: string,
  name: string,
  language: string,
  title: string,
) {
  return graph(`${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace('+', ''),
      type: 'template',
      template: {
        name,
        language: { code: language },
        components: [{ type: 'body', parameters: [{ type: 'text', text: title }] }],
      },
    }),
  });
}
export async function sendFile(ctx: Context, mediaId: string) {
  const contact = result(
    await db()
      .from('contacts')
      .select('last_inbound_at')
      .eq('id', ctx.contactId)
      .eq('user_id', ctx.userId)
      .eq('mode', ctx.mode)
      .single(),
  );
  if (!inServiceWindow(contact?.last_inbound_at))
    throw new AppError(409, 'File sending requires an active WhatsApp service window');
  const file = result(
    await db()
      .from('media_files')
      .select('*')
      .eq('id', mediaId)
      .eq('user_id', ctx.userId)
      .eq('mode', ctx.mode)
      .eq('approved', true)
      .single(),
  );
  const signed = result(
    await db().storage.from('nova-private').createSignedUrl(file.storage_path, 300),
  );
  const type = file.mime_type.startsWith('image/') ? 'image' : 'document';
  return graph(`${ctx.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: ctx.phone.replace('+', ''),
      type,
      [type]: { link: signed!.signedUrl, ...(type === 'document' ? { filename: file.name } : {}) },
    }),
  });
}
export async function sendVoice(ctx: Context, audio: Buffer) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'reply.mp3');
  const uploaded = await graph(`${ctx.phoneNumberId}/media`, { method: 'POST', body: form });
  return graph(`${ctx.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: ctx.phone.replace('+', ''),
      type: 'audio',
      audio: { id: uploaded.id },
    }),
  });
}
export async function downloadWhatsAppMedia(id: string) {
  if (!/^\d+$/.test(id)) throw new AppError(400, 'Invalid media ID');
  const meta = await graph(id);
  const url = new URL(meta.url);
  if (
    url.protocol !== 'https:' ||
    !(
      url.hostname === 'lookaside.fbsbx.com' ||
      url.hostname.endsWith('.fbcdn.net') ||
      url.hostname.endsWith('.facebook.com')
    )
  )
    throw new AppError(400, 'Untrusted media host');
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new AppError(502, 'Media download failed');
  const { readLimited } = await import('./media.js');
  return { buffer: await readLimited(r), mime: meta.mime_type as string };
}
