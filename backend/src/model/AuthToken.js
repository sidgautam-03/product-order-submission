import mongoose from 'mongoose';

export const TOKEN_TYPES = Object.freeze({ PASSWORD_RESET: 'password_reset', EMAIL_VERIFICATION: 'email_verification' });

// single-use tokens emailed to a user; only a hash is stored
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: Object.values(TOKEN_TYPES), required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

schema.index({ user: 1, type: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 }); // cleaned up a day after expiry

export const AuthToken = mongoose.model('AuthToken', schema);
