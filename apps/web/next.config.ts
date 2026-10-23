import type { NextConfig } from "next";
import path from "node:path";

const apiOrigin = (process.env.API_ORIGIN ?? "http://127.0.0.1:8109").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  allowedDevOrigins: ["127.0.0.1"],
  // Keep native Windows builds usable alongside Docker and the development tools.
  experimental: { ...(process.platform === "win32" ? {cpus:2} : {}), serverActions:{bodySizeLimit:"3mb"} },
  async redirects() {
    return [
      { source: "/masuk", destination: "/login", permanent: true },
      { source: "/daftar", destination: "/register", permanent: true },
      { source: "/guru", destination: "/teacher", permanent: true },
      { source: "/guru/analitik", destination: "/teacher/analytics", permanent: true },
      { source: "/guru/kelas/baru", destination: "/teacher/classes/new", permanent: true },
      { source: "/guru/kelas/:id/materi/baru", destination: "/teacher/classes/:id/materials/new", permanent: true },
      { source: "/guru/kelas/:id/materi/:materialId", destination: "/teacher/classes/:id/materials/:materialId", permanent: true },
      { source: "/guru/kelas/:id", destination: "/teacher/classes/:id", permanent: true },
      { source: "/guru/kelas", destination: "/teacher/classes", permanent: true },
      { source: "/guru/kuis/baru", destination: "/teacher/quizzes/new", permanent: true },
      { source: "/guru/kuis/:id", destination: "/teacher/quizzes/:id", permanent: true },
      { source: "/guru/kuis", destination: "/teacher/quizzes", permanent: true },
      { source: "/guru/materi/baru", destination: "/teacher/materials/new", permanent: true },
      { source: "/guru/materi", destination: "/teacher/materials", permanent: true },
      { source: "/guru/penugasan/:id", destination: "/teacher/assignments/:id", permanent: true },
      { source: "/guru/review-kuis/:id", destination: "/teacher/quiz-reviews/:id", permanent: true },
      { source: "/guru/review-kuis", destination: "/teacher/quiz-reviews", permanent: true },
      { source: "/guru/siswa/:id", destination: "/teacher/students/:id", permanent: true },
      { source: "/siswa", destination: "/student", permanent: true },
      { source: "/siswa/kelas/:id/materi/:materialId", destination: "/student/classes/:id/materials/:materialId", permanent: true },
      { source: "/siswa/kelas/:id", destination: "/student/classes/:id", permanent: true },
      { source: "/siswa/kelas", destination: "/student/classes", permanent: true },
      { source: "/siswa/latihan", destination: "/student/practice", permanent: true },
      { source: "/siswa/materi", destination: "/student/materials", permanent: true },
      { source: "/siswa/progres", destination: "/student/progress", permanent: true },
      { source: "/siswa/tugas/:id", destination: "/student/assignments/:id", permanent: true },
      { source: "/siswa/tugas", destination: "/student/assignments", permanent: true },
      { source: "/siswa/tutor", destination: "/student/tutor", permanent: true },
      { source: "/admin/akademik", destination: "/admin/academics", permanent: true },
      { source: "/admin/aktivitas", destination: "/admin/activity", permanent: true },
      { source: "/admin/materi/:id", destination: "/admin/materials/:id", permanent: true },
      { source: "/admin/materi", destination: "/admin/materials", permanent: true },
      { source: "/admin/pemantauan-ai/jejak", destination: "/admin/ai-monitor/traces", permanent: true },
      { source: "/admin/pemantauan-ai", destination: "/admin/ai-monitor", permanent: true },
      { source: "/admin/pengguna/baru", destination: "/admin/users/new", permanent: true },
      { source: "/admin/pengguna/:id", destination: "/admin/users/:id", permanent: true },
      { source: "/admin/pengguna", destination: "/admin/users", permanent: true },
      { source: "/admin/review-kuis/:id", destination: "/admin/quiz-reviews/:id", permanent: true },
      { source: "/admin/review-kuis", destination: "/admin/quiz-reviews", permanent: true },
      { source: "/admin/undangan/baru", destination: "/admin/users/new", permanent: true },
      { source: "/admin/undangan", destination: "/admin/users", permanent: true },
    ];
  },
  async rewrites() {
    return {
      fallback: [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }],
    };
  },
};

export default nextConfig;
