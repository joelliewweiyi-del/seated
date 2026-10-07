import type { Settings } from './db.js';

export interface Notice {
  title: string;
  body: string;
  /** Opened when the user taps the notification. */
  url?: string;
  priority?: 'max' | 'high' | 'default' | 'low';
  tags?: string[];
}

export interface Notifier {
  /** Never throws. Returns true when the push service accepted the message. */
  send(notice: Notice): Promise<boolean>;
}

const PRIORITY = { max: 5, high: 4, default: 3, low: 2 } as const; // 2 = no sound or vibration

/**
 * Push to the user's phone through ntfy (https://ntfy.sh). The user installs the
 * ntfy app and subscribes to their topic; nothing else to set up. We use the JSON
 * publish format because ntfy's header format is Latin-1 only and breaks on "é".
 */
export function ntfyNotifier(getSettings: () => Settings, fetchImpl: typeof fetch = fetch): Notifier {
  return {
    async send(notice) {
      const { ntfyServer, ntfyTopic } = getSettings();
      if (!ntfyTopic) {
        console.warn(`[notify] no ntfy topic set, push skipped: ${notice.title}`);
        return false;
      }
      const payload: Record<string, unknown> = {
        topic: ntfyTopic,
        title: notice.title,
        message: notice.body,
        priority: PRIORITY[notice.priority ?? 'default'],
        tags: notice.tags ?? [],
      };
      if (notice.url) {
        payload.click = notice.url;
        payload.actions = [{ action: 'view', label: 'Book now', url: notice.url, clear: true }];
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const post = fetchImpl(ntfyServer.replace(/\/$/, ''), {
          method: 'POST',
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        // Backstop in case the fetch timeout never fires: a push must not stop the radar.
        const limit = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('no answer in 20 s')), 20_000);
        });
        const res = await Promise.race([post, limit]);
        if (!res.ok) console.error(`[notify] ntfy answered ${res.status}`);
        return res.ok;
      } catch (err) {
        console.error(`[notify] ntfy push failed: ${err instanceof Error ? err.message : err}`);
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Prints pushes instead of sending them. Used by demo mode and tests. */
export function memoryNotifier({ quiet = false } = {}): Notifier & { sent: Notice[] } {
  const sent: Notice[] = [];
  return {
    sent,
    async send(notice) {
      sent.push(notice);
      if (!quiet) console.log(`[push] ${notice.title} | ${notice.body.replace(/\n/g, ' | ')}`);
      return true;
    },
  };
}
