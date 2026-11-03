import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const MAX_IMAGES = 5;
const MAX_BYTES = 2 * 1024 * 1024;

// memory storage: nothing touches disk until the content has been verified
const parse = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_IMAGES },
}).array('images', MAX_IMAGES);

function toAppError(err) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return new AppError(400, 'Each image must be 2 MB or smaller');
    if (err.code === 'LIMIT_FILE_COUNT') return new AppError(400, `At most ${MAX_IMAGES} images are allowed`);
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return err.field === 'images'
        ? new AppError(400, `At most ${MAX_IMAGES} images are allowed`)
        : new AppError(400, 'Unexpected file field, images must be sent as "images"');
    }
    return new AppError(400, err.message);
  }
  return new AppError(400, 'Malformed multipart request');
}

export function uploadImages(req, res, next) {
  parse(req, res, (err) => {
    if (err) return next(toAppError(err));
    req.files = req.files ?? []; // JSON requests carry no files
    next();
  });
}
