-- Keep delivery history intact when a member removes a reminder from their inbox.
alter table public.payment_reminder_events
  add column if not exists dismissed_at timestamptz;

create or replace function public.manage_payment_reminder_notification(
  action_name text,
  target_event_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if action_name not in ('mark_read', 'mark_unread', 'dismiss', 'mark_all_read', 'mark_all_unread') then
    raise exception 'Invalid notification action';
  end if;

  if action_name in ('mark_read', 'mark_unread', 'dismiss') and target_event_id is null then
    raise exception 'Notification ID required';
  end if;

  update public.payment_reminder_events as event
  set read_at = case
        when action_name in ('mark_read', 'mark_all_read') then coalesce(event.read_at, now())
        when action_name in ('mark_unread', 'mark_all_unread') then null
        else event.read_at
      end,
      dismissed_at = case when action_name = 'dismiss' then now() else event.dismissed_at end
  where event.auth_user_id = auth.uid()
    and event.in_app_enabled
    and event.dismissed_at is null
    and (action_name in ('mark_all_read', 'mark_all_unread') or event.id = target_event_id)
    and (
      action_name = 'dismiss'
      or (action_name in ('mark_read', 'mark_all_read') and event.read_at is null)
      or (action_name in ('mark_unread', 'mark_all_unread') and event.read_at is not null)
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.manage_payment_reminder_notification(text, uuid) from public, anon;
grant execute on function public.manage_payment_reminder_notification(text, uuid) to authenticated;
