export const DAY_LABELS: Record<string, string> = {
  MONDAY: "Senin",
  TUESDAY: "Selasa",
  WEDNESDAY: "Rabu",
  THURSDAY: "Kamis",
  FRIDAY: "Jumat",
};

interface ISchedule {
  day: string;
  startAt: string;
  endAt: string;
}

export const toMinutes = (time: string) => {
  const match = /^(\d{1,2})[.:](\d{2})$/.exec(time.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export const isValidTime = (time: string) =>
  /^([01]\d|2[0-3])\.[0-5]\d$/.test(time);

export const DAY_GROUP_LABELS: Record<string, string> = {
  WEEKDAY: "Senin–Kamis",
  FRIDAY: "Jumat",
};

export const dayGroupOf = (day: string) =>
  day === "FRIDAY" ? "FRIDAY" : "WEEKDAY";

export const isScheduleClash = (a: ISchedule, b: ISchedule) => {
  if (a.day !== b.day) return false;

  const [aStart, aEnd, bStart, bEnd] = [a.startAt, a.endAt, b.startAt, b.endAt]
    .map(toMinutes);

  if (aStart === null || aEnd === null || bStart === null || bEnd === null)
    return a.startAt === b.startAt;

  return aStart < bEnd && bStart < aEnd;
};

export const formatSchedule = ({ day, startAt, endAt }: ISchedule) =>
  `${DAY_LABELS[day] ?? day}, ${startAt} - ${endAt}`;
