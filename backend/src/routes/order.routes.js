import { Router } from 'express';
import * as orders from '../controllers/order.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../model/User.js';
import { validateObjectId } from '../utils/objectId.js';
import { updateStatusSchema } from '../validators/order.validator.js';

export const orderRouter = Router();
orderRouter.use(authenticate);

orderRouter.post('/', authorize(ROLES.CUSTOMER), orders.place);
orderRouter.get('/', orders.list);
orderRouter.get('/:id', validateObjectId('id'), orders.get);
orderRouter.patch('/:id', validateObjectId('id'), validate(updateStatusSchema), orders.updateStatus);

export const reportRouter = Router();
reportRouter.get('/sales', authenticate, authorize(ROLES.ADMIN), orders.sales);
