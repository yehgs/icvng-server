import ProductModel from '../models/product.model.js';
import RatingModel from '../models/rating.model.js';

export const addRatingController = async (req, res) => {
  try {
    const { product, rating, review } = req.body;
    const user = req.user.id;

    if (!product || !rating) {
      return res
        .status(400)
        .json({ message: 'Product and rating are required', error: true });
    }

    const newRating = new RatingModel({ user, product, rating, review });
    await newRating.save();

    const productRatings = await RatingModel.find({ product });
    const averageRating =
      productRatings.reduce((acc, item) => acc + item.rating, 0) /
      productRatings.length;

    await ProductModel.findByIdAndUpdate(product, { averageRating });

    res.json({ message: 'Rating added successfully', success: true });
  } catch (error) {
    res.status(500).json({ message: error.message, error: true });
  }
};

export const getRatingsController = async (req, res) => {
  try {
    const { product } = req.query;
    const ratings = await RatingModel.find(product ? { product } : {}).populate(
      'user',
      'name'
    );
    res.json({ data: ratings, success: true });
  } catch (error) {
    res.status(500).json({ message: error.message, error: true });
  }
};

export const deleteRatingController = async (req, res) => {
  try {
    const { _id } = req.body;
    await RatingModel.findByIdAndDelete(_id);
    res.json({ message: 'Rating deleted successfully', success: true });
  } catch (error) {
    res.status(500).json({ message: error.message, error: true });
  }
};
