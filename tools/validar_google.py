#!/usr/bin/env python3
"""Valida a ligação Google Routes (TRANSIT) -> linhas/padrões Carris Metropolitana.

Uso: GOOGLE_MAPS_API_KEY=... python3 tools/validar_google.py [saida.json]
A chave só é lida do ambiente; nunca é impressa nem escrita.
"""
import json, math, os, sys, urllib.request, urllib.parse, re
from concurrent.futures import ThreadPoolExecutor

KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
if not KEY:
    sys.exit("GOOGLE_MAPS_API_KEY não definida")
API = "https://api.carrismetropolitana.pt/v2"
MAX_STOP_M = 120

def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)

def hav(a, b, c, d):
    p = math.pi / 180
    x = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(x))

# (nome, lat, lon, nome, lat, lon, zona, departureTime UTC)
P = [
 ("Mafra",38.9366,-9.3292,"Ericeira",38.9631,-9.4174,"rural","2026-10-10T08:00:00Z"),
 ("Mafra",38.9366,-9.3292,"Malveira",38.9304,-9.2633,"rural","2026-10-12T07:30:00Z"),
 ("Mafra",38.9366,-9.3292,"Sintra",38.8029,-9.3817,"rural","2026-10-12T17:30:00Z"),
 ("Ericeira",38.9631,-9.4174,"Malveira",38.9304,-9.2633,"rural","2026-10-11T10:00:00Z"),
 ("Sesimbra",38.4443,-9.1013,"Setúbal",38.5244,-8.8882,"rural","2026-10-12T08:15:00Z"),
 ("Sesimbra",38.4443,-9.1013,"Quinta do Conde",38.5675,-9.0394,"rural","2026-10-10T14:00:00Z"),
 ("Sesimbra",38.4443,-9.1013,"Cabo Espichel",38.4150,-9.2140,"rural","2026-10-10T10:00:00Z"),
 ("Palmela",38.5686,-8.9014,"Setúbal",38.5244,-8.8882,"rural","2026-10-12T12:00:00Z"),
 ("Palmela",38.5686,-8.9014,"Pinhal Novo",38.6339,-8.9145,"rural","2026-10-12T18:00:00Z"),
 ("Pinhal Novo",38.6339,-8.9145,"Montijo",38.7061,-8.9739,"rural","2026-10-10T16:00:00Z"),
 ("Azambuja",39.0699,-8.8680,"Vila Franca de Xira",38.9553,-8.9890,"rural","2026-10-12T07:00:00Z"),
 ("Azambuja",39.0699,-8.8680,"Carregado",39.0206,-8.9667,"rural","2026-10-12T16:30:00Z"),
 ("Azambuja",39.0699,-8.8680,"Aveiras de Cima",39.1180,-8.9270,"rural","2026-10-10T09:00:00Z"),
 ("Alenquer",39.0553,-9.0100,"Carregado",39.0206,-8.9667,"rural","2026-10-12T08:00:00Z"),
 ("Benavente",38.9806,-8.8061,"Samora Correia",38.9419,-8.8737,"rural","2026-10-12T07:45:00Z"),
 ("Benavente",38.9806,-8.8061,"Salvaterra de Magos",39.0236,-8.7885,"rural","2026-10-12T13:00:00Z"),
 ("Benavente",38.9806,-8.8061,"Vila Franca de Xira",38.9553,-8.9890,"rural","2026-10-12T17:00:00Z"),
 ("Samora Correia",38.9419,-8.8737,"Vila Franca de Xira",38.9553,-8.9890,"rural","2026-10-11T11:00:00Z"),
 ("Arruda dos Vinhos",38.9856,-9.0788,"Vila Franca de Xira",38.9553,-8.9890,"rural","2026-10-12T08:30:00Z"),
 ("Sobral de Monte Agraço",38.9097,-9.1530,"Loures",38.8309,-9.1686,"rural","2026-10-12T09:00:00Z"),
 ("Sintra",38.7976,-9.3878,"Cascais",38.6979,-9.4215,"urbano","2026-10-12T08:00:00Z"),
 ("Sintra",38.7976,-9.3878,"Colares",38.8134,-9.4500,"urbano","2026-10-10T11:00:00Z"),
 ("Amadora",38.7536,-9.2305,"Sete Rios",38.7432,-9.1666,"urbano","2026-10-12T07:30:00Z"),
 ("Almada",38.679,-9.1569,"Costa da Caparica",38.6444,-9.2347,"urbano","2026-10-11T12:00:00Z"),
 ("Seixal",38.6401,-9.1017,"Amora",38.6247,-9.1131,"urbano","2026-10-12T18:30:00Z"),
 ("Amora",38.6247,-9.1131,"Fernão Ferro",38.5925,-9.1,"urbano","2026-10-12T12:30:00Z"),
 ("Barreiro",38.6631,-9.0724,"Moita",38.6502,-8.9908,"urbano","2026-10-12T17:15:00Z"),
 ("Alcochete",38.7549,-8.9608,"Montijo",38.7061,-8.9739,"urbano","2026-10-10T15:00:00Z"),
 ("Loures",38.8309,-9.1686,"Colégio Militar",38.7578,-9.1888,"urbano","2026-10-12T06:30:00Z"),
 ("Odivelas",38.7926,-9.1833,"Loures",38.8309,-9.1686,"urbano","2026-10-12T19:30:00Z"),
 ("Oeiras",38.6973,-9.3094,"Carcavelos",38.6785,-9.3350,"urbano","2026-10-12T10:00:00Z"),
 ("Queluz",38.7566,-9.2545,"Sintra",38.7976,-9.3878,"urbano","2026-10-12T21:30:00Z"),
 ("Cacém",38.7686,-9.2989,"Amadora",38.7536,-9.2305,"urbano","2026-10-11T19:00:00Z"),
 ("Vila Franca de Xira",38.9553,-8.9890,"Alverca",38.8928,-9.0425,"urbano","2026-10-12T05:45:00Z"),
 ("Setúbal",38.5244,-8.8882,"Águas de Moura",38.5100,-8.7000,"rural","2026-10-12T14:30:00Z"),
 ("Cascais",38.6979,-9.4215,"Oeiras",38.6973,-9.3094,"urbano","2026-10-10T22:30:00Z"),
]

def routes(p):
    n1, a1, o1, n2, a2, o2, zona, dt = p
    body = {"origin": {"location": {"latLng": {"latitude": a1, "longitude": o1}}},
            "destination": {"location": {"latLng": {"latitude": a2, "longitude": o2}}},
            "travelMode": "TRANSIT", "departureTime": dt, "computeAlternativeRoutes": True,
            "languageCode": "pt-PT"}
    req = urllib.request.Request("https://routes.googleapis.com/directions/v2:computeRoutes",
        data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": KEY,
                 "X-Goog-FieldMask": "routes.legs.steps.travelMode,routes.legs.steps.transitDetails"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error": e.code, "msg": e.read()[:200].decode("utf8", "ignore")}

def words(s):
    return set(re.findall(r"\w{3,}", (s or "").lower()))

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else None
    stops = get(f"{API}/stops")
    lines = get(f"{API}/lines")
    by_short = {}
    for l in lines:
        by_short.setdefault(l["short_name"], []).append(l)
    pat_cache = {}
    def pat(pid):
        if pid not in pat_cache:
            d = get(f"{API}/patterns/{urllib.parse.quote(pid, safe='')}")
            pat_cache[pid] = d[0] if isinstance(d, list) else d
        return pat_cache[pid]
    stop_xy = [(s["id"], s["lat"], s["lon"]) for s in stops]
    def near(lat, lon):
        return [(hav(lat, lon, a, b), i) for i, a, b in stop_xy if abs(a - lat) < .003 and abs(b - lon) < .004]

    res = []
    stats = dict(pairs=len(P), pairs_ok=0, no_route=0, legs_transit=0, legs_carris=0,
                 line_found=0, stop50=0, pattern=0, headsign=0, errors=0)
    for p in P:
        r = routes(p)
        rec = {"par": f"{p[0]}→{p[3]}", "zona": p[6], "departureTime": p[7], "legs": []}
        if "error" in r:
            stats["errors"] += 1; rec["erro"] = r["error"]; res.append(rec); continue
        rts = r.get("routes", [])
        if not rts:
            stats["no_route"] += 1; rec["erro"] = "sem rotas"; res.append(rec); continue
        stats["pairs_ok"] += 1
        for rt in rts:
            for lg in rt.get("legs", []):
                for st in lg.get("steps", []):
                    td = st.get("transitDetails")
                    if not td: continue
                    stats["legs_transit"] += 1
                    ags = [a.get("name", "") for a in td.get("transitLine", {}).get("agencies", [])]
                    if not any("Carris Metropolitana" in a for a in ags): continue
                    stats["legs_carris"] += 1
                    short = td["transitLine"].get("nameShort")
                    sd, sa = td["stopDetails"]["departureStop"], td["stopDetails"]["arrivalStop"]
                    leg = {"linha": short, "headsign_google": td.get("headsign")}
                    cands = by_short.get(short, [])
                    if cands: stats["line_found"] += 1
                    nd = near(sd["location"]["latLng"]["latitude"], sd["location"]["latLng"]["longitude"])
                    na = near(sa["location"]["latLng"]["latitude"], sa["location"]["latLng"]["longitude"])
                    dmin = min([d for d, _ in nd], default=None); amin = min([d for d, _ in na], default=None)
                    leg["dist_embarque_m"] = dmin and round(dmin); leg["dist_desembarque_m"] = amin and round(amin)
                    if dmin is not None and amin is not None and dmin <= 50 and amin <= 50: stats["stop50"] += 1
                    ds = {i for d, i in nd if d <= MAX_STOP_M}; as_ = {i for d, i in na if d <= MAX_STOP_M}
                    best = None
                    for l in cands:
                        for pid in l["pattern_ids"]:
                            try: pt = pat(pid)
                            except Exception: continue
                            seq = [x["stop_id"] for x in pt["path"]]
                            for i, s in enumerate(seq):
                                if s in ds and any(t in as_ for t in seq[i + 1:]):
                                    sc = len(words(td.get("headsign")) & words(pt.get("headsign")))
                                    if best is None or sc > best[0]: best = (sc, pid, pt.get("headsign"))
                                    break
                    if best:
                        stats["pattern"] += 1
                        leg["pattern_id"], leg["headsign_carris"] = best[1], best[2]
                        hw = words(td.get("headsign"))
                        if hw and best[0] / len(hw) >= .5: stats["headsign"] += 1
                    rec["legs"].append(leg)
        res.append(rec)
    print(json.dumps(stats, ensure_ascii=False))
    if out:
        json.dump({"stats": stats, "resultados": res}, open(out, "w"), ensure_ascii=False, indent=1)

main()
