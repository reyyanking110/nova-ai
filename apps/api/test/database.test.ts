import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
const pg = new PGlite();
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
beforeAll(async () => {
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 grant usage on schema public,auth to authenticated;
 `);
  await pg.exec(readFileSync('supabase/migrations/001_nova.sql', 'utf8'));
  await pg.exec(
    `grant select on all tables in schema public to authenticated;insert into auth.users(id) values('${a}'),('${b}');`,
  );
});
afterAll(() => pg.close());
describe('actual migration in PostgreSQL-compatible PGlite', () => {
  it('creates profiles and settings from the auth trigger', async () => {
    expect((await pg.query('select * from profiles')).rows).toHaveLength(2);
    expect((await pg.query('select * from ai_settings')).rows).toHaveLength(2);
  });
  it('deduplicates webhook events and queue insertion atomically', async () => {
    await pg.query(`select enqueue_webhook('evt1','{"message":{"id":"test"}}')`);
    await pg.query(`select enqueue_webhook('evt1','{"message":{"id":"test"}}')`);
    expect((await pg.query(`select * from webhook_events where id='evt1'`)).rows).toHaveLength(1);
    expect(
      (await pg.query(`select * from scheduled_jobs where unique_key='webhook:evt1'`)).rows,
    ).toHaveLength(1);
  });
  it('claims a job once and increments its attempt', async () => {
    const first = await pg.query<Row>('select * from claim_jobs(1)');
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]?.attempts).toBe(1);
    expect((await pg.query('select * from claim_jobs(1)')).rows).toHaveLength(0);
  });
  it('recovers stale leases without losing persistent work', async () => {
    await pg.exec(
      `update scheduled_jobs set locked_at=now()-interval '11 minutes' where unique_key='webhook:evt1'`,
    );
    const jobs = await pg.query<Row>('select * from claim_jobs(1)');
    expect(jobs.rows[0]?.attempts).toBe(2);
  });
  it('enforces tenant RLS even on direct database reads', async () => {
    await pg.exec(
      `insert into memories(user_id,mode,content,approved) values('${a}','personal','owner a secret',true),('${b}','personal','owner b secret',true);set role authenticated;set request.jwt.claim.sub='${a}';`,
    );
    try {
      const rows = (await pg.query<Row>('select content from memories')).rows;
      expect(rows).toEqual([{ content: 'owner a secret' }]);
      await expect(
        pg.exec(`insert into memories(user_id,mode,content) values('${a}','personal','bypass')`),
      ).rejects.toThrow();
    } finally {
      await pg.exec('reset role');
    }
  });
  it('rejects unverified personal contacts at database level', async () => {
    await expect(
      pg.exec(
        `insert into contacts(user_id,name,phone,mode) values('${a}','Not owner','+923009999999','personal')`,
      ),
    ).rejects.toThrow('verified owner');
  });
  it('prevents cross-tenant and cross-mode conversation references', async () => {
    const contact = (
      await pg.query<Row>(
        `insert into contacts(user_id,name,phone,mode) values('${a}','Owner','+923001234567','business') returning id`,
      )
    ).rows[0]!.id;
    await expect(
      pg.query(`insert into conversations(user_id,contact_id,mode) values('${b}',$1,'business')`, [
        contact,
      ]),
    ).rejects.toThrow();
    await expect(
      pg.query(`insert into conversations(user_id,contact_id,mode) values('${a}',$1,'personal')`, [
        contact,
      ]),
    ).rejects.toThrow();
  });
  it('requires successful expiring OTP to assign the owner number', async () => {
    await pg.exec(
      `insert into phone_verifications(user_id,phone,code_hash,expires_at) values('${a}','+923001234567','right',now()+interval '10 minutes')`,
    );
    expect(
      (await pg.query<Row>(`select verify_owner_phone('${a}','wrong') as ok`)).rows[0]?.ok,
    ).toBe(false);
    expect(
      (await pg.query<Row>(`select verify_owner_phone('${a}','right') as ok`)).rows[0]?.ok,
    ).toBe(true);
    expect(
      (await pg.query<Row>(`select owner_phone from profiles where id='${a}'`)).rows[0]
        ?.owner_phone,
    ).toBe('+923001234567');
    expect(
      (await pg.query<Row>(`select verify_owner_phone('${a}','right') as ok`)).rows[0]?.ok,
    ).toBe(false);
  });
  it('disallows authenticated execution of privileged queue functions', async () => {
    await pg.exec('set role authenticated');
    try {
      await expect(pg.exec(`select claim_jobs(5)`)).rejects.toThrow('permission denied');
    } finally {
      await pg.exec('reset role');
    }
  });
  it('enqueues a due reminder only once', async () => {
    const contact = (await pg.query<Row>(`select id from contacts where user_id='${a}' limit 1`))
      .rows[0]!.id;
    await pg.query(
      `insert into reminders(user_id,contact_id,mode,title,due_at,timezone) values('${a}',$1,'business','Test',now()-interval '1 minute','UTC')`,
      [contact],
    );
    await pg.exec('select enqueue_reminders();select enqueue_reminders();');
    expect(
      (await pg.query(`select * from scheduled_jobs where kind='reminder'`)).rows,
    ).toHaveLength(1);
  });
  it('persists a reply and outbound job together, exactly once in the database', async () => {
    const contact = (await pg.query<Row>(`select id from contacts where user_id='${a}' limit 1`))
      .rows[0]!.id;
    const conv = (
      await pg.query<Row>(
        `insert into conversations(user_id,contact_id,mode) values('${a}',$1,'business') returning id`,
        [contact],
      )
    ).rows[0]!.id;
    await pg.query(`select persist_reply('${a}',$1,'business','nova:test-reply','hello','{}')`, [
      conv,
    ]);
    await pg.query(`select persist_reply('${a}',$1,'business','nova:test-reply','hello','{}')`, [
      conv,
    ]);
    expect(
      (await pg.query(`select id from messages where external_id='nova:test-reply'`)).rows,
    ).toHaveLength(1);
    expect(
      (await pg.query(`select id from scheduled_jobs where unique_key='nova:test-reply'`)).rows,
    ).toHaveLength(1);
  });
  it('aggregates real usage with a strict mode filter', async () => {
    await pg.exec(
      `insert into usage_records(user_id,mode,model,input_tokens,output_tokens) values('${a}','personal','test',100,20),('${a}','business','test',50,10),('${b}','business','test',999,999);`,
    );
    const r = await pg.query<Row>(
      `select usage_overview('${a}',now()-interval '1 day','business') as usage`,
    );
    expect(r.rows[0]?.usage.input_tokens).toBe(50);
    expect(r.rows[0]?.usage.requests).toBe(1);
  });
  it('all sensitive public tables have RLS enabled', async () => {
    const tables = await pg.query<Row>(
      `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity`,
    );
    expect(tables.rows).toHaveLength(0);
  });
});
type Row = Record<string, any>;
