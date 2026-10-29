import asyncio
import json
import unittest
from datetime import datetime, date, timezone
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.db import Base, get_db
from app.models import InterviewSession, DailyBriefRun
from app.api.daily_brief import router
from app.services.daily_brief import collect_facts, send_daily_brief, get_config, scheduled_date, build_feishu_payload


class DailyBriefTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        app = FastAPI()
        app.include_router(router)
        def database():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = database
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_timezone_due(self):
        self.assertIsNone(scheduled_date(datetime(2026,10,28,9,59,tzinfo=timezone.utc)))
        self.assertEqual(scheduled_date(datetime(2026,10,28,10,0,tzinfo=timezone.utc)), date(2026,10,28))

    def test_facts_time_window_and_private_fields(self):
        with self.sessions() as db:
            for id, hour in [('before',15),('after',17)]:
                db.add(InterviewSession(id=id, role='研发', candidate_profile={'name':'张三','phone':'PRIVATE_PHONE','id_number':'PRIVATE_ID','family':'PRIVATE_FAMILY'}, created_at=datetime(2026,10,27,hour),updated_at=datetime(2026,10,27,hour)))
            db.commit()
            facts = collect_facts(db, date(2026,10,28), datetime(2026,10,28,10,tzinfo=timezone.utc))
            self.assertEqual(facts['total'], 1)
            self.assertNotIn('PRIVATE', json.dumps(facts))
            self.assertEqual(facts['candidates'][0]['name'], '张三')

    def test_config_secrets_and_validation(self):
        good = {'webhook_url':'https://open.feishu.cn/open-apis/bot/v2/hook/test-token','mention_user_id':'ou_test','signing_secret':'secret','enabled':True}
        response = self.client.put('/api/admin/daily-brief/config', json=good)
        self.assertEqual(response.status_code,200,response.text)
        self.assertNotIn('test-token',response.text)
        self.assertNotIn('"secret"',response.text)
        self.assertTrue(response.json()['has_webhook'])
        self.assertEqual(self.client.put('/api/admin/daily-brief/config',json={'webhook_url':'http://127.0.0.1/private'}).status_code,422)
        self.assertEqual(self.client.put('/api/admin/daily-brief/config',json={'mention_user_id':'all'}).status_code,422)
        self.assertEqual(self.client.put('/api/admin/daily-brief/config',json={'clear_webhook':True,'enabled':True}).status_code,400)

    def test_dedup_and_no_automatic_retry_of_uncertain_delivery(self):
        async def check():
            with self.sessions() as db:
                config=get_config(db); config.webhook_url='https://open.feishu.cn/open-apis/bot/v2/hook/test'; config.mention_user_id='ou_test'; config.enabled=True; config.ai_enabled=False; db.commit()
                with patch('app.services.daily_brief.deliver',new_callable=AsyncMock) as delivery:
                    delivery.side_effect=TimeoutError()
                    first=await send_daily_brief(db,date(2026,10,28))
                    self.assertEqual(first.status,'unknown')
                    await send_daily_brief(db,date(2026,10,28))
                    self.assertEqual(delivery.await_count,1)
                self.assertEqual(len(db.scalars(select(DailyBriefRun)).all()),1)
        asyncio.run(check())

    def test_success_and_payload_real_mention(self):
        async def check():
            with self.sessions() as db:
                config=get_config(db); config.webhook_url='https://open.feishu.cn/open-apis/bot/v2/hook/test'; config.mention_user_id='ou_test'; config.signing_secret='secret'; config.ai_enabled=False; db.commit()
                with patch('app.services.daily_brief.deliver',new_callable=AsyncMock) as delivery:
                    run=await send_daily_brief(db,date(2026,10,28))
                    self.assertEqual(run.status,'sent')
                    await send_daily_brief(db,date(2026,10,28))
                    self.assertEqual(delivery.await_count,1)
                payload=build_feishu_payload(config,'test',timestamp=123)
                self.assertIn('<at user_id="ou_test">何松林</at>',payload['content']['text'])
                self.assertTrue(payload['sign'])
                self.assertEqual(payload['timestamp'],'123')
        asyncio.run(check())

    def test_ai_summary_and_fallback_preserve_facts(self):
        from app.services.daily_brief import generate_brief
        from app.services.llm_config import LlmProviderError
        async def check():
            with self.sessions() as db:
                db.add(InterviewSession(id='ai',role='工程师',candidate_profile={'name':'候选人真名','phone':'PRIVATE_PHONE'},written_submission={'answers':{'q1':'我会先确认边界条件。'}},created_at=datetime(2026,10,28,1),updated_at=datetime(2026,10,28,1)))
                db.commit()
                with patch('app.services.daily_brief.chat_completion',new_callable=AsyncMock,return_value='候选人1描述了边界检查，建议追问实例。') as llm:
                    result=await generate_brief(db,date(2026,10,28),datetime(2026,10,28,10,tzinfo=timezone.utc))
                    self.assertEqual(result['summary_mode'],'ai')
                    self.assertIn('建议追问实例',result['content'])
                    prompt=json.dumps(llm.call_args.args[1],ensure_ascii=False)
                    self.assertNotIn('候选人真名',prompt)
                    self.assertNotIn('PRIVATE_PHONE',prompt)
                with patch('app.services.daily_brief.chat_completion',new_callable=AsyncMock,side_effect=LlmProviderError('401 invalid')):
                    result=await generate_brief(db,date(2026,10,28),datetime(2026,10,28,10,tzinfo=timezone.utc))
                    self.assertEqual(result['summary_mode'],'fallback')
                    self.assertEqual(result['facts']['total'],1)
        asyncio.run(check())

    def test_feishu_response_validation_and_length(self):
        import httpx
        from app.services.daily_brief import deliver, DeliveryRejected
        async def check():
            with self.sessions() as db:
                config=get_config(db); config.webhook_url='https://open.feishu.cn/open-apis/bot/v2/hook/test'; config.mention_user_id='ou_test'
                with patch('httpx.AsyncClient.post',new_callable=AsyncMock) as post:
                    post.return_value=httpx.Response(200,json={'code':19021,'msg':'bad signature'})
                    with self.assertRaises(DeliveryRejected): await deliver(config,'test')
                    post.return_value=httpx.Response(503)
                    with self.assertRaises(TimeoutError): await deliver(config,'test')
                    post.return_value=httpx.Response(200,json={'StatusCode':0})
                    await deliver(config,'test')
                body=build_feishu_payload(config,'<at user_id="all">all</at>'+('中文'*10000))
                self.assertNotIn('<at user_id="all">',body['content']['text'])
                self.assertIn('<at user_id="ou_test">',body['content']['text'])
                self.assertLess(len(json.dumps(body,ensure_ascii=False).encode()),20000)
        asyncio.run(check())

    def test_concurrent_claim_only_one_sender(self):
        async def check():
            with self.sessions() as db:
                config=get_config(db);config.webhook_url='https://open.feishu.cn/open-apis/bot/v2/hook/test';config.mention_user_id='ou_test';config.ai_enabled=False;db.commit()
            started=asyncio.Event(); release=asyncio.Event()
            async def delivery(*args): started.set(); await release.wait()
            with patch('app.services.daily_brief.deliver',new_callable=AsyncMock,side_effect=delivery) as mocked:
                with self.sessions() as first_db, self.sessions() as second_db:
                    first=asyncio.create_task(send_daily_brief(first_db,date(2026,10,28)))
                    await started.wait()
                    second=await send_daily_brief(second_db,date(2026,10,28))
                    self.assertEqual(second.status,'sending')
                    release.set(); await first
                    self.assertEqual(mocked.await_count,1)
        asyncio.run(check())

    def test_child_activity_and_exclusive_midnight_boundary(self):
        from app.models import Transcript
        with self.sessions() as db:
            db.add(InterviewSession(id='old',created_at=datetime(2026,10,20),updated_at=datetime(2026,10,20)))
            db.add(InterviewSession(id='nextday',created_at=datetime(2026,10,28,16),updated_at=datetime(2026,10,28,16)))
            db.add(Transcript(id=1,session_id='old',speaker='user',text='回答',created_at=datetime(2026,10,28,1)))
            db.commit()
            facts=collect_facts(db,date(2026,10,28),datetime(2026,10,28,16,tzinfo=timezone.utc))
            self.assertEqual(facts['total'],1)
            self.assertEqual(facts['candidates'][0]['evidence'],['回答'])

    def test_scheduler_respects_enabled_and_daily_time(self):
        from app.services.daily_brief import scheduler_loop
        async def one_tick(now):
            with patch('app.services.daily_brief.SessionLocal',self.sessions), patch('app.services.daily_brief.utc_now',return_value=now), patch('app.services.daily_brief.asyncio.sleep',new_callable=AsyncMock,side_effect=asyncio.CancelledError), patch('app.services.daily_brief.send_daily_brief',new_callable=AsyncMock) as send:
                with self.assertRaises(asyncio.CancelledError):
                    await scheduler_loop()
                return send.await_count
        with self.sessions() as db:
            config=get_config(db);config.webhook_url='https://open.feishu.cn/open-apis/bot/v2/hook/test';config.mention_user_id='ou_test';config.enabled=True;db.commit()
        self.assertEqual(asyncio.run(one_tick(datetime(2026,10,28,9,59,tzinfo=timezone.utc))),0)
        self.assertEqual(asyncio.run(one_tick(datetime(2026,10,28,10,0,tzinfo=timezone.utc))),1)
        with self.sessions() as db:
            get_config(db).enabled=False;db.commit()
        self.assertEqual(asyncio.run(one_tick(datetime(2026,10,28,10,0,tzinfo=timezone.utc))),0)
