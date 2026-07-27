'use strict';

/**
 * Find content blocks with a missing or invalid `type` — the kind that can
 * 500 the lesson page. These are leftovers from an earlier version of the
 * block form (which sent type strings that aren't in the current enum).
 *
 *   node scripts/find-bad-blocks.js            # list them
 *   node scripts/find-bad-blocks.js --delete   # delete them (after reviewing)
 *
 * Runs across ALL tenants (platform context) because it's a maintenance sweep.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { ContentBlock } = require('../src/models');
const { BLOCK_TYPES } = require('../src/models/content-block');
const { runAsPlatform } = require('../src/lib/context');

const DELETE = process.argv.includes('--delete');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    await runAsPlatform('maintenance: find bad content blocks', async () => {
      // A block is "bad" if type is missing, null, or not one of the valid enum values.
      const all = await ContentBlock.find({}).lean();
      const bad = all.filter((b) => !b.type || !BLOCK_TYPES.includes(b.type));

      if (!bad.length) {
        console.log('✓ No bad blocks. Every content block has a valid type.');
        return;
      }

      console.log(`Found ${bad.length} block(s) with a missing or invalid type:\n`);
      bad.forEach((b) => {
        console.log(`  _id=${b._id}  lessonId=${b.lessonId}  type=${JSON.stringify(b.type)}  tenantId=${b.tenantId}`);
      });

      if (DELETE) {
        const ids = bad.map((b) => b._id);
        const res = await ContentBlock.deleteMany({ _id: { $in: ids } });
        console.log(`\n✓ Deleted ${res.deletedCount} bad block(s). Re-create them from the lesson page with a valid type.`);
      } else {
        console.log('\nRun again with --delete to remove them (they cannot render and will 500 the lesson page).');
      }
    });
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
