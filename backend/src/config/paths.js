import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
