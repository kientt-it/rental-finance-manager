-- List authenticated accounts that belong to the caller's organization.
-- Kept separate so installations that already ran 0003 can upgrade safely.

create or replace function public.get_organization_users()
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select
    account.id as user_id,
    coalesce(nullif(account.raw_user_meta_data ->> 'full_name', ''), split_part(account.email, '@', 1)) as full_name,
    coalesce(account.email, '') as email
  from public.members visible_member
  join auth.users account on account.id = visible_member.user_id
  where visible_member.organization_id in (
    select caller_member.organization_id
    from public.members caller_member
    where caller_member.user_id = auth.uid()
  )
  order by
    case when account.id = auth.uid() then 0 else 1 end,
    full_name;
$$;

revoke execute on function public.get_organization_users() from public, anon;
grant execute on function public.get_organization_users() to authenticated;
