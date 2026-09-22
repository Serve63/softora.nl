(function (root) {
  const api = '/api/logboek-cut';
  root.createCutSync = function ({onChange,fetchImpl = fetch}) {
    let session = null, pending = [], drafts = {}, planUpdatedAt = null, online = false, loading = false, saving = false, message = '', clockOffset = 0, epoch = 0;
    const today = () => root.LogboekCutState.dateKey(new Date(Date.now()+clockOffset));
    function emit() { onChange({session,pending,drafts,planUpdatedAt,online,loading,saving,message,today:today()}); }
    function apply(body) {
      if (body.serverNow) clockOffset = Date.parse(body.serverNow)-Date.now();
      if(body.planUpdatedAt)planUpdatedAt=body.planUpdatedAt;
      if (body.session?.training_date===today()) session=body.session;
    }
    async function request(method,body) {
      const response=await fetchImpl(api,{method,credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(12000)});
      const data=await response.json();
      if(response.status===409) return {...data,conflict:true};
      if(!response.ok) throw Object.assign(new Error(data.error || 'Opslaan niet gelukt.'),{status:response.status});
      return data;
    }
    function report(error) {
      online=false;
      message=error.status===401 || error.status===403 ? 'Log in om je training op te slaan.' : 'Niet opgeslagen. Controleer je verbinding en probeer opnieuw.';
    }
    async function refresh() {
      if(loading || saving || document.activeElement?.matches?.('textarea[data-note-order]'))return;
      if(session && session.training_date!==today())session=null;
      loading=true;const startEpoch=epoch;emit();
      try {const body=await request('GET');if(startEpoch===epoch){apply(body);online=true;message='';}}
      catch(error){report(error);}
      finally{loading=false;emit();}
      await flush();
    }
    async function flush() {
      if(saving)return;
      saving=true;
      try {
        while(pending.length) {
          const op=pending[0];emit();
          const body=await request('POST',op);
          pending.shift();
          epoch++;apply(body);online=true;
          if(body.conflict)message=op.type==='note'?'Notitie is intussen op een ander apparaat gewijzigd. Sla je tekst opnieuw op om die te bewaren.':'Deze set is op een ander apparaat gewijzigd. De nieuwste stand is geladen; controleer je vinkje.';
          else {message='';if(op.type==='note')delete drafts[`${op.date}:${op.order}`];}
        }
      } catch(error){report(error);}
      finally{saving=false;emit();}
    }
    function toggle(order,set) {
      if(!session || session.training_date!==today()) {refresh();return;}
      if(pending.some(op=>op.date===session.training_date && op.order===order && op.set===set))return;
      const key=root.LogboekCutState.setKey(order,set), current=session.checks[key] || {done:false,version:0};
      const op={date:session.training_date,order,set,done:!current.done,version:current.version,
        operationId:crypto.randomUUID(),createdAt:Date.now()};
      epoch++;pending.push(op);emit();flush();
    }
    function saveNote(order,text,baseText='') {
      if(!session || session.training_date!==today()) {message='Training wordt nog geladen.';emit();return;}
      if(pending.some(op=>op.type==='note' && op.order===order))return;
      const current=session.notes?.[String(order)] || {text:baseText,version:0};
      if(current.text===text){delete drafts[`${session.training_date}:${order}`];message='';emit();return;}
      const op={type:'note',date:session.training_date,order,text,version:current.version,
        operationId:crypto.randomUUID(),createdAt:Date.now()};
      pending.push(op);message='';emit();flush();
    }
    function setNoteDraft(order,text,baseText='') {
      if(!session)return;
      const key=`${session.training_date}:${order}`, saved=session.notes?.[String(order)]?.text ?? baseText;
      if(text===saved)delete drafts[key]; else drafts[key]=text;
    }
    function start() {
      emit();refresh();
      setInterval(()=>{if(document.visibilityState==='visible')refresh();},15000);
      for(const event of ['online','focus','pageshow'])root.addEventListener(event,refresh);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
    }
    return {start,toggle,saveNote,setNoteDraft,refresh};
  };
})(window);
