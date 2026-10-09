export type Appearance = "auto" | "light" | "dark" | "radar";
export type TagDetail = "full" | "compact" | "line" | "none";

export interface Options {
  /** aspeto geral (UI + etiquetas + mapa) */
  appearance: Appearance;
  /** quanta informação mostrar nas etiquetas (reduz automaticamente se faltar espaço) */
  tagDetail: TagDetail;
  trails: boolean;
  stopNames: boolean;
  /** intervalo de atualização das posições em segundos */
  pollSeconds: 5 | 7 | 10;
}

export const DEFAULT_OPTIONS: Options = { appearance: "auto", tagDetail: "full", trails: true, stopNames: true, pollSeconds: 7 };

const KEY = "carris-opcoes-v1";

export function normalizeOptions(v: unknown): Options {
  const o = (v ?? {}) as Partial<Options>;
  const pick = <T,>(x: unknown, allowed: readonly T[], d: T): T => (allowed.includes(x as T) ? (x as T) : d);
  return {
    appearance: pick(o.appearance, ["auto", "light", "dark", "radar"] as const, DEFAULT_OPTIONS.appearance),
    tagDetail: pick(o.tagDetail, ["full", "compact", "line", "none"] as const, DEFAULT_OPTIONS.tagDetail),
    trails: typeof o.trails === "boolean" ? o.trails : DEFAULT_OPTIONS.trails,
    stopNames: typeof o.stopNames === "boolean" ? o.stopNames : DEFAULT_OPTIONS.stopNames,
    pollSeconds: pick(o.pollSeconds, [5, 7, 10] as const, DEFAULT_OPTIONS.pollSeconds),
  };
}

export function loadOptions(): Options {
  try {
    return normalizeOptions(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveOptions(o: Options) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* ignora */
  }
}

/** Resolve "auto" para claro/escuro conforme o sistema */
export function resolveAppearance(a: Appearance, systemDark: boolean): "light" | "dark" | "radar" {
  return a === "auto" ? (systemDark ? "dark" : "light") : a;
}

/** Níveis de detalhe das etiquetas (do mais completo ao mais simples) permitidos por cada preferência */
export function detailLevels(d: TagDetail): ("full" | "compact" | "line")[] {
  return { full: ["full", "compact", "line"], compact: ["compact", "line"], line: ["line"], none: [] }[d] as ("full" | "compact" | "line")[];
}
