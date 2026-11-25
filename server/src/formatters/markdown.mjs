// Markdown pieces every report is built from. Strings in, strings out, no Trello and no
// numbers worked out here: the utils decide what to say, the formatters decide how it reads.

const BAR_WIDTH = 10;

export const bar = (percent) => {
  const filled = Math.floor((percent * BAR_WIDTH) / 100);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
};

// A card name as plain text inside markdown: its *, _, `, [ ] and < > are shown, not obeyed.
export const mdText = (text) => String(text).replace(/([\\`*_[\]<>|])/g, "\\$1");

// The " (+3 more)" tail of a capped group (see cap in utils/rollup.mjs).
export const more = (group) => (group.count > group.items.length ? ` (+${group.count - group.items.length} more)` : "");

// The title and date every report opens with.
export const reportHeader = (title, now) => [`# ${title}`, `_${new Date(now).toISOString().slice(0, 10)}_`, ""];

// One bullet for a capped group, "- **Label (3):** a; b; c", or nothing when the group is empty.
export const groupLine = (label, group, describe) =>
  group.count ? [`- **${label} (${group.count}):** ${group.items.map(describe).join("; ")}${more(group)}`] : [];

// The last bullet of a capped bullet list, when names were left out.
export const moreLine = (group) => (group.count > group.items.length ? [`- …${more(group).trim()}`] : []);
