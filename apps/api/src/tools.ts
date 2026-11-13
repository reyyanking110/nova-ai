import { z } from 'zod';
import { createHash } from 'node:crypto';
import { toolSchemas, consequential, personalOnly, type ToolName } from '@nova/shared';
import { AppError, audit, db, result, scoped, type Context } from './core.js';
import { sendFile } from './whatsapp.js';
import { summarize } from './memory.js';
import { validateSchedule } from './scheduling.js';
export const toolDefinitions = Object.entries(toolSchemas).map(([name, schema]) => ({
  name,
  description:
    (
      {
        save_memory: 'Propose a fact to remember. Requires owner confirmation.',
        send_approved_file: 'Send an explicitly approved file. Requires confirmation.',
        generate_summary: 'Summarize this conversation only.',
      } as Record<string, string>
    )[name] ?? name.replaceAll('_', ' '),
  input_schema: jsonSchema(schema),
}));
function jsonSchema(schema: z.ZodTypeAny) {
  const json = z.toJSONSchema(schema);
  return { ...json, type: 'object' as const };
}
export async function toolAllowed(name: ToolName, ctx: Context) {
  if (ctx.mode === 'business' && personalOnly.has(name)) return false;
  const row = result(
    await db()
      .from('permissions')
      .select('*')
      .eq('user_id', ctx.userId)
      .eq('tool', name)
      .maybeSingle(),
  );
  // Business defaults to read-only FAQ/info/summary. File transmission is opt-in + confirmation.
  if (ctx.mode === 'business')
    return row
      ? row.enabled && row.business_enabled
      : ['search_faqs', 'business_info', 'generate_summary'].includes(name);
  return row ? row.enabled : true;
}
export async function executeTool(name: string, input: unknown, ctx: Context) {
  if (!(name in toolSchemas)) throw new AppError(400, 'Unknown tool');
  const tool = name as ToolName;
  if (!(await toolAllowed(tool, ctx))) return { error: 'Tool is not allowed in this context' };
  const parsed = toolSchemas[tool].parse(input);
  const pending = consequential.has(tool);
  const key = ctx.requestId
    ? createHash('sha256')
        .update(
          JSON.stringify([
            ctx.userId,
            ctx.mode,
            ctx.conversationId,
            ctx.requestId,
            tool,
            Object.fromEntries(Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b))),
          ]),
        )
        .digest('hex')
    : null;
  if (key) {
    const previous = result(
      await db()
        .from('tool_executions')
        .select('*')
        .eq('idempotency_key', key)
        .eq('user_id', ctx.userId)
        .maybeSingle(),
    );
    if (previous?.status === 'completed') return previous.result;
    if (previous?.status === 'pending_confirmation')
      return {
        confirmation_required: true,
        instruction: `Reply exactly CONFIRM ${previous.id} to approve ${tool}. This expires 10 minutes after the original request.`,
        input: parsed,
      };
    if (previous)
      return {
        error:
          'A prior attempt has an uncertain or failed outcome. Inspect Activity Logs before requesting this action again.',
      };
  }
  const execution = result(
    await db()
      .from('tool_executions')
      .insert({
        user_id: ctx.userId,
        mode: ctx.mode,
        conversation_id: ctx.conversationId,
        tool,
        input: parsed,
        idempotency_key: key,
        status: pending ? 'pending_confirmation' : 'running',
      })
      .select()
      .single(),
  );
  await audit(ctx.userId, 'tool.requested', { tool, execution_id: execution.id, mode: ctx.mode });
  if (pending)
    return {
      confirmation_required: true,
      instruction: `Reply exactly CONFIRM ${execution.id} to approve ${tool}. This expires in 10 minutes.`,
      input: parsed,
    };
  return runRecorded(execution, ctx);
}
export async function confirmTool(id: string, ctx: Context) {
  const e = result(
    await db()
      .from('tool_executions')
      .update({ status: 'running' })
      .eq('id', id)
      .eq('user_id', ctx.userId)
      .eq('mode', ctx.mode)
      .eq('conversation_id', ctx.conversationId)
      .eq('status', 'pending_confirmation')
      .gt('expires_at', new Date().toISOString())
      .select()
      .maybeSingle(),
  );
  if (!e) throw new AppError(400, 'Confirmation expired, already used, or not yours');
  if (!(await toolAllowed(e.tool, ctx))) throw new AppError(403, 'Tool permission was revoked');
  await audit(ctx.userId, 'tool.confirmed', { execution_id: id });
  return runRecorded(e, ctx);
}
async function runRecorded(e: Record<string, any>, ctx: Context) {
  try {
    const output = await dispatch(e.tool, e.input, ctx);
    result(
      await db()
        .from('tool_executions')
        .update({ status: 'completed', result: output ?? { ok: true } })
        .eq('id', e.id),
    );
    return output;
  } catch (error) {
    result(
      await db()
        .from('tool_executions')
        .update({ status: 'failed', result: { error: 'Tool execution failed' } })
        .eq('id', e.id),
    );
    throw error;
  }
}
async function dispatch(name: ToolName, input: any, ctx: Context): Promise<any> {
  const base = { user_id: ctx.userId, mode: ctx.mode };
  switch (name) {
    case 'create_task':
      return result(
        await db()
          .from('tasks')
          .insert({ ...base, title: input.title })
          .select()
          .single(),
      );
    case 'update_task': {
      const { id, ...fields } = input;
      return result(
        await db()
          .from('tasks')
          .update(fields)
          .eq('id', id)
          .eq('user_id', ctx.userId)
          .eq('mode', ctx.mode)
          .select()
          .single(),
      );
    }
    case 'complete_task':
      return result(
        await db()
          .from('tasks')
          .update({ status: 'completed' })
          .eq('id', input.id)
          .eq('user_id', ctx.userId)
          .eq('mode', ctx.mode)
          .select()
          .single(),
      );
    case 'delete_task':
      result(
        await db()
          .from('tasks')
          .delete()
          .eq('id', input.id)
          .eq('user_id', ctx.userId)
          .eq('mode', ctx.mode),
      );
      return { deleted: true };
    case 'save_note':
      return result(
        await db()
          .from('notes')
          .insert({ ...base, ...input })
          .select()
          .single(),
      );
    case 'search_notes':
      return result(
        await scoped('notes', ctx)
          .ilike('content', `%${input.query.replaceAll('%', '').replaceAll('_', '')}%`)
          .limit(10),
      );
    case 'save_memory':
      return result(
        await db()
          .from('memories')
          .insert({ ...base, ...input, approved: true })
          .select()
          .single(),
      );
    case 'create_reminder':
      validateSchedule(input);
      return result(
        await db()
          .from('reminders')
          .insert({ ...base, ...input, contact_id: ctx.contactId })
          .select()
          .single(),
      );
    case 'cancel_reminder':
      return result(
        await db()
          .from('reminders')
          .update({ status: 'cancelled' })
          .eq('id', input.id)
          .eq('user_id', ctx.userId)
          .eq('mode', ctx.mode)
          .select()
          .single(),
      );
    case 'search_faqs':
      return result(
        await db()
          .from('business_faqs')
          .select('question,answer')
          .eq('user_id', ctx.userId)
          .ilike('question', `%${input.query.replaceAll('%', '').replaceAll('_', '')}%`)
          .limit(10),
      );
    case 'business_info':
      return result(
        await db()
          .from('business_profiles')
          .select('name,description')
          .eq('user_id', ctx.userId)
          .maybeSingle(),
      );
    case 'send_approved_file':
      return sendFile(ctx, input.id);
    case 'generate_summary':
      return { summary: await summarize(ctx) };
  }
}
