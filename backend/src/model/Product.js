import mongoose from 'mongoose';
import { paiseToRupees } from '../utils/money.js';

const imageSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  path: { type: String, required: true },
  size: { type: Number, required: true },
  mimeType: { type: String, required: true },
});

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    pricePaise: { type: Number, required: true, min: 1, validate: Number.isInteger },
    category: { type: String, required: true, trim: true, maxlength: 50 },
    categoryLower: { type: String, required: true }, // case-insensitive filtering
    stock: { type: Number, required: true, min: 0, validate: Number.isInteger },
    lowStockThreshold: { type: Number, default: 5, min: 0, validate: Number.isInteger },
    images: {
      type: [imageSchema],
      validate: [(v) => v.length >= 1 && v.length <= 5, 'A product needs 1 to 5 images'],
    },
    // rating is kept on the product and updated atomically with each review (see README)
    ratingSum: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    // true while a low-stock email is outstanding; cleared once stock is back above the threshold
    lowStockAlerted: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    archivedAt: Date,
  },
  {
    timestamps: true,
    optimisticConcurrency: true, // concurrent PATCHes of the same product conflict instead of clobbering
    toJSON: {
      transform(doc, ret) {
        ret.id = String(ret._id);
        ret.price = paiseToRupees(ret.pricePaise);
        ret.images = ret.images.map((i) => ({
          id: String(i._id),
          url: `/${i.path}`,
          size: i.size,
          mimeType: i.mimeType,
        }));
        for (const k of ['_id', '__v', 'pricePaise', 'categoryLower', 'ratingSum', 'lowStockAlerted']) delete ret[k];
        return ret;
      },
    },
  }
);

productSchema.pre('validate', function () {
  this.categoryLower = this.category?.toLowerCase();
});

// name is unique among non-archived products, ignoring case
productSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isArchived: false } }
);
productSchema.index({ name: 'text', description: 'text' }, { weights: { name: 3, description: 1 } });
productSchema.index({ isArchived: 1, categoryLower: 1, createdAt: -1, _id: -1 });
productSchema.index({ isArchived: 1, pricePaise: 1, _id: 1 });
productSchema.index({ isArchived: 1, averageRating: -1, _id: -1 });

export const Product = mongoose.model('Product', productSchema);
