// Browser host for the Vitium reporter. It is the only module that touches the
// DOM, network, timers, randomness or the challenge widget. It turns DOM events
// into semantic events, runs the pure transition (state.mjs), applies the pure
// projection (view.mjs) and performs the requested effects. In the Limen
// migration this file becomes the Limen BrowserKernel configuration plus
// bindings (docs/ux/LIMEN-MIGRATION-PLAN.md).
import { initialState, transition, TEXT_FIELDS } from "./state.mjs";
import { project, applyView } from "./view.mjs";
import { resolveChannel, makeHttpPerformer } from "./private-intake.mjs";
import { publicIntake } from "./public-config.mjs";

export function startReporter({ doc, win, config, effects }) {
  const channel = resolveChannel(config);
  if (channel === "private") mountPrivateUi(doc);

  let state = initialState(channel);
  let view = null;

  const render = () => {
    const next = project(state);
    applyView(doc, next, view);
    view = next;
  };

  const dispatch = event => {
    const { state: nextState, effects: requested } = transition(state, event);
    state = nextState;
    render();
    for (const effect of requested) runEffect(effect);
  };

  function runEffect(effect) {
    switch (effect.kind) {
      case "PerformHttp":
        effects.performHttp(effect.request).then(
          outcome => dispatch({ type: "SubmitCompleted", correlationId: effect.request.correlationId, outcome }),
          () => dispatch({ type: "SubmitCompleted", correlationId: effect.request.correlationId, outcome: { kind: "OutcomeUnknown", reason: "connection-lost" } })
        );
        break;
      case "RenderChallenge":
        effects.challenge.render({
          onToken: token => dispatch({ type: "ChallengeSolved", token }),
          onExpired: () => dispatch({ type: "ChallengeExpired" }),
          onUnavailable: () => dispatch({ type: "ChallengeUnavailable" })
        });
        break;
      case "ResetChallenge":
        effects.challenge.reset();
        break;
      default:
        break;
    }
  }

  const form = doc.getElementById("defect-form");
  const readValues = () => {
    const data = new FormData(form);
    const values = Object.fromEntries(TEXT_FIELDS.map(field => [field, String(data.get(field) ?? "")]));
    return { ...values, privacyAcknowledged: doc.getElementById("privacyAcknowledged").checked };
  };

  form.addEventListener("input", event => {
    const target = event.target;
    if (!target?.name) return;
    dispatch({ type: "FieldChanged", field: target.name, value: target.type === "checkbox" ? target.checked : target.value });
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    dispatch({ type: "ReviewRequested", values: readValues(), requestId: effects.newRequestId() });
  });
  doc.getElementById("edit").addEventListener("click", () => dispatch({ type: "EditRequested" }));
  doc.getElementById("cancel-review").addEventListener("click", () => dispatch({ type: "CancelRequested" }));
  doc.getElementById("submit-link").addEventListener("click", () => dispatch({ type: "HandoffOpened" }));
  doc.getElementById("feedback").addEventListener("click", event => {
    const link = event.target.closest?.("a[data-error-for]");
    if (!link) return;
    event.preventDefault();
    const control = doc.getElementById(link.dataset.errorFor);
    if (!control) return;
    const details = control.closest("details");
    if (details) details.open = true;
    control.focus();
  });
  if (channel === "private") {
    doc.getElementById("submit-private").addEventListener("click", () => dispatch({ type: "SubmitRequested" }));
    doc.getElementById("report-another").addEventListener("click", () => dispatch({ type: "ResetRequested" }));
  }

  render();
  doc.documentElement.dataset.vitiumReady = "true";
  return { getState: () => state, dispatch };
}

function mountPrivateUi(doc) {
  const insert = (templateId, slotId) => {
    const template = doc.getElementById(templateId);
    const slot = doc.getElementById(slotId);
    if (template && slot) slot.replaceWith(template.content.cloneNode(true));
  };
  insert("private-review-template", "private-slot");
  insert("private-submit-template", "private-submit-slot");
  insert("private-result-template", "private-result-slot");
  doc.getElementById("github-foot").hidden = true;
  doc.getElementById("existing-reports-link").hidden = true;
}

// Cloudflare Turnstile adapter (effect). Only constructed when the private
// channel is enabled; never loaded otherwise.
export function makeTurnstileChallenge({ doc, win, siteKey }) {
  let widgetId = null;
  let loading = null;
  const load = () => {
    if (win.turnstile) return Promise.resolve();
    loading ??= new Promise((resolve, reject) => {
      const script = doc.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", reject, { once: true });
      doc.head.appendChild(script);
    }).finally(() => { loading = null; });
    return loading;
  };
  return {
    render({ onToken, onExpired, onUnavailable }) {
      load().then(() => {
        if (!win.turnstile) return onUnavailable();
        if (widgetId !== null) { win.turnstile.reset(widgetId); return; }
        widgetId = win.turnstile.render("#turnstile-challenge", {
          sitekey: siteKey, action: "vitium-intake",
          callback: onToken, "expired-callback": onExpired, "error-callback": onUnavailable
        });
      }, onUnavailable);
    },
    reset() {
      if (win.turnstile && widgetId !== null) win.turnstile.reset(widgetId);
    }
  };
}

const disabledChallenge = Object.freeze({ render: ({ onUnavailable }) => onUnavailable(), reset: () => {} });

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const channel = resolveChannel(publicIntake);
  startReporter({
    doc: document,
    win: window,
    config: publicIntake,
    effects: {
      newRequestId: () => crypto.randomUUID(),
      performHttp: makeHttpPerformer({
        fetchFn: (url, init) => window.fetch(url, init),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: id => window.clearTimeout(id),
        isOnline: () => navigator.onLine !== false
      }),
      challenge: channel === "private"
        ? makeTurnstileChallenge({ doc: document, win: window, siteKey: publicIntake.turnstileSiteKey })
        : disabledChallenge
    }
  });
}
