import * as productService from '../services/product.service.js';
import { ROLES } from '../model/User.js';
import { AppError } from '../utils/AppError.js';
import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from '../validators/product.validator.js';

const isAdmin = (req) => req.user?.role === ROLES.ADMIN;

export async function create(req, res) {
  const input = createProductSchema.parse(req.body ?? {});
  const product = await productService.createProduct(input, req.files);
  res.status(201).json({ success: true, data: product });
}

export async function update(req, res) {
  const input = updateProductSchema.parse(req.body ?? {});
  if (Object.keys(input).length === 0 && req.files.length === 0) {
    throw new AppError(400, 'Nothing to update');
  }
  const product = await productService.updateProduct(req.params.id, input, req.files);
  res.json({ success: true, data: product });
}

export async function archive(req, res) {
  const product = await productService.archiveProduct(req.params.id);
  res.json({ success: true, data: product });
}

export async function list(req, res) {
  const query = listProductsQuerySchema.parse(req.query);
  const { products, meta } = await productService.listProducts(query, { isAdmin: isAdmin(req) });
  res.json({ success: true, data: products, meta });
}

export async function get(req, res) {
  const product = await productService.getProduct(req.params.id, { isAdmin: isAdmin(req) });
  res.json({ success: true, data: product });
}
