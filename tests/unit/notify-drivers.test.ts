import { afterEach, describe, expect, it, vi } from "vitest";
import { emailDriver, RESEND_URL } from "@/lib/notify/email";
import { whatsappDriver } from "@/lib/notify/whatsapp";
import { normalizeBrPhone } from "@/lib/notify/phone";
import { renderAnnouncementEmail, renderAnnouncementWhatsapp } from "@/lib/notify/templates";

// spec 033 US2 — drivers de entrega. fetch sempre mockado: nenhum teste
// fala com Resend/Evolution de verdade.

const msg = {
  to: "ana@t.dev",
  subject: "[Edição] Credenciamento 8h",
  html: "<p>oi</p>",
  text: "oi",
  idempotencyKey: "announcement-1-member-2-email",
  unsubscribeUrl: "https://hackahub.dev/perfil#contato",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(status = 200, body = "{}") {
  const fn = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("emailDriver (Resend)", () => {
  it("sem RESEND_API_KEY é driver log: skipped com motivo e zero rede", async () => {
    const fetchFn = mockFetch();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const d = emailDriver({});
    expect(d.name).toBe("log");
    const out = await d.send(msg);
    expect(out).toEqual({ status: "skipped", reason: expect.stringContaining("RESEND_API_KEY") });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("formato exato do request: POST JSON, Bearer, Idempotency-Key, from/to/subject/html/text", async () => {
    const fetchFn = mockFetch(200, '{"id":"re_1"}');
    const d = emailDriver({ RESEND_API_KEY: "re_test_key", HACKAHUB_EMAIL_FROM: "Hack Inova <avisos@hackinova.dev>" });
    expect(d.name).toBe("resend");
    expect(await d.send(msg)).toEqual({ status: "sent" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_URL);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
      "Idempotency-Key": "announcement-1-member-2-email",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Hack Inova <avisos@hackinova.dev>",
      to: ["ana@t.dev"],
      subject: "[Edição] Credenciamento 8h",
      html: "<p>oi</p>",
      text: "oi",
      headers: { "List-Unsubscribe": "<https://hackahub.dev/perfil#contato>" },
    });
  });

  it("422 é falha permanente; 500 é falha que pode tentar de novo", async () => {
    mockFetch(422, '{"message":"invalid to"}');
    const d = emailDriver({ RESEND_API_KEY: "k" });
    expect(await d.send(msg)).toMatchObject({ status: "failed", permanent: true, error: expect.stringContaining("422") });
    mockFetch(500);
    expect(await d.send(msg)).toMatchObject({ status: "failed", permanent: false });
  });

  it("erro de rede vira failed (driver nunca lança)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const out = await emailDriver({ RESEND_API_KEY: "k" }).send(msg);
    expect(out).toMatchObject({ status: "failed", error: expect.stringContaining("ECONNRESET") });
  });
});

describe("whatsappDriver (Evolution)", () => {
  const env = { EVOLUTION_URL: "https://evo.test/", EVOLUTION_INSTANCE: "hackinova", EVOLUTION_API_KEY: "evo_key" };

  it("sem env é driver log: skipped e zero rede", async () => {
    const fetchFn = mockFetch();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const d = whatsappDriver({ EVOLUTION_URL: "https://evo.test" });
    expect(d.name).toBe("log");
    expect((await d.send({ number: "5511999999999", text: "x" })).status).toBe("skipped");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("formato exato: POST {URL}/message/sendText/{INSTANCE}, header apikey, body {number,text}", async () => {
    const fetchFn = mockFetch(201);
    const out = await whatsappDriver(env).send({ number: "5511999999999", text: "aviso" });
    expect(out).toEqual({ status: "sent" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://evo.test/message/sendText/hackinova");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ apikey: "evo_key", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ number: "5511999999999", text: "aviso" });
  });

  it("nunca manda pra grupo: JID @g.us é recusado sem rede", async () => {
    const fetchFn = mockFetch();
    const out = await whatsappDriver(env).send({ number: "120363000000000000@g.us", text: "x" });
    expect(out).toMatchObject({ status: "failed", permanent: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("normalizeBrPhone", () => {
  it.each([
    ["(11) 99999-9999", "5511999999999"],
    ["+55 11 99999-9999", "5511999999999"],
    ["5511999999999", "5511999999999"],
    ["11 3333-4444", "551133334444"],
  ])("%s → %s", (input, out) => expect(normalizeBrPhone(input)).toBe(out));

  it.each(["", "123", "+1 415 555 0100", "(01) 99999-9999", "11 1234-5678", "5511899999999", null])(
    "%s é inválido",
    (input) => expect(normalizeBrPhone(input)).toBeNull(),
  );
});

describe("templates do aviso", () => {
  const a = {
    hackathonId: "hack-x",
    hackathonName: "Hack <X>",
    title: "Credenciamento <b>8h</b>",
    body: "Traga documento.\n\nSegundo parágrafo & fim.",
  };

  it("e-mail: assunto com a edição, HTML escapado, link da edição e rodapé de preferências", () => {
    const { subject, html, text } = renderAnnouncementEmail(a);
    expect(subject).toBe("[Hack <X>] Credenciamento <b>8h</b>");
    expect(html).toContain("Credenciamento &lt;b&gt;8h&lt;/b&gt;");
    expect(html).not.toContain("<b>8h</b>");
    expect(html).toContain("Segundo parágrafo &amp; fim.");
    expect(html).toContain("/h/hack-x#avisos");
    expect(html).toContain("/perfil#contato");
    expect(html).toContain("#047a43");
    expect(text).toContain("Traga documento.");
    expect(text).toContain("/h/hack-x#avisos");
    expect(text).toContain("Preferências de contato");
  });

  it("WhatsApp: texto puro com link e como parar", () => {
    const t = renderAnnouncementWhatsapp(a);
    expect(t).toContain("*Credenciamento <b>8h</b>*");
    expect(t).toContain("/h/hack-x#avisos");
    expect(t).toContain("/perfil#contato");
  });
});
