// The two views built from utils/rollup.mjs: the status report a person would send a client,
// and the board map as an outline or a Mermaid chart.

import { complete, depthOf, plural } from "../utils/rollup.mjs";
import { bar, groupLine, mdText, moreLine, reportHeader } from "./markdown.mjs";

// The report a person would send a client: no ids, no JSON, plain sentences.
export function renderReport(boardName, report, { now = Date.now() } = {}) {
  const { progress, items, readyForSignOff, attention, openByList } = report;
  const out = reportHeader(`Delivery status: ${mdText(boardName)}`, now);

  const tier = items[0]?.tier ?? "epic";
  const orphans = attention.missingParent.count;
  const plusOrphans = orphans ? `, plus ${orphans} ${orphans === 1 ? "card" : "cards"} whose parent is missing` : "";
  out.push(
    `**${progress.percent}% complete.** ${progress.done} of ${progress.total} work items done across ${items.length} ${plural(tier, items.length)}${plusOrphans}.`,
    "",
    "## Progress",
    "| | Progress | Done |",
    "|---|---|---|",
    ...items.map((e) => `| ${mdText(e.name)} | ${bar(e.percent)} ${e.percent}% | ${e.done} / ${e.total} |`),
    "",
  );

  if (readyForSignOff.count) {
    out.push(
      "## Ready for sign-off",
      ...readyForSignOff.items.map(
        (s) => `- **${mdText(s.name)}**: every work item done, ${s.criteria} acceptance ${s.criteria === 1 ? "criterion" : "criteria"}`,
      ),
      ...moreLine(readyForSignOff),
      "",
    );
  }

  const lines = [
    ...groupLine("Blocked", attention.blocked, (c) => `${mdText(c.name)} [${mdText(c.list)}]`),
    ...groupLine("Overdue", attention.overdue, (c) => `${mdText(c.name)}, ${c.daysLate} ${c.daysLate === 1 ? "day" : "days"} late`),
    ...groupLine(`No activity for ${attention.stale.afterDays}+ days`, attention.stale, (c) => `${mdText(c.name)} [${mdText(c.list)}], idle ${c.daysIdle} days`),
    ...groupLine("Stories without acceptance criteria", attention.storiesWithoutCriteria, (c) => mdText(c.name)),
    ...groupLine("Done but acceptance criteria not ticked", attention.storiesWithUnmetCriteria, (c) => `${mdText(c.name)}, ${c.open} open`),
    ...groupLine("Parent card missing", attention.missingParent, (c) => `${mdText(c.name)} (no ${c.expectedParent})`),
  ];
  out.push("## Needs attention", ...(lines.length ? lines : ["Nothing needs attention."]), "");

  const where = Object.entries(openByList).sort((a, b) => b[1] - a[1]);
  if (where.length) out.push("## Where the open work sits", where.map(([list, n]) => `${mdText(list)}: ${n}`).join(" · "), "");

  return out.join("\n").trimEnd();
}

// --- Board map -------------------------------------------------------------

const within = (nodes, depth) => nodes.filter((n) => depthOf(n) <= depth);

// Indented outline. Parents show the roll-up; work items show where they sit.
export function renderOutline(roots, depth = 3) {
  const text = (node) => {
    if (node.children.length) return `${node.name}  ${bar(node.percent)} ${node.percent}% (${node.done}/${node.total})`;
    return `${node.name}  ${node.isDone ? "✓" : "○"} ${node.list}${node.blocked ? " [blocked]" : ""}`;
  };
  const out = [];
  const draw = (node, prefix, last, top) => {
    out.push(top ? text(node) : `${prefix}${last ? "└─ " : "├─ "}${text(node)}`);
    const kids = within(node.children, depth);
    const next = top ? "" : prefix + (last ? "   " : "│  ");
    kids.forEach((kid, i) => draw(kid, next, i === kids.length - 1, false));
  };
  // Roots are drawn whatever their own depth, so mapping one story (epic: "2.1") still
  // shows that story; depth only limits what hangs below it.
  roots.forEach((root) => draw(root, "", true, true));
  return out.join("\n");
}

// Mermaid flowchart, coloured by progress: green when complete, amber when started.
// Labels are quoted so card names with brackets or colons can't break the syntax; the
// two characters that can break a quoted label ("#" starts an entity, `"` ends it)
// are escaped, in that order so the entity's own "#" survives.
export function renderMermaid(roots, depth = 3) {
  const id = (node) => `n${node.number.replaceAll(".", "_")}`;
  const label = (node) => {
    const name = node.name.replace(/\s+/g, " ").trim();
    const short = name.length > 48 ? `${name.slice(0, 47)}…` : name;
    const safe = short.replaceAll("#", "#35;").replaceAll('"', "#quot;");
    return node.children.length ? `${safe}<br/>${node.percent}%` : safe;
  };
  const style = (node) => (complete(node) ? "done" : node.done > 0 ? "partial" : "open");

  const nodes = [];
  const edges = [];
  const visit = (node) => {
    nodes.push(`  ${id(node)}["${label(node)}"]:::${style(node)}`);
    for (const child of within(node.children, depth)) {
      edges.push(`  ${id(node)} --> ${id(child)}`);
      visit(child);
    }
  };
  roots.forEach(visit);

  return [
    "flowchart TD",
    ...nodes,
    ...edges,
    "  classDef done fill:#d1fae5,stroke:#059669,color:#064e3b",
    "  classDef partial fill:#fef3c7,stroke:#d97706,color:#78350f",
    "  classDef open fill:#f3f4f6,stroke:#9ca3af,color:#374151",
  ].join("\n");
}
