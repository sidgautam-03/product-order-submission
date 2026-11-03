import mongoose from 'mongoose';

// One row per login. The access token carries this id (`sid`), so revoking the row kills that token
// immediately; the refresh token is stored only as a hash and rotates on every use.
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    refreshHash: { type: String, required: true },
    previousRefreshHash: String, // the token that was just rotated out: presenting it again means it leaked
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    lastUsedAt: Date,
    userAgent: { type: String, maxlength: 200 },
  },
  { timestamps: true }
);

schema.index({ user: 1, revokedAt: 1 });
schema.index({ refreshHash: 1 });
schema.index({ previousRefreshHash: 1 }, { sparse: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // expired sessions are deleted

export const Session = mongoose.model('Session', schema);
