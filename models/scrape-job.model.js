//server
// models/scrape-job.model.js
import mongoose from 'mongoose';

export const SCRAPE_PLATFORMS = [
  'Google Search',
  'Google Maps',
  'Facebook',
  'LinkedIn',
  'Instagram',
  'Twitter / X',
  'Yellow Pages NG',
  'VConnect NG',
  'Jobberman',
  'Custom URL',
];

const scrapeJobSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },     // e.g. "Coffee shops Lagos"
    platform: { type: String, enum: SCRAPE_PLATFORMS, default: 'Google Search' },
    targetUrl: { type: String, default: '' },    // full URL or search query
    searchQuery: { type: String, default: '' },  // e.g. "coffee shops Lagos Nigeria"
    maxPages: { type: Number, default: 3 },
    maxResults: { type: Number, default: 50 },

    // Fields to extract
    extractFields: {
      emails: { type: Boolean, default: true },
      phones: { type: Boolean, default: true },
      companyName: { type: Boolean, default: true },
      website: { type: Boolean, default: true },
      address: { type: Boolean, default: true },
      socialLinks: { type: Boolean, default: true },
    },

    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
      default: 'pending',
    },
    progress: { type: Number, default: 0 },     // 0-100
    totalFound: { type: Number, default: 0 },
    totalImported: { type: Number, default: 0 },
    errorMessage: { type: String, default: '' },

    // Scrape results stored here before review
    rawResults: [{ type: mongoose.Schema.Types.Mixed }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: String,
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const ScrapeJobModel = mongoose.model('ScrapeJob', scrapeJobSchema);
export default ScrapeJobModel;
