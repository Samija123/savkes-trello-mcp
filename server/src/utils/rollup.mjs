// Roll the numbered card hierarchy up into progress and attention items: the numbers behind
// the status report and the board map. formatters/rollup.mjs turns them into text.
//
// Pure, like numbering.mjs: cards in, plain data out. No network and no MCP framing, so the
// selftest covers all of it without credentials.
//
// The idea is that Trello has no epics and no roll-up, but this board's card names
// already carry the tree ("EPIC 1" -> "1.1" -> "1.1.2"). A work item is a card with no
// children, and every number above it is computed from those, never guessed.

import { unknownCardNumber } from "../errors.mjs";
import { cardNumber, parentNumber } from "./numbering.mjs";

export const DAY_MS = 86_400_000;
// Lists in the report are capped so a board with 80 idle cards doesn't turn the
// write-up into a wall of text. The count always covers every card; only the names stop.
const SHOWN = 10;

// A card is done when it sits in a list that holds finished work, or its due date is
// ticked complete. The default pattern covers the usual names; a board that calls the
// list something else passes its own names instead (see doneListTest).
const DONE_LIST = /^(done|completed?|shipped|released|closed|finished)\b/i;
// Anchored at the start so "Unblocked" and "Blockchain" don't count, while "Blocked",
// "Blocker", "Blocking" and "blocked: waiting on API" do.
const BLOCKED_LABEL = /^block(?:ed|er|ing)?\b/i;
// A list named Blocked is the other common way to park a card, so it counts too.
const BLOCKED_LIST = /^blocked\b/i;

// Acceptance criteria live in the card description as Given/When/Then bullets, one
// "Given" per criterion, usually all on one line. A line only counts when When and Then
// follow before the next Given, so a sentence that merely starts with "Given" doesn't.
// Cards written during the window when the push skill made AC a real checklist keep
// them there instead, so a checklist named "Acceptance Criteria" counts too. Without
// that, every older story would read as having none.
const GIVEN_START = /^[ \t]*(?:[-*][ \t]+)?\**Given\b/i;

// What a card is, by depth. Used so a report scoped to a story calls it a story.
const TIERS = [
  ["epic", "epics"],
  ["story", "stories"],
  ["task", "tasks"],
];

export function doneListTest(names) {
  if (Array.isArray(names) && names.length) {
    const wanted = new Set(names.map((n) => String(n).trim().toLowerCase()));
    return (listName) => wanted.has(String(listName ?? "").trim().toLowerCase());
  }
  return (listName) => DONE_LIST.test(String(listName ?? "").trim());
}

// 2.2 sorts before 2.10: segments compare as numbers, never as strings.
export function compareNumbers(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? -1) - (y[i] ?? -1);
    if (diff) return diff;
  }
  return 0;
}

export function countCriteria(desc, checklists = []) {
  const inText = String(desc ?? "")
    .split(/^(?=[ \t]*(?:[-*][ \t]+)?\**Given\b)/im)
    .filter((chunk) => GIVEN_START.test(chunk) && /\bWhen\b/i.test(chunk) && /\bThen\b/i.test(chunk)).length;
  const inLists = checklists
    .filter((c) => /acceptance criteria/i.test(c.name ?? ""))
    .reduce((n, c) => n + (c.checkItems?.length ?? 0), 0);
  return inText + inLists;
}

// Acceptance-criteria checklist items that are explicitly not ticked. Items with no
// `state` (older data, or a caller that did not ask for it) are not counted as open, so
// a missing field never blocks a sign-off by itself.
export function countOpenCriteria(checklists = []) {
  return checklists
    .filter((c) => /acceptance criteria/i.test(c.name ?? ""))
    .reduce((n, c) => n + (c.checkItems ?? []).filter((i) => i.state === "incomplete").length, 0);
}

// floor, not round: 249 of 250 must not read as 100%. Nothing to do reads as 0%.
export const percentOf = (done, total) => (total === 0 ? 0 : done === total ? 100 : Math.floor((100 * done) / total));

// Build the tree from a flat card list.
//   cards      Trello cards: id, name, shortLink, idList, due, dueComplete,
//              dateLastActivity, desc, labels
//   lists      { idList: name }
//   checklists { idCard: [checklist] }
// Duplicate numbers keep the first card and report the rest (auditCardHierarchy is the
// tool that sorts those out). A card whose parent number is missing becomes a root of its
// own and is flagged, so it still shows up in the totals instead of vanishing.
export function buildTree({ cards, lists = {}, checklists = {}, isDoneList = doneListTest() }) {
  const nodes = new Map();
  const duplicates = [];
  let unnumbered = 0;

  for (const card of cards) {
    const number = cardNumber(card.name);
    if (number === null) {
      unnumbered += 1;
      continue;
    }
    if (nodes.has(number)) {
      duplicates.push({ number, shortLink: card.shortLink });
      continue;
    }
    const list = lists[card.idList] ?? "(unknown list)";
    nodes.set(number, {
      number,
      name: card.name,
      shortLink: card.shortLink,
      list,
      isDone: card.dueComplete === true || isDoneList(list),
      due: card.dueComplete === true ? null : (card.due ?? null),
      lastActivity: card.dateLastActivity ?? null,
      blocked: (card.labels ?? []).some((l) => BLOCKED_LABEL.test(l.name ?? "")) || BLOCKED_LIST.test(list),
      criteria: countCriteria(card.desc, checklists[card.id]),
      criteriaOpen: countOpenCriteria(checklists[card.id]),
      children: [],
      orphan: false,
    });
  }

  const roots = [];
  for (const node of nodes.values()) {
    const wanted = parentNumber(node.number);
    const parent = wanted === null ? undefined : nodes.get(wanted);
    if (parent) {
      parent.children.push(node);
    } else {
      node.orphan = wanted !== null;
      roots.push(node);
    }
  }
  const byNumber = (a, b) => compareNumbers(a.number, b.number);
  roots.sort(byNumber);
  for (const node of nodes.values()) node.children.sort(byNumber);

  // Leaves are the work items. Everything above them is a count of those, so a story
  // that someone dragged into Done with open tasks under it still reads as unfinished.
  const rollUp = (node) => {
    if (!node.children.length) {
      node.total = 1;
      node.done = node.isDone ? 1 : 0;
    } else {
      node.total = 0;
      node.done = 0;
      for (const child of node.children) {
        rollUp(child);
        node.total += child.total;
        node.done += child.done;
      }
    }
    node.percent = percentOf(node.done, node.total);
  };
  roots.forEach(rollUp);

  return { nodes, roots, duplicates, unnumbered };
}

// Narrow a tree to one card's subtree. The error names what does exist, because the
// usual cause is a typo'd number and "not found" alone sends the caller guessing.
export function scopeTo(tree, number) {
  if (number === undefined || number === null || number === "") return tree.roots;
  const node = tree.nodes.get(String(number).trim());
  if (!node) throw unknownCardNumber(number, tree.roots.filter((r) => !r.orphan).map((r) => r.number));
  return [node];
}

export const walk = (nodes, fn) => {
  for (const node of nodes) {
    fn(node);
    walk(node.children, fn);
  }
};
export const complete = (node) => node.done === node.total;
export const depthOf = (node) => node.number.split(".").length;

// A story the status report calls ready for sign-off: every work item under it is done,
// it has acceptance criteria, and none of its checklist criteria is left unticked.
export const isSignOffReady = (node) =>
  depthOf(node) === 2 && node.criteria > 0 && complete(node) && node.criteriaOpen === 0;
export const tierOf = (node) => (TIERS[depthOf(node) - 1] ?? ["item", "items"])[0];
export const plural = (tier, n) => (n === 1 ? tier : (TIERS.find(([one]) => one === tier)?.[1] ?? `${tier}s`));
export const cap = (items) => ({ count: items.length, items: items.slice(0, SHOWN) });

// Everything the report and the JSON output say, as data.
export function buildReport(roots, { now = Date.now(), staleDays = 14 } = {}) {
  let done = 0;
  let total = 0;
  const openByList = {};
  const blocked = [];
  const overdue = [];
  const stale = [];
  const noCriteria = [];
  const unmetCriteria = [];
  const readyForSignOff = [];
  // A card whose parent number is not on the board is still counted in the totals, but
  // it is not an epic, so it is listed on its own instead of in the progress table.
  const missingParent = roots
    .filter((r) => r.orphan)
    .map((r) => ({ number: r.number, name: r.name, expectedParent: parentNumber(r.number) }));
  const placed = roots.filter((r) => !r.orphan);

  for (const root of roots) {
    done += root.done;
    total += root.total;
  }

  walk(roots, (node) => {
    const isLeaf = node.children.length === 0;
    const open = !complete(node);

    if (isLeaf && open) openByList[node.list] = (openByList[node.list] ?? 0) + 1;
    // Blocked and overdue are about work items. Counting a parent as well would list one
    // piece of work once per level, so a story and its tasks are not reported together.
    if (isLeaf && open && node.blocked) blocked.push({ number: node.number, name: node.name, list: node.list });

    const due = node.due ? Date.parse(node.due) : NaN;
    if (isLeaf && open && due < now) {
      // Rounded up: any time past the due date is at least one day late. Idle time below
      // rounds down because it counts whole days that have actually passed.
      overdue.push({ number: node.number, name: node.name, due: node.due, daysLate: Math.ceil((now - due) / DAY_MS) });
    }

    // Idle time only means something for a work item; an epic's own last-touched date
    // says nothing about whether anyone is working under it.
    const touched = node.lastActivity ? Date.parse(node.lastActivity) : NaN;
    if (isLeaf && open && now - touched > staleDays * DAY_MS) {
      stale.push({ number: node.number, name: node.name, list: node.list, daysIdle: Math.floor((now - touched) / DAY_MS) });
    }

    // Stories are the tier that carries acceptance criteria.
    if (depthOf(node) === 2) {
      if (node.criteria === 0) noCriteria.push({ number: node.number, name: node.name });
      else if (!open && node.criteriaOpen > 0) unmetCriteria.push({ number: node.number, name: node.name, open: node.criteriaOpen });
      else if (isSignOffReady(node)) readyForSignOff.push({ number: node.number, name: node.name, criteria: node.criteria });
    }
  });
  stale.sort((a, b) => b.daysIdle - a.daysIdle);
  overdue.sort((a, b) => b.daysLate - a.daysLate);

  return {
    progress: { done, total, percent: percentOf(done, total) },
    // The top of the scope: epics for the whole board, or the one story or task that
    // `epic` narrowed it to. Each entry says which tier it is.
    items: placed.map((root) => ({
      number: root.number,
      name: root.name,
      tier: tierOf(root),
      percent: root.percent,
      done: root.done,
      total: root.total,
      children: root.children.map((c) => ({
        number: c.number,
        name: c.name,
        tier: tierOf(c),
        percent: c.percent,
        done: c.done,
        total: c.total,
        criteria: c.criteria,
      })),
    })),
    readyForSignOff: cap(readyForSignOff),
    attention: {
      blocked: cap(blocked),
      overdue: cap(overdue),
      stale: { ...cap(stale), afterDays: staleDays },
      storiesWithoutCriteria: cap(noCriteria),
      storiesWithUnmetCriteria: cap(unmetCriteria),
      missingParent: cap(missingParent),
    },
    openByList,
  };
}
