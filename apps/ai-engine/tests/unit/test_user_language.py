import asyncio
from types import SimpleNamespace

from tools.llm_client import language_instruction


async def test_parallel_students_keep_their_own_language():
    async def prompt(language):
        await asyncio.sleep(0)
        return language_instruction(language)

    indonesian, english = await asyncio.gather(prompt("id"), prompt("en"))
    assert "Bahasa Indonesia" in indonesian
    assert "English" in english
    assert "English" not in indonesian


async def test_tutor_uses_language_from_each_turn_state(monkeypatch):
    from agents import tutoring_agent

    class Tutor:
        async def ainvoke(self, messages):
            await asyncio.sleep(0)
            return SimpleNamespace(
                content="English reply"
                if "in English," in messages[0].content
                else "Jawaban Indonesia"
            )

    monkeypatch.setattr(tutoring_agent, "get_tutor_llm", Tutor)
    answers = await asyncio.gather(
        *(
            tutoring_agent.tutoring_node(
                {"user_input": "Test", "learning_profile": {"language": lang}}
            )
            for lang in ["id", "en"]
        )
    )
    assert [answer["generated_response"] for answer in answers] == [
        "Jawaban Indonesia",
        "English reply",
    ]


async def test_quiz_introduction_transition_and_finish_use_account_language(monkeypatch):
    from agents import quiz_agent

    class QuizLLM:
        async def ainvoke(self, _messages):
            return SimpleNamespace(content="What is two plus two?")

    monkeypatch.setattr(quiz_agent, "get_quiz_llm", QuizLLM)
    questions = [{"question_id": "q1", "text": "2+2", "type": "spoken"}] * 2
    common = {"learning_profile": {"language": "en"}, "quiz_questions": questions}
    first = await quiz_agent.quiz_node({**common, "current_question_index": 0})
    assert "Let's begin" in first["generated_response"]
    following = await quiz_agent.quiz_node(
        {**common, "current_question_index": 1, "generated_response": "Correct."}
    )
    assert following["generated_response"].startswith("Correct. Next question:")
    finished = await quiz_agent.quiz_node({**common, "current_question_index": 2})
    assert "quiz is complete" in finished["generated_response"]


async def test_mini_quiz_framing_uses_account_language():
    from agents import quiz_agent

    answer = await quiz_agent.mini_quiz_node(
        {
            "learning_profile": {"language": "en"},
            "generated_response": "Pecahan adalah bagian dari keseluruhan.",
            "quiz_source_docs": [
                {
                    "chunk_id": "language-fixture-pecahan",
                    "text": "Pecahan adalah bagian dari keseluruhan. Satu per dua ditambah satu per dua adalah satu.",
                    "source": "language-fixture",
                }
            ],
        }
    )
    assert "Quick understanding check:" in answer["generated_response"]


async def test_exact_answer_and_last_attempt_feedback_use_account_language(monkeypatch):
    from agents import scoring_agent

    async def no_persist(*_args):
        pass

    monkeypatch.setattr(scoring_agent, "_persist_progress", no_persist)
    question = {
        "question_id": "q1",
        "text": "2+2",
        "type": "mcq",
        "expected_answer": "A",
        "options": ["A. Four", "B. Five"],
    }
    common = {"learning_profile": {"language": "en"}, "quiz_question": question}
    correct = await scoring_agent.scoring_node({**common, "student_answer": "A"})
    assert correct["generated_response"] == "Correct."
    wrong = await scoring_agent.scoring_node({**common, "student_answer": "B"})
    assert wrong["generated_response"] == "Not quite."
    final = await scoring_agent.scoring_node(
        {
            **common,
            "student_answer": "B",
            "current_question_attempts": scoring_agent.settings.QUIZ_MAX_ATTEMPTS_PER_QUESTION - 1,
        }
    )
    assert final["generated_response"] == "That's okay, let's move on to the next question."
