import { Router } from 'express';
import auth from '../middleware/auth.js';
import {
  createProductController,
  searchProductController,
  getCategoryStructureController,
  deleteProductDetails,
  getProductByCategory,
  getProductByCategoryAndSubCategory,
  getProductByBrand,
  getProductController,
  getProductDetails,
  searchProduct,
  searchProductAdmin,
  updateProductDetails,
  getFeaturedProducts,
  getProductsByAvailability,
  getProductBySKU,
  getProductControllerAdmin,
} from '../controllers/product.controller.js';
import { admin } from '../middleware/Admin.js';

const productRouter = Router();

// Create product
productRouter.post('/create', auth, admin, createProductController);

// Get products
productRouter.get('/search', searchProductController);
productRouter.get('/category-structure', getCategoryStructureController);
productRouter.post('/get', getProductController);
productRouter.post('/get-admin', getProductControllerAdmin);
productRouter.post('/get-product-by-category', getProductByCategory);
productRouter.post(
  '/get-product-by-category-and-subcategory',
  getProductByCategoryAndSubCategory
);
productRouter.post('/get-product-details', getProductDetails);

// Update product
productRouter.put('/update-product-details', auth, admin, updateProductDetails);

// Delete product
productRouter.delete('/delete-product', auth, admin, deleteProductDetails);

// Search product
productRouter.post('/search-product', searchProduct);
productRouter.post('/search-product-admin', searchProductAdmin);

// Filter products by category
productRouter.post('/get-product-by-category', getProductByCategory);

// Filter products by category and subcategory
productRouter.post(
  '/get-product-by-category-and-subcategory',
  getProductByCategoryAndSubCategory
);

// Filter products by brand
productRouter.post('/get-product-by-brand', getProductByBrand);

// NEW ROUTES - Added the three new functions
// Get featured products
productRouter.post('/get-featured-products', getFeaturedProducts);

// Get products by availability status
productRouter.post('/get-products-by-availability', getProductsByAvailability);

// Get product by SKU
productRouter.post('/get-product-by-sku', getProductBySKU);

export default productRouter;
