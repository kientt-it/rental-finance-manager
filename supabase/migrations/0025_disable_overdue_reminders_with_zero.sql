-- Allow each reminder scope to disable its overdue milestone with 0 days.
-- Run after 0024_separate_send_days_and_recipient_audit.sql.

alter table public.payment_reminder_settings
  drop constraint if exists payment_reminder_settings_reminder_after_days_check,
  drop constraint if exists payment_reminder_settings_rent_after_days_check;

alter table public.payment_reminder_settings
  add constraint payment_reminder_settings_reminder_after_days_check
    check (reminder_after_days between 0 and 30),
  add constraint payment_reminder_settings_rent_after_days_check
    check (rent_reminder_after_days between 0 and 30);

-- Keep the functions installed by 0024, changing only their overdue branches.
-- The guards make this migration safe to rerun and reject an unexpected older
-- function body instead of silently leaving "0" as a due-date reminder.
do $$
declare
  candidate_definition text;
  audit_definition text;
  old_living text := 'when active.reminder_after_days = (today_vn -';
  new_living text := 'when active.reminder_after_days > 0 and active.reminder_after_days = (today_vn -';
  old_rent text := 'when due.rent_reminder_after_days = (today_vn -';
  new_rent text := 'when due.rent_reminder_after_days > 0 and due.rent_reminder_after_days = (today_vn -';
  old_audit text := 'or plan.today_vn = plan.due_date + plan.after_days then ''ready''';
  new_audit text := 'or (plan.after_days > 0 and plan.today_vn = plan.due_date + plan.after_days) then ''ready''';
begin
  candidate_definition := pg_get_functiondef('public.get_payment_reminder_candidates()'::regprocedure);
  if position(old_living in candidate_definition) > 0 then
    candidate_definition := replace(candidate_definition, old_living, new_living);
  elsif position(new_living in candidate_definition) = 0 then
    raise exception 'Unexpected living reminder function. Apply migration 0024 first.';
  end if;
  if position(old_rent in candidate_definition) > 0 then
    candidate_definition := replace(candidate_definition, old_rent, new_rent);
  elsif position(new_rent in candidate_definition) = 0 then
    raise exception 'Unexpected rent reminder function. Apply migration 0024 first.';
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
