import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { UPLOADS_DIR } from '../config/paths.js';
import { AppError } from './AppError.js';

// SVG is deliberately absent
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

// trust the file's magic bytes, never the extension or the client-sent mime type
export async function inspectImages(files) {
  const checked = [];
  for (const [i, file] of files.entries()) {
    const type = await fileTypeFromBuffer(file.buffer);
    if (!type || !ALLOWED.has(type.mime)) {
      throw new AppError(400, `Image ${i + 1} is not a valid image. Only JPEG, PNG and WEBP files are allowed`);
    }
    checked.push({ buffer: file.buffer, mimeType: type.mime, ext: ALLOWED.get(type.mime), size: file.size });
  }
  return checked;
}

export async function deleteImages(images) {
  await Promise.all(images.map((i) => fs.unlink(path.join(UPLOADS_DIR, i.filename)).catch(() => {})));
}

// writes under generated names; if any write fails, the ones already written are removed
export async function storeImages(checked) {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const written = [];
  try {
    for (const c of checked) {
      const filename = `${randomUUID()}.${c.ext}`;
      await fs.writeFile(path.join(UPLOADS_DIR, filename), c.buffer, { flag: 'wx' });
      written.push({ filename, path: `uploads/${filename}`, size: c.size, mimeType: c.mimeType });
    }
    return written;
  } catch (err) {
    await deleteImages(written);
    throw err;
  }
}
