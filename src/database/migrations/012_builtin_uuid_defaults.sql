-- Use PostgreSQL's built-in UUID generator so inserts do not depend on uuid-ossp.
DO $$
DECLARE
  column_record RECORD;
BEGIN
  FOR column_record IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default = 'uuid_generate_v4()'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT gen_random_uuid()',
      column_record.table_schema,
      column_record.table_name,
      column_record.column_name
    );
  END LOOP;
END $$;
