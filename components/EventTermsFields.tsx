"use client";

import Link from "next/link";

// frente L — o que a inscrição pede além das perguntas da edição: data de
// nascimento (idade mínima), responsável pra menor, restrição alimentar,
// aceite do código de conduta e a caixa SEPARADA de uso de imagem. Nada vem
// marcado; recusar imagem não muda nada na inscrição.

export const DIET_CHOICES = ["vegetariano", "vegano", "sem glúten", "sem lactose"] as const;

export type TermsConfig = {
  hackathonId: string;
  minAge: number;
  dietEnabled: boolean;
  conductVersion: number;
  /** "YYYY-MM-DD" do início do evento */
  eventDay: string;
  imagePurpose: string;
  /** o e-mail da plataforma está ligado? (sem ele o responsável não recebe nada) */
  emailEnabled: boolean;
};

export type TermsValue = {
  birthDate: string;
  guardianName: string;
  guardianEmail: string;
  guardianAccepted: boolean;
  diet: string[];
  allergies: string;
  allergySevere: boolean;
  conduct: boolean;
  imageUse: boolean;
};

export const EMPTY_TERMS: TermsValue = {
  birthDate: "",
  guardianName: "",
  guardianEmail: "",
  guardianAccepted: false,
  diet: [],
  allergies: "",
  allergySevere: false,
  conduct: false,
  imageUse: false,
};

export function ageOnDay(birth: string, day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  const [by, bm, bd] = birth.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

/** corpo `terms` da API de inscrição */
export function termsPayload(cfg: TermsConfig, v: TermsValue) {
  const age = ageOnDay(v.birthDate, cfg.eventDay);
  const minor = age !== null && age < 18;
  return {
    birthDate: v.birthDate,
    conduct: v.conduct,
    conductVersion: cfg.conductVersion,
    imageUse: v.imageUse,
    ...(minor
      ? { guardian: { name: v.guardianName, email: v.guardianEmail, accepted: v.guardianAccepted } }
      : {}),
    ...(cfg.dietEnabled
      ? { diet: v.diet, allergies: v.allergies, allergySevere: v.allergySevere && v.allergies.trim() !== "" }
      : {}),
  };
}

const field =
  "w-full rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2.5 text-[16px] text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none";
const label = "font-mono text-[12px] tracking-widest text-muted uppercase";

/** nascimento, responsável (menor) e dieta — antes do aceite LGPD */
export function TermsPersonalFields({
  cfg,
  value: v,
  onChange,
  birthDateError,
}: {
  cfg: TermsConfig;
  value: TermsValue;
  onChange: (patch: Partial<TermsValue>) => void;
  /** erro da validação do formulário (aparece embaixo do campo) */
  birthDateError?: string;
}) {
  const age = ageOnDay(v.birthDate, cfg.eventDay);
  const below = age !== null && age < cfg.minAge;
  const minor = age !== null && !below && age < 18;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6" data-testid="terms-personal">
      <fieldset className="flex flex-col gap-2 border-t border-line pt-4">
        <legend className="sr-only">idade</legend>
        <label htmlFor="birthDate" className="text-[17px] leading-snug font-bold">
          Data de nascimento<span className="ml-1 text-orange" aria-hidden="true">*</span>
          <span className="sr-only"> (obrigatória)</span>
        </label>
        <input
          id="birthDate"
          name="birthDate"
          data-field="birthDate"
          type="date"
          required
          aria-invalid={birthDateError ? true : undefined}
          max={today}
          min="1900-01-01"
          className={`${field} sm:max-w-60`}
          value={v.birthDate}
          onChange={(e) => onChange({ birthDate: e.target.value })}
          aria-describedby={birthDateError ? "birthDate-err birthDate-help" : "birthDate-help"}
        />
        {birthDateError && (
          <p id="birthDate-err" className="font-mono text-[13px] text-orange">
            {birthDateError}
          </p>
        )}
        <p id="birthDate-help" className="text-[13px] leading-snug text-muted">
          {cfg.minAge >= 18
            ? `Esta edição é para maiores de ${cfg.minAge} anos na data do evento.`
            : `Esta edição aceita a partir de ${cfg.minAge} anos; menor de 18 precisa de um responsável legal.`}{" "}
          Usamos a data só pra checar a idade: a organização vê a sua idade no evento, não a data.
        </p>
        {below && (
          <p role="alert" className="border-[1.5px] border-orange p-3 text-[14px] leading-snug text-orange" data-testid="under-age">
            {`Esta edição é para quem tem ${cfg.minAge} anos ou mais na data do evento. Pela data informada, você ainda não pode se inscrever nela.`}
          </p>
        )}
      </fieldset>

      {minor && (
        <fieldset className="flex flex-col gap-3 border-[1.5px] border-line p-4" data-testid="guardian-fields">
          <legend className="px-1 text-[15px] font-bold">Responsável legal</legend>
          <p className="text-[13px] leading-snug text-muted">
            {cfg.emailEnabled
              ? `Você tem ${age} anos na data do evento. Informe quem responde por você: essa pessoa recebe um e-mail com os detalhes da edição e pode cancelar a inscrição se não tiver autorizado.`
              : `Você tem ${age} anos na data do evento. Informe quem responde por você: a organização guarda esse contato e fala com essa pessoa se precisar.`}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className={label}>nome completo</span>
            <input
              className={field}
              maxLength={120}
              autoComplete="off"
              value={v.guardianName}
              onChange={(e) => onChange({ guardianName: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>e-mail</span>
            <input
              className={field}
              type="email"
              maxLength={200}
              autoComplete="off"
              value={v.guardianEmail}
              onChange={(e) => onChange({ guardianEmail: e.target.value })}
            />
          </label>
          <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-snug">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
              checked={v.guardianAccepted}
              onChange={(e) => onChange({ guardianAccepted: e.target.checked })}
            />
            <span>
              Meu responsável legal conhece e autorizou minha participação nesta edição.
              {cfg.emailEnabled && " Sei que ele ou ela vai receber um e-mail de confirmação."}
            </span>
          </label>
        </fieldset>
      )}

      {cfg.dietEnabled && (
        <fieldset className="flex flex-col gap-3 border-t border-line pt-4" data-testid="diet-fields">
          <legend className="flex items-baseline gap-2 text-[17px] leading-snug font-bold">
            Restrição alimentar
            <span className="font-mono text-[12px] font-normal text-muted">opcional</span>
          </legend>
          <div role="group" aria-label="restrição alimentar" className="flex flex-wrap gap-2">
            {DIET_CHOICES.map((o) => {
              const on = v.diet.includes(o);
              return (
                <label
                  key={o}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[6px] border-[1.5px] px-3.5 py-2 text-[15px] ${
                    on ? "border-accent bg-mint font-semibold text-accent" : "border-line"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-[#047a43]"
                    checked={on}
                    onChange={() => onChange({ diet: on ? v.diet.filter((x) => x !== o) : [...v.diet, o] })}
                  />
                  {o}
                </label>
              );
            })}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={label}>alergias ou intolerâncias</span>
            <input
              className={field}
              maxLength={500}
              placeholder="ex.: amendoim, camarão"
              value={v.allergies}
              onChange={(e) => onChange({ allergies: e.target.value })}
            />
          </label>
          {v.allergies.trim() && (
            <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-snug">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
                checked={v.allergySevere}
                onChange={(e) => onChange({ allergySevere: e.target.checked })}
              />
              <span>É alergia grave (risco de reação séria). A organização avisa o buffet com destaque.</span>
            </label>
          )}
        </fieldset>
      )}
    </div>
  );
}

/** aceite do código de conduta (obrigatório) e uso de imagem (opcional, separado) */
export function TermsAcceptBoxes({
  cfg,
  value: v,
  onChange,
  conductInvalid = false,
}: {
  cfg: TermsConfig;
  value: TermsValue;
  onChange: (patch: Partial<TermsValue>) => void;
  conductInvalid?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label
        className={`flex cursor-pointer items-start gap-3 border-[1.5px] p-3.5 text-[13px] leading-snug ${
          conductInvalid ? "border-orange" : "border-line"
        }`}
      >
        <input
          type="checkbox"
          name="conduct"
          data-field="conduct"
          aria-required="true"
          aria-invalid={conductInvalid || undefined}
          className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
          checked={v.conduct}
          onChange={(e) => onChange({ conduct: e.target.checked })}
        />
        <span className="min-w-0">
          Li e aceito o{" "}
          <Link href={`/h/${cfg.hackathonId}/conduta`} target="_blank" className="text-accent underline">
            código de conduta desta edição
          </Link>{" "}
          (versão {cfg.conductVersion}).<span className="ml-1 text-orange" aria-hidden="true">*</span>
          <span className="sr-only"> (obrigatório)</span>
        </span>
      </label>
      <label
        className="flex cursor-pointer items-start gap-3 border-[1.5px] border-dashed border-line p-3.5 text-[13px] leading-snug"
        data-testid="image-consent-box"
      >
        <input
          type="checkbox"
          name="imageUse"
          className="mt-0.5 size-5 shrink-0 accent-[#047a43]"
          checked={v.imageUse}
          onChange={(e) => onChange({ imageUse: e.target.checked })}
        />
        <span className="min-w-0">
          <span className="mb-1 block font-mono text-[11px] tracking-widest text-muted uppercase">
            uso de imagem · opcional
          </span>
          {cfg.imagePurpose} Se não marcar, nada muda na sua inscrição: seu crachá sai com um sinal pra equipe de foto
          evitar você.
        </span>
      </label>
    </div>
  );
}
