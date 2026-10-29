import unittest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.db import Base, get_db
from app.core.config import Settings, get_settings
from app.api import auth, model_config, questions, results, positions, sessions, protected_files
from app.services.auth import protect_admin_routes


class LinuxDoAuthTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine)
        self.settings = Settings(_env_file=None, frontend_origin='http://frontend.test',
                                 linuxdo_client_id='test-client', linuxdo_client_secret='test-secret',
                                 linuxdo_redirect_uri='http://testserver/api/auth/linuxdo/callback',
                                 linuxdo_admin_ids='123')
        app = FastAPI(dependencies=[Depends(protect_admin_routes)])
        for router in (auth.router, model_config.router, questions.router, results.router, positions.router, sessions.router, protected_files.router):
            app.include_router(router)
        def database():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_settings] = lambda: self.settings
        self.app = app
        self.client = TestClient(app, follow_redirects=False)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_all_business_endpoints_require_login(self):
        for method, path in [('GET', '/api/admin/model-config'), ('PUT', '/api/admin/model-config'),
                             ('GET', '/api/admin/oral-question-sets'), ('GET', '/api/interview-results'),
                             ('DELETE', '/api/interview-results/example')]:
            response = self.client.request(method, path)
            self.assertEqual(response.status_code, 401, (path, response.text))
        self.assertEqual(self.client.get('/api/positions').status_code, 401)
        self.assertEqual(self.client.get('/api/sessions/example').status_code, 401)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def start_login(self, next_path='/admin/models'):
        from urllib.parse import parse_qs, urlparse
        response = self.client.get('/api/auth/linuxdo/login', params={'next': next_path})
        self.assertEqual(response.status_code, 302, response.text)
        parsed = urlparse(response.headers['location'])
        self.assertEqual(parsed.scheme + '://' + parsed.netloc + parsed.path,
                         'https://connect.linux.do/oauth2/authorize')
        query = parse_qs(parsed.query)
        self.assertEqual(query['client_id'], ['test-client'])
        self.assertEqual(query['redirect_uri'], ['http://testserver/api/auth/linuxdo/callback'])
        self.assertNotIn('test-secret', response.headers['location'])
        return query['state'][0]

    def finish_login(self, state, user=None):
        from unittest.mock import AsyncMock, patch
        import httpx
        user = user or {'id': 123, 'username': 'admin', 'name': '管理员', 'active': True, 'silenced': False}
        with patch('httpx.AsyncClient.post', new_callable=AsyncMock) as post, patch('httpx.AsyncClient.get', new_callable=AsyncMock) as get:
            post.return_value = httpx.Response(200, json={'access_token': 'provider-private-token'},
                                              request=httpx.Request('POST', 'https://connect.linux.do/oauth2/token'))
            get.return_value = httpx.Response(200, json=user,
                                             request=httpx.Request('GET', 'https://connect.linux.do/api/user'))
            response = self.client.get('/api/auth/linuxdo/callback', params={'state': state, 'code': 'valid-code'})
            if post.called:
                self.assertEqual(post.call_args.kwargs['data']['redirect_uri'], self.settings.linuxdo_redirect_uri)
            return response

    def test_login_returns_to_requested_page_and_logout_revokes_session(self):
        state = self.start_login('/admin/models?tab=connection')
        response = self.finish_login(state)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers['location'], 'http://frontend.test/admin/models?tab=connection')
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        self.assertIn('SameSite=lax', response.headers['set-cookie'])
        self.assertNotIn('provider-private-token', str(response.headers))
        self.assertEqual(self.client.get('/api/auth/me').json(), {'id': '123', 'username': 'admin', 'name': '管理员', 'role': 'admin'})
        self.assertEqual(self.client.get('/api/admin/model-config').status_code, 200)
        saved_cookie = self.client.cookies.get('interview_admin_session')
        self.assertEqual(self.client.post('/api/auth/logout', headers={'Origin': 'http://frontend.test'}).status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        self.client.cookies.set('interview_admin_session', saved_cookie)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_connect_failures_retry_but_ambiguous_token_read_failures_do_not(self):
        from unittest.mock import AsyncMock, patch
        import httpx
        for failure, expected_calls in [(httpx.ConnectError('connection failed'), 2),
                                        (httpx.ReadTimeout('response lost'), 1)]:
            with self.subTest(failure=type(failure).__name__):
                state = self.start_login()
                token_response = httpx.Response(200, json={'access_token': 'private-token'},
                    request=httpx.Request('POST', 'https://connect.linux.do/oauth2/token'))
                user_response = httpx.Response(200, json={'id': 123, 'username': 'admin', 'active': True, 'silenced': False},
                    request=httpx.Request('GET', 'https://connect.linux.do/api/user'))
                with patch('httpx.AsyncClient.post', new_callable=AsyncMock) as post, patch('httpx.AsyncClient.get', new_callable=AsyncMock) as get:
                    post.side_effect = [failure, token_response]
                    get.return_value = user_response
                    response = self.client.get('/api/auth/linuxdo/callback', params={'state': state, 'code': 'test-code'})
                self.assertEqual(post.call_count, expected_calls)
                self.assertEqual('error=provider_error' in response.headers['location'], expected_calls == 1)
    def test_state_is_browser_bound_and_one_time(self):
        from unittest.mock import AsyncMock, patch
        state = self.start_login()
        with TestClient(self.app, follow_redirects=False) as other, patch('httpx.AsyncClient.post', new_callable=AsyncMock) as post:
            response = other.get('/api/auth/linuxdo/callback', params={'state': state, 'code': 'stolen-code'})
            self.assertIn('error=invalid_state', response.headers['location'])
            post.assert_not_called()
        self.assertIn('/admin/models', self.finish_login(state).headers['location'])
        with patch('httpx.AsyncClient.post', new_callable=AsyncMock) as post:
            response = self.client.get('/api/auth/linuxdo/callback', params={'state': state, 'code': 'replayed-code'})
            self.assertIn('error=invalid_state', response.headers['location'])
            post.assert_not_called()

    def test_expired_and_denied_authorizations_do_not_create_sessions(self):
        import time
        from unittest.mock import patch
        now = time.time()
        with patch('time.time', return_value=now):
            state = self.start_login()
        with patch('time.time', return_value=now + 601):
            response = self.client.get('/api/auth/linuxdo/callback', params={'state': state, 'code': 'expired'})
        self.assertIn('error=invalid_state', response.headers['location'])
        state = self.start_login()
        response = self.client.get('/api/auth/linuxdo/callback', params={'state': state, 'error': 'access_denied'})
        self.assertIn('error=access_denied', response.headers['location'])
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_inactive_or_silenced_users_cannot_login(self):
        for changes, reason in [({'active': False}, 'account_unavailable'),
                                ({'silenced': True}, 'account_unavailable'), ({'active': None}, 'account_unavailable')]:
            user = {'id': 123, 'username': 'admin', 'active': True, 'silenced': False, **changes}
            state = self.start_login()
            response = self.finish_login(state, user)
            self.assertIn('error=' + reason, response.headers['location'])
            self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_session_expiry_and_admin_removal_take_effect(self):
        import time
        from unittest.mock import patch
        now = time.time()
        with patch('time.time', return_value=now):
            self.finish_login(self.start_login())
        with patch('time.time', return_value=now + 12 * 3600 + 1):
            self.assertEqual(self.client.get('/api/admin/model-config').status_code, 401)
        self.settings.linuxdo_admin_ids = '999'
        self.assertEqual(self.client.get('/api/auth/me').json()['role'], 'candidate')
        self.assertEqual(self.client.get('/api/admin/model-config').status_code, 403)

    def test_authenticated_writes_and_logout_reject_foreign_or_missing_origin(self):
        self.finish_login(self.start_login())
        for headers in ({}, {'Origin': 'http://attacker.test'}, {'Origin': 'null'}):
            self.assertEqual(self.client.post('/api/auth/logout', headers=headers).status_code, 403)
            self.assertEqual(self.client.put('/api/admin/model-config', json={}, headers=headers).status_code, 403)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 200)
        response = self.client.put('/api/admin/model-config', json={'provider': 'deepseek', 'model': 'deepseek-flash'},
                                   headers={'Origin': 'http://frontend.test'})
        self.assertEqual(response.status_code, 200, response.text)

    def test_return_targets_are_restricted_to_local_admin_pages(self):
        for target in ['https://attacker.test', '//attacker.test/admin', '/admin/../../evil', '/admin%2f..%2f',
                       '/\\attacker.test', '/unknown-page', '/admin\r\nLocation: https://attacker.test']:
            state = self.start_login(target)
            response = self.finish_login(state)
            self.assertEqual(response.headers['location'], 'http://frontend.test/admin', target)

    def test_unconfigured_login_fails_closed(self):
        self.settings.linuxdo_client_secret = ''
        self.assertFalse(self.client.get('/api/auth/config').json()['configured'])
        response = self.client.get('/api/auth/linuxdo/login')
        self.assertIn('error=not_configured', response.headers['location'])
        self.assertEqual(self.client.get('/api/admin/model-config').status_code, 401)
        self.settings.linuxdo_client_secret = 'test-secret'
        self.settings.linuxdo_admin_ids = ''
        self.assertTrue(self.client.get('/api/auth/config').json()['configured'])

    def test_provider_failure_does_not_leak_credentials_or_allow_callback_retry(self):
        from unittest.mock import AsyncMock, patch
        import httpx
        for payload in ({}, {'access_token': ''}, ['bad-response']):
            state = self.start_login()
            with patch('httpx.AsyncClient.post', new_callable=AsyncMock) as post:
                post.return_value = httpx.Response(200, json=payload, request=httpx.Request('POST', 'https://connect.linux.do/oauth2/token'))
                response = self.client.get('/api/auth/linuxdo/callback', params={'state': state, 'code': 'sensitive-code'})
            self.assertIn('error=provider_error', response.headers['location'])
            self.assertNotIn('sensitive-code', str(response.headers))
            self.assertNotIn('test-secret', str(response.headers))
            self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    def test_production_requires_https_and_issues_secure_cookie(self):
        self.settings.environment = 'production'
        self.assertFalse(self.client.get('/api/auth/config').json()['configured'])
        self.settings.frontend_origin = 'https://interview.example.com'
        self.settings.linuxdo_redirect_uri = 'https://interview.example.com/api/auth/linuxdo/callback'
        self.assertTrue(self.client.get('/api/auth/config').json()['configured'])
        response = self.client.get('/api/auth/linuxdo/login')
        self.assertIn('Secure', response.headers['set-cookie'])
        self.assertIn('no-store', response.headers['cache-control'])

    def test_candidates_can_only_access_their_own_interviews(self):
        candidate = {'id': 456, 'username': 'candidate', 'active': True, 'silenced': False}
        self.finish_login(self.start_login('/interview/basic'), candidate)
        self.assertEqual(self.client.get('/api/auth/me').json()['role'], 'candidate')
        self.assertEqual(self.client.get('/api/admin/model-config').status_code, 403)
        response = self.client.post('/api/sessions', json={'session_id': 'candidate-owned', 'candidate_profile': {'name': 'Candidate'}},
                                    headers={'Origin': 'http://frontend.test'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get('/api/sessions/candidate-owned').status_code, 200)
        self.finish_login(self.start_login('/interview/basic'), {**candidate, 'id': 789})
        self.assertEqual(self.client.get('/api/sessions/candidate-owned').status_code, 403)
        response = self.client.post('/api/sessions', json={'session_id': 'candidate-owned'}, headers={'Origin': 'http://frontend.test'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get('/api/sessions/candidate-owned/oral-question-set').status_code, 403)
        self.finish_login(self.start_login())
        self.assertEqual(self.client.get('/api/sessions/candidate-owned').status_code, 200)

    def test_uploads_and_mobile_page_require_identity_and_ownership(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        with TemporaryDirectory() as directory:
            self.settings.uploads_dir = Path(directory)
            (Path(directory) / 'owned').mkdir()
            (Path(directory) / 'owned' / 'resume.txt').write_text('private resume')
            (Path(directory) / 'oral-questions').mkdir()
            (Path(directory) / 'oral-questions' / 'diagram.png').write_bytes(b'image-fixture')
            self.assertEqual(self.client.get('/uploads/owned/resume.txt').status_code, 401)
            mobile = self.client.get('/m/upload?sessionId=owned')
            self.assertEqual(mobile.status_code, 307)
            self.assertIn('/login?', mobile.headers['location'])
            candidate = {'id': 456, 'username': 'candidate', 'active': True, 'silenced': False}
            self.finish_login(self.start_login('/interview/basic'), candidate)
            created = self.client.post('/api/sessions', json={'session_id': 'owned'}, headers={'Origin': 'http://frontend.test'})
            self.assertEqual(created.status_code, 200, created.text)
            self.assertEqual(self.client.get('/uploads/owned/resume.txt').text, 'private resume')
            self.assertEqual(self.client.get('/m/upload?sessionId=owned').status_code, 200)
            self.assertEqual(self.client.get('/uploads/oral-questions/diagram.png').status_code, 200)
            self.finish_login(self.start_login('/interview/basic'), {**candidate, 'id': 789})
            self.assertEqual(self.client.get('/uploads/owned/resume.txt').status_code, 403)
            self.assertEqual(self.client.get('/m/upload?sessionId=owned').status_code, 403)
            self.assertEqual(self.client.get('/uploads/oral-questions/%2e%2e/owned/resume.txt').status_code, 403)

    def test_legacy_interviews_are_admin_only_and_mobile_callback_returns_to_backend(self):
        from app.models import InterviewSession
        with self.sessions() as db:
            db.add(InterviewSession(id='legacy'))
            db.commit()
        candidate = {'id': 456, 'username': 'candidate', 'active': True, 'silenced': False}
        response = self.finish_login(self.start_login('/m/upload?sessionId=legacy'), candidate)
        self.assertEqual(response.headers['location'], 'http://testserver/m/upload?sessionId=legacy')
        self.assertEqual(self.client.get('/api/sessions/legacy').status_code, 403)
        self.finish_login(self.start_login())
        self.assertEqual(self.client.get('/api/sessions/legacy').status_code, 200)

    def test_session_identifiers_cannot_escape_storage_or_inject_mobile_html(self):
        self.finish_login(self.start_login())
        for identifier in ['../outside', 'oral-questions', '</script><script>alert(1)</script>']:
            response = self.client.post('/api/sessions', json={'session_id': identifier}, headers={'Origin': 'http://frontend.test'})
            self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get('/m/upload', params={'sessionId': '</script><script>alert(1)</script>'}).status_code, 422)
