const { createClient } = require('@supabase/supabase-js');
function createLogboekCutRepository({ client, env = process.env } = {}) {
  let db = client;
  function connection() {
    if (!db) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Storage unavailable');
      db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) },
      });
    }
    return db;
  }
  async function value(query) { const {data,error} = await query; if (error) throw error; return data; }
  async function plan() {
    const source = await value(connection().from('softora_sportschool_logbook').select('payload,updated_at').eq('id','serve_logbook').single());
    await value(connection().from('softora_logboek_cut_plan').upsert({id:'serve_cut',payload:source.payload,updated_at:source.updated_at},{onConflict:'id'}));
    return {payload:source.payload,updatedAt:source.updated_at};
  }
  async function read(date) {
    return value(connection().from('softora_logboek_cut_sessions').select('*').eq('training_date',date).maybeSingle());
  }
  async function open(date, exercises) {
    await value(connection().from('softora_logboek_cut_sessions').upsert({training_date:date,exercises}, {onConflict:'training_date',ignoreDuplicates:true}));
    return read(date);
  }
  async function refreshExercises(date, exercises) {
    await value(connection().from('softora_logboek_cut_sessions').update({exercises}).eq('training_date',date));
    return read(date);
  }
  async function set(input) {
    return value(connection().rpc('softora_logboek_cut_set', {
      p_date:input.date,p_order:input.order,p_set:input.set,p_done:input.done,
      p_version:input.version,p_operation:input.operationId,
    }));
  }
  async function note(input) {
    return value(connection().rpc('softora_logboek_cut_note', {
      p_date:input.date,p_order:input.order,p_text:input.text,p_version:input.version,p_operation:input.operationId,
    }));
  }
  return {plan,read,open,refreshExercises,set,note};
}
module.exports = {createLogboekCutRepository};
