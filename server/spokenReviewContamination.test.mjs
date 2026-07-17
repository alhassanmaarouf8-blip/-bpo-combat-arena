import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeSpoken } from './spokenReview.js';

const item = { type: 'phrase', answer: 'Das tut mir aufrichtig leid, das hätte nicht passieren dürfen.' };

test('spoken review accepts a bounded substantially correct production', () => {
  assert.equal(gradeSpoken(item, 'Das tut mir aufrichtig leid, das hätte nicht passieren dürfen.').correct, true);
});

test('spoken review rejects a correct fragment embedded in unrelated speech', () => {
  const heard = 'all of the different language apps out there this course is effective and well rounded Das tut mir aufrichtig leid das hätte nicht passieren dürfen';
  assert.equal(gradeSpoken(item, heard).correct, false);
});

test('spoken review rejects a meaning-reversing negation despite lexical overlap', () => {
  assert.equal(gradeSpoken(item, 'Das tut mir nicht aufrichtig leid, das hätte nicht passieren dürfen.').correct, false);
});
