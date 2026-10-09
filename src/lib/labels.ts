export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelReq {
  id: string;
  /** posição do veículo no ecrã (px) */
  x: number;
  y: number;
  /** dimensões da etiqueta por nível de detalhe, do mais completo ao mais simples */
  sizes: { w: number; h: number }[];
}

export interface Placement {
  /** índice do nível de detalhe usado */
  level: number;
  /** deslocamento do centro da etiqueta relativamente ao veículo (px) */
  dx: number;
  dy: number;
}

export interface PlaceOptions {
  width: number;
  height: number;
  /** lado (px) da área reservada a cada veículo */
  dot?: number;
  /** distância do centro do veículo à etiqueta (por omissão, o raio da área reservada + margem + 1) */
  gap?: number;
  /** margem mínima entre etiquetas */
  pad?: number;
}

const overlap = (a: Box, b: Box, pad: number) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/**
 * Coloca etiquetas sem sobreposição (entre si e sobre os veículos). Por ordem de prioridade (ordem de `reqs`),
 * tenta cada nível de detalhe e 8 posições à volta do veículo, sempre dentro do ecrã; se nada couber a etiqueta fica oculta (null).
 */
export function placeLabels(reqs: LabelReq[], o: PlaceOptions): Map<string, Placement | null> {
  const dot = o.dot ?? 28;
  const pad = o.pad ?? 3;
  const gap = o.gap ?? dot / 2 + pad + 1;
  const margin = 40;
  const visible = (r: LabelReq) => r.x > -margin && r.y > -margin && r.x < o.width + margin && r.y < o.height + margin;
  const placed: Box[] = reqs.filter(visible).map((r) => ({ x: r.x - dot / 2, y: r.y - dot / 2, w: dot, h: dot }));
  const out = new Map<string, Placement | null>();
  for (const r of reqs) {
    if (!visible(r)) { out.set(r.id, null); continue; }
    let done: Placement | null = null;
    for (let level = 0; level < r.sizes.length && !done; level++) {
      const { w, h } = r.sizes[level];
      const cx = w / 2 + gap;
      const cy = h / 2 + gap;
      const cands: [number, number][] = [[cx, -cy], [-cx, -cy], [cx, cy], [-cx, cy], [cx, 0], [-cx, 0], [0, -cy], [0, cy]];
      for (const [dx, dy] of cands) {
        const b: Box = { x: r.x + dx - w / 2, y: r.y + dy - h / 2, w, h };
        const inside = b.x >= 2 && b.y >= 2 && b.x + b.w <= o.width - 2 && b.y + b.h <= o.height - 2;
        if (inside && !placed.some((p) => overlap(b, p, pad))) {
          placed.push(b);
          done = { level, dx, dy };
          break;
        }
      }
    }
    out.set(r.id, done);
  }
  return out;
}
