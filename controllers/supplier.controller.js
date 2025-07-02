// controllers/supplier.controller.js
import { SupplierModel } from '../models/supplier.model.js';
import generateSlug from '../utils/generateSlug.js';

export const createSupplierController = async (request, response) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      contactPerson,
      bankDetails,
      taxInfo,
      paymentTerms,
      status,
      notes,
    } = request.body;

    if (!name || !email || !phone) {
      return response.status(400).json({
        message: 'Name, email, and phone are required',
        error: true,
        success: false,
      });
    }

    const slug = generateSlug(name);

    const existingSupplier = await SupplierModel.findOne({
      $or: [{ email }, { slug }],
    });

    if (existingSupplier) {
      return response.status(400).json({
        message: 'Supplier with this email or name already exists',
        error: true,
        success: false,
      });
    }

    const supplier = new SupplierModel({
      name,
      slug,
      email,
      phone,
      address: address || {},
      contactPerson: contactPerson || {},
      bankDetails: bankDetails || {},
      taxInfo: taxInfo || {},
      paymentTerms: paymentTerms || 'NET_30',
      status: status || 'ACTIVE',
      notes: notes || '',
      createdBy: request.user._id,
      updatedBy: request.user._id,
    });

    const savedSupplier = await supplier.save();

    // Populate the saved supplier with user details
    const populatedSupplier = await SupplierModel.findById(
      savedSupplier._id
    ).populate('createdBy updatedBy', 'name email');

    return response.json({
      message: 'Supplier created successfully',
      data: populatedSupplier,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Create supplier error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to create supplier',
      error: true,
      success: false,
    });
  }
};

export const getSuppliersController = async (request, response) => {
  try {
    let { page, limit, search, status } = request.query;

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { 'contactPerson.name': { $regex: search, $options: 'i' } },
      ];
    }

    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const [suppliers, totalCount] = await Promise.all([
      SupplierModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy updatedBy', 'name email'),
      SupplierModel.countDocuments(query),
    ]);

    return response.json({
      message: 'Suppliers retrieved successfully',
      data: suppliers,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get suppliers error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve suppliers',
      error: true,
      success: false,
    });
  }
};

export const getSupplierDetailsController = async (request, response) => {
  try {
    const { supplierId } = request.params;

    if (!supplierId) {
      return response.status(400).json({
        message: 'Supplier ID is required',
        error: true,
        success: false,
      });
    }

    const supplier = await SupplierModel.findById(supplierId).populate(
      'createdBy updatedBy',
      'name email'
    );

    if (!supplier) {
      return response.status(404).json({
        message: 'Supplier not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Supplier details retrieved successfully',
      data: supplier,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get supplier details error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve supplier details',
      error: true,
      success: false,
    });
  }
};

export const updateSupplierController = async (request, response) => {
  try {
    const { supplierId } = request.params;
    const updateData = request.body;

    if (!supplierId) {
      return response.status(400).json({
        message: 'Supplier ID is required',
        error: true,
        success: false,
      });
    }

    const supplier = await SupplierModel.findById(supplierId);

    if (!supplier) {
      return response.status(404).json({
        message: 'Supplier not found',
        error: true,
        success: false,
      });
    }

    // Check for duplicate email if email is being updated
    if (updateData.email && updateData.email !== supplier.email) {
      const existingSupplier = await SupplierModel.findOne({
        email: updateData.email,
        _id: { $ne: supplierId },
      });

      if (existingSupplier) {
        return response.status(400).json({
          message: 'Email already exists for another supplier',
          error: true,
          success: false,
        });
      }
    }

    // Update slug if name is being changed
    if (updateData.name && updateData.name !== supplier.name) {
      updateData.slug = generateSlug(updateData.name);

      // Check for duplicate slug
      const existingSlug = await SupplierModel.findOne({
        slug: updateData.slug,
        _id: { $ne: supplierId },
      });

      if (existingSlug) {
        return response.status(400).json({
          message: 'Supplier with similar name already exists',
          error: true,
          success: false,
        });
      }
    }

    // Add updatedBy field
    updateData.updatedBy = request.user._id;

    const updatedSupplier = await SupplierModel.findByIdAndUpdate(
      supplierId,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy updatedBy', 'name email');

    return response.json({
      message: 'Supplier updated successfully',
      data: updatedSupplier,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update supplier error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update supplier',
      error: true,
      success: false,
    });
  }
};

export const deleteSupplierController = async (request, response) => {
  try {
    const { supplierId } = request.params;

    if (!supplierId) {
      return response.status(400).json({
        message: 'Supplier ID is required',
        error: true,
        success: false,
      });
    }

    const deletedSupplier = await SupplierModel.findByIdAndDelete(supplierId);

    if (!deletedSupplier) {
      return response.status(404).json({
        message: 'Supplier not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Supplier deleted successfully',
      data: deletedSupplier,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Delete supplier error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to delete supplier',
      error: true,
      success: false,
    });
  }
};

// Get suppliers for dropdown/selection
export const getSuppliersForSelection = async (request, response) => {
  try {
    const suppliers = await SupplierModel.find(
      { status: 'ACTIVE' },
      'name email phone _id'
    ).sort({ name: 1 });

    return response.json({
      message: 'Suppliers for selection retrieved successfully',
      data: suppliers,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get suppliers for selection error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to retrieve suppliers',
      error: true,
      success: false,
    });
  }
};
