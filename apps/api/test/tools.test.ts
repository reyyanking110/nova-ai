import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool, confirmTool, toolAllowed } from '../src/tools.js';
import type { Context } from '../src/core.js';
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  audit: vi.fn(),
  sendFile: vi.fn(),
  results: [] as any[],
  chains: [] as any[],
}));
vi.mock('../src/core.js', async (original) => ({
  ...(await original<typeof import('../src/core.js')>()),
  db: () => ({ from: mocks.from }),
  audit: mocks.audit,
}));
vi.mock('../src/whatsapp.js', () => ({ sendFile: mocks.sendFile }));
const ctx: Context = {
  userId: 'tenant-a',
  mode: 'personal',
  contactId: 'c',
  conversationId: 'conversation-a',
  phone: '+923001234567',
  phoneNumberId: '123456',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.results = [];
  mocks.chains = [];
  mocks.from.mockImplementation((table) => {
    const value = mocks.results.shift() ?? { data: null, error: null };
    const chain: any = { table, eq: vi.fn(), then: (ok: any) => Promise.resolve(value).then(ok) };
    for (const method of [
      'select',
      'eq',
      'maybeSingle',
      'single',
      'insert',
      'update',
      'delete',
      'gt',
    ])
      chain[method] = vi.fn(() => chain);
    mocks.chains.push(chain);
    return chain;
  });
});
describe('tool isolation and confirmation', () => {
  it.each(['create_task', 'search_notes', 'save_memory', 'create_reminder'])(
    'never permits business %s, even before database access',
    async (name) => {
      expect(await toolAllowed(name as any, { ...ctx, mode: 'business' })).toBe(false);
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
  it('business defaults to read-only context and file sending is opt-in', async () => {
    expect(await toolAllowed('search_faqs', { ...ctx, mode: 'business' })).toBe(true);
    expect(await toolAllowed('send_approved_file', { ...ctx, mode: 'business' })).toBe(false);
  });
  it('honors an explicit owner permission denial', async () => {
    mocks.results.push({ data: { enabled: false }, error: null });
    expect(await toolAllowed('create_task', ctx)).toBe(false);
  });
  it('records a pending confirmation without executing a deletion', async () => {
    mocks.results.push({ data: null, error: null }, { data: { id: 'execution-a' }, error: null });
    const output = await executeTool(
      'delete_task',
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      ctx,
    );
    expect(output.confirmation_required).toBe(true);
    expect(output.instruction).toContain('CONFIRM execution-a');
    expect(mocks.from).not.toHaveBeenCalledWith('tasks');
  });
  it('rejects foreign, expired or already used confirmations', async () => {
    await expect(confirmTool('execution-a', ctx)).rejects.toThrow('expired');
    const chain = mocks.chains[0];
    expect(chain.eq).toHaveBeenCalledWith('user_id', ctx.userId);
    expect(chain.eq).toHaveBeenCalledWith('mode', 'personal');
    expect(chain.eq).toHaveBeenCalledWith('conversation_id', ctx.conversationId);
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending_confirmation');
    expect(chain.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
  });
  it('reuses the recorded result for an identical retried tool call', async () => {
    mocks.results.push(
      { data: null, error: null },
      { data: { status: 'completed', result: { id: 'already-created' } }, error: null },
    );
    expect(
      await executeTool('create_task', { title: 'same task' }, { ...ctx, requestId: 'inbound-1' }),
    ).toEqual({ id: 'already-created' });
    expect(mocks.from).not.toHaveBeenCalledWith('tasks');
  });
  it('does not blindly replay an uncertain side effect after a crash', async () => {
    mocks.results.push({ data: null, error: null }, { data: { status: 'running' }, error: null });
    const response = await executeTool(
      'create_task',
      { title: 'same task' },
      { ...ctx, requestId: 'inbound-1' },
    );
    expect(response.error).toContain('uncertain');
    expect(mocks.from).not.toHaveBeenCalledWith('tasks');
  });
  it('rejects tools outside the registry and malformed arguments', async () => {
    await expect(executeTool('run_shell', { command: 'ls' }, ctx)).rejects.toThrow('Unknown tool');
    await expect(executeTool('create_task', { title: '' }, ctx)).rejects.toThrow();
  });
});
