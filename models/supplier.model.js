import mongoose from "mongoose";

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      unique: true,
      required: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
    },
    phone: {
      type: String,
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
    },
    contactPerson: {
      name: String,
      phone: String,
      email: String,
    },
    bankDetails: {
      bankName: String,
      accountNumber: String,
      routingNumber: String,
      swiftCode: String,
    },
    taxInfo: {
      taxId: String,
      vatNumber: String,
    },
    paymentTerms: {
      type: String,
      enum: ["NET_30", "NET_60", "COD", "ADVANCE", "CUSTOM"],
      default: "NET_30",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "BLACKLISTED"],
      default: "ACTIVE",
    },
    // PARTNER = quick-created from product form, minimal info (name only required)
    // FULL = complete supplier record with email, phone, bank details etc.
    supplierType: {
      type: String,
      enum: ["FULL", "PARTNER"],
      default: "FULL",
    },
    notes: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

const SupplierModel = mongoose.model("Supplier", supplierSchema);

export default SupplierModel;
