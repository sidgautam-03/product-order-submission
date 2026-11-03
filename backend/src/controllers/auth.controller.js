import * as authService from '../services/auth.service.js';

const meta = (req) => ({ requestId: req.id, userAgent: req.get('user-agent') });
const message = (res, text) => res.json({ success: true, data: { message: text } });

export async function register(req, res) {
  const { user, token, refreshToken } = await authService.register(req.body, meta(req));
  res.status(201).json({ success: true, data: { user, token, refreshToken } });
}

export async function login(req, res) {
  const { user, token, refreshToken } = await authService.login(req.body, meta(req));
  res.json({ success: true, data: { user, token, refreshToken } });
}

export async function refresh(req, res) {
  const { user, token, refreshToken } = await authService.refresh(req.body.refreshToken);
  res.json({ success: true, data: { user, token, refreshToken } });
}

export function me(req, res) {
  res.json({ success: true, data: { user: req.user } });
}

export async function logout(req, res) {
  await authService.revokeSession(req.authSession._id);
  message(res, 'Logged out');
}

export async function logoutAll(req, res) {
  await authService.revokeAllSessions(req.user._id);
  message(res, 'Logged out of all devices');
}

export async function changePassword(req, res) {
  await authService.changePassword(req.user, req.authSession._id, req.body);
  message(res, 'Password changed; other devices were signed out');
}

export async function forgotPassword(req, res) {
  await authService.forgotPassword(req.body, meta(req));
  message(res, 'If that email is registered, a password reset link has been sent');
}

export async function resetPassword(req, res) {
  await authService.resetPassword(req.body);
  message(res, 'Password reset; sign in with the new password');
}

export async function verifyEmail(req, res) {
  await authService.verifyEmail(req.body);
  message(res, 'Email verified');
}

export async function resendVerification(req, res) {
  await authService.resendVerification(req.user, meta(req));
  message(res, 'Verification email sent');
}
