import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Prepara um arquivo para revisão; não abre conexão nem executa SQL.
const root = fileURLToPath(new URL('../', import.meta.url));
const versions = ['20261026120000_multitenant_foundation', '20261026130000_guard_tenant_photos', '20261026140000_tenant_storefronts'];
const baseline = ['20261022230405','20261022231237','20261022231340','20261023120000','20261024120000','20261025120000','20261025130000'];
const tables = ['staff_members','shop_settings','order_records','order_requests','coupons','coupon_uses','customers','showcase_items','order_audit'];
const literal = value => `'${value.replaceAll("'", "''")}'`;
let sql = `-- Saint Cakes uzesslqldbuplovidgkq. Exige backup remoto verificado antes da execução.\n-- Executar integralmente em uma única conexão/transação. Qualquer erro cancela tudo.\nbegin;\nset local lock_timeout = '5s';\nset local statement_timeout = '60s';\n`;
// O bloqueio de configurações drena envios anônimos antes de bloquear pedidos.
for (const table of tables) sql += `lock table private.${table} in access exclusive mode;\n`;
sql += `do $guard$ begin
  if to_regclass('private.tenants') is not null then raise exception 'RELEASE_ALREADY_APPLIED_OR_DRIFT'; end if;
  if (select array_agg(version::text order by version) from supabase_migrations.schema_migrations)
    is distinct from array[${baseline.map(literal).join(',')}]::text[] then raise exception 'UNEXPECTED_MIGRATION_HISTORY'; end if;
end $guard$;
create temporary table release_before(table_name text primary key, fingerprint text) on commit drop;
`;
for (const table of tables) {
  // A atribuição de tenant_id é um UPDATE: o gatilho existente avança a revisão do cliente uma vez.
  // Exigimos esse avanço exato, sem ignorar a revisão nem qualquer dado comercial/consentimento.
  const row = table === 'shop_settings' ? "to_jsonb(t) - 'id' - 'tenant_id'"
    : table === 'customers' ? "(to_jsonb(t) - 'tenant_id') || jsonb_build_object('revision', t.revision + 1)"
    : "to_jsonb(t) - 'tenant_id'";
  sql += `insert into release_before select '${table}', md5(coalesce(string_agg((${row})::text, E'\\n' order by (${row})::text),'')) from private.${table} t;\n`;
}
for (const name of versions) {
  const source = await readFile(path.join(root, 'supabase/migrations', name + '.sql'), 'utf8');
  sql += `\n-- BEGIN ${name}\n${source}\n-- END ${name}\n`;
  sql += `insert into supabase_migrations.schema_migrations(version, name, statements) values (${literal(name.slice(0,14))}, ${literal(name.slice(15))}, array[${literal(source)}]);\n`;
}
for (const table of tables) {
  const row = "to_jsonb(t) - 'tenant_id'";
  sql += `do $check$ begin if (select fingerprint from release_before where table_name='${table}') is distinct from (select md5(coalesce(string_agg((${row})::text, E'\\n' order by (${row})::text),'')) from private.${table} t) then raise exception 'DATA_CHANGED_${table}'; end if; end $check$;\n`;
}
sql += `do $check$ begin
  if (select count(*) from private.tenants) <> 1 or not exists(select 1 from private.tenants where slug='saint-cakes' and status='active' and order_counter=coalesce((select max(number) from private.order_records),0)) then raise exception 'TENANT_COUNTER_INVALID'; end if;
  if jsonb_array_length(private.public_storefront('saint-cakes')->'catalog') <> 26 then raise exception 'CATALOG_SEED_INVALID'; end if;
  if has_table_privilege('anon','private.storefronts','SELECT') or has_table_privilege('authenticated','private.storefronts','SELECT') then raise exception 'TABLE_ACCESS_INVALID'; end if;
end $check$;
notify pgrst, 'reload schema';
commit;
select 'RELEASE_APPLIED' as status, version from supabase_migrations.schema_migrations order by version;
`;
await mkdir(path.join(root, 'verification'), { recursive: true });
const output = path.join(root, 'verification/platform-release.sql');
await writeFile(output, sql);
console.log(`Prepared ${versions.length} migrations with transactional integrity guards: ${output}`);
