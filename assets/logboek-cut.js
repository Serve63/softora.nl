(() => {
  const state=window.LogboekCutState;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const photos=new Set(['lateral-raises','shoulder-press','rear-delt','skull-crush','tricep-dip','seated-leg-curl','leg-extentions']);
  const names={monday:'Maandag',tuesday:'Dinsdag',wednesday:'Woensdag',thursday:'Donderdag',friday:'Vrijdag',saturday:'Zaterdag',sunday:'Zondag'};
  function render({session,pending,drafts,planUpdatedAt,online,loading,saving,message,today}) {
    const focus=document.activeElement?.dataset;
    $('day-title').textContent=names[state.weekday(today)];
    $('training-date').textContent=new Date(`${today}T12:00:00Z`).toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Amsterdam'});
    const draft=session?.training_date===today ? {...session,checks:{...session.checks}} : null;
    for(const op of pending)if(draft?.training_date===op.date)draft.checks[state.setKey(op.order,op.set)]={done:op.done};
    const progress=state.progress(draft);
    $('training-completion').textContent=`Training voltooid: ${progress.percent}%`;
    $('progress-label').textContent=`${progress.completed} van ${progress.total} sets gehaald`;
    $('percent').textContent=`${progress.percent}%`;$('progress').value=progress.percent;
    $('exercises').innerHTML=!draft ? '<p class="empty">Training laden…</p>' : draft.exercises.map(row=>{
      const done=Array.from({length:row.sets},(_,i)=>state.done(draft,row.order,i));
      const slug=row.title.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-');
      const image=photos.has(slug)?`<img class="exercise-photo" src="/assets/logboek-photos/${slug}.png" alt="" width="42" height="42" loading="lazy">`:'';
      const complete=done.length>0 && done.every(Boolean);
      return `<article class="exercise ${complete?'complete':''}"><div class="exercise-top">${image}<h3>${esc(row.title)}</h3><span class="weight">${esc(row.kg)} <small>kg</small></span></div><p class="details">${row.sets} sets · ${esc(row.reps)} herhalingen</p><div class="sets">${done.map((checked,i)=>{
        const waiting=pending.some(op=>op.date===today && op.order===row.order && op.set===i);
        return `<button class="set" data-order="${row.order}" data-set="${i}" aria-pressed="${checked}" aria-label="${esc(row.title)}, set ${i+1} gehaald" ${waiting?'disabled':''}><span class="tick" aria-hidden="true">${checked?'✓':''}</span>Set ${i+1}${waiting?' · opslaan…':checked?' gehaald':''}</button>`;
      }).join('')}</div><div class="note-editor"><label for="note-${row.order}">Notitie</label><textarea id="note-${row.order}" data-note-order="${row.order}" data-note-default="${esc(row.notes || '')}" rows="1" maxlength="1000" placeholder="Schrijf hier je notitie…">${esc(drafts?.[`${today}:${row.order}`] ?? draft.notes?.[String(row.order)]?.text ?? row.notes ?? '')}</textarea><div class="note-actions"><button type="button" data-note-save="${row.order}" ${pending.some(op=>op.type==='note' && op.order===row.order)?'disabled':''}>${pending.some(op=>op.type==='note' && op.order===row.order)?'Opslaan…':'Notitie opslaan'}</button><span>${draft.notes?.[String(row.order)]?.version?'Opgeslagen in Supabase':''}</span></div></div></article>`;
    }).join('') || '<p class="empty"><strong>Rustdag</strong>Vandaag staat er geen training gepland.</p>';
    const unsavedNotes=Object.keys(drafts || {}).filter(key=>key.startsWith(`${today}:`)).length;
    $('status').textContent=message || (pending.length ? `${pending.length} wijziging(en) worden opgeslagen…` : unsavedNotes ? 'Je notitie is nog niet opgeslagen. Tik op ‘Notitie opslaan’.' : loading && !session ? 'Training ophalen…' : online ? 'Opgeslagen · gesynchroniseerd met je andere apparaten' : 'Verbinding controleren…');
    $('schema-updated').innerHTML=planUpdatedAt ? `Schema bijgewerkt ${esc(new Date(planUpdatedAt).toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Amsterdam'}))} · <a href="/logboek">Gewichten aanpassen</a>` : '';
    $('retry').hidden=!message;
    $('login').hidden=!message.includes('Log in');
    if(focus?.order && focus?.set)document.querySelector(`[data-order="${focus.order}"][data-set="${focus.set}"]`)?.focus({preventScroll:true});
    if(focus?.noteOrder || focus?.noteSave)document.querySelector(`[data-note-order="${focus.noteOrder || focus.noteSave}"]`)?.focus({preventScroll:true});
  }
  const sync=window.createCutSync({onChange:render});
  $('exercises').addEventListener('click',event=>{
    const save=event.target.closest('[data-note-save]');
    if(save && !save.disabled) {
      const order=Number(save.dataset.noteSave), field=document.querySelector(`[data-note-order="${order}"]`);
      if(field)sync.saveNote(order,field.value,field.dataset.noteDefault);
      return;
    }
    const button=event.target.closest('[data-set]');if(button && !button.disabled)sync.toggle(Number(button.dataset.order),Number(button.dataset.set));
  });
  $('exercises').addEventListener('input',event=>{
    const field=event.target.closest('[data-note-order]');
    if(field) {
      field.style.height='auto';field.style.height=`${Math.max(34,field.scrollHeight)}px`;
      sync.setNoteDraft(Number(field.dataset.noteOrder),field.value,field.dataset.noteDefault);
      $('status').textContent='Notitie gewijzigd. Tik op ‘Notitie opslaan’ om die in Supabase te bewaren.';
    }
  });
  $('retry').addEventListener('click',sync.refresh);
  sync.start();
})();
