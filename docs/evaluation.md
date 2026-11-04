# Evaluation

Run with `npm run eval` on 2026-11-04. Both evaluations use the sample township and change nothing.

## Complaint triage

90 labelled complaints in English, Hindi, Marathi and Hinglish (`server/eval/complaints.json`), scored on the path a real complaint takes: the safety rule first, then the classifier.

| Measure | Local model |
|---|---|
| Category right | 81.1% |
| Urgency exact / within one level | 56.7% / 96.7% |
| Flagged "AI unsure" to the help desk | 64.4% |
| Category right when sure / when unsure | 100% / 70.7% |
| Wrong but not flagged | 0 |
| Safety hazards caught | 14 of 14 |
| Safety false alarms | 0 |

By language (category right, local model): en 81.7% (60), hi 85.7% (14), mr 71.4% (14), hinglish 100% (2).

What the first run found, and what was fixed: Devanagari vowel signs split words apart, so Hindi and Marathi keywords never matched (category right was 50% in both; the tokenizer now keeps them); the safety rule missed the Marathi "अडकले" (stuck), and raised false alarms on "लिफ्ट बंद" (the lift is off) and "fire lane". Before the fixes: category right 71.1%, hazards caught 13 of 14, 3 false alarms, 1 wrong but sure.

## Bank matching

5 statements, 140 maintenance credits and 30 rows that are not maintenance. Each credit's true flat is known.

| Measure | Result |
|---|---|
| Posted automatically | 55% |
| **Posted to the wrong flat** | **0** |
| Sent to the review queue | 45% |
| Queue: top suggestion is the right flat | 98.4% (right flat in the top three: 100%) |
| Non-maintenance rows posted to a flat | 0 |
| Time: by hand vs with the app | 280 min vs 33 min, **88.2% less** |

By style (credits, posted, queued, wrong):

- family-unregistered: 13, 0 posted, 13 queued, 0 wrong
- neft-flat: 47, 38 posted, 9 queued, 0 wrong
- upi-registered: 28, 28 posted, 0 queued, 0 wrong
- upi-registered+flat: 7, 7 posted, 0 queued, 0 wrong
- imps-name-only: 14, 0 posted, 14 queued, 0 wrong
- typo-flat: 8, 0 posted, 8 queued, 0 wrong
- pays-for-neighbour: 7, 1 posted, 6 queued, 0 wrong
- part-payment: 10, 3 posted, 7 queued, 0 wrong
- not-maintenance: 30, 0 posted, 20 queued, 0 wrong
- advance-12-months: 6, 0 posted, 6 queued, 0 wrong

Assumptions: the style mix (upi-registered 33%, upi-registered+flat 12%, neft-flat 15%, family-unregistered 10%, imps-name-only 8%, part-payment 7%, typo-flat 5%, pays-for-neighbour 5%, advance-12-months 5%); and minutes per credit: 2 by hand, 0.5 to confirm a right suggestion, 2 when the suggestion is wrong, 0 when posted automatically.

