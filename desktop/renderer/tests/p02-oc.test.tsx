// ADR-037 — «المزوّدون» و«النماذج» على نمط OpenCode: الاتصال بمفتاح يُكتب في التطبيق، والمزوّد المخصّص، والقطع، ومفاتيح
// النماذج. على المضيف المقلَّد: ما يُثبت هنا أن الواجهة ترسل العمليات الصحيحة، وتفرّغ حقل المفتاح، ولا تعرض المفتاح.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { NavigationProvider, TranslatorProvider } from "../src/app/context";
import { Phase02Client } from "../src/ipc/p02-client";
import { createTranslator } from "../src/localization/translate";
import { ModelsSettings } from "../src/screens/p02/oc/ModelsSettings";
import { ProvidersSettings } from "../src/screens/p02/oc/ProvidersSettings";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase02Host } from "./support/fake-p02-host";

const en = createTranslator("en");
const KEY = "fixture-typed-key-0042";

async function settle(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function render(node: JSX.Element): { root: Root } {
  const container = resetDocument();
  const root = createRoot(container);
  const navigation = { current: undefined, requestedPath: "/", navigate: () => undefined };
  act(() => {
    root.render(
      <TranslatorProvider translator={en}>
        <NavigationProvider navigation={navigation}>{node}</NavigationProvider>
      </TranslatorProvider>,
    );
  });
  return { root };
}

function button(text: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  assert.ok(found !== undefined, `no button "${text}"`);
  return found;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

test("P02-OC-001 Providers shows connected and popular providers as OpenCode does, and connects one with a key typed in the app", async () => {
  const { transport, log } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  const { root } = render(<ProvidersSettings client={api} />);
  await settle();
  const text = () => document.body.textContent ?? "";
  assert.ok(text().includes(en.t("providers.oc.connected")));
  assert.ok(text().includes(en.t("providers.oc.popular")));
  assert.ok(text().includes("Fixture Popular A"));
  assert.ok(text().includes(en.t("providers.oc.custom.short")));
  assert.ok(text().includes(en.t("providers.oc.more")));

  // «اتصال» على أول الشائعين يفتح خطوة المفتاح.
  const firstPopular = [...document.querySelectorAll(".oc-row")].find((row) => row.textContent?.includes("Fixture Popular A"));
  assert.ok(firstPopular !== undefined);
  await click(button(en.t("providers.oc.connect"), firstPopular));
  assert.ok(text().includes(en.t("providers.oc.connect.to", { name: "Fixture Popular A" })));
  const field = document.querySelector<HTMLInputElement>(".oc-sheet input[type=password]");
  assert.ok(field !== null, "no key field");
  assert.equal(field.getAttribute("autocomplete"), "off");
  await type(field, KEY);
  await click(button(en.t("providers.oc.connect.continue")));

  // العمليات بالترتيب: المفتاح، ثم التفعيل، ثم الفحص الحقيقي. النافذة تُغلق بعد النجاح.
  const sequence = log.operations.filter((op) => op.startsWith("provider.") && op !== "provider.list" && op !== "provider.catalog");
  assert.deepEqual(sequence, ["provider.credential.put", "provider.configure", "provider.refresh"]);
  assert.deepEqual(log.storedKeys, [KEY]);
  assert.equal(document.querySelector(".oc-sheet"), null, "the dialog stayed open after a healthy check");
  assert.ok(text().includes(en.t("providers.oc.tag.key")));
  // المفتاح لا يظهر في الصفحة ولا يبقى في أي حقل.
  assert.ok(!text().includes(KEY));
  assert.ok(![...document.querySelectorAll("input")].some((input) => input.value === KEY));
  act(() => root.unmount());
});

test("P02-OC-002 a custom provider is created with declared models, then deleted only after a second confirmation", async () => {
  const { transport, log } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  const { root } = render(<ProvidersSettings client={api} />);
  await settle();
  const customRow = [...document.querySelectorAll(".oc-row")].find((row) => row.textContent?.includes(en.t("providers.oc.custom.short")));
  assert.ok(customRow !== undefined);
  await click(button(en.t("providers.oc.connect"), customRow));
  const inputs = [...document.querySelectorAll<HTMLInputElement>(".oc-sheet input")];
  const [id, name, base, , modelId] = inputs;
  assert.ok(id && name && base && modelId, "the custom form is incomplete");
  await type(id, "my-gateway");
  await type(name, "My Gateway");
  await type(base, "https://api.example.com/v1");
  await type(modelId, "fixture-chat");
  await click(button(en.t("providers.oc.custom.submit")));
  assert.ok(log.operations.includes("provider.custom.save"));
  const saved = log.envelopes.find((e) => e["operation"] === "provider.custom.save");
  assert.deepEqual((saved?.["payload"] as Record<string, unknown>)["models"], [{ model_id: "fixture-chat" }]);
  assert.equal("api_key" in ((saved?.["payload"] as Record<string, unknown>) ?? {}), false, "a key travelled with the custom provider");
  assert.equal(document.querySelector(".oc-sheet"), null);

  const row = [...document.querySelectorAll(".oc-row")].find((r) => r.textContent?.includes("My Gateway"));
  assert.ok(row !== undefined, "the custom provider is not connected");
  await click(button(en.t("providers.oc.delete"), row));
  assert.ok(!log.operations.includes("provider.custom.delete"), "deleted on the first click");
  await click(button(en.t("providers.oc.delete_confirm"), row));
  assert.ok(log.operations.includes("provider.custom.delete"));
  assert.ok(!(document.body.textContent ?? "").includes("My Gateway") || (document.body.textContent ?? "").includes(en.t("providers.oc.deleted", { name: "My Gateway" })));
  act(() => root.unmount());
});

test("QA-D4 disconnecting a provider that holds no stored key does not claim a key was removed", async () => {
  const { transport, log } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  const { root } = render(<ProvidersSettings client={api} />);
  await settle();
  const row = [...document.querySelectorAll(".oc-row")].find((r) => r.textContent?.includes("Fixture Local Server"));
  assert.ok(row !== undefined, "the local fixture provider is not listed as connected");
  await click(button(en.t("providers.oc.disconnect"), row));
  const text = document.body.textContent ?? "";
  assert.ok(!log.operations.includes("provider.credential.clear"), "a key clear was sent for a provider without a key");
  assert.ok(!text.includes(en.t("providers.oc.disconnected", { name: "Fixture Local Server" })), "the note claims a stored key was removed");
  assert.ok(text.includes(en.t("providers.oc.disconnected_no_key", { name: "Fixture Local Server" })), "no honest disconnect note");
  act(() => root.unmount());
});

test("QA-D5 the discovered-model note agrees in number in English and Arabic", () => {
  const ar = createTranslator("ar");
  assert.equal(en.plural("providers.oc.connected_note", 1, { name: "X" }), "X is connected and 1 model was discovered. Turn on the ones you want in Models.");
  assert.equal(en.plural("providers.oc.connected_note", 3, { name: "X" }), "X is connected and 3 models were discovered. Turn on the ones you want in Models.");
  assert.ok(!ar.plural("providers.oc.connected_note", 1, { name: "X" }).startsWith("providers."), "Arabic plural form missing");
});

test("P02-OC-003 Models groups models under connected providers, searches, and turns a model on with a switch", async () => {
  const { transport, log } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  await api.refreshProviders(["fixture-local"]);
  const { root } = render(<ModelsSettings client={api} onOpenProviders={() => undefined} />);
  await settle();
  const head = document.querySelector(".oc-group__head");
  assert.ok(head !== null && (head.textContent ?? "").includes("Fixture Local Server"));
  const switches = () => [...document.querySelectorAll<HTMLButtonElement>(".oc-switch")];
  assert.equal(switches().length, 2);
  assert.ok(switches().every((s) => s.getAttribute("aria-checked") === "false"));
  await click(switches()[0] as HTMLButtonElement);
  assert.ok(log.operations.includes("model.configure"));
  assert.equal(switches()[0]?.getAttribute("aria-checked"), "true");

  const search = document.querySelector<HTMLInputElement>(".oc-search input");
  assert.ok(search !== null);
  await type(search, "slow");
  assert.equal(switches().length, 1);
  await type(search, "no-such-model");
  assert.ok((document.body.textContent ?? "").includes(en.t("models.oc.no_match")));
  act(() => root.unmount());
});

// ADR-040 (الجلسة 1، 2026-10-07): نموذج المراجعة إعداد مرئي واختياري. يبدأ فارغًا (لا مراجِع خفيّ)، ويُختار من أيّ صنف،
// ويُمسح. قِيس قبل الإصلاح: كان مخزّنًا بلا واجهة فأرسل عمل نموذج محلي إلى مزوّد API لم يره المستخدم.
test("S1-UI-001 the optional reviewer is visible, empty until chosen, settable to any enabled model and clearable", async () => {
  const { transport, log } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  await api.refreshProviders(["fixture-local"]);
  const listed = await api.listModels({});
  const first = listed.ok ? listed.value.models.find((m) => m.kind !== "EMBEDDING") : undefined;
  assert.ok(first !== undefined);
  await api.configureModel(first.model_id, true);
  const { root } = render(<ModelsSettings client={api} onOpenProviders={() => undefined} />);
  await settle();
  const select = () => document.querySelector<HTMLSelectElement>("#oc-reviewer");
  assert.ok(select() !== null, "the reviewer control is missing");
  assert.equal(select()?.value, "", "a reviewer is set before the user chose one");
  assert.ok((document.body.textContent ?? "").includes(en.t("models.review_model.hint")));
  const pick = async (value: string) => {
    await act(async () => {
      const element = select() as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  };
  await pick(first.model_id);
  const sent = log.envelopes.filter((e) => e["operation"] === "model.preferences.set").map((e) => e["payload"] as Record<string, unknown>);
  assert.deepEqual(sent.at(-1), { review_model_id: first.model_id });
  assert.equal(select()?.value, first.model_id);
  await pick("");
  const cleared = log.envelopes.filter((e) => e["operation"] === "model.preferences.set").map((e) => e["payload"] as Record<string, unknown>);
  assert.deepEqual(cleared.at(-1), { review_model_id: null });
  assert.equal(select()?.value, "");
  act(() => root.unmount());
});
