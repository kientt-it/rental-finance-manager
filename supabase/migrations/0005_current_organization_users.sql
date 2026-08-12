-- Keep the expense participant list aligned with the organization selected by
-- get_dashboard_data. This also prevents the same auth user from appearing
-- more than once when they still belong to older organizations.

create or replace function public.get_organization_users()
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  with target_organization as (
    select member.organization_id
    from public.members member
    where member.user_id = auth.uid()
    order by member.created_at
    limit 1
  )
  select
    account.id as user_id,
    coalesce(
      nullif(account.raw_user_meta_data ->> 'full_name', ''),
      split_part(account.email, '@', 1)
    ) as full_name,
    coalesce(account.email, '') as email
  from target_organization target
  join public.members visible_member
    on visible_member.organization_id = target.organization_id
  join auth.users account
    on account.id = visible_member.user_id
  order by
    case when account.id = auth.uid() then 0 else 1 end,
    full_name;
$$;

