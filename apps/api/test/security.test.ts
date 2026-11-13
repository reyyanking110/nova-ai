import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { validSignature } from '../src/whatsapp.js';
import { inServiceWindow, nextOccurrence, validateSchedule } from '../src/scheduling.js';
import { validateFile, readLimited, extract, MAX_FILE } from '../src/media.js';
import { parsePatch, resources, toolSchemas, personalOnly, consequential } from '@nova/shared';
import ExcelJS from 'exceljs';
describe('WhatsApp authentication', () => {
  it('accepts only a valid HMAC over exact raw bytes', () => {
    const b = Buffer.from('{"text":"سلام"}');
    const sig = `sha256=${createHmac('sha256', 'test-secret').update(b).digest('hex')}`;
    expect(validSignature(b, sig, 'test-secret')).toBe(true);
    expect(validSignature(Buffer.concat([b, Buffer.from(' ')]), sig, 'test-secret')).toBe(false);
  });
  it.each([undefined, '', 'sha256=bad', 'sha256=' + '0'.repeat(64), 'SHA256=' + 'a'.repeat(64)])(
    'rejects malformed/missing signature %s',
    (sig) => expect(validSignature(Buffer.from('x'), sig, 'secret')).toBe(false),
  );
});
describe('scheduling', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  it('enforces the exact 24-hour boundary', () => {
    expect(inServiceWindow(new Date(now - 86399000).toISOString(), now)).toBe(true);
    expect(inServiceWindow(new Date(now - 86400000).toISOString(), now)).toBe(false);
    expect(inServiceWindow(null, now)).toBe(false);
    expect(inServiceWindow(new Date(now + 1000).toISOString(), now)).toBe(false);
  });
  it('preserves local wall clock across daylight saving', () => {
    expect(
      nextOccurrence(
        '2026-03-07T14:00:00Z',
        'America/New_York',
        'daily',
        Date.parse('2026-03-07T15:00:00Z'),
      ),
    ).toBe('2026-03-08T13:00:00.000Z');
  });
  it('skips missed runs and supports weekly and one-off', () => {
    expect(nextOccurrence('2026-11-01T09:00:00Z', 'UTC', 'weekly', now)).toBe(
      '2026-11-15T09:00:00.000Z',
    );
    expect(nextOccurrence('2026-11-01T09:00:00Z', 'UTC', 'none', now)).toBe(null);
  });
  it('rejects past dates and unknown timezones', () => {
    expect(() => validateSchedule({ due_at: '2020-01-01T00:00:00Z', timezone: 'UTC' })).toThrow(
      'future',
    );
    expect(() =>
      validateSchedule({ due_at: '2099-01-01T00:00:00Z', timezone: 'Not/AZone' }),
    ).toThrow('timezone');
  });
});
describe('untrusted media', () => {
  it('rejects mismatched magic, scripts, and empty files', () => {
    expect(() => validateFile(Buffer.from('<script>'), 'image/png')).toThrow();
    expect(() => validateFile(Buffer.from('hello'), 'text/html')).toThrow();
    expect(() => validateFile(Buffer.alloc(0), 'application/pdf')).toThrow();
  });
  it('passes images and PDFs as Claude blocks, not instructions', async () => {
    const pdf = await extract(Buffer.from('%PDF-1.7\nexample'), 'application/pdf');
    expect(pdf.blocks[0]?.type).toBe('document');
    const png = await extract(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png');
    expect(png.blocks[0]?.type).toBe('image');
  });
  it('bounds streaming downloads with missing content-length', async () => {
    const response = new Response(new Uint8Array(MAX_FILE + 1));
    await expect(readLimited(response)).rejects.toThrow('10 MB');
  });
  it('rejects excessive declared archive expansion', () => {
    const b = Buffer.alloc(100);
    b.write('PK');
    b.writeUInt32LE(0x02014b50, 10);
    b.writeUInt32LE(100 * 1024 * 1024, 34);
    expect(() =>
      validateFile(b, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toThrow('large');
  });
  it('extracts real XLSX cells with the installed dependency override', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Sales').addRow(['Product', 'Price', 42]);
    const b = Buffer.from(await book.xlsx.writeBuffer());
    const output = await extract(
      b,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(output.text).toContain('Product');
    expect(output.text).toContain('42');
  });
});
describe('validated tool boundaries', () => {
  it('does not reset mode or status through Zod defaults on a partial update', () => {
    expect(parsePatch(resources.tasks.partial().strict(), { title: 'edited' })).toEqual({
      title: 'edited',
    });
    expect(parsePatch(resources.profiles.partial().strict(), { display_name: 'owner' })).toEqual({
      display_name: 'owner',
    });
  });
  it('rejects unknown tool arguments and invalid records', () => {
    expect(
      toolSchemas.create_reminder.safeParse({
        title: 'x',
        due_at: 'yesterday',
        timezone: 'UTC',
        recurrence: 'none',
      }).success,
    ).toBe(false);
    expect(
      resources.contacts.safeParse({ name: 'x', phone: '123', mode: 'personal' }).success,
    ).toBe(false);
    expect(resources.memories.safeParse({ content: 'x', approved: false }).success).toBe(false);
  });
  it('protects personal mutations and destructive actions', () => {
    expect(personalOnly.has('search_notes')).toBe(true);
    expect(personalOnly.has('save_memory')).toBe(true);
    expect(consequential.has('delete_task')).toBe(true);
    expect(consequential.has('send_approved_file')).toBe(true);
  });
});
