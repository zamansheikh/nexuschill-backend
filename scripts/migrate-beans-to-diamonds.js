/**
 * One-shot migration: rename every `beans*` field/value to `diamonds*` in
 * existing MongoDB documents. The schema rename in code is incomplete on its
 * own — old docs persisted under the old field names will simply be ignored
 * by Mongoose (so user balances appear as 0 after the rename).
 *
 * Run once after deploying the rename:
 *
 *     docker compose cp scripts/migrate-beans-to-diamonds.js backend:/tmp/m.js
 *     docker compose exec backend node /tmp/m.js
 *
 * Idempotent: if a doc already has the new field, $rename is a no-op.
 */

const mongoose = require('mongoose');

async function main() {
  const uri =
    process.env.MONGODB_URI ||
    'mongodb://localhost:27017/party_app';

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  console.log(`Connected: ${db.databaseName}`);

  const ops = [
    {
      coll: 'wallets',
      filter: {},
      rename: {
        beans: 'diamonds',
        lifetimeBeansEarned: 'lifetimeDiamondsEarned',
        lifetimeBeansWithdrawn: 'lifetimeDiamondsWithdrawn',
      },
    },
    {
      coll: 'users',
      // Only target hosts — others have hostProfile=null and $rename would
      // throw "cannot traverse null".
      filter: { 'hostProfile.totalBeansEarned': { $exists: true } },
      rename: {
        'hostProfile.totalBeansEarned': 'hostProfile.totalDiamondsEarned',
      },
    },
    {
      coll: 'agencies',
      filter: {},
      rename: { totalBeansEarned: 'totalDiamondsEarned' },
    },
    {
      coll: 'gifts',
      filter: {},
      rename: { beanReward: 'diamondReward' },
    },
    {
      coll: 'giftevents',
      filter: {},
      rename: { totalBeanReward: 'totalDiamondReward' },
    },
  ];

  for (const op of ops) {
    const res = await db
      .collection(op.coll)
      .updateMany(op.filter, { $rename: op.rename });
    console.log(
      `  ${op.coll}: matched=${res.matchedCount} modified=${res.modifiedCount}`,
    );
  }

  // Transaction enum values: 'beans' → 'diamonds'.
  const txnRes = await db
    .collection('transactions')
    .updateMany({ currency: 'beans' }, { $set: { currency: 'diamonds' } });
  console.log(
    `  transactions: currency='beans' → 'diamonds' modified=${txnRes.modifiedCount}`,
  );

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
