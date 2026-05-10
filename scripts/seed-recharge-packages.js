/**
 * Seed / re-sync the 7 production recharge packages.
 *
 * Idempotent: each row is upserted by `googleProductId`, so running
 * this multiple times converges the collection on the canonical state
 * without creating duplicates and without touching unrelated rows.
 *
 * Usage (from zimolive-backend/):
 *   node scripts/seed-recharge-packages.js
 *
 * Reads MONGODB_URI from .env. Reports per-row insert/update outcome
 * and a final count, so a CI run logs cleanly.
 *
 * Mega pack (`coin_pack_16m_mega`) is intentionally excluded — see
 * docs/revenuecat-setup.md for the full 8-tier ladder. Add it later
 * when whale targeting is on the roadmap.
 */
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const URI = process.env.MONGODB_URI;
if (!URI) {
  console.error('MONGODB_URI not set in .env — aborting.');
  process.exit(1);
}

// Plain schema — we don't need Mongoose validators here since this
// script writes the exact shape the production schema expects.
const Pkg = mongoose.model(
  'RechargePackage',
  new mongoose.Schema({}, { strict: false, collection: 'recharge_packages' }),
);

const PACKAGES = [
  {
    googleProductId: 'coin_pack_60_starter',
    appleProductId: 'coin_pack_60_starter_apple',
    coins: 60000,
    bonusCoins: 0,
    priceAmount: 60,
    priceCurrency: 'BDT',
    badgeText: '',
    sortOrder: 80,
    active: true,
  },
  {
    googleProductId: 'coin_pack_130_small',
    appleProductId: 'coin_pack_130_small_apple',
    coins: 120000,
    bonusCoins: 10000,
    priceAmount: 120,
    priceCurrency: 'BDT',
    badgeText: '',
    sortOrder: 70,
    active: true,
  },
  {
    googleProductId: 'coin_pack_270_medium',
    appleProductId: 'coin_pack_270_medium_apple',
    coins: 240000,
    bonusCoins: 30000,
    priceAmount: 240,
    priceCurrency: 'BDT',
    badgeText: '🎁',
    sortOrder: 60,
    active: true,
  },
  {
    googleProductId: 'coin_pack_700_large',
    appleProductId: 'coin_pack_700_large_apple',
    coins: 600000,
    bonusCoins: 100000,
    priceAmount: 600,
    priceCurrency: 'BDT',
    badgeText: 'HOT',
    sortOrder: 50,
    active: true,
  },
  {
    googleProductId: 'coin_pack_1450_xl',
    appleProductId: 'coin_pack_1450_xl_apple',
    coins: 1200000,
    bonusCoins: 250000,
    priceAmount: 1200,
    priceCurrency: 'BDT',
    badgeText: '🔥',
    sortOrder: 40,
    active: true,
  },
  {
    googleProductId: 'coin_pack_3000_xxl',
    appleProductId: 'coin_pack_3000_xxl_apple',
    coins: 2400000,
    bonusCoins: 600000,
    priceAmount: 2400,
    priceCurrency: 'BDT',
    badgeText: '',
    sortOrder: 30,
    active: true,
  },
  {
    googleProductId: 'coin_pack_7700_whale',
    appleProductId: 'coin_pack_7700_whale_apple',
    coins: 6000000,
    bonusCoins: 1700000,
    priceAmount: 6000,
    priceCurrency: 'BDT',
    badgeText: '💎',
    sortOrder: 20,
    active: true,
  },
];

async function main() {
  await mongoose.connect(URI);
  console.log('connected to mongo');

  const before = await Pkg.countDocuments({});
  console.log(`existing recharge_packages count: ${before}`);

  let upserted = 0;
  let updated = 0;
  for (const p of PACKAGES) {
    const res = await Pkg.updateOne(
      { googleProductId: p.googleProductId },
      { $set: p, $setOnInsert: { createdAt: new Date() }, $currentDate: { updatedAt: true } },
      { upsert: true },
    );
    if (res.upsertedCount > 0) {
      upserted++;
      console.log(`  + ${p.googleProductId}  (${p.coins.toLocaleString()} + ${p.bonusCoins.toLocaleString()} bonus, ${p.priceAmount} ${p.priceCurrency})`);
    } else if (res.modifiedCount > 0) {
      updated++;
      console.log(`  ~ ${p.googleProductId}  updated`);
    } else {
      console.log(`  · ${p.googleProductId}  unchanged`);
    }
  }

  const after = await Pkg.countDocuments({});
  console.log(`\nsummary: ${upserted} inserted, ${updated} updated`);
  console.log(`total recharge_packages count: ${after}`);

  // Final readout, ranked the way the wallet grid displays them.
  const rows = await Pkg.find(
    { active: true },
    { coins: 1, bonusCoins: 1, priceAmount: 1, priceCurrency: 1, googleProductId: 1, sortOrder: 1 },
  )
    .sort({ sortOrder: -1 })
    .lean();
  console.log('\nactive packages (display order):');
  for (const r of rows) {
    const total = (r.coins ?? 0) + (r.bonusCoins ?? 0);
    console.log(
      `  ${String(r.sortOrder ?? 0).padStart(3)}  ${r.googleProductId.padEnd(28)}  ${total.toLocaleString().padStart(12)} coins  ${r.priceAmount} ${r.priceCurrency}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
