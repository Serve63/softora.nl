# Lokale Softora-websitevideoworker

## Architectuur

De premium-app zet via `POST /api/bedrijven/:companyId/website-video` één `pending` record in `softora_company_website_videos`. De zelfgehoste worker claimt atomisch één record, opent de homepage in lokale Playwright Chromium, neemt de rustige scroll op en maakt met lokale FFmpeg een H.264-MP4. Na ffprobe-validatie uploadt de worker het bestand naar de bestaande private Supabase-opslag. De vaste videopagina blijft dezelfde status-API pollen en toont het bestand zodra de status `ready` is.

Vercel voert de render bewust niet uit. Chromium en FFmpeg draaien op de eigen Mac of eigen server; er bestaat geen cloudbrowser, externe video-API of betaalde fallback.

## Eenmalige installatie

```bash
npm ci
npx playwright install chromium
```

`ffmpeg-static` en `ffprobe-static` worden met `npm ci` lokaal geïnstalleerd. Eigen systeembinaries kunnen optioneel worden gekozen met `FFMPEG_PATH`, `FFPROBE_PATH` en `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Voer de nieuwe onderdelen van `supabase/data-ops-schema.sql` eenmalig uit op dezelfde Softora-Supabase-database als `softora_customers`. Dit maakt:

- `softora_company_website_videos`;
- de private bucket `softora-company-website-videos`;
- de atomische queue- en claimfuncties.

## Starten

Start de bestaande Softora-app en de worker in twee terminals:

```bash
npm start
npm run worker:website-video
```

Voor één klaarstaande render:

```bash
npm run worker:website-video:once
```

De worker gebruikt dezelfde bestaande `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` als de server. De service-role key blijft uitsluitend server-side.

## Configuratie

- `WEBSITE_VIDEO_STORAGE_BUCKET`: standaard `softora-company-website-videos`.
- `WEBSITE_VIDEO_WORKER_POLL_MS`: standaard `2500`.
- `WEBSITE_VIDEO_LOCK_TIMEOUT_SECONDS`: standaard `300`, begrensd op 60–1800.
- `WEBSITE_VIDEO_LOAD_TIMEOUT_MS`: standaard `30000`.
- `WEBSITE_VIDEO_MAX_REDIRECTS`: standaard `5`.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: optioneel pad naar eigen Chromium.
- `FFMPEG_PATH` en `FFPROBE_PATH`: optionele paden naar eigen binaries.

## Verificatie

```bash
npm run test:contracts
npm run test:e2e:website-video
npm run verify:critical
```

De E2E-test rendert een veilige lokale, lange testhomepage echt, vergelijkt twee videoframes om beweging te bewijzen, controleert dat het vak linksboven gelijk blijft, valideert de MP4 met ffprobe en speelt hem in Chromium af.
