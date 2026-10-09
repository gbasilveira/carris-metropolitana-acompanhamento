# Carris Metropolitana — Acompanhamento (PWA)

Acompanhamento em tempo real das carreiras da Carris Metropolitana (AML). React + Vite + TypeScript, mapa MapLibre GL (sem chave).
Validação das APIs e dos dados: [`docs/validacao.md`](docs/validacao.md).

## Executar
```bash
npm install
cp .env.example .env        # opcional: só para a integração Google
npm run dev                 # app em http://localhost:5173
GOOGLE_MAPS_API_KEY=... npm run server   # função Google (porta 8787); o dev server faz proxy de /api/google
npm test
npm run build
```

## Estrutura
- `src/lib/eta.ts` — ETA própria: projeta o veículo na shape do padrão, usa `path[].distance` e a média móvel (3 min, piso 3 m/s, teto 25 m/s) das velocidades; desconta a idade do dado. Sempre apresentada como *estimativa*.
- `src/lib/match.ts` — correspondência Google ↔ Carris (agência → `nameShort` → paragens ≤120 m → padrão com embarque antes de desembarque → headsign; empate = ambíguo, o utilizador escolhe).
- `server/` — única parte que usa a chave Google (`X-Goog-Api-Key` no servidor; o cliente chama `/api/google/routes`).
- `public/sw.js` — cache offline stale-while-revalidate de lines/stops/patterns/shapes e da shell; posições, alertas e chegadas nunca são guardadas.
- `tools/validar_google.py` — repete a validação da Routes API (lê a chave do ambiente).

## Notas
- Fonte das posições: hub TML (`/vehicles/positions`, ~7 s de idade). `speed` assumida em km/h (mediana 18, máx. 102).
- `GET /v2/patterns/{id}` falha (404) com prefixo de agência (`[LA77N]1001_0_2`); o prefixo é removido (`stripAgency`).
- ETA oficiais (hub e `arrivals/by_stop.estimated_arrival`) estão desatualizadas há dias; não são usadas.
- O worker do MapLibre é copiado para `public/maplibre/` (`npm run copy-worker`, corre em `postinstall`/`dev`/`build`).
- Segurança: a chave nunca vai para o cliente, ficheiros ou commits; `.env` está no `.gitignore`.
- Deploy: `server/` precisa de um alojamento próprio (ou adaptar `computeRoutes` a uma função serverless); `/api/google` tem de apontar para ele.

## Aspeto e opções (⚙)
- Estilos: Auto (segue o sistema), Claro, Escuro (modernos) e Radar (painel de controlo aéreo). Guardados em `localStorage` (`carris-opcoes-v1`).
- Etiquetas dos veículos: completas / compactas / só linha / nenhuma. `src/lib/labels.ts` coloca-as sem sobreposição (8 posições, 3 níveis de detalhe, dentro do ecrã); as que não cabem escondem-se e o número aparece na barra de estado.
