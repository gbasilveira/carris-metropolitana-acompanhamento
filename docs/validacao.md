# Validação de dados — Carris Metropolitana (2026-10-09)

Medido a partir de pedidos reais. Amostras reduzidas em `docs/amostras/`.
O Google Maps **não foi testado** (sem chave de API nem acesso ao domínio): a secção respetiva é inferência.

## 1. O site não faz scraping nem tem backend próprio de dados
O site (`carrismetropolitana.pt`, Next.js) consome APIs públicas diretamente no browser. Encontrei-as nos bundles JS:

| Base | Uso |
|---|---|
| `https://api.carrismetropolitana.pt/v2` | API pública documentada (linhas, paragens, veículos, padrões, chegadas, shapes, alertas, GTFS) |
| `https://go.tmlmobilidade.pt/hub/api/v1` | API "hub" da TML, usada pelo site para posições, rede, alertas e ETA |

Ambas: **sem autenticação**, `access-control-allow-origin: *` (a PWA chama-as diretamente, sem proxy), `cache-control: max-age=5` nas posições.
Termos de uso e limites de pedidos: **não encontrados**; confirmar antes de produção.

## 2. Endpoints validados (HTTP 200)

| Endpoint | Conteúdo | Tamanho |
|---|---|---|
| `GET /v2/vehicles` | ~980 veículos em circulação | 0,8 MB |
| `GET /v2/lines` | 717 linhas | 0,3 MB |
| `GET /v2/routes` | rotas | 0,4 MB |
| `GET /v2/stops` | 12 752 paragens | 6,8 MB |
| `GET /v2/patterns/{pattern_id}` | paragens por ordem (`path`), `shape_id`, `headsign`, `trips`, `valid_on` | ~170 KB |
| `GET /v2/shapes/{shape_id}` (URL-encoded) | GeoJSON LineString do percurso | ~120 KB |
| `GET /v2/arrivals/by_stop/{stop_id}?date=YYYYMMDD` | horário previsto + ETA/observado, por paragem | ~18 KB |
| `GET /v2/alerts`, `GET /v2/periods` | alertas de serviço, períodos | — |
| `GET /v2/gtfs` | GTFS estático (zip, ~90 MB) | 90 MB |
| `GET hub /vehicles/positions` | ~1 565 posições (inclui outros operadores), com `route_short_name`, `shape_id` | 1 MB |
| `GET hub /realtime/eta`, `/eta/by-stop/{id}` | ETA por paragem | 7 MB / 0,4 KB |

Não existem: `/v2/stops/{id}`, `/v2/trips`, `/v2/timetables`. `/v2/vehicles?line_id=` é ignorado (devolve tudo).

## 3. Campos relevantes
- **Veículo** (v2): `id` (`[agência]nº`), `lat`, `lon`, `bearing`, `speed`, `timestamp` (ms), `line_id`, `route_id`, `pattern_id`, `trip_id`, `stop_id` (paragem atual/seguinte), `current_status` (`STOPPED_AT`/`INCOMING_AT`/`IN_TRANSIT_TO`), `direction_id`. Metadados (lotação, capacidade, matrícula, modelo): **vazios em todos**.
- **Padrão**: `path[]` = `{stop_id, stop_sequence, distance, ...}`, `shape_id`, `headsign`, `trips[]`.
- **Chegada**: `scheduled_arrival(_unix)`, `estimated_arrival(_unix)`, `observed_arrival(_unix)`, `line_id`, `pattern_id`, `trip_id`, `vehicle_id`, `stop_sequence`, `headsign`.

## 4. Qualidade em tempo real (problemas encontrados)
- **Posições (v2)**: idade mediana ~220 s (p90 ~230 s). Estão desfasadas ~4 min.
- **Posições (hub)**: idade mediana ~16 s (p90 ~31 s). **Muito mais frescas.** Devem ser a fonte principal.
- **ETA do hub** (`/realtime/eta`): 38 188 linhas, **todas no passado** (>1 h; cerca de 2,6 dias de atraso). Hoje não serve para previsões.
- **`/v2/arrivals/by_stop`**: o horário previsto vem sempre; `estimated_arrival` vinha preenchido em 2 de 49 linhas de teste e com valores de dias atrás. **Hoje também não serve como previsão fiável.**
- **Identificadores**: o `trip_id` do v2 (`[VNWG3][LA77N]1528_0_2_0930_0959_0_1`) não coincide com o `ride_id` do hub (`TPNBR-42-20261009-2814_0_2|1|1|1000`). A ligação entre as duas APIs faz-se por `pattern_id`/`route_id`, não por viagem.
- Os identificadores têm prefixo de agência (`[LA77N]1203_0`); a linha comercial é `line_id` (`1203`).

Foi uma medição de um só momento. Repetir ao longo de um dia, incluindo hora de ponta.

## 5. O que dá para integrar

| Funcionalidade | Fonte | Viabilidade |
|---|---|---|
| Várias carreiras no mapa em simultâneo | hub `/vehicles/positions` filtrado por `route_short_name`/`pattern_id`, a cada 5–10 s | **Sim** |
| Percurso da linha sobre o mapa | `/v2/patterns` + `/v2/shapes` | **Sim** |
| Horários corretos | `arrivals/by_stop` (previsto) ou GTFS | **Sim** (os horários previstos são sempre devolvidos) |
| Previsão de chegada | **Calculada por nós**: posição do veículo + `path[].distance` do padrão + velocidade, ou projeção na shape | **Possível, mas é trabalho nosso**; as ETA oficiais não são fiáveis hoje |
| Lotação | — | **Não**, campos vazios |
| Alertas | `/v2/alerts` | **Sim** |

## 6. Google Maps — testado (Routes API, `travelMode: TRANSIT`, 2026-10-09)
12 pares origem/destino na Área Metropolitana de Lisboa (Sintra→Cascais, Amadora→Oeiras, Almada→Setúbal, Loures→Odivelas, Seixal→Barreiro, Mafra→Ericeira, Montijo→Alcochete, Sesimbra→Setúbal, Vila Franca→Alverca, Queluz→Sintra, Palmela→Pinhal Novo, Cacém→Amadora), com alternativas (6 rotas por par). Campos usados: `transitDetails` (`transitLine.nameShort`, `transitLine.agencies`, `headsign`, `stopDetails.departureStop/arrivalStop` com nome e coordenadas).

Resultado, sobre 127 troços de transporte público:
- 94 (74 %) são da Carris Metropolitana. Os restantes: CP (20), Fertagus (4), TCB (4), Metro Sul (2), Sintra 434 (2), outros (1). A agência identifica-se pelo nome (`Carris Metropolitana`).
- **Linha:** 94/94 (100 %) — `nameShort` coincide com `short_name` da Carris, sem ambiguidades (1 linha por número).
- **Paragens:** 94/94 (100 %) a ≤ 50 m da paragem Carris mais próxima, tanto no embarque como no desembarque (medianas ~1 m, máximo 25 m).
- **Padrão (linha + sentido):** 92/94 (98 %) resolvidos como o padrão que contém embarque antes de desembarque. Dois falharam (1252, 3113).
- **Destino (`headsign`):** 75/94 (80 %) coincidem com ≥ 50 % de palavras com o `headsign` do padrão. Os restantes têm nomes diferentes (ex.: Google "Lisboa (Campo Grande) via Cabeço de Montachique" vs. Carris "Campo Grande"), mas o padrão correto é identificável por embarque/desembarque.

Limitações:
- Medição única, com 12 pares só em zonas urbanas e suburbanas; repetir com mais pares e horas.
- Quando duas linhas passam pelos mesmos pares de paragens, o desempate por `headsign` é fraco; 2 casos sem padrão e vários com pontuação baixa devem ser tratados na app com a escolha do utilizador.
- Os dados de horário do Google vêm do GTFS da Carris, por isso a ligação é coerente. Não se testou o preço por pedido; a Routes API com transporte público é paga acima de uma quota.
- O mapa do Google tem termos de uso: os dados da Carris só podem ser sobrepostos num mapa Google conforme esses termos. Rever antes de publicar; alternativa: MapLibre com tiles próprios.

Algoritmo de ligação validado: (1) filtrar troços com agência "Carris Metropolitana"; (2) `nameShort` → `line_id`; (3) paragens Carris a ≤ 120 m do embarque e do desembarque; (4) escolher o padrão da linha que contém embarque antes de desembarque, desempatando pelo `headsign`; (5) seguir no hub os veículos com esse `pattern_id`.

## 7. Próximos passos propostos
1. Medir durante um dia a idade das posições e a fiabilidade das ETA, para confirmar se a falha do ETA é pontual.
2. Repetir o teste Google com mais pares, horas e zonas rurais.
3. Esboçar a PWA (React + MapLibre ou Google Maps JS) com cache offline do GTFS/paragens/padrões e polling das posições.
