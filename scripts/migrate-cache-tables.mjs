// 운영 Supabase → 개발 Supabase로 캐시 테이블 두 개를 복사한다.
//   place_buzz_cache : place_key PK. upsert(onConflict place_key).
//   license_cache    : id BIGSERIAL. 대상 테이블을 비우고 id 없이 insert → 개발 DB가 새로 채번한다.
//                      (id를 그대로 옮기면 시퀀스가 안 따라와서 다음 배치 insert가 PK 충돌한다.)
// 세션·피드백·로그 등 개인 데이터 테이블은 의도적으로 다루지 않는다.
//
// 사용법 (Node 22, 저장소 루트에서):
//   .env.migrate 파일에 아래 4개를 채운다 (.env* 는 gitignore 대상):
//     SRC_SUPABASE_URL=https://<운영ref>.supabase.co
//     SRC_SERVICE_ROLE_KEY=...
//     DST_SUPABASE_URL=https://<개발ref>.supabase.co
//     DST_SERVICE_ROLE_KEY=...
//   node --env-file=.env.migrate scripts/migrate-cache-tables.mjs          # 건수만 확인(dry run)
//   node --env-file=.env.migrate scripts/migrate-cache-tables.mjs --yes    # 실제 복사

import { createClient } from '@supabase/supabase-js';

const PAGE = 1000;   // 읽기 페이지 크기 (PostgREST 기본 상한)
const BATCH = 500;   // 쓰기 배치 크기

function env(name) {
  const v = (process.env[name] ?? '').trim();
  if (!v) { console.error(`환경변수 ${name} 이 비어 있다.`); process.exit(1); }
  return v;
}

const srcUrl = env('SRC_SUPABASE_URL');
const dstUrl = env('DST_SUPABASE_URL');
if (srcUrl === dstUrl) { console.error('SRC와 DST가 같은 프로젝트다. 중단.'); process.exit(1); }

const src = createClient(srcUrl, env('SRC_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const dst = createClient(dstUrl, env('DST_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const apply = process.argv.includes('--yes');

async function count(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table} count 실패: ${error.message}`);
  return count ?? 0;
}

async function readAll(client, table, orderCol) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select('*').order(orderCol, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} 읽기 실패 (offset ${from}): ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function writeBatches(table, rows, writer) {
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await writer(chunk);
    if (error) throw new Error(`${table} 쓰기 실패 (${i}~${i + chunk.length}): ${error.message}`);
    done += chunk.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  process.stdout.write('\n');
}

async function main() {
  console.log(`SRC ${srcUrl}\nDST ${dstUrl}\n`);

  const tables = ['place_buzz_cache', 'license_cache'];
  const before = {};
  for (const t of tables) {
    before[t] = { src: await count(src, t), dst: await count(dst, t) };
    console.log(`${t.padEnd(18)} 운영 ${String(before[t].src).padStart(7)}행 → 개발 현재 ${String(before[t].dst).padStart(7)}행`);
  }

  if (!apply) {
    console.log('\ndry run. 실제로 복사하려면 --yes 를 붙일 것.');
    return;
  }

  // 1) place_buzz_cache — PK upsert
  {
    const rows = await readAll(src, 'place_buzz_cache', 'place_key');
    console.log(`\nplace_buzz_cache ${rows.length}행 upsert`);
    await writeBatches('place_buzz_cache', rows, (chunk) => dst.from('place_buzz_cache').upsert(chunk, { onConflict: 'place_key' }));
  }

  // 2) license_cache — 대상 비우고 id 없이 insert
  {
    const rows = await readAll(src, 'license_cache', 'id');
    console.log(`\nlicense_cache 개발 테이블 비우는 중 (${before.license_cache.dst}행)`);
    const { error: delErr } = await dst.from('license_cache').delete().gte('id', 0);
    if (delErr) throw new Error(`license_cache 삭제 실패: ${delErr.message}`);
    const stripped = rows.map(({ id: _id, ...rest }) => rest);
    console.log(`license_cache ${stripped.length}행 insert`);
    await writeBatches('license_cache', stripped, (chunk) => dst.from('license_cache').insert(chunk));
  }

  console.log('\n검증:');
  for (const t of tables) {
    const after = await count(dst, t);
    const ok = after === before[t].src ? 'OK' : 'MISMATCH';
    console.log(`  ${t.padEnd(18)} 운영 ${before[t].src} / 개발 ${after}  ${ok}`);
  }
}

main().catch((e) => { console.error('\n실패:', e.message); process.exit(1); });
