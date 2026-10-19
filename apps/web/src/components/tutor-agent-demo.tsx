"use client";

import { useState, useEffect, useRef, useId, useSyncExternalStore } from "react";
import { Sparkles, Brain, Volume2, ArrowRight, Check, Pause, Play, Leaf, Utensils, Zap, Droplets, Lightbulb } from "lucide-react";
import { speechOutput } from "@/lib/browser-speech";
import { useVoicePreferences } from "./voice-preferences-provider";
import { useI18n } from "./language-provider";

interface PromptScenario {
  id: string;
  topic: string;
  topicEn: string;
  question: string;
  questionEn: string;
  thoughts: { id: string; en: string }[];
  answer: string;
  answerEn: string;
}

const SCENARIOS: PromptScenario[] = [
  {
    id: "plants",
    topic: "IPA • Fotosintesis",
    topicEn: "Science • Photosynthesis",
    question: "Bagaimana tumbuhan membuat makanan jika tidak bisa melihat matahari?",
    questionEn: "How do plants make food without eyes to see the sun?",
    thoughts: [
      { id: "Menganalisis konsep fotosintesis untuk siswa tunanetra...", en: "Analyzing photosynthesis concept for visually impaired learners..." },
      { id: "Menyiapkan analogi indra peraba: panas matahari dan daun seperti panel...", en: "Preparing tactile analogy: warmth of sunlight and leaves as panels..." },
      { id: "Menyusun penjelasan langkah demi langkah yang ramah audio...", en: "Formulating audio-friendly step-by-step explanation..." }
    ],
    answer: "Bayangkan daun seperti tangan terbuka yang hangat. Saat matahari menyinari daun, daun menyerap rasa hangat itu, lalu mencampurnya dengan air dari akar untuk memasak makanan manis bagi seluruh tanaman!",
    answerEn: "Imagine leaves as warm, open hands. When the sun shines on them, they absorb that soothing warmth and blend it with water from the roots to cook sweet food for the entire plant!"
  },
  {
    id: "kitchen",
    topic: "Analogi Dapur",
    topicEn: "Kitchen Analogy",
    question: "Jelaskan konsep fotosintesis dengan analogi dapur!",
    questionEn: "Explain photosynthesis using a kitchen analogy!",
    thoughts: [
      { id: "Mencari padanan komponen sel tumbuhan dengan peralatan dapur...", en: "Matching plant cell components to kitchen tools..." },
      { id: "Klorofil = kompor, Air = bumbu dasar, Matahari = nyala api...", en: "Chlorophyll = stove, Water = base soup, Sunlight = heating flame..." },
      { id: "Merangkai narasi audio yang mudah dibayangkan secara sensorik...", en: "Crafting a sensory audio narrative that is effortless to picture..." }
    ],
    answer: "Tepat sekali! Daun adalah restorannya, klorofil adalah kompornya, air dan udara adalah bahannya, serta matahari adalah energi nyala apinya. Semuanya diolah menjadi glukosa lezat untuk energi tumbuh!",
    answerEn: "Exactly! The leaf is the kitchen, chlorophyll is the stove, water and air are the fresh ingredients, and sunlight is the flame. Together they whip up sweet glucose energy!"
  },
  {
    id: "quiz",
    topic: "Kuis Singkat",
    topicEn: "Quick Quiz",
    question: "Beri saya satu latihan soal singkat tentang klorofil!",
    questionEn: "Give me a quick practice question about chlorophyll!",
    thoughts: [
      { id: "Mengakses bank materi kuis kurikulum merdeka...", en: "Accessing curriculum quiz question bank..." },
      { id: "Menyesuaikan format pilihan ganda dengan navigasi keyboard...", en: "Adapting multiple choice format for keyboard navigation..." },
      { id: "Menyiapkan kunci jawaban dan pembahasan langsung...", en: "Preparing answer key and immediate feedback..." }
    ],
    answer: "Tentu! Pertanyaan: Apa peran utama pigmen klorofil pada daun hijau? A) Menyerap cahaya matahari, atau B) Menghirup air dari tanah? Coba sebutkan pilihanmu!",
    answerEn: "Here you go! Question: What is the primary role of chlorophyll in green leaves? A) Absorbing sunlight, or B) Drawing water from soil? Which one do you pick?"
  },
  {
    id: "watercycle",
    topic: "IPA • Siklus Air",
    topicEn: "Science • Water Cycle",
    question: "Bagaimana air laut bisa berubah jadi air hujan di gunung?",
    questionEn: "How does seawater turn into rain in the mountains?",
    thoughts: [
      { id: "Menganalisis siklus hidrologi dengan tahapan sederhana...", en: "Analyzing hydrological cycle with step-by-step stages..." },
      { id: "Membayangkan air menguap seperti uap teh hangat yang naik...", en: "Imagining evaporation like rising warm steam from hot tea..." },
      { id: "Menyusun penjelasan kondensasi dan presipitasi ramah audio...", en: "Structuring audio-friendly condensation and precipitation explanation..." }
    ],
    answer: "Bayangkan secangkir teh hangat yang mengeluarkan uap ke atas. Matahari menghangatkan air laut hingga naik menjadi awan sejuk di langit. Ketika awan itu terbawa angin ke gunung dan mendingin, butir-butir airnya turun kembali sebagai tetesan hujan yang segar!",
    answerEn: "Imagine a warm cup of tea with steam gently rising up. The sun warms the sea until it drifts upward into cool clouds. When wind guides the clouds to high mountains and they cool down, droplets fall back down as fresh raindrops!"
  }
];

export function TutorAgentDemo() {
  const { language, t } = useI18n();
  const { engine } = useVoicePreferences();
  const voiceOwner = useId();
  const output = useSyncExternalStore(speechOutput.subscribe, speechOutput.getState, speechOutput.getState);
  const audioStatus = output.owner === voiceOwner ? output.status : "idle";
  const [activeIdx, setActiveIdx] = useState(0);
  const [phase, setPhase] = useState<"question" | "thinking" | "answering" | "ready">("ready");
  const [thoughtIdx, setThoughtIdx] = useState(0);
  const [streamedText, setStreamedText] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [activeQuestion, setActiveQuestion] = useState("");
  const isEn = language === "en";
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const scenario = SCENARIOS[activeIdx];
  const question = activeQuestion || (isEn ? scenario.questionEn : scenario.question);
  const thoughts = scenario.thoughts.map(th => isEn ? th.en : th.id);
  const fullAnswer = isEn ? scenario.answerEn : scenario.answer;
  const topic = isEn ? scenario.topicEn : scenario.topic;

  const runSequence = (idx: number, customQ?: string) => {
    speechOutput.stop(voiceOwner);
    if (timerRef.current) clearTimeout(timerRef.current);
    setActiveIdx(idx);
    if (customQ) {
      setActiveQuestion(customQ);
    } else {
      setActiveQuestion(isEn ? SCENARIOS[idx].questionEn : SCENARIOS[idx].question);
    }
    setPhase("thinking");
    setThoughtIdx(0);
    setStreamedText("");

    // Step 1: Thinking transitions
    timerRef.current = setTimeout(() => {
      setThoughtIdx(1);
      timerRef.current = setTimeout(() => {
        setThoughtIdx(2);
        timerRef.current = setTimeout(() => {
          // Step 2: Transition to answering
          setPhase("answering");
          const targetAnswer = isEn ? SCENARIOS[idx].answerEn : SCENARIOS[idx].answer;
          let charIndex = 0;
          const interval = setInterval(() => {
            charIndex += 4;
            if (charIndex >= targetAnswer.length) {
              setStreamedText(targetAnswer);
              setPhase("ready");
              clearInterval(interval);
            } else {
              setStreamedText(targetAnswer.slice(0, charIndex));
            }
          }, 20);
        }, 500);
      }, 500);
    }, 500);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    const lower = customInput.toLowerCase();
    let matchedIdx = 0;
    if (lower.includes("dapur") || lower.includes("kitchen") || lower.includes("analogi")) {
      matchedIdx = 1;
    } else if (lower.includes("kuis") || lower.includes("quiz") || lower.includes("soal")) {
      matchedIdx = 2;
    } else if (lower.includes("hujan") || lower.includes("air") || lower.includes("water") || lower.includes("laut")) {
      matchedIdx = 3;
    }
    runSequence(matchedIdx, customInput);
  };

  const displayedText = phase === "answering" ? streamedText : fullAnswer;
  const playAnswer = () => {
    if (audioStatus === "playing" || audioStatus === "paused") {
      void speechOutput.togglePause(voiceOwner);
      return;
    }
    void speechOutput.play({
      owner: voiceOwner,
      text: fullAnswer,
      engine: engine === "device" ? "device" : "app",
      language,
      menuKey: `demo-answer-${scenario.id}`,
    });
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      speechOutput.stop(voiceOwner);
    };
  }, [voiceOwner]);

  return (
    <div className="tutor-agent-showcase" aria-label={t("Simulasi Tutor AI")}>
      {/* Background Holographic Stage Glow */}
      <div className="tutor-holo-stage" aria-hidden="true">
        <div className="tutor-stage-radial-glow" />
      </div>

      {/* Main Glassmorphic AI Tutor Card */}
      <div className="tutor-agent-card">
        {/* Card Header: Agent Identity & Live Audio Indicator */}
        <div className="tutor-card-header">
          <div className="tutor-agent-identity">
            <div className="tutor-avatar-sparkle">
              <Sparkles size={18} className="tutor-sparkle-icon" />
              <span className="tutor-pulse-beacon" />
            </div>
            <div>
              <div className="tutor-name-row">
                <span className="tutor-name">Tutor AI Agent</span>
                {phase === "thinking" && (
                  <span className="tutor-pill-live">
                    <span className="live-dot" />
                    <span>{t("Sedang Berpikir...")}</span>
                  </span>
                )}
              </div>
              <span className="tutor-sublabel">{topic}</span>
            </div>
          </div>

          <div className="tutor-sound-indicator" title={t("Audio visualizer")}>
            <Volume2 size={16} className="tutor-volume-icon" />
            <div className={`tutor-soundwave-bars ${audioStatus === "playing" ? "playing" : ""}`}>
              <span className="sw-bar" />
              <span className="sw-bar" />
              <span className="sw-bar" />
              <span className="sw-bar" />
            </div>
          </div>
        </div>

        {/* Interactive Query Input Bar: Let user type what they want to study */}
        <form className="tutor-input-bar" onSubmit={handleCustomSubmit}>
          <input
            type="text"
            className="tutor-text-input"
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            placeholder={t("Ingin belajar apa? Misal: Kenapa daun berwarna hijau?")}
            aria-label={t("Ketik pertanyaan materi pelajaran")}
            data-voice-menu="demo-input"
          />
          <button
            type="submit"
            className="tutor-submit-btn"
            disabled={phase === "thinking" || !customInput.trim()}
            aria-label={t("Tanyakan ke Tutor AI")}
            data-voice-menu="demo-ask"
          >
            <span>{t("Tanyakan")}</span>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </form>

        {/* Question Area */}
        <div className="tutor-dialog-question">
          <div className="tutor-user-tag">
            <span>{t("Pertanyaan Siswa")}</span>
          </div>
          <p className="tutor-question-text">&ldquo;{question}&rdquo;</p>
        </div>

        {/* Agent Thinking State Box */}
        {phase === "thinking" && (
          <div className="tutor-thinking-box" role="status" aria-live="polite">
            <div className="tutor-thinking-header">
              <Brain size={17} className="tutor-thinking-icon spin-pulse" />
              <span className="tutor-thinking-title">{t("Tutor AI sedang menganalisis...")}</span>
            </div>
            <div className="tutor-thinking-stream">
              <span className="tutor-thought-item active">
                {thoughts[thoughtIdx]}
              </span>
            </div>
            <div className="tutor-thinking-progress">
              <div
                className="tutor-progress-bar"
                style={{ width: `${((thoughtIdx + 1) / 3) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Agent Response Box */}
        {(phase === "answering" || phase === "ready") && (
          <div className="tutor-response-box">
            <div className="tutor-response-header">
              <div className="tutor-response-badge">
                <Check size={14} strokeWidth={2.5} />
                <span>{t("Penjelasan Langkah Demi Langkah")}</span>
              </div>
              <button
                type="button"
                className="tutor-replay-btn"
                onClick={playAnswer}
                disabled={phase === "answering" || audioStatus === "loading"}
                aria-label={t(audioStatus === "playing" ? "Jeda" : audioStatus === "paused" ? "Putar lagi" : "Dengarkan")}
                data-voice-menu="demo-replay"
              >
                {audioStatus === "playing" ? <Pause size={13} aria-hidden="true" /> : audioStatus === "paused" ? <Play size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
                <span>{t(audioStatus === "loading" ? "Menyiapkan…" : audioStatus === "playing" ? "Jeda" : audioStatus === "paused" ? "Putar lagi" : "Dengarkan")}</span>
              </button>
            </div>
            {(audioStatus === "error" || audioStatus === "blocked") && output.message && (
              <p className="voice-status voice-status-error" role="status" aria-live="polite">{t(output.message)}</p>
            )}
            <p className="tutor-response-text">
              {displayedText}
              {phase === "answering" && <span className="tutor-stream-cursor">|</span>}
            </p>
          </div>
        )}

        {/* Quick Scenario Triggers */}
        <div className="tutor-interactive-footer">
          <div className="tutor-prompt-title-row">
            <span className="tutor-prompt-badge">
              <Lightbulb size={14} aria-hidden="true" />
              <span>{t("Atau coba topik cepat:")}</span>
            </span>
          </div>
          <div className="tutor-prompt-chips" role="radiogroup" aria-label={t("Pilih topik")}>
            {SCENARIOS.map((sc, i) => {
              const SCENARIO_ICONS = [Leaf, Utensils, Zap, Droplets];
              const ScenarioIcon = SCENARIO_ICONS[i] ?? Sparkles;
              return (
                <button
                  key={sc.id}
                  type="button"
                  role="radio"
                  aria-checked={activeIdx === i}
                  className={`tutor-prompt-chip ${activeIdx === i ? "is-selected" : ""}`}
                  onClick={() => {
                    setCustomInput("");
                    runSequence(i);
                  }}
                  data-voice-menu={`demo-topic-${sc.id}`}
                  aria-label={`${t("Pilih topik")}: ${isEn ? sc.topicEn : sc.topic}`}
                >
                  <span className="tutor-chip-icon" aria-hidden="true">
                    <ScenarioIcon size={15} aria-hidden="true" />
                  </span>
                  <span className="tutor-chip-text">{isEn ? sc.topicEn : sc.topic}</span>
                  <ArrowRight size={14} className="tutor-chip-arrow" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
