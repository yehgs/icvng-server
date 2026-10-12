// Run: TEST_MONGO_URI=mongodb://127.0.0.1:27017 node tests/giftcard_cinetpay_int.mjs  (needs supertest)
import assert from "assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import request from "supertest";

process.env.CINETPAY_API_KEY_TG = "k"; process.env.CINETPAY_SITE_ID_TG = "s";
process.env.SERVER_BASE_URL = "https://api.test"; process.env.FRONTEND_URL = "https://front.test";
await mongoose.connect((process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27018") + "/icv_gc_" + Date.now());
const { default: countryDetect } = await import("../middleware/countryDetect.js");
const { default: countryContext } = await import("../middleware/countryContext.js");
const { default: giftRouter } = await import("../route/giftCard.route.js");
const { default: Intent } = await import("../models/paymentIntent.model.js");
const { default: GiftCard } = await import("../models/giftCard.model.js");
const { refreshCountryCache } = await import("../services/countryService.js");
await refreshCountryCache();

const app = express();
app.use(express.json()); app.use(cookieParser()); app.use(countryDetect); app.use(countryContext);
app.use("/api/gift-card", giftRouter);

let cpStatus = "ACCEPTED", lastInit;
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  if (String(url).endsWith("/payment/check")) return { json: async () => ({ code: "00", data: { status: cpStatus, amount: String(lastInit.amount), currency: "XOF" } }) };
  lastInit = body;
  return { json: async () => ({ code: "201", data: { payment_url: "https://pay.cinetpay/x", payment_token: "t" } }) };
};
const tg = (m, p) => request(app)[m]("/api/gift-card" + p).set("x-app-country", "TG");
const ng = (m, p) => request(app)[m]("/api/gift-card" + p).set("x-app-country", "NG");
const body = { amount: 5002, recipientEmail: "r@t.com", purchaserEmail: "p@t.com", senderName: "Ama Kofi", message: "hi" };

let r = await tg("post", "/purchase/cinetpay").send({ ...body, amount: 100 });
assert.equal(r.status, 400); assert.match(r.body.message, /between 2,000/);

r = await tg("post", "/purchase/cinetpay").send(body);
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.data.paymentUrl, "https://pay.cinetpay/x");
const ref = r.body.data.reference;
assert.equal(lastInit.currency, "XOF"); assert.equal(lastInit.amount, 5005, "XOF rounded up to multiple of 5");
assert.match(lastInit.notify_url, /gift-card\/purchase\/cinetpay\/webhook\/TG$/);
assert.match(lastInit.return_url, /gift-cards\/cinetpay\/callback\?reference=GCCTP-/);
assert.equal((await Intent.findOne({ reference: ref })).metadata.countryCode, "TG");

cpStatus = "REFUSED";
r = await tg("get", `/purchase/cinetpay/verify/${ref}`); assert.equal(r.status, 400);
assert.equal(await GiftCard.countDocuments(), 0);

cpStatus = "ACCEPTED";
r = await tg("get", `/purchase/cinetpay/verify/${ref}`);
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.data.currency, "XOF"); assert.equal(r.body.data.amount, 5005);
const code = r.body.data.code;
r = await tg("post", `/purchase/cinetpay/webhook/TG`).send({ cpm_trans_id: ref }); assert.equal(r.status, 200);
r = await tg("get", `/purchase/cinetpay/verify/${ref}`); assert.equal(r.body.data.code, code, "idempotent");
assert.equal(await GiftCard.countDocuments(), 1);
const gc = await GiftCard.findOne({ code }); assert.equal(gc.countryCode, "TG"); assert.equal(gc.paymentProvider, "CINETPAY");

assert.equal((await tg("get", `/balance/${code}`)).status, 200);
assert.equal((await ng("get", `/balance/${code}`)).status, 404, "TG card invisible on NG storefront");
r = await ng("post", "/purchase/cinetpay").send(body); assert.equal(r.status, 400, "CinetPay unavailable in NG");
r = await tg("get", "/purchase/cinetpay/verify/nope"); assert.equal(r.status, 404);
console.log("giftcard cinetpay ✓"); process.exit(0);
