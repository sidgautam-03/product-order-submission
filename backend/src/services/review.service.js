import { Order, ORDER_STATUS } from '../model/Order.js';
import { Product } from '../model/Product.js';
import { Review } from '../model/Review.js';
import { AppError } from '../utils/AppError.js';
import { buildMeta, pageParams } from '../utils/pagination.js';

// One atomic pipeline update: sum and count move together and the average is derived from them
// in the same operation, so simultaneous reviews can never leave them out of step.
// Average = round-half-up(sum * 10 / count) / 10, done with integers (aggregation $round is half-to-even).
const ratingUpdate = (rating) => [
  {
    $set: {
      ratingSum: { $add: ['$ratingSum', rating] },
      reviewCount: { $add: ['$reviewCount', 1] },
    },
  },
  {
    $set: {
      averageRating: {
        $divide: [
          {
            $floor: {
              $divide: [
                { $add: [{ $multiply: ['$ratingSum', 20] }, '$reviewCount'] },
                { $multiply: ['$reviewCount', 2] },
              ],
            },
          },
          10,
        ],
      },
    },
  },
];

async function requireProduct(productId) {
  const product = await Product.exists({ _id: productId, isArchived: false });
  if (!product) throw new AppError(404, 'Product not found');
}

export async function createReview(productId, user, { rating, comment }) {
  await requireProduct(productId);

  const purchased = await Order.exists({
    user: user._id,
    status: ORDER_STATUS.DELIVERED,
    'items.product': productId,
  });
  if (!purchased) {
    throw new AppError(403, 'Only customers with a delivered order containing this product can review it');
  }

  let review;
  try {
    // reviewer name comes from the account, never from the request body
    review = await Review.create({ product: productId, user: user._id, reviewerName: user.name, rating, comment });
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'You have already reviewed this product');
    throw err;
  }

  try {
    await Product.updateOne({ _id: productId }, ratingUpdate(rating), { updatePipeline: true });
  } catch (err) {
    await Review.deleteOne({ _id: review._id }); // keep review and product totals consistent
    throw err;
  }
  return review;
}

export async function listReviews(productId, query) {
  await requireProduct(productId);
  const { page, limit, skip } = pageParams(query);
  const [reviews, total] = await Promise.all([
    Review.find({ product: productId }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    Review.countDocuments({ product: productId }),
  ]);
  return { reviews, meta: buildMeta(page, limit, total) };
}
