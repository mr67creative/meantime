import { getSettings, saveSettings } from "../../lib/storage";

async function init(): Promise<void> {
  const settings = await getSettings();

  const enabled = document.getElementById("enabled") as HTMLInputElement;
  const placement = document.getElementById("placement") as HTMLSelectElement;
  const snoozeState = document.getElementById("snooze-state") as HTMLDivElement;
  const statCache = document.getElementById("stat-cache") as HTMLElement;
  const statPending = document.getElementById("stat-pending") as HTMLElement;

  enabled.checked = settings.enabled;
  placement.value = settings.placement;

  for (const radio of document.querySelectorAll<HTMLInputElement>(
    "input[name='displayMode']",
  )) {
    radio.checked = radio.value === settings.displayMode;
    radio.addEventListener("change", async () => {
      if (radio.checked) await saveSettings({ displayMode: radio.value as typeof settings.displayMode });
    });
  }

  enabled.addEventListener("change", async () => {
    await saveSettings({
      enabled: enabled.checked,
      snoozedUntil: enabled.checked ? 0 : settings.snoozedUntil,
    });
    renderSnooze();
  });

  placement.addEventListener("change", async () => {
    await saveSettings({ placement: placement.value as typeof settings.placement });
  });

  function renderSnooze(): void {
    if (!settings.enabled) {
      snoozeState.textContent = "";
      return;
    }
    if (settings.snoozedUntil === Number.MAX_SAFE_INTEGER) {
      snoozeState.textContent = "Paused until you turn it back on.";
    } else if (settings.snoozedUntil > Date.now()) {
      const mins = Math.ceil((settings.snoozedUntil - Date.now()) / 60_000);
      snoozeState.textContent = `Paused — resumes in ~${mins} min.`;
    } else {
      snoozeState.textContent = "";
    }
  }
  renderSnooze();

  try {
    const status = (await chrome.runtime.sendMessage({ type: "cache_status" })) as {
      size: number;
      pending: number;
    } | null;
    if (status) {
      statCache.textContent = String(status.size);
      statPending.textContent = String(status.pending);
    }
  } catch {
    // service worker asleep — leave dashes
  }

  // Live earnings — what a user actually cares about in the popup.
  const statBalance = document.getElementById("stat-balance") as HTMLElement;
  try {
    const identity = await chrome.storage.local.get("identity");
    const id = identity["identity"] as { accessToken?: string } | undefined;
    if (id?.accessToken) {
      const res = await fetch("http://localhost:3001/me/balance", {
        headers: { Authorization: `Bearer ${id.accessToken}` },
      });
      if (res.ok) {
        const balance = (await res.json()) as { availableMicro: number };
        statBalance.textContent = `$${(balance.availableMicro / 1_000_000).toFixed(2)}`;
      }
    }
  } catch {
    // offline — leave dash
  }

  document.getElementById("open-dashboard")?.addEventListener("click", () => {
    void chrome.tabs.create({ url: "http://localhost:3000/dashboard" });
  });
}

void init();
