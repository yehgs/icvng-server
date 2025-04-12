import ProductModel from '../models/product.model.js';

export const updateCompatibleSystemController = async (req, res) => {
  try {
    const { productId, compatibleSystem } = req.body;

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      productId,
      { compatibleSystem },
      { new: true }
    );

    if (!updatedProduct) {
      return res
        .status(404)
        .json({ message: 'Product not found', error: true, success: false });
    }

    return res.json({
      message: 'Compatible System updated successfully',
      data: updatedProduct,
      success: true,
      error: false,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};
