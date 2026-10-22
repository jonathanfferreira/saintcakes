# LOCAL ONLY: fixed Saint Cakes container, synthetic UUIDs, no password or remote connection.
$ErrorActionPreference = 'Stop'
$testContainer = 'supabase_db_saintcakes'
function Invoke-LocalSql([string] $Sql) {
  $result = $Sql | & docker exec -i $testContainer psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw 'Local concurrency SQL failed.' }
  return ($result -join "`n")
}
function Start-LocalSql {
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = 'docker'
  $info.Arguments = 'exec -i supabase_db_saintcakes psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres'
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $info
  [void] $process.Start()
  return $process
}
$editorA = $null
$editorB = $null
$fixtureCreated = $false
try {
  Invoke-LocalSql @'
begin;
insert into auth.users(id,email) values ('20000000-0000-4000-8000-000000000002','concurrency@example.invalid');
insert into private.staff_members(user_id,display_name,role,active,can_view_financial)
  values ('20000000-0000-4000-8000-000000000002','CAS ficticia','owner',true,true);
set local role authenticated;
set local request.jwt.claim.sub='20000000-0000-4000-8000-000000000002';
select public.save_order('{"id":"20000000-0000-4000-8000-000000000001","number":1,
"customer":"Cliente CAS ficticio","phone":"","date":"2026-10-24","time":"10:00",
"fulfillment":"pickup","address":"","notes":"CAS fixture",
"lines":[{"id":"cas-line","description":"Ficticio","quantity":1,"unit":"un","unitPriceCents":100}],
"receivedCents":0,"status":"confirmed","createdAt":"2001-01-01T00:00:00.000Z"}'::jsonb,null);
commit;
'@ | Out-Null
  $fixtureCreated = $true
  $editorA = Start-LocalSql
  $editorA.StandardInput.WriteLine(@'
begin;
set local application_name='saintcakes_cas_a_test';
set local role authenticated;
set local request.jwt.claim.sub='20000000-0000-4000-8000-000000000002';
select public.save_order((select row->'order' from jsonb_array_elements(public.read_orders()) row
where row#>>'{order,id}'='20000000-0000-4000-8000-000000000001')
||'{"notes":"Editor A accepted","receivedCents":50}'::jsonb,1);
\echo A_LOCK_HELD
'@)
  $editorA.StandardInput.Flush()
  do { $line = $editorA.StandardOutput.ReadLine() } while ($null -ne $line -and $line -ne 'A_LOCK_HELD')
  if ($line -ne 'A_LOCK_HELD') { throw "Editor A failed: $($editorA.StandardError.ReadToEnd())" }
  $editorB = Start-LocalSql
  $editorB.StandardInput.WriteLine(@'
begin;
set local application_name='saintcakes_cas_b_test';
set local role authenticated;
set local request.jwt.claim.sub='20000000-0000-4000-8000-000000000002';
select public.save_order((select row->'order' from jsonb_array_elements(public.read_orders()) row
where row#>>'{order,id}'='20000000-0000-4000-8000-000000000001')
||'{"notes":"Editor B stale","receivedCents":100}'::jsonb,1);
commit;
'@)
  $editorB.StandardInput.Close()
  $blocked = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $blocked = (Invoke-LocalSql "select exists(select 1 from pg_stat_activity where application_name='saintcakes_cas_b_test' and wait_event_type='Lock')") -eq 't'
    if ($blocked) { break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $blocked) { throw 'Second editor did not reach the concurrent row lock.' }
  $editorA.StandardInput.WriteLine('commit;')
  $editorA.StandardInput.Close()
  $editorA.WaitForExit()
  $editorB.WaitForExit()
  $errorB = $editorB.StandardError.ReadToEnd()
  if ($editorA.ExitCode -ne 0 -or $editorB.ExitCode -eq 0 -or $errorB -notmatch 'ORDER_CONFLICT') {
    throw 'Concurrent stale revision was not rejected correctly.'
  }
  $state = Invoke-LocalSql @'
select revision=2 and payload->>'receivedCents'='50' and payload->>'notes'='Editor A accepted'
and (select count(*) from private.order_audit where order_id='20000000-0000-4000-8000-000000000001')=2
from private.order_records where id='20000000-0000-4000-8000-000000000001';
'@
  if ($state -ne 't') { throw 'Winning revision, money or audit count is incorrect.' }
  Write-Output 'PASS: two real connections; row lock observed; stale editor rejected; winning money/revision and audit preserved.'
} finally {
  foreach ($process in @($editorA,$editorB)) {
    if ($null -ne $process) {
      if (-not $process.HasExited) { $process.StandardInput.Close(); $process.Kill(); $process.WaitForExit() }
      $process.Dispose()
    }
  }
  if ($fixtureCreated) {
    Invoke-LocalSql @'
begin;
set local session_replication_role=replica;
delete from private.order_audit where order_id='20000000-0000-4000-8000-000000000001';
delete from private.order_records where id='20000000-0000-4000-8000-000000000001';
delete from private.staff_members where user_id='20000000-0000-4000-8000-000000000002';
delete from auth.users where id='20000000-0000-4000-8000-000000000002';
commit;
'@ | Out-Null
  }
}
