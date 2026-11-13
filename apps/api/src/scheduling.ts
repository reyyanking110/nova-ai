import { DateTime, IANAZone } from 'luxon';
import { AppError } from './core.js';
export function validateSchedule(input: { due_at: string; timezone: string }) {
  if (!IANAZone.isValidZone(input.timezone)) throw new AppError(400, 'Invalid IANA timezone');
  if (!DateTime.fromISO(input.due_at).isValid || Date.parse(input.due_at) <= Date.now())
    throw new AppError(400, 'Reminder must be in the future');
}
export function nextOccurrence(
  dueAt: string,
  timezone: string,
  recurrence: string,
  now = Date.now(),
) {
  let next = DateTime.fromISO(dueAt, { zone: timezone });
  if (!next.isValid || !IANAZone.isValidZone(timezone))
    throw new AppError(400, 'Invalid reminder timezone/date');
  if (recurrence === 'none') return null;
  do {
    next = next.plus({ days: recurrence === 'weekly' ? 7 : 1 });
  } while (next.toMillis() <= now);
  return next.toUTC().toISO();
}
export function inServiceWindow(lastInbound: string | null, now = Date.now()) {
  return (
    !!lastInbound &&
    now - Date.parse(lastInbound) < 24 * 60 * 60 * 1000 &&
    now >= Date.parse(lastInbound)
  );
}
