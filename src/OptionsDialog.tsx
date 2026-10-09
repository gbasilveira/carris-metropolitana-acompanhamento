import { DEFAULT_OPTIONS, type Appearance, type Options, type TagDetail } from "./lib/options.ts";

function Seg<T extends string | number>({ value, items, onChange }: { value: T; items: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {items.map(([v, label]) => (
        <button key={String(v)} className={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export function OptionsDialog({ options, onChange, onClose }: { options: Options; onChange: (o: Options) => void; onClose: () => void }) {
  const set = <K extends keyof Options>(k: K, v: Options[K]) => onChange({ ...options, [k]: v });
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Opções">
        <h3>Opções <button className="star" aria-label="Fechar" onClick={onClose}>✕</button></h3>

        <div className="opt-row">
          <label>Estilo visual</label>
          <Seg<Appearance> value={options.appearance} onChange={(v) => set("appearance", v)}
            items={[["auto", "Auto"], ["light", "Claro"], ["dark", "Escuro"], ["radar", "Radar"]]} />
          <div className="mut" style={{ marginTop: 6 }}>“Auto” segue o sistema. “Radar” é o painel de controlo aéreo (mono, verde, linhas de ligação).</div>
        </div>

        <div className="opt-row">
          <label>Etiquetas dos veículos</label>
          <Seg<TagDetail> value={options.tagDetail} onChange={(v) => set("tagDetail", v)}
            items={[["full", "Completas"], ["compact", "Compactas"], ["line", "Só linha"], ["none", "Nenhuma"]]} />
          <div className="mut" style={{ marginTop: 6 }}>Nunca se sobrepõem: se faltar espaço reduzem o detalhe e, em último caso, escondem-se.</div>
        </div>

        <div className="opt-row switch">
          <label style={{ margin: 0 }}>Rasto dos veículos</label>
          <input type="checkbox" checked={options.trails} onChange={(e) => set("trails", e.target.checked)} />
        </div>
        <div className="opt-row switch">
          <label style={{ margin: 0 }}>Nomes das paragens (zoom perto)</label>
          <input type="checkbox" checked={options.stopNames} onChange={(e) => set("stopNames", e.target.checked)} />
        </div>

        <div className="opt-row">
          <label>Atualizar posições</label>
          <Seg<5 | 7 | 10> value={options.pollSeconds} onChange={(v) => set("pollSeconds", v)} items={[[5, "5 s"], [7, "7 s"], [10, "10 s"]]} />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn sec" onClick={() => onChange({ ...DEFAULT_OPTIONS })}>Repor</button>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={onClose}>Concluir</button>
        </div>
      </div>
    </div>
  );
}
