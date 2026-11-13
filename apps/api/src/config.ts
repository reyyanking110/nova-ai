import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
import { z } from 'zod';
const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  SUPABASE_URL: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  SUPABASE_ANON_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-5'),
  META_APP_SECRET: optional,
  WHATSAPP_VERIFY_TOKEN: optional,
  WHATSAPP_ACCESS_TOKEN: optional,
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v23.0'),
  STT_URL: optional,
  STT_API_KEY: optional,
  STT_MODEL: z.string().default('whisper-1'),
  TTS_URL: optional,
  TTS_API_KEY: optional,
  TTS_MODEL: z.string().default('tts-1'),
  TTS_VOICE: z.string().default('alloy'),
  LOG_LEVEL: z.string().default('info'),
});
export const env = schema.parse(process.env);
export const configured = () => ({
  database: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
  claude: !!env.ANTHROPIC_API_KEY,
  whatsapp: !!(env.WHATSAPP_ACCESS_TOKEN && env.META_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN),
  transcription: !!(env.STT_URL && env.STT_API_KEY),
  speech: !!(env.TTS_URL && env.TTS_API_KEY),
});
