import { z } from 'zod';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

const positiveInt = (label) =>
  z.string().regex(/^[1-9]\d{0,8}$/, `${label} must be a positive integer`).transform(Number).optional();

// spread into a query schema
export const paginationShape = { page: positiveInt('page'), limit: positiveInt('limit') };

// limit above the maximum is clamped to MAX_LIMIT; malformed values are rejected by the schema
export function pageParams({ page = 1, limit = DEFAULT_LIMIT }) {
  const capped = Math.min(limit, MAX_LIMIT);
  return { page, limit: capped, skip: (page - 1) * capped };
}

export const buildMeta = (page, limit, total) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
