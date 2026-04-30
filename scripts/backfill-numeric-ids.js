/**
 * Backfill 7-digit `numericId` on existing users / agencies / resellers.
 *
 * Strategy: for each collection, fetch every doc that has no `numericId`,
 * sort by createdAt ascending (oldest gets the lowest number), and assign
 * sequential ids starting at the current counter value (or 1_000_000 if
 * the counter doesn't exist yet). Then advance the counter past the
 * highest assigned number.
 *
 * Idempotent: docs that already have a `numericId` are skipped.
 *
 * Run inside the backend Docker container so mongoose resolves:
 *
 *     docker compose cp scripts/backfill-numeric-ids.js backend:/app/bf.js
 *     docker compose exec -w /app backend node ./bf.js
 */

const mongoose = require('mongoose');

const SEED = 999_999; // first allocated will be 1_000_000

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/party_app';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  console.log(`Connected: ${db.databaseName}`);

  const plan = [
    { coll: 'users', scope: 'user' },
    { coll: 'agencies', scope: 'agency' },
    { coll: 'resellers', scope: 'reseller' },
  ];

  for (const { coll, scope } of plan) {
    // Where is the counter today?
    const counter = await db.collection('counters').findOne({ _id: scope });
    let next = counter?.seq && counter.seq >= SEED ? counter.seq + 1 : 1_000_000;

    const cursor = db
      .collection(coll)
      .find({ numericId: { $exists: false } })
      .sort({ createdAt: 1 });

    let assigned = 0;
    for await (const doc of cursor) {
      // Loop until we find a free number (skip vanity/manually-claimed).
      let attempt = 0;
      while (attempt < 100) {
        const candidate = next++;
        try {
          const res = await db
            .collection(coll)
            .updateOne(
              { _id: doc._id, numericId: { $exists: false } },
              { $set: { numericId: candidate } },
            );
          if (res.modifiedCount === 1) {
            assigned++;
            break;
          }
          break; // someone else assigned in parallel — skip
        } catch (err) {
          if (err.code === 11000) {
            attempt++;
            continue; // duplicate-key, advance and retry
          }
          throw err;
        }
      }
    }

    // Bump the counter past the last assigned id.
    await db
      .collection('counters')
      .updateOne({ _id: scope }, { $max: { seq: next - 1 } }, { upsert: true });

    console.log(
      `  ${coll}: assigned ${assigned} numericId(s); counter now at ${next - 1}`,
    );
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
