# Premium Samenvatten

`/premium-samenvatten` verwerkt een Nederlandse opname via de bestaande premium sessie.
De browser uploadt rechtstreeks naar de private Supabase bucket
`softora-premium-samenvatten`. Bestanden boven 6 MB gebruiken TUS in stukken van 6 MB.
De server controleert de daadwerkelijke grootte en MIME-type voordat hij een job start.

AssemblyAI Universal-3.5 Pro maakt het transcript. Alleen de eerste twee uur van een
bestand worden verwerkt. Daarna maakt OpenAI GPT-5.1 via AssemblyAI LLM Gateway één
Nederlandse samenvatting met actiepunten. De server bewaart geen transcript in de
database; de samenvatting staat tijdelijk in `softora_premium_samenvatten_jobs`.
De tijdelijke audio wordt na voltooiing verwijderd. De dagelijkse cron verwijdert
verlopen jobs, audio en AssemblyAI-transcripten na 24 uur. De statusroute controleert
bij elke aanvraag de eigenaar; een job-ID alleen geeft geen toegang.

## Activering

De functie staat standaard uit. Zet pas na expliciete toestemming voor een concreet
API-budget `ASSEMBLYAI_API_KEY` en `ASSEMBLYAI_SUMMARIZE_ENABLED=1` server-side.
Pas eerst de migratie `20260923151639_premium_samenvatten_audio.sql` toe en controleer
dat de private bucket, tabel en `CRON_SECRET` beschikbaar zijn. Test daarna met een
kleine eigen opname en controleer transcript, samenvatting, verwijdering van de
tijdelijke upload en de cleanup-route. De browser mag nooit de API-key ontvangen.

Volgens de AssemblyAI-prijslijst kost Universal-3.5 Pro $0,21 per audio-uur;
GPT-5.1 via de gateway kost daarnaast $1,25 per miljoen invoertokens en $10 per
miljoen uitvoertokens. Werkelijke kosten hangen af van de gespreksduur en tekstlengte.

Bronnen:
- https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model
- https://www.assemblyai.com/docs/llm-gateway/chat-completions
- https://www.assemblyai.com/llms/pricing.md
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads
