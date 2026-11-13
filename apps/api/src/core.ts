import pino from 'pino';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './config.js';
export const log = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'apiKey',
      'secret',
      'access_token',
    ],
    censor: '[REDACTED]',
  },
});
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let client: SupabaseClient | undefined;
export function db() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    throw new AppError(503, 'Supabase is not configured. Follow the setup guide.');
  return (client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}
export function result<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new AppError(500, 'Database operation failed');
  return r.data;
}
export async function audit(userId: string, action: string, details: Record<string, unknown> = {}) {
  result(await db().from('audit_logs').insert({ user_id: userId, action, details }));
}
export type Context = {
  requestId?: string;
  userId: string;
  mode: 'personal' | 'business';
  contactId: string;
  conversationId: string;
  phone: string;
  phoneNumberId: string;
};
export function scoped(table: string, ctx: Context) {
  return db().from(table).select('*').eq('user_id', ctx.userId).eq('mode', ctx.mode);
}
