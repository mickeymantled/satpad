// Alerts (SPEC "Keeper service → Rules"): Telegram bot message. No-op when unconfigured so the fork runs silent.
export interface Alerter { alert(title: string, body: string): Promise<void> }

export const noopAlerter: Alerter = { alert: async () => {} };

export class TelegramAlerter implements Alerter {
  constructor(private readonly token: string, private readonly chatId: string, private readonly fetchFn: typeof fetch = fetch) {}
  async alert(title: string, body: string): Promise<void> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text: `*${title}*\n${body}`.slice(0, 4000), parse_mode: "Markdown" }),
    });
    if (!res.ok) throw new Error(`telegram ${res.status}`);
  }
}
