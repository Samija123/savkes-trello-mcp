// How did the cards in Done get there? Pure, like outcome.mjs: cards and their list moves
// in, plain data out, no network. formatters/donepath.mjs writes it up.
//
// Trello only says where a card sits. Its history says how it travelled: through
// In Progress and a review list, or straight to Done; alone, or in a batch with others.
// Each of those is a reason to look at a card, never a verdict: logging finished work
// afterwards, or moving a sprint's cards together at the end, is sometimes the right thing.
//
// Nothing here names a person. The mover and the card's members are compared inside this
// file and leave it only as counts.

import { cap, doneListTest, percentOf } from "./rollup.mjs";

// Exported so the tool description in reports.mjs states the same values the audit uses.
export const DEFAULT_BURST_SIZE = 5;
export const BURST_MINUTES = 5;
const BURST_MS = BURST_MINUTES * 60_000;
export const DEFAULT_PROGRESS = Object.freeze(["In Progress"]);
export const DEFAULT_REVIEW = Object.freeze(["Testing/Review", "Testing", "Review", "QA"]);

const byTime = (a, b) => Date.parse(a.at) - Date.parse(b.at);

// One mover's moves into Done (oldest first), split wherever more than BURST_MINUTES pass
// between two of them.
const runsOf = (moves) => {
  const runs = [];
  moves.forEach((move, i) => {
    if (i === 0 || Date.parse(move.at) - Date.parse(moves[i - 1].at) > BURST_MS) runs.push([]);
    runs.at(-1).push(move);
  });
  return runs;
};

// `cards`: [{ id, name, listName, idMembers }], where listName is the list the card sits in now.
// `events`: [{ cardId, at, from, to, by }], one per list move or creation (from is null for a
// creation), `by` the member id of whoever did it, or null when the history did not say.
// Only cards that sit in a Done list are judged.
export function buildDonePathAudit({
  cards,
  events,
  doneLists,
  progressLists = DEFAULT_PROGRESS,
  reviewLists = DEFAULT_REVIEW,
  burstSize = DEFAULT_BURST_SIZE,
}) {
  const isDone = doneListTest(doneLists);
  const isProgress = doneListTest(progressLists);
  const isReview = doneListTest(reviewLists);

  const doneCards = cards.filter((c) => isDone(c.listName));
  const doneIds = new Set(doneCards.map((c) => c.id));
  // Each Done card's history, oldest first. No prototype, so no id can collide with an
  // inherited name such as "constructor".
  const historyOf = Object.create(null);
  for (const e of [...events].sort(byTime)) {
    if (doneIds.has(e.cardId)) (historyOf[e.cardId] ??= []).push(e);
  }

  // How each Done card's history reads, once. Every count below is taken from this list.
  const paths = doneCards.map((card) => {
    const history = historyOf[card.id];
    if (!history) return { card, kind: "noHistory", intoDone: [] };
    const intoDone = history.filter((e) => e.from !== null && !isDone(e.from) && isDone(e.to));
    // Created in Done and never moved back in: written down afterwards. A card that left Done
    // and came back is judged on its path like any other.
    if (history[0].from === null && isDone(history[0].to) && !intoDone.length) return { card, kind: "createdInDone", intoDone };
    const visited = history.flatMap((e) => [e.from, e.to]).filter(Boolean);
    return { card, kind: "judged", intoDone, progress: visited.some(isProgress), review: visited.some(isReview) };
  });
  const judged = paths.filter((p) => p.kind === "judged");

  // Every move into Done, with the card it was for.
  const doneMoves = paths.flatMap((p) => p.intoDone.map((e) => ({ ...e, card: p.card })));
  // Only moves whose mover is known can be grouped or compared with the card's members.
  const knownMoves = doneMoves.filter((m) => m.by).sort(byTime);

  // A burst is burstSize or more cards put into Done by the same member, each within
  // BURST_MINUTES of the one before.
  const byMover = Object.create(null);
  for (const m of knownMoves) (byMover[m.by] ??= []).push(m);
  const bursts = Object.values(byMover).flatMap((moves) => runsOf(moves).filter((run) => run.length >= burstSize));
  const burstCards = bursts.reduce((n, run) => n + run.length, 0);

  // The newest move into Done for each card (knownMoves is oldest first, so the last one per
  // card wins), and whether its mover is one of the card's members today. Members change,
  // so this is a hint, not a fact.
  const latest = [...new Map(knownMoves.map((m) => [m.card.id, m])).values()];
  const ownMoves = latest.filter((m) => (m.card.idMembers ?? []).includes(m.by)).length;

  return {
    doneCards: doneCards.length,
    noHistory: paths.filter((p) => p.kind === "noHistory").length,
    createdInDone: paths.filter((p) => p.kind === "createdInDone").length,
    skipped: {
      progress: judged.filter((p) => !p.progress).length,
      review: judged.filter((p) => !p.review).length,
      both: cap(judged.filter((p) => !p.progress && !p.review).map((p) => ({ name: p.card.name }))),
    },
    doneMoves: doneMoves.length,
    bursts: {
      count: bursts.length,
      cards: burstCards,
      largest: Math.max(0, ...bursts.map((run) => run.length)),
      percent: percentOf(burstCards, doneMoves.length),
    },
    movedByAssignee: { count: ownMoves, of: latest.length },
    settings: { burstSize, burstMinutes: BURST_MINUTES, progressLists, reviewLists },
  };
}
