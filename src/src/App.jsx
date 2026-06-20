import { useState, useEffect, useRef } from "react";
import { Plus, Check, X, Clock, ChevronLeft, Trash2, AlertCircle, User, Edit3 } from "lucide-react";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
} from "firebase/firestore";

// ---------- Conexión a Firebase ----------
// Estas claves se rellenan con las variables de entorno que configures en Vercel.
// No son secretas: son las claves "públicas" de cliente, normales en apps de Firebase.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Documento único donde se guardan todas las tareas del mercado
const TASKS_DOC = doc(db, "mercado", "tareas");

// ---------- Paleta ----------
// Mercado de abastos: piedra clara, verdulería (verde) como acento de "al día",
// y un naranja terracota de aviso para lo urgente. Nada de azules genéricos de app de oficina.
const COLORS = {
  bg: "#F6F4EF",
  surface: "#FFFFFF",
  ink: "#2B2620",
  inkSoft: "#7A7166",
  line: "#E7E1D6",
  brand: "#3E7A4F",
  brandSoft: "#E6F0E8",
  warn: "#C8632E",
  warnSoft: "#FBE9DF",
  danger: "#B33A3A",
  dangerSoft: "#F8E3E1",
  gold: "#B8862E",
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24;
  return Math.round((startOfDay(b) - startOfDay(a)) / MS);
}

function formatRelativeDate(iso) {
  if (!iso) return "Nunca";
  const d = new Date(iso);
  const today = new Date();
  const diff = daysBetween(d, today);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  if (diff < 7) return `Hace ${diff} días`;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

// Calcula el estado de una tarea según su última limpieza y frecuencia
function getTaskStatus(task) {
  if (!task.lastDone) {
    return { state: "due", daysOverdue: task.frequencyDays, label: "Sin registrar" };
  }
  const today = new Date();
  const last = new Date(task.lastDone);
  const diff = daysBetween(last, today);
  const remaining = task.frequencyDays - diff;

  if (remaining < 0) {
    return { state: "overdue", daysOverdue: -remaining, label: `Atrasada ${-remaining}d` };
  }
  if (remaining === 0) {
    return { state: "due", daysOverdue: 0, label: "Toca hoy" };
  }
  if (remaining <= 1) {
    return { state: "soon", daysOverdue: -remaining, label: "Toca mañana" };
  }
  return { state: "ok", daysOverdue: -remaining, label: `En ${remaining}d` };
}

const STATE_STYLE = {
  overdue: { color: COLORS.danger, bg: COLORS.dangerSoft },
  due: { color: COLORS.warn, bg: COLORS.warnSoft },
  soon: { color: COLORS.gold, bg: "#F6EDDB" },
  ok: { color: COLORS.brand, bg: COLORS.brandSoft },
};

const FREQ_PRESETS = [
  { label: "A diario", days: 1 },
  { label: "Cada 2 días", days: 2 },
  { label: "Cada 3 días", days: 3 },
  { label: "Semanal", days: 7 },
  { label: "Cada 15 días", days: 15 },
  { label: "Mensual", days: 30 },
];

const PEOPLE = ["Yo", "Compañero"];

// ---------- Componente principal ----------
export default function App() {
  const [tasks, setTasks] = useState(null); // null = cargando
  const [view, setView] = useState("list");
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState("all"); // all | overdue
  const [storageReady, setStorageReady] = useState(false);

  // Escuchar cambios en tiempo real: si tu compañero marca una tarea,
  // tú lo ves al instante sin recargar nada.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      TASKS_DOC,
      (snap) => {
        if (snap.exists()) {
          setTasks(snap.data().list || []);
        } else {
          const seed = seedTasks();
          setDoc(TASKS_DOC, { list: seed });
          setTasks(seed);
        }
        setStorageReady(true);
      },
      (error) => {
        console.error("Error de Firebase:", error);
        setTasks(seedTasks());
        setStorageReady(true);
      }
    );
    return () => unsubscribe();
  }, []);

  async function persist(next) {
    setTasks(next);
    try {
      await setDoc(TASKS_DOC, { list: next });
    } catch (e) {
      console.error("No se pudo guardar:", e);
    }
  }

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 2000);
  }

  function addTask(task) {
    const next = [{ ...task, id: uid(), lastDone: null, history: [] }, ...(tasks || [])];
    persist(next);
    setView("list");
    showToast("Tarea creada");
  }

  function markDone(id, person) {
    const next = (tasks || []).map((t) => {
      if (t.id !== id) return t;
      const now = new Date().toISOString();
      return {
        ...t,
        lastDone: now,
        lastDoneBy: person,
        history: [{ date: now, person }, ...(t.history || [])].slice(0, 20),
      };
    });
    persist(next);
    showToast(`Marcada como limpiada por ${person}`);
  }

  function deleteTask(id) {
    const next = (tasks || []).filter((t) => t.id !== id);
    persist(next);
    setView("list");
    setActiveTaskId(null);
    showToast("Tarea eliminada");
  }

  const activeTask = (tasks || []).find((t) => t.id === activeTaskId) || null;

  if (!storageReady) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.inkSoft, fontSize: 14, fontFamily: "sans-serif" }}>Cargando…</div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.bg,
        color: COLORS.ink,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        display: "flex",
        flexDirection: "column",
        maxWidth: 480,
        margin: "0 auto",
        position: "relative",
      }}
    >
      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button { font-family: inherit; cursor: pointer; }
        input, textarea, select { font-family: inherit; }
        ::-webkit-scrollbar { display: none; }
        @keyframes slideUp { from { transform: translateY(12px); opacity:0 } to { transform: translateY(0); opacity:1 } }
        @keyframes popIn { from { transform: scale(0.92); opacity:0 } to { transform: scale(1); opacity:1 } }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>

      {view === "list" && (
        <ListView
          tasks={tasks || []}
          filter={filter}
          setFilter={setFilter}
          onOpen={(id) => {
            setActiveTaskId(id);
            setView("detail");
          }}
          onNew={() => setView("new")}
          onMarkDone={markDone}
        />
      )}

      {view === "new" && <NewTaskView onCancel={() => setView("list")} onSave={addTask} />}

      {view === "detail" && activeTask && (
        <DetailView
          task={activeTask}
          onBack={() => {
< truncated lines 245-696 >
      <Header
        title="Detalle de la tarea"
        onBack={onBack}
        right={
          <button onClick={() => setConfirmDelete(true)} aria-label="Eliminar" style={{ background: "none", border: "none", padding: 8, display: "flex" }}>
            <Trash2 size={20} color={COLORS.danger} />
          </button>
        }
      />

      <div style={{ padding: "8px 20px 0" }}>
        <h2 style={{ fontSize: 21, fontWeight: 800, margin: "8px 0 4px" }}>{task.name}</h2>
        <div style={{ fontSize: 13.5, color: COLORS.inkSoft, marginBottom: 18 }}>{freqLabel}</div>

        <div
          style={{
            background: style.bg,
            borderRadius: 16,
            padding: 18,
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {status.state === "overdue" || status.state === "due" ? (
            <AlertCircle size={26} color={style.color} />
          ) : (
            <Clock size={26} color={style.color} />
          )}
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: style.color }}>{status.label}</div>
            <div style={{ fontSize: 12.5, color: style.color, opacity: 0.85, marginTop: 1 }}>
              Última vez: {formatRelativeDate(task.lastDone)}
              {task.lastDoneBy ? ` · ${task.lastDoneBy}` : ""}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.inkSoft, marginBottom: 8 }}>
          Historial reciente
        </div>
        {(!task.history || task.history.length === 0) && (
          <div style={{ fontSize: 13.5, color: COLORS.inkSoft, padding: "8px 0" }}>Aún no hay registros.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(task.history || []).map((h, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: COLORS.surface,
                border: `1px solid ${COLORS.line}`,
                borderRadius: 12,
                padding: "10px 14px",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{formatRelativeDate(h.date)}</span>
              <span style={{ fontSize: 13, color: COLORS.inkSoft, display: "flex", alignItems: "center", gap: 5 }}>
                <User size={13} /> {h.person}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          padding: "14px 20px calc(env(safe-area-inset-bottom, 0px) + 14px)",
          background: `linear-gradient(to top, ${COLORS.bg} 75%, transparent)`,
        }}
      >
        <div style={{ width: "100%", maxWidth: 480, position: "relative" }}>
          {pickPerson && (
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 10px)",
                left: 0,
                right: 0,
                background: COLORS.surface,
                border: `1px solid ${COLORS.line}`,
                borderRadius: 14,
                boxShadow: "0 10px 28px rgba(0,0,0,0.15)",
                padding: 6,
                animation: "popIn 0.12s ease-out",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.inkSoft, padding: "6px 10px 4px" }}>
                ¿Quién la limpió?
              </div>
              {PEOPLE.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    onMarkDone(task.id, p);
                    setPickPerson(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "12px 10px",
                    borderRadius: 10,
                    border: "none",
                    background: "transparent",
                    fontSize: 15,
                    fontWeight: 600,
                    color: COLORS.ink,
                    textAlign: "left",
                  }}
                >
                  <User size={16} color={COLORS.inkSoft} />
                  {p}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setPickPerson((o) => !o)}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: 16,
              border: "none",
              background: COLORS.brand,
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              boxShadow: "0 8px 20px rgba(62,122,79,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Check size={19} strokeWidth={2.5} />
            Marcar como limpiada hoy
          </button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmSheet
          title="¿Eliminar esta tarea?"
          message="Se perderá también su historial. Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function ConfirmSheet({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(43,38,32,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: COLORS.surface,
          borderRadius: "20px 20px 0 0",
          padding: "22px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)",
          animation: "slideUp 0.2s ease-out",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 14, color: COLORS.inkSoft, marginBottom: 18 }}>{message}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: 14, borderRadius: 14, border: `1px solid ${COLORS.line}`, background: "#fff", fontWeight: 700, fontSize: 15, color: COLORS.ink }}>
            Cancelar
          </button>
          <button onClick={onConfirm} style={{ flex: 1, padding: 14, borderRadius: 14, border: "none", background: COLORS.danger, fontWeight: 700, fontSize: 15, color: "#fff" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Reutilizables ----------
function Header({ title, onBack, right }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        background: "rgba(246,244,239,0.92)",
        backdropFilter: "blur(8px)",
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 12px",
        borderBottom: `1px solid ${COLORS.line}`,
      }}
    >
      <button onClick={onBack} aria-label="Volver" style={{ background: "none", border: "none", padding: 8, display: "flex", alignItems: "center" }}>
        <ChevronLeft size={22} color={COLORS.ink} />
      </button>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
      <div style={{ width: 38, display: "flex", justifyContent: "flex-end" }}>{right}</div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.inkSoft, marginBottom: 8 }}>
        {label} {required && <span style={{ color: COLORS.warn }}>*</span>}
      </div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 14,
  border: `1px solid ${COLORS.line}`,
  fontSize: 15.5,
  color: COLORS.ink,
  background: COLORS.surface,
  outline: "none",
};
