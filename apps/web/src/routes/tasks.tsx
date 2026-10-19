import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export const Route = createFileRoute("/tasks")({
  component: Tasks,
});

interface Task {
  id: string;
  taskType: string;
  postUrl: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

const TASK_TYPES = [
  { value: "x", label: "Share on X (Twitter)" },
  { value: "linkedin", label: "Share on LinkedIn" },
  { value: "reddit", label: "Post on Reddit" },
  { value: "chrome_web_store", label: "Chrome Web Store review" },
  { value: "other", label: "Other" },
];

function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskType, setTaskType] = useState("x");
  const [postUrl, setPostUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const rows = await api<Task[]>("/tasks/mine").catch(() => []);
    setTasks(rows);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!file) {
      setMessage("Please attach a screenshot.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { uploadUrl, key } = await api<{ uploadUrl: string; key: string }>(
        "/tasks/presign",
        { method: "POST", json: { contentType: file.type } },
      );
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      await api("/tasks/submit", {
        method: "POST",
        json: { taskType, postUrl, screenshotKey: key },
      });
      setMessage("Submitted for review — expect a decision within 24h.");
      setPostUrl("");
      setFile(null);
      await refresh();
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Social &amp; micro-task center</h1>
      <p className="text-neutral-600">
        Earn $0.10 per approved task. Share MeanTime, leave a review, or post a
        screenshot of it working inside an AI chat.
      </p>

      <form onSubmit={submit} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div>
          <label className="block text-sm font-medium">Task</label>
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            {TASK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">Post URL</label>
          <input
            type="url"
            required
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://x.com/you/status/…"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Screenshot proof</label>
          <input
            type="file"
            accept="image/*"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Submit for review"}
        </button>
        {message && <p className="text-sm text-neutral-600">{message}</p>}
      </form>

      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">My submissions</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Task</th>
              <th className="px-4 py-2">Submitted</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100">
                <td className="px-4 py-2 capitalize">{t.taskType.replace("_", " ")}</td>
                <td className="px-4 py-2 text-neutral-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={t.status} />
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-neutral-500">
                  No submissions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: Task["status"] }) {
  const styles: Record<Task["status"], string> = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-700",
  };
  const labels: Record<Task["status"], string> = {
    pending: "Pending review",
    approved: "Approved +$0.10",
    rejected: "Rejected",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
