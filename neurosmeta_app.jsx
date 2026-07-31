/*
  НейроСмета — приложение заказа сметы
  Палитра: neurosmeta.pro (тёмная тема, золотые акценты, Unbounded)
*/
import { useState, useCallback, useRef } from "react";

// === ЦВЕТА САЙТА neurosmeta.pro ===
const C = {
  bg: "#0a0f1a",
  bgCard: "#111827",
  bgCardHover: "#1a2236",
  bgInput: "#0d1320",
  border: "#1e293b",
  borderFocus: "#d4a843",
  gold: "#d4a843",
  goldLight: "#e8c96a",
  goldDim: "rgba(212,168,67,0.15)",
  teal: "#2dd4a8",
  tealDim: "rgba(45,212,168,0.12)",
  white: "#f0f2f5",
  textPrimary: "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
  danger: "#ef4444",
  green: "#22c55e",
  greenDim: "rgba(34,197,94,0.12)",
};

const TARIFFS = [
  { type: "cosmetic", label: "Косметический ремонт", area: "до 50 м²", maxArea: 50, fiz: 3000, ur: 5500 },
  { type: "cosmetic", label: "Косметический ремонт", area: "50–100 м²", maxArea: 100, fiz: 4000, ur: 7000 },
  { type: "cosmetic", label: "Косметический ремонт", area: "100–200 м²", maxArea: 200, fiz: 6500, ur: 10000 },
  { type: "capital", label: "Капитальный ремонт", area: "до 50 м²", maxArea: 50, fiz: 5000, ur: 8000 },
  { type: "capital", label: "Капитальный ремонт", area: "50–100 м²", maxArea: 100, fiz: 7000, ur: 10000 },
  { type: "capital", label: "Капитальный ремонт", area: "100–200 м²", maxArea: 200, fiz: 9500, ur: 13000 },
  { type: "capital", label: "Капитальный ремонт", area: "свыше 200 м²", maxArea: Infinity, fiz: 12500, ur: 15000 },
  { type: "construction", label: "Строительство", area: "до 100 м²", maxArea: 100, fiz: null, ur: 10000 },
  { type: "construction", label: "Строительство", area: "100–200 м²", maxArea: 200, fiz: null, ur: 14000 },
  { type: "construction", label: "Строительство", area: "200–350 м²", maxArea: 350, fiz: null, ur: 18000 },
  { type: "landscaping", label: "Благоустройство", area: "до 100 м²", maxArea: 100, fiz: 2500, ur: 5000 },
  { type: "landscaping", label: "Благоустройство", area: "100–500 м²", maxArea: 500, fiz: 4000, ur: 8000 },
  { type: "landscaping", label: "Благоустройство", area: "свыше 500 м²", maxArea: Infinity, fiz: 6000, ur: 11500 },
];

const WORK_TYPES = [
  { value: "cosmetic", label: "Косметический ремонт", fizAllowed: true },
  { value: "capital", label: "Капитальный ремонт", fizAllowed: true },
  { value: "construction", label: "Строительство (малоэтажное)", fizAllowed: false },
  { value: "landscaping", label: "Благоустройство", fizAllowed: true },
];

const REGIONS = [
  { value: "msk", label: "Москва" },
  { value: "mo", label: "Московская область" },
  { value: "spb", label: "Санкт-Петербург" },
  { value: "lo", label: "Ленинградская область" },
];

const DOC_SLOTS = [
  { id: "design", label: "Дизайн-проект / проект", accept: ".pdf,.jpg,.jpeg,.png" },
  { id: "drawings", label: "Чертежи с размерами", accept: ".pdf,.jpg,.jpeg,.png" },
  { id: "vor", label: "ВОР (ведомость объёмов работ)", accept: ".xlsx,.xls,.pdf" },
  { id: "materials", label: "Ведомость материалов", accept: ".xlsx,.xls,.pdf" },
  { id: "tz", label: "ТЗ / описание работ", accept: ".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png" },
  { id: "plans", label: "Обмерные планы", accept: ".pdf,.jpg,.jpeg,.png" },
  { id: "photos", label: "Фотографии объекта", accept: ".jpg,.jpeg,.png" },
];

const fmt = (n) => n?.toLocaleString("ru-RU") + " ₽";

function getPrice(workType, area, clientType) {
  if (!workType || !area || area <= 0) return null;
  const isUr = clientType === "ur" || clientType === "ip";
  const rows = TARIFFS.filter((t) => t.type === workType);
  for (const row of rows) {
    if (area <= row.maxArea || row.maxArea === Infinity) {
      return isUr ? row.ur : row.fiz;
    }
  }
  return null;
}

function FileSlot({ slot, files, onAdd, onRemove }) {
  const ref = useRef(null);
  const slotFiles = files[slot.id] || [];
  const [drag, setDrag] = useState(false);
  const handleFiles = (fl) => onAdd(slot.id, Array.from(fl));

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => ref.current?.click()}
      style={{
        border: drag ? `2px solid ${C.gold}` : `1.5px dashed ${slotFiles.length ? C.teal : C.border}`,
        borderRadius: 10, padding: "12px 14px",
        background: drag ? C.goldDim : slotFiles.length ? C.tealDim : C.bgCard,
        cursor: "pointer", transition: "all .15s",
      }}
    >
      <input ref={ref} type="file" accept={slot.accept} multiple style={{ display: "none" }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20, opacity: .6 }}>{slotFiles.length ? "✓" : "📎"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13, color: C.textPrimary }}>{slot.label}</div>
          {slotFiles.length > 0 ? (
            <div style={{ fontSize: 12, color: C.teal, marginTop: 3 }}>
              {slotFiles.map((f, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3, marginRight: 10 }}>
                  {f.name}
                  <span onClick={(e) => { e.stopPropagation(); onRemove(slot.id, i); }}
                    style={{ cursor: "pointer", color: C.danger, fontSize: 14, fontWeight: 700 }}>×</span>
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
              {slot.accept.replace(/\./g, "").toUpperCase().replace(/,/g, ", ")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(1);
  const [clientType, setClientType] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [inn, setInn] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [workType, setWorkType] = useState("");
  const [region, setRegion] = useState("");
  const [area, setArea] = useState("");
  const [files, setFiles] = useState({});
  const [agreeOffer, setAgreeOffer] = useState(false);
  const [agreePD, setAgreePD] = useState(false);

  const isFiz = clientType === "fiz";
  const isUr = clientType === "ur" || clientType === "ip";
  const price = getPrice(workType, Number(area), clientType);
  const totalFiles = Object.values(files).reduce((s, a) => s + a.length, 0);
  const areaOverMax = workType === "construction" && Number(area) > 350;

  const addFiles = useCallback((id, nf) => setFiles((p) => ({ ...p, [id]: [...(p[id] || []), ...nf] })), []);
  const removeFile = useCallback((id, idx) => setFiles((p) => ({ ...p, [id]: (p[id] || []).filter((_, i) => i !== idx) })), []);

  const step1Valid = clientType && (isFiz ? fullName.trim().length >= 5 : orgName.trim() && inn.trim().length >= 10) && email.includes("@") && phone.trim().length >= 5;
  const step2Valid = workType && region && Number(area) > 0 && !areaOverMax && price !== null;
  const step3Valid = totalFiles >= 2 && agreeOffer && agreePD;

  const card = { background: C.bgCard, borderRadius: 14, padding: "24px 24px 20px", border: `1px solid ${C.border}`, marginBottom: 16 };
  const label = { display: "block", fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".5px" };
  const input = {
    width: "100%", padding: "10px 14px", border: `1.5px solid ${C.border}`, borderRadius: 8,
    fontSize: 15, outline: "none", boxSizing: "border-box", background: C.bgInput,
    color: C.textPrimary, fontFamily: "inherit", transition: "border .15s",
  };
  const select = { ...input, cursor: "pointer" };

  const btn = (active, primary) => ({
    padding: "12px 32px", borderRadius: 10, fontWeight: 600, fontSize: 15, fontFamily: "inherit",
    border: primary ? "none" : `1.5px solid ${C.border}`,
    background: primary ? (active ? `linear-gradient(135deg, ${C.gold}, ${C.goldLight})` : C.textMuted) : "transparent",
    color: primary ? (active ? C.bg : C.bg) : C.textSecondary,
    cursor: active ? "pointer" : "default", opacity: active ? 1 : 0.5, transition: "all .15s",
  });

  const chip = (options, value, onChange) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: "9px 18px", borderRadius: 8, fontSize: 14, fontFamily: "inherit",
          border: value === o.value ? `2px solid ${C.gold}` : `1.5px solid ${C.border}`,
          background: value === o.value ? C.goldDim : "transparent",
          color: value === o.value ? C.gold : C.textSecondary,
          fontWeight: value === o.value ? 700 : 500, cursor: "pointer", transition: "all .15s",
        }}>{o.label}</button>
      ))}
    </div>
  );

  const steps = (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 24 }}>
      {[1, 2, 3, 4].map((s) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700,
            background: s === step ? C.gold : s < step ? C.teal : C.border,
            color: s <= step ? C.bg : C.textMuted, transition: "all .2s",
          }}>{s < step ? "✓" : s}</div>
          {s < 4 && <div style={{ width: 28, height: 2, background: s < step ? C.teal : C.border, borderRadius: 1 }} />}
        </div>
      ))}
    </div>
  );

  const stepNames = ["Данные заказчика", "Параметры объекта", "Документы", "Подтверждение"];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif", color: C.textPrimary }}>
      {/* HEADER */}
      <div style={{ background: C.bgCard, borderBottom: `1px solid ${C.border}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`, display: "flex", alignItems: "center", justifyContent: "center", color: C.bg, fontWeight: 800, fontSize: 18 }}>Н</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, color: C.gold, letterSpacing: "-.02em" }}>НейроСмета</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: -1 }}>Сметы на основе рыночных цен</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.textMuted }}>neurosmeta.pro</div>
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 16px 60px" }}>
        {steps}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>Шаг {step} из 4</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.gold, marginTop: 4 }}>{stepNames[step - 1]}</div>
        </div>

        {/* STEP 1 */}
        {step === 1 && (<div>
          <div style={card}>
            <label style={label}>Вы заказываете как</label>
            {chip([
              { value: "fiz", label: "Физическое лицо" },
              { value: "ip", label: "ИП / самозанятый" },
              { value: "ur", label: "Юридическое лицо" },
            ], clientType, (v) => { setClientType(v); if (v === "fiz" && workType === "construction") setWorkType(""); })}
          </div>
          {clientType && (<div style={card}>
            {isFiz ? (<div>
              <label style={label}>ФИО полностью</label>
              <input style={input} placeholder="Иванов Иван Иванович" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>) : (<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={label}>Наименование организации</label><input style={input} placeholder={clientType === "ip" ? "ИП Петров П.П." : 'ООО «Строй-Инвест»'} value={orgName} onChange={(e) => setOrgName(e.target.value)} /></div>
              <div><label style={label}>ИНН</label><input style={input} placeholder="7712345678" value={inn} maxLength={12} onChange={(e) => setInn(e.target.value.replace(/\D/g, ""))} /></div>
            </div>)}
            <div style={{ display: "flex", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 250px" }}><label style={label}>Email (для получения сметы)</label><input style={input} type="email" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div style={{ flex: "1 1 200px" }}><label style={label}>Телефон или Telegram</label><input style={input} placeholder="+7 (___) ___-__-__ или @username" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            </div>
          </div>)}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button style={btn(step1Valid, true)} disabled={!step1Valid} onClick={() => step1Valid && setStep(2)}>Далее →</button>
          </div>
        </div>)}

        {/* STEP 2 */}
        {step === 2 && (<div>
          <div style={card}>
            <label style={label}>Тип работ</label>
            {chip(WORK_TYPES.filter((w) => isFiz ? w.fizAllowed : true).map((w) => ({ value: w.value, label: w.label })), workType, setWorkType)}
            <div style={{ display: "flex", gap: 14, marginTop: 18, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 200px" }}><label style={label}>Город / регион</label>
                <select style={select} value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option value="">Выберите</option>
                  {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div style={{ flex: "1 1 160px" }}><label style={label}>Площадь объекта, м²</label>
                <input style={{ ...input, borderColor: areaOverMax ? C.danger : C.border }} type="number" min="1" placeholder="75" value={area} onChange={(e) => setArea(e.target.value)} />
                {areaOverMax && <div style={{ fontSize: 12, color: C.danger, marginTop: 4 }}>Свыше 350 м² — индивидуальный расчёт. Свяжитесь: @a_safro</div>}
              </div>
            </div>
          </div>
          {price !== null && (
            <div style={{ ...card, background: C.goldDim, border: `2px solid ${C.gold}`, textAlign: "center" }}>
              <div style={{ fontSize: 13, color: C.textSecondary, fontWeight: 500, marginBottom: 4 }}>Стоимость подготовки сметы</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: C.gold, letterSpacing: "-.02em" }}>{fmt(price)}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>Фиксированная цена · оплата до начала подготовки</div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <button style={btn(true, false)} onClick={() => setStep(1)}>← Назад</button>
            <button style={btn(step2Valid, true)} disabled={!step2Valid} onClick={() => step2Valid && setStep(3)}>Далее →</button>
          </div>
        </div>)}

        {/* STEP 3 */}
        {step === 3 && (<div>
          <div style={card}>
            <div style={{ fontSize: 14, color: C.textSecondary, marginBottom: 14 }}>Загрузите не менее <strong style={{ color: C.gold }}>2 документов</strong>. Перетащите файлы или нажмите для выбора.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {DOC_SLOTS.map((s) => <FileSlot key={s.id} slot={s} files={files} onAdd={addFiles} onRemove={removeFile} />)}
            </div>
            {totalFiles > 0 && totalFiles < 2 && <div style={{ fontSize: 13, color: C.gold, marginTop: 10, fontWeight: 500 }}>Загружено: {totalFiles} из 2 минимальных</div>}
            {totalFiles >= 2 && <div style={{ fontSize: 13, color: C.teal, marginTop: 10, fontWeight: 500 }}>✓ Загружено документов: {totalFiles}</div>}
          </div>
          <div style={card}>
            {[{ checked: agreeOffer, set: setAgreeOffer, text: "Договора-оферты", link: true },
              { checked: agreePD, set: setAgreePD, text: "Политикой обработки ПД", link: true }].map((a, i) => (
              <label key={i} style={{ display: "flex", gap: 10, cursor: "pointer", alignItems: "flex-start", marginBottom: i === 0 ? 12 : 0 }}>
                <input type="checkbox" checked={a.checked} onChange={(e) => a.set(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, accentColor: C.gold }} />
                <span style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
                  {i === 0 ? "Я ознакомлен(-а) и согласен(-на) с условиями " : "Я даю согласие на обработку персональных данных в соответствии с "}
                  <span style={{ color: C.gold, textDecoration: "underline", fontWeight: 600 }}>{a.text}</span>
                </span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <button style={btn(true, false)} onClick={() => setStep(2)}>← Назад</button>
            <button style={btn(step3Valid, true)} disabled={!step3Valid} onClick={() => step3Valid && setStep(4)}>Далее →</button>
          </div>
        </div>)}

        {/* STEP 4 */}
        {step === 4 && (<div>
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.gold, marginBottom: 14 }}>Проверьте данные заказа</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><tbody>
              {[["Заказчик", isFiz ? `${fullName} (физлицо)` : `${orgName}, ИНН ${inn} (${clientType === "ip" ? "ИП" : "юрлицо"})`],
                ["Email", email], ["Контакт", phone],
                ["Тип работ", WORK_TYPES.find((w) => w.value === workType)?.label],
                ["Регион", REGIONS.find((r) => r.value === region)?.label],
                ["Площадь", `${area} м²`], ["Документов", `${totalFiles} шт.`],
              ].map(([k, v], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "9px 0", color: C.textMuted, width: "40%" }}>{k}</td>
                  <td style={{ padding: "9px 0", fontWeight: 500, color: C.textPrimary }}>{v}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <div style={{ ...card, background: C.goldDim, border: `2px solid ${C.gold}`, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: C.textSecondary, marginBottom: 4 }}>К оплате</div>
            <div style={{ fontSize: 40, fontWeight: 800, color: C.gold }}>{fmt(price)}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6 }}>После оплаты смета будет направлена на {email}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, gap: 12 }}>
            <button style={btn(true, false)} onClick={() => setStep(3)}>← Назад</button>
            <button style={{ ...btn(true, true), background: `linear-gradient(135deg, ${C.teal}, #20b090)`, padding: "14px 40px", fontSize: 16 }}
              onClick={() => alert("Переход к оплате через ЮKassa (будет подключено)")}>
              Оплатить {fmt(price)}
            </button>
          </div>
        </div>)}

        {/* TARIFF TABLE */}
        <div style={{ ...card, marginTop: 40 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.gold, marginBottom: 16 }}>Тарифы на подготовку сметы</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "rgba(212,168,67,0.15)" }}>
                {["Вид сметы", "Площадь", "Физлицо", "Юрлицо / ИП"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", color: C.gold, fontWeight: 700, textAlign: h === "Вид сметы" ? "left" : "center", whiteSpace: "nowrap", borderBottom: `1px solid ${C.gold}` }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {TARIFFS.map((t, i) => {
                  const prev = i > 0 ? TARIFFS[i - 1].type : null;
                  return (
                    <tr key={i} style={{ borderTop: prev && prev !== t.type ? `1px solid ${C.textMuted}` : `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 12px", fontWeight: 500, color: C.textPrimary }}>{t.label}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", color: C.textSecondary }}>{t.area}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: t.fiz ? C.textPrimary : C.textMuted }}>{t.fiz ? fmt(t.fiz) : "—"}</td>
                      <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600, color: C.textPrimary }}>{fmt(t.ur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 12, lineHeight: 1.6 }}>
            Строительство (малоэтажное) — только для юридических лиц и ИП. Цены фиксированные.
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ background: C.bgCard, borderTop: `1px solid ${C.border}`, padding: "24px 16px", textAlign: "center", fontSize: 12, lineHeight: 1.8 }}>
        <div style={{ color: C.gold, fontWeight: 600, marginBottom: 4 }}>Сафро Алексей Яковлевич · ИНН 780216329302 · самозанятый (НПД, 422-ФЗ)</div>
        <div style={{ color: C.textMuted }}>Методология «НейроСмета» · РЦИС РФ № 0021-716-491</div>
        <div style={{ color: C.textMuted }}>Email: aleksey.safro@yandex.ru · Telegram: @a_safro · Тел: +7 (921) 946-07-25</div>
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8, color: C.textMuted }}>© 2026 НейроСмета · neurosmeta.pro</div>
      </div>
    </div>
  );
}
