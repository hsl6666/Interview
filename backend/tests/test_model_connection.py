import unittest
from unittest.mock import AsyncMock, patch
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.db import Base, get_db
from app.api.model_config import router


class ModelConnectionTests(unittest.TestCase):
    def setUp(self):
        self.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        sessions=sessionmaker(self.engine)
        app=FastAPI();app.include_router(router)
        def database():
            with sessions() as db: yield db
        app.dependency_overrides[get_db]=database
        self.client=TestClient(app)
        self.client.put('/api/admin/model-config',json={'provider':'deepseek','model':'deepseek-flash','api_base_url':'https://api.deepseek.com','api_key':'private-test-key','enabled':True})

    def tearDown(self):
        self.client.close();self.engine.dispose()

    def test_connection_uses_saved_model_without_changing_configuration(self):
        before=self.client.get('/api/admin/model-config').json()
        with patch('httpx.AsyncClient.post',new_callable=AsyncMock) as request:
            request.return_value=httpx.Response(200,json={'choices':[{'message':{'content':'连接成功'}}]},request=httpx.Request('POST','https://api.deepseek.com/chat/completions'))
            response=self.client.post('/api/admin/model-config/test')
        self.assertEqual(response.status_code,200,response.text)
        data=response.json()
        self.assertTrue(data['success']);self.assertEqual(data['model'],'deepseek-flash')
        self.assertGreaterEqual(data['latency_ms'],0)
        self.assertNotIn('private-test-key',response.text)
        self.assertEqual(request.call_args.kwargs['json']['model'],'deepseek-flash')
        self.assertEqual(request.call_args.kwargs['headers']['Authorization'],'Bearer private-test-key')
        self.assertEqual(self.client.get('/api/admin/model-config').json(),before)

    def test_errors_are_actionable_without_exposing_provider_response(self):
        for status,code in [(401,'authentication'),(402,'balance'),(404,'model_or_endpoint'),(429,'rate_limit'),(503,'provider_unavailable')]:
            with self.subTest(status=status), patch('httpx.AsyncClient.post',new_callable=AsyncMock) as request:
                request.return_value=httpx.Response(status,json={'error':{'message':'private-test-key sensitive provider details'}},request=httpx.Request('POST','https://api.deepseek.com/chat/completions'))
                response=self.client.post('/api/admin/model-config/test')
                self.assertEqual(response.status_code,200,response.text)
                self.assertFalse(response.json()['success'])
                self.assertEqual(response.json()['code'],code)
                self.assertNotIn('private-test-key',response.text)
                self.assertNotIn('sensitive provider details',response.text)

    def test_disabled_missing_key_timeout_and_empty_response(self):
        with patch('httpx.AsyncClient.post',new_callable=AsyncMock) as request:
            self.client.put('/api/admin/model-config',json={'provider':'deepseek','model':'deepseek-flash','enabled':False})
            self.assertEqual(self.client.post('/api/admin/model-config/test').json()['code'],'configuration')
            request.assert_not_called()
            self.client.put('/api/admin/model-config',json={'provider':'deepseek','model':'deepseek-flash','enabled':True,'clear_api_key':True})
            self.assertEqual(self.client.post('/api/admin/model-config/test').json()['code'],'configuration')
            request.assert_not_called()
            self.client.put('/api/admin/model-config',json={'provider':'deepseek','model':'deepseek-flash','enabled':True,'api_key':'private-test-key'})
            request.side_effect=httpx.ReadTimeout('private-test-key')
            result=self.client.post('/api/admin/model-config/test').json()
            self.assertEqual(result['code'],'timeout')
            self.assertNotIn('private-test-key',str(result))
            request.side_effect=None
            for content in [None,'', '   ']:
                request.return_value=httpx.Response(200,json={'choices':[{'message':{'content':content}}]},request=httpx.Request('POST','https://api.deepseek.com/chat/completions'))
                self.assertFalse(self.client.post('/api/admin/model-config/test').json()['success'])
