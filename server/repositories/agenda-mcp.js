const { createClient } = require('@supabase/supabase-js');

function createAgendaMcpRepository({ client, env = process.env } = {}) {
  let db = client;
  function table() {
    if (!db) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Agenda connection storage unavailable');
      db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    }
    return db.from('softora_agenda_mcp_records');
  }
  async function put(id, kind, value, ttlSeconds) {
    const { error } = await table().insert({ id, kind, value, expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString() });
    if (error?.code === '23505') return false;
    if (error) throw new Error('Agenda connection storage unavailable');
    return true;
  }
  async function get(id, kind, consume = false) {
    const query = consume ? table().delete() : table().select('value');
    const filtered = query.eq('id', id).eq('kind', kind).gt('expires_at', new Date().toISOString());
    const { data, error } = await (consume ? filtered.select('value') : filtered).maybeSingle();
    if (error) throw new Error('Agenda connection storage unavailable');
    return data?.value || null;
  }
  async function finish(id, value) {
    const { error } = await table().update({ value }).eq('id', id).eq('kind', 'mutation');
    if (error) throw new Error('Agenda connection storage unavailable');
  }
  async function revoke(grantId) {
    const { error } = await table().delete().in('kind', ['access', 'refresh', 'grant']).eq('value->>grantId', grantId);
    if (error) throw new Error('Agenda connection storage unavailable');
  }
  return { put, get, finish, revoke };
}
module.exports = { createAgendaMcpRepository };
