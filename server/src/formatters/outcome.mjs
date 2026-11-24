// The outcome audit as markdown, from buildOutcomeAudit (utils/outcome.mjs) and, when it ran,
// the GitHub check from summarizeVerification (utils/github.mjs). Counts and card names only.

import { bar, groupLine, mdText, more, moreLine, reportHeader } from "./markdown.mjs";

// How a card whose pull requests are none of them merged is described, by its state.
const NONE_MERGED_STATE = Object.freeze({
  open: "open",
  closed: "closed, not merged",
  unverified: "could not verify",
  notChecked: "not asked, over the limit",
});

// The GitHub part of the write-up, or the plain statement that it was asked for and could not run.
function renderVerification(v) {
  if (!v.enabled) return [`Not checked: ${v.reason}.`];
  const { merged, open, closed, unverified, notChecked } = v.pullRequests;
  const total = merged + open + closed + unverified + notChecked;
  const lines = total
    ? [
        `${merged} of ${total} linked pull ${total === 1 ? "request is" : "requests are"} merged, according to GitHub. ` +
          `${open} open, ${closed} closed without a merge, ${unverified} could not be verified${notChecked ? `, ${notChecked} not asked about (over the limit)` : ""}.`,
      ]
    : ["No Done card links a GitHub pull request, so GitHub was not asked."];
  const { withGitHubPr, noneMerged } = v.cards;
  if (noneMerged.count) {
    lines.push(
      `- None merged on ${noneMerged.count} ${noneMerged.count === 1 ? "card" : "cards"}: ` +
        `${noneMerged.items.map((c) => `${mdText(c.name)} (${NONE_MERGED_STATE[c.state]})`).join("; ")}${more(noneMerged)}.`,
    );
  } else if (withGitHubPr) {
    lines.push("- Every Done card with a GitHub pull request has at least one that is merged.");
  }
  if (v.otherHost) {
    lines.push(`- ${v.otherHost} Done ${v.otherHost === 1 ? "card links" : "cards link"} to a host other than GitHub, so ${v.otherHost === 1 ? "it was" : "they were"} not checked.`);
  }
  if (total) lines.push("_GitHub says whether a pull request was merged. It does not say the work matches the card, was reviewed, or passed checks._");
  return lines;
}

// True when GitHub was actually asked about at least one pull request.
const askedGitHub = (v) => Boolean(v?.enabled && v.pullRequests.merged + v.pullRequests.open + v.pullRequests.closed + v.pullRequests.unverified);

export function renderOutcomeAudit(boardName, audit, { now = Date.now(), verification } = {}) {
  const { progress, provenDone, items, unprovenSignOff, waiting, ruleBreaks, inconsistent, missingParent, exemptLabels, rule, evidence } = audit;
  const out = reportHeader(`Outcome audit: ${mdText(boardName)}`, now);

  const sit = progress.total === 1 ? "item sits" : "items sit";
  const shows = provenDone.done === 1 ? "shows" : "show";
  out.push(
    `**${progress.percent}% in Done. ${provenDone.percent}% with evidence.** ` +
      `${progress.done} of ${progress.total} work ${sit} in Done; ${provenDone.done} of them ${shows} evidence.` +
      (missingParent
        ? ` The totals include ${missingParent} ${missingParent === 1 ? "card" : "cards"} whose parent is missing, ${missingParent === 1 ? "which is not a row" : "which are not rows"} of the table.`
        : ""),
    "",
    "## Progress",
    "| | In Done | With evidence |",
    "|---|---|---|",
    ...items.map(
      (i) => `| ${mdText(i.name)} | ${bar(i.percent)} ${i.percent}% | ${bar(i.provenPercent)} ${i.provenPercent}% |`,
    ),
    "",
    "## Sign-off without evidence",
    ...(unprovenSignOff.count
      ? [
          ...unprovenSignOff.items.map(
            (s) =>
              `- **${mdText(s.name)}**: ` +
              (s.workItems === 1 ? "its only work item is Done, with no evidence" : `all ${s.workItems} work items are Done, none shows evidence`),
          ),
          ...moreLine(unprovenSignOff),
        ]
      : ["No story is waiting for sign-off without evidence."]),
    "",
    "## Done without evidence, longest waiting",
    ...(waiting.count
      ? [
          ...waiting.items.map(
            (w) => `- **${mdText(w.name)}**: ` + (w.days === null ? "no date found for when it became Done" : w.days === 0 ? "moved to Done today" : `${w.days} ${w.days === 1 ? "day" : "days"} in Done`),
          ),
          ...moreLine(waiting),
        ]
      : ["Every Done card shows evidence."]),
    "",
  );

  const lines = [
    ...groupLine("Done without a pull request", ruleBreaks.doneWithoutPullRequest, (c) => mdText(c.name)),
    ...groupLine("Done with acceptance criteria not ticked", ruleBreaks.doneWithOpenCriteria, (c) => `${mdText(c.name)}, ${c.open} open`),
    ...groupLine("Blocked without exactly one member and one sentence", ruleBreaks.blockedIncomplete, (c) => `${mdText(c.name)} (${c.problems.join(", ")})`),
  ];
  out.push("## Where the team rule is not met", ...(lines.length ? lines : ["Every card follows the rule."]), "");

  // Not a rule break: the board contradicts itself, and the numbers above follow the status report.
  if (inconsistent.doneAndBlocked.count) {
    out.push(
      "## Cards that say two things",
      `- **Counted as Done but also Blocked (${inconsistent.doneAndBlocked.count}):** ${inconsistent.doneAndBlocked.items
        .map((c) => mdText(c.name))
        .join("; ")}${more(inconsistent.doneAndBlocked)}. Their due date is ticked complete or they sit in a Done list; one of the two is out of date.`,
      "",
    );
  }

  if (verification) out.push("## Pull requests on GitHub", ...renderVerification(verification), "");

  out.push(
    "## The rule",
    ...rule.map((r) => `- ${r.text}`),
    ...(exemptLabels.length ? [`- Cards labelled ${exemptLabels.map(mdText).join(", ")} are not asked for a pull request.`] : []),
    "",
    "## What counts as evidence",
    ...evidence.map((e) => `- ${e.text}`),
    askedGitHub(verification)
      ? "_Trello and GitHub were read: a pull request on a Done card was asked about, the other evidence comes from the card._"
      : "_Only Trello is read: an attached pull request is seen, not checked for a merge._",
  );

  return out.join("\n").trimEnd();
}
