import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.sessions import router
from app.db import Base, get_db


class CandidateProfileTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        sessions = sessionmaker(self.engine, autoflush=False)
        app = FastAPI()
        app.include_router(router)

        def database():
            with sessions() as db:
                yield db

        app.dependency_overrides[get_db] = database
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_registration_answers_survive_creation_update_and_readback(self):
        answers = {
            "previous_leave_reason": "原公司业务调整，希望寻找新的发展机会。",
            "career_plan": "未来三年深耕技术，逐步承担项目负责人职责。",
            "self_evaluation": "善于协作，能够独立分析和解决问题。",
        }
        response = self.client.post("/api/sessions", json={
            "session_id": "registration-answers", "candidate_profile": answers,
        })
        self.assertEqual(response.status_code, 200, response.text)
        saved = self.client.get("/api/sessions/registration-answers")
        self.assertEqual(saved.status_code, 200, saved.text)
        for field, answer in answers.items():
            self.assertEqual(saved.json()["candidate_profile"].get(field), answer)

        answers["previous_leave_reason"] = "希望拓展专业领域。"
        answers["career_plan"] = "持续提升专业能力。"
        answers["self_evaluation"] = "认真负责，乐于学习。"
        response = self.client.patch("/api/sessions/registration-answers", json={
            "candidate_profile": answers,
        })
        self.assertEqual(response.status_code, 200, response.text)
        saved = self.client.get("/api/sessions/registration-answers")
        self.assertEqual(saved.status_code, 200, saved.text)
        for field, answer in answers.items():
            self.assertEqual(saved.json()["candidate_profile"].get(field), answer)
