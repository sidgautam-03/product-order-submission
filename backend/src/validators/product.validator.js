import { z } from 'zod';
import { OBJECT_ID_RE } from '../utils/objectId.js';
import { rupeesToPaise } from '../utils/money.js';
import { paginationShape } from '../utils/pagination.js';

// multipart sends every field as a string, JSON sends numbers: accept both
const price = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const paise = rupeesToPaise(v);
  if (paise === null || paise <= 0) {
    ctx.addIssue({ code: 'custom', message: 'price must be greater than 0 with at most 2 decimal places' });
    return z.NEVER;
  }
  return paise;
});

const nonNegativeInt = z.preprocess(
  (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v),
  z.number().int().min(0)
);

// removeImageIds: repeated field, comma separated, or a JSON array string
const idList = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      return v;
    }
  }
  return t ? t.split(',').map((s) => s.trim()) : [];
}, z.array(z.string().regex(OBJECT_ID_RE, 'must be a valid image id')).max(5));

export const createProductSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(1).max(1000),
  price,
  category: z.string().trim().min(1).max(50),
  stock: nonNegativeInt,
  lowStockThreshold: nonNegativeInt.optional(),
});

export const updateProductSchema = createProductSchema.partial().extend({ removeImageIds: idList.optional() });

const optionalText = (max) => z.string().trim().min(1).max(max).optional();

const pricePoint = z.string().transform((v, ctx) => {
  const paise = rupeesToPaise(v);
  if (paise === null) {
    ctx.addIssue({ code: 'custom', message: 'must be an amount with at most 2 decimal places' });
    return z.NEVER;
  }
  return paise;
});

export const listProductsQuerySchema = z
  .object({
    q: optionalText(100),
    category: optionalText(50),
    minPrice: pricePoint.optional(),
    maxPrice: pricePoint.optional(),
    minRating: z
      .string()
      .regex(/^(?:[0-4](?:\.\d+)?|5(?:\.0+)?)$/, 'minRating must be between 0 and 5')
      .transform(Number)
      .optional(),
    sort: z.enum(['price_asc', 'price_desc', 'rating_desc', 'newest']).default('newest'),
    includeArchived: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    ...paginationShape,
  })
  .refine((d) => d.minPrice === undefined || d.maxPrice === undefined || d.minPrice <= d.maxPrice, {
    message: 'minPrice must not be greater than maxPrice',
    path: ['minPrice'],
  });

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const reviewsQuerySchema = z.object(paginationShape);
