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
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storedPath, buffer);
  return storedPath;
}

export async function readDocumentFile(storedPath: string): Promise<Buffer> {
  return fs.readFile(storedPath);
}
