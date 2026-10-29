import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.questions import router
from app.api.sessions import router as sessions_router
from app.db import Base, get_db
from app.models import InterviewSession, OralQuestion, OralRecording
from app.services.oral_question_sets import migrate_oral_question_sets


class OralQuestionSetsTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, autoflush=False)
        app = FastAPI()
        app.include_router(router)
        app.include_router(sessions_router)

        def database():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = database
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def create_set(self, name, **extra):
        response = self.client.post("/api/admin/oral-question-sets", json={"name": name, **extra})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def create_question(self, set_id, title, **extra):
        response = self.client.post("/api/admin/oral-questions", json={
            "set_id": set_id, "title": title, "prompt": title + "的题干", **extra,
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_combine_in_chosen_order_with_independent_copies(self):
        a = self.create_set("A 套")
        b = self.create_set("B 套")
        first = self.create_question(a["id"], "A 原题", published=True)
        second = self.create_question(b["id"], "B 原题", published=False)
        combined = self.create_set("C 套", question_ids=[second["id"], first["id"]])
        copies = self.client.get("/api/admin/oral-questions", params={"set_id": combined["id"]}).json()
        self.assertEqual([q["title"] for q in copies], ["B 原题", "A 原题"])
        self.assertEqual([q["sort_order"] for q in copies], [0, 1])
        self.assertEqual([q["published"] for q in copies], [False, True])
        self.assertNotIn(copies[0]["id"], [first["id"], second["id"]])
        changed = self.client.patch(f'/api/admin/oral-questions/{copies[0]["id"]}', json={"prompt": "C 套专用题干"})
        self.assertEqual(changed.status_code, 200)
        originals = self.client.get("/api/admin/oral-questions", params={"set_id": b["id"]}).json()
        self.assertEqual(originals[0]["prompt"], "B 原题的题干")
        self.client.delete(f'/api/admin/oral-questions/{first["id"]}')
        retained = self.client.get("/api/admin/oral-questions", params={"set_id": combined["id"]}).json()
        self.assertEqual(len(retained), 2)
        self.assertEqual(retained[1]["prompt"], "A 原题的题干")
        for ids in ([second["id"], "missing"], [second["id"], second["id"]]):
            response = self.client.post("/api/admin/oral-question-sets", json={"name": "无效套题", "question_ids": ids})
            self.assertIn(response.status_code, (404, 422))
        self.assertNotIn("无效套题", [s["name"] for s in self.client.get("/api/admin/oral-question-sets").json()])

    def test_create_sets_and_manage_questions_inside_one_set(self):
        a = self.create_set("A 套")
        b = self.create_set("B 套")
        self.create_question(a["id"], "A 题")
        self.create_question(b["id"], "B 题")
        rows = self.client.get("/api/admin/oral-questions", params={"set_id": a["id"]}).json()
        self.assertEqual([q["title"] for q in rows], ["A 题"])
        sets = self.client.get("/api/admin/oral-question-sets").json()
        self.assertEqual(next(s["question_count"] for s in sets if s["id"] == a["id"]), 1)
        self.assertFalse(a["published"])
        invalid = self.client.post("/api/admin/oral-questions", json={
            "set_id": "missing", "title": "不能落入不存在的套题", "prompt": "题干",
        })
        self.assertEqual(invalid.status_code, 404)

    def test_activate_whole_set_and_protect_current_paper(self):
        a = self.create_set("A 套")
        b = self.create_set("空 B 套")
        first = self.create_question(a["id"], "后问", sort_order=9, published=True, role_tags="前端")
        self.create_question(a["id"], "先问", sort_order=2, published=True, role_tags="后端")
        self.create_question(a["id"], "草稿不出题")
        url = f'/api/admin/oral-question-sets/{a["id"]}'
        self.assertEqual(self.client.post(url + "/activate").status_code, 400)
        self.assertEqual(self.client.patch(url, json={"published": True}).status_code, 200)
        self.assertEqual(self.client.post(url + "/activate").status_code, 200)
        candidates = self.client.get("/api/oral-questions", params={"role": "前端"}).json()
        self.assertEqual([q["title"] for q in candidates], ["先问", "后问"])
        self.assertEqual(self.client.delete(url).status_code, 409)
        self.assertEqual(self.client.patch(url, json={"published": False}).status_code, 409)
        self.assertEqual(self.client.post(f'/api/admin/oral-question-sets/{b["id"]}/activate').status_code, 400)
        self.assertEqual(self.client.patch(f'/api/admin/oral-question-sets/{b["id"]}', json={"published": True}).status_code, 400)
        self.assertEqual(self.client.delete(f'/api/admin/oral-questions/{first["id"]}').status_code, 200)
        remaining = self.client.get("/api/oral-questions").json()[0]
        last_url = f'/api/admin/oral-questions/{remaining["id"]}'
        self.assertEqual(self.client.delete(last_url).status_code, 409)
        self.assertEqual(self.client.patch(last_url, json={"published": False}).status_code, 409)
        renamed = self.client.patch(url, json={"name": "重命名 A 套", "description": "说明"})
        self.assertEqual(renamed.json()["name"], "重命名 A 套")
        self.assertEqual(self.client.delete(f'/api/admin/oral-question-sets/{b["id"]}').status_code, 200)

    def test_reject_blank_names_and_invalid_question_edits(self):
        self.assertEqual(self.client.post("/api/admin/oral-question-sets", json={"name": "   "}).status_code, 422)
        paper = self.create_set("有效套题")
        question = self.create_question(paper["id"], "有效题目")
        for change in ({"title": "   "}, {"prompt": None}, {"sort_order": -1}, {"set_id": "missing"}):
            response = self.client.patch(f'/api/admin/oral-questions/{question["id"]}', json=change)
            self.assertEqual(response.status_code, 422, response.text)

    def test_started_session_keeps_its_paper_after_switch_edit_and_delete(self):
        a = self.create_set("A 套")
        first = self.create_question(a["id"], "A 题", published=True)
        a_url = f'/api/admin/oral-question-sets/{a["id"]}'
        self.client.patch(a_url, json={"published": True})
        self.client.post(a_url + "/activate")
        for session_id in ("started", "new"):
            response = self.client.post("/api/sessions", json={"session_id": session_id})
            self.assertEqual(response.status_code, 200, response.text)
        initial = self.client.get("/api/sessions/started/oral-question-set")
        self.assertEqual(initial.status_code, 200, initial.text)
        self.assertEqual(initial.json()["set_name"], "A 套")
        b = self.create_set("B 套")
        self.create_question(b["id"], "B 题", published=True)
        b_url = f'/api/admin/oral-question-sets/{b["id"]}'
        self.client.patch(b_url, json={"published": True})
        self.client.post(b_url + "/activate")
        self.client.patch(f'/api/admin/oral-questions/{first["id"]}', json={"prompt": "已修改"})
        self.assertEqual(self.client.delete(a_url).status_code, 200)
        self.assertEqual(self.client.get("/api/sessions/started/oral-question-set").json(), initial.json())
        new_paper = self.client.get("/api/sessions/new/oral-question-set").json()
        self.assertEqual(new_paper["set_name"], "B 套")
        self.assertEqual([q["prompt"] for q in new_paper["questions"]], ["B 题的题干"])
        self.assertEqual(self.client.get("/api/sessions/missing/oral-question-set").status_code, 404)

    def test_no_published_paper_does_not_fall_back_to_unrelated_questions(self):
        with self.sessions() as db:
            db.add(OralQuestion(id="old-draft", title="未发布旧题", prompt="题干", published=False))
            db.commit()
        papers = self.client.get("/api/admin/oral-question-sets").json()
        self.assertFalse(papers[0]["is_active"])
        self.assertEqual(self.client.get("/api/oral-questions").json(), [])
        self.client.post("/api/sessions", json={"session_id": "waiting"})
        response = self.client.get("/api/sessions/waiting/oral-question-set")
        self.assertEqual(response.status_code, 409)
        self.assertIn("暂无可用口试套题", response.json()["detail"])
        question = self.create_question(papers[0]["id"], "准备完成的题目", published=True)
        url = f'/api/admin/oral-question-sets/{papers[0]["id"]}'
        self.client.patch(url, json={"published": True})
        self.client.post(url + "/activate")
        self.assertEqual(self.client.get("/api/sessions/waiting/oral-question-set").json()["questions"][0]["id"], question["id"])

    def test_legacy_migration_preserves_questions_and_started_interviews_once(self):
        # Fixture uses the previous schema, before a set_id column existed.
        OralQuestion.__table__.drop(self.engine)
        with self.engine.begin() as connection:
            connection.execute(text('''CREATE TABLE oral_questions (
                id VARCHAR(64) PRIMARY KEY, title VARCHAR(200), prompt TEXT, role_tags VARCHAR(400),
                difficulty VARCHAR(40), source VARCHAR(40), sort_order INTEGER, published BOOLEAN,
                created_at DATETIME, updated_at DATETIME
            )'''))
            connection.execute(text('''INSERT INTO oral_questions VALUES
                ('legacy-front', '旧前端题', '旧前端题干', '前端', 'medium', 'manual', 8, 1, '2026-10-01', '2026-10-01'),
                ('legacy-back', '旧后端题', '旧后端题干', '后端', 'hard', 'manual', 2, 1, '2026-10-01', '2026-10-01'),
                ('legacy-draft', '旧草稿', '草稿题干', '通用', 'easy', 'manual', 0, 0, '2026-10-01', '2026-10-01')
            '''))
        with self.sessions() as db:
            db.add(InterviewSession(id="legacy-session", role="前端", status="oral_started"))
            db.flush()
            db.add(OralRecording(
                id="legacy-audio", session_id="legacy-session", question_index=0, question_text="当时实际作答的旧题干",
                filename="test.webm", audio_data=b"test", file_path="", url="",
            ))
            db.commit()
        migrate_oral_question_sets(self.engine)
        migrate_oral_question_sets(self.engine)
        papers = self.client.get("/api/admin/oral-question-sets").json()
        self.assertEqual(len(papers), 1)
        self.assertEqual(papers[0]["name"], "默认套题")
        self.assertEqual(papers[0]["question_count"], 3)
        originals = self.client.get("/api/admin/oral-questions").json()
        self.assertEqual([q["id"] for q in originals], ["legacy-draft", "legacy-back", "legacy-front"])
        self.assertEqual([q["published"] for q in originals], [False, True, True])
        replacement = self.create_set("替换套")
        self.create_question(replacement["id"], "新题", published=True)
        url = f'/api/admin/oral-question-sets/{replacement["id"]}'
        self.client.patch(url, json={"published": True})
        self.client.post(url + "/activate")
        self.client.delete(f'/api/admin/oral-question-sets/{papers[0]["id"]}')
        migrate_oral_question_sets(self.engine)
        self.assertEqual([s["name"] for s in self.client.get("/api/admin/oral-question-sets").json()], ["替换套"])
        historic = self.client.get("/api/sessions/legacy-session/oral-question-set").json()
        self.assertEqual([q["prompt"] for q in historic["questions"]], ["当时实际作答的旧题干"])


if __name__ == "__main__":
    unittest.main()
