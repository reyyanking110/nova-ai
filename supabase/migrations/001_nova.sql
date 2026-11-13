BEGIN TRANSACTION READ ONLY;

SELECT jsonb_pretty(
  jsonb_build_object(
    'relations',
    (
      SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT
          n.nspname AS schema_name,
          c.relname,
          c.relkind,
          c.relrowsecurity AS rls_enabled,
          c.relforcerowsecurity AS rls_forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY c.relname
      ) r
    ),

    'columns',
    (
      SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT
          c.relname AS table_name,
          a.attname AS column_name,
          a.attnum AS position,
          format_type(a.atttypid, a.atttypmod) AS data_type,
          a.attnotnull AS not_null,
          a.attidentity AS identity_kind,
          a.attgenerated AS generated_kind,
          pg_get_expr(d.adbin, d.adrelid) AS default_expression
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d
          ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum
      ) r
    ),

    'constraints',
    (
      SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT
          c.relname AS table_name,
          con.conname,
          con.contype,
          con.convalidated,
          pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY c.relname, con.conname
      ) r
    ),

    'indexes',
    (
      SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT
          t.relname AS table_name,
          i.relname AS index_name,
          x.indisunique AS is_unique,
          x.indisvalid AS is_valid,
          x.indisready AS is_ready,
          pg_get_indexdef(i.oid) AS definition
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_class t ON t.oid = x.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY t.relname, i.relname
      ) r
    ),

    'functions',
    (
      SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT
          p.proname AS function_name,
          pg_get_function_identity_arguments(p.oid) AS arguments,
          pg_get_userbyid(p.proowner) AS owner,
          p.prosecdef AS security_definer,
          p.proconfig AS settings,
          p.proacl::text AS privileges,
          pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind IN ('f', 'p')
        ORDER BY p.proname, p.oid
      ) r
    ),

    'triggers',
    (
      SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT
          n.nspname AS schema_name,
          c.relname AS table_name,
          t.tgname,
          t.tgenabled,
          pg_get_triggerdef(t.oid, true) AS definition
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'auth')
          AND NOT t.tgisinternal
        ORDER BY n.nspname, c.relname, t.tgname
      ) r
    ),

    'policies',
    (
      SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname IN ('public', 'storage')
    ),

    'table_grants',
    (
      SELECT coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb)
      FROM information_schema.table_privileges g
      WHERE g.table_schema IN ('public', 'storage')
    ),

    'migration_history_relation',
    to_regclass('supabase_migrations.schema_migrations')::text
  )
) AS nova_schema_report;

COMMIT;
