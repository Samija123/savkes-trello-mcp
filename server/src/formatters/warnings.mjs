// Every note a report can end with, in one place, so the same condition always reads the
// same. The JSON output carries only the flags (warnings: { … }); these are the sentences the
// markdown report prints for them.

const WARNINGS = Object.freeze({
  numberingDrift: ({ duplicateNumbers, orphans }) =>
    `${duplicateNumbers} duplicate and ${orphans} orphaned card numbers on the board; run auditCardHierarchy.`,
  cardsTruncated: ({ cardCount }) =>
    `the board returned ${cardCount} cards, which may be Trello's limit for one request, so this report may be partial.`,
  commentsTruncated: ({ read }) =>
    `the board has more comments than were read (${read}), so a "deployed" comment or a Blocked reason further back may be missed; the numbers above may be incomplete.`,
  doneDatesTruncated: ({ read }) =>
    `the board has more card moves and due-date changes than were read (${read}), so some waiting times may be missing.`,
  pathsTruncated: ({ read }) =>
    `the board has more card moves than were read (${read}), so some cards may look as if they skipped a stage.`,
});

// `kind` is a key of WARNINGS; `props` are the numbers its sentence needs.
export const warning = (kind, props) => WARNINGS[kind](props);

export const noteBlock = (notes) => (notes.length ? `\n\n${notes.map((n) => `_Note: ${n}_`).join("\n")}` : "");
