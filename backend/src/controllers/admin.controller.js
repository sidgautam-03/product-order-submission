import { EmailJob } from '../model/EmailJob.js';
import { buildMeta, pageParams } from '../utils/pagination.js';
import * as userService from '../services/user.service.js';
import { listEmailJobsQuerySchema } from '../validators/email.validator.js';
import { createUserSchema, listUsersQuerySchema, updateUserSchema } from '../validators/user.validator.js';

export async function listEmailJobs(req, res) {
  const query = listEmailJobsQuerySchema.parse(req.query);
  const { page, limit, skip } = pageParams(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.event) filter.event = query.event;

  const [jobs, total] = await Promise.all([
    EmailJob.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    EmailJob.countDocuments(filter),
  ]);
  res.json({ success: true, data: jobs, meta: buildMeta(page, limit, total) });
}

export async function listUsers(req, res) {
  const { users, meta } = await userService.listUsers(listUsersQuerySchema.parse(req.query));
  res.json({ success: true, data: users, meta });
}

export async function createUser(req, res) {
  const user = await userService.createUser(createUserSchema.parse(req.body ?? {}));
  res.status(201).json({ success: true, data: user });
}

export async function updateUser(req, res) {
  const user = await userService.updateUser(req.user, req.params.id, updateUserSchema.parse(req.body ?? {}));
  res.json({ success: true, data: user });
}
