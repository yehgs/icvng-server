//server
import mongoose from 'mongoose';
import countryScopedPlugin from "../core/countryScopedPlugin.js";

export const INCOME_CATEGORIES = [
  // Formal
  'Product Sales',
  'Service Revenue',
  'Consulting Fee',
  'Commission',
  'Subscription Revenue',
  'Licensing Fee',
  'Investment Return',
  'Bank Interest',
  'Loan Received',
  'Grant / Funding',
  'Refund Received',
  // Informal
  'Personal Contribution',
  'Side Business',
  'Gift / Donation Received',
  'Cash Inflow',
  'Other Income',
];

export const EXPENSE_CATEGORIES = [
  // Operations
  'Rent / Office Space',
  'Utilities (Electricity, Water)',
  'Internet & Telecom',
  'Office Supplies',
  'Equipment Purchase',
  'Equipment Maintenance',
  'Software / Subscriptions',
  'Hosting & Domain',
  // Staff
  'Staff Salary',
  'Contractor Payment',
  'Staff Bonus',
  'Staff Welfare',
  'Training & Development',
  // Marketing
  'Advertising',
  'Social Media Marketing',
  'Branding & Design',
  'Event Sponsorship',
  // Logistics
  'Shipping & Delivery',
  'Fuel / Transport',
  'Vehicle Maintenance',
  // Finance
  'Bank Charges',
  'Loan Repayment',
  'Tax Payment',
  'Insurance',
  'Accounting / Audit',
  // Procurement
  'Inventory Purchase',
  'Raw Materials',
  'Supplier Payment',
  // Informal
  'Personal Withdrawal',
  'Miscellaneous',
  'Cash Expenditure',
  'Entertainment',
  'Gift / Donation Given',
  'Other Expense',
];

export const CURRENCIES = [
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'XAF', symbol: 'FCFA', name: 'CFA Franc (Central)' },
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
];

export const PAYMENT_METHODS = [
  'Cash',
  'Bank Transfer',
  'POS / Debit Card',
  'Credit Card',
  'Mobile Money',
  'Cheque',
  'Cryptocurrency',
  'Online Payment',
  'Other',
];

const bankDetailsSchema = new mongoose.Schema({
  bankName: String,
  accountName: String,
  accountNumber: String,
  sortCode: String,
  swiftCode: String,
  iban: String,
}, { _id: false });

const cardDetailsSchema = new mongoose.Schema({
  cardType: { type: String, enum: ['Visa', 'Mastercard', 'Verve', 'Amex', 'Other'] },
  cardholderName: String,
  last4Digits: String,
  expiryMonth: String,
  expiryYear: String,
  bankName: String,
  cardColor: String, // hex, for visual differentiation
}, { _id: false });

const financeEntrySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['income', 'expense'],
      required: true,
    },

    title: { type: String, required: true },
    description: { type: String, default: '' },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'NGN', uppercase: true },
    // Exchange rate to NGN at the time of entry
    exchangeRateToNGN: { type: Number, default: 1 },
    // Computed amount in NGN
    amountInNGN: { type: Number, default: 0 },

    category: { type: String, required: true },
    // Optional custom category if not in predefined list
    customCategory: { type: String, default: '' },

    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: 'Cash',
    },

    bankDetails: { type: bankDetailsSchema, default: null },
    cardDetails: { type: cardDetailsSchema, default: null },

    // Date of the actual transaction (may differ from createdAt)
    transactionDate: { type: Date, default: Date.now },

    // Tags for filtering
    tags: [{ type: String }],

    // Attachments (receipts, invoices)
    attachments: [
      {
        url: String,
        public_id: String,
        name: String,
        type: { type: String, enum: ['image', 'pdf', 'other'] },
      },
    ],

    // Reference number / invoice number
    referenceNumber: { type: String, default: '' },

    // Who created the entry (always DIRECTOR)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    isRecurring: { type: Boolean, default: false },
    recurringPeriod: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', null],
      default: null,
    },

    notes: { type: String, default: '' },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Auto-compute amountInNGN before save
financeEntrySchema.pre('save', function (next) {
  if (this.currency === 'NGN') {
    this.amountInNGN = this.amount;
  } else {
    this.amountInNGN = this.amount * (this.exchangeRateToNGN || 1);
  }
  next();
});

financeEntrySchema.index({ type: 1, transactionDate: -1 });
financeEntrySchema.index({ currency: 1 });
financeEntrySchema.index({ category: 1 });


// PHASE 3: country dimension + isolation hooks
financeEntrySchema.plugin(countryScopedPlugin);

const FinanceEntryModel = mongoose.model('FinanceEntry', financeEntrySchema);
export default FinanceEntryModel;
