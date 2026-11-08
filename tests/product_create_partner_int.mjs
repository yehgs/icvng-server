// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27018 node tests/product_create_partner_int.mjs
//
// Regression for: "on creating a product the partnership stock is not saved to
// the database, but on edit/update it is". Root cause: createProductController
// read `partnerStock` only for the purchasability check and never copied it onto
// the document it saved. `colors` (also submitted by the admin form) was dropped
// the same way.
process.env.SECRET_KEY_ACCESS_TOKEN = "testsecret";
delete process.env.OPENAI_API_KEY; // no key -> translation fails fast instead of retrying a blocked network call
import assert from "assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";

await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_test_pc_" + Date.now());
const { default: countryDetect } = await import("../middleware/countryDetect.js");
const { default: countryContext } = await import("../middleware/countryContext.js");
const { default: productRouter } = await import("../route/product.route.js");
const { default: User } = await import("../models/user.model.js");
const { default: Product } = await import("../models/product.model.js");
const { default: Category } = await import("../models/category.model.js");
const { default: Supplier } = await import("../models/supplier.model.js");
const { ColorModel: Color } = await import("../models/color.model.js");
// models referenced via populate()/refs are registered at app boot in production
for (const m of ["tag", "attribute", "brand", "subCategory", "compatible", "roasted-area"]) {
  await import(`../models/${m}.model.js`).catch(() => {});
}
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(countryDetect);
app.use(countryContext);
app.use("/api/product", productRouter);

let n = 0;
const mk = async (subRole, scope = "GLOBAL", assignedCountry = null) => {
  const u = await User.create({ name: `${subRole}`, email: `u${++n}@t.com`, password: "x", role: "ADMIN", subRole, scope, assignedCountry, status: "Active", avatar: "https://img/a.png" });
  return { u, h: { Authorization: `Bearer ${jwt.sign({ id: String(u._id) }, "testsecret")}` } };
};
const it = await mk("IT");
const editor = await mk("EDITOR");
const tgMgr = await mk("MANAGER", "COUNTRY", "TG");

const cat = await Category.create({ name: "Coffee Beans", slug: "beans" });
const supplier = await Supplier.create({ name: "Tigray Partner", slug: "tigray", supplierType: "PARTNER", email: "p@t.com", contactPerson: { name: "T", phone: "+2348083243112" } });
const color = await Color.create({ name: "Red", slug: "red", hexCode: "#ff0000" }).catch(() => null);

const base = (over = {}) => ({
  name: "Partner Coffee " + Math.random().toString(36).slice(2, 7),
  image: ["https://img/x.png"],
  category: String(cat._id),
  shortDescription: "short",
  productType: "COFFEE_BEANS",
  btcPrice: 5000,
  ...over,
});

// 1. THE BUG — partner stock must persist on create
let r = await request(app).post("/api/product/create").set(it.h).send(base({
  partnerStock: { enabled: true, quantity: 10, supplier: String(supplier._id), notes: "Restocked monthly" },
}));
assert.equal(r.status, 200, JSON.stringify(r.body));
let saved = await Product.findById(r.body.data._id).lean();
assert.equal(saved.partnerStock.enabled, true, "partnerStock.enabled must be saved on create");
assert.equal(saved.partnerStock.quantity, 10, "partnerStock.quantity must be saved on create");
assert.equal(String(saved.partnerStock.supplier), String(supplier._id), "partnerStock.supplier must be saved on create");
assert.equal(saved.partnerStock.notes, "Restocked monthly");
assert.equal(String(saved.partnerStock.updatedBy), String(it.u._id), "updatedBy stamped");
assert.equal(saved.publish, "PENDING", "partner product with stock + price is purchasable, stays PENDING");

// 2. Empty-string supplier (the form's default) must not break create
r = await request(app).post("/api/product/create").set(it.h).send(base({
  partnerStock: { enabled: true, quantity: 3, supplier: "", notes: "" },
}));
assert.equal(r.status, 200, JSON.stringify(r.body));
saved = await Product.findById(r.body.data._id).lean();
assert.equal(saved.partnerStock.quantity, 3);
assert.equal(saved.partnerStock.supplier ?? null, null);

// 3. Disabled partner stock (untouched toggle) stays disabled, quantity not smuggled in
r = await request(app).post("/api/product/create").set(it.h).send(base({
  partnerStock: { enabled: false, quantity: 99, supplier: "", notes: "" },
}));
saved = await Product.findById(r.body.data._id).lean();
assert.equal(saved.partnerStock.enabled, false);
assert.equal(saved.partnerStock.quantity, 0, "quantity ignored when partner stock is disabled");

// 4. Quantity sanitised: string, negative, NaN
r = await request(app).post("/api/product/create").set(it.h).send(base({ partnerStock: { enabled: true, quantity: "7", supplier: "" } }));
assert.equal((await Product.findById(r.body.data._id).lean()).partnerStock.quantity, 7, "numeric string coerced");
r = await request(app).post("/api/product/create").set(it.h).send(base({ partnerStock: { enabled: true, quantity: -5, supplier: "" } }));
assert.equal((await Product.findById(r.body.data._id).lean()).partnerStock.quantity, 0, "negative clamped to 0");
r = await request(app).post("/api/product/create").set(it.h).send(base({ partnerStock: { enabled: true, quantity: "abc", supplier: "" } }));
assert.equal((await Product.findById(r.body.data._id).lean()).partnerStock.quantity, 0, "NaN -> 0");

// 5. Enabled but zero quantity is not purchasable -> forced DRAFT (existing rule preserved)
r = await request(app).post("/api/product/create").set(it.h).send(base({ partnerStock: { enabled: true, quantity: 0, supplier: "" }, publish: "PUBLISHED" }));
assert.equal((await Product.findById(r.body.data._id).lean()).publish, "DRAFT");

// 6. A non-NG country-scoped admin cannot create partner stock (same rule as update)
r = await request(app).post("/api/product/create").set(tgMgr.h).send(base({ partnerStock: { enabled: true, quantity: 10, supplier: "" } }));
assert.equal(r.status, 200, JSON.stringify(r.body));
saved = await Product.findById(r.body.data._id).lean();
assert.equal(saved.partnerStock.enabled, false, "TG manager's partnerStock dropped, mirroring update");
assert.equal(saved.partnerStock.quantity, 0);

// 7. Editor (HQ-only role) can create partner stock
r = await request(app).post("/api/product/create").set(editor.h).send(base({ partnerStock: { enabled: true, quantity: 4, supplier: String(supplier._id) } }));
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal((await Product.findById(r.body.data._id).lean()).partnerStock.quantity, 4);

// 8. colors submitted by the form are persisted on create (same class of bug)
if (color) {
  r = await request(app).post("/api/product/create").set(it.h).send(base({ colors: [String(color._id), ""] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  saved = await Product.findById(r.body.data._id).lean();
  assert.deepEqual(saved.colors.map(String), [String(color._id)], "colors saved on create, blanks filtered");
}

// 9. Update path unchanged (regression)
const created = await Product.findOne({ "partnerStock.quantity": 10 });
r = await request(app).put("/api/product/update-product-details").set(it.h).send({ _id: String(created._id), partnerStock: { enabled: true, quantity: 25, supplier: String(supplier._id), notes: "x" } });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal((await Product.findById(created._id).lean()).partnerStock.quantity, 25);

console.log("product_create_partner_int: all assertions passed");
await mongoose.disconnect();
process.exit(0);
