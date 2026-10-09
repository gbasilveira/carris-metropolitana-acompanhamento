import { DEFAULT_CATEGORIES, type Group, type Trip } from "./trips.ts";

const KEY = "carris-favoritos-v1";

export interface Favorites {
  lines: string[];
  stops: string[];
  trips: Trip[];
  groups: Group[];
  categories: string[];
}

const empty = (): Favorites => ({ lines: [], stops: [], trips: [], groups: [], categories: [...DEFAULT_CATEGORIES] });

/** Lê do localStorage e preenche campos em falta (migração de versões anteriores só com linhas/paragens) */
export function normalizeFavorites(v: unknown): Favorites {
  const base = empty();
  const o = (v ?? {}) as Partial<Favorites>;
  const arr = <T>(x: unknown, d: T[]): T[] => (Array.isArray(x) ? (x as T[]) : d);
  return {
    lines: arr(o.lines, base.lines),
    stops: arr(o.stops, base.stops),
    trips: arr(o.trips, base.trips),
    groups: arr(o.groups, base.groups),
    categories: arr(o.categories, base.categories).length ? arr(o.categories, base.categories) : base.categories,
  };
}

export function loadFavorites(): Favorites {
  try {
    return normalizeFavorites(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return empty();
  }
}

export function saveFavorites(f: Favorites) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* ignora */
  }
}

export function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
