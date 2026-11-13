import { randomUUID } from 'node:crypto';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { AppError, db, result } from './core.js';
import { env } from './config.js';
export const MAX_FILE = 10 * 1024 * 1024;
export const allowedMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
]);
export async function readLimited(response: Response) {
  if (Number(response.headers.get('content-length')) > MAX_FILE)
    throw new AppError(413, 'File exceeds 10 MB');
  if (!response.body) throw new AppError(400, 'Empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FILE) throw new AppError(413, 'File exceeds 10 MB');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export function validateFile(buffer: Buffer, mime: string) {
  if (!allowedMime.has(mime)) throw new AppError(415, 'Unsupported file type');
  if (!buffer.length || buffer.length > MAX_FILE)
    throw new AppError(413, 'File must be 1 byte to 10 MB');
  const h = buffer.subarray(0, 16);
  const valid =
    mime === 'application/pdf'
      ? h.toString().startsWith('%PDF-')
      : mime === 'image/png'
        ? h.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/jpeg'
          ? h[0] === 255 && h[1] === 216 && h[2] === 255
          : mime === 'image/webp'
            ? h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP'
            : mime.includes('openxmlformats')
              ? h[0] === 80 && h[1] === 75
              : mime === 'audio/ogg'
                ? h.toString('ascii', 0, 4) === 'OggS'
                : mime === 'audio/wav'
                  ? h.toString('ascii', 0, 4) === 'RIFF'
                  : mime === 'audio/mp4'
                    ? h.toString('ascii', 4, 8) === 'ftyp'
                    : mime === 'audio/webm'
                      ? h.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
                      : mime === 'audio/mpeg'
                        ? h.toString('ascii', 0, 3) === 'ID3' || h[0] === 255
                        : false;
  if (!valid) throw new AppError(415, 'File content does not match its declared type');
  // Limit ZIP uncompressed size before invoking office parsers (central directory is not sufficient alone).
  if (mime.includes('openxmlformats')) {
    let total = 0,
      count = 0;
    for (let i = 0; i < buffer.length - 46; i++)
      if (buffer.readUInt32LE(i) === 0x02014b50) {
        total += buffer.readUInt32LE(i + 24);
        count++;
      }
    if (!count || total > 30 * 1024 * 1024 || count > 1000)
      throw new AppError(413, 'Office archive is too large or invalid');
  }
}
export async function validateOfficeArchive(buffer: Buffer) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) {
        reject(new AppError(415, 'Invalid Office archive'));
        return;
      }
      let bytes = 0,
        entries = 0,
        finished = false;
      const timer = setTimeout(
        () => fail(new AppError(413, 'Office archive processing timed out')),
        5000,
      );
      timer.unref();
      function fail(e: Error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        zip!.close();
        reject(e);
      }
      zip.on('error', fail);
      zip.on('end', () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve();
        }
      });
      zip.on('entry', (entry) => {
        if (++entries > 1000 || entry.generalPurposeBitFlag & 1 || entry.fileName.includes('..')) {
          fail(new AppError(415, 'Unsafe Office archive'));
          return;
        }
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            fail(new AppError(415, 'Invalid archive entry'));
            return;
          }
          stream.on('error', fail);
          stream.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > 30 * 1024 * 1024) {
              stream.destroy();
              fail(new AppError(413, 'Expanded archive exceeds 30 MB'));
            }
          });
          stream.on('end', () => {
            if (!finished) zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
export async function extract(
  buffer: Buffer,
  mime: string,
): Promise<{ text: string; blocks: ContentBlockParam[] }> {
  validateFile(buffer, mime);
  if (mime.includes('openxmlformats')) await validateOfficeArchive(buffer);
  if (mime.startsWith('image/'))
    return {
      text: '[Image attached]',
      blocks: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mime as 'image/jpeg' | 'image/png' | 'image/webp',
            data: buffer.toString('base64'),
          },
        },
      ],
    };
  if (mime === 'application/pdf')
    return {
      text: '[PDF attached]',
      blocks: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: buffer.toString('base64'),
          },
        },
      ],
    };
  if (mime.includes('wordprocessingml'))
    return { text: (await mammoth.extractRawText({ buffer })).value.slice(0, 50000), blocks: [] };
  if (mime.includes('spreadsheetml')) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as any);
    const lines: string[] = [];
    let cells = 0;
    book.eachSheet((sheet) => {
      lines.push(`Sheet: ${sheet.name}`);
      sheet.eachRow((row) => {
        if (cells < 10000) {
          lines.push(JSON.stringify(row.values));
          cells += row.cellCount;
        }
      });
    });
    return { text: lines.join('\n').slice(0, 50000), blocks: [] };
  }
  if (mime.startsWith('audio/')) return { text: await transcribe(buffer, mime), blocks: [] };
  throw new AppError(415, 'Unsupported media');
}
function provider(url: string | undefined, key: string | undefined) {
  if (!url || !key) throw new AppError(503, 'Speech provider is not configured');
  if (new URL(url).protocol !== 'https:') throw new AppError(503, 'Speech provider must use HTTPS');
  return { url, key };
}
async function transcribe(buffer: Buffer, mime: string) {
  const p = provider(env.STT_URL, env.STT_API_KEY);
  const form = new FormData();
  const ext = (
    {
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
    } as Record<string, string>
  )[mime];
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), `voice.${ext}`);
  form.append('model', env.STT_MODEL);
  const r = await fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}` },
    body: form,
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  });
  if (!r.ok) throw new AppError(502, 'Transcription provider failed');
  const data = await r.json();
  if (typeof data.text !== 'string') throw new AppError(502, 'Invalid transcription response');
  return data.text.slice(0, 50000);
}
export async function speech(text: string) {
  const p = provider(env.TTS_URL, env.TTS_API_KEY);
  const r = await fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.TTS_MODEL,
      voice: env.TTS_VOICE,
      input: text.slice(0, 4000),
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  });
  if (!r.ok) throw new AppError(502, 'Speech provider failed');
  return readLimited(r);
}
export async function storeMedia(
  userId: string,
  mode: string,
  buffer: Buffer,
  mime: string,
  name: string,
  sourceId?: string,
) {
  validateFile(buffer, mime);
  const path = `${userId}/${mode}/${randomUUID()}`;
  result(
    await db()
      .storage.from('nova-private')
      .upload(path, buffer, { contentType: mime, upsert: false }),
  );
  try {
    return result(
      await db()
        .from('media_files')
        .insert({
          user_id: userId,
          mode,
          name: name.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 180) || 'upload',
          mime_type: mime,
          storage_path: path,
          size_bytes: buffer.length,
          source_id: sourceId,
        })
        .select()
        .single(),
    );
  } catch (e) {
    await db().storage.from('nova-private').remove([path]);
    throw e;
  }
}
