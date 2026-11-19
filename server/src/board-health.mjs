
const DEFAULT_DONE_LISTS = ['done', 'completed', 'closed'];

const asArray = value => Array.isArray(value) ? value : [];

const daysBetween = (a, b) =>
  Math.round((new Date(b) - new Date(a)) / 86400000);

// Estimate format on a card: "Estimated hours: 2" or "[estimate: 2h]".
export function estimatedHours(card) {
  const description = String(card?.desc || '');
  const match = description.match(/(?:\[estimate\s*:\s*|estimated?\s+(?:working\s+)?(?:hours?|time)\s*:\s*)(\d+(?:\.\d+)?)\s*(?:h(?:ours?)?)?\]?/i);
  if (!match) return null;
  const hours = Number(match[1]);
  return Number.isFinite(hours) && hours > 0 && hours <= 10000 ? hours : null;
}

export function forecastSprint(cards, { developers, hoursPerDay, sprintEnd, now = new Date() } = {}) {
  const items = asArray(cards);
  const estimated = items.map(card => ({ card, hours: estimatedHours(card) }));
  const known = estimated.filter(item => item.hours !== null);
  const remainingHours = Number(known.reduce((sum, item) => sum + item.hours, 0).toFixed(2));
  const missingEstimates = items.length - known.length;
  const headcount = Number(developers);
  const dailyHours = Number(hoursPerDay);
  const end = sprintEnd ? new Date(`${sprintEnd}T23:59:59`) : null;
  const validConfig = Number.isInteger(headcount) && headcount > 0 && Number.isFinite(dailyHours) && dailyHours > 0 && dailyHours <= 24 && end && !Number.isNaN(end.getTime());
  if (!validConfig) return { status: 'not_configured', remainingHours, estimatedCards: known.length, missingEstimates, totalActiveCards: items.length, message: 'Set SPRINT_END (YYYY-MM-DD), SPRINT_DEVELOPERS and SPRINT_HOURS_PER_DAY to forecast capacity.' };
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  let workingDays = 0;
  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    if (day.getDay() !== 0 && day.getDay() !== 6) workingDays++;
  }
  const capacityHours = Number((workingDays * headcount * dailyHours).toFixed(2));
  const shortfallHours = Number(Math.max(0, remainingHours - capacityHours).toFixed(2));
  const status = missingEstimates ? 'incomplete_estimates' : shortfallHours ? 'at_risk' : 'on_track';
  return { status, remainingHours, capacityHours, shortfallHours, workingDays, developers: headcount, hoursPerDay: dailyHours, sprintEnd, estimatedCards: known.length, missingEstimates, totalActiveCards: items.length, message: missingEstimates ? 'Some unfinished cards have no time estimate; forecast is incomplete.' : shortfallHours ? 'Estimated workload exceeds available sprint capacity.' : 'Estimated workload fits available sprint capacity.' };
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
      due <= new Date(currentDate.getTime() + 7 * 86400000)
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

  let weeklyThroughput = null;

  if (historyAvailable) {
    const weekAgo = currentDate.getTime() - 7 * 86400000;
    const completedMovements = new Set();

    for (const action of asArray(actions)) {
      if (!action.date) continue;

      const actionTime = new Date(action.date).getTime();

      if (actionTime < weekAgo || actionTime > currentDate.getTime()) {
        continue;
      }

      const destination = action.data?.listAfter;

      if (
        destination &&
        (
          doneListIds.has(destination.id) ||
          doneNames.includes(destination.name?.trim().toLowerCase())
        )
      ) {
        const cardId = action.data?.card?.id;

        if (cardId) {
          completedMovements.add(cardId);
        }
      }
    }

    weeklyThroughput = completedMovements.size;
  }

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

  const recommendations = [];

  if (blocked.length) {
    recommendations.push(
      `Unblock ${blocked.length} explicitly flagged card(s).`
    );
  }

  if (overdue.length) {
    recommendations.push(
      `Review ${overdue.length} overdue card(s).`
    );
  }

  if (unassigned.length) {
    recommendations.push(
      `Assign owners to ${unassigned.length} active card(s).`
    );
  }

  const busiestLists = [...listStats]
    .filter(l => l.activeCards > 0)
    .sort((a, b) => b.activeCards - a.activeCards)
    .slice(0, 2);

  if (busiestLists.length) {
    recommendations.push(
      `Review WIP in ${busiestLists.map(l => l.name).join(', ')}.`
    );
  }

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
