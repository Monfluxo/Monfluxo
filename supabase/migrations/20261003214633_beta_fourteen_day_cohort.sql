-- Beta participants share the same 14-day window; Pro cycles remain 30 days.
create table public.credit_beta_config (
 singleton boolean primary key default true check(singleton), starts_at timestamptz
);
insert into public.credit_beta_config(singleton) values(true);
alter table public.credit_beta_config enable row level security;
revoke all on public.credit_beta_config from anon,authenticated;
grant all on public.credit_beta_config to service_role;
alter table public.credit_accounts alter column expires_at set default now()+interval '14 days';

create function public.credit_schedule_beta(p_start timestamptz) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.credit_beta_config where singleton for update;
 if exists(select 1 from public.credit_accounts where plan='beta') then raise exception 'beta_already_started'; end if;
 if p_start is null then raise exception 'invalid_request'; end if;
 update public.credit_beta_config set starts_at=p_start where singleton;
end $$;
revoke all on function public.credit_schedule_beta(timestamptz) from public,anon,authenticated;
grant execute on function public.credit_schedule_beta(timestamptz) to service_role;

create or replace function public.credit_login(p_code_hash text,p_token_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare i public.credit_invites; a uuid; beta_start timestamptz;
begin
 select * into i from public.credit_invites where code_hash=p_code_hash and not revoked for update;
 if not found then raise exception 'invalid_invitation'; end if;
 a:=i.account_id;
 if a is null then
  select starts_at into beta_start from public.credit_beta_config where singleton for update;
  if beta_start is null then
   beta_start:=now();update public.credit_beta_config set starts_at=beta_start where singleton;
  end if;
  if beta_start>now() then raise exception 'beta_not_started'; end if;
  if beta_start+interval '14 days'<=now() then raise exception 'beta_ended'; end if;
  insert into public.credit_accounts(label,cycle_started_at,expires_at)
   values(i.label,beta_start,beta_start+interval '14 days') returning id into a;
  update public.credit_invites set account_id=a where code_hash=p_code_hash;
  insert into public.credit_ledger(account_id,delta,reason) values(a,50,'beta_activation');
 end if;
 if exists(select 1 from public.credit_accounts where id=a and disabled) then raise exception 'account_disabled'; end if;
 delete from public.credit_sessions where account_id=a and expires_at<now();
 insert into public.credit_sessions values(p_token_hash,a,now()+interval '30 days');
 return a;
end $$;
