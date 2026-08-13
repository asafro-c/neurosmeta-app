"use client";
import { useState } from "react";

const STAGES = [
  { id: 1, label: "Анализ документов", endpoint: "/api/stage1" },
  { id: 2, label: "Подбор расценок", endpoint: "/api/stage2" },
  { id: 3, label: "Поиск цен материалов", endpoint: "/api/stage3" },
  { id: 4, label: "Формирование и отправка", endpoint: "/api/stage4" },
];

export default function TestPage() {
  const [files, setFiles] = useState([]);
  const [stage, setStage] = useState(0);
  const [status, setStatus] = useState("Готов к тесту");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const order = {
    email: "aleksey.safro@yandex.ru",
    clientName: "Тест",
    clientType: "fiz",
    workType: "cosmetic",
    region: "spb",
    area: 50,
    phone: "+79219460725",
  };

  const handleSubmit = async () => {
    if (files.length < 1) { setStatus("Загрузите документы"); return; }
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      // Подготовка файлов
      const filesData = [];
      for (const f of files) {
        const buf = await f.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        filesData.push({ name: f.name, mimeType: f.type, data: base64 });
      }

      // ЭТАП 1: Анализ документов
      setStage(1);
      setStatus("Этап 1/4: Claude анализирует документы... (3–4 мин)");
      const r1 = await fetch("/api/stage1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order, files: filesData }),
      });
      const d1 = await r1.json();
      if (!d1.success) throw new Error("Этап 1: " + (d1.error || "ошибка"));

      // ЭТАП 2: Расценки из справочника
      setStage(2);
      setStatus("Этап 2/4: Подбор расценок из справочника...");
      const r2 = await fetch("/api/stage2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimateData: d1.estimateData, region: order.region }),
      });
      const d2 = await r2.json();
      if (!d2.success) throw new Error("Этап 2: " + (d2.error || "ошибка"));

      // ЭТАП 3: Цены материалов
      setStage(3);
      setStatus("Этап 3/4: Поиск цен материалов на petrovich.ru... (3–4 мин)");
      const r3 = await fetch("/api/stage3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimateData: d2.estimateData, region: order.region }),
      });
      const d3 = await r3.json();
      if (!d3.success) throw new Error("Этап 3: " + (d3.error || "ошибка"));

      // ЭТАП 4: Excel + email
      setStage(4);
      setStatus("Этап 4/4: Формирование сметы и отправка на email...");
      const r4 = await fetch("/api/stage4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimateData: d3.estimateData, order }),
      });
      const d4 = await r4.json();
      if (!d4.success) throw new Error("Этап 4: " + (d4.error || "ошибка"));

      setStage(5);
      setStatus("Смета отправлена на " + order.email);
      setResult(d4);

    } catch (err) {
      setError(err.message);
      setStatus("Ошибка: " + err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ padding: 40, fontFamily: "Arial", maxWidth: 640, margin: "0 auto" }}>
      <h2>Тест генерации сметы</h2>
      <p>Загрузи документы (PDF, JPG, PNG, Excel, Word):</p>
      <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
        onChange={(e) => setFiles(Array.from(e.target.files))} style={{ marginBottom: 16, display: "block" }} />
      {files.length > 0 && (
        <div style={{ marginBottom: 16, color: "#666" }}>
          {files.map((f, i) => <div key={i}>{f.name} ({(f.size/1024).toFixed(0)} КБ)</div>)}
        </div>
      )}
      <button onClick={handleSubmit} disabled={running}
        style={{ padding: "12px 32px", fontSize: 16, background: running ? "#999" : "#2F5496", color: "#fff", border: "none", borderRadius: 8, cursor: running ? "wait" : "pointer" }}>
        {running ? "Генерация..." : "Сгенерировать смету"}
      </button>

      {/* Прогресс */}
      {running && (
        <div style={{ marginTop: 20 }}>
          {STAGES.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", color: stage === s.id ? "#2F5496" : stage > s.id ? "#22c55e" : "#999" }}>
              <span style={{ width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: stage > s.id ? "#22c55e" : stage === s.id ? "#2F5496" : "#ddd", color: "#fff" }}>
                {stage > s.id ? "✓" : s.id}
              </span>
              <span style={{ fontWeight: stage === s.id ? 700 : 400 }}>{s.label}</span>
              {stage === s.id && <span style={{ fontSize: 12, color: "#888" }}>⏳</span>}
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 16, fontWeight: "bold", color: error ? "#c00" : stage === 5 ? "#22c55e" : "#333" }}>{status}</p>

      {result && (
        <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 8, fontSize: 12, overflow: "auto" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
