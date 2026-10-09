# Prompt para a próxima sessão

Copia o bloco abaixo para a nova sessão (mesmo repositório, branch `ccr-40d224da-gou9ol`, ambiente com `GOOGLE_MAPS_API_KEY`).

```
Contexto: estamos a construir uma PWA para acompanhar em tempo real as carreiras da Carris Metropolitana (AML), com integração Google Maps. Lê primeiro docs/validacao.md e docs/amostras/ — já contêm a validação das APIs e dos dados. Não repitas a descoberta.

Passo 1 — Verificar a chave Google (sem a mostrar)
- Confirma que $GOOGLE_MAPS_API_KEY está definida (só o comprimento; nunca a imprimas, loggues ou escrevas em ficheiros ou commits). Se estiver vazia, pára e diz-me.
- Repete o teste da Routes API (travelMode TRANSIT, header X-Goog-Api-Key, FieldMask com transitDetails) com mais pares: pelo menos 30 percursos, incluindo zonas rurais (Mafra, Sesimbra, Palmela, Azambuja, Benavente) e horas diferentes (departureTime). Mede de novo: troços Carris, linha encontrada, paragem ≤50 m, padrão resolvido, headsign. Acrescenta os resultados a docs/validacao.md.
- Mede as ETA oficiais (hub /v1/realtime/eta e v2 /arrivals/by_stop) outra vez: ainda estão no passado? Anota a idade.

Passo 2 — Construir a PWA
- React + Vite + TypeScript, mapa MapLibre GL (sem chave); módulo Google isolado, ligado depois.
- Fontes (sem autenticação, CORS aberto):
  • posições: https://go.tmlmobilidade.pt/hub/api/v1/vehicles/positions (idade ~16 s, polling 5–10 s) — fonte principal;
  • https://api.carrismetropolitana.pt/v2: lines, stops, patterns/{id} (path, shape_id, headsign), shapes/{id} (URL-encoded, GeoJSON), arrivals/by_stop/{id}?date=, alerts.
  • Ligação entre APIs por pattern_id/route_id, nunca por trip_id/ride_id (formatos diferentes).
- Funcionalidades: escolher linha(s) e sentido; ver várias carreiras em simultâneo no mapa com rumo e velocidade; desenho do percurso e paragens; horários por paragem (arrivals/by_stop, valor previsto); alertas; favoritos locais.
- ETA própria: projetar a posição do veículo na shape do padrão, usar path[].distance e a velocidade recente (com piso mínimo e média móvel) para estimar a chegada à paragem escolhida; indicar claramente "estimativa" e a idade do dado.
- Integração Google (módulo à parte): Routes API TRANSIT chamada a partir de um servidor/função (não expor chave no cliente); algoritmo validado: filtrar agência "Carris Metropolitana" → nameShort = short_name → paragens Carris a ≤120 m do embarque/desembarque → padrão que contém embarque antes de desembarque, desempate por headsign → seguir esses veículos. Se houver ambiguidade, deixa o utilizador escolher.
- PWA: manifest, service worker, cache offline de lines/stops/patterns/shapes (stale-while-revalidate), UI mobile-first em pt-PT, funciona em Android.

Regras
- Segurança: nunca escrever a chave em ficheiros nem commits; .env no .gitignore; incluir .env.example. Avisa-me se vires a chave exposta em algum sítio.
- Escreve testes para a lógica de ETA e de correspondência Google↔Carris, usando as amostras em docs/amostras/.
- Commits pequenos e claros, push para ccr-40d224da-gou9ol. Não abras PR sem eu pedir.
- Se algo não funcionar (APIs, rede, limites), diz exatamente o quê; não inventes dados.
```
