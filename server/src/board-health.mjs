
import { asArray } from './utils/arrays.mjs';
import { forecastSprint } from './sprint-forecast.mjs';

// Re-exported so existing imports from board-health.mjs keep working.
export { estimatedHours, forecastSprint } from './sprint-forecast.mjs';

const DEFAULT_DONE_LISTS = ['done', 'completed', 'closed'];

const DAY_MS = 86400000;

// Distinct cards moved into a done list during the 7 days before `now`.
export function countWeeklyCompletions(actions, { now, isDoneList }) {
  const to = now.getTime();
  const from = to - 7 * DAY_MS;
  const inWindow = action => {
    const at = Date.parse(action?.date);
    return at >= from && at <= to; // NaN (missing/invalid date) is false
  };

  const cardIds = asArray(actions)
    .filter(inWindow)
    .filter(action => isDoneList(action.data?.listAfter))
    .map(action => action.data?.card?.id)
    .filter(Boolean);

  return new Set(cardIds).size;
}

export function analyzeBoard({
  boardId,
  boardName,
  lists = [],
  cards = [],
  actions = [],
  completedListNames,
  historyAvailable = false,
  now = new Date(),
  sprint = {}
} = {}) {
  const currentDate = new Date(now);

  const doneNames = completedListNames
    ? String(completedListNames)
        .split(',')
        .map(x => x.trim().toLowerCase())
    : DEFAULT_DONE_LISTS;

  const activeLists = asArray(lists).filter(l => !l.closed);
  const activeCards = asArray(cards).filter(c => !c.closed);

  const doneListIds = new Set(
    activeLists
      .filter(l => doneNames.includes(l.name?.trim().toLowerCase()))
      .map(l => l.id)
  );

  const isCompleted = card =>
    card.dueComplete === true || doneListIds.has(card.idList);

  const completedCards = activeCards.filter(isCompleted);
  const inProgressCards = activeCards.filter(c => !isCompleted(c));

  const overdue = inProgressCards.filter(c =>
    c.due && new Date(c.due) < currentDate
  );

  const upcoming = inProgressCards.filter(c => {
    if (!c.due) return false;

    const due = new Date(c.due);

    return (
      due >= currentDate &&
      due <= new Date(currentDate.getTime() + 7 * DAY_MS)
    );
  });

  const blocked = inProgressCards.filter(c => {
    const text = [
      c.name,
      c.desc,
      ...asArray(c.labels).map(l => l.name)
    ].join(' ').toLowerCase();

    return /\b(blocked|blocker|blocking|on hold|stuck)\b/.test(text);
  });

  const unassigned = inProgressCards.filter(c =>
    !Array.isArray(c.idMembers) || c.idMembers.length === 0
  );

  const listStats = activeLists.map(list => {
    const items = activeCards.filter(c => c.idList === list.id);

    return {
      id: list.id,
      name: list.name,
      totalCards: items.length,
      activeCards: items.filter(c => !isCompleted(c)).length,
      completedCards: items.filter(isCompleted).length
    };
  });

  const memberWorkload = {};

  for (const card of inProgressCards) {
    for (const memberId of asArray(card.idMembers)) {
      memberWorkload[memberId] =
        (memberWorkload[memberId] || 0) + 1;
    }
  }

  const workloadDistribution = Object.entries(memberWorkload)
    .map(([memberId, cardCount]) => ({
      memberId,
      cardCount
    }))
    .sort((a, b) => a.memberId.localeCompare(b.memberId));

  const isDoneList = list =>
    Boolean(list) &&
    (doneListIds.has(list.id) || doneNames.includes(list.name?.trim().toLowerCase()));

  const weeklyThroughput = historyAvailable
    ? countWeeklyCompletions(actions, { now: currentDate, isDoneList })
    : null;

  const sprintForecast = forecastSprint(inProgressCards, { ...sprint, now: currentDate });

  const totalCards = activeCards.length;

  const completionRate = totalCards
    ? Number(
        (completedCards.length / totalCards * 100).toFixed(2)
      )
    : 0;

  const healthScore = totalCards === 0
    ? null
    : Math.max(
        0,
        Math.min(
          100,
          100
          - Math.min(25, blocked.length * 5)
          - Math.min(20, overdue.length * 4)
          - Math.min(20, unassigned.length * 2)
          - (inProgressCards.length > 30 ? 10 : 0)
        )
      );

  const busiestLists = [...listStats]
    .filter(l => l.activeCards > 0)
    .sort((a, b) => b.activeCards - a.activeCards)
    .slice(0, 2);

  // [count, message]: an entry is reported only when its count is non-zero.
  const recommendations = [
    [blocked.length, `Unblock ${blocked.length} explicitly flagged card(s).`],
    [overdue.length, `Review ${overdue.length} overdue card(s).`],
    [unassigned.length, `Assign owners to ${unassigned.length} active card(s).`],
    [busiestLists.length, `Review WIP in ${busiestLists.map(l => l.name).join(', ')}.`]
  ]
    .filter(([count]) => count)
    .map(([, message]) => message);

  if (!recommendations.length) {
    recommendations.push('No immediate board risks detected.');
  }

  const metrics = {
    totalCards,
    completedCards: completedCards.length,
    activeCards: inProgressCards.length,
    completionPercentage: completionRate,
    overdueCards: overdue.length,
    upcomingDeadlines: upcoming.length,
    blockedCards: blocked.length,
    unassignedCards: unassigned.length,
    healthScore,
    weeklyThroughput,
    cycleTimeDays: null,
    sprintForecast
  };

  return {
    boardId,
    boardName,

    // Structured metrics used by tests and other consumers
    metrics,
    workloadDistribution,

    // Original flat properties retained for compatibility
    totalCards,
    completedCards: completedCards.length,
    activeCards: inProgressCards.length,
    completionRate,
    overdueCards: overdue.length,
    upcomingDeadlines: upcoming.length,
    blockedCards: blocked.length,
    unassignedCards: unassigned.length,
    healthScore,
    weeklyThroughput,
    cycleTimeDays: null,

    sprintForecast,
    listStats,
    memberWorkload,
    recommendations,

    limitations: [
      'Done lists are identified by configured list names; dueComplete also counts as complete.',
      'Blocked status is inferred only from explicit words in card titles, descriptions, or label names.',
      'Archived cards are excluded.',
      'Cycle time requires reliable start and completion event history and is not calculated.',
      'Weekly throughput is an estimate when board action history is enabled.',
      'Sprint forecasts use explicitly estimated unfinished cards and configured weekday capacity; holidays, availability and task dependencies are not accounted for.'
    ],

    analyzedAt: currentDate.toISOString()
  };
}

export function summarizeBoard(analysis) {
  const totalCards = analysis.totalCards ?? analysis.metrics?.totalCards ?? 0;
  const completedCards =
    analysis.completedCards ?? analysis.metrics?.completedCards ?? 0;

  const healthScore =
    analysis.healthScore ?? analysis.metrics?.healthScore ?? null;

  const summary =
    `${completedCards}/${totalCards} cards completed. ` +
    `Board health score: ${healthScore ?? 'N/A'}.`;

  return {
    summary,

    boardId: analysis.boardId,
    boardName: analysis.boardName,

    totalCards,
    activeCards: analysis.activeCards,
    completedCards,
    completionRate: analysis.completionRate,
    healthScore,

    risks: {
      blockedCards: analysis.blockedCards,
      overdueCards: analysis.overdueCards,
      unassignedCards: analysis.unassignedCards
    },

    weeklyThroughput: analysis.weeklyThroughput,
    sprintForecast: analysis.sprintForecast,
    recommendations: analysis.recommendations,
    limitations: analysis.limitations,
    analyzedAt: analysis.analyzedAt
  };
}
