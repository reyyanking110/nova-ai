import { AppError, audit, db, result, type Context } from './core.js';
import { respond } from './agent.js';
import { downloadWhatsAppMedia, queueText, sendText, sendTemplate, sendVoice } from './whatsapp.js';
import { extract, speech, storeMedia } from './media.js';
import { inServiceWindow, nextOccurrence } from './scheduling.js';
import { configured } from './config.js';
export async function resolveContext(
  phoneNumberId: string,
  phone: string,
  name = 'WhatsApp contact',
  inboundAt = new Date().toISOString(),
): Promise<Context> {
  const business = result(
    await db()
      .from('business_profiles')
      .select('*')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle(),
  );
  if (!business) throw new AppError(404, 'No business profile for this WhatsApp number');
  const profile = result(
    await db().from('profiles').select('*').eq('id', business.user_id).single(),
  );
  const mode = profile.owner_phone === phone ? 'personal' : 'business';
  const existing = result(
    await db()
      .from('contacts')
      .select('last_inbound_at')
      .eq('user_id', profile.id)
      .eq('phone', phone)
      .eq('mode', mode)
      .maybeSingle(),
  );
  const lastInbound = new Date(
    Math.max(
      Date.parse(existing?.last_inbound_at ?? '') || 0,
      Math.min(Date.now(), Date.parse(inboundAt) || Date.now()),
    ),
  ).toISOString();
  const contact = result(
    await db()
      .from('contacts')
      .upsert(
        { user_id: profile.id, phone, name, mode, last_inbound_at: lastInbound },
        { onConflict: 'user_id,phone,mode' },
      )
      .select()
      .single(),
  );
  const conversation = result(
    await db()
      .from('conversations')
      .upsert(
        {
          user_id: profile.id,
          contact_id: contact.id,
          mode,
          title: mode === 'personal' ? 'Private conversation' : name,
        },
        { onConflict: 'contact_id' },
      )
      .select()
      .single(),
  );
  return {
    userId: profile.id,
    mode,
    contactId: contact.id,
    conversationId: conversation.id,
    phone,
    phoneNumberId,
  };
}
export async function processWebhook(payload: any) {
  const { message, status, phoneNumberId, name } = payload;
  if (status) {
    result(
      await db()
        .from('messages')
        .update({ status: status.status })
        .contains('transport_ids', [status.id]),
    );
    if (status.status === 'delivered' || status.status === 'failed') {
      const messages = result(
        await db().from('messages').select('reminder_id').contains('transport_ids', [status.id]),
      );
      for (const m of messages ?? [])
        if (m.reminder_id)
          result(
            await db()
              .from('reminders')
              .update({ status: status.status })
              .eq('id', m.reminder_id)
              .eq('recurrence', 'none')
              .in('status', ['sent', 'failed']),
          );
    }
    return;
  }
  if (!message) return;
  const phone = `+${message.from}`;
  const ctx = await resolveContext(
    phoneNumberId,
    phone,
    name,
    new Date(Math.min(Date.now(), Number(message.timestamp) * 1000 || Date.now())).toISOString(),
  );
  ctx.requestId = message.id;
  const finished = result(
    await db()
      .from('scheduled_jobs')
      .select('id')
      .eq('unique_key', `nova:${message.id}`)
      .maybeSingle(),
  );
  if (finished) return;
  let text = typeof message.text?.body === 'string' ? message.text.body.slice(0, 50000) : undefined;
  let blocks: any[] = [];
  const kind = message.type;
  if (['audio', 'image', 'document'].includes(kind)) {
    const media = await downloadWhatsAppMedia(message[kind].id);
    const existingMedia = result(
      await db()
        .from('media_files')
        .select('*')
        .eq('user_id', ctx.userId)
        .eq('source_id', message.id)
        .maybeSingle(),
    );
    const file =
      existingMedia ??
      (await storeMedia(
        ctx.userId,
        ctx.mode,
        media.buffer,
        media.mime,
        message[kind].filename ?? `${kind}-${message.id}`,
        message.id,
      ));
    const extracted = await extract(media.buffer, media.mime);
    text = `${message[kind].caption ?? ''}\n${extracted.text}`;
    blocks = extracted.blocks;
    if (extracted.text)
      result(
        await db().from('media_files').update({ extracted_text: extracted.text }).eq('id', file.id),
      );
  }
  if (!text) {
    await queueText(
      ctx,
      'Please send text, a voice message, an image, or a supported PDF, DOCX or XLSX file.',
      `unsupported:${message.id}`,
    );
    return;
  }
  result(
    await db()
      .from('messages')
      .upsert(
        {
          user_id: ctx.userId,
          conversation_id: ctx.conversationId,
          mode: ctx.mode,
          role: 'user',
          content: text.slice(0, 50000),
          external_id: message.id,
        },
        { onConflict: 'external_id', ignoreDuplicates: true },
      ),
  );
  const reply = await respond(ctx, text, blocks);
  // Atomically persist the assistant response + outbound job before acknowledging completion.
  result(
    await db().rpc('persist_reply', {
      p_user: ctx.userId,
      p_conversation: ctx.conversationId,
      p_mode: ctx.mode,
      p_external: `nova:${message.id}`,
      p_content: reply,
      p_payload: { ...ctx, text: reply },
    }),
  );
  await audit(ctx.userId, 'message.processed', { mode: ctx.mode, message_id: message.id });
}
export async function processOutbound(payload: any, key: string) {
  const ctx = payload as Context;
  const contact = result(
    await db()
      .from('contacts')
      .select('*')
      .eq('id', ctx.contactId)
      .eq('user_id', ctx.userId)
      .single(),
  );
  if (ctx.mode === 'personal') {
    const p = result(
      await db().from('profiles').select('owner_phone').eq('id', ctx.userId).single(),
    );
    if (p?.owner_phone !== ctx.phone)
      throw new AppError(403, 'Owner number changed; personal delivery blocked');
  }
  if (!inServiceWindow(contact.last_inbound_at))
    throw new AppError(409, 'Customer-service window expired; use an approved template');
  const ids = await sendText(ctx.phoneNumberId, ctx.phone, payload.text);
  result(
    await db().from('messages').upsert(
      {
        user_id: ctx.userId,
        conversation_id: ctx.conversationId,
        mode: ctx.mode,
        role: 'assistant',
        content: payload.text,
        external_id: key,
        transport_ids: ids,
        status: 'sent',
      },
      { onConflict: 'external_id' },
    ),
  );
  const settings = result(
    await db().from('ai_settings').select('voice_replies').eq('user_id', ctx.userId).maybeSingle(),
  );
  if (settings?.voice_replies && configured().speech) {
    // Voice is supplementary: never retry a successfully sent text just because TTS fails.
    try {
      await sendVoice(ctx, await speech(payload.text));
    } catch {
      await audit(ctx.userId, 'voice.failed', { job: key });
    }
  }
}
export async function processReminder(payload: any) {
  const reminder = result(
    await db().from('reminders').select('*').eq('id', payload.reminder_id).single(),
  );
  if (reminder.status !== 'scheduled') return;
  const contact = result(
    await db()
      .from('contacts')
      .select('*')
      .eq('id', reminder.contact_id)
      .eq('user_id', reminder.user_id)
      .single(),
  );
  const business = result(
    await db().from('business_profiles').select('*').eq('user_id', reminder.user_id).single(),
  );
  if (reminder.mode === 'personal') {
    const p = result(
      await db().from('profiles').select('owner_phone').eq('id', reminder.user_id).single(),
    );
    if (p?.owner_phone !== contact.phone)
      throw new AppError(403, 'Personal reminder recipient is no longer the verified owner');
  }
  let ids: string[] = [];
  if (inServiceWindow(contact.last_inbound_at))
    ids = await sendText(business.phone_number_id, contact.phone, `Reminder: ${reminder.title}`);
  else {
    if (!business.reminder_template)
      throw new AppError(409, 'Outside 24-hour window: no approved reminder template configured');
    const sent = await sendTemplate(
      business.phone_number_id,
      contact.phone,
      business.reminder_template,
      business.template_language,
      reminder.title,
    );
    ids = (sent.messages ?? []).map((m: any) => m.id);
  }
  const c = result(
    await db()
      .from('conversations')
      .upsert(
        {
          user_id: reminder.user_id,
          contact_id: contact.id,
          mode: reminder.mode,
          title: contact.name,
        },
        { onConflict: 'contact_id' },
      )
      .select()
      .single(),
  );
  result(
    await db()
      .from('messages')
      .upsert(
        {
          user_id: reminder.user_id,
          conversation_id: c.id,
          mode: reminder.mode,
          role: 'assistant',
          content: `Reminder: ${reminder.title}`,
          reminder_id: reminder.id,
          external_id: `reminder:${reminder.id}:${reminder.due_at}`,
          transport_ids: ids,
          status: 'sent',
        },
        { onConflict: 'external_id' },
      ),
  );
  const next = nextOccurrence(reminder.due_at, reminder.timezone, reminder.recurrence);
  result(
    await db()
      .from('reminders')
      .update({
        status: next ? 'scheduled' : 'sent',
        ...(next ? { due_at: next } : {}),
        last_delivered_at: new Date().toISOString(),
      })
      .eq('id', reminder.id)
      .eq('status', 'scheduled'),
  );
  await audit(reminder.user_id, 'reminder.sent', { reminder_id: reminder.id });
}

export async function notifyWebhookFailure(payload: any, userId: string) {
  if (!payload.message?.from) return;
  const profile = result(
    await db().from('profiles').select('owner_phone').eq('id', userId).single(),
  );
  const phone = `+${payload.message.from}`;
  const mode = profile?.owner_phone === phone ? 'personal' : 'business';
  const contact = result(
    await db()
      .from('contacts')
      .select('id,last_inbound_at')
      .eq('user_id', userId)
      .eq('phone', phone)
      .eq('mode', mode)
      .maybeSingle(),
  );
  if (!contact || !inServiceWindow(contact.last_inbound_at)) return;
  const c = result(
    await db()
      .from('conversations')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('user_id', userId)
      .single(),
  );
  if (!c) return;
  await queueText(
    {
      userId,
      mode,
      contactId: contact.id,
      conversationId: c.id,
      phone,
      phoneNumberId: payload.phoneNumberId,
    },
    'Sorry, I could not finish processing that message after several attempts. Please try a smaller file or send your request as text. The workspace owner can inspect the failed job in Activity Logs.',
    `failure:${payload.message.id}`,
  );
}
