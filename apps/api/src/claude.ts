import Anthropic from '@anthropic-ai/sdk';
import { env } from './config.js';
import { AppError } from './core.js';
let client: Anthropic | undefined;
export function claude() {
  if (!env.ANTHROPIC_API_KEY) throw new AppError(503, 'Claude is not configured');
  return (client ??= new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: 60000,
    maxRetries: 2,
  }));
}
