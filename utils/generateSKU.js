import ProductModel from '../models/product.model.js';
import CategoryModel from '../models/category.model.js';
import BrandModel from '../models/brand.model.js';

/**
 * Generates a unique SKU for a product
 * SKU formula: First 3 letters of product name + category + brand + 3 random numbers + 2 random letters
 * @param {string} productName - The name of the product
 * @param {string} categoryId - The category ID (ObjectId)
 * @param {string|Array} brandId - The brand ID (ObjectId) or array of brand IDs
 * @returns {Promise<string>} - Unique SKU
 */
const generateSKU = async (productName, categoryId, brandId) => {
  try {
    // Helper function to get first 3 letters from a string
    const getFirstThreeLetters = (str) => {
      if (!str) return 'XXX';
      return str
        .replace(/[^a-zA-Z]/g, '')
        .substring(0, 3)
        .toUpperCase()
        .padEnd(3, 'X');
    };

    // Helper function to generate random numbers
    const generateRandomNumbers = (count) => {
      let result = '';
      for (let i = 0; i < count; i++) {
        result += Math.floor(Math.random() * 10);
      }
      return result;
    };

    // Helper function to generate random letters
    const generateRandomLetters = (count) => {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let result = '';
      for (let i = 0; i < count; i++) {
        result += letters.charAt(Math.floor(Math.random() * letters.length));
      }
      return result;
    };

    // Get product name prefix
    const productPrefix = getFirstThreeLetters(productName);

    // Get category name
    let categoryPrefix = 'CAT';
    if (categoryId) {
      const category = await CategoryModel.findById(categoryId);
      if (category && category.name) {
        categoryPrefix = getFirstThreeLetters(category.name);
      }
    }

    // Get brand name
    let brandPrefix = 'BRD';
    if (brandId) {
      // Handle array of brands - take the first one
      const actualBrandId = Array.isArray(brandId) ? brandId[0] : brandId;
      if (actualBrandId) {
        const brand = await BrandModel.findById(actualBrandId);
        if (brand && brand.name) {
          brandPrefix = getFirstThreeLetters(brand.name);
        }
      }
    }

    // Generate random components
    const randomNumbers = generateRandomNumbers(3);
    const randomLetters = generateRandomLetters(2);

    // Combine all parts
    let baseSKU = `${productPrefix}${categoryPrefix}${brandPrefix}${randomNumbers}${randomLetters}`;

    // Ensure uniqueness by checking against existing SKUs
    let finalSKU = baseSKU;
    let counter = 1;

    while (await ProductModel.findOne({ sku: finalSKU })) {
      // If SKU exists, append a counter
      finalSKU = `${baseSKU}${counter.toString().padStart(2, '0')}`;
      counter++;

      // Safety check to prevent infinite loop
      if (counter > 999) {
        // Generate completely new random components
        const newRandomNumbers = generateRandomNumbers(3);
        const newRandomLetters = generateRandomLetters(2);
        baseSKU = `${productPrefix}${categoryPrefix}${brandPrefix}${newRandomNumbers}${newRandomLetters}`;
        finalSKU = baseSKU;
        counter = 1;
      }
    }

    return finalSKU;
  } catch (error) {
    console.error('Error generating SKU:', error);
    // Fallback SKU generation if database queries fail
    return `PRD${Date.now().toString().slice(-6)}${Math.random()
      .toString(36)
      .substring(2, 4)
      .toUpperCase()}`;
  }
};

export default generateSKU;
