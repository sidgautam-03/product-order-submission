import { AppError } from './AppError.js';

export const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

export const validateObjectId =
  (...names) =>
  (req, res, next) => {
    for (const name of names) {
      if (!OBJECT_ID_RE.test(req.params[name])) {
        throw new AppError(400, `Invalid ${name}`, 'VALIDATION_ERROR', [
          { path: name, message: 'Must be a valid ObjectId' },
        ]);
      }
    }
    next();
  };
