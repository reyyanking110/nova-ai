import { describe, it, expect, vi, beforeEach } from 'vitest';
import { respond } from '../src/agent.js';
import type { Context } from '../src/core.js';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  execute: vi.fn(),
  confirm: vi.fn(),
  memory: vi.fn(),
  summarize: vi.fn(),
  from: vi.fn(),
}));
vi.mock('../src/claude.js', () => ({ claude: () => ({ messages: { create: mocks.create } }) }));
vi.mock('../src/memory.js', () => ({ memoryContext: mocks.memory, summarize: mocks.summarize }));
vi.mock('../src/tools.js', () => ({
  toolDefinitions: [],
  toolAllowed: async () => true,
  executeTool: mocks.execute,
  confirmTool: mocks.confirm,
}));
vi.mock('../src/core.js', async (original) => ({
  ...(await original<typeof import('../src/core.js')>()),
  db: () => ({ from: mocks.from }),
  scoped: (table: string) => mocks.from(table),
}));
const ctx: Context = {
  userId: 'a',
  mode: 'business',
  contactId: 'c',
  conversationId: 'conv',
  phone: '+923001234567',
  phoneNumberId: '123456',
};
const reply = (content: any[]) => ({
  content,
  model: 'sonnet-test',
  usage: { input_tokens: 10, output_tokens: 5 },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.memory.mockResolvedValue({ facts: [], summary: '' });
  mocks.from.mockImplementation((table) => {
    const r = { data: table === 'messages' ? [] : null, error: null };
    const q: any = { then: (ok: any) => Promise.resolve(r).then(ok) };
    for (const name of ['select', 'eq', 'order', 'limit', 'maybeSingle', 'insert'])
      q[name] = () => q;
    return q;
  });
});
describe('Claude agent with SDK boundary simulated (no live API)', () => {
  it('builds mode-safe multilingual system instructions and records usage', async () => {
    mocks.create.mockResolvedValue(reply([{ type: 'text', text: 'وعلیکم السلام' }]));
    expect(await respond(ctx, 'سلام')).toBe('وعلیکم السلام');
    const call = mocks.create.mock.calls[0]![0];
    expect(call.system).toContain('Mode: business');
    expect(call.system).toContain('NEVER access personal');
    expect(call.messages.at(-1).content[0].text).toBe('سلام');
    expect(mocks.memory).toHaveBeenCalledWith(ctx, 'سلام');
    expect(mocks.from).toHaveBeenCalledWith('usage_records');
  });
  it('passes validated tool results back to Claude before claiming success', async () => {
    mocks.create
      .mockResolvedValueOnce(
        reply([{ type: 'tool_use', id: 'call1', name: 'search_faqs', input: { query: 'hours' } }]),
      )
      .mockResolvedValueOnce(reply([{ type: 'text', text: 'Open 9 to 5.' }]));
    mocks.execute.mockResolvedValue({ answer: '9 to 5' });
    expect(await respond(ctx, 'What are your hours?')).toBe('Open 9 to 5.');
    expect(mocks.execute).toHaveBeenCalledWith('search_faqs', { query: 'hours' }, ctx);
  });
  it('exposes confirmation instructions deterministically, without trusting another model response', async () => {
    mocks.create.mockResolvedValue(
      reply([{ type: 'tool_use', id: 'call1', name: 'delete_task', input: { id: 'x' } }]),
    );
    mocks.execute.mockResolvedValue({
      confirmation_required: true,
      input: { id: 'x' },
      instruction: 'Reply exactly CONFIRM abc',
    });
    expect(await respond({ ...ctx, mode: 'personal' }, 'delete it')).toContain('CONFIRM abc');
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('requires exact human confirmation text and bypasses the model for it', async () => {
    mocks.confirm.mockResolvedValue({ deleted: true });
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(await respond(ctx, `CONFIRM ${id}`)).toContain('deleted');
    expect(mocks.confirm).toHaveBeenCalledWith(id, ctx);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('caps tool recursion at five rounds', async () => {
    mocks.create.mockResolvedValue(
      reply([{ type: 'tool_use', id: 'call1', name: 'business_info', input: {} }]),
    );
    mocks.execute.mockResolvedValue({ name: 'test' });
    expect(await respond(ctx, 'loop')).toContain('action limit');
    expect(mocks.create).toHaveBeenCalledTimes(5);
  });
  it('does not hide SDK failures or fabricate assistant text', async () => {
    mocks.create.mockRejectedValue(new Error('provider down'));
    await expect(respond(ctx, 'hello')).rejects.toThrow('provider down');
  });
  it('turns failed actions into error results rather than successes', async () => {
    mocks.create
      .mockResolvedValueOnce(
        reply([{ type: 'tool_use', id: 'call1', name: 'business_info', input: {} }]),
      )
      .mockResolvedValueOnce(reply([{ type: 'text', text: 'I could not complete that.' }]));
    mocks.execute.mockRejectedValue(new Error('validation failed'));
    expect(await respond(ctx, 'do it')).toContain('could not');
    const messages = mocks.create.mock.calls[1]![0].messages;
    expect(messages.at(-1).content[0].is_error).toBe(true);
  });
});
