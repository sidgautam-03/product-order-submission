import bcrypt from 'bcrypt';
import { User } from '../model/User.js';
import { AppError } from '../utils/AppError.js';
import { buildMeta, pageParams } from '../utils/pagination.js';
import { revokeAllSessions } from './auth.service.js';

const BACKSLASH = String.fromCharCode(92);
const REGEX_SPECIALS = new Set('.*+?^${}()|[]'.split('').concat(BACKSLASH));
// makes user input safe to embed in a RegExp (searching "a.b" must not match "axb")
const escapeRegex = (s) => [...s].map((c) => (REGEX_SPECIALS.has(c) ? BACKSLASH + c : c)).join('');

export async function listUsers(query) {
  const { page, limit, skip } = pageParams(query);
  const filter = {};
  if (query.role) filter.role = query.role;
  // accounts created before the field existed have no isActive stored, and count as active
  if (query.isActive !== undefined) filter.isActive = query.isActive ? { $ne: false } : false;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return { users, meta: buildMeta(page, limit, total) };
}

export async function createUser({ name, email, password, role }) {
  try {
    // an admin vouches for accounts they create, so the email counts as verified
    return await User.create({ name, email, role, passwordHash: await bcrypt.hash(password, 12), emailVerified: true, emailVerifiedAt: new Date() });
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'Email already registered');
    throw err;
  }
}

export async function updateUser(actor, id, { role, isActive }) {
  const user = await User.findById(id);
  if (!user) throw new AppError(404, 'User not found');

  // an admin cannot lock themselves out, which also means at least one active admin always remains
  if (String(user._id) === String(actor._id) && ((role !== undefined && role !== user.role) || isActive === false)) {
    throw new AppError(409, 'You cannot change your own role or deactivate your own account');
  }

  if (role !== undefined) user.role = role;
  if (isActive !== undefined) user.isActive = isActive;
  await user.save();
  if (isActive === false) await revokeAllSessions(user._id); // a disabled account is signed out everywhere
  return user;
}
