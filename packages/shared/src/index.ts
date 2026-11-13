import { z } from 'zod';
export const modeSchema = z.enum(['personal', 'business']);
const text = z.string().trim().min(1).max(10000);
const title = z.string().trim().min(1).max(200);
const scope = { mode: modeSchema.default('personal') };
export const resources = {
  contacts: z.object({ name: title, phone: z.string().regex(/^\+[1-9]\d{6,14}$/), ...scope }),
  memories: z.object({ content: text, approved: z.literal(true), ...scope }),
  tasks: z.object({
    title,
    status: z.enum(['open', 'in_progress', 'completed']).default('open'),
    ...scope,
  }),
  notes: z.object({ title, content: text, ...scope }),
  reminders: z.object({
    title,
    due_at: z.string().datetime({ offset: true }),
    timezone: z.string().default('Asia/Karachi'),
    recurrence: z.enum(['none', 'daily', 'weekly']).default('none'),
    status: z.enum(['scheduled', 'cancelled']).default('scheduled'),
    contact_id: z.string().uuid(),
    ...scope,
  }),
  business_profiles: z.object({
    name: title,
    description: text,
    phone_number_id: z.string().regex(/^\d{5,30}$/),
    reminder_template: z.string().max(100).nullable().optional(),
    template_language: z.string().max(20).default('en_US'),
  }),
  business_faqs: z.object({ question: title, answer: text }),
  permissions: z.object({
    tool: z.string().max(80),
    enabled: z.boolean(),
    business_enabled: z.boolean().default(false),
  }),
  ai_settings: z.object({
    personality: text,
    response_language: z.enum(['auto', 'English', 'Urdu', 'Roman Urdu']).default('auto'),
    voice_replies: z.boolean().default(false),
  }),
  profiles: z.object({
    display_name: title,
    owner_phone: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/)
      .nullable(),
    timezone: z.string().default('Asia/Karachi'),
  }),
} as const;
export type Resource = keyof typeof resources;
export type Mode = z.infer<typeof modeSchema>;
export const toolSchemas = {
  create_task: z.object({ title }),
  update_task: z.object({
    id: z.string().uuid(),
    title: title.optional(),
    status: z.enum(['open', 'in_progress', 'completed']).optional(),
  }),
  complete_task: z.object({ id: z.string().uuid() }),
  delete_task: z.object({ id: z.string().uuid() }),
  save_note: z.object({ title, content: text }),
  search_notes: z.object({ query: z.string().min(1).max(100) }),
  save_memory: z.object({ content: text }),
  create_reminder: resources.reminders.omit({ mode: true, contact_id: true, status: true }),
  cancel_reminder: z.object({ id: z.string().uuid() }),
  search_faqs: z.object({ query: z.string().min(1).max(100) }),
  business_info: z.object({}),
  send_approved_file: z.object({ id: z.string().uuid() }),
  generate_summary: z.object({}),
} as const;
export type ToolName = keyof typeof toolSchemas;
export const consequential = new Set<ToolName>([
  'delete_task',
  'cancel_reminder',
  'send_approved_file',
  'save_memory',
]);
export const personalOnly = new Set<ToolName>([
  'create_task',
  'update_task',
  'complete_task',
  'delete_task',
  'save_note',
  'search_notes',
  'save_memory',
  'create_reminder',
  'cancel_reminder',
]);

/** Zod defaults also run inside partial objects. PATCH must never synthesize absent fields. */
export function parsePatch(schema: z.ZodType, input: unknown): Record<string, unknown> {
  const parsed = schema.parse(input) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => Object.hasOwn(input as object, key)),
  );
}
