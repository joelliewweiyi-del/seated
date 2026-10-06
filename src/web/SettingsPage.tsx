import { useState } from 'react';
import { api, type Settings, type State } from './api';
import { Badge, Button, Card, Field, inputClass, SectionLabel } from './ui';

function randomTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `seated-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function SettingsPage({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const [form, setForm] = useState<Settings>(state.settings);
  const [message, setMessage] = useState<{ section: 'alerts' | 'guest'; tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (section: 'alerts' | 'guest', then?: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.saveSettings(form);
      if (then) await then();
      await refresh();
      setMessage({ section, tone: 'ok', text: then ? 'Saved. Test alert sent: check your phone.' : 'Saved.' });
    } catch (err) {
      setMessage({ section, tone: 'error', text: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const topicUrl = form.ntfyTopic ? `${form.ntfyServer.replace(/\/$/, '')}/${form.ntfyTopic}` : null;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-[15px] text-stone-500">Where Seated sends alerts, and who it books for.</p>
      </div>

      <section aria-labelledby="pushes">
        <SectionLabel>
          <span id="pushes">Phone alerts</span>
        </SectionLabel>
        <Card className="space-y-5 p-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-600">
            <li>
              Install the free <strong className="font-medium text-ink">ntfy</strong> app (iPhone or Android).
            </li>
            <li>Make a private topic below and save it.</li>
            <li>In the app, tap + and subscribe to the same topic. Then send a test alert.</li>
          </ol>
          <Field label="Topic" hint="Anyone who knows the topic can read your alerts, so keep it long and random.">
            <div className="flex gap-2">
              <input className={`${inputClass} font-mono`} value={form.ntfyTopic} onChange={set('ntfyTopic')} placeholder="seated-…" aria-label="ntfy topic" />
              <Button className="shrink-0 whitespace-nowrap" onClick={() => setForm({ ...form, ntfyTopic: randomTopic() })}>
                Generate
              </Button>
            </div>
          </Field>
          {topicUrl && (
            <p className="text-sm text-stone-600">
              No phone at hand? Open{' '}
              <a className="font-mono text-copper-700 underline" href={topicUrl} target="_blank" rel="noreferrer">
                {topicUrl}
              </a>{' '}
              in a browser to get alerts there.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={() => save('alerts')}>
              Save
            </Button>
            <Button disabled={busy || !form.ntfyTopic} onClick={() => save('alerts', api.testPush)}>
              Save and send test alert
            </Button>
            <SaveMessage message={message} section="alerts" />
          </div>
        </Card>
      </section>

      <section aria-labelledby="guest">
        <SectionLabel>
          <span id="guest">Your details for auto-book</span>
        </SectionLabel>
        <Card className="space-y-5 p-5">
          <p className="text-sm text-stone-600">
            Seated only uses these when a watch has "Book it for me" switched on. The restaurant sees them as a normal booking.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <input className={inputClass} value={form.guestFirstName} onChange={set('guestFirstName')} autoComplete="given-name" />
            </Field>
            <Field label="Last name">
              <input className={inputClass} value={form.guestLastName} onChange={set('guestLastName')} autoComplete="family-name" />
            </Field>
            <Field label="Email" hint="The restaurant sends the confirmation here.">
              <input className={inputClass} type="email" value={form.guestEmail} onChange={set('guestEmail')} autoComplete="email" />
            </Field>
            <Field label="Phone" hint="Restaurants sometimes call to confirm.">
              <input className={inputClass} type="tel" value={form.guestPhone} onChange={set('guestPhone')} autoComplete="tel" placeholder="+31 6 …" />
            </Field>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            Auto-book on this server
            <Badge tone={state.radar.autoBookEnabled ? 'teal' : 'stone'}>{state.radar.autoBookEnabled ? 'Enabled' : 'Off'}</Badge>
            {!state.radar.autoBookEnabled && 'Set AUTOBOOK=true in .env and restart to allow it.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={() => save('guest')}>
              Save details
            </Button>
            <SaveMessage message={message} section="guest" />
          </div>
        </Card>
      </section>

      <section aria-labelledby="about">
        <SectionLabel>
          <span id="about">How checking works</span>
        </SectionLabel>
        <p className="text-sm text-stone-600">
          Seated checks every watched restaurant about every {Math.round(state.radar.pollSeconds / 60)} minutes, while this computer or
          server is running. It reads the same availability the restaurant's booking page shows. It reads each date once, however many
          watches you have.
        </p>
      </section>
    </div>
  );
}

function SaveMessage({
  message,
  section,
}: {
  message: { section: string; tone: 'ok' | 'error'; text: string } | null;
  section: string;
}) {
  if (!message || message.section !== section) return null;
  return (
    <span role="status" className={`ml-1 text-sm ${message.tone === 'ok' ? 'text-copper-700' : 'text-red-700'}`}>
      {message.text}
    </span>
  );
}
