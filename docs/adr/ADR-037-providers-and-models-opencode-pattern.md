# ADR-037 — Providers and models on the OpenCode pattern: catalog, in-app key, custom provider

- **Status:** Accepted (2026-10-06).
- **Owner request (2026-10-06):** redesign "Providers" and "Models" to match OpenCode's settings exactly. Provide API access to Anthropic, OpenAI, DeepSeek, Qwen, Groq, Z.ai, xAI, MiniMax, Kimi, NVIDIA, Meta, OpenRouter and the rest, plus a custom provider.
- **Owner decision (2026-10-06):** the API key is typed in a field inside the app, as in OpenCode. This replaces the Windows credential prompt for this flow.

## What was observed in OpenCode (desktop v1.18.15, read only)

Settings is a dialog with a sidebar. "Providers" and "Models" are two pages in it.

**Providers page:**

- **"Connected providers":** one card of rows. Each row has an icon, a name, a small framed tag ("API key" or "custom") and a text button, "Disconnect".
- **"Popular providers":** rows with an icon, a name, a one-line description and a "+ Connect" button. The last row is "Custom provider".
- A link, "Show more providers".

**Connect dialog:**

- A search field.
- A "Popular" section.
- An "Other" section: the custom OpenAI-compatible provider first, then every other provider alphabetically.

**Provider steps:**

- **Key provider:** a back arrow and a close button. Then the provider icon and "Connect to X", one sentence, "X API key", a field and "Continue".
- **Custom provider:**
  - provider ID (lowercase, digits, dashes);
  - display name;
  - base URL;
  - API key ("optional");
  - models (ID and name, "Add model");
  - headers (optional);
  - "Submit".

**Models page:**

- A search field.
- One collapsible group per connected provider: icon, name and caret.
- Inside each group, a card of model rows: the name and a small switch.

OpenCode's provider list comes from models.dev.

## Decisions

### D1 — A dated catalog, outside the source

`tools/provider-catalog/generate.mjs` reduces a snapshot of `https://models.dev/api.json` (retrieved 2026-10-06) to `desktop/host/providers/data/hosted-catalog.json`. That file is read with `include_str!`.

**A provider enters the catalog when:**

- it speaks the OpenAI-compatible protocol at a fixed `https` address;
- the address carries no template variable;
- the address is not loopback.

That gives 192 providers.

**Eleven more providers** need a special SDK in the snapshot, so their compatible addresses were taken from their official documentation, and the source is written next to each:

| Provider | Address |
|---|---|
| Groq | `…/openai/v1` |
| xAI | |
| Mistral | |
| Together | |
| Cerebras | |
| DeepInfra | `…/v1/openai` |
| Cohere | `…/compatibility/v1` |
| Perplexity | |
| MiniMax | `api.minimax.io/v1` |
| Venice | |
| Vercel AI Gateway | |

**What the snapshot supplies besides addresses:**

- **Documented models.** They name discovered models and fill unknown limits and capabilities. Every such fact is marked `STATIC_DESCRIPTOR`. Nothing reported by the provider or measured is overwritten.
- **The "popular" order.**

**Why the data lives outside the source:** the product must not name models in its source (P01 and P02 conformance). The catalog is data, and the checks stay true on their scope.

**Endpoints and kinds:**

- A catalogued provider is `OPENAI_COMPATIBLE_API`.
- Its endpoint is fixed, `https` only, with its host as the only allowed remote host.
- Each resolved address must be public, as for every remote provider.
- It is off until the user connects it.
- The adapter flavour `HostedGeneric` asks `/models` and `/chat/completions` under the versioned base.
- A `400` that names `stream_options` or `response_format` is retried once without that field. Cohere documents refusing `stream_options`.

### D2 — The key is typed in the app (owner decision)

`provider.credential.put` carries `{provider_id, api_key}`. The host does the following:

- builds a `SecretValue` from it;
- writes it to the Windows credential store, under the same target as before;
- drops and zeroizes the value.

**What the reply carries:** a status, never the value.

**The audit record:**

- names the source as `IN_APP_FIELD`;
- carries no value.

**What the renderer does:**

- clears the field when the request is sent, whether it succeeds or fails;
- uses `type="password"`, `autocomplete="off"` and no spell check.

**The secret-hygiene exception is narrow:**

- The contract's secret scan skips exactly `/payload/api_key` of exactly `provider.credential.put`.
- A test proves that a key-shaped value is still refused in any other field of this payload, in any other operation, and in every result.
- `provider.custom.save` cannot carry a key field.

**What this gives up:** the renderer used to never see a key. Now it holds one in memory for the duration of the field. This is the owner's choice. The environment-variable source and the Windows prompt operation (`provider.credential.set`) remain.

### D3 — The custom provider

`provider.custom.save` stores four things in table `provider_custom` (schema v13):

- the ID;
- the name;
- the base URL;
- up to 64 declared models.

**The base URL must be one of:**

- a public `https` address, resolved at connect time with private addresses refused;
- `http` or `https` on loopback.

**Refused:**

- a private-network address;
- plain `http` to another computer;
- credentials in the URL;
- a query string;
- an ID taken by a built-in or catalogued provider.

**Other properties:**

- The key is optional (`OPTIONAL_API_KEY`).
- Declared models appear even when the server does not answer `/models`.
- Deleting a custom provider removes its settings, models and stored key.

**Not built: custom headers.** They would need dynamic header names in the HTTP layer, and the form does not show a field that would do nothing.

### D4 — Lists stay small

`provider.list` now returns:

- the seven built-in providers;
- every provider the user has configured;
- the custom providers.

It no longer walks 200 catalog entries, which would mean 200 credential-store reads per refresh.

`provider.catalog` returns the whole catalog for the connect dialog. Each entry is light: the name, kind, locality and popular rank, plus two facts about the key:

- whether the official environment variable holds a value, without reading the value;
- whether the provider is enabled.

The four new operations are registered at envelope 1.7 in the Phase-08 registry, as `project.delete` was. The router sends them to the provider layer.

### D5 — The UI

| Element | Where it lives |
|---|---|
| "Providers" and "Models" | pages of the settings dialog (`screens/p02/oc/`) |
| `/providers` and `/models` | open the dialog on those pages |
| "Manage models" in the model picker | opens "Models" |

**Connected rows:** a provider that is connected but failing its measured check says so under its name, for example "Key refused — the provider refused the key".

**Models page:** the default model and "where models may run" stay as two rows under "Preferences".

**Icons:** the letter of the name. Brand logos were not downloaded.

## Evidence

| Suite | Result |
|---|---|
| Providers crate | 102 of 102 |
| Core | Includes three gateway tests, listed below |
| Contracts | 637 of 637, including P08-CT-040 for the secret exception |
| Renderer | 199 of 199 |

The three gateway tests:

- **The catalog:** it lists more than 150 providers without a key value, and the list stays at seven.
- **A key typed in the app:** it reaches a fixture provider as `Bearer` on the versioned path and never comes back. A documented model is named from the catalog, with provenance `STATIC_DESCRIPTOR`.
- **A custom loopback provider:** it is created, discovered (served plus declared), invoked and deleted. A private address, a built-in ID and a remote `http` address are refused.

**Not measured:** a real call to any hosted provider. That needs the owner's key.
