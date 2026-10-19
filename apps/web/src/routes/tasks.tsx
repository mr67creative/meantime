import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Shell, PageHeader } from "../lib/shell";
import { Badge, Empty, Table } from "../lib/ui";

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
      setMessage("Submitted — Laya reviews most proofs instantly.");
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
    <Shell>
      <PageHeader
        title="Task center"
        description="Earn $0.10 per approved task. Most proofs are auto-moderated."
      />

      <form onSubmit={submit} className="card-pad space-y-4">
        <div>
          <label className="label">Task</label>
          <select value={taskType} onChange={(e) => setTaskType(e.target.value)} className="input">
            {TASK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Post URL</label>
          <input type="url" required value={postUrl} onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://x.com/you/status/…" className="input" />
        </div>

        <div>
          <label className="label">Screenshot proof</label>
          <input type="file" accept="image/*" required onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-neutral-500 file:mr-4 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-neutral-900 hover:file:bg-neutral-200" />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Uploading…" : "Submit for review"}
          </button>
          {message && <p className="text-sm text-neutral-500">{message}</p>}
        </div>
      </form>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">My submissions</h2>
        <Table head={["Task", "Submitted", "Status"]}>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-3 capitalize">{t.taskType.replace("_", " ")}</td>
              <td className="px-4 py-3 text-neutral-500">{new Date(t.createdAt).toLocaleDateString()}</td>
              <td className="px-4 py-3">
                <Badge tone={t.status === "approved" ? "good" : t.status === "rejected" ? "bad" : "warn"}>
                  {t.status === "approved" ? "Approved +$0.10" : t.status === "rejected" ? "Rejected" : "Pending review"}
                </Badge>
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr><td colSpan={3}><Empty title="No submissions yet" /></td></tr>
          )}
        </Table>
      </section>
    </Shell>
  );
}
