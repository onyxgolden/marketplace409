// @vitest-environment jsdom

import {
  act,
} from "react";

import {
  createRoot,
} from "react-dom/client";

import {
  renderToStaticMarkup,
} from "react-dom/server";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import ProgrammerDashboard, {
  buildReadableProgrammerResultText,
  buildReviewedSessionMetadataPayload,
  calculateProgrammerCommandProgress,
  createEmptySessionReviewFields,
  validateSessionReviewFields,
} from "./ProgrammerDashboard";

const commands = [
  {
    id: "repository-status",
    label: "Check repository",
    category: "Repository",
    risk: "read-only",
    expectedDurationSeconds: 5,
    description:
      "Shows repository status and synchronization information.",
    commandPreview: [
      "git status --short --branch",
      "git log -8 --oneline --decorate",
    ],
    confirmationRequired: false,
  },
  {
    id: "complete-session-closeout",
    label: "Complete session closeout",
    category: "AI helpers",
    risk: "shadow-write",
    expectedDurationSeconds: 95,
    description:
      "Runs validation and generates the next-session bootstrap.",
    commandPreview: [
      "node scripts/governance/generateValidationEvidence.mjs --full --build",
      "node scripts/orchestration/runEngineeringConversationSession.mjs <newest-validation-evidence.json>",
    ],
    confirmationRequired: true,
    requiresSessionReview: true,
  },
];

describe("ProgrammerDashboard", () => {
  it("renders compact approved actions with descriptions", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).toContain("FORGE Programmer Dashboard");
    expect(markup).toContain("Check repository");
    expect(markup).toContain("Shows repository status");
    expect(markup).toContain("Command preview");
    expect(markup).toContain("git status --short --branch");
    expect(markup).toContain("Complete session closeout");
    expect(markup).toContain("Confirmation required");
  });

  it("identifies the authorized programmer and local restriction", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).toContain(
      "Authorized as jasonmorgan99@gmail.com",
    );
    expect(markup).toContain("disabled on Vercel");
  });

  it("calculates capped estimated command progress", () => {
    expect(
      calculateProgrammerCommandProgress({
        elapsedSeconds: 15,
        expectedDurationSeconds: 30,
      }),
    ).toBe(50);

    expect(
      calculateProgrammerCommandProgress({
        elapsedSeconds: 45,
        expectedDurationSeconds: 30,
      }),
    ).toBe(90);

    expect(
      calculateProgrammerCommandProgress({
        elapsedSeconds: 5,
        expectedDurationSeconds: 0,
      }),
    ).toBe(0);
  });
});

describe("ProgrammerDashboard layout", () => {
  it("renders a persistent two-column layout with commands and results columns", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).toContain("data-programmer-commands-column");
    expect(markup).toContain("data-programmer-results-panel");
  });

  it("shows guidance in the results panel before any command runs", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).toContain(
      "Results will appear here after you run an action.",
    );
  });

  it("labels commands that require a reviewed session-closeout form", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).toContain("Review &amp; run");
  });

  it("does not render the session review form before it is opened", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).not.toContain("data-session-review-form");
  });
});

describe("buildReadableProgrammerResultText", () => {
  it("formats a successful execution as readable plain text", () => {
    const text = buildReadableProgrammerResultText({
      execution: {
        label: "Check repository",
        status: "passing",
        startedAt: "2026-08-10T10:00:00.000Z",
        completedAt: "2026-08-10T10:00:05.000Z",
        steps: [
          {
            status: "passing",
            command: "git status --short --branch",
            output: "## main...origin/main",
          },
        ],
      },
      error: "",
    });

    expect(text).toContain("FORGE PROGRAMMER COMMAND RESULT");
    expect(text).toContain("Action: Check repository");
    expect(text).toContain("Status: passing");
    expect(text).toContain("Step 1 · passing");
    expect(text).toContain(
      "Command: git status --short --branch",
    );
    expect(text).toContain("## main...origin/main");
  });

  it("formats a failed execution as readable plain text", () => {
    const text = buildReadableProgrammerResultText({
      execution: null,
      error: "Programmer command failed.",
    });

    expect(text).toContain("FORGE PROGRAMMER COMMAND RESULT");
    expect(text).toContain("Status: Error");
    expect(text).toContain(
      "Error: Programmer command failed.",
    );
  });

  it("contains no HTML or JSX markup in the readable text", () => {
    const text = buildReadableProgrammerResultText({
      execution: {
        label: "Check repository",
        status: "passing",
        startedAt: "2026-08-10T10:00:00.000Z",
        completedAt: "2026-08-10T10:00:05.000Z",
        steps: [
          {
            status: "passing",
            command: "git status",
            output: "clean",
          },
        ],
      },
      error: "",
    });

    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
  });

  it("returns an empty string when there is no execution or error", () => {
    expect(
      buildReadableProgrammerResultText({
        execution: null,
        error: "",
      }),
    ).toBe("");
  });
});

describe("createEmptySessionReviewFields", () => {
  it("starts every field blank and work-complete unchecked", () => {
    expect(createEmptySessionReviewFields()).toEqual({
      phaseIdentifier: "",
      phaseTitle: "",
      startingObjective: "",
      endingObjective: "",
      deliveredWork: "",
      knownWarnings: "",
      markSessionComplete: false,
      incompleteReason: "",
      nextSessionObjective: "",
      nextSessionStartingInspection: "",
    });
  });
});

describe("buildReviewedSessionMetadataPayload", () => {
  it("trims text fields and omits fields the reviewer left blank", () => {
    const payload = buildReviewedSessionMetadataPayload({
      ...createEmptySessionReviewFields(),
      phaseIdentifier: "  Phase 16  ",
      startingObjective: "Add the session review form",
      endingObjective: "   ",
    });

    expect(payload).toEqual({
      phaseIdentifier: "Phase 16",
      startingObjective: "Add the session review form",
      markSessionComplete: false,
    });
  });

  it("splits delivered work and known warnings into trimmed line arrays", () => {
    const payload = buildReviewedSessionMetadataPayload({
      ...createEmptySessionReviewFields(),
      deliveredWork: "Added review form\n  Wired reviewedMetadata\n\n",
      knownWarnings: "Legacy claimed warning persists",
    });

    expect(payload.deliveredWork).toEqual([
      "Added review form",
      "Wired reviewedMetadata",
    ]);

    expect(payload.knownWarnings).toEqual([
      "Legacy claimed warning persists",
    ]);
  });

  it("carries markSessionComplete as an explicit boolean", () => {
    expect(
      buildReviewedSessionMetadataPayload({
        ...createEmptySessionReviewFields(),
        markSessionComplete: true,
      }).markSessionComplete,
    ).toBe(true);

    expect(
      buildReviewedSessionMetadataPayload(
        createEmptySessionReviewFields(),
      ).markSessionComplete,
    ).toBe(false);
  });

  it("produces only the keys the reviewed-session-metadata contract allows", () => {
    const payload = buildReviewedSessionMetadataPayload({
      phaseIdentifier: "Phase 16",
      phaseTitle: "Session review form",
      startingObjective: "Start",
      endingObjective: "End",
      deliveredWork: "Item one",
      knownWarnings: "Warning one",
      markSessionComplete: true,
      incompleteReason: "",
      nextSessionObjective: "Next",
      nextSessionStartingInspection: "Inspect this",
    });

    const allowedKeys = new Set([
      "phaseIdentifier",
      "phaseTitle",
      "startingObjective",
      "endingObjective",
      "deliveredWork",
      "knownWarnings",
      "markSessionComplete",
      "incompleteReason",
      "nextSessionObjective",
      "nextSessionStartingInspection",
    ]);

    for (const key of Object.keys(payload)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});

describe("validateSessionReviewFields", () => {
  it("accepts a blank form as valid, since every field is optional", () => {
    expect(
      validateSessionReviewFields(
        createEmptySessionReviewFields(),
      ).valid,
    ).toBe(true);
  });

  it("rejects a field that exceeds the shared contract's length limit", () => {
    const result = validateSessionReviewFields({
      ...createEmptySessionReviewFields(),
      startingObjective: "a".repeat(2001),
    });

    expect(result.valid).toBe(false);
    expect(result.message).toContain("startingObjective");
  });
});

function setNativeValue(element, value) {
  const prototype =
    element.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(
    prototype,
    "value",
  ).set;

  setter.call(element, value);
  element.dispatchEvent(
    new Event("input", { bubbles: true }),
  );
}

function findButtonByText(container, text) {
  const button = Array.from(
    container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent === text);

  if (!button) {
    throw new Error(
      `No button found with text "${text}"`,
    );
  }

  return button;
}

function clickButton(container, text) {
  const button = findButtonByText(container, text);

  act(() => {
    button.click();
  });

  return button;
}

async function clickButtonAndFlush(container, text) {
  const button = findButtonByText(container, text);

  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  return button;
}

function mountDashboard(dashboardCommands) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ProgrammerDashboard
        commands={dashboardCommands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );
  });

  return { container, root };
}

function unmountDashboard({ container, root }) {
  act(() => {
    root.unmount();
  });

  container.remove();
}

describe("ProgrammerDashboard interactions", () => {
  const interactionCommands = [
    {
      id: "repository-status",
      label: "Check repository",
      category: "Repository",
      risk: "read-only",
      expectedDurationSeconds: 5,
      description:
        "Shows repository status and synchronization information.",
      commandPreview: [
        "git status --short --branch",
        "git log -8 --oneline --decorate",
      ],
      confirmationRequired: false,
    },
    {
      id: "complete-session-closeout",
      label: "Complete session closeout",
      category: "AI helpers",
      risk: "shadow-write",
      expectedDurationSeconds: 95,
      description:
        "Runs validation and generates the next-session bootstrap.",
      commandPreview: [
        "node scripts/governance/generateValidationEvidence.mjs --full --build",
        "node scripts/orchestration/runEngineeringConversationSession.mjs <newest-validation-evidence.json>",
      ],
      confirmationRequired: true,
      requiresSessionReview: true,
    },
  ];

  let mounted = null;

  afterEach(() => {
    if (mounted) {
      unmountDashboard(mounted);
      mounted = null;
    }

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function getReviewForm(container) {
    return container.querySelector(
      "[data-session-review-form]",
    );
  }

  it("opens the review form when Review & run is clicked, without executing the command", () => {
    vi.stubGlobal("fetch", vi.fn());

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    expect(getReviewForm(container)).toBeNull();

    clickButton(container, "Review & run");

    expect(getReviewForm(container)).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows the reviewer to populate fields", () => {
    vi.stubGlobal("fetch", vi.fn());

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    clickButton(container, "Review & run");

    const phaseInput = container.querySelector(
      "#review-phase-identifier",
    );

    act(() => {
      setNativeValue(phaseInput, "Phase 16");
    });

    expect(phaseInput.value).toBe("Phase 16");
  });

  it("submits the expected reviewedMetadata when Approve & run is clicked", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          commandId: "complete-session-closeout",
          label: "Complete session closeout",
          status: "passing",
          startedAt: "2026-08-10T10:00:00.000Z",
          completedAt: "2026-08-10T10:00:05.000Z",
          steps: [],
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    clickButton(container, "Review & run");

    act(() => {
      setNativeValue(
        container.querySelector(
          "#review-phase-identifier",
        ),
        "Phase 16",
      );

      setNativeValue(
        container.querySelector(
          "#review-starting-objective",
        ),
        "Ship the reviewed session-closeout form",
      );

      setNativeValue(
        container.querySelector(
          "#review-delivered-work",
        ),
        "Added client-side validation\nAdded interaction tests",
      );
    });

    act(() => {
      container
        .querySelector("#review-mark-complete")
        .click();
    });

    await clickButtonAndFlush(container, "Approve & run");

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const requestBody = JSON.parse(
      fetchMock.mock.calls[0][1].body,
    );

    expect(requestBody).toEqual({
      commandId: "complete-session-closeout",
      reviewedMetadata: {
        phaseIdentifier: "Phase 16",
        startingObjective:
          "Ship the reviewed session-closeout form",
        deliveredWork: [
          "Added client-side validation",
          "Added interaction tests",
        ],
        markSessionComplete: true,
      },
    });

    expect(getReviewForm(container)).toBeNull();
  });

  it("blocks submission and shows validation feedback for input that violates the shared contract, preserving entered values", () => {
    vi.stubGlobal("fetch", vi.fn());

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    clickButton(container, "Review & run");

    const tooLong = "a".repeat(2001);

    act(() => {
      setNativeValue(
        container.querySelector(
          "#review-starting-objective",
        ),
        tooLong,
      );
    });

    clickButton(container, "Approve & run");

    const alert = container.querySelector(
      "[data-session-review-error]",
    );

    expect(alert).not.toBeNull();
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(
      "startingObjective",
    );
    expect(alert.textContent).toContain("2000");

    expect(fetch).not.toHaveBeenCalled();
    expect(getReviewForm(container)).not.toBeNull();

    expect(
      container.querySelector(
        "#review-starting-objective",
      ).value,
    ).toBe(tooLong);
  });

  it("cancels the review without executing the command", () => {
    vi.stubGlobal("fetch", vi.fn());

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    clickButton(container, "Review & run");
    expect(getReviewForm(container)).not.toBeNull();

    clickButton(container, "Cancel");

    expect(getReviewForm(container)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still executes non-review commands directly, without opening the review form", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          commandId: "repository-status",
          label: "Check repository",
          status: "passing",
          startedAt: "2026-08-10T10:00:00.000Z",
          completedAt: "2026-08-10T10:00:01.000Z",
          steps: [],
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Run action");

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const requestBody = JSON.parse(
      fetchMock.mock.calls[0][1].body,
    );

    expect(requestBody).toEqual({
      commandId: "repository-status",
    });

    expect(getReviewForm(container)).toBeNull();
  });
});
