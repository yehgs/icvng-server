import ProductModel from '../models/product.model.js';
import SubCategoryModel from '../models/subCategory.model.js';
import CategoryModel from '../models/category.model.js';
import BrandModel from '../models/brand.model.js';
import generateSlug from '../utils/generateSlug.js';
import generateSKU from '../utils/generateSKU.js';

export const createProductController = async (request, response) => {
  try {
    const {
      name,
      image,
      weight,
      brand,
      compatibleSystem,
      producer,
      productType,
      roastLevel,
      roastOrigin,
      alcoholLevel,
      blend,
      featured,
      aromaticProfile,
      coffeeOrigin,
      intensity,
      category,
      coffeeRoastAreas,
      subCategory,
      tags,
      attributes,
      unit,
      packaging,
      stock,
      productAvailability,
      price,
      salePrice,
      price3weeksDelivery,
      price5weeksDelivery,
      btbPrice,
      btcPrice,
      discount,
      sku,
      description,
      shortDescription,
      additionalInfo,
      more_details,
      seoTitle,
      seoDescription,
      publish,
      relatedProducts,
      slug,
    } = request.body;

    // Validate required fields
    if (!name || !image[0] || !category || !shortDescription) {
      return response.status(400).json({
        message:
          'Enter required fields (name, image, category, price, shortDescription)',
        error: true,
        success: false,
      });
    }

    // Generate slug if not provided
    const generatedSlug = slug || generateSlug(name);

    const existingProduct = await ProductModel.findOne({
      slug: generatedSlug,
    });

    if (existingProduct) {
      return response.status(400).json({
        message: 'A Product with this slug already exists',
        error: true,
        success: false,
      });
    }

    // Generate SKU if not provided
    let generatedSKU = sku;
    if (!sku || sku.trim() === '') {
      generatedSKU = await generateSKU(name, category, brand);
    } else {
      // Check if provided SKU already exists
      const existingSKU = await ProductModel.findOne({ sku });
      if (existingSKU) {
        return response.status(400).json({
          message: 'A Product with this SKU already exists',
          error: true,
          success: false,
        });
      }
    }

    const userId = request.user._id;

    const product = new ProductModel({
      name,
      image,
      weight,
      brand,
      compatibleSystem,
      producer,
      productType,
      roastLevel,
      roastOrigin,
      alcoholLevel,
      blend,
      featured: featured || false,
      aromaticProfile,
      coffeeOrigin,
      intensity,
      coffeeRoastAreas,
      packaging,
      category,
      subCategory,
      tags,
      attributes,
      unit,
      stock: stock || 0,
      productAvailability:
        productAvailability !== undefined ? productAvailability : true,
      price: price || 0,
      salePrice: salePrice || 0,
      price3weeksDelivery: price3weeksDelivery || 0,
      price5weeksDelivery: price5weeksDelivery || 0,
      btbPrice: btbPrice || 0,
      btcPrice: btcPrice || 0,
      discount: discount || 0,
      sku: generatedSKU,
      description: description || '',
      shortDescription,
      additionalInfo: additionalInfo || '',
      more_details: more_details || {},
      createdBy: userId,
      updatedBy: userId,
      seoTitle: seoTitle || name,
      seoDescription:
        seoDescription || (description ? description.substring(0, 160) : ''),
      publish: publish || 'PENDING',
      relatedProducts: relatedProducts || [],
      slug: generatedSlug,
    });

    const saveProduct = await product.save();

    return response.json({
      message: 'Product Created Successfully',
      data: saveProduct,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

//header ajax search
export const searchProductController = async (request, response) => {
  try {
    const { q, limit = 5 } = request.query;

    if (!q) {
      return response.status(400).json({
        message: 'Search query is required',
        error: true,
        success: false,
      });
    }

    // Create the search query
    const searchQuery = {
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { shortDescription: { $regex: q, $options: 'i' } },
        { sku: { $regex: q, $options: 'i' } },
      ],
    };

    // Fetch products with populated fields
    const products = await ProductModel.find(searchQuery)
      .populate('brand', 'name')
      .populate('category', 'name')
      .populate('compatibleSystem', 'name')
      .populate('producer', 'name')
      .sort({ averageRating: -1 })
      .limit(parseInt(limit))
      .lean();

    return response.json({
      message: 'Products found',
      data: products,
      error: false,
      success: true,
      count: products.length,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// In product.controller.js
export const getCategoryStructureController = async (request, response) => {
  try {
    // Fetch categories with populated subcategories and brands
    const categories = await CategoryModel.find({}).sort({ name: 1 }).lean();

    // For each category, get its subcategories and product brands
    const enrichedCategories = await Promise.all(
      categories.map(async (category) => {
        const subcategories = await SubCategoryModel.find({
          category: category._id,
        })
          .sort({ name: 1 })
          .lean();

        // For each subcategory, get related brands through products
        const enrichedSubcategories = await Promise.all(
          subcategories.map(async (subcategory) => {
            // Find all products in this subcategory
            const products = await ProductModel.find({
              subCategory: subcategory._id,
            }).lean();

            // Extract unique brand IDs from products
            const brandIds = [];
            products.forEach((product) => {
              if (Array.isArray(product.brand)) {
                product.brand.forEach((brandId) => {
                  if (brandId && !brandIds.includes(brandId.toString())) {
                    brandIds.push(brandId.toString());
                  }
                });
              }
            });

            // Fetch brand details
            const subcategoryBrands = await BrandModel.find({
              _id: { $in: brandIds },
            })
              .sort({ name: 1 })
              .lean();

            return {
              ...subcategory,
              brands: subcategoryBrands || [],
            };
          })
        );

        // Get brands directly related to this category
        // Find all products that belong to this category, regardless of subcategory
        const allCategoryProducts = await ProductModel.find({
          category: category._id,
        }).lean();

        // If there are no subcategories, we need to gather all brands from products in this category
        const categoryBrandIds = [];
        allCategoryProducts.forEach((product) => {
          if (Array.isArray(product.brand)) {
            product.brand.forEach((brandId) => {
              if (brandId && !categoryBrandIds.includes(brandId.toString())) {
                categoryBrandIds.push(brandId.toString());
              }
            });
          }
        });

        // Fetch brand details
        const categoryBrands = await BrandModel.find({
          _id: { $in: categoryBrandIds },
        })
          .sort({ name: 1 })
          .lean();

        return {
          ...category,
          subcategories: enrichedSubcategories || [],
          brands: categoryBrands || [],
        };
      })
    );

    return response.json({
      message: 'Category structure fetched successfully',
      data: enrichedCategories,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getProductController = async (request, response) => {
  try {
    let { page, limit, search } = request.body;

    if (!page) {
      page = 1;
    }

    if (!limit) {
      limit = 10;
    }

    const query = search
      ? {
          $text: {
            $search: search,
          },
        }
      : {};

    const skip = (page - 1) * limit;

    const [data, totalCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Product data',
      error: false,
      success: true,
      totalCount: totalCount,
      totalNoPage: Math.ceil(totalCount / limit),
      data: data,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getProductDetails = async (request, response) => {
  try {
    const { productId } = request.body;

    if (!productId) {
      return response.status(400).json({
        message: 'provide product id',
        error: true,
        success: false,
      });
    }

    const product = await ProductModel.findOne({ _id: productId }).populate(
      'category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts'
    );

    if (!product) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'product details',
      data: product,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const updateProductDetails = async (request, response) => {
  try {
    const { _id, name, slug, sku, category, brand } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: 'provide product _id',
        error: true,
        success: false,
      });
    }

    // Get the existing product
    const existingProduct = await ProductModel.findById(_id);
    if (!existingProduct) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    const userId = request.user._id;
    let updateData = { ...request.body, updatedBy: userId };

    // Handle slug generation if name is updated but slug is not provided
    if (name && !slug) {
      const generatedSlug = generateSlug(name);

      // Check if the new slug would conflict with any existing product
      const existingSlugProduct = await ProductModel.findOne({
        slug: generatedSlug,
        _id: { $ne: _id }, // Exclude current product
      });

      if (existingSlugProduct) {
        return response.status(400).json({
          message: 'A Product with this slug already exists',
          error: true,
          success: false,
        });
      }

      updateData.slug = generatedSlug;
    }

    // Handle SKU generation if product doesn't have SKU or SKU is empty
    if (
      !existingProduct.sku ||
      existingProduct.sku.trim() === '' ||
      (sku && sku.trim() === '')
    ) {
      const productName = name || existingProduct.name;
      const productCategory = category || existingProduct.category;
      const productBrand = brand || existingProduct.brand;

      const generatedSKU = await generateSKU(
        productName,
        productCategory,
        productBrand
      );
      updateData.sku = generatedSKU;
    } else if (sku && sku !== existingProduct.sku) {
      // If a new SKU is provided and it's different from the existing one
      const existingSKUProduct = await ProductModel.findOne({
        sku: sku,
        _id: { $ne: _id }, // Exclude current product
      });

      if (existingSKUProduct) {
        return response.status(400).json({
          message: 'A Product with this SKU already exists',
          error: true,
          success: false,
        });
      }
    }

    const updateProduct = await ProductModel.findByIdAndUpdate(
      _id,
      updateData,
      { new: true }
    ).populate(
      'category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts'
    );

    return response.json({
      message: 'updated successfully',
      data: updateProduct,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const deleteProductDetails = async (request, response) => {
  try {
    const { _id } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: 'provide _id ',
        error: true,
        success: false,
      });
    }

    const deleteProduct = await ProductModel.deleteOne({ _id: _id });

    if (deleteProduct.deletedCount === 0) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Delete successfully',
      error: false,
      success: true,
      data: deleteProduct,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const searchProduct = async (request, response) => {
  try {
    let {
      search,
      page,
      limit,
      category,
      subCategory,
      brand,
      productType,
      roastLevel,
      intensity,
      blend,
      featured,
      productAvailability,
      minPrice,
      maxPrice,
      sort,
    } = request.body;

    // Default pagination values
    if (!page) page = 1;
    if (!limit) limit = 12;

    // Build query object
    const query = {};

    // Text search if provided
    if (search) {
      query.$text = { $search: search };
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Subcategory filter
    if (subCategory) {
      query.subCategory = subCategory;
    }

    // Brand filter
    if (brand) {
      // If brand is an array, query for any match
      if (Array.isArray(brand)) {
        query.brand = { $in: brand };
      } else {
        query.brand = brand;
      }
    }

    // Product type filter
    if (
      productType &&
      (Array.isArray(productType) ? productType.length > 0 : productType)
    ) {
      query.productType = Array.isArray(productType)
        ? { $in: productType }
        : productType;
    }

    // Roast level filter (for coffee products)
    if (
      roastLevel &&
      (Array.isArray(roastLevel) ? roastLevel.length > 0 : roastLevel)
    ) {
      query.roastLevel = Array.isArray(roastLevel)
        ? { $in: roastLevel }
        : roastLevel;
    }

    // Intensity filter (for coffee products)
    if (
      intensity &&
      (Array.isArray(intensity) ? intensity.length > 0 : intensity)
    ) {
      query.intensity = Array.isArray(intensity)
        ? { $in: intensity }
        : intensity;
    }

    // Blend filter (for coffee products)
    if (blend && (Array.isArray(blend) ? blend.length > 0 : blend)) {
      query.blend = Array.isArray(blend) ? { $in: blend } : blend;
    }

    // Featured filter
    if (featured !== undefined) {
      query.featured = featured;
    }

    // Product availability filter
    if (productAvailability !== undefined) {
      query.productAvailability = productAvailability;
    }

    // Price range filter
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};

      if (minPrice !== undefined) {
        query.price.$gte = Number(minPrice);
      }

      if (maxPrice !== undefined) {
        query.price.$lte = Number(maxPrice);
      }
    }

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Determine sort order
    let sortOption = { createdAt: -1 }; // Default sort by newest

    if (sort) {
      switch (sort) {
        case 'price-low':
          sortOption = { price: 1 };
          break;
        case 'price-high':
          sortOption = { price: -1 };
          break;
        case 'popularity':
          sortOption = { averageRating: -1 };
          break;
        case 'alphabet':
          sortOption = { name: 1 };
          break;
        case 'featured':
          sortOption = { featured: -1, createdAt: -1 };
          break;
      }
    }

    // Execute query with all filters
    const [data, dataCount] = await Promise.all([
      ProductModel.find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Product data',
      error: false,
      success: true,
      data: data,
      totalCount: dataCount,
      totalPage: Math.ceil(dataCount / limit),
      page: page,
      limit: limit,
    });
  } catch (error) {
    console.error('Search product error:', error);
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get products by category
export const getProductByCategory = async (request, response) => {
  try {
    const { categoryId, page, limit } = request.body;

    if (!categoryId) {
      return response.status(400).json({
        message: 'Category ID is required',
        error: true,
        success: false,
      });
    }

    const pageNumber = page || 1;
    const pageSize = limit || 12;
    const skip = (pageNumber - 1) * pageSize;

    const [data, dataCount] = await Promise.all([
      ProductModel.find({ category: categoryId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts'
        ),
      ProductModel.countDocuments({ category: categoryId }),
    ]);

    return response.json({
      message: 'Products by category',
      error: false,
      success: true,
      data: data,
      totalCount: dataCount,
      totalPage: Math.ceil(dataCount / pageSize),
      page: pageNumber,
      limit: pageSize,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get products by category and subcategory
export const getProductByCategoryAndSubCategory = async (request, response) => {
  try {
    const { categoryId, subCategoryId, page, limit } = request.body;

    if (!categoryId || !subCategoryId) {
      return response.status(400).json({
        message: 'Category ID and Subcategory ID are required',
        error: true,
        success: false,
      });
    }

    const pageNumber = page || 1;
    const pageSize = limit || 12;
    const skip = (pageNumber - 1) * pageSize;

    const [data, dataCount] = await Promise.all([
      ProductModel.find({
        category: categoryId,
        subCategory: subCategoryId,
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts'
        ),
      ProductModel.countDocuments({
        category: categoryId,
        subCategory: subCategoryId,
      }),
    ]);

    return response.json({
      message: 'Products by category and subcategory',
      error: false,
      success: true,
      data: data,
      totalCount: dataCount,
      totalPage: Math.ceil(dataCount / pageSize),
      page: pageNumber,
      limit: pageSize,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get products by brand
export const getProductByBrand = async (request, response) => {
  try {
    const { brandId, page, limit } = request.body;

    if (!brandId) {
      return response.status(400).json({
        message: 'Brand ID is required',
        error: true,
        success: false,
      });
    }

    const pageNumber = page || 1;
    const pageSize = limit || 12;
    const skip = (pageNumber - 1) * pageSize;

    const [data, dataCount] = await Promise.all([
      ProductModel.find({ brand: brandId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts'
        ),
      ProductModel.countDocuments({ brand: brandId }),
    ]);

    return response.json({
      message: 'Products by brand',
      error: false,
      success: true,
      data: data,
      totalCount: dataCount,
      totalPage: Math.ceil(dataCount / pageSize),
      page: pageNumber,
      limit: pageSize,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get featured products
export const getFeaturedProducts = async (request, response) => {
  try {
    const { page, limit } = request.body;

    const pageNumber = page || 1;
    const pageSize = limit || 12;
    const skip = (pageNumber - 1) * pageSize;

    const [data, dataCount] = await Promise.all([
      ProductModel.find({ featured: true, productAvailability: true })
        .sort({ averageRating: -1, createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments({
        featured: true,
        productAvailability: true,
      }),
    ]);

    return response.json({
      message: 'Featured products',
      error: false,
      success: true,
      data: data,
      totalCount: dataCount,
      totalPage: Math.ceil(dataCount / pageSize),
      page: pageNumber,
      limit: pageSize,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get products by availability
export const getProductsByAvailability = async (request, response) => {
  try {
    const { available, page, limit } = request.body;

    const pageNumber = page || 1;
    const pageSize = limit || 12;
    const skip = (pageNumber - 1) * pageSize;

    const query = { productAvailability: available !== false };

    const [data, dataCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: `Products ${available !== false ? 'available' : 'unavailable'}`,
      error: false,
      success: true,
      data: data,
      totalCount: dataCount,
      totalPage: Math.ceil(dataCount / pageSize),
      page: pageNumber,
      limit: pageSize,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Add this to your getProducts controller
export const getProducts = async (request, response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      brand,
      productType,
      excludeDirectPricing, // NEW PARAMETER
    } = request.body || request.query;

    const query = {};

    // Your existing filters...
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }

    if (category) {
      query.category = category;
    }

    if (brand) {
      query.brand = { $in: [brand] }; // Brand is an array
    }

    if (productType) {
      query.productType = productType;
    }

    // NEW: Exclude products with direct pricing
    if (excludeDirectPricing === 'true' || excludeDirectPricing === true) {
      const DirectPricingModel = (
        await import('../models/direct-pricing.model.js')
      ).default;
      const productsWithDirectPricing = await DirectPricingModel.find({
        isActive: true,
      }).distinct('product');

      query._id = { $nin: productsWithDirectPricing };
    }

    const skip = (page - 1) * limit;

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .populate('brand', 'name')
        .populate('category', 'name')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Products retrieved successfully',
      data: products,
      totalCount,
      totalNoPage: Math.ceil(totalCount / limit),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get products error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to get products',
      error: true,
      success: false,
    });
  }
};

// Get products by SKU
export const getProductBySKU = async (request, response) => {
  try {
    const { sku } = request.body;

    if (!sku) {
      return response.status(400).json({
        message: 'SKU is required',
        error: true,
        success: false,
      });
    }

    const product = await ProductModel.findOne({ sku }).populate(
      'category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts'
    );

    if (!product) {
      return response.status(404).json({
        message: 'Product not found with this SKU',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Product found',
      data: product,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
