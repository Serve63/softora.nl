-- Install on the canonical companies database. These triggers need no custom
-- SQLite functions, so every importer and worker uses the same storage guard.
create trigger if not exists companies_no_protected_email_insert
before insert on companies
when new.email is not null
  and (new.email not like '%@%.%' or instr(new.email, ' ') > 0 or instr(new.email, '<') > 0)
  and (lower(new.email) like '%email%protected%'
    or lower(new.email) like '%email%protection%'
    or lower(new.email) like '%cf%email%')
begin
  select raise(abort, 'CONTACT_EMAIL_PROTECTED: verify the original public address');
end;

create trigger if not exists companies_no_protected_email_update
before update of email on companies
when new.email is not null
  and (new.email not like '%@%.%' or instr(new.email, ' ') > 0 or instr(new.email, '<') > 0)
  and (lower(new.email) like '%email%protected%'
    or lower(new.email) like '%email%protection%'
    or lower(new.email) like '%cf%email%')
begin
  select raise(abort, 'CONTACT_EMAIL_PROTECTED: verify the original public address');
end;
