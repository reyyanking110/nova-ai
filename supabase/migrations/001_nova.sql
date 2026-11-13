-- Run in Supabase SQL editor or supabase db push. No public service-key access.
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default 'NOVA owner', owner_phone text unique check(owner_phone ~ '^\+[1-9][0-9]{6,14}$'),
 timezone text not null default 'Asia/Karachi', role text not null default 'owner' check(role in ('owner','viewer')),
 created_at timestamptz not null default now()
);
create function public.bootstrap_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id) values(new.id);
 insert into public.ai_settings(user_id) values(new.id);
 return new;
end; $$;
create table public.ai_settings(id uuid primary key default gen_random_uuid(),user_id uuid not null unique references public.profiles(id) on delete cascade,personality text not null default 'You are NOVA, a helpful, precise assistant. Speak naturally in English, Urdu, or Roman Urdu.',response_language text not null default 'auto',voice_replies boolean not null default false,created_at timestamptz not null default now());
create trigger on_auth_user_created after insert on auth.users for each row execute function public.bootstrap_user();
create table public.business_profiles(id uuid primary key default gen_random_uuid(),user_id uuid not null unique references public.profiles(id) on delete cascade,name text not null,description text not null,phone_number_id text not null unique,reminder_template text,template_language text not null default 'en_US',created_at timestamptz not null default now());
create table public.contacts(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,name text not null,phone text not null check(phone ~ '^\+[1-9][0-9]{6,14}$'),mode text not null check(mode in ('personal','business')),last_inbound_at timestamptz,created_at timestamptz not null default now(),unique(user_id,phone),unique(id,user_id,mode));
create table public.conversations(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,contact_id uuid not null,mode text not null check(mode in ('personal','business')),title text not null default 'WhatsApp conversation',created_at timestamptz not null default now(),unique(contact_id),unique(id,user_id,mode),foreign key(contact_id,user_id,mode) references public.contacts(id,user_id,mode) on delete cascade);
create table public.messages(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,conversation_id uuid not null,mode text not null check(mode in ('personal','business')),role text not null check(role in ('user','assistant')),content text not null,external_id text unique,status text not null default 'received',created_at timestamptz not null default now(),foreign key(conversation_id,user_id,mode) references public.conversations(id,user_id,mode) on delete cascade);
create table public.memories(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,mode text not null check(mode in ('personal','business')),content text not null,approved boolean not null default false,created_at timestamptz not null default now());
create table public.memory_summaries(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,conversation_id uuid not null,mode text not null check(mode in ('personal','business')),content text not null,created_at timestamptz not null default now(),foreign key(conversation_id,user_id,mode) references public.conversations(id,user_id,mode) on delete cascade);
create table public.tasks(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,mode text not null check(mode in ('personal','business')),title text not null,status text not null default 'open' check(status in ('open','in_progress','completed')),created_at timestamptz not null default now());
create table public.notes(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,mode text not null check(mode in ('personal','business')),title text not null,content text not null,created_at timestamptz not null default now());
create table public.reminders(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,contact_id uuid not null,mode text not null check(mode in ('personal','business')),title text not null,due_at timestamptz not null,timezone text not null,recurrence text not null default 'none' check(recurrence in ('none','daily','weekly')),status text not null default 'scheduled' check(status in ('scheduled','cancelled','delivered','failed')),last_delivered_at timestamptz,created_at timestamptz not null default now(),foreign key(contact_id,user_id,mode) references public.contacts(id,user_id,mode));
create table public.scheduled_jobs(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id) on delete cascade,kind text not null check(kind in ('webhook','reminder','outbound')),payload jsonb not null,unique_key text unique,status text not null default 'pending' check(status in ('pending','running','completed','failed')),run_at timestamptz not null default now(),attempts integer not null default 0,locked_at timestamptz,last_error text,created_at timestamptz not null default now());
create table public.webhook_events(id text primary key,payload jsonb not null,created_at timestamptz not null default now());
create table public.tool_executions(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,conversation_id uuid not null,mode text not null check(mode in ('personal','business')),tool text not null,input jsonb not null,status text not null check(status in ('pending_confirmation','running','completed','failed','cancelled')),result jsonb,expires_at timestamptz not null default(now()+interval '10 minutes'),created_at timestamptz not null default now(),foreign key(conversation_id,user_id,mode) references public.conversations(id,user_id,mode) on delete cascade);
create table public.media_files(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,mode text not null check(mode in ('personal','business')),name text not null,mime_type text not null,storage_path text not null unique,size_bytes integer not null check(size_bytes between 1 and 10485760),approved boolean not null default false,extracted_text text,created_at timestamptz not null default now());
create table public.business_faqs(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,question text not null,answer text not null,created_at timestamptz not null default now());
create table public.permissions(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,tool text not null,enabled boolean not null default true,business_enabled boolean not null default false,created_at timestamptz not null default now(),unique(user_id,tool));
create table public.audit_logs(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,action text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
create table public.usage_records(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,model text not null,input_tokens integer not null,output_tokens integer not null,created_at timestamptz not null default now());
-- Tenant RLS. Dashboard roles never write directly: validated server routes use service role.
do $$ declare t text; begin
 foreach t in array array['profiles','ai_settings','business_profiles','contacts','conversations','messages','memories','memory_summaries','tasks','notes','reminders','scheduled_jobs','tool_executions','media_files','business_faqs','permissions','audit_logs','usage_records'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy tenant_read on public.%I for select to authenticated using (%I = auth.uid())',t,case when t='profiles' then 'id' else 'user_id' end);
 if t <> 'profiles' then execute format('create index on public.%I(user_id,created_at desc)',t); end if;
 end loop;
end $$;
alter table public.webhook_events enable row level security;
create index messages_conversation on public.messages(conversation_id,created_at desc);
create index jobs_due on public.scheduled_jobs(run_at) where status in ('pending','running');
create index reminders_due on public.reminders(due_at) where status='scheduled';
create index memories_search on public.memories using gin(to_tsvector('simple',content));
-- Atomic deduplication + durable enqueue. Acknowledge webhook only after this transaction commits.
create function public.enqueue_webhook(event_id text,event_payload jsonb) returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into webhook_events(id,payload) values(event_id,event_payload) on conflict do nothing;
 if not found then return false; end if;
 insert into scheduled_jobs(kind,payload,unique_key) values('webhook',event_payload,'webhook:'||event_id);
 return true;
end; $$;
-- Lease jobs; an expired lease is recoverable after worker failure. Max 5 attempts.
create function public.claim_jobs(batch_size integer default 5) returns setof public.scheduled_jobs language plpgsql security definer set search_path=public as $$
begin
 update scheduled_jobs set status='failed',last_error='Lease expired after final attempt' where status='running' and locked_at < now()-interval '10 minutes' and attempts>=5;
 return query update scheduled_jobs set status='running',locked_at=now(),attempts=attempts+1
 where id in(select id from scheduled_jobs where (status='pending' and run_at<=now() or status='running' and locked_at<now()-interval '10 minutes') and attempts<5 order by run_at for update skip locked limit least(batch_size,20)) returning *;
end; $$;
create function public.enqueue_reminders() returns void language sql security definer set search_path=public as $$
 insert into scheduled_jobs(user_id,kind,payload,unique_key,run_at)
 select user_id,'reminder',jsonb_build_object('reminder_id',id),'reminder:'||id::text||':'||due_at::text,due_at from reminders where status='scheduled' and due_at<=now()
 on conflict(unique_key) do nothing;
$$;
revoke all on function public.enqueue_webhook(text,jsonb),public.claim_jobs(integer),public.enqueue_reminders() from public,anon,authenticated;
grant execute on function public.enqueue_webhook(text,jsonb),public.claim_jobs(integer),public.enqueue_reminders() to service_role;
-- Private storage only; signed URLs are issued by the authorized API.
insert into storage.buckets(id,name,public,file_size_limit) values('nova-private','nova-private',false,10485760) on conflict(id) do nothing;
-- One number can have separate business history and verified-owner personal history.
alter table public.contacts drop constraint contacts_user_id_phone_key;
alter table public.contacts add constraint contacts_tenant_phone_mode unique(user_id,phone,mode);
create function public.persist_reply(p_user uuid,p_conversation uuid,p_mode text,p_external text,p_content text,p_payload jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 insert into messages(user_id,conversation_id,mode,role,content,external_id,status) values(p_user,p_conversation,p_mode,'assistant',p_content,p_external,'queued') on conflict(external_id) do nothing;
 insert into scheduled_jobs(user_id,kind,payload,unique_key) values(p_user,'outbound',p_payload,p_external) on conflict(unique_key) do nothing;
end; $$;
revoke all on function public.persist_reply(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.persist_reply(uuid,uuid,text,text,text,jsonb) to service_role;
-- Linking a personal owner number requires a code delivered to that WhatsApp number.
create table public.phone_verifications(user_id uuid primary key references public.profiles(id) on delete cascade,phone text not null,code_hash text not null,attempts integer not null default 0,expires_at timestamptz not null,created_at timestamptz not null default now());
alter table public.phone_verifications enable row level security;
create function public.verify_owner_phone(p_user uuid,p_hash text) returns boolean language plpgsql security definer set search_path=public as $$
declare v phone_verifications;
begin
 select * into v from phone_verifications where user_id=p_user for update;
 if not found or v.expires_at<now() or v.attempts>=5 then return false; end if;
 update phone_verifications set attempts=attempts+1 where user_id=p_user;
 if v.code_hash<>p_hash then return false; end if;
 update profiles set owner_phone=v.phone where id=p_user;
 delete from phone_verifications where user_id=p_user;
 return true;
end; $$;
create function public.usage_overview(p_user uuid,p_since timestamptz) returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),'requests',count(*),'daily',coalesce((select jsonb_agg(d) from (select created_at::date as day,sum(input_tokens+output_tokens) as tokens from usage_records where user_id=p_user and created_at>=p_since group by created_at::date order by day) d),'[]')) from usage_records where user_id=p_user and created_at>=p_since;
$$;
revoke all on function public.verify_owner_phone(uuid,text),public.usage_overview(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.verify_owner_phone(uuid,text),public.usage_overview(uuid,timestamptz) to service_role;
alter table public.messages add column transport_ids text[] not null default '{}';
alter table public.messages add column reminder_id uuid references public.reminders(id) on delete set null;
create index messages_transport on public.messages using gin(transport_ids);
alter table public.reminders drop constraint reminders_status_check;
alter table public.reminders add constraint reminders_status_check check(status in ('scheduled','cancelled','sent','delivered','failed'));
-- Associate webhook jobs with their owner so failures/recovery are visible in the dashboard.
create or replace function public.enqueue_webhook(event_id text,event_payload jsonb) returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into webhook_events(id,payload) values(event_id,event_payload) on conflict do nothing;
 if not found then return false; end if;
 insert into scheduled_jobs(user_id,kind,payload,unique_key) values((select user_id from business_profiles where phone_number_id=event_payload->>'phoneNumberId'),'webhook',event_payload,'webhook:'||event_id);
 return true;
end; $$;
-- Explicit least-privilege grants; RLS restricts SELECT, no browser mutation grants.
grant select on public.profiles,public.ai_settings,public.business_profiles,public.contacts,public.conversations,public.messages,public.memories,public.memory_summaries,public.tasks,public.notes,public.reminders,public.scheduled_jobs,public.tool_executions,public.media_files,public.business_faqs,public.permissions,public.audit_logs,public.usage_records to authenticated;
revoke all on public.webhook_events,public.phone_verifications from anon,authenticated;
alter table public.media_files add column source_id text;
create unique index media_source on public.media_files(user_id,source_id) where source_id is not null;
alter table public.usage_records add column mode text not null default 'personal' check(mode in ('personal','business'));
drop function public.usage_overview(uuid,timestamptz);
create function public.usage_overview(p_user uuid,p_since timestamptz,p_mode text default null) returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),'requests',count(*),'daily',coalesce((select jsonb_agg(d) from (select created_at::date as day,sum(input_tokens+output_tokens) as tokens from usage_records where user_id=p_user and created_at>=p_since and (p_mode is null or mode=p_mode) group by created_at::date order by day) d),'[]')) from usage_records where user_id=p_user and created_at>=p_since and (p_mode is null or mode=p_mode);
$$;
revoke all on function public.usage_overview(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.usage_overview(uuid,timestamptz,text) to service_role;
create function public.enforce_personal_contact() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.mode='personal' and not exists(select 1 from profiles where id=new.user_id and owner_phone=new.phone) then raise exception 'Personal contact must match the verified owner number'; end if;
 return new;
end; $$;
create trigger personal_contact_boundary before insert or update on public.contacts for each row execute function public.enforce_personal_contact();
alter table public.tool_executions add column idempotency_key text unique;
