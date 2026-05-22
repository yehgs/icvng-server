import ProductModel from '../models/product.model.js';
import BrandModel from '../models/brand.model.js';
import CategoryModel from '../models/category.model.js';

/**
 * Update a product's compatibleSystem field (legacy standalone endpoint)
 */
export const updateCompatibleSystemController = async (req, res) => {
  try {
    const { productId, compatibleSystem } = req.body;

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      { compatibleSystem },
      { new: true }
    );

    if (!updatedProduct) {
      return res.status(404).json({ message: 'Product not found', error: true, success: false });
    }

    return res.json({
      message: 'Compatible System updated successfully',
      data: updatedProduct,
      success: true,
      error: false,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message, error: true, success: false });
  }
};

/**
 * Get the full Compatible System navigation structure:
 *
 * Level 1 — All brands where brand.compatibleSystem === true
 * Level 2 — Categories that have at least one published product with that compatibleSystem brand
 *            (with the category's own image from the Category model)
 * Level 3 — Brands (product.brand[]) of products that belong to that compatibleSystem + category pair
 *
 * Response shape:
 * [
 *   {
 *     _id, name, slug, image,          // compatible brand (e.g. Nespresso)
 *     categories: [
 *       {
 *         _id, name, slug, image,      // category (e.g. Coffee Capsule)
 *         brands: [                    // product brands in this compatible+category
 *           { _id, name, slug, image }
 *         ]
 *       }
 *     ]
 *   }
 * ]
 */
export const getCompatibleSystemStructureController = async (req, res) => {
  try {
    // Step 1: Fetch all brands marked as compatible systems
    const compatibleBrands = await BrandModel.find({ compatibleSystem: true })
      .lean();

    if (!compatibleBrands.length) {
      return res.json({ data: [], success: true, error: false });
    }

    // Step 2: For each compatible brand, find its categories and sub-brands
    const structure = await Promise.all(
      compatibleBrands.map(async (compBrand) => {
        // Find all published products whose compatibleSystem === this brand
        const products = await ProductModel.find({
          compatibleSystem: compBrand._id,
          publish: 'PUBLISHED',
        })
          .select('category brand')
          .lean();

        if (!products.length) {
          return { ...compBrand, categories: [], productCount: 0 };
        }

        // Collect unique category IDs
        const categoryIdSet = new Set();
        products.forEach((p) => {
          if (p.category) categoryIdSet.add(p.category.toString());
        });

        const categoryIds = [...categoryIdSet];

        // Fetch category docs (to get name, slug, image)
        const categories = await CategoryModel.find({
          _id: { $in: categoryIds },
        }).lean();

        // Sort categories: capsule-related first, then alphabetically
        const CAPSULE_PRIORITY = ['capsule', 'coffee capsule', 'coffee cap'];
        categories.sort((a, b) => {
          const aLow = (a.name || '').toLowerCase();
          const bLow = (b.name || '').toLowerCase();
          const aIsCapsule = CAPSULE_PRIORITY.some((k) => aLow.includes(k));
          const bIsCapsule = CAPSULE_PRIORITY.some((k) => bLow.includes(k));
          if (aIsCapsule && !bIsCapsule) return -1;
          if (!aIsCapsule && bIsCapsule) return 1;
          return aLow.localeCompare(bLow);
        });

        // Step 3: For each category, collect product brands
        const enrichedCategories = await Promise.all(
          categories.map(async (cat) => {
            const catProducts = products.filter(
              (p) => p.category && p.category.toString() === cat._id.toString()
            );

            const brandIdSet = new Set();
            catProducts.forEach((p) => {
              if (Array.isArray(p.brand)) {
                p.brand.forEach((b) => { if (b) brandIdSet.add(b.toString()); });
              }
            });

            const brandIds = [...brandIdSet];
            const brands = await BrandModel.find({ _id: { $in: brandIds } })
              .sort({ name: 1 })
              .select('_id name slug image')
              .lean();

            return { _id: cat._id, name: cat.name, slug: cat.slug, image: cat.image, brands };
          })
        );

        return {
          _id: compBrand._id,
          name: compBrand.name,
          slug: compBrand.slug,
          image: compBrand.image,
          categories: enrichedCategories,
          productCount: products.length,
        };
      })
    );

    // Sort compatible brands: most products first (Nespresso Vertuo etc. come last naturally)
    const filtered = structure
      .filter((b) => b.categories.length > 0)
      .sort((a, b) => b.productCount - a.productCount);

    return res.json({
      data: filtered,
      success: true,
      error: false,
      message: 'Compatible system structure fetched successfully',
    });
  } catch (error) {
    return res.status(500).json({ message: error.message, error: true, success: false });
  }
};
