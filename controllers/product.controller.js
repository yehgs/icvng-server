import ProductModel from '../models/product.model.js';
import SubCategoryModel from '../models/subCategory.model.js';
import CategoryModel from '../models/category.model.js';
import BrandModel from '../models/brand.model.js';
import generateSlug from '../utils/generateSlug.js';

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
      blend,
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
      price,
      salePrice,
      btbPrice,
      btcPrice,
      discount,
      description,
      shortDescription,
      additionalInfo,
      more_details,
      seoTitle,
      seoDescription,
      publish,
      slug,
    } = request.body;

    // Validate required fields
    if (!name || !image[0] || !category || !price || !shortDescription) {
      return response.status(400).json({
        message: 'Enter required fields',
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
      blend,
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
      stock,
      price,
      salePrice,
      btbPrice,
      btcPrice,
      discount,
      description,
      shortDescription,
      additionalInfo,
      more_details,
      createdBy: userId,
      updatedBy: userId,
      seoTitle: seoTitle || name,
      seoDescription: seoDescription || description.substring(0, 160),
      publish: publish || 'PENDING',
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
      ],
    };

    // Fetch products with populated fields
    const products = await ProductModel.find(searchQuery)
      .populate('brand', 'name')
      .populate('category', 'name')
      .populate('compatibleSystem', 'name')
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

        // // Get brands directly related to category through products (not through subcategories)
        // // These are products that belong to the category but don't have a subcategory
        // const productsInCategory = await ProductModel.find({
        //   category: category._id,
        //   subCategory: { $exists: false },
        // }).lean();

        // // Extract unique brand IDs from these products
        // const categoryBrandIds = [
        //   ...new Set(productsInCategory.flatMap((product) => product.brand)),
        // ];

        // THIS IS THE IMPORTANT PART - Get brands directly related to this category
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
          'category subCategory brand tags attributes compatibleSystem producer'
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

export const getProductByCategoryAndSubCategory = async (request, response) => {
  try {
    const { categoryId, subCategoryId, page, limit } = request.body;

    if (!categoryId || !subCategoryId) {
      return response.status(400).json({
        message: 'Provide categoryId and subCategoryId',
        error: true,
        success: false,
      });
    }

    const currentPage = page || 1;
    const pageLimit = limit || 10;

    const query = {
      category: { $in: categoryId },
      subCategory: { $in: subCategoryId },
    };

    const skip = (currentPage - 1) * pageLimit;

    const [data, dataCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Product list',
      data: data,
      totalCount: dataCount,
      page: currentPage,
      limit: pageLimit,
      success: true,
      error: false,
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
      'category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy'
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
    const { _id, name, slug } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: 'provide product _id',
        error: true,
        success: false,
      });
    }
    const userId = request.user._id;
    // If name is updated but slug is not provided, regenerate slug
    let updateData = { ...request.body, updatedBy: userId };
    if (name && !slug) {
      const generatedSlug = generateSlug(name);

      // Check if the new slug would conflict with any existing product
      const existingProduct = await ProductModel.findOne({
        slug: generatedSlug,
        _id: { $ne: _id }, // Exclude current product
      });

      if (existingProduct) {
        return response.status(400).json({
          message: 'A Product with this slug already exists',
          error: true,
          success: false,
        });
      }

      updateData.slug = generatedSlug;
    }

    const updateProduct = await ProductModel.findByIdAndUpdate(
      _id,
      updateData,
      { new: true }
    ).populate(
      'category subCategory brand tags attributes compatibleSystem producer'
    );

    if (!updateProduct) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

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
    let { search, page, limit } = request.body;

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

    const [data, dataCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
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
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Advanced e-commerce filter API
export const advancedFilterProducts = async (request, response) => {
  try {
    const {
      categoryId,
      subCategoryId,
      brandId,
      producerId,
      productType,
      roastLevel,
      attributeIds,
      tagIds,
      compatibleSystemId,
      priceRange,
      rating,
      inStock,
      sort,
      search,
      page = 1,
      limit = 10,
    } = request.body;

    // Build query object
    let query = {};

    // Text search
    if (search) {
      query.$text = { $search: search };
    }

    // Category and subcategory filter
    if (categoryId) {
      query.category = {
        $in: Array.isArray(categoryId) ? categoryId : [categoryId],
      };
    }

    if (subCategoryId) {
      query.subCategory = {
        $in: Array.isArray(subCategoryId) ? subCategoryId : [subCategoryId],
      };
    }

    // Brand filter
    if (brandId) {
      query.brand = { $in: Array.isArray(brandId) ? brandId : [brandId] };
    }

    // Producer filter
    if (producerId) {
      query.producer = producerId;
    }

    // Product type filter
    if (productType) {
      query.productType = {
        $in: Array.isArray(productType) ? productType : [productType],
      };
    }

    // Roast level filter
    if (roastLevel) {
      query.roastLevel = {
        $in: Array.isArray(roastLevel) ? roastLevel : [roastLevel],
      };
    }

    // Attributes filter
    if (attributeIds && attributeIds.length > 0) {
      query.attributes = { $in: attributeIds };
    }

    // Tags filter
    if (tagIds && tagIds.length > 0) {
      query.tags = { $in: tagIds };
    }

    // Compatible system filter
    if (compatibleSystemId) {
      query.compatibleSystem = compatibleSystemId;
    }

    // Price range filter
    if (priceRange) {
      query.price = {};
      if (priceRange.min !== undefined) {
        query.price.$gte = priceRange.min;
      }
      if (priceRange.max !== undefined) {
        query.price.$lte = priceRange.max;
      }
    }

    // Rating filter
    if (rating) {
      query.averageRating = { $gte: parseFloat(rating) };
    }

    // Stock filter
    if (inStock !== undefined) {
      query.stock = inStock ? { $gt: 0 } : { $lte: 0 };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Determine sort order
    let sortOption = { createdAt: -1 }; // Default sort by newest

    if (sort) {
      switch (sort) {
        case 'price_asc':
          sortOption = { price: 1 };
          break;
        case 'price_desc':
          sortOption = { price: -1 };
          break;
        case 'name_asc':
          sortOption = { name: 1 };
          break;
        case 'name_desc':
          sortOption = { name: -1 };
          break;
        case 'rating':
          sortOption = { averageRating: -1 };
          break;
        case 'popular':
          // Assuming you might add a popularity field in the future
          sortOption = { averageRating: -1, createdAt: -1 };
          break;
        default:
          sortOption = { createdAt: -1 };
      }
    }

    // Execute query with pagination
    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments(query),
    ]);

    // Get available filters for the current query context (without pagination)
    // This helps to show remaining filter options to users
    const baseQuery = { ...query };

    // Remove specific filters to get available options
    delete baseQuery.brand;
    delete baseQuery.attributes;
    delete baseQuery.tags;
    delete baseQuery.productType;
    delete baseQuery.roastLevel;

    // Get available filter options
    const [availableBrands, availableAttributes, availableTags, priceStats] =
      await Promise.all([
        // Available brands for current filter
        ProductModel.find(baseQuery).distinct('brand'),
        // Available attributes for current filter
        ProductModel.find(baseQuery).distinct('attributes'),
        // Available tags for current filter
        ProductModel.find(baseQuery).distinct('tags'),
        // Price stats for range filters
        ProductModel.aggregate([
          { $match: baseQuery },
          {
            $group: {
              _id: null,
              minPrice: { $min: '$price' },
              maxPrice: { $max: '$price' },
              avgPrice: { $avg: '$price' },
            },
          },
        ]).exec(),
      ]);

    return response.json({
      message: 'Filtered products',
      data: products,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
      filters: {
        availableBrands,
        availableAttributes,
        availableTags,
        priceRange:
          priceStats.length > 0
            ? {
                min: priceStats[0].minPrice,
                max: priceStats[0].maxPrice,
                avg: priceStats[0].avgPrice,
              }
            : null,
      },
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

export const getProductByBrand = async (request, response) => {
  try {
    const { brandId } = request.body;
    let { page = 1, limit = 10 } = request.body;

    if (!brandId) {
      return response.status(400).json({
        message: 'provide brand id',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    const [products, totalCount] = await Promise.all([
      ProductModel.find({
        brand: { $in: brandId },
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments({
        brand: { $in: brandId },
      }),
    ]);

    return response.json({
      message: 'brand product list',
      data: products,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

// Modify the getProductByCategory function to include subcategory information
export const getProductByCategory = async (request, response) => {
  try {
    const { id } = request.body;
    let { page = 1, limit = 15 } = request.body;

    if (!id) {
      return response.status(400).json({
        message: 'provide category id',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    // Get the category details first
    const category = await CategoryModel.findById(id);

    if (!category) {
      return response.status(404).json({
        message: 'Category not found',
        error: true,
        success: false,
      });
    }

    // Get all subcategories for this category
    const subcategories = await SubCategoryModel.find({ categoryId: id });

    // Get all products in this category
    const [products, totalCount] = await Promise.all([
      ProductModel.find({
        category: { $in: id },
      })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments({
        category: { $in: id },
      }),
    ]);

    // Get all brands used in these products
    const brandIds = [
      ...new Set(products.map((product) => String(product.brand))),
    ];
    const brands = await BrandModel.find({ _id: { $in: brandIds } });

    return response.json({
      message: 'category product list',
      data: products,
      category: category,
      subcategories: subcategories,
      brands: brands,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

// Add a new function to get products by category slug instead of ID
export const getProductByCategorySlug = async (request, response) => {
  try {
    const { slug } = request.params;
    let { page = 1, limit = 15 } = request.query;

    // Convert page and limit to numbers
    page = parseInt(page);
    limit = parseInt(limit);

    if (!slug) {
      return response.status(400).json({
        message: 'Category slug is required',
        error: true,
        success: false,
      });
    }

    // Find the category by slug
    const category = await CategoryModel.findOne({ slug: slug });

    if (!category) {
      return response.status(404).json({
        message: 'Category not found',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    // Get all subcategories for this category
    const subcategories = await SubCategoryModel.find({
      categoryId: category._id,
    });

    // Get products
    const [products, totalCount] = await Promise.all([
      ProductModel.find({
        category: category._id,
      })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments({
        category: category._id,
      }),
    ]);

    // Get all brands used in these products
    const brandIds = [
      ...new Set(products.map((product) => String(product.brand))),
    ];
    const brands = await BrandModel.find({ _id: { $in: brandIds } });

    return response.json({
      message: 'category product list by slug',
      data: products,
      category: category,
      subcategories: subcategories,
      brands: brands,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

// Add a new function to get products by category and subcategory slugs
export const getProductByCategoryAndSubCategorySlug = async (
  request,
  response
) => {
  try {
    const { categorySlug, subCategorySlug } = request.params;
    let { page = 1, limit = 15 } = request.query;

    // Convert page and limit to numbers
    page = parseInt(page);
    limit = parseInt(limit);

    if (!categorySlug || !subCategorySlug) {
      return response.status(400).json({
        message: 'Category and subcategory slugs are required',
        error: true,
        success: false,
      });
    }

    // Find the category and subcategory by slugs
    const category = await CategoryModel.findOne({ slug: categorySlug });

    if (!category) {
      return response.status(404).json({
        message: 'Category not found',
        error: true,
        success: false,
      });
    }

    const subCategory = await SubCategoryModel.findOne({
      slug: subCategorySlug,
      categoryId: category._id,
    });

    if (!subCategory) {
      return response.status(404).json({
        message: 'Subcategory not found',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    // Get products
    const [products, totalCount] = await Promise.all([
      ProductModel.find({
        category: category._id,
        subCategory: subCategory._id,
      })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments({
        category: category._id,
        subCategory: subCategory._id,
      }),
    ]);

    // Get all brands used in these products
    const brandIds = [
      ...new Set(products.map((product) => String(product.brand))),
    ];
    const brands = await BrandModel.find({ _id: { $in: brandIds } });

    return response.json({
      message: 'products by category and subcategory',
      data: products,
      category: category,
      subCategory: subCategory,
      brands: brands,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

// Add a new function to get products by category, subcategory and brand slugs
export const getProductsByCategorySubcategoryAndBrand = async (
  request,
  response
) => {
  try {
    const { categorySlug, subCategorySlug, brandSlug } = request.params;
    let { page = 1, limit = 15 } = request.query;

    // Convert page and limit to numbers
    page = parseInt(page);
    limit = parseInt(limit);

    // Validate parameters
    if (!categorySlug || !brandSlug) {
      return response.status(400).json({
        message: 'Category and brand slugs are required',
        error: true,
        success: false,
      });
    }

    // Find entities by slugs
    const category = await CategoryModel.findOne({ slug: categorySlug });
    if (!category) {
      return response.status(404).json({
        message: 'Category not found',
        error: true,
        success: false,
      });
    }

    let subCategory = null;
    if (subCategorySlug) {
      subCategory = await SubCategoryModel.findOne({
        slug: subCategorySlug,
        categoryId: category._id,
      });

      if (!subCategory) {
        return response.status(404).json({
          message: 'Subcategory not found',
          error: true,
          success: false,
        });
      }
    }

    const brand = await BrandModel.findOne({ slug: brandSlug });
    if (!brand) {
      return response.status(404).json({
        message: 'Brand not found',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    // Build query based on whether subcategory was provided
    const query = subCategory
      ? {
          category: category._id,
          subCategory: subCategory._id,
          brand: brand._id,
        }
      : {
          category: category._id,
          brand: brand._id,
        };

    // Get products
    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'filtered products',
      data: products,
      category,
      subCategory,
      brand,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

export const getProductByCategoryAndBrand = async (request, response) => {
  try {
    const { categoryId, brandId } = request.body;
    let { page = 1, limit = 10 } = request.body;

    if (!categoryId || !brandId) {
      return response.status(400).json({
        message: 'provide both category id and brand id',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    const query = {
      category: { $in: categoryId },
      brand: { $in: brandId },
    };

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'category and brand product list',
      data: products,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

export const getProductBySubCategoryAndBrand = async (request, response) => {
  try {
    const { subCategoryId, brandId } = request.body;
    let { page = 1, limit = 10 } = request.body;

    if (!subCategoryId || !brandId) {
      return response.status(400).json({
        message: 'provide both subcategory id and brand id',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    const query = {
      subCategory: { $in: subCategoryId },
      brand: { $in: brandId },
    };

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'subcategory and brand product list',
      data: products,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

export const getProductByAttributes = async (request, response) => {
  try {
    const { attributeIds } = request.body;
    let { page = 1, limit = 10 } = request.body;

    if (!attributeIds || !Array.isArray(attributeIds)) {
      return response.status(400).json({
        message: 'provide attribute ids as an array',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    const query = {
      attributes: { $in: attributeIds },
    };

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'attributes filtered product list',
      data: products,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

// New endpoint: Get products by roast level (for coffee products)
export const getProductByRoastLevel = async (request, response) => {
  try {
    const { roastLevel } = request.body;
    let { page = 1, limit = 10 } = request.body;

    if (!roastLevel) {
      return response.status(400).json({
        message: 'provide roast level',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    const query = {
      roastLevel: roastLevel,
      productType: 'COFFEE',
    };

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: `${roastLevel} roast coffee products`,
      data: products,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

// New endpoint: Get products by producer
export const getProductByProducer = async (request, response) => {
  try {
    const { producerId } = request.body;
    let { page = 1, limit = 10 } = request.body;

    if (!producerId) {
      return response.status(400).json({
        message: 'provide producer id',
        error: true,
        success: false,
      });
    }

    const skip = (page - 1) * limit;

    const query = {
      producer: producerId,
    };

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'category subCategory brand tags attributes compatibleSystem producer'
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: 'producer product list',
      data: products,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit,
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

// Update product rating
export const updateProductRating = async (request, response) => {
  try {
    const { productId, ratingId } = request.body;

    if (!productId || !ratingId) {
      return response.status(400).json({
        message: 'Provide both product ID and rating ID',
        error: true,
        success: false,
      });
    }

    // Add rating to product's ratings array
    const product = await ProductModel.findByIdAndUpdate(
      productId,
      { $addToSet: { ratings: ratingId } },
      { new: true }
    );

    if (!product) {
      return response.status(404).json({
        message: 'Product not found',
        error: true,
        success: false,
      });
    }

    // Calculate new average rating
    // Note: This assumes you have a Rating model with a 'value' field
    const populatedProduct = await ProductModel.findById(productId).populate(
      'ratings'
    );

    if (populatedProduct.ratings && populatedProduct.ratings.length > 0) {
      const totalRating = populatedProduct.ratings.reduce(
        (sum, rating) => sum + rating.value,
        0
      );
      const averageRating = totalRating / populatedProduct.ratings.length;

      // Update the average rating
      await ProductModel.findByIdAndUpdate(productId, {
        averageRating: parseFloat(averageRating.toFixed(1)),
      });
    }

    return response.json({
      message: 'Product rating updated successfully',
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
// New API controller function to fetch data for mega menu
export const getMegaMenuData = async (request, response) => {
  try {
    const { categoryId } = request.params;

    if (!categoryId) {
      return response.status(400).json({
        message: 'Category ID is required',
        error: true,
        success: false,
      });
    }

    // Step 1: Get the category details
    const category = await CategoryModel.findById(categoryId);

    if (!category) {
      return response.status(404).json({
        message: 'Category not found',
        error: true,
        success: false,
      });
    }

    // Step 2: Get subcategories for this category
    const subCategories = await SubCategoryModel.find({
      categoryId: categoryId,
    });

    // If there are no subcategories, get brands directly related to this category
    if (subCategories.length === 0) {
      // Get brands that have products in this category
      const productsInCategory = await ProductModel.find({
        category: categoryId,
      });
      const brandIds = [
        ...new Set(productsInCategory.map((product) => String(product.brand))),
      ];

      const brands = await BrandModel.find({ _id: { $in: brandIds } });

      return response.json({
        message: 'Mega menu data retrieved successfully',
        subCategories: [],
        brands: brands,
        success: true,
        error: false,
      });
    }
    // If there are subcategories, get brands for each subcategory
    else {
      // Get brands for each subcategory
      const subcategoriesWithBrands = await Promise.all(
        subCategories.map(async (subCategory) => {
          // Get products in this subcategory
          const productsInSubcategory = await ProductModel.find({
            subCategory: subCategory._id,
          });

          // Extract brand IDs
          const brandIds = [
            ...new Set(
              productsInSubcategory.map((product) => String(product.brand))
            ),
          ];

          // Get brand details
          const brands = await BrandModel.find({ _id: { $in: brandIds } });

          // Return subcategory with its brands
          return {
            ...subCategory.toObject(),
            brands: brands,
          };
        })
      );

      return response.json({
        message: 'Mega menu data retrieved successfully',
        subCategories: subcategoriesWithBrands,
        brands: [],
        success: true,
        error: false,
      });
    }
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
