import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// Local disk storage, not cloud object storage: sufficient for this stage
// and avoids a new external dependency/credential. Render's free tier
// filesystem is ephemeral across redeploys, so uploaded files will not
// survive one there — an accepted limitation for a demo, not durable
// production storage.
const STORAGE_DIR = process.env.DOCUMENT_STORAGE_PATH ?? './uploads';

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export async function saveDocumentFile(file: File): Promise<string> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const ext = ALLOWED_DOCUMENT_TYPES[file.type] ?? '';
  const storedName = `${crypto.randomUUID()}${ext}`;
  const storedPath = path.join(STORAGE_DIR, storedName);

  // Extract buffer from the File object
  // Node.js stores Blob/File implementation details in Symbol(impl)
  let buffer: Buffer;
  const fileAny = file as any;
  const implSymbol = Object.getOwnPropertySymbols(file).find(sym => sym.toString() === 'Symbol(impl)');

  if (implSymbol) {
    const impl = fileAny[implSymbol] as any;
    if (impl._buffer) {
      buffer = impl._buffer;
    } else if (impl.parts) {
      // If it has parts array, concatenate them
      buffer = Buffer.concat(impl.parts.map((p: any) => Buffer.isBuffer(p) ? p : Buffer.from(p)));
    } else if (typeof fileAny.arrayBuffer === 'function') {
      buffer = Buffer.from(await fileAny.arrayBuffer());
    } else {
      throw new Error('Unable to extract file data');
    }
  } else if (typeof fileAny.arrayBuffer === 'function') {
    buffer = Buffer.from(await fileAny.arrayBuffer());
  } else {
    throw new Error('Unable to read file data');
  }

  await fs.writeFile(storedPath, buffer);
  return storedPath;
}

export async function readDocumentFile(storedPath: string): Promise<Buffer> {
  return fs.readFile(storedPath);
}
