import { AudioLines, BookOpen, Check, MessageCircle, Sprout } from "lucide-react";
import { getServerI18n } from "@/lib/server-language";

/** An explicitly labelled illustration, not a live student dashboard. */
export async function LearningPreview() {
  const { language } = await getServerI18n();
  const copy = (id: string, en: string) => language === "en" ? en : id;
  return <div className="learning-preview">
    <div className="preview-bar"><span><BookOpen size={18} aria-hidden="true" />{copy("Ruang belajarmu", "Your learning space")}</span><small>{copy("Contoh belajar", "Learning preview")}</small></div>
    <div className="preview-body">
      <div className="preview-subject"><span className="preview-plant"><Sprout size={34} aria-hidden="true" /></span><div><small>{copy("Ilmu Pengetahuan Alam", "Natural sciences")}</small><h3>{copy("Bagaimana tumbuhan tumbuh?", "How do plants grow?")}</h3></div></div>
      <div className="preview-notebook"><span>{copy("Mari kita pahami bersama", "Let’s understand it together")}</span><p>{copy("Air, cahaya matahari, dan udara membantu tumbuhan membuat makanannya sendiri.", "Water, sunlight, and air help plants make their own food.")}</p><div className="preview-audio"><AudioLines size={22} aria-hidden="true" /><span>{copy("Bisa dibaca. Bisa didengarkan.", "Read it. Listen to it.")}</span></div></div>
      <div className="preview-question"><MessageCircle size={18} aria-hidden="true" /><span>{copy("Kalau tidak ada cahaya matahari?", "What if there is no sunlight?")}</span></div>
      <div className="preview-answer"><span className="preview-ai">K</span><div><strong>{copy("Tutor AI", "AI Tutor")}</strong><p>{copy("Yuk, bayangkan tanaman di tempat gelap. Menurutmu, apa yang akan terjadi?", "Imagine a plant in a dark place. What do you think would happen?")}</p></div></div>
      <div className="preview-footer"><Check size={17} aria-hidden="true" />{copy("Belajar pelan-pelan, sampai paham.", "Learn at your pace, until it makes sense.")}</div>
    </div>
  </div>;
}
