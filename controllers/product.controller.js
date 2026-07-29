import mongoose from "mongoose";
import ProductModel from "../models/product.model.js";
import SubCategoryModel from "../models/subCategory.model.js";
import CategoryModel from "../models/category.model.js";
import BrandModel from "../models/brand.model.js";
import generateSlug from "../utils/generateSlug.js";
import generateSKU from "../utils/generateSKU.js";
import { logActivity } from "../utils/activityLogger.js";
import { translateEntity, getBulkTranslations, applyTranslation } from "../utils/translationService.js";
import { mergeDirectPricingIntoProducts } from "../utils/mergeDirectPricing.js";

// ─── Client Visibility Rule ────────────────────────────────────────────────
// Canonical, single source of truth — MUST stay in sync with:
//   - icvng-client/src/config/deliveryCategories.js (isFiveWeekDeliveryCategory)
//   - icvng-admin/src/config/deliveryCategories.js (isFiveWeekDeliveryCategory)
//   - icvng-admin ProductForm.jsx live "hidden from shop" warning
// See PRODUCT_VISIBILITY_RULES.md at the repo root for the full write-up.
//
// A product is PURCHASABLE (and therefore allowed to be PUBLISHED, and
// allowed to appear in any listing) if, and only if, at least one of:
//
//   (a) It has the delivery price that matches whether it's "five-week
//       type" — which is true if EITHER:
//         - productType === "MACHINE", OR
//         - its category slug is one of FIVE_WEEK_DELIVERY_SLUGS
//       (checked with OR, not just productType alone, because productType
//       data isn't fully reliable on its own — e.g. a Tassimo coffee
//       machine filed under category "Coffee Maker" but with productType
//       left as "COFFEE". Trusting productType alone let that exact
//       product pass the server's check while the client — which also
//       checks category — correctly refused to show it, a contradiction
//       that let an unpurchasable product stay fetchable.)
//       Five-week-type  → price5weeksDelivery > 0
//       Otherwise       → price3weeksDelivery > 0
//       ("3-week" is what the admin/server call the option the client
//       labels "2 Weeks Delivery" — same field, `price3weeksDelivery`.)
//       A delivery price on the WRONG field does not count — e.g. a
//       five-week-type product with only price3weeksDelivery set is not
//       purchasable via this path.
//
//   (b) It has a regular price (btcPrice > 0) AND actual online stock:
//         - warehouseStock.onlineStock > 0, OR
//         - partnerStock.enabled === true AND partnerStock.quantity > 0
//       (Merely toggling partnerStock.enabled with quantity 0 does NOT
//       count as stock.)
//
// `productAvailability` (the "Product Available for Sale" checkbox) is a
// SEPARATE, independent switch — an admin explicitly marking a product
// discontinued. It does not affect the purchasability check above, but it
// changes what happens when the rule above fails:
//   - Listings (home/shop/search/carousel/category) always require BOTH
//     purchasable AND productAvailability !== false.
//   - The single-product detail page is fetchable if EITHER purchasable OR
//     productAvailability === false — so a discontinued product still
//     loads (to show the "join the waitlist" screen), but a product that's
//     merely missing its pricing/stock setup 404s instead of rendering a
//     confusing "why can't I buy this" page.
// ──────────────────────────────────────────────────────────────────────────

const FIVE_WEEK_DELIVERY_SLUGS = ["capsule-machine", "coffee-maker"];

const isMachineType = (productType) => productType === "MACHINE";

// Category IDs whose slug is in FIVE_WEEK_DELIVERY_SLUGS, cached briefly —
// categories change rarely, and re-resolving this on every single product
// list/detail request would be wasteful. Any create/update to a category
// (or to FIVE_WEEK_DELIVERY_SLUGS itself) is reflected within the TTL.
let _fiveWeekCategoryIdsCache = null;
let _fiveWeekCategoryIdsCacheAt = 0;
const FIVE_WEEK_CATEGORY_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

const getFiveWeekCategoryIds = async () => {
  const now = Date.now();
  if (
    _fiveWeekCategoryIdsCache &&
    now - _fiveWeekCategoryIdsCacheAt < FIVE_WEEK_CATEGORY_CACHE_TTL_MS
  ) {
    return _fiveWeekCategoryIdsCache;
  }
  const cats = await CategoryModel.find({
    slug: { $in: FIVE_WEEK_DELIVERY_SLUGS },
  })
    .select("_id")
    .lean();
  _fiveWeekCategoryIdsCache = cats.map((c) => c._id);
  _fiveWeekCategoryIdsCacheAt = now;
  return _fiveWeekCategoryIdsCache;
};

// The reusable $or clause expressing "this product has online stock",
// mirroring the product model's own `effectiveOnlineStock` virtual priority
// exactly: partnerStock (if enabled) wins, else warehouseStock (if
// enabled), else the legacy top-level `stock` field.
const HAS_ONLINE_STOCK_OR = [
  { "partnerStock.enabled": true, "partnerStock.quantity": { $gt: 0 } },
  {
    "partnerStock.enabled": { $ne: true },
    "warehouseStock.enabled": true,
    "warehouseStock.onlineStock": { $gt: 0 },
  },
  {
    "partnerStock.enabled": { $ne: true },
    "warehouseStock.enabled": { $ne: true },
    stock: { $gt: 0 },
  },
];

// Builds the "purchasable" $or clause, resolving the current set of
// five-week category IDs. Every element still only needs simple top-level
// field comparisons — no $lookup/aggregation required, since we resolve
// category membership to a plain $in list up front.
const buildPurchasableOr = async () => {
  const fiveWeekCategoryIds = await getFiveWeekCategoryIds();
  return [
    {
      $or: [{ productType: "MACHINE" }, { category: { $in: fiveWeekCategoryIds } }],
      price5weeksDelivery: { $gt: 0 },
    },
    {
      productType: { $ne: "MACHINE" },
      category: { $nin: fiveWeekCategoryIds },
      price3weeksDelivery: { $gt: 0 },
    },
    {
      btcPrice: { $gt: 0 },
      $or: HAS_ONLINE_STOCK_OR,
    },
  ];
};

// STRICT — for every listing endpoint (home, shop, search, carousel,
// category pages, related products, featured, etc.). A discontinued
// product never appears here even if its pricing happens to still qualify.
const buildClientVisibilityFilter = async () => ({
  publish: "PUBLISHED",
  productAvailability: { $ne: false },
  $or: await buildPurchasableOr(),
});

// LENIENT — for the single-product detail fetch only. A discontinued
// product is still fetchable (so the storefront can render the "join the
// waitlist" screen for it) even though it's hidden from every listing.
const buildProductDetailFilter = async () => {
  const purchasableOr = await buildPurchasableOr();
  return {
    publish: "PUBLISHED",
    $or: [{ productAvailability: false }, ...purchasableOr],
  };
};

// JS-level mirror of the purchasability rule, for use outside Mongo queries
// (create/update draft-forcing, admin visibility badges). Takes a plain
// object with the same shape as a product document (or a partial merge of
// one), PLUS the resolved category slug (caller must fetch this — a
// product's `category` field is just an ObjectId, not a slug).
const hasOnlineStock = (data) => {
  const partnerEnabled = data.partnerStock?.enabled === true;
  if (partnerEnabled) return Number(data.partnerStock?.quantity) > 0;
  const warehouseEnabled = data.warehouseStock?.enabled === true;
  if (warehouseEnabled) return Number(data.warehouseStock?.onlineStock) > 0;
  return Number(data.stock) > 0;
};

const isFiveWeekType = (data, categorySlug) =>
  isMachineType(data.productType) ||
  (!!categorySlug && FIVE_WEEK_DELIVERY_SLUGS.includes(categorySlug));

const isProductPurchasable = (data, categorySlug = null) => {
  const hasRegularPrice = Number(data.btcPrice) > 0;
  const hasDeliveryPrice = isFiveWeekType(data, categorySlug)
    ? Number(data.price5weeksDelivery) > 0
    : Number(data.price3weeksDelivery) > 0;

  return hasDeliveryPrice || (hasRegularPrice && hasOnlineStock(data));
};

// Small helper for create/update controllers: resolve a single product's
// category slug (or null if it has none / lookup fails — falls back to
// productType-only behavior, which is still correct, just less defensive).
const resolveCategorySlug = async (categoryId) => {
  if (!categoryId) return null;
  try {
    const categoryDoc = await CategoryModel.findById(categoryId)
      .select("slug")
      .lean();
    return categoryDoc?.slug || null;
  } catch (_err) {
    return null;
  }
};

// Sub-roles allowed to set/change pricing fields (BTB/BTC/2-week/5-week
// price, discount) on the general product form. Everyone else's submitted
// values for these fields are ignored — pricing is an Accountant function
// (IT/DIRECTOR retain override access) — UNLESS the product is toggled as
// a partner/supplier product (partnerStock.enabled), in which case pricing
// is supplier-driven and any role may set it.
//
// The equivalent rule for warehouse online-stock quantity lives in
// warehouse.controller.js's updateStock (that's a separate endpoint/form —
// this one, the general product form, never had a warehouse-stock input to
// begin with; only partnerStock.quantity is settable here, and that's
// intentionally open to any role already).
const PRICING_SUBROLES = ["ACCOUNTANT", "IT", "DIRECTOR"];
const canSetPricing = (user, isPartnerProduct) =>
  isPartnerProduct === true || PRICING_SUBROLES.includes(user?.subRole);

const PRICING_FIELDS = [
  "btbPrice",
  "btcPrice",
  "price3weeksDelivery",
  "price5weeksDelivery",
  "discount",
];

// warehouseStock.onlineStock is nested, so it's handled separately from the
// flat PRICING_FIELDS list wherever it's stripped/sanitized.

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
      limitedEdition,
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

    // Only Accountant/IT/Director may set pricing on the general product
    // form — anyone else's submitted price values are ignored (product is
    // created with 0 pricing, which will also force it to DRAFT below) —
    // UNLESS this product is toggled as a partner/supplier product, in
    // which case pricing is supplier-driven and any role may set it.
    const isPartnerProduct = request.body.partnerStock?.enabled === true;
    const allowPricing = canSetPricing(request.user, isPartnerProduct);
    const effectiveBtbPrice = allowPricing ? btbPrice || 0 : 0;
    const effectiveBtcPrice = allowPricing ? btcPrice || 0 : 0;
    const effectivePrice3weeks = allowPricing ? price3weeksDelivery || 0 : 0;
    const effectivePrice5weeks = allowPricing ? price5weeksDelivery || 0 : 0;
    const effectiveDiscount = allowPricing ? discount || 0 : 0;

    // A product with no way for a customer to actually buy it (no online
    // stock, no partner stock, no matching-type delivery price) must never
    // be PUBLISHED/PENDING — force it to DRAFT regardless of what was
    // submitted, so the admin list badge always matches storefront reality.
    // Category slug is resolved too (not just productType) — see the
    // comment on buildPurchasableOr for why productType alone isn't
    // trustworthy enough on its own.
    const categorySlugForVisibility = await resolveCategorySlug(category);
    const willDisplay = isProductPurchasable(
      {
        productType,
        btcPrice: effectiveBtcPrice,
        stock: stock || 0,
        warehouseStock: { enabled: false }, // not settable from this form; falls back to `stock`
        partnerStock: request.body.partnerStock,
        price3weeksDelivery: effectivePrice3weeks,
        price5weeksDelivery: effectivePrice5weeks,
      },
      categorySlugForVisibility,
    );
    const effectivePublish = willDisplay ? publish || "PENDING" : "DRAFT";

    const product = new ProductModel({
      name,
      image,
      weight,
      brand: Array.isArray(brand) ? brand.filter((v) => v && v !== "") : brand,
      compatibleSystem: compatibleSystem || null,
      producer: producer || null,
      productType,
      roastLevel: roastLevel || undefined,
      roastOrigin: roastOrigin || undefined,
      alcoholLevel: alcoholLevel || undefined,
      blend: blend || undefined,
      featured: featured || false,
      limitedEdition:
        limitedEdition && typeof limitedEdition === "object"
          ? {
              isLimitedEdition: !!limitedEdition.isLimitedEdition,
              bannerText: limitedEdition.bannerText || "Limited Edition",
              bannerColor: limitedEdition.bannerColor || "#c8102e",
              totalUnits: parseInt(limitedEdition.totalUnits) || 0,
              carouselOrder: parseInt(limitedEdition.carouselOrder) || 0,
            }
          : undefined,
      aromaticProfile: aromaticProfile || undefined,
      coffeeOrigin: coffeeOrigin || undefined,
      intensity: intensity || undefined,
      coffeeRoastAreas: coffeeRoastAreas || null,
      packaging: packaging || undefined,
      category,
      subCategory: subCategory || null,
      tags: Array.isArray(tags) ? tags.filter((v) => v && v !== "") : tags,
      attributes: Array.isArray(attributes)
        ? attributes.filter((v) => v && v !== "")
        : attributes,
      unit,
      stock: stock || 0,
      productAvailability:
        productAvailability !== undefined ? productAvailability : true,
      price: price || 0,
      salePrice: salePrice || 0,
      price3weeksDelivery: effectivePrice3weeks,
      price5weeksDelivery: effectivePrice5weeks,
      btbPrice: effectiveBtbPrice,
      btcPrice: effectiveBtcPrice,
      discount: effectiveDiscount,
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
      publish: effectivePublish,
      relatedProducts: relatedProducts || [],
      slug: generatedSlug,
    });

    const saveProduct = await product.save();

    // Auto-translate to all non-English languages (non-blocking)
    translateEntity({
      entityType: "product",
      entityId: saveProduct._id,
      document: saveProduct.toObject(),
    }).catch((err) =>
      console.error("[translate] product create:", err.message),
    );

    // Log activity (non-blocking)
    logActivity({
      userId: request.user?._id,
      action: "PRODUCT_CREATE",
      description: `Created product: ${saveProduct.name}`,
      resourceType: "Product",
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
    const visibilityFilter = await buildClientVisibilityFilter();
    const searchQuery = {
      ...visibilityFilter,
      $and: [
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
      .populate("category", "name slug")
      .populate("compatibleSystem", "name")
      .populate("producer", "name")
      .sort({ averageRating: -1 })
      .limit(parseInt(limit))
      .lean();

    // Apply the same DirectPricing-override rule used on the single-product
    // page, so search never shows a price that disagrees with the product's
    // own page (see utils/mergeDirectPricing.js for the rule).
    const pricedProducts = await mergeDirectPricingIntoProducts(products);

    return response.json({
      message: "Products found",
      data: pricedProducts,
      error: false,
      success: true,
      count: pricedProducts.length,
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

    // ── Localize into the active language ──────────────────────────────────
    // The header/nav mega-menu renders category, subcategory, and brand
    // names straight from this payload, so translations edited in
    // Admin → Translations only reach the storefront if we resolve them here.
    // Language comes from the client's X-Language header (kept in sync with
    // i18n's saved preference), falling back to the visited domain's default.
    const language =
      (request.headers["x-language"] || "").toLowerCase() ||
      request.country?.language?.default ||
      "en";

    let localizedCategories = enrichedCategories;
    if (language !== "en") {
      const categoryIds = enrichedCategories.map((c) => c._id.toString());
      const subCategoryIds = enrichedCategories.flatMap((c) =>
        (c.subcategories || []).map((s) => s._id.toString()),
      );
      const brandIds = [
        ...enrichedCategories.flatMap((c) =>
          (c.brands || []).map((b) => b._id.toString()),
        ),
        ...enrichedCategories.flatMap((c) =>
          (c.subcategories || []).flatMap((s) =>
            (s.brands || []).map((b) => b._id.toString()),
          ),
        ),
      ];

      const [categoryFields, subCategoryFields, brandFields] =
        await Promise.all([
          getBulkTranslations("category", categoryIds, language),
          getBulkTranslations("subCategory", subCategoryIds, language),
          getBulkTranslations("brand", [...new Set(brandIds)], language),
        ]);

      const localizeBrand = (brand) => {
        const fields = brandFields.get(brand._id.toString());
        return fields ? applyTranslation(brand, fields) : brand;
      };

      localizedCategories = enrichedCategories.map((category) => {
        const catFields = categoryFields.get(category._id.toString());
        const localizedCategory = catFields
          ? applyTranslation(category, catFields)
          : category;

        return {
          ...localizedCategory,
          brands: (category.brands || []).map(localizeBrand),
          subcategories: (category.subcategories || []).map((sub) => {
            const subFields = subCategoryFields.get(sub._id.toString());
            const localizedSub = subFields
              ? applyTranslation(sub, subFields)
              : sub;
            return {
              ...localizedSub,
              brands: (sub.brands || []).map(localizeBrand),
            };
          }),
        };
      });
    }

    return response.json({
      message: "Category structure fetched successfully",
      data: localizedCategories,
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
    let {
      page,
      limit,
      search,
      category,
      brand,
      publish,
      productType,
      lowStock,
      priceFilter,
      hiddenFromShop,
      partnerStock,
    } = request.body;

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;

    // Build query — supports search (regex), category, brand, publish, productType, lowStock, priceFilter
    const query = {};
    const andConditions = [];

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      andConditions.push({
        $or: [
          { name: { $regex: escaped, $options: "i" } },
          { sku: { $regex: escaped, $options: "i" } },
          { description: { $regex: escaped, $options: "i" } },
        ],
      });
    }

    if (category) {
      try {
        andConditions.push({ category: new mongoose.Types.ObjectId(category) });
      } catch {}
    }

    if (brand) {
      try {
        andConditions.push({
          brand: { $in: [new mongoose.Types.ObjectId(brand)] },
        });
      } catch {}
    }

    if (publish) {
      andConditions.push({ publish });
    }

    if (productType) {
      andConditions.push({ productType });
    }

    // Low stock filter — online stock only
    if (lowStock === "true") {
      andConditions.push({
        $or: [
          { "warehouseStock.onlineStock": { $gt: 0, $lte: 5 } },
          {
            "partnerStock.enabled": true,
            "partnerStock.quantity": { $gt: 0, $lte: 5 },
          },
        ],
      });
    } else if (lowStock === "critical") {
      andConditions.push({
        $or: [
          { "warehouseStock.onlineStock": 0 },
          { "partnerStock.enabled": true, "partnerStock.quantity": 0 },
        ],
      });
    }

    // Price volume filter
    if (priceFilter === "hasbtc") {
      andConditions.push({ btcPrice: { $gt: 0 } });
    } else if (priceFilter === "has3week") {
      andConditions.push({ price3weeksDelivery: { $gt: 0 } });
    } else if (priceFilter === "has5week") {
      andConditions.push({ price5weeksDelivery: { $gt: 0 } });
    } else if (priceFilter === "noPrice") {
      andConditions.push(
        { $or: [{ btcPrice: { $lte: 0 } }, { btcPrice: null }] },
        {
          $or: [
            { price3weeksDelivery: { $lte: 0 } },
            { price3weeksDelivery: null },
          ],
        },
        {
          $or: [
            { price5weeksDelivery: { $lte: 0 } },
            { price5weeksDelivery: null },
          ],
        },
      );
    }

    // Hidden from shop filter — products that are PUBLISHED but invisible to
    // clients per the canonical purchasability rule (see buildPurchasableOr).
    if (hiddenFromShop === "true" || hiddenFromShop === "false") {
      const purchasableOr = await buildPurchasableOr();
      if (hiddenFromShop === "true") {
        andConditions.push({ publish: "PUBLISHED" });
        andConditions.push({ $nor: purchasableOr });
      } else {
        andConditions.push({ $or: purchasableOr });
      }
    }

    // Partner stock filter — products whose supplier-managed online stock
    // arrangement is enabled/disabled
    if (partnerStock === "true") {
      andConditions.push({ "partnerStock.enabled": true });
    } else if (partnerStock === "false") {
      andConditions.push({ "partnerStock.enabled": { $ne: true } });
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
        .populate(
          "category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy",
        )
        .populate("partnerStock.supplier", "name contactPerson.phone"),
      ProductModel.countDocuments(query),
    ]);

    // HQ-only fields: BTB (B2B) pricing and offline warehouse stock are not
    // relevant to a country-scoped/foreign admin's market — strip them from
    // the response rather than relying on the admin UI alone to hide them.
    //
    // partnerStock ("online BTC-type stock expected from our partners") is
    // an NG-specific arrangement — only Nigeria-scoped (or global/HQ) admins
    // should see or edit it. A Togo-scoped admin, for example, has no such
    // partners and shouldn't see this data at all.
    const isCountryScoped = !!request.countryScope;
    const stripPartnerStock = isCountryScoped && request.countryScope !== "NG";
    const responseData = isCountryScoped
      ? data.map((p) => {
          const obj = p.toObject ? p.toObject() : p;
          const { btbPrice, ...rest } = obj;
          if (rest.warehouseStock) {
            const { offlineStock, ...stockRest } = rest.warehouseStock;
            rest.warehouseStock = stockRest;
          }
          if (stripPartnerStock) {
            delete rest.partnerStock;
          }
          return rest;
        })
      : data;

    return response.json({
      message: "Product data",
      error: false,
      success: true,
      totalCount: totalCount,
      totalNoPage: Math.ceil(totalCount / limit),
      data: responseData,
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
    let {
      page,
      limit,
      search,
      category,
      brand,
      productType,
      compatibleSystem,
    } = request.body;

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;

    // Build query with mandatory price AND weight filter
    const query = {};

    // CRITICAL: Only show products that are visible to clients
    const andConditions = [await buildClientVisibilityFilter()];

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
      try {
        andConditions.push({ category: new mongoose.Types.ObjectId(category) });
      } catch {}
    }

    if (brand) {
      try {
        andConditions.push({
          brand: { $in: [new mongoose.Types.ObjectId(brand)] },
        });
      } catch {}
    }

    if (productType) {
      andConditions.push({ productType });
    }

    if (compatibleSystem) {
      try {
        andConditions.push({
          compatibleSystem: new mongoose.Types.ObjectId(compatibleSystem),
        });
      } catch {}
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

    // Use the lenient PRODUCT_DETAIL_FILTER (not the strict listing filter):
    // a genuinely unpurchasable product (no stock, no matching delivery
    // price) 404s here — it should never have been linkable in the first
    // place — but a product explicitly marked productAvailability=false
    // (discontinued) still loads, so the storefront can render its
    // "join the waitlist" screen instead of a dead link.
    const product = await ProductModel.findOne({
      _id: productId,
      ...(await buildProductDetailFilter()),
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

    // ── MERGE DIRECT PRICING ─────────────────────────────────────────────────
    // If an active DirectPricing record exists, its prices are the authoritative
    // values for btcPrice / price3weeksDelivery / price5weeksDelivery.
    // We merge them into the product object so the client always shows what the
    // accountant configured — even if ProductModel fell out of sync.
    try {
      const { default: DirectPricingModel } =
        await import("../models/direct-pricing.model.js");
      const activeDP = await DirectPricingModel.findOne({
        product: product._id,
        isActive: true,
      }).lean();

      if (activeDP) {
        const dp = activeDP.directPrices;
        const merged = product.toObject();
        if (dp.btcPrice > 0) merged.btcPrice = dp.btcPrice;
        if (dp.price3weeksDelivery > 0)
          merged.price3weeksDelivery = dp.price3weeksDelivery;
        if (dp.price5weeksDelivery > 0)
          merged.price5weeksDelivery = dp.price5weeksDelivery;
        // Also ensure ProductModel is in sync for future calls
        const needsSync =
          (dp.btcPrice > 0 && product.btcPrice !== dp.btcPrice) ||
          (dp.price3weeksDelivery > 0 &&
            product.price3weeksDelivery !== dp.price3weeksDelivery) ||
          (dp.price5weeksDelivery > 0 &&
            product.price5weeksDelivery !== dp.price5weeksDelivery);
        if (needsSync) {
          ProductModel.findByIdAndUpdate(product._id, {
            ...(dp.btcPrice > 0 ? { btcPrice: dp.btcPrice } : {}),
            ...(dp.price3weeksDelivery > 0
              ? { price3weeksDelivery: dp.price3weeksDelivery }
              : {}),
            ...(dp.price5weeksDelivery > 0
              ? { price5weeksDelivery: dp.price5weeksDelivery }
              : {}),
          })
            .exec()
            .catch(() => {}); // fire-and-forget sync, non-blocking
        }
        return response.json({
          message: "product details",
          data: merged,
          error: false,
          success: true,
        });
      }
    } catch (_err) {
      console.error("DirectPricing merge failed:", _err.message);
    }
    // ────────────────────────────────────────────────────────────────────────

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
      "compatibleSystem",
      "producer",
      "supplier",
      "category",
      "subCategory",
    ];
    objectIdFields.forEach((field) => {
      if (updateData[field] === "" || updateData[field] === null) {
        updateData[field] = null;
      }
    });

    // Array ObjectId fields — filter out empty strings
    const arrayObjectIdFields = [
      "brand",
      "tags",
      "attributes",
      "colors",
      "relatedProducts",
    ];
    arrayObjectIdFields.forEach((field) => {
      if (Array.isArray(updateData[field])) {
        updateData[field] = updateData[field].filter((v) => v && v !== "");
      }
    });

    // Sanitize partnerStock.supplier — empty string → null
    if (updateData.partnerStock) {
      if (
        updateData.partnerStock.supplier === "" ||
        updateData.partnerStock.supplier === undefined
      ) {
        updateData.partnerStock.supplier = null;
      }
    }

    // partnerStock ("online BTC-type stock expected from our partners") is a
    // Nigeria-specific arrangement — only Nigeria-scoped or global/HQ admins
    // may create/edit it. The admin UI already hides this section from other
    // country-scoped admins, but that's not real enforcement on its own — a
    // direct API call could still smuggle a partnerStock change through.
    // NOTE: the form always submits a default partnerStock object even when
    // the section is hidden/untouched, so we silently drop the field here
    // (leaving the product's existing partnerStock value untouched) rather
    // than rejecting the whole update — a non-NG admin editing an unrelated
    // field (price, description, etc.) should not be blocked by this.
    const canManagePartnerStock = !request.countryScope || request.countryScope === "NG";
    if (updateData.partnerStock && !canManagePartnerStock) {
      delete updateData.partnerStock;
    }

    // Sanitize enum fields — Mongoose rejects "" for fields with enum constraints
    // Convert "" → undefined so Mongoose uses the existing value or skips the field
    const enumFields = [
      "roastLevel",
      "blend",
      "intensity",
      "packaging",
      "productType",
      "publish",
      "stockSource",
    ];
    enumFields.forEach((field) => {
      if (updateData[field] === "" || updateData[field] === null) {
        delete updateData[field]; // remove from updateData so existing value is preserved
      }
    });

    // Also clear plain string fields that are empty — convert to undefined
    const optionalStringFields = [
      "roastOrigin",
      "aromaticProfile",
      "alcoholLevel",
      "coffeeOrigin",
      "unit",
      "blend",
    ];
    optionalStringFields.forEach((field) => {
      if (updateData[field] === "") {
        updateData[field] = undefined;
      }
    });

    // Sanitize numeric price fields — empty string → 0
    const numericFields = [
      "btbPrice",
      "btcPrice",
      "price3weeksDelivery",
      "price5weeksDelivery",
      "price",
      "discount",
      "stock",
    ];
    numericFields.forEach((field) => {
      if (updateData[field] === "" || updateData[field] === undefined) {
        updateData[field] = 0;
      } else if (updateData[field] !== undefined) {
        updateData[field] = parseFloat(updateData[field]) || 0;
      }
    });

    // Sanitize limitedEdition nested object
    if (
      updateData.limitedEdition &&
      typeof updateData.limitedEdition === "object"
    ) {
      updateData.limitedEdition.isLimitedEdition =
        !!updateData.limitedEdition.isLimitedEdition;
      updateData.limitedEdition.bannerText =
        updateData.limitedEdition.bannerText || "Limited Edition";
      updateData.limitedEdition.bannerColor =
        updateData.limitedEdition.bannerColor || "#c8102e";
      updateData.limitedEdition.totalUnits =
        parseInt(updateData.limitedEdition.totalUnits) || 0;
      updateData.limitedEdition.carouselOrder =
        parseInt(updateData.limitedEdition.carouselOrder) || 0;
    }

    // ── DIRECT PRICING PROTECTION ────────────────────────────────────────────
    // If an active DirectPricing record exists for this product, do NOT allow
    // the ProductForm (general product editor) to overwrite the prices that
    // DirectPricing manages.  Only the DirectPricing endpoints (which require
    // ACCOUNTANT / DIRECTOR / IT) may change those three fields.
    // This prevents an EDITOR saving the product form (where btcPrice renders as
    // 0 / empty because the form loaded before DirectPricing was applied) from
    // silently zeroing out the accountant-set prices.
    try {
      const { default: DirectPricingModel } =
        await import("../models/direct-pricing.model.js");
      const activeDirectPricing = await DirectPricingModel.findOne({
        product: _id,
        isActive: true,
      }).lean();

      if (activeDirectPricing) {
        const dp = activeDirectPricing.directPrices;
        // Restore Direct-Pricing-managed prices so they are not overwritten
        if (dp.btcPrice > 0) updateData.btcPrice = dp.btcPrice;
        if (dp.price3weeksDelivery > 0)
          updateData.price3weeksDelivery = dp.price3weeksDelivery;
        if (dp.price5weeksDelivery > 0)
          updateData.price5weeksDelivery = dp.price5weeksDelivery;
      }
    } catch (_err) {
      // Non-fatal — if DirectPricingModel can't be loaded, continue without protection
      console.error("DirectPricing protection check failed:", _err.message);
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── PRICING PERMISSION ────────────────────────────────────────────────
    // Only Accountant/IT/Director may change pricing on the general product
    // form. Anyone else's submitted price/discount values are dropped here
    // so the product's existing prices are left untouched — same
    // non-blocking pattern as the partnerStock sanitization above — UNLESS
    // this product is (or is being toggled into) a partner/supplier
    // product, in which case pricing is supplier-driven and any role may
    // set it.
    const isPartnerProductForUpdate =
      (updateData.partnerStock?.enabled ?? existingProduct.partnerStock?.enabled) === true;
    if (!canSetPricing(request.user, isPartnerProductForUpdate)) {
      PRICING_FIELDS.forEach((field) => {
        delete updateData[field];
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── FORCE DRAFT WHEN UNPURCHASABLE ──────────────────────────────────────
    // Mirrors createProductController: a product with no online stock, no
    // partner stock, and no matching-type delivery price can never be
    // bought, so it must never sit as PUBLISHED/PENDING (which would show
    // "Pricing Unavailable" to customers who land on it directly). Evaluate
    // against the fully-merged post-update state, not just the submitted
    // diff. Category slug is resolved too (not just productType) — see the
    // comment on buildPurchasableOr for why.
    const mergedForVisibility = {
      productType: updateData.productType ?? existingProduct.productType,
      btcPrice: updateData.btcPrice ?? existingProduct.btcPrice,
      stock: updateData.stock ?? existingProduct.stock,
      warehouseStock: {
        enabled:
          updateData.warehouseStock?.enabled ??
          existingProduct.warehouseStock?.enabled,
        onlineStock:
          updateData.warehouseStock?.onlineStock ??
          existingProduct.warehouseStock?.onlineStock ??
          0,
      },
      partnerStock: updateData.partnerStock ?? existingProduct.partnerStock,
      price3weeksDelivery:
        updateData.price3weeksDelivery ?? existingProduct.price3weeksDelivery,
      price5weeksDelivery:
        updateData.price5weeksDelivery ?? existingProduct.price5weeksDelivery,
    };
    const effectiveCategoryId = updateData.category ?? existingProduct.category;
    const categorySlugForVisibility = await resolveCategorySlug(effectiveCategoryId);
    if (!isProductPurchasable(mergedForVisibility, categorySlugForVisibility)) {
      updateData.publish = "DRAFT";
    }
    // ────────────────────────────────────────────────────────────────────────

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
      action: "PRODUCT_UPDATE",
      description: `Updated product: ${updateProduct?.name || _id}`,
      resourceType: "Product",
      resourceId: _id,
      resourceName: updateProduct?.name || String(_id),
      req: request,
    });

    // Re-translate only new/changed fields (manual edits are protected inside translateEntity)
    if (updateProduct) {
      translateEntity({
        entityType: "product",
        entityId: _id,
        document: updateProduct.toObject(),
      }).catch((err) =>
        console.error("[translate] product update:", err.message),
      );
    }

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
      action: "PRODUCT_DELETE",
      description: `Deleted product ID: ${_id}`,
      resourceType: "Product",
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

    const visibilityFilter = await buildClientVisibilityFilter();
    const [data, dataCount] = await Promise.all([
      ProductModel.find({ category: categoryId, ...visibilityFilter })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate(
          "category subCategory brand tags attributes compatibleSystem producer createdBy updatedBy relatedProducts",
        ),
      ProductModel.countDocuments({
        category: categoryId,
        ...visibilityFilter,
      }),
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

    const visibilityQuery = {
      category: categoryId,
      subCategory: subCategoryId,
      ...(await buildClientVisibilityFilter()),
    };

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
    const visibilityFilter = await buildClientVisibilityFilter();

    // Search strategy:
    // - $text (MongoDB full-text) only matches WHOLE words — "caf" won't match "decaffeinato"
    // - $regex matches anywhere inside a string — works for partial/prefix queries
    // We use $regex so "caf" finds "decaffeinato", "caffitaly", etc. (same as the dropdown)
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.push({
        $match: {
          ...visibilityFilter,
          $and: [
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
        $match: visibilityFilter,
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
        $and: [{ image: { $exists: true, $ne: [] } }, await buildClientVisibilityFilter()],
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

// Get limited edition products (for homepage banner + carousel)
export const getLimitedEditionProducts = async (request, response) => {
  try {
    let { page, limit } = request.body;

    if (!page) page = 1;
    if (!limit) limit = 10;

    const query = [
      {
        $match: {
          "limitedEdition.isLimitedEdition": true,
          publish: "PUBLISHED",
        },
      },
    ];

    // ✅ Apply shared client visibility rules (partnerStock + delivery prices + warehouse stock)
    query.push({
      $match: {
        $and: [{ image: { $exists: true, $ne: [] } }, await buildClientVisibilityFilter()],
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

    // Sort by admin-defined carousel order, then most recently added
    query.push({ $sort: { "limitedEdition.carouselOrder": 1, createdAt: -1 } });

    const countQuery = [...query];
    countQuery.push({ $count: "total" });
    const countResult = await ProductModel.aggregate(countQuery);
    const totalCount = countResult[0]?.total || 0;

    const skip = (page - 1) * limit;
    query.push({ $skip: skip }, { $limit: parseInt(limit) });

    const products = await ProductModel.aggregate(query);

    return response.json({
      message: "Limited edition products",
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
        $and: [{ image: { $exists: true, $ne: [] } }, await buildClientVisibilityFilter()],
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
