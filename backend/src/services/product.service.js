import { Product } from '../model/Product.js';
import { Review } from '../model/Review.js';
import { AppError } from '../utils/AppError.js';
import { deleteImages, inspectImages, storeImages } from '../utils/images.js';
import { buildMeta, pageParams } from '../utils/pagination.js';

const MAX_IMAGES = 5;

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { pricePaise: 1, _id: 1 },
  price_desc: { pricePaise: -1, _id: -1 },
  rating_desc: { averageRating: -1, _id: -1 },
};

// _id is the final tie-breaker in every sort, so pages never repeat or skip items
const translate = (err) =>
  err?.code === 11000 ? new AppError(409, 'A product with this name already exists') : err;

function applyFields(product, input) {
  const { name, description, price, category, stock, lowStockThreshold } = input;
  if (name !== undefined) product.name = name;
  if (description !== undefined) product.description = description;
  if (price !== undefined) product.pricePaise = price;
  if (category !== undefined) product.category = category;
  if (stock !== undefined) product.stock = stock;
  if (lowStockThreshold !== undefined) product.lowStockThreshold = lowStockThreshold;
}

export async function createProduct(input, files) {
  if (files.length < 1) throw new AppError(400, 'At least 1 image is required');
  if (files.length > MAX_IMAGES) throw new AppError(400, `At most ${MAX_IMAGES} images are allowed`);

  const stored = await storeImages(await inspectImages(files));
  try {
    const { price, ...rest } = input;
    return await Product.create({ ...rest, pricePaise: price, images: stored });
  } catch (err) {
    await deleteImages(stored);
    throw translate(err);
  }
}

export async function updateProduct(id, input, files) {
  const product = await Product.findOne({ _id: id, isArchived: false });
  if (!product) throw new AppError(404, 'Product not found');

  const removeIds = new Set(input.removeImageIds ?? []);
  const owned = new Set(product.images.map((i) => String(i._id)));
  const unknown = [...removeIds].filter((x) => !owned.has(x));
  if (unknown.length) {
    throw new AppError(400, 'Some images to remove do not belong to this product', 'VALIDATION_ERROR',
      unknown.map((x) => ({ path: 'removeImageIds', message: `Unknown image id ${x}` })));
  }

  const kept = product.images.filter((i) => !removeIds.has(String(i._id)));
  const removed = product.images.filter((i) => removeIds.has(String(i._id)));
  const finalCount = kept.length + files.length;
  if (finalCount < 1 || finalCount > MAX_IMAGES) {
    throw new AppError(400, `A product must have 1 to ${MAX_IMAGES} images, this update would leave ${finalCount}`);
  }

  const stored = await storeImages(await inspectImages(files));
  try {
    applyFields(product, input);
    if (product.stock > product.lowStockThreshold) product.lowStockAlerted = false; // re-arm the alert
    // single $set of the whole array: $pull and $push on one path cannot share an update
    product.set('images', [...kept.map((i) => i.toObject()), ...stored]);
    await product.save();
  } catch (err) {
    await deleteImages(stored);
    throw translate(err);
  }
  await deleteImages(removed);
  return product;
}

export async function archiveProduct(id) {
  const product = await Product.findOneAndUpdate(
    { _id: id, isArchived: false },
    { isArchived: true, archivedAt: new Date() },
    { returnDocument: 'after' }
  );
  if (!product) throw new AppError(404, 'Product not found');
  return product;
}

export async function listProducts(query, { isAdmin }) {
  const { q, category, minPrice, maxPrice, minRating, sort, includeArchived } = query;
  const { page, limit, skip } = pageParams(query);

  const filter = {};
  if (!(includeArchived && isAdmin)) filter.isArchived = false;
  if (q) filter.$text = { $search: q };
  if (category) filter.categoryLower = category.toLowerCase();
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.pricePaise = {
      ...(minPrice !== undefined && { $gte: minPrice }),
      ...(maxPrice !== undefined && { $lte: maxPrice }),
    };
  }
  if (minRating !== undefined) filter.averageRating = { $gte: minRating };

  const [products, total] = await Promise.all([
    Product.find(filter).sort(SORTS[sort]).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  return { products, meta: buildMeta(page, limit, total) };
}

export async function getProduct(id, { isAdmin }) {
  const product = await Product.findOne({ _id: id, ...(isAdmin ? {} : { isArchived: false }) });
  if (!product) throw new AppError(404, 'Product not found');
  const latestReviews = await Review.find({ product: id }).sort({ createdAt: -1, _id: -1 }).limit(5);
  return { ...product.toJSON(), latestReviews };
}
