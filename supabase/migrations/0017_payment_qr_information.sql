-- Add transfer information to the shared payment QR configuration.
-- Run after 0016_admin_manage_member_settlements.sql.

alter table public.payment_qr_settings
  alter column qr_image_data drop not null,
  add column if not exists account_name text,
  add column if not exists bank_account text,
  add column if not exists bank_name text;

comment on column public.payment_qr_settings.account_name is 'Account holder shown with the payment QR';
comment on column public.payment_qr_settings.bank_account is 'Bank account number shown with the payment QR';
comment on column public.payment_qr_settings.bank_name is 'Bank name shown with the payment QR';
