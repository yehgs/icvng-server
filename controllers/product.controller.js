import mongoose from "mongoose";
import ProductModel from "../models/product.model.js";
import SubCategoryModel from "../models/subCategory.model.js";
import CategoryModel from "../models/category.model.js";
import BrandModel from "../models/brand.model.js";
import generateSlug from "../utils/generateSlug.js";
import generateSKU from "../utils/generateSKU.js";
import { logActivity } from "../utils/activityLogger.js";

// ─── Client Visibility Rule ────────────────────────────────────────────────
// A product is shown to customers if it is PUBLISHED and at least one of:
//   (a) warehouseStock.onlineStock > 0  (in-house stock, regular price works)
//   (b) partnerStock.enabled === true   (partner/supplier manages stock)
//   (c) price3weeksDelivery > 0         (special order option available)
//   (d) price5weeksDelivery > 0         (special order option available)
//
// Products with ONLY btcPrice and 0 online stock and no partner stock are hidden
// because the customer would see "Pricing Unavailable" with no way to order.
// ──────────────────────────────────────────────────────────────────────────
const CLIENT_VISIBILITY_FILTER = {
  publish: "PUBLISHED",
  $or: [
    { "warehouseStock.onlineStock": { $gt: 0 } },
    { "partnerStock.enabled": true },
    { price3weeksDelivery: { $gt: 0 } },
    { price5weeksDelivery: { $gt: 0 } },
  ],
};

// JS-level helper (used for admin visibility badge)
const shouldDisplayProduct = (product) => {
  const onlineStock = product.warehouseStock?.onlineStock || 0;
  const isPartner = product.partnerStock?.enabled === true;
  const has3WeeksPrice = product.price3weeksDelivery > 0;
  const has5WeeksPrice = product.price5weeksDelivery > 0;
  const hasImage = product.image && product.image.length > 0;

  if (!hasImage) return false;

  // Has delivery option regardless of stock
  if (has3WeeksPrice || has5WeeksPrice) return true;

  // Partner product — supplier manages availability
  if (isPartner) return true;

  // Regular stock available
  if (onlineStock > 0) return true;

  // No stock, no partner, no delivery option → hidden from clients
  return false;
};

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
          "Enter required fields (name, image, category, price, shortDescription)",
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
        message: "A Product with this slug already exists",
        error: true,
        success: false,
      });
    }

    // Generate SKU if not provided
    let generatedSKU = sku;
    if (!sku || sku.trim() === "") {
      generatedSKU = await generateSKU(name, category, brand);
    } else {
      // Check if provided SKU already exists
      const existingSKU = await ProductModel.findOne({ sku });
      if (existingSKU) {
        return response.status(400).json({
          message: "A Product with this SKU already exists",
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
      brand: Array.isArray(brand) ? brand.filter(v => v && v !== "") : brand,
      compatibleSystem: compatibleSystem || null,
      producer: producer || null,
      productType,
      roastLevel: roastLevel || undefined,
      roastOrigin: roastOrigin || undefined,
      alcoholLevel: alcoholLevel || undefined,
      blend: blend || undefined,
      featured: featured || false,
      aromaticProfile: aromaticProfile || undefined,
      coffeeOrigin: coffeeOrigin || undefined,
      intensity: intensity || undefined,
      coffeeRoastAreas: coffeeRoastAreas || null,
      packaging: packaging || undefined,
      category,
      subCategory: subCategory || null,
      tags: Array.isArray(tags) ? tags.filter(v => v && v !== "") : tags,
      attributes: Array.isArray(attributes) ? attributes.filter(v => v && v !== "") : attributes,
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
      description: description || "",
      shortDescription,
      additionalInfo: additionalInfo || "",
      more_details: more_details || {},
      createdBy: userId,
      updatedBy: userId,
      seoTitle: seoTitle || name,
      seoDescription:
        seoDescription || (description ? description.substring(0, 160) : ""),
      publish: publish || "PENDING",
      relatedProducts: relatedProducts || [],
      slug: generatedSlug,
    });

    const saveProduct = await product.save();

    // Log activity (non-blocking)
    logActivity({
      userId: request.user?._id,
      action: 'PRODUCT_CREATE',
      description: `Created product: ${saveProduct.name}`,
      resourceType: 'Product',
      resourceId: saveProduct._id,
      resourceName: saveProduct.name,
      req: request,
    });

    return response.json({
      message: "Product Created Successfully",
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
        message: "Search query is required",
        error: true,
        success: false,
      });
    }

    // Search query — combined with client visibility rules using $and so both
    // $or conditions (visibility + text search) coexist without key collision
    const searchQuery = {
      publish: "PUBLISHED",
      $and: [
        // Visibility: must have stock, partner, or delivery price
        {
          $or: [
            { "warehouseStock.onlineStock": { $gt: 0 } },
            { "partnerStock.enabled": true },
            { price3weeksDelivery: { $gt: 0 } },
            { price5weeksDelivery: { $gt: 0 } },
          ],
        },
        // Text match
        {
          $or: [
            { name: { $regex: q, $options: "i" } },
            { description: { $regex: q, $options: "i" } },
            { shortDescription: { $regex: q, $options: "i" } },
            { sku: { $regex: q, $options: "i" } },
          ],
        },
      ],
    };

    // Fetch products with populated fields
    const products = await ProductModel.find(searchQuery)
      .populate("brand", "name")
      .populate("category", "name")
      .populate("compatibleSystem", "name")
      .populate("producer", "name")
      .sort({ averageRating: -1 })
      .limit(parseInt(limit))
      .lean();

    return response.json({
      message: "Products found",
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
          }),
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
      }),
    );

    return response.json({
      message: "Category structure fetched successfully",
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

export const getProductControllerAdmin = async (request, response) => {
  try {
    let { page, limit, search, category, brand, publish, productType, lowStock, priceFilter, hiddenFromShop } = request.body;

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;

    // Build query — supports search (regex), category, brand, publish, productType, lowStock, priceFilter
    const query = {};
    const andConditions = [];

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      andConditions.push({ $or: [
        { name: { $regex: escaped, $options: "i" } },
        { sku: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
      ]});
    }

    if (category) {
      try { andConditions.push({ category: new mongoose.Types.ObjectId(category) }); } catch {}
    }

    if (brand) {
      try { andConditions.push({ brand: { $in: [new mongoose.Types.ObjectId(brand)] } }); } catch {}
    }

    if (publish) {
      andConditions.push({ publish });
    }

    if (productType) {
      andConditions.push({ productType });
    }

    // Low stock filter — online stock only
    if (lowStock === 'true') {
      andConditions.push({ $or: [
        { "warehouseStock.onlineStock": { $gt: 0, $lte: 5 } },
        { "partnerStock.enabled": true, "partnerStock.quantity": { $gt: 0, $lte: 5 } },
      ]});
    } else if (lowStock === 'critical') {
      andConditions.push({ $or: [
        { "warehouseStock.onlineStock": 0 },
        { "partnerStock.enabled": true, "partnerStock.quantity": 0 },
      ]});
    }

    // Price volume filter
    if (priceFilter === 'hasbtc') {
      andConditions.push({ btcPrice: { $gt: 0 } });
    } else if (priceFilter === 'has3week') {
      andConditions.push({ price3weeksDelivery: { $gt: 0 } });
    } else if (priceFilter === 'has5week') {
      andConditions.push({ price5weeksDelivery: { $gt: 0 } });
    } else if (priceFilter === 'noPrice') {
      andConditions.push(
        { $or: [{ btcPrice: { $lte: 0 } }, { btcPrice: null }] },
        { $or: [{ price3weeksDelivery: { $lte: 0 } }, { price3weeksDelivery: null }] },
        { $or: [{ price5weeksDelivery: { $lte: 0 } }, { price5weeksDelivery: null }] },
      );
    }

    // Hidden from shop filter — products that are PUBLISHED but invisible to clients
    // Hidden = onlineStock=0 AND not partner AND no 3/5-week delivery price
    if (hiddenFromShop === 'true') {
      andConditions.push({ publish: 'PUBLISHED' });
      andConditions.push({ 'warehouseStock.onlineStock': { $lte: 0 } });
      andConditions.push({ 'partnerStock.enabled': { $ne: true } });
      andConditions.push({ price3weeksDelivery: { $lte: 0 } });
      andConditions.push({ price5weeksDelivery: { $lte: 0 } });
    } else if (hiddenFromShop === 'false') {
      // Visible = matches the CLIENT_VISIBILITY_FILTER
      andConditions.push({
        $or: [
          { 'warehouseStock.onlineStock': { $gt: 0 } },
          { 'partnerStock.enabled': true },
          { price3weeksDelivery: { $gt: 0 } },
          { price5weeksDelivery: { $gt: 0 } },
        ],
      });
    }

    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    const skip = (page - 1) * limit;

    const [data, totalCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy")
        .populate("partnerStock.supplier", "name contactPerson.phone"),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: "Product data",
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

// Controller 1: getProductController
export const getProductController = async (request, response) => {
  try {
    let { page, limit, search, category, brand, productType, compatibleSystem } = request.body;

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;

    // Build query with mandatory price AND weight filter
    const query = {};

    // CRITICAL: Only show products that are visible to clients
    const andConditions = [CLIENT_VISIBILITY_FILTER];

    // Search by name/sku using regex (works for partial matches)
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      andConditions.push({
        $or: [
          { name: { $regex: escaped, $options: "i" } },
          { sku: { $regex: escaped, $options: "i" } },
        ],
      });
    }

    if (category) {
      try { andConditions.push({ category: new mongoose.Types.ObjectId(category) }); } catch {}
    }

    if (brand) {
      try { andConditions.push({ brand: { $in: [new mongoose.Types.ObjectId(brand)] } }); } catch {}
    }

    if (productType) {
      andConditions.push({ productType });
    }

    if (compatibleSystem) {
      try { andConditions.push({ compatibleSystem: new mongoose.Types.ObjectId(compatibleSystem) }); } catch {}
    }

    query.$and = andConditions;

    const skip = (page - 1) * limit;

    const [data, totalCount] = await Promise.all([
      ProductModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        // ✅ CRITICAL: Populate category with name field
        .populate("category", "name")
        .populate("subCategory", "name")
        .populate("brand", "name")
        .populate("tags", "name")
        .populate("attributes", "name")
        .populate("compatibleSystem", "name")
        .populate("producer", "name")
        .populate("createdBy", "name")
        .populate("updatedBy", "name"),
      ProductModel.countDocuments(query),
    ]);

    console.log(`getProductController: Returning ${data.length} products`);
    if (data.length > 0) {
      console.log("Sample product category:", data[0].category);
    }

    return response.json({
      message: "Product data",
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
        message: "provide product id",
        error: true,
        success: false,
      });
    }

    // Include CLIENT_VISIBILITY_FILTER so hidden products (no stock, no partner,
    // no delivery price) return 404 instead of the "Pricing Unavailable" page
    const product = await ProductModel.findOne({
      _id: productId,
      ...CLIENT_VISIBILITY_FILTER,
    }).populate(
      "category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts",
    );

    if (!product) {
      return response.status(404).json({
        message: "Product not found or not available",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "product details",
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
        message: "provide product _id",
        error: true,
        success: false,
      });
    }

    // Get the existing product
    const existingProduct = await ProductModel.findById(_id);
    if (!existingProduct) {
      return response.status(404).json({
        message: "Product not found",
        error: true,
        success: false,
      });
    }

    const userId = request.user._id;
    let updateData = { ...request.body, updatedBy: userId };

    // Sanitize ObjectId reference fields — Mongoose throws BSONError if they are ""
    // Convert empty strings to null for all ref fields so Mongoose clears them cleanly
    const objectIdFields = [
      "compatibleSystem", "producer", "supplier",
      "category", "subCategory",
    ];
    objectIdFields.forEach((field) => {
      if (updateData[field] === "" || updateData[field] === null) {
        updateData[field] = null;
      }
    });

    // Array ObjectId fields — filter out empty strings
    const arrayObjectIdFields = ["brand", "tags", "attributes", "colors", "relatedProducts"];
    arrayObjectIdFields.forEach((field) => {
      if (Array.isArray(updateData[field])) {
        updateData[field] = updateData[field].filter((v) => v && v !== "");
      }
    });

    // Sanitize partnerStock.supplier — empty string → null
    if (updateData.partnerStock) {
      if (updateData.partnerStock.supplier === "" || updateData.partnerStock.supplier === undefined) {
        updateData.partnerStock.supplier = null;
      }
    }

    // Sanitize enum fields — Mongoose rejects "" for fields with enum constraints
    // Convert "" → undefined so Mongoose uses the existing value or skips the field
    const enumFields = ["roastLevel", "blend", "intensity", "packaging", "productType", "publish", "stockSource"];
    enumFields.forEach((field) => {
      if (updateData[field] === "" || updateData[field] === null) {
        delete updateData[field]; // remove from updateData so existing value is preserved
      }
    });

    // Also clear plain string fields that are empty — convert to undefined
    const optionalStringFields = ["roastOrigin", "aromaticProfile", "alcoholLevel", "coffeeOrigin", "unit", "blend"];
    optionalStringFields.forEach((field) => {
      if (updateData[field] === "") {
        updateData[field] = undefined;
      }
    });

    // Sanitize numeric price fields — empty string → 0
    const numericFields = ["btbPrice", "btcPrice", "price3weeksDelivery", "price5weeksDelivery", "price", "discount", "stock"];
    numericFields.forEach((field) => {
      if (updateData[field] === "" || updateData[field] === undefined) {
        updateData[field] = 0;
      } else if (updateData[field] !== undefined) {
        updateData[field] = parseFloat(updateData[field]) || 0;
      }
    });

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
          message: "A Product with this slug already exists",
          error: true,
          success: false,
        });
      }

      updateData.slug = generatedSlug;
    }

    // Handle SKU generation if product doesn't have SKU or SKU is empty
    if (
      !existingProduct.sku ||
      existingProduct.sku.trim() === "" ||
      (sku && sku.trim() === "")
    ) {
      const productName = name || existingProduct.name;
      const productCategory = category || existingProduct.category;
      const productBrand = brand || existingProduct.brand;

      const generatedSKU = await generateSKU(
        productName,
        productCategory,
        productBrand,
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
          message: "A Product with this SKU already exists",
          error: true,
          success: false,
        });
      }
    }

    const updateProduct = await ProductModel.findByIdAndUpdate(
      _id,
      updateData,
      { new: true },
    ).populate(
      "category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts",
    );

    logActivity({
      userId: request.user?._id,
      action: 'PRODUCT_UPDATE',
      description: `Updated product: ${updateProduct?.name || _id}`,
      resourceType: 'Product',
      resourceId: _id,
      resourceName: updateProduct?.name || String(_id),
      req: request,
    });

    return response.json({
      message: "updated successfully",
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
        message: "provide _id ",
        error: true,
        success: false,
      });
    }

    const deleteProduct = await ProductModel.deleteOne({ _id: _id });

    if (deleteProduct.deletedCount === 0) {
      return response.status(404).json({
        message: "Product not found",
        error: true,
        success: false,
      });
    }

    logActivity({
      userId: request.user?._id,
      action: 'PRODUCT_DELETE',
      description: `Deleted product ID: ${_id}`,
      resourceType: 'Product',
      resourceId: _id,
      req: request,
    });

    return response.json({
      message: "Delete successfully",
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

export const searchProductAdmin = async (request, response) => {
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
        case "price-low":
          sortOption = { price: 1 };
          break;
        case "price-high":
          sortOption = { price: -1 };
          break;
        case "popularity":
          sortOption = { averageRating: -1 };
          break;
        case "alphabet":
          sortOption = { name: 1 };
          break;
        case "featured":
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
          "category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts",
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: "Product data",
      error: false,
      success: true,
      data: data,
      totalCount: dataCount,
      totalPage: Math.ceil(dataCount / limit),
      page: page,
      limit: limit,
    });
  } catch (error) {
    console.error("Search product error:", error);
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
        message: "Category ID is required",
        error: true,
        success: false,
      });
    }

    const pageNumber = page || 1;
    const pageSize = limit || 12;
    const skip = (pageNumber - 1) * pageSize;

    const [data, dataCount] = await Promise.all([
      ProductModel.find({ category: categoryId, ...CLIENT_VISIBILITY_FILTER })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate(
          "category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts",
        ),
      ProductModel.countDocuments({ category: categoryId, ...CLIENT_VISIBILITY_FILTER }),
    ]);

    return response.json({
      message: "Products by category",
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
        message: "Category ID and Subcategory ID are required",
        error: true,
        success: false,
      });
    }

    const pageNumber = page || 1;
    const pageSize = limit || 12;
    const skip = (pageNumber - 1) * pageSize;

    const visibilityQuery = { category: categoryId, subCategory: subCategoryId, ...CLIENT_VISIBILITY_FILTER };

    const [data, dataCount] = await Promise.all([
      ProductModel.find(visibilityQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate(
          "category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts",
        ),
      ProductModel.countDocuments(visibilityQuery),
    ]);

    return response.json({
      message: "Products by category and subcategory",
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
        message: "Brand ID is required",
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
          "category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts",
        ),
      ProductModel.countDocuments({ brand: brandId }),
    ]);

    return response.json({
      message: "Products by brand",
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
          "category subCategory brand tags attributes compatibleSystem producer",
        ),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: `Products ${available !== false ? "available" : "unavailable"}`,
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
      excludeDirectPricing,
    } = request.body || request.query;

    const query = {};

    // CRITICAL: Only show products with at least one of the three prices set
    const priceFilter = {
      $or: [
        { btcPrice: { $gt: 0 } },
        { price3weeksDelivery: { $gt: 0 } },
        { price5weeksDelivery: { $gt: 0 } },
      ],
    };

    // Search filter
    if (search) {
      // Combine search with price filter using $and
      query.$and = [
        priceFilter,
        {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { sku: { $regex: search, $options: "i" } },
          ],
        },
      ];
    } else {
      // Just apply price filter
      query.$or = priceFilter.$or;
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

    // Exclude products with direct pricing
    if (excludeDirectPricing === "true" || excludeDirectPricing === true) {
      const DirectPricingModel = (
        await import("../models/direct-pricing.model.js")
      ).default;
      const productsWithDirectPricing = await DirectPricingModel.find({
        isActive: true,
      }).distinct("product");

      query._id = { $nin: productsWithDirectPricing };
    }

    const skip = (page - 1) * limit;

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .populate("brand", "name")
        .populate("category", "name")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: "Products retrieved successfully",
      data: products,
      totalCount,
      totalNoPage: Math.ceil(totalCount / limit),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get products error:", error);
    return response.status(500).json({
      message: error.message || "Failed to get products",
      error: true,
      success: false,
    });
  }
};
// Add this to your getProducts controller
export const getProductsAdmin = async (request, response) => {
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
        { name: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
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
    if (excludeDirectPricing === "true" || excludeDirectPricing === true) {
      const DirectPricingModel = (
        await import("../models/direct-pricing.model.js")
      ).default;
      const productsWithDirectPricing = await DirectPricingModel.find({
        isActive: true,
      }).distinct("product");

      query._id = { $nin: productsWithDirectPricing };
    }

    const skip = (page - 1) * limit;

    const [products, totalCount] = await Promise.all([
      ProductModel.find(query)
        .populate("brand", "name")
        .populate("category", "name")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      ProductModel.countDocuments(query),
    ]);

    return response.json({
      message: "Products retrieved successfully",
      data: products,
      totalCount,
      totalNoPage: Math.ceil(totalCount / limit),
      error: false,
      success: true,
    });
  } catch (error) {
    console.error("Get products error:", error);
    return response.status(500).json({
      message: error.message || "Failed to get products",
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
        message: "SKU is required",
        error: true,
        success: false,
      });
    }

    const product = await ProductModel.findOne({ sku }).populate(
      "category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts",
    );

    if (!product) {
      return response.status(404).json({
        message: "Product not found with this SKU",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Product found",
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

// Search product with comprehensive filters
// Fixed searchProduct function - place this in your product.controller.js

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
      minPrice,
      maxPrice,
      sort,
      compatibleSystem,
    } = request.body;

    if (!page) {
      page = 1;
    }

    if (!limit) {
      limit = 10;
    }

    const query = [];

    // Search strategy:
    // - $text (MongoDB full-text) only matches WHOLE words — "caf" won't match "decaffeinato"
    // - $regex matches anywhere inside a string — works for partial/prefix queries
    // We use $regex so "caf" finds "decaffeinato", "caffitaly", etc. (same as the dropdown)
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.push({
        $match: {
          publish: "PUBLISHED",
          $and: [
            // Visibility rule (contains its own $or)
            {
              $or: [
                { "warehouseStock.onlineStock": { $gt: 0 } },
                { "partnerStock.enabled": true },
                { price3weeksDelivery: { $gt: 0 } },
                { price5weeksDelivery: { $gt: 0 } },
              ],
            },
            // Text search (its own $or)
            {
              $or: [
                { name: { $regex: escapedSearch, $options: "i" } },
                { shortDescription: { $regex: escapedSearch, $options: "i" } },
                { description: { $regex: escapedSearch, $options: "i" } },
                { sku: { $regex: escapedSearch, $options: "i" } },
              ],
            },
          ],
        },
      });
    } else {
      // No search term — return all client-visible products
      query.push({
        $match: CLIENT_VISIBILITY_FILTER,
      });
    }

    // Filter by category
    if (category) {
      if (typeof category === "string") {
        query.push({
          $match: {
            category: new mongoose.Types.ObjectId(category),
          },
        });
      } else if (Array.isArray(category) && category.length > 0) {
        query.push({
          $match: {
            category: {
              $in: category.map((cat) => new mongoose.Types.ObjectId(cat)),
            },
          },
        });
      }
    }

    // Filter by subcategory
    if (subCategory) {
      if (typeof subCategory === "string") {
        query.push({
          $match: {
            subCategory: new mongoose.Types.ObjectId(subCategory),
          },
        });
      } else if (Array.isArray(subCategory) && subCategory.length > 0) {
        query.push({
          $match: {
            subCategory: {
              $in: subCategory.map((sub) => new mongoose.Types.ObjectId(sub)),
            },
          },
        });
      }
    }

    // Filter by brand
    if (brand && brand.length > 0) {
      query.push({
        $match: {
          brand: {
            $in: brand.map((b) => new mongoose.Types.ObjectId(b)),
          },
        },
      });
    }

    // Filter by compatible system
    if (compatibleSystem) {
      try {
        query.push({
          $match: {
            compatibleSystem: new mongoose.Types.ObjectId(compatibleSystem),
          },
        });
      } catch (_) {}
    }

    // Filter by product type
    if (productType && productType.length > 0) {
      query.push({
        $match: {
          productType: {
            $in: productType,
          },
        },
      });
    }

    // Filter by roast level
    if (roastLevel && roastLevel.length > 0) {
      query.push({
        $match: {
          roastLevel: {
            $in: roastLevel,
          },
        },
      });
    }

    // Filter by intensity
    if (intensity && intensity.length > 0) {
      query.push({
        $match: {
          intensity: {
            $in: intensity,
          },
        },
      });
    }

    // Filter by blend
    if (blend && blend.length > 0) {
      query.push({
        $match: {
          blend: {
            $in: blend,
          },
        },
      });
    }

    // Price range filter
    if (minPrice || maxPrice) {
      const priceMatch = {};

      if (minPrice) {
        priceMatch.$gte = Number(minPrice);
      }

      if (maxPrice) {
        priceMatch.$lte = Number(maxPrice);
      }

      query.push({
        $match: {
          $or: [
            { price: priceMatch },
            { btcPrice: priceMatch },
            { price3weeksDelivery: priceMatch },
            { price5weeksDelivery: priceMatch },
          ],
        },
      });
    }

    // Populate references
    query.push(
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "category",
        },
      },
      {
        $lookup: {
          from: "subcategories",
          localField: "subCategory",
          foreignField: "_id",
          as: "subCategory",
        },
      },
      {
        $lookup: {
          from: "brands",
          localField: "brand",
          foreignField: "_id",
          as: "brand",
        },
      },
      {
        $lookup: {
          from: "brands",
          localField: "producer",
          foreignField: "_id",
          as: "producer",
        },
      },
      {
        $lookup: {
          from: "brands",
          localField: "compatibleSystem",
          foreignField: "_id",
          as: "compatibleSystem",
        },
      },
    );

    // Unwind arrays
    query.push(
      {
        $unwind: {
          path: "$category",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$subCategory",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$producer",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$compatibleSystem",
          preserveNullAndEmptyArrays: true,
        },
      },
    );

    // Sorting
    let sortQuery = { createdAt: -1 }; // Default: newest first

    if (sort) {
      if (sort === "price_asc") {
        sortQuery = { price: 1 };
      } else if (sort === "price_desc") {
        sortQuery = { price: -1 };
      } else if (sort === "name_asc") {
        sortQuery = { name: 1 };
      } else if (sort === "name_desc") {
        sortQuery = { name: -1 };
      }
    }

    query.push({ $sort: sortQuery });

    // Count total documents
    const countQuery = [...query];
    countQuery.push({ $count: "total" });
    const countResult = await ProductModel.aggregate(countQuery);
    const totalCount = countResult[0]?.total || 0;

    // Pagination
    const skip = (page - 1) * limit;
    query.push({ $skip: skip }, { $limit: parseInt(limit) });

    const product = await ProductModel.aggregate(query);

    return response.json({
      message: "Products data",
      error: false,
      success: true,
      data: product,
      totalCount: totalCount,
      totalPage: Math.ceil(totalCount / limit),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error) {
    console.error("Search product error:", error);
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
    let { page, limit } = request.body;

    if (!page) {
      page = 1;
    }

    if (!limit) {
      limit = 10;
    }

    const query = [
      {
        $match: {
          featured: true,
          publish: "PUBLISHED",
        },
      },
    ];

    // ✅ Apply shared client visibility rules (partnerStock + delivery prices + warehouse stock)
    query.push({
      $match: {
        $and: [
          { image: { $exists: true, $ne: [] } },
          CLIENT_VISIBILITY_FILTER,
        ],
      },
    });

    query.push(
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "category",
        },
      },
      {
        $lookup: {
          from: "subcategories",
          localField: "subCategory",
          foreignField: "_id",
          as: "subCategory",
        },
      },
      {
        $lookup: {
          from: "brands",
          localField: "brand",
          foreignField: "_id",
          as: "brand",
        },
      },
      {
        $lookup: {
          from: "brands",
          localField: "producer",
          foreignField: "_id",
          as: "producer",
        },
      },
    );

    query.push(
      {
        $unwind: {
          path: "$category",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$subCategory",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$producer",
          preserveNullAndEmptyArrays: true,
        },
      },
    );

    query.push({ $sort: { createdAt: -1 } });

    const countQuery = [...query];
    countQuery.push({ $count: "total" });
    const countResult = await ProductModel.aggregate(countQuery);
    const totalCount = countResult[0]?.total || 0;

    const skip = (page - 1) * limit;
    query.push({ $skip: skip }, { $limit: parseInt(limit) });

    const products = await ProductModel.aggregate(query);

    return response.json({
      message: "Featured products",
      error: false,
      success: true,
      data: products,
      totalCount: totalCount,
      totalPage: Math.ceil(totalCount / limit),
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// Get popular products (based on ratings)
export const getPopularProducts = async (request, response) => {
  try {
    let { page, limit } = request.body;

    if (!page) {
      page = 1;
    }

    if (!limit) {
      limit = 10;
    }

    const query = [
      {
        $match: {
          publish: "PUBLISHED",
          averageRating: { $gte: 4 },
        },
      },
    ];

    // ✅ Apply shared client visibility rules (partnerStock + delivery prices + warehouse stock)
    query.push({
      $match: {
        $and: [
          { image: { $exists: true, $ne: [] } },
          CLIENT_VISIBILITY_FILTER,
        ],
      },
    });

    query.push(
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "category",
        },
      },
      {
        $lookup: {
          from: "subcategories",
          localField: "subCategory",
          foreignField: "_id",
          as: "subCategory",
        },
      },
      {
        $lookup: {
          from: "brands",
          localField: "brand",
          foreignField: "_id",
          as: "brand",
        },
      },
      {
        $lookup: {
          from: "brands",
          localField: "producer",
          foreignField: "_id",
          as: "producer",
        },
      },
    );

    query.push(
      {
        $unwind: {
          path: "$category",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$subCategory",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$producer",
          preserveNullAndEmptyArrays: true,
        },
      },
    );

    query.push({ $sort: { averageRating: -1, createdAt: -1 } });

    const countQuery = [...query];
    countQuery.push({ $count: "total" });
    const countResult = await ProductModel.aggregate(countQuery);
    const totalCount = countResult[0]?.total || 0;

    const skip = (page - 1) * limit;
    query.push({ $skip: skip }, { $limit: parseInt(limit) });

    const products = await ProductModel.aggregate(query);

    return response.json({
      message: "Popular products",
      error: false,
      success: true,
      data: products,
      totalCount: totalCount,
      totalPage: Math.ceil(totalCount / limit),
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
