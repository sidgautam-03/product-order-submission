// Parses req.body with a zod schema; unknown keys (e.g. "role") are stripped
export const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body);
  next();
};
