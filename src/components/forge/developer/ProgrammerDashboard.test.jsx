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
  isSessionReviewIncomplete,
  reviewFieldsToGovernanceStateShape,
  sessionReviewFieldsFromProposal,
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

function fullyPopulatedReviewFields() {
  return {
    ...createEmptySessionReviewFields(),
    phaseIdentifier: "16.9",
    phaseTitle: "Reviewed closeout proposal",
    endingObjective:
      "Ship the deterministic closeout proposal workflow.",
    nextSessionObjective:
      "Visually verify the populated proposal in the dashboard.",
    nextSessionStartingInspection:
      "Inspect the synchronized documents.",
  };
}

describe("reviewFieldsToGovernanceStateShape / isSessionReviewIncomplete", () => {
  it("maps a fully populated proposal to a governanceState with no REVIEW_REQUIRED values", () => {
    expect(
      reviewFieldsToGovernanceStateShape(
        fullyPopulatedReviewFields(),
      ),
    ).toEqual({
      state: {
        activePhase: {
          identifier: "16.9",
          title: "Reviewed closeout proposal",
        },
        currentObjective:
          "Ship the deterministic closeout proposal workflow.",
        nextSession: {
          objective:
            "Visually verify the populated proposal in the dashboard.",
          startingInspection:
            "Inspect the synchronized documents.",
        },
      },
    });
  });

  it("maps a blank field to the REVIEW_REQUIRED sentinel, matching what the backend would leave in place", () => {
    const shape = reviewFieldsToGovernanceStateShape(
      createEmptySessionReviewFields(),
    );

    expect(shape.state.activePhase.identifier).toBe(
      "REVIEW_REQUIRED",
    );
    expect(shape.state.currentObjective).toBe(
      "REVIEW_REQUIRED",
    );
  });

  it("reports a fully populated proposal as complete", () => {
    expect(
      isSessionReviewIncomplete(
        fullyPopulatedReviewFields(),
      ),
    ).toBe(false);
  });

  it("reports a blank proposal as incomplete", () => {
    expect(
      isSessionReviewIncomplete(
        createEmptySessionReviewFields(),
      ),
    ).toBe(true);
  });

  it("reports incomplete when only phaseTitle is missing, even though every other required field is populated", () => {
    expect(
      isSessionReviewIncomplete({
        ...fullyPopulatedReviewFields(),
        phaseTitle: "",
      }),
    ).toBe(true);
  });

  it("does not treat truly optional fields (deliveredWork, knownWarnings, startingObjective, incompleteReason) as required", () => {
    expect(
      isSessionReviewIncomplete({
        ...fullyPopulatedReviewFields(),
        deliveredWork: "",
        knownWarnings: "",
        startingObjective: "",
        incompleteReason: "",
      }),
    ).toBe(false);
  });

  it("stays complete when work is legitimately incomplete (markSessionComplete false with an incompleteReason)", () => {
    expect(
      isSessionReviewIncomplete({
        ...fullyPopulatedReviewFields(),
        markSessionComplete: false,
        incompleteReason:
          "Focused tests were not run this session.",
      }),
    ).toBe(false);
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

const sampleProposal = {
  generatedFrom: {
    baselineTier: "snapshot",
    recoveryMode: false,
    excludedCommitCount: 0,
    dominantScope: null,
  },
  fallbackApplied: {
    phase: false,
    objective: false,
    nextObjective: false,
    nextInspection: false,
  },
  phase: {
    identifier: "16.9",
    title: "Reviewed closeout proposal",
  },
  objective: {
    startingObjective:
      "Ship the reviewed session-closeout form.",
    endingObjective:
      "Ship the reviewed session-closeout form.",
  },
  deliveredWork: [
    "Added client-side validation",
    "Added interaction tests",
  ],
  changedFiles: [
    "src/components/forge/developer/ProgrammerDashboard.jsx",
  ],
  knownWarnings: [],
  validation: {
    focusedTests: {
      status: "not-run",
      command: null,
      summary: null,
    },
    fullTests: {
      status: "passing",
      command: "npx vitest run",
      summary: "Full tests passed.",
    },
    productionBuild: {
      status: "passing",
      command: "npm run build",
      summary: "Production build passed.",
    },
  },
  hasCurrentValidationArtifact: true,
  completion: {
    eligible: false,
    proposedMarkSessionComplete: false,
  },
  nextSession: {
    objective:
      "Visually verify the populated proposal in the dashboard.",
    startingInspection:
      "Review changes in: src/components/forge/developer/ProgrammerDashboard.jsx",
  },
  repository: {
    head: "a".repeat(40),
    branch: "main",
    workingTreeClean: true,
    headMatchesOriginMain: true,
  },
};

function createRoutedFetchMock({
  proposal = sampleProposal,
  proposalOk = true,
  executionResult,
} = {}) {
  return vi.fn((url) => {
    if (
      url === "/api/forge/developer/commands/closeout-proposal"
    ) {
      return Promise.resolve({
        ok: proposalOk,
        json: async () =>
          proposalOk
            ? { proposal }
            : { error: "Could not build a proposal." },
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => ({
        result: executionResult ?? {
          commandId: "complete-session-closeout",
          label: "Complete session closeout",
          status: "passing",
          startedAt: "2026-08-10T10:00:00.000Z",
          completedAt: "2026-08-10T10:00:05.000Z",
          steps: [],
        },
      }),
    });
  });
}

describe("sessionReviewFieldsFromProposal", () => {
  it("maps proposal values onto the editable review fields", () => {
    expect(
      sessionReviewFieldsFromProposal(sampleProposal),
    ).toEqual({
      phaseIdentifier: "16.9",
      phaseTitle: "Reviewed closeout proposal",
      startingObjective:
        "Ship the reviewed session-closeout form.",
      endingObjective:
        "Ship the reviewed session-closeout form.",
      deliveredWork:
        "Added client-side validation\nAdded interaction tests",
      knownWarnings: "",
      markSessionComplete: false,
      incompleteReason: "",
      nextSessionObjective:
        "Visually verify the populated proposal in the dashboard.",
      nextSessionStartingInspection:
        "Review changes in: src/components/forge/developer/ProgrammerDashboard.jsx",
    });
  });

  it("returns blank fields for a REVIEW_REQUIRED phase and a missing proposal", () => {
    expect(
      sessionReviewFieldsFromProposal({
        ...sampleProposal,
        phase: {
          identifier: "REVIEW_REQUIRED",
          title: "REVIEW_REQUIRED",
        },
      }).phaseIdentifier,
    ).toBe("");

    expect(sessionReviewFieldsFromProposal(null)).toEqual(
      createEmptySessionReviewFields(),
    );
  });
});

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

  function commandExecutionCalls(fetchMock) {
    return fetchMock.mock.calls.filter(
      ([url]) => url === "/api/forge/developer/commands",
    );
  }

  it("opens a populated proposal when Review & run is clicked, without executing the command", async () => {
    const fetchMock = createRoutedFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    expect(getReviewForm(container)).toBeNull();

    await clickButtonAndFlush(container, "Review & run");

    const summary = container.querySelector(
      "[data-session-review-summary]",
    );

    expect(summary).not.toBeNull();
    expect(summary.textContent).toContain("16.9");
    expect(summary.textContent).toContain(
      "Reviewed closeout proposal",
    );
    expect(summary.textContent).toContain(
      "Added client-side validation",
    );
    expect(summary.textContent).toContain(
      "Added interaction tests",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/forge/developer/commands/closeout-proposal",
    );
    expect(commandExecutionCalls(fetchMock)).toHaveLength(0);
  });

  it("approves the closeout proposal with zero typing", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));

    const fetchMock = createRoutedFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");

    // No field is touched here -- proving approval requires no typing.
    await clickButtonAndFlush(container, "Approve closeout");

    const executionCalls = commandExecutionCalls(fetchMock);
    expect(executionCalls).toHaveLength(1);

    const requestBody = JSON.parse(executionCalls[0][1].body);

    expect(requestBody).toEqual({
      commandId: "complete-session-closeout",
      reviewedMetadata: {
        phaseIdentifier: "16.9",
        phaseTitle: "Reviewed closeout proposal",
        startingObjective:
          "Ship the reviewed session-closeout form.",
        endingObjective:
          "Ship the reviewed session-closeout form.",
        deliveredWork: [
          "Added client-side validation",
          "Added interaction tests",
        ],
        markSessionComplete: false,
        nextSessionObjective:
          "Visually verify the populated proposal in the dashboard.",
        nextSessionStartingInspection:
          "Review changes in: src/components/forge/developer/ProgrammerDashboard.jsx",
      },
    });

    expect(getReviewForm(container)).toBeNull();
  });

  it("cannot execute Approve closeout when the proposal is missing a policy-required field -- button disabled, hint shown, no command runs", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));

    const sparseProposal = {
      ...sampleProposal,
      // Phase title omitted -- a policy-required field per
      // requiresHumanReview -- while everything else stays populated.
      phase: {
        identifier: "16.9",
        title: "",
      },
    };

    const fetchMock = createRoutedFetchMock({
      proposal: sparseProposal,
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");

    const approveButton = findButtonByText(
      container,
      "Approve closeout",
    );

    expect(approveButton.disabled).toBe(true);

    expect(
      container.querySelector(
        "[data-session-review-incomplete-hint]",
      ),
    ).not.toBeNull();

    // Clicking a disabled button fires no click handler in a real
    // browser; confirm that holds here too by attempting it anyway.
    act(() => {
      approveButton.click();
    });

    expect(commandExecutionCalls(fetchMock)).toHaveLength(0);
    expect(getReviewForm(container)).not.toBeNull();
  });

  it("reveals the editable fields via Edit details, pre-filled from the proposal, and lets edits override it", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));

    const fetchMock = createRoutedFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");

    expect(
      container.querySelector("#review-phase-identifier"),
    ).toBeNull();

    clickButton(container, "Edit details");

    const phaseInput = container.querySelector(
      "#review-phase-identifier",
    );

    expect(phaseInput).not.toBeNull();
    expect(phaseInput.value).toBe("16.9");

    act(() => {
      setNativeValue(phaseInput, "16.10");
    });

    expect(phaseInput.value).toBe("16.10");

    await clickButtonAndFlush(container, "Approve & run");

    const executionCalls = commandExecutionCalls(fetchMock);
    expect(executionCalls).toHaveLength(1);

    const requestBody = JSON.parse(executionCalls[0][1].body);

    expect(requestBody.reviewedMetadata.phaseIdentifier).toBe(
      "16.10",
    );
  });

  it("blocks submission in edit mode and preserves entered values when input violates the shared contract", async () => {
    const fetchMock = createRoutedFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");
    clickButton(container, "Edit details");

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

    expect(commandExecutionCalls(fetchMock)).toHaveLength(0);
    expect(getReviewForm(container)).not.toBeNull();

    expect(
      container.querySelector(
        "#review-starting-objective",
      ).value,
    ).toBe(tooLong);
  });

  it("cancels the review without executing anything, even after the proposal has loaded", async () => {
    const fetchMock = createRoutedFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");
    expect(getReviewForm(container)).not.toBeNull();

    clickButton(container, "Cancel");

    expect(getReviewForm(container)).toBeNull();
    expect(commandExecutionCalls(fetchMock)).toHaveLength(0);
  });

  it("falls back to the editable form when the proposal cannot be built", async () => {
    const fetchMock = createRoutedFetchMock({
      proposalOk: false,
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");

    expect(
      container.querySelector(
        "[data-session-review-proposal-error]",
      ),
    ).not.toBeNull();

    expect(
      container.querySelector("#review-phase-identifier"),
    ).not.toBeNull();

    expect(commandExecutionCalls(fetchMock)).toHaveLength(0);
  });

  it("shows Pending closeout for every validation category when no current validation artifact backs the proposal", async () => {
    const pendingProposal = {
      ...sampleProposal,
      hasCurrentValidationArtifact: false,
      validation: {
        focusedTests: {
          status: "not-run",
          command: null,
          summary: null,
        },
        fullTests: {
          status: "not-run",
          command: null,
          summary: null,
        },
        productionBuild: {
          status: "not-run",
          command: null,
          summary: null,
        },
      },
    };

    const fetchMock = createRoutedFetchMock({
      proposal: pendingProposal,
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");

    const summary = container.querySelector(
      "[data-session-review-summary]",
    );

    expect(summary.textContent).toContain(
      "Focused tests: Pending closeout",
    );
    expect(summary.textContent).toContain(
      "Full tests: Pending closeout",
    );
    expect(summary.textContent).toContain(
      "Production build: Pending closeout",
    );
    expect(summary.textContent).not.toContain("Not run");
  });

  it("still shows the real status for a category backed by current eligible evidence, instead of Pending closeout", async () => {
    const mixedProposal = {
      ...sampleProposal,
      hasCurrentValidationArtifact: true,
      validation: {
        focusedTests: {
          status: "passing",
          command: "npx vitest run",
          summary: "Focused tests passed.",
        },
        fullTests: {
          status: "failing",
          command: "npx vitest run",
          summary: "Full tests failed.",
        },
        productionBuild: {
          status: "passing",
          command: "npm run build",
          summary: "Production build passed.",
        },
      },
    };

    const fetchMock = createRoutedFetchMock({
      proposal: mixedProposal,
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");

    const summary = container.querySelector(
      "[data-session-review-summary]",
    );

    expect(summary.textContent).toContain(
      "Focused tests: Passing",
    );
    expect(summary.textContent).toContain("Full tests: Failing");
    expect(summary.textContent).toContain(
      "Production build: Passing",
    );
    expect(summary.textContent).not.toContain("Pending closeout");
  });

  it("explains that completion depends on the closeout's own validation run when completion is requested by default", async () => {
    const requestedCompletionProposal = {
      ...sampleProposal,
      completion: {
        eligible: false,
        proposedMarkSessionComplete: true,
      },
    };

    const fetchMock = createRoutedFetchMock({
      proposal: requestedCompletionProposal,
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");

    const summary = container.querySelector(
      "[data-session-review-summary]",
    );

    expect(summary.textContent).toContain(
      "Will mark complete if closeout validation passes; otherwise it will remain incomplete.",
    );
  });

  it("caps the delivered-work summary at 6 items with a toggle to reveal the rest", async () => {
    const manyItemsProposal = {
      ...sampleProposal,
      deliveredWork: [
        "feat(developer): item 1",
        "feat(developer): item 2",
        "feat(developer): item 3",
        "feat(developer): item 4",
        "feat(developer): item 5",
        "feat(developer): item 6",
        "feat(developer): item 7",
        "feat(developer): item 8",
      ],
    };

    const fetchMock = createRoutedFetchMock({
      proposal: manyItemsProposal,
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");

    const summary = container.querySelector(
      "[data-session-review-summary]",
    );

    expect(summary.textContent).toContain("item 1");
    expect(summary.textContent).toContain("item 6");
    expect(summary.textContent).not.toContain("item 7");
    expect(summary.textContent).not.toContain("item 8");

    const toggleButton = container.querySelector(
      "[data-session-review-toggle-delivered-work]",
    );

    expect(toggleButton).not.toBeNull();
    expect(toggleButton.textContent).toContain("Show all 8 items");

    await clickButtonAndFlush(
      container,
      "Show all 8 items",
    );

    expect(summary.textContent).toContain("item 7");
    expect(summary.textContent).toContain("item 8");
    expect(
      container.querySelector(
        "[data-session-review-toggle-delivered-work]",
      ).textContent,
    ).toContain("Show fewer items");
  });

  it("labels fallback-derived values as Proposed instead of presenting them as authoritative", async () => {
    const fallbackProposal = {
      ...sampleProposal,
      fallbackApplied: {
        phase: true,
        objective: true,
        nextObjective: true,
        nextInspection: true,
      },
    };

    const fetchMock = createRoutedFetchMock({
      proposal: fallbackProposal,
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountDashboard(interactionCommands);
    const { container } = mounted;

    await clickButtonAndFlush(container, "Review & run");

    expect(
      container.querySelectorAll(
        "[data-session-review-fallback-badge]",
      ).length,
    ).toBe(4);
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
