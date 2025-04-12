import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  createProductController,
  getCategoryStructureController,
  deleteProductDetails,
  getProductByCategory,
  getProductByCategoryAndSubCategory,
  getProductController,
  getProductDetails,
  searchProduct,
  updateProductDetails,
  getProductByBrand,
  getProductByCategoryAndBrand,
  getProductBySubCategoryAndBrand,
  getProductByAttributes,
  advancedFilterProducts,
  getProductByRoastLevel,
  getProductByProducer,
  updateProductRating,
  getMegaMenuData,
} from '../controllers/product.controller.js';
import { admin } from '../middleware/Admin.js';

const productRouter = Router();

// Create product
productRouter.post('/create', auth, admin, createProductController);

// Get products
// In product routes
productRouter.get('/category-structure', getCategoryStructureController);
productRouter.post('/get', getProductController);
productRouter.post('/get-product-by-category', getProductByCategory);
productRouter.post(
  '/get-product-by-category-and-subcategory',
  getProductByCategoryAndSubCategory
);
productRouter.post('/get-product-details', getProductDetails);
productRouter.post('/mega-menu/:categoryId', getMegaMenuData);

// New endpoints
productRouter.post('/get-product-by-brand', getProductByBrand);
productRouter.post(
  '/get-product-by-category-and-brand',
  getProductByCategoryAndBrand
);
productRouter.post(
  '/get-product-by-subcategory-and-brand',
  getProductBySubCategoryAndBrand
);
productRouter.post('/get-product-by-attributes', getProductByAttributes);

// Additional endpoints that were missing
productRouter.post('/advanced-filter', advancedFilterProducts);
productRouter.post('/get-product-by-roast-level', getProductByRoastLevel);
productRouter.post('/get-product-by-producer', getProductByProducer);
productRouter.put('/update-rating', auth, updateProductRating);

// Update product
productRouter.put('/update-product-details', auth, admin, updateProductDetails);

// Delete product
productRouter.delete('/delete-product', auth, admin, deleteProductDetails);

// Search product
productRouter.post('/search-product', searchProduct);

export default productRouter;
