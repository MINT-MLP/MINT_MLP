-- ═══════════════════════════════════════════════════════════════════════════
-- 004~007 권한·정리 규칙 점검 (dev 전용). SQL Editor에 통째로 붙여 한 번에 실행.
-- 테스트 데이터를 만들고, 비로그인·회원 역할로 바꿔 가며 확인한 뒤, 만든 데이터를 지우고 결과 표를 보여준다.
-- 회원 테스트는 dev에 카카오 로그인 회원이 한 명 이상 있어야 돈다(없으면 SKIP).
-- 운영 DB에서는 실행하지 말 것.
-- ═══════════════════════════════════════════════════════════════════════════

drop table if exists pg_temp.test_result;
create temp table test_result (no int, name text, result text, detail text);
grant insert, select on test_result to anon, authenticated;

-- 준비: 비회원 통계 추천 1건, 회원 추천 1건(회원이 있을 때), 오래된 회원 추천 1건
do $$
declare
  v_uid uuid; c bigint; r bigint; s bigint; mc bigint; mr bigint; ms bigint; oc bigint; orr bigint;
begin
  select id into v_uid from public.users where kakao_id is not null order by created_at desc limit 1;

  insert into public.search_condition (mode, group_size, first_purpose, area_type, area_label)
  values ('solo', '2명', '밥', 'preset', 'TEST 성수/건대') returning id into c;
  insert into public.recommendation (condition_id, search_version) values (c, 1) returning id into r;
  insert into public.recommendation_slot (recommendation_id, course, role, rank, kakao_place_id, search_kind, search_query, search_page)
  values (r, 'first', 'main', 1, '900000001', 'keyword', 'TEST 성수 밥', 1) returning id into s;

  if v_uid is not null then
    insert into public.search_condition (user_id, mode, group_size, first_purpose, area_type, area_label)
    values (v_uid, 'solo', '2명', '술', 'auto', 'TEST 강남') returning id into mc;
    insert into public.search_origin (condition_id, ord, query, kakao_place_id) values (mc, 1, 'TEST 강남역', '900000002');
    insert into public.recommendation (user_id, condition_id, search_version) values (v_uid, mc, 1) returning id into mr;
    insert into public.recommendation_slot (recommendation_id, course, role, rank, kakao_place_id, search_kind, search_query, search_page)
    values (mr, 'first', 'main', 1, '900000003', 'keyword', 'TEST 강남 술', 1) returning id into ms;

    -- 100일 전 회원 추천(정리 대상). 조건도 100일 전
    insert into public.search_condition (user_id, mode, group_size, first_purpose, area_type, area_label, created_at)
    values (v_uid, 'solo', '2명', '카페', 'auto', 'TEST 오래된', now() - interval '100 days') returning id into oc;
    insert into public.search_origin (condition_id, ord, query, kakao_place_id) values (oc, 1, 'TEST 오래된역', '900000004');
    insert into public.recommendation (user_id, condition_id, search_version, created_at)
    values (v_uid, oc, 1, now() - interval '100 days') returning id into orr;
  end if;

  perform set_config('test.uid', coalesce(v_uid::text, ''), false);
  perform set_config('test.stat_cond', c::text, false);
  perform set_config('test.stat_rec', r::text, false);
  perform set_config('test.stat_slot', s::text, false);
  perform set_config('test.member_cond', coalesce(mc::text, ''), false);
  perform set_config('test.member_rec', coalesce(mr::text, ''), false);
  perform set_config('test.member_slot', coalesce(ms::text, ''), false);
  perform set_config('test.old_cond', coalesce(oc::text, ''), false);
  perform set_config('test.old_rec', coalesce(orr::text, ''), false);
end $$;


-- 비로그인(anon) 역할
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

do $$
declare n int;
begin
  begin
    insert into public.slot_action (slot_id, action) values (current_setting('test.stat_slot')::bigint, 'map_open');
    insert into test_result values (1, '비회원이 통계 추천 슬롯에 행동 기록', 'PASS', '허용됨');
  exception when others then
    insert into test_result values (1, '비회원이 통계 추천 슬롯에 행동 기록', 'FAIL', sqlerrm);
  end;

  if current_setting('test.member_slot') = '' then
    insert into test_result values (2, '비회원이 회원 슬롯에 기록 못 함', 'SKIP', '회원 없음');
  else
    begin
      insert into public.slot_action (slot_id, action) values (current_setting('test.member_slot')::bigint, 'map_open');
      insert into test_result values (2, '비회원이 회원 슬롯에 기록 못 함', 'FAIL', '기록됨');
    exception when others then
      insert into test_result values (2, '비회원이 회원 슬롯에 기록 못 함', 'PASS', sqlerrm);
    end;
  end if;

  begin
    insert into public.slot_action (slot_id, action) values (current_setting('test.stat_slot')::bigint, 'hack');
    insert into test_result values (3, '허용 목록 밖 행동 값 거부', 'FAIL', '기록됨');
  exception when others then
    insert into test_result values (3, '허용 목록 밖 행동 값 거부', 'PASS', sqlerrm);
  end;

  select count(*) into n from public.recommendation;
  insert into test_result values (4, '비회원은 추천 기록을 못 읽음', case when n = 0 then 'PASS' else 'FAIL' end, n || '행 보임');

  select count(*) into n from public.choice_option;
  insert into test_result values (5, '비회원도 선택지 목록은 읽음', case when n > 0 then 'PASS' else 'FAIL' end, n || '행');
end $$;

reset role;


-- 회원(authenticated) 역할
select set_config('request.jwt.claims',
  case when current_setting('test.uid') = '' then '{"role":"authenticated"}'
       else json_build_object('sub', current_setting('test.uid'), 'role', 'authenticated')::text end, false);
set role authenticated;

do $$
declare n int;
begin
  if current_setting('test.uid') = '' then
    insert into test_result values (10, '회원 테스트', 'SKIP', 'dev에 카카오 회원 없음');
    return;
  end if;

  select count(*) into n from public.recommendation where id = current_setting('test.member_rec')::bigint;
  insert into test_result values (10, '회원이 자기 추천을 읽음', case when n = 1 then 'PASS' else 'FAIL' end, n || '행');

  select count(*) into n from public.recommendation where id = current_setting('test.stat_rec')::bigint;
  insert into test_result values (11, '회원이 남의 통계 추천은 못 읽음', case when n = 0 then 'PASS' else 'FAIL' end, n || '행');

  select count(*) into n from public.search_origin where condition_id = current_setting('test.member_cond')::bigint;
  insert into test_result values (12, '회원이 자기 출발지를 읽음', case when n = 1 then 'PASS' else 'FAIL' end, n || '행');

  begin
    insert into public.slot_action (slot_id, action) values (current_setting('test.member_slot')::bigint, 'reserve');
    insert into test_result values (13, '회원이 자기 슬롯에 행동 기록', 'PASS', '허용됨');
  exception when others then
    insert into test_result values (13, '회원이 자기 슬롯에 행동 기록', 'FAIL', sqlerrm);
  end;

  begin
    insert into public.wishlist (user_id, kakao_place_id, condition_id, course, search_kind, search_query, search_page)
    values (current_setting('test.uid')::uuid, '900000003', current_setting('test.member_cond')::bigint, 'first', 'keyword', 'TEST 강남 술', 1);
    insert into test_result values (14, '회원이 자기 조건으로 찜', 'PASS', '허용됨');
  exception when others then
    insert into test_result values (14, '회원이 자기 조건으로 찜', 'FAIL', sqlerrm);
  end;

  begin
    insert into public.wishlist (user_id, kakao_place_id, condition_id, course, search_kind, search_query, search_page)
    values (current_setting('test.uid')::uuid, '900000001', current_setting('test.stat_cond')::bigint, 'first', 'keyword', 'TEST 성수 밥', 1);
    insert into test_result values (15, '남의 조건으로는 찜 못 함', 'FAIL', '기록됨');
  exception when others then
    insert into test_result values (15, '남의 조건으로는 찜 못 함', 'PASS', sqlerrm);
  end;

  begin
    perform public.certify_visit(current_setting('test.uid')::uuid, current_setting('test.member_slot')::bigint, '900000003', 500);
    insert into test_result values (16, '회원이 방문 인증 함수를 직접 못 부름', 'FAIL', '실행됨');
  exception when others then
    insert into test_result values (16, '회원이 방문 인증 함수를 직접 못 부름', 'PASS', sqlerrm);
  end;

  begin
    insert into public.point_ledger (user_id, kind, amount) values (current_setting('test.uid')::uuid, 'adjust', 50000);
    insert into test_result values (17, '회원이 포인트를 직접 못 넣음', 'FAIL', '기록됨');
  exception when others then
    insert into test_result values (17, '회원이 포인트를 직접 못 넣음', 'PASS', sqlerrm);
  end;
end $$;

reset role;
select set_config('request.jwt.claims', '', false);


-- 서버 쪽 함수 (postgres 역할)
do $$
declare v bigint; n int; u uuid;
begin
  if current_setting('test.uid') = '' then
    insert into test_result values (20, '서버 함수 테스트', 'SKIP', 'dev에 카카오 회원 없음');
    return;
  end if;
  u := current_setting('test.uid')::uuid;

  v := public.certify_visit(u, current_setting('test.member_slot')::bigint, '900000003', 500);
  select count(*) into n from public.point_ledger where visit_id = v and amount = 500;
  insert into test_result values (20, '방문 인증 시 500P 적립', case when v is not null and n = 1 then 'PASS' else 'FAIL' end, 'visit ' || coalesce(v::text, 'null'));

  v := public.certify_visit(u, current_setting('test.member_slot')::bigint, '900000003', 500);
  insert into test_result values (21, '같은 가게 중복 인증 막힘', case when v is null then 'PASS' else 'FAIL' end, coalesce(v::text, 'null'));

  perform public.prune_recommendations();

  select count(*) into n from public.recommendation where id = current_setting('test.old_rec')::bigint and user_id is null;
  insert into test_result values (22, '90일 지난 추천 익명화', case when n = 1 then 'PASS' else 'FAIL' end, n || '행');

  select count(*) into n from public.search_origin where condition_id = current_setting('test.old_cond')::bigint;
  insert into test_result values (23, '익명화된 추천의 출발지 삭제', case when n = 0 then 'PASS' else 'FAIL' end, n || '행 남음');

  select count(*) into n from public.recommendation where id = current_setting('test.member_rec')::bigint and user_id = u;
  insert into test_result values (24, '최근 회원 추천은 그대로', case when n = 1 then 'PASS' else 'FAIL' end, n || '행');

  select count(*) into n from public.search_origin where condition_id = current_setting('test.member_cond')::bigint;
  insert into test_result values (25, '최근 회원 출발지는 그대로', case when n = 1 then 'PASS' else 'FAIL' end, n || '행');
end $$;


-- 정리: 만든 테스트 데이터 삭제 (장소 ID 9000000xx, 라벨 TEST)
do $$
begin
  delete from public.point_ledger where visit_id in (select id from public.visit_certification where kakao_place_id like '90000000%');
  delete from public.visit_certification where kakao_place_id like '90000000%';
  delete from public.wishlist where kakao_place_id like '90000000%';
  delete from public.recommendation where condition_id in (select id from public.search_condition where area_label like 'TEST %');
  delete from public.search_condition where area_label like 'TEST %';
end $$;

select * from test_result order by no;
