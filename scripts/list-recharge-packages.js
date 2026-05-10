/**
 * One-shot dump of every row in `recharge_packages`. Used to audit
 * legacy rows that predate the RevenueCat product-id fields, so the
 * operator can decide whether to deactivate / delete / map them.
 *
 * Usage (from zimolive-backend/):
 *   node scripts/list-recharge-packages.js
 */
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error('MONGODB_URI not set in .env');
  process.exit(1);
}

const Pkg = mongoose.model(
  'RechargePackage',
  new mongoose.Schema({}, { strict: false, collection: 'recharge_packages' }),
);

async function main() {
  await mongoose.connect(URI);
  const rows = await Pkg.find({}).sort({ sortOrder: -1, createdAt: 1 }).lean();
  console.log(`recharge_packages — ${rows.length} rows total\n`);
  for (const r of rows) {
    const id = r._id?.toString() ?? '(no _id)';
    const total = (r.coins ?? 0) + (r.bonusCoins ?? 0);
    const sku = r.googleProductId || r.appleProductId || '(no store SKU)';
    const active = r.active ? 'active' : 'INACTIVE';
    console.log(`  _id=${id}`);
    console.log(`    coins=${(r.coins ?? 0).toLocaleString()}  bonus=${(r.bonusCoins ?? 0).toLocaleString()}  total=${total.toLocaleString()}`);
    console.log(`    price=${r.priceAmount ?? '?'} ${r.priceCurrency ?? '?'}  badge="${r.badgeText ?? ''}"  sortOrder=${r.sortOrder ?? 0}  ${active}`);
    console.log(`    sku=${sku}`);
    console.log(`    createdAt=${r.createdAt ?? '(unknown)'}`);
    console.log('');
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
