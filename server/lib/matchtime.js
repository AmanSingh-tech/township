// Matching time: how long people spend matching bank credits to flats, with
// the app against by hand. One model for the committee report and the
// evaluation (server/eval/matching.js), so the two can never disagree.
//
// Minutes a person spends per credit are assumptions (TDD, A12): 2 to match a
// row by hand; with the app, 0 for a credit it posted itself, 0.5 to confirm
// its top suggestion when that was the right flat, and the full 2 when it was
// not, or when the credit is still waiting (counted as the worst case).
export const MINUTES = { manual: 2, autoPosted: 0, reviewWithRightSuggestion: 0.5, reviewWithout: 2 };

export const CREDIT_STATUSES = ['posted', 'reconciled', 'resolved', 'pending_approval', 'queue'];

// rows: { status, flatId, topSuggestion } for each bank row. Debits,
// duplicates and rows set aside as not maintenance are not credits to match.
export function matchingTime(rows) {
  let credits = 0, withApp = 0, auto = 0;
  for (const r of rows) {
    if (!CREDIT_STATUSES.includes(r.status)) continue;
    credits++;
    if (r.status === 'posted' || r.status === 'reconciled') { auto++; withApp += MINUTES.autoPosted; continue; }
    const decided = r.status === 'resolved' || r.status === 'pending_approval';
    withApp += decided && r.flatId && r.flatId === r.topSuggestion ? MINUTES.reviewWithRightSuggestion : MINUTES.reviewWithout;
  }
  const manual = credits * MINUTES.manual;
  return {
    credits, autoPosted: auto,
    minutes: { manual, withApp },
    share: manual ? withApp / manual : null,          // time with the app, as a share of by hand (target: 20%)
    saved: manual ? 1 - withApp / manual : null,      // the brief's "matching time down 80%"
    autoRate: credits ? auto / credits : null,        // operational: share posted without a person
  };
}
