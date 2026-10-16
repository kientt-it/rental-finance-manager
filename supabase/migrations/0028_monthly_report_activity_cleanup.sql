-- Clear only the admin activity history at 23:55 Vietnam time on day 30.
-- February falls back to its last day. Supabase Cron is configured in UTC.
-- The job wakes on candidate dates; this function deletes rows on exactly one date per month.

create or replace function public.purge_report_activity_events_monthly()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  today_vn date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  last_day_of_month date;
  purge_day integer;
  deleted_count bigint := 0;
begin
  last_day_of_month := (date_trunc('month', today_vn::timestamp) + interval '1 month - 1 day')::date;
  purge_day := least(30, extract(day from last_day_of_month)::integer);

  if extract(day from today_vn)::integer <> purge_day then
    return 0;
  end if;

  delete from public.report_activity_events
  where occurred_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_report_activity_events_monthly() from public, anon, authenticated, service_role;

do $$
declare
  existing_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Enable the pg_cron extension in Supabase before running migration 0028';
  end if;

  select jobid into existing_job_id
  from cron.job
  where jobname = 'report-activity-monthly-cleanup'
    and username = current_user
  limit 1;

  if existing_job_id is null then
    perform cron.schedule(
      'report-activity-monthly-cleanup',
      '55 16 28-30 * *',
      'select public.purge_report_activity_events_monthly()'
    );
  else
    perform cron.alter_job(
      existing_job_id,
      schedule := '55 16 28-30 * *',
      command := 'select public.purge_report_activity_events_monthly()',
      active := true
    );
  end if;
end;
$$;
