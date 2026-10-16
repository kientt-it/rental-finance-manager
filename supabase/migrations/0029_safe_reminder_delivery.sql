-- Keep inbox reminders for linked members without an email, and claim each email
-- against the current balance before calling Gmail. Run after 0028.
do $$
declare
  candidate_definition text;
  audit_definition text;
  old_filter text := 'and candidate.recipient_email <> '''' and candidate.recipient_email not like ''%@users.708.local''';
  new_filter text := 'and (candidate.in_app_enabled or (candidate.email_enabled and candidate.recipient_email <> '''' and candidate.recipient_email not like ''%@users.708.local''))';
  old_audit text := 'and public.is_organization_admin(setting.organization_id)';
  new_audit text := 'and (public.is_organization_admin(setting.organization_id) or auth.role() = ''service_role'')';
begin
  candidate_definition := pg_get_functiondef('public.get_payment_reminder_candidates()'::regprocedure);
  if position(old_filter in regexp_replace(candidate_definition, '\s+', ' ', 'g')) > 0 then
    candidate_definition := regexp_replace(candidate_definition,
      'and candidate\.recipient_email <> ''''\s+and candidate\.recipient_email not like ''%@users\.708\.local''',
      new_filter);
  elsif position(new_filter in regexp_replace(candidate_definition, '\s+', ' ', 'g')) = 0 then
    raise exception 'Unexpected candidate function. Apply migrations through 0025 first.';
  end if;
  execute candidate_definition;

  audit_definition := pg_get_functiondef('public.get_payment_reminder_recipient_audit(uuid)'::regprocedure);
  if position(old_audit in audit_definition) > 0 then
    audit_definition := replace(audit_definition, old_audit, new_audit);
  elsif position(new_audit in audit_definition) = 0 then
    raise exception 'Unexpected recipient audit function. Apply migration 0024 first.';
  end if;
  execute audit_definition;
end;
$$;

grant execute on function public.get_payment_reminder_recipient_audit(uuid) to service_role;

alter table public.payment_reminder_events
  drop constraint if exists payment_reminder_events_email_status_check;
alter table public.payment_reminder_events
  add constraint payment_reminder_events_email_status_check
  check (email_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
alter table public.payment_reminder_events
  add column if not exists gmail_message_id text;

create or replace function public.claim_payment_reminder_email(target_event_id uuid)
returns public.payment_reminder_events
language plpgsql
security definer
set search_path = public
as $$
declare
  reminder public.payment_reminder_events%rowtype;
  current_due record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required';
  end if;

  select * into reminder
  from public.payment_reminder_events
  where id = target_event_id
    and email_status in ('pending', 'failed')
    and attempt_count < 3
  for update skip locked;
  if not found then return null; end if;

  select audit.* into current_due
  from public.get_payment_reminder_recipient_audit(reminder.property_id) audit
  where audit.member_id = reminder.member_id
    and audit.reminder_scope = reminder.reminder_scope;
  if not found then
    update public.payment_reminder_events
    set email_status = 'skipped', email_error = 'Người nhận không còn thuộc danh sách cần nhắc.'
    where id = reminder.id;
    return null;
  end if;

  if reminder.period_start <> date_trunc('month', timezone('Asia/Ho_Chi_Minh', now()))::date
     or current_due.status_code not in ('ready', 'scheduled', 'outside_window')
     or current_due.due_date <> reminder.due_date
     or (reminder.reminder_type = 'before' and timezone('Asia/Ho_Chi_Minh', now())::date >= reminder.due_date)
     or (reminder.reminder_type = 'due' and timezone('Asia/Ho_Chi_Minh', now())::date <> reminder.due_date)
     or round(coalesce(current_due.amount, 0)) <= 0
     or coalesce(current_due.recipient_email, '') !~* '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'
     or current_due.recipient_email like '%@users.708.local'
  then
    update public.payment_reminder_events
    set email_status = 'skipped', email_error = 'Không còn đủ điều kiện gửi tại thời điểm kiểm tra.'
    where id = reminder.id;
    return null;
  end if;

  update public.payment_reminder_events
  set email_status = 'sending', email_error = null,
      attempt_count = attempt_count + 1,
      amount = round(current_due.amount),
      items = case when round(current_due.amount) <> reminder.amount
        then case when reminder.reminder_scope = 'rent' then 'Tiền phòng' else 'Chi phí sinh hoạt' end
        else reminder.items end,
      recipient_email = current_due.recipient_email
  where id = reminder.id
  returning * into reminder;
  return reminder;
end;
$$;

revoke all on function public.claim_payment_reminder_email(uuid) from public, anon, authenticated;
grant execute on function public.claim_payment_reminder_email(uuid) to service_role;
