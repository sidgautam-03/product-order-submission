import { Router } from 'express';
import * as products from '../controllers/product.controller.js';
import * as reviews from '../controllers/review.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../middleware/auth.js';
import { uploadImages } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../model/User.js';
import { validateObjectId } from '../utils/objectId.js';
import { reviewSchema } from '../validators/product.validator.js';

const router = Router();
const adminOnly = [authenticate, authorize(ROLES.ADMIN)];

router.get('/', optionalAuthenticate, products.list);
router.post('/', ...adminOnly, uploadImages, products.create);

router.get('/:id', validateObjectId('id'), optionalAuthenticate, products.get);
router.patch('/:id', ...adminOnly, validateObjectId('id'), uploadImages, products.update);
router.delete('/:id', ...adminOnly, validateObjectId('id'), products.archive);

router.get('/:id/reviews', validateObjectId('id'), reviews.list);
router.post(
  '/:id/reviews',
  authenticate,
  authorize(ROLES.CUSTOMER),
  validateObjectId('id'),
  validate(reviewSchema),
  reviews.create
);

export default router;
