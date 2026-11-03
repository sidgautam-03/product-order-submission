import { z } from 'zod';
import { EMAIL_EVENTS, EMAIL_STATUS } from '../model/EmailJob.js';
import { paginationShape } from '../utils/pagination.js';

export const listEmailJobsQuerySchema = z.object({
  status: z.enum(Object.values(EMAIL_STATUS)).optional(),
  event: z.enum(Object.values(EMAIL_EVENTS)).optional(),
  ...paginationShape,
});
