const KEY = "carris-favoritos-v1";

export interface Favorites {
  lines: string[];
  stops: string[];
}

export function loadFavorites(): Favorites {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && Array.isArray(v.lines) && Array.isArray(v.stops)) return v;
  } catch {
    /* sem armazenamento */
  }
  return { lines: [], stops: [] };
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
