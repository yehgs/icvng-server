import ProductModel from '../models/product.model.js';
import RatingModel from '../models/rating.model.js';

// Add a new rating or update if user already rated the product
export const addRatingController = async (req, res) => {
  try {
    const { product, rating, review } = req.body;
    const userId = req.userId; // From auth middleware

    if (!product || !rating) {
      return res.status(400).json({
        message: 'Product and rating are required',
        error: true,
        success: false,
      });
    }

    // Check if rating is valid (1-5)
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        message: 'Rating must be between 1 and 5',
        error: true,
        success: false,
      });
    }

    // Check if user has already rated this product
    const existingRating = await RatingModel.findOne({ user: userId, product });

    if (existingRating) {
      return res.status(400).json({
        message:
          'You have already rated this product. Use the update endpoint instead.',
        error: true,
        success: false,
      });
    }

    // Create new rating
    const newRating = new RatingModel({
      user: userId,
      product,
      rating,
      review: review || '',
    });
    await newRating.save();

    // Update product average rating
    await updateProductAverageRating(product);

    return res.json({
      message: 'Rating added successfully',
      data: newRating,
      success: true,
      error: false,
    });
  } catch (error) {
    console.error('Error adding rating:', error);
    return res.status(500).json({
      message: error.message,
      error: true,
      success: false,
    });
  }
};

// Update an existing rating
export const updateRatingController = async (req, res) => {
  try {
    const { _id, rating, review } = req.body;
    const userId = req.userId; // From auth middleware

    if (!_id || !rating) {
      return res.status(400).json({
        message: 'Rating ID and rating value are required',
        error: true,
        success: false,
      });
    }

    // Check if rating is valid (1-5)
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        message: 'Rating must be between 1 and 5',
        error: true,
        success: false,
      });
    }

    // Find the rating and verify ownership
    const existingRating = await RatingModel.findById(_id);

    if (!existingRating) {
      return res.status(404).json({
        message: 'Rating not found',
        error: true,
        success: false,
      });
    }

    // Verify that the user owns this rating
    if (existingRating.user.toString() !== userId) {
      return res.status(403).json({
        message: 'You can only update your own ratings',
        error: true,
        success: false,
      });
    }

    // Update the rating
    existingRating.rating = rating;
    existingRating.review = review || '';
    existingRating.updatedAt = Date.now();
    await existingRating.save();

    // Update product average rating
    await updateProductAverageRating(existingRating.product);

    return res.json({
      message: 'Rating updated successfully',
      data: existingRating,
      success: true,
      error: false,
    });
  } catch (error) {
    console.error('Error updating rating:', error);
    return res.status(500).json({
      message: error.message,
      error: true,
      success: false,
    });
  }
};

// Get ratings for a product or all ratings
export const getRatingsController = async (req, res) => {
  try {
    const { product } = req.query;

    let query = {};
    if (product) {
      query.product = product;
    }

    const ratings = await RatingModel.find(query)
      .populate('user', 'name avatar email')
      .populate('product', 'name image price')
      .sort({ createdAt: -1 });

    return res.json({
      data: ratings,
      success: true,
      error: false,
    });
  } catch (error) {
    console.error('Error fetching ratings:', error);
    return res.status(500).json({
      message: error.message,
      error: true,
      success: false,
    });
  }
};

// Delete a rating
export const deleteRatingController = async (req, res) => {
  try {
    const { _id } = req.body;
    const userId = req.userId; // From auth middleware

    if (!_id) {
      return res.status(400).json({
        message: 'Rating ID is required',
        error: true,
        success: false,
      });
    }

    // Find the rating
    const rating = await RatingModel.findById(_id);

    if (!rating) {
      return res.status(404).json({
        message: 'Rating not found',
        error: true,
        success: false,
      });
    }

    // Check if user is admin or the owner of the rating
    const isAdmin = req.user && req.user.role === 'ADMIN';

    if (!isAdmin && rating.user.toString() !== userId) {
      return res.status(403).json({
        message: 'You can only delete your own ratings',
        error: true,
        success: false,
      });
    }

    // Store product ID before deleting
    const productId = rating.product;

    // Delete the rating
    await RatingModel.findByIdAndDelete(_id);

    // Update product average rating
    await updateProductAverageRating(productId);

    return res.json({
      message: 'Rating deleted successfully',
      success: true,
      error: false,
    });
  } catch (error) {
    console.error('Error deleting rating:', error);
    return res.status(500).json({
      message: error.message,
      error: true,
      success: false,
    });
  }
};

// Admin endpoint to get all ratings with detailed information
export const getAllRatingsAdminController = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get filters from query params
    const { productId, userId, minRating, maxRating, sortBy, sortOrder } =
      req.query;

    // Build filter query
    let query = {};

    if (productId) {
      query.product = productId;
    }

    if (userId) {
      query.user = userId;
    }

    if (minRating || maxRating) {
      query.rating = {};
      if (minRating) query.rating.$gte = parseInt(minRating);
      if (maxRating) query.rating.$lte = parseInt(maxRating);
    }

    // Build sort options
    let sort = { createdAt: -1 }; // Default sort by newest

    if (sortBy) {
      sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
    }

    // Count total matching documents for pagination
    const total = await RatingModel.countDocuments(query);

    // Fetch ratings with pagination, sorting, and populated fields
    const ratings = await RatingModel.find(query)
      .populate('user', 'name email avatar mobile')
      .populate('product', 'name image price averageRating')
      .sort(sort)
      .skip(skip)
      .limit(limit);

    return res.json({
      data: ratings,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
      success: true,
      error: false,
    });
  } catch (error) {
    console.error('Error fetching admin ratings:', error);
    return res.status(500).json({
      message: error.message,
      error: true,
      success: false,
    });
  }
};

// Helper function to update a product's average rating
const updateProductAverageRating = async (productId) => {
  try {
    const productRatings = await RatingModel.find({ product: productId });

    let averageRating = 0;

    if (productRatings.length > 0) {
      averageRating =
        productRatings.reduce((acc, item) => acc + item.rating, 0) /
        productRatings.length;
    }

    await ProductModel.findByIdAndUpdate(productId, {
      averageRating: Number(averageRating.toFixed(1)),
      ratings: productRatings,
    });

    return true;
  } catch (error) {
    console.error('Error updating product average rating:', error);
    return false;
  }
};
