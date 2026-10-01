const PAGE_SIZE = 500;
const MAX_PAGES = 100;

function createMailAnalyticsRepository({ getSupabaseClient, timeoutMs = 15000 } = {}) {
  async function readAll(table, columns, configure, signal) {
    const client = await getSupabaseClient?.();
    if (!client) throw Object.assign(new Error('Analytics kan de mailhistorie nog niet laden.'), { status: 503 });
    const rows = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = configure(client.from(table).select(columns)).order(table === 'softora_mailbox_messages' ? 'message_key' : 'guard_key');
      const result = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1).abortSignal(signal);
      if (result.error || !Array.isArray(result.data)) throw Object.assign(new Error('Mailhistorie is tijdelijk niet beschikbaar.'), { status: 503 });
      rows.push(...result.data);
      if (result.data.length < PAGE_SIZE) return rows;
    }
    throw Object.assign(new Error('De historie is te groot voor deze periode. Kies een kortere periode.'), { status: 503 });
  }
  async function load({ from, until }) {
    const signal = AbortSignal.timeout(timeoutMs);
    const columns = 'message_key,account_email,folder,provider_id,message_id,sender_email,recipients_text,subject,preview,date,internal_date,in_reply_to,references_text,payload';
    const [guards, outbound] = await Promise.all([
      readAll('softora_outbound_recipient_guards', 'guard_key,key_type,provider,channel,sender_email,recipient_email,status,source,payload,created_at,last_seen_at',
        q => q.eq('key_type', 'email').eq('status', 'sent').eq('channel', 'coldmail').eq('provider', 'softora'), signal),
      readAll('softora_mailbox_messages', columns,
        q => q.in('folder', ['sent', 'instantly']).gte('date', from).lte('date', until), signal),
    ]);
    const recipients = [...new Set([
      ...guards.filter(g => /^(?:softora-)?coldmail/.test(g.source || '') && !/invalid|test|warmup/.test(g.source || '')).map(g => g.recipient_email),
      ...outbound.filter(m => m.payload?.originalCampaignOutbound === true).flatMap(m => (String(m.recipients_text || '').match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/ig) || [])),
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
    const incoming = [];
    // Exact external senders, across inbox and All Mail, keep unrelated archive growth out of the read.
    for (let offset = 0; offset < recipients.length; offset += 300) {
      const batches = [0,100,200].map(step => recipients.slice(offset + step, offset + step + 100)).filter(batch => batch.length);
      const results = await Promise.all(batches.map(batch => readAll('softora_mailbox_messages', columns,
        q => q.in('sender_email', batch).gte('date', from).lte('date', until), signal)));
      incoming.push(...results.flat());
    }
    const messages = [...outbound, ...incoming];
    const bounceMessages = await readAll('softora_mailbox_messages', columns + ',body_text', q => q.in('folder', ['inbox', 'coldmail']).gte('date', from).lte('date', until)
      .or('sender_email.ilike.mailer-daemon@%,sender_email.ilike.postmaster@%,subject.ilike.%delivery%,subject.ilike.%undeliver%,subject.ilike.%returned mail%,subject.ilike.%failure notice%,subject.ilike.%niet bezorgd%,subject.ilike.%onbestelbaar%,subject.ilike.%bezorging mislukt%'), signal);
    return { guards, messages, bounceMessages };
  }
  return { load };
}
module.exports = { createMailAnalyticsRepository };
