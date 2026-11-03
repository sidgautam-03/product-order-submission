import * as reviewService from '../services/review.service.js';
import { reviewsQuerySchema } from '../validators/product.validator.js';

export async function create(req, res) {
  const review = await reviewService.createReview(req.params.id, req.user, req.body);
  res.status(201).json({ success: true, data: review });
}

export async function list(req, res) {
  const query = reviewsQuerySchema.parse(req.query);
  const { reviews, meta } = await reviewService.listReviews(req.params.id, query);
  res.json({ success: true, data: reviews, meta });
}
