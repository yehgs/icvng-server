import ProductRequestModel from '../models/productRequest.model.js';

// MANAGER (HQ or Foreign) is bound to a single country's product requests —
// HQ Manager to NG (the HQ market), Foreign Manager to their assignedCountry.
// IT/DIRECTOR are unrestricted. Returns null when unrestricted, or the
// country code a MANAGER is limited to.
function managerCountryLock(request) {
  if (request.user?.subRole !== 'MANAGER') return null;
  return request.countryScope || 'NG';
}

// Create a new product request
export const createProductRequestController = async (request, response) => {
  try {
    const { productId, quantity, message } = request.body;
    const userId = request.userId;

    if (!productId || !quantity) {
      return response.status(400).json({
        message: 'Product ID and quantity are required',
        error: true,
        success: false,
      });
    }

    const newRequest = new ProductRequestModel({
      user: userId,
      product: productId,
      quantity,
      message: message || '',
      countryCode: request.countryCode || 'NG',
    });

    const savedRequest = await newRequest.save();

    if (!savedRequest) {
      return response.status(500).json({
        message: 'Product request not created!',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Product request successfully submitted',
      data: savedRequest,
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

// Get all product requests (admin)
export const getAllProductRequestsController = async (request, response) => {
  try {
    // Country scoping: IT/DIRECTOR see everything. MANAGER (HQ or Foreign)
    // only sees requests placed on their own country's storefront —
    // HQ Manager is GLOBAL scope but still bound to NG (the HQ market);
    // Foreign Manager is bound to their assignedCountry.
    const query = {};
    if (request.user?.subRole === 'MANAGER') {
      query.countryCode = request.countryScope || 'NG';
    }

    const data = await ProductRequestModel.find(query)
      .populate('user', 'name email mobile avatar')
      .populate('product', 'name image price stock')
      .sort({ createdAt: -1 });

    return response.json({
      data,
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

// Get product requests for specific user
export const getUserProductRequestsController = async (request, response) => {
  try {
    const userId = request.userId;

    const data = await ProductRequestModel.find({ user: userId })
      .populate('product', 'name image price stock')
      .sort({ createdAt: -1 });

    return response.json({
      data,
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

// Get single product request details
export const getProductRequestDetailsController = async (request, response) => {
  try {
    const { requestId } = request.params;

    if (!requestId) {
      return response.status(400).json({
        message: 'Request ID is required',
        error: true,
        success: false,
      });
    }

    const requestDetails = await ProductRequestModel.findById(requestId)
      .populate('user', 'name email mobile avatar')
      .populate('product', 'name image price stock');

    if (!requestDetails) {
      return response.status(404).json({
        message: 'Product request not found',
        error: true,
        success: false,
      });
    }

    const isAdmin = request.user?.role === 'ADMIN';
    if (!isAdmin) {
      // Customer viewing their own request only.
      const ownerId = requestDetails.user?._id || requestDetails.user;
      if (String(ownerId) !== String(request.userId || request.user?._id)) {
        return response.status(404).json({
          message: 'Product request not found',
          error: true,
          success: false,
        });
      }
    } else {
      const countryLock = managerCountryLock(request);
      if (countryLock && requestDetails.countryCode !== countryLock) {
        return response.status(404).json({
          message: 'Product request not found',
          error: true,
          success: false,
        });
      }
    }

    return response.json({
      data: requestDetails,
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

// Update product request status (admin only)
export const updateProductRequestStatusController = async (
  request,
  response
) => {
  try {
    const { requestId, status, adminNotes } = request.body;

    if (!requestId || !status) {
      return response.status(400).json({
        message: 'Request ID and status are required',
        error: true,
        success: false,
      });
    }

    const validStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED'];
    if (!validStatuses.includes(status)) {
      return response.status(400).json({
        message: 'Invalid status value',
        error: true,
        success: false,
      });
    }

    const countryLock = managerCountryLock(request);
    if (countryLock) {
      const existing = await ProductRequestModel.findById(requestId).select('countryCode');
      if (!existing || existing.countryCode !== countryLock) {
        return response.status(404).json({
          message: 'Product request not found',
          error: true,
          success: false,
        });
      }
    }

    const updateData = {
      status,
      ...(adminNotes !== undefined && { adminNotes }),
    };

    const updatedRequest = await ProductRequestModel.findByIdAndUpdate(
      requestId,
      updateData,
      { new: true }
    )
      .populate('user', 'name email mobile avatar')
      .populate('product', 'name image price stock');

    if (!updatedRequest) {
      return response.status(404).json({
        message: 'Product request not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Product request updated successfully',
      data: updatedRequest,
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

// Delete product request (admin only)
export const deleteProductRequestController = async (request, response) => {
  try {
    const { requestId } = request.body;

    if (!requestId) {
      return response.status(400).json({
        message: 'Request ID is required',
        error: true,
        success: false,
      });
    }

    const countryLock = managerCountryLock(request);
    if (countryLock) {
      const existing = await ProductRequestModel.findById(requestId).select('countryCode');
      if (!existing || existing.countryCode !== countryLock) {
        return response.status(404).json({
          message: 'Product request not found',
          error: true,
          success: false,
        });
      }
    }

    const deletedRequest = await ProductRequestModel.findByIdAndDelete(
      requestId
    );

    if (!deletedRequest) {
      return response.status(404).json({
        message: 'Product request not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Product request deleted successfully',
      data: deletedRequest,
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
