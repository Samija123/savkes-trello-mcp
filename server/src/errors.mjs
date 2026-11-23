// Every failure the report tools raise themselves, in one place, so the same problem always
// reads the same way and a test can check it by its code. Two come from elsewhere: Trello's
// own errors from trello/client.mjs, and wrong argument types from validateArgs in index.mjs.
//
// Two kinds live here. A ToolError is thrown: the call stops, and tools/call in index.mjs
// hands the message to the model as an isError result, which is what lets it try again with
// better arguments. A GitHub check that cannot run, or fails, is not thrown: one dead link
// must not fail a whole audit, so it comes back as a result that says why.

// --- Thrown -------------------------------------------------------------------------

// `code` is a stable snake_case name (tests match on it, not on the prose), `message` says
// what was wrong, and `hint` says what to do next. Only for a tool's run: protocol errors
// keep their numeric JSON-RPC code, which index.mjs puts on a plain Error.
export class ToolError extends Error {
  constructor(code, message, hint) {
    super(hint ? `${code}: ${message} Hint: ${hint}` : `${code}: ${message}`);
    this.name = "ToolError";
    this.code = code;
    this.hint = hint;
  }
}

// An argument the schema let through whose value is still wrong, e.g. a format no tool knows.
export const invalidArgument = (name, rule, value) =>
  new ToolError("invalid_argument", `${name} must be ${rule}, got ${JSON.stringify(value)}.`);

export const noNumberedCards = (cardCount) =>
  new ToolError(
    "no_numbered_cards",
    `No numbered cards on this board (${cardCount} cards, none named like "EPIC 1. …", "1.1. …" or "1.1.1. …").`,
    "These tools read that numbering; run auditCardHierarchy or findCards to see what the cards are called.",
  );

// The usual cause is a typo'd number, so the hint names what does exist.
export const unknownCardNumber = (number, topLevel) =>
  new ToolError(
    "unknown_card_number",
    `No card numbered "${number}" on this board.`,
    topLevel.length ? `Top-level numbers: ${topLevel.join(", ")}.` : "The board has no numbered cards.",
  );

export const githubTokenMissing = () =>
  new ToolError("github_token_missing", "A GitHub token is required to check pull requests.", "Set GITHUB_TOKEN to a read-only token.");

// --- Reported, not thrown -----------------------------------------------------------

// verifyPullRequests was asked for without a usable token: nothing is sent to GitHub.
export const GITHUB_TOKEN_NOT_SET = Object.freeze({ enabled: false, reason: "GITHUB_TOKEN is not set" });

// Why GitHub could not say whether a pull request was merged, and whether trying again could
// help. None of these is ever read as merged or as not merged.
const unverified = (reason, category, retryable) => Object.freeze({ state: "unverified", reason, category, retryable });

export const GITHUB_UNVERIFIED = Object.freeze({
  notFound: unverified("not found or no access", "permission", false),
  refused: unverified("refused by GitHub", "permission", false),
  rateLimited: unverified("rate limited", "transient", true),
  serverError: unverified("GitHub error", "transient", true),
  unexpectedReply: unverified("unexpected reply", "validation", false),
  unreachable: unverified("could not reach GitHub", "transient", true),
});

const GITHUB_STATUS = Object.freeze({
  401: GITHUB_UNVERIFIED.refused,
  403: GITHUB_UNVERIFIED.refused,
  404: GITHUB_UNVERIFIED.notFound,
  429: GITHUB_UNVERIFIED.rateLimited,
});

// What a reply other than 200 means: a known refusal, a GitHub-side error, or a reply we
// did not expect.
export const githubFailure = (status) =>
  GITHUB_STATUS[status] ?? (status >= 500 ? GITHUB_UNVERIFIED.serverError : GITHUB_UNVERIFIED.unexpectedReply);
