// Sprint capacity forecasting: parse per-card estimates and compare the remaining
// work with configured weekday capacity. Pure functions, no network.
import { asArray } from './utils/arrays.mjs';

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
