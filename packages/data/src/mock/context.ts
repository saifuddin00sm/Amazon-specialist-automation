import { Faker, base, en } from "@faker-js/faker";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Seeded randomness. Every random value in the mock must come from here. */
export type Rng = {
  faker: Faker;
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  pickMany<T>(items: readonly T[], min: number, max: number): T[];
  shuffle<T>(items: readonly T[]): T[];
  weighted<T>(options: readonly { weight: number; value: T }[]): T;
};

/** Fixed point in time. The mock never reads the real clock. */
export type Clock = {
  /** Last day with metrics, YYYY-MM-DD. */
  anchorDate: string;
  /** "Now" in epoch ms: 18:00 UTC on the anchor date. */
  now: number;
  /** Metric days, oldest first, ending on the anchor date. */
  dates: string[];
  /** Timestamp `days` before now, optionally at a fixed UTC hour on that day. */
  daysAgo(days: number, hour?: number): number;
  iso(ms: number): string;
  isoDate(ms: number): string;
};

export type GeneratorContext = {
  rng: Rng;
  clock: Clock;
  nextId(prefix: string): string;
};

export function createContext(seed: number, anchorDate: string, days: number): GeneratorContext {
  const faker = new Faker({ locale: [en, base], seed });
  const counters = new Map<string, number>();

  const rng: Rng = {
    faker,
    int: (min, max) => faker.number.int({ min, max }),
    float: (min, max) => faker.number.float({ min, max }),
    chance: (probability) => faker.datatype.boolean({ probability }),
    pick: (items) => faker.helpers.arrayElement(items),
    pickMany: (items, min, max) =>
      faker.helpers.arrayElements(items, { min: Math.min(min, items.length), max: Math.min(max, items.length) }),
    shuffle: (items) => faker.helpers.shuffle([...items]),
    weighted: (options) => faker.helpers.weightedArrayElement(options.map((o) => ({ ...o }))),
  };

  const anchorMs = Date.parse(`${anchorDate}T00:00:00.000Z`);
  if (Number.isNaN(anchorMs)) throw new Error(`Invalid anchorDate: ${anchorDate}`);
  const now = anchorMs + 18 * 60 * 60 * 1000;
  const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const clock: Clock = {
    anchorDate,
    now,
    dates: Array.from({ length: days }, (_, i) => isoDate(anchorMs - (days - 1 - i) * DAY_MS)),
    daysAgo: (daysBack, hour) => {
      const ms = now - daysBack * DAY_MS;
      if (hour === undefined) return ms;
      const dayStart = Date.parse(`${isoDate(ms)}T00:00:00.000Z`);
      return dayStart + hour * 60 * 60 * 1000;
    },
    iso: (ms) => new Date(ms).toISOString(),
    isoDate,
  };

  return {
    rng,
    clock,
    nextId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${String(next).padStart(4, "0")}`;
    },
  };
}

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export { DAY_MS };

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Insertion-ordered grouping (Map.groupBy needs ES2024). */
export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const group = groups.get(groupKey);
    if (group) group.push(item);
    else groups.set(groupKey, [item]);
  }
  return groups;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength).trimEnd();
}
