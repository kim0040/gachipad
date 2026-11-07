import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { type APIRequestContext, request } from "@playwright/test";
import * as Y from "yjs";

/**
 * Simulated participants for the browser perf specs: each is a person with their own session who
 * joins a share over the collab protocol, like a browser tab without the rendering. Writers type
 * at the end of the text and move their cursor with it; viewers move their cursor around. `startInView`
 * keeps all of that inside the first lines of a short text, so every cursor is in the browser's view.
 */

export const PERF_URL = process.env.E2E_PERF_URL ?? "http://localhost:8850";

export interface Member {
  shareId: string;
  /** Join body: the edit key for an editor, nothing for a viewer or an owner. */
  body: Record<string, unknown>;
  writer: boolean;
  /** An existing session (a lab student who already joined), else a new one. */
  api?: APIRequestContext;
}

interface Sim {
  api: APIRequestContext;
  provider: HocuspocusProvider;
  socket: HocuspocusProviderWebsocket;
  doc: Y.Doc;
  text: Y.Text;
  user: { clientId: string; name: string; color: string };
  writer: boolean;
  /** What the editor's awareness bridge publishes: every move is real activity. */
  moved: number;
}

/** A short text of code that fits one screen, with an empty last line for the browser to type on. */
export const FIXTURE_LINES = 24;
export const FIXTURE = `${Array.from(
  { length: FIXTURE_LINES },
  (_, i) => `const value${i + 1} = compute(${i + 1}, "visible");`,
).join("\n")}\n`;
/** A writer starts a fresh line once its own has grown this long, so the text stays bounded. */
const LINE_MAX = 56;

export async function newSession(name: string): Promise<APIRequestContext> {
  const api = await request.newContext({
    baseURL: PERF_URL,
    extraHTTPHeaders: { "X-Gachipad": "1" },
  });
  const response = await api.patch("/api/session", { data: { name } });
  if (!response.ok()) throw new Error(`session ${response.status()}`);
  return api;
}

export class SimClients {
  private readonly sims: Sim[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];

  static async join(members: Member[]): Promise<SimClients> {
    const clients = new SimClients();
    await Promise.all(members.map((member, i) => clients.connect(member, `sim${i + 1}`)));
    return clients;
  }

  private async connect(member: Member, name: string): Promise<void> {
    const api = member.api ?? (await newSession(name));
    const session = (await (await api.get("/api/session")).json()) as {
      clientId: string;
      name: string;
      color: string;
    };
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({
      url: `${PERF_URL.replace(/^http/, "ws")}/collab?doc=${member.shareId}`,
    });
    const token = async () => {
      const joined = await api.post(`/api/shares/${member.shareId}/join`, { data: member.body });
      if (!joined.ok()) throw new Error(`join ${joined.status()}`);
      return ((await joined.json()) as { token: string }).token;
    };
    await new Promise<void>((resolve) => {
      const provider = new HocuspocusProvider({
        websocketProvider: socket,
        name: member.shareId,
        document: doc,
        token,
        onSynced: ({ state }) => {
          if (state) resolve();
        },
      });
      provider.attach();
      this.sims.push({
        api,
        provider,
        socket,
        doc,
        text: doc.getText("file:main"),
        user: { clientId: session.clientId, name: session.name, color: session.color },
        writer: member.writer,
        moved: 0,
      });
    });
  }

  /** Puts every cursor somewhere in the text, so the browser draws all of them. */
  placeCursors(): void {
    for (const sim of this.sims) this.moveCursor(sim);
  }

  /** Fills an empty text with `text`, once. */
  seed(text: string): void {
    const first = this.sims[0];
    if (first && first.text.length === 0) first.doc.transact(() => first.text.insert(0, text));
  }

  /**
   * Like `start`, but inside the first `lines` lines of the text, which never grows: each writer
   * rewrites a line of its own and every `selecting`th viewer holds a selection, not just a cursor.
   * Every cursor is placed at once.
   */
  startInView(rates: { typeRate: number; cursorRate: number }, lines: number, selecting: number) {
    let writers = 0;
    let viewers = 0;
    for (const sim of this.sims) {
      const perSecond = sim.writer ? rates.typeRate : rates.cursorRate;
      let tick: () => void;
      if (sim.writer) {
        const line = writers++ % lines;
        let next = 0;
        tick = () => {
          next = (next + 1) % INLINE.length;
          const word = INLINE[next] as string;
          const text = sim.text.toString();
          const [start, end] = lineRange(text, line);
          let at = end;
          sim.doc.transact(() => {
            if (end - start > LINE_MAX) {
              sim.text.delete(start, end - start);
              at = start;
            }
            sim.text.insert(at, word);
          });
          this.moveCursor(sim, at + word.length);
        };
      } else {
        const selects = viewers++ % selecting === 0;
        tick = () => {
          const [start, end] = lineRange(sim.text.toString(), Math.floor(Math.random() * lines));
          const anchor = start + Math.floor(Math.random() * (end - start + 1));
          let head = selects ? Math.min(end, anchor + 4 + Math.floor(Math.random() * 16)) : anchor;
          if (selects && head === anchor) head = Math.max(start, anchor - 6);
          this.moveCursor(sim, head, anchor);
        };
      }
      tick();
      if (perSecond <= 0) continue;
      this.timers.push(
        setTimeout(
          () => this.timers.push(setInterval(tick, 1000 / perSecond)),
          Math.random() * (1000 / perSecond),
        ),
      );
    }
  }

  /** Writers type `typeRate` keys per second; everyone else moves `cursorRate` times per second. */
  start(rates: { typeRate: number; cursorRate: number }): void {
    for (const sim of this.sims) {
      const perSecond = sim.writer ? rates.typeRate : rates.cursorRate;
      if (perSecond <= 0) continue;
      let next = 0;
      const tick = sim.writer
        ? () => {
            next = (next + 1) % WORDS.length;
            sim.doc.transact(() => sim.text.insert(sim.text.length, WORDS[next] as string));
            this.moveCursor(sim, sim.text.length);
          }
        : () => this.moveCursor(sim);
      this.timers.push(
        setTimeout(
          () => this.timers.push(setInterval(tick, 1000 / perSecond)),
          Math.random() * (1000 / perSecond),
        ),
      );
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async close(): Promise<void> {
    this.stop();
    for (const sim of this.sims) {
      sim.provider.destroy();
      sim.socket.destroy();
    }
    await Promise.all(this.sims.map((sim) => sim.api.dispose()));
  }

  /** Moves the cursor the way the editor's awareness bridge does; to a random place by default. */
  private moveCursor(
    sim: Sim,
    index = Math.floor(Math.random() * (sim.text.length + 1)),
    anchorIndex = index,
  ): void {
    const position = (at: number) =>
      Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(sim.text, at));
    sim.provider.awareness?.setLocalState({
      user: sim.user,
      fileId: "main",
      cursor: { anchor: position(anchorIndex), head: position(index) },
      viewport: { fromLine: 1, toLine: 40 },
      moved: ++sim.moved,
    });
  }
}

/** Code-like keystrokes, with a new line now and then so the text grows downwards too. */
const WORDS = ["let ", "x", " = ", "1", ";", "\n", "if ", "(", "y", ") ", "{", "}", "\n"];
const INLINE = WORDS.filter((word) => word !== "\n");

/** Offsets of the start and end (before the line break) of line `line`, counting from 0. */
function lineRange(text: string, line: number): [number, number] {
  let start = 0;
  for (let i = 0; i < line; i++) start = text.indexOf("\n", start) + 1;
  const end = text.indexOf("\n", start);
  return [start, end === -1 ? text.length : end];
}
