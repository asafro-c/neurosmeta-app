"use client";
import { useState } from "react";

export default function TestPage() {
  const [status, setStatus] = useState("Готов к тесту");
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);

  const handleSubmit = async () => {
    if (files.length < 1) { setStatus("Загрузите хотя бы 1 документ"); return; }
    setStatus("Обработка... Claude анализирует документы и ищет цены. Ждите 3-5 минут.");
    setResult(null);

    const filesData = [];
    for (const f of files) {
      const buf = await f.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      filesData.push({ name: f.name, mimeType: f.type, data: base64 });
    }

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: {
            email: "aleksey.safro@yandex.ru",
            clientName: "Тест реальный проект",
            clientType: "fiz",
            workType: "cosmetic",
            region: "spb",
            area: 50,
            phone: "+79219460725"
          },
          files: filesData
        })
      });
      const data = await res.json();
      setResult(data);
      setStatus(data.success ? "Смета отправлена на почту!" : "Ошибка: " + data.error);
    } catch (err) {
      setStatus("Ошибка: " + err.message);
    }
  };

  return (
    <div style={{ padding: 40, fontFamily: "Arial", maxWidth: 600, margin: "0 auto" }}>
      <h2>Тест генерации сметы</h2>
      <p>Загрузи документы проекта (PDF, JPG, PNG, Excel):</p>
      <input
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
        onChange={(e) => setFiles(Array.from(e.target.files))}
        style={{ marginBottom: 16, display: "block" }}
      />
      {files.length > 0 && (
        <div style={{ marginBottom: 16, color: "#666" }}>
          {files.map((f, i) => <div key={i}>{f.name} ({(f.size/1024).toFixed(0)} КБ)</div>)}
        </div>
      )}
      <button
        onClick={handleSubmit}
        style={{ padding: "12px 32px", fontSize: 16, background: "#2F5496", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
      >
        Сгенерировать смету
      </button>
      <p style={{ marginTop: 16, fontWeight: "bold" }}>{status}</p>
      {result && <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 8, fontSize: 12, overflow: "auto" }}>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
