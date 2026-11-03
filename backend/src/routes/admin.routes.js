import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { ROLES } from '../model/User.js';
import { validateObjectId } from '../utils/objectId.js';

const router = Router();
router.use(authenticate, authorize(ROLES.ADMIN));

router.get('/email-jobs', admin.listEmailJobs);

router.get('/users', admin.listUsers);
router.post('/users', admin.createUser);
router.patch('/users/:id', validateObjectId('id'), admin.updateUser);

export default router;
