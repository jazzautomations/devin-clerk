import { expect, test } from "@playwright/test";

// BDD da arena ao vivo — spec 016. Página pública, sem login.
// hack-inova-alphaville-2026: edição futura do seed (startsAt 2026-11-14,
// deadline null → fase "open", countdown pro startsAt).

const HID = "hack-inova-alphaville-2026";

test.describe("arena ao vivo — edição futura parece viva", () => {
  test("faixa de arena: fase, countdown DD:HH:MM:SS e N inscritos", async ({
    page,
  }) => {
    await page.goto(`/h/${HID}`);
    const strip = page.getByTestId("arena-strip");
    await expect(strip).toBeVisible();

    // fase legível (Alphaville: "inscrições abertas")
    await expect(strip.getByTestId("arena-phase")).toContainText(
      /inscrições abertas|inscrições encerradas|começando/,
    );

    // countdown com rótulo e dígitos DD:HH:MM:SS já no SSR
    const cd = strip.getByTestId("arena-countdown");
    await expect(cd).toContainText(/começa em|inscrições fecham em/);
    await expect(cd.getByTestId("arena-countdown-digits")).toHaveText(
      /\d{2}:\d{2}:\d{2}:\d{2}/,
    );

    // prova social: contagem de inscritos (singular/plural)
    await expect(strip.getByTestId("arena-attendees")).toContainText(
      /\d+ inscritos?/,
    );
  });

  test("countdown ticka de verdade no cliente", async ({ page }) => {
    await page.goto(`/h/${HID}`);
    const digits = page.getByTestId("arena-countdown-digits");
    const before = await digits.innerText();
    // hydration pode demorar num dev server frio — poll generoso
    await expect
      .poll(async () => digits.innerText(), { timeout: 10_000 })
      .not.toBe(before);
  });

  test("edição passada NÃO mostra faixa de arena", async ({ page }) => {
    await page.goto("/h/hack-inova-unifacens-2026");
    await expect(page.getByTestId("arena-strip")).toHaveCount(0);
    // arquivo continua intacto
    await expect(page.getByText("resultado")).toBeVisible();
  });
});
