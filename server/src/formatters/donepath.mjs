// The done-path audit as markdown, from buildDonePathAudit (utils/donepath.mjs). Counts and
// card names only; no member is named.

import { mdText, more, reportHeader } from "./markdown.mjs";

export function renderDonePathAudit(boardName, audit, { now = Date.now() } = {}) {
  const { doneCards, noHistory, createdInDone, skipped, doneMoves, bursts, movedByAssignee, settings } = audit;
  const out = reportHeader(`Done-path audit: ${mdText(boardName)}`, now);
  out.push(`**${doneCards} ${doneCards === 1 ? "card sits" : "cards sit"} in Done.** Here is how they got there.`, "");

  out.push("## Stages skipped");
  out.push(`- ${skipped.progress} never sat in a progress list (${settings.progressLists.map(mdText).join(", ")}).`);
  out.push(`- ${skipped.review} never sat in a review list (${settings.reviewLists.map(mdText).join(", ")}).`);
  if (skipped.both.count) {
    out.push(`- ${skipped.both.count} skipped both: ${skipped.both.items.map((c) => mdText(c.name)).join("; ")}${more(skipped.both)}.`);
  }
  if (createdInDone) out.push(`- ${createdInDone} ${createdInDone === 1 ? "was" : "were"} created straight in Done (written down afterwards), so no stage is counted as skipped.`);
  if (noHistory) out.push(`- ${noHistory} ${noHistory === 1 ? "has" : "have"} no history to read and ${noHistory === 1 ? "is" : "are"} not judged.`);
  out.push("");

  out.push("## Batches");
  if (bursts.count) {
    out.push(
      `- ${bursts.count} ${bursts.count === 1 ? "batch" : "batches"} of ${settings.burstSize} or more cards moved into Done by the same member within ${settings.burstMinutes} minutes of each other: ` +
        `${bursts.cards} cards, ${bursts.percent}% of the ${doneMoves} moves into Done, the largest ${bursts.largest}.`,
    );
  } else {
    out.push(`No batch of ${settings.burstSize} or more cards moved into Done within ${settings.burstMinutes} minutes.`);
  }
  out.push("");

  out.push("## Who moved it");
  out.push(
    movedByAssignee.of
      ? `- ${movedByAssignee.count} of ${movedByAssignee.of} cards were moved into Done by someone who is a member of the card now. Members are today's, so this is a hint.`
      : "No mover was recorded, so this is not shown.",
    "",
    "## How to read this",
    "This is a list of cards worth a look, not a verdict. Skipping a stage or moving cards together is sometimes right, for example when finished work is written down afterwards. Only Trello is read and no member is named.",
  );
  return out.join("\n").trimEnd();
}
