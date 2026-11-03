import mongoose from 'mongoose';
import { paiseToRupees } from '../utils/money.js';

export const ORDER_STATUS = Object.freeze({
  PENDING: 'Pending',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
});

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true }, // snapshot at order time
    unitPricePaise: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    lineTotalPaise: { type: Number, required: true },
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    status: { type: String, enum: Object.values(ORDER_STATUS), required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    customerName: { type: String, required: true, trim: true },
    customerEmail: { type: String, required: true, trim: true, lowercase: true },
    items: { type: [itemSchema], required: true },
    totalPaise: { type: Number, required: true },
    status: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING },
    statusHistory: [historySchema],
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        return {
          id: String(ret._id),
          customerId: String(ret.user),
          customerName: ret.customerName,
          customerEmail: ret.customerEmail,
          status: ret.status,
          statusHistory: ret.statusHistory.map((h) => ({
            status: h.status,
            changedBy: h.changedBy ? String(h.changedBy) : null,
            at: h.at,
          })),
          items: ret.items.map((i) => ({
            productId: String(i.product),
            name: i.name,
            unitPrice: paiseToRupees(i.unitPricePaise),
            quantity: i.quantity,
            lineTotal: paiseToRupees(i.lineTotalPaise),
          })),
          total: paiseToRupees(ret.totalPaise),
          createdAt: ret.createdAt,
          updatedAt: ret.updatedAt,
        };
      },
    },
  }
);

orderSchema.index({ user: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
