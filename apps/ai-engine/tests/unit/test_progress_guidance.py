from database import models
from tests.unit.test_guided_learning import learning_http as learning_http
from tests.unit.test_progress_rollup import prepare_rollup

TEXT = """Pecahan menyatakan bagian dari keseluruhan. Pembilang menunjukkan banyak bagian yang diambil, sedangkan penyebut menunjukkan jumlah bagian sama besar. Dua pecahan senilai dapat dibuat dengan mengalikan pembilang dan penyebut menggunakan bilangan yang sama. Untuk menjumlahkan pecahan dengan penyebut berbeda, tentukan kelipatan persekutuan penyebut terlebih dahulu. Setelah penyebut disamakan, jumlahkan pembilang dan pertahankan penyebutnya. Hasil dapat disederhanakan dengan membagi pembilang dan penyebut oleh faktor persekutuan terbesarnya. Contohnya satu per dua sama nilainya dengan dua per empat."""


async def test_cold_start_unmapped_has_real_targets_without_fake_mastery(
    learning_http, monkeypatch
):
    from analytics.progress_guidance import build_guidance_snapshot, derive_progress_insights

    await prepare_rollup(learning_http, monkeypatch)
    _, factory, controls, material, *_ = learning_http
    async with factory() as db:
        row = await db.get(models.ClassMaterial, material.id)
        row.content = TEXT
        await db.commit()
    async with factory() as db:
        first = await build_guidance_snapshot(
            db, student=controls["actor"], timezone="Asia/Jakarta"
        )
        second = await build_guidance_snapshot(
            db, student=controls["actor"], timezone="Asia/Jakarta"
        )
        assert first.source_snapshot_hash == second.source_snapshot_hash
        assert first.candidates
        assert all(c.material_id == str(material.id) for c in first.candidates)
        assert not any(f.kind == "strong_concept" for f in first.facts)
        assert len(derive_progress_insights(first)) <= 3
        assert any(i.kind == "unmapped" for i in derive_progress_insights(first))


async def test_source_failure_gives_teacher_action_without_blame_or_questions(
    learning_http, monkeypatch
):
    from analytics.progress_guidance import build_guidance_snapshot, derive_progress_insights

    await prepare_rollup(learning_http, monkeypatch)
    _, factory, controls, material, *_ = learning_http
    async with factory() as db:
        row = await db.get(models.ClassMaterial, material.id)
        row.rag_status = "failed"
        await db.commit()
    async with factory() as db:
        snapshot = await build_guidance_snapshot(db, student=controls["actor"], timezone="UTC")
        assert snapshot.candidates == []
        assert any(i.kind == "source_issue" for i in derive_progress_insights(snapshot))


async def test_revoked_material_never_appears_in_candidates_or_facts(learning_http, monkeypatch):
    from analytics.progress_guidance import build_guidance_snapshot

    await prepare_rollup(learning_http, monkeypatch)
    _, factory, controls, material, *_ = learning_http
    async with factory() as db:
        row = await db.get(models.ClassMaterial, material.id)
        row.published = False
        await db.commit()
    async with factory() as db:
        snapshot = await build_guidance_snapshot(db, student=controls["actor"], timezone="UTC")
        assert not snapshot.candidates
        assert not any(str(material.id) in f.fact_id for f in snapshot.facts)
