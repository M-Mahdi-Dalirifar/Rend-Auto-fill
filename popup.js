import { storage } from "./src/core/storage.js";
import { AutofillEngine } from "./src/core/autofillEngine.js";
import { AdapterRegistry } from "./src/adapters/registry.js";
import { GreenhouseAdapter } from "./src/adapters/greenhouse/adapter.js";
import { AshbyAdapter } from "./src/adapters/ashby/adapter.js";
import { LeverAdapter } from "./src/adapters/lever/adapter.js";
import { WorkdayAdapter } from "./src/adapters/workday/adapter.js";
import { GenericAdapter } from "./src/adapters/generic/adapter.js";
import { ResumeManager } from "./src/resumes/resumeManager.js";
import { ResumeSelector } from "./src/resumes/resumeSelector.js";
import { initializePopupNavigation, renderResumeCards, createPopupState } from "./src/ui/popup.js";
import { GeminiProvider } from "./src/ai/geminiProvider.js";
import { GroqProvider } from "./src/ai/groqProvider.js";
import { OpenRouterProvider } from "./src/ai/openRouterProvider.js";
import { AIQuestionResolver } from "./src/ai/aiQuestionResolver.js";
import { ResumeKnowledgeService } from "./src/resumes/resumeKnowledgeService.js";
import { ResumeFactResolver } from "./src/ai/resumeFactResolver.js";
import { PerformanceTrace, propagateAdapterTrace } from "./src/core/performanceTrace.js";
import { ClassificationCache } from "./src/ai/classificationCache.js";
import { getBuildIdentity } from "./src/ui/buildIdentity.js";
import { createJobBrief } from "./src/ui/jobBrief.js";
import { writeClipboardText } from "./src/ui/clipboard.js";

const adapterRegistry = new AdapterRegistry([
  GreenhouseAdapter,
  AshbyAdapter,
  LeverAdapter,
  WorkdayAdapter,
  GenericAdapter
]);
const resumeManager = new ResumeManager();
const resumeSelector = new ResumeSelector();
const popupState = createPopupState();
const buildIdentity = getBuildIdentity();
const selfIdentificationDirtyFields = new Set();
// Remote providers remain available for their explicit settings/debug actions,
// but normal Autofill must always complete without an external dependency.
const REMOTE_AI_DURING_AUTOFILL_ENABLED = false;

const AI_PROVIDER_LABELS = Object.freeze({ openrouter: "OpenRouter", groq: "Groq", gemini: "Gemini" });

function normalizeAIProvider(provider) {
  return Object.hasOwn(AI_PROVIDER_LABELS, provider) ? provider : "openrouter";
}

function getAIProviderClass(provider) {
  return ({ openrouter: OpenRouterProvider, groq: GroqProvider, gemini: GeminiProvider })[normalizeAIProvider(provider)];
}

const profileInputs = {
  firstName: document.querySelector("#profile-first-name"),
  lastName: document.querySelector("#profile-last-name"),
  email: document.querySelector("#profile-email"),
  phone: document.querySelector("#profile-phone"),
  country: document.querySelector("#profile-country"),
  city: document.querySelector("#profile-city"),
  currentEmployer: document.querySelector("#profile-current-employer"),
  currentJobTitle: document.querySelector("#profile-current-job-title"),
  linkedinUrl: document.querySelector("#profile-linkedin-url"),
  githubUrl: document.querySelector("#profile-github-url"),
  portfolioUrl: document.querySelector("#profile-portfolio-url"),
  totalYearsExperience: document.querySelector("#profile-total-years-experience"),
  phoneticPronunciation: document.querySelector("#profile-phonetic-pronunciation"),
  preferredPronouns: document.querySelector("#profile-preferred-pronouns")
};

const preferenceInputs = {
  workAuthorization: document.querySelector("#preference-work-authorization"),
  requiresSponsorship: document.querySelector("#preference-requires-sponsorship"),
  currentCountry: document.querySelector("#preference-current-country"),
  preferredLocation: document.querySelector("#preference-preferred-location"),
  noticePeriod: document.querySelector("#preference-notice-period"),
  salaryExpectation: document.querySelector("#preference-salary-expectation"),
  interviewAccommodation: document.querySelector("#preference-interview-accommodation"),
  onCallExperience: document.querySelector("#preference-on-call-experience"),
  infrastructureAutomationExperience: document.querySelector("#preference-infrastructure-automation"),
  monitoringObservabilityExperience: document.querySelector("#preference-monitoring-observability"),
  productionToolingExperience: document.querySelector("#preference-production-tooling"),
  kubernetesExperience: document.querySelector("#preference-kubernetes"),
  cicdExperience: document.querySelector("#preference-cicd"),
  cloudProviders: document.querySelector("#preference-cloud-providers"),
  programmingLanguages: document.querySelector("#preference-programming-languages"),
  preferredName: document.querySelector("#preference-preferred-name"),
  employmentRestrictions: document.querySelector("#preference-employment-restrictions"),
  sreCodeDiscussion: document.querySelector("#preference-sre-code-discussion"),
  previouslyWorkedAtCompany: document.querySelector("#preference-previously-worked")
};

const selfIdentificationInputs = {
  gender: document.querySelector("#self-gender"),
  raceEthnicity: document.querySelector("#self-race-ethnicity"),
  hispanicLatino: document.querySelector("#self-hispanic-latino"),
  veteranStatus: document.querySelector("#self-veteran-status"),
  disabilityStatus: document.querySelector("#self-disability-status"),
  sexualOrientation: document.querySelector("#self-sexual-orientation"),
  ageGroup: document.querySelector("#self-age-group")
};
for (const [key, input] of Object.entries(selfIdentificationInputs)) {
  input?.addEventListener("change", () => selfIdentificationDirtyFields.add(key));
}

const saveButton = document.querySelector("#save-profile");
const saveStatus = document.querySelector("#save-status");
const savePreferencesButton = document.querySelector("#save-preferences");
const preferencesSaveStatus = document.querySelector("#preferences-save-status");
const saveSelfIdentificationButton = document.querySelector("#save-self-identification");
const selfIdentificationSaveStatus = document.querySelector("#self-identification-save-status");
const scanButton = document.querySelector("#scan-form");
const autofillButton = document.querySelector("#autofill-basic");
const copyJobBriefButton = document.querySelector("#copy-job-brief");
const scanResult = document.querySelector("#scan-result");
const autofillResult = document.querySelector("#autofill-result");
const fieldList = document.querySelector("#field-list");
const greenhouseDiagnostics = document.querySelector("#greenhouse-diagnostics");
const resumeFileInput = document.querySelector("#resume-file");
const storedResumeName = document.querySelector("#stored-resume-name");
const resumeStorageStatus = document.querySelector("#resume-storage-status");
const saveResumeButton = document.querySelector("#save-resume");
const replaceResumeButton = document.querySelector("#replace-resume");
const removeResumeButton = document.querySelector("#remove-resume");
const editResumeMetadataButton = document.querySelector("#edit-resume-metadata");
const setDefaultResumeButton = document.querySelector("#set-default-resume");
const resumeOverride = document.querySelector("#resume-override");
const resumeList = document.querySelector("#resume-list");
const selectedResumeReason = document.querySelector("#selected-resume-reason");
const resumeDisplayName = document.querySelector("#resume-display-name");
const resumeJobTitles = document.querySelector("#resume-job-titles");
const resumeKeywords = document.querySelector("#resume-keywords");
const resumeSkills = document.querySelector("#resume-skills");
const debugDropdownsButton = document.querySelector("#debug-dropdowns");
const inspectFailedFieldsButton = document.querySelector("#inspect-failed-fields");
const traceAshbySelfIdButton = document.querySelector("#trace-ashby-self-id");
const refreshContextButton = document.querySelector("#refresh-context");
const headerPlatform = document.querySelector("#header-platform");
const headerJobTitle = document.querySelector("#header-job-title");
const dashboardPlatform = document.querySelector("#dashboard-platform");
const dashboardCompany = document.querySelector("#dashboard-company");
const dashboardJobTitle = document.querySelector("#dashboard-job-title");
const dashboardResumeName = document.querySelector("#dashboard-resume-name");
const dashboardResumeStatus = document.querySelector("#dashboard-resume-status");
const statDetected = document.querySelector("#stat-detected");
const statFilled = document.querySelector("#stat-filled");
const statUnresolved = document.querySelector("#stat-unresolved");
const statResume = document.querySelector("#stat-resume");
const aiApiKeyInput = document.querySelector("#ai-api-key");
const aiModelInput = document.querySelector("#ai-model");
const aiProviderInput = document.querySelector("#ai-provider");
const aiKeyLabel = document.querySelector("#ai-key-label");
const aiModelLabel = document.querySelector("#ai-model-label");
const aiEnabledInput = document.querySelector("#ai-enabled");
const saveAISettingsButton = document.querySelector("#save-ai-settings");
const testAIConnectionButton = document.querySelector("#test-ai-connection");
const toggleAIKeyButton = document.querySelector("#toggle-ai-key");
const aiSettingsStatus = document.querySelector("#ai-settings-status");
const debugDiagnosticsEnabled = document.querySelector("#debug-diagnostics-enabled");
const copyDebugReportButton = document.querySelector("#copy-debug-report");
const reanalyzeResumeButton = document.querySelector("#reanalyze-resume");
const performanceSummary = document.querySelector("#performance-summary");
const buildIdentityLabel = document.querySelector("#build-identity");
buildIdentityLabel.textContent = `v${buildIdentity.extensionVersion} · Build ${buildIdentity.buildId}`;

let popupNavigation = {
  showView() {},
  showSettingsTab() {}
};

try {
  popupNavigation = initializePopupNavigation();
} catch (error) {
  console.error("Rend Autofill UI init failed", error);
}

loadStoredData().catch((error) => {
  console.error("Rend Autofill UI init failed", error);
});

saveButton.addEventListener("click", async () => {
  await storage.setCandidateProfile(readProfileForm());
  saveStatus.textContent = "Saved locally.";
  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 2000);
});

savePreferencesButton.addEventListener("click", async () => {
  await storage.setApplicationPreferences(readPreferencesForm());
  preferencesSaveStatus.textContent = "Saved locally.";
  window.setTimeout(() => {
    preferencesSaveStatus.textContent = "";
  }, 2000);
});

saveSelfIdentificationButton.addEventListener("click", async () => {
  const existing = await storage.getSelfIdentificationProfile();
  const formValues = readInputGroup(selfIdentificationInputs);
  const completeProfile = { ...existing };
  for (const [key, value] of Object.entries(formValues)) {
    if (selfIdentificationDirtyFields.has(key) || completeProfile[key] === undefined) completeProfile[key] = value || "Not specified";
  }
  await storage.setSelfIdentificationProfile(completeProfile);
  const verifiedProfile = await storage.getSelfIdentificationProfile();
  console.log("SELF_ID_SAVE_RESULT", verifiedProfile);
  selfIdentificationDirtyFields.clear();
  selfIdentificationSaveStatus.textContent = "Saved locally.";
  window.setTimeout(() => {
    selfIdentificationSaveStatus.textContent = "";
  }, 2000);
});

saveAISettingsButton.addEventListener("click", async () => {
  const settings = readAISettingsForm();
  await storage.setAISettings(settings);
  window.__rendAISettings = settings;
  aiSettingsStatus.textContent = "Saved locally.";
});
aiProviderInput.addEventListener("change", () => {
  const settings = window.__rendAISettings || { openrouter: {}, gemini: {}, groq: {} };
  const previousProvider = normalizeAIProvider(window.__rendActiveProvider);
  settings[previousProvider] = { ...(settings[previousProvider] || {}), apiKey: aiApiKeyInput.value.trim(), model: aiModelInput.value.trim() };
  settings.provider = normalizeAIProvider(aiProviderInput.value);
  settings.enabled = aiEnabledInput.checked;
  applyAIProviderToForm(settings);
});
toggleAIKeyButton.addEventListener("click", () => {
  const reveal = aiApiKeyInput.type === "password";
  aiApiKeyInput.type = reveal ? "text" : "password";
  toggleAIKeyButton.textContent = reveal ? "Hide" : "Show";
});
testAIConnectionButton.addEventListener("click", testAIConnection);
copyDebugReportButton.addEventListener("click", copyDebugReport);
copyJobBriefButton.addEventListener("click", copyJobBrief);
reanalyzeResumeButton?.addEventListener("click", reanalyzeSelectedResume);

debugDropdownsButton.addEventListener("click", () => runPageDiagnostic("all"));
inspectFailedFieldsButton.addEventListener("click", () => runPageDiagnostic("failed"));

saveResumeButton.addEventListener("click", () => saveSelectedResume(false));
replaceResumeButton.addEventListener("click", () => saveSelectedResume(true));
removeResumeButton.addEventListener("click", removeStoredResume);
setDefaultResumeButton.addEventListener("click", setSelectedResumeDefault);
editResumeMetadataButton.addEventListener("click", editSelectedResumeMetadata);
resumeOverride.addEventListener("change", refreshDashboardContext);
refreshContextButton.addEventListener("click", refreshDashboardContext);
resumeList.addEventListener("click", handleResumeCardAction);

scanButton.addEventListener("click", async () => {
  setActionButtonsDisabled(true);
  scanResult.textContent = "Scanning...";
  autofillResult.replaceChildren();
  fieldList.replaceChildren();

  try {
    const fields = await runOnActiveTab("scan");
    scanResult.textContent = `Detected fields: ${fields.length}`;
    statDetected.textContent = String(fields.length);
    displayFields(fields);
  } catch (error) {
    showPageError(error);
  } finally {
    setActionButtonsDisabled(false);
  }
});

autofillButton.addEventListener("click", async () => {
  setActionButtonsDisabled(true);
  autofillResult.textContent = "Autofilling...";
  let performanceTrace = null;

  try {
    performanceTrace = new PerformanceTrace({ debug: debugDiagnosticsEnabled.checked });
    const jobContext = await getCurrentJobContext();
    const resume = await getResumeForInjection(jobContext);
    const aiResolver = REMOTE_AI_DURING_AUTOFILL_ENABLED
      ? await createAIResolver(resume, performanceTrace)
      : null;
    const resumeFactResolver = await createCachedResumeFactResolver(resume, performanceTrace);
    const rawSummary = await runOnActiveTab(
      "autofill",
      readProfileForm(),
      readPreferencesForm(),
      resume,
      readInputGroup(selfIdentificationInputs),
      aiResolver,
      performanceTrace,
      resumeFactResolver
    );
    const summary = normalizeAutofillResult(rawSummary);
    if (performanceTrace.counts.detectedFields === 0) {
      performanceTrace.setCount("detectedFields", summary.detectedCount || summary.diagnostics.length);
    }
    performanceTrace.finish({
      filled: summary.diagnostics.filter((row) => row.result === "PASS").length,
      unresolved: summary.diagnostics.filter((row) => !["PASS", "SKIPPED"].includes(row.result)).length
    });
    const traceSnapshot = performanceTrace.snapshot();
    summary.performance = traceSnapshot;
    popupState.debugReport = await createDebugReport(summary, traceSnapshot);
    popupState.diagnostics = summary.diagnostics;
    renderPerformanceSummary(traceSnapshot);
    displayDiagnostics(summary.diagnostics);
    displayAutofillSummary(summary);
    updateDashboardStats(summary);
    // Clipboard failure is deliberately isolated from completed ATS interaction.
    try {
      await copyPreparedJobBrief({
        trigger: "autofill",
        jobContext,
        selectedResumeName: resume?.displayName || popupState.resumeSelection?.selectedResume || "",
        selectionMode: popupState.resumeSelection?.mode || "automatic"
      });
    } catch (error) {
      console.warn("Rend Autofill job brief auto-copy failed", error);
      popupState.jobBrief = {
        manualCopyAvailable: true, autoCopyEnabled: true, lastCopyTrigger: "autofill",
        lastCopySucceeded: false, lastCopyMethod: "none", lastCopyError: "job-brief-preparation-failed"
      };
      popupState.debugReport.jobBrief = popupState.jobBrief;
    }
  } catch (error) {
    // Preserve a reportable terminal state even when a provider or adapter throws unexpectedly.
    if (performanceTrace) {
      performanceTrace.finish();
      try {
        popupState.debugReport = await createDebugReport({ platform: "unknown" }, performanceTrace.snapshot());
      } catch (_) { /* The visible error and finally cleanup still take priority. */ }
    }
    showPageError(error);
  } finally {
    setActionButtonsDisabled(false);
  }
});

async function loadStoredData() {
  try {
    await storage.migrate();
  } catch (error) {
    console.error("Rend Autofill storage migration failed", error);
  }

  try {
    await resumeManager.initialize();
    await refreshStoredResumeName();
  } catch (error) {
    console.error("Rend Autofill resume UI init failed", error);
  }

  let candidateProfile = {};
  let applicationPreferences = {};
  let selfIdentificationProfile = {};
  let aiSettings = {};
  try {
    ({
      candidateProfile,
      applicationPreferences,
      selfIdentificationProfile
    } = await storage.getAllProfiles());
    aiSettings = await storage.getAISettings();
  } catch (error) {
    console.error("Rend Autofill profile UI init failed", error);
  }

  for (const [key, input] of Object.entries(profileInputs)) {
    input.value = candidateProfile[key] ?? "";
  }

  if (
    applicationPreferences.cloudProviders === undefined &&
    applicationPreferences.cloudExperience !== undefined
  ) {
    const legacyCloud = applicationPreferences.cloudExperience;
    applicationPreferences.cloudProviders = Array.isArray(legacyCloud)
      ? legacyCloud
      : String(legacyCloud).split(",").map((value) => value.trim()).filter(Boolean);
    await storage.setApplicationPreferences(applicationPreferences);
  }

  for (const [key, input] of Object.entries(preferenceInputs)) {
    const storedValue = applicationPreferences[key] ?? "";
    input.value = Array.isArray(storedValue) ? storedValue.join(", ") : storedValue;
  }

  for (const [key, input] of Object.entries(selfIdentificationInputs)) {
    input.value = selfIdentificationProfile[key] ?? "Not specified";
  }
  applyAIProviderToForm(aiSettings);
  aiEnabledInput.checked = aiSettings.enabled === true;

  console.group("Rend Autofill saved data");
    console.log("Candidate Profile fields configured", Object.keys(candidateProfile).filter((key) => Boolean(candidateProfile[key])));
  console.log("Application Preferences", applicationPreferences);
  console.log("Self-Identification Profile", selfIdentificationProfile);
  console.groupEnd();
  await refreshDashboardContext();
}

function readProfileForm() {
  return readInputGroup(profileInputs);
}

function readInputGroup(inputs) {
  return Object.fromEntries(
    Object.entries(inputs).map(([key, input]) => [key, input.value.trim()])
  );
}

function readPreferencesForm() {
  const preferences = readInputGroup(preferenceInputs);

  for (const key of ["programmingLanguages", "cloudProviders"]) {
    preferences[key] = preferences[key]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return preferences;
}

function readAISettingsForm() {
  const previous = window.__rendAISettings || { openrouter: {}, gemini: {}, groq: {} };
  const provider = normalizeAIProvider(aiProviderInput.value);
  return {
    provider,
    enabled: aiEnabledInput.checked,
    gemini: { ...(previous.gemini || {}), ...(provider === "gemini" ? { apiKey: aiApiKeyInput.value.trim(), model: aiModelInput.value.trim() } : {}) },
    groq: { ...(previous.groq || {}), ...(provider === "groq" ? { apiKey: aiApiKeyInput.value.trim(), model: aiModelInput.value.trim() } : {}) },
    openrouter: { ...(previous.openrouter || {}), ...(provider === "openrouter" ? { apiKey: aiApiKeyInput.value.trim(), model: aiModelInput.value.trim() } : {}) }
  };
}

function applyAIProviderToForm(settings) {
  const provider = normalizeAIProvider(settings.provider);
  window.__rendAISettings = settings;
  window.__rendActiveProvider = provider;
  aiProviderInput.value = provider;
  aiApiKeyInput.value = settings[provider]?.apiKey || "";
  aiModelInput.value = settings[provider]?.model || "";
  aiKeyLabel.childNodes[0].textContent = `${AI_PROVIDER_LABELS[provider]} API Key `;
  aiModelLabel.childNodes[0].textContent = `${AI_PROVIDER_LABELS[provider]} Model `;
}

async function createAIResolver(selectedResume = null, performanceTrace = null) {
  const settings = await storage.getAISettings();
  if (!settings.enabled) return null;
  const providerSettings = settings[settings.provider] || {};
  if (!providerSettings.apiKey || !providerSettings.model) throw new Error(`${AI_PROVIDER_LABELS[normalizeAIProvider(settings.provider)]} API key and model are required.`);
  const profiles = await storage.getAllProfiles();
  const provider = new (getAIProviderClass(settings.provider))({ apiKey: providerSettings.apiKey, model: providerSettings.model });
  const classificationCache = new ClassificationCache({
    provider: normalizeAIProvider(settings.provider),
    model: providerSettings.model
  });
  const loadResumeFacts = selectedResume?.id ? async () => {
    try {
      const storedResume = await resumeManager.get(selectedResume.id);
      const knowledge = await new ResumeKnowledgeService({ provider, performanceTrace }).getFacts(storedResume);
      console.info("AI_RESUME_FACTS_READY", { resumeId: selectedResume.id, cacheHit: knowledge.cacheHit });
      return knowledge;
    } catch (error) {
      const message = String(error?.message || error).split(providerSettings.apiKey || "\u0000").join("[REDACTED]");
      console.info("AI_RESUME_FACTS_UNAVAILABLE", { resumeId: selectedResume.id, reason: message });
      return null;
    }
  } : null;
  const candidateProfile = {
    ...profiles.candidateProfile,
    linkedin: profiles.candidateProfile.linkedinUrl,
    github: profiles.candidateProfile.githubUrl,
    portfolio: profiles.candidateProfile.portfolioUrl,
    yearsOfExperience: profiles.candidateProfile.totalYearsExperience
  };
  return new AIQuestionResolver({
    provider,
    providerName: normalizeAIProvider(settings.provider),
    candidateProfile,
    applicationPreferences: profiles.applicationPreferences,
    selfIdentificationProfile: profiles.selfIdentificationProfile,
    resumeFactResolver: new ResumeFactResolver({ loadFacts: loadResumeFacts, performanceTrace }),
    loadFactualContext: async () => {
      const knowledge = loadResumeFacts ? await loadResumeFacts() : null;
      const facts = knowledge?.facts;
      if (!facts) return null;
      // Technical facts only: never pass contact details or protected profile data to generation.
      return {
        programmingLanguages: (facts.programmingLanguages || []).slice(0, 20),
        cloudProviders: (facts.cloudProviders || []).slice(0, 20),
        technologies: (facts.technologies || []).slice(0, 40),
        skills: (facts.skills || []).slice(0, 40).map((skill) => ({ name: skill.name, productionExperience: skill.productionExperience === true })),
        experiences: (facts.experiences || []).slice(0, 12).map((experience) => ({ title: experience.title || "", technologies: (experience.technologies || []).slice(0, 20), summary: String(experience.summary || "").slice(0, 300) }))
      };
    },
    classificationCache,
    performanceTrace
  });
}

async function createCachedResumeFactResolver(selectedResume = null, performanceTrace = null) {
  if (!selectedResume?.id) return null;
  return new ResumeFactResolver({
    performanceTrace,
    loadFacts: async () => {
      try {
        const storedResume = await resumeManager.get(selectedResume.id);
        if (!storedResume) return null;
        return await new ResumeKnowledgeService({ performanceTrace }).getCachedFacts(storedResume);
      } catch (error) {
        // A local cache/storage issue must leave this field unresolved, never
        // prevent deterministic Autofill from completing.
        console.info("RESUME_FACT_CACHE_UNAVAILABLE", { resumeId: selectedResume.id, reason: String(error?.message || error) });
        return null;
      }
    }
  });
}

async function testAIConnection() {
  testAIConnectionButton.disabled = true;
  aiSettingsStatus.textContent = "Testing…";
  try {
    const settings = readAISettingsForm();
    const active = settings[settings.provider] || {};
    if (!active.apiKey) throw new Error(`${AI_PROVIDER_LABELS[normalizeAIProvider(settings.provider)]} API key is required.`);
    if (!active.model) throw new Error(`${AI_PROVIDER_LABELS[normalizeAIProvider(settings.provider)]} model is required.`);
    const Provider = getAIProviderClass(settings.provider);
    await new Provider({ apiKey: active.apiKey, model: active.model }).testConnection();
    aiSettingsStatus.textContent = "Connected";
  } catch (error) {
    const key = aiApiKeyInput.value.trim();
    const safeMessage = key ? String(error.message || error).split(key).join("[REDACTED]") : String(error.message || error);
    aiSettingsStatus.textContent = safeMessage;
  } finally {
    testAIConnectionButton.disabled = false;
  }
}

async function runPageDiagnostic(mode) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    world: "MAIN",
    func: installJobAutofillDebugHelpers
  });
  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    world: "MAIN",
    func: (diagnosticMode) => {
      if (diagnosticMode === "failed") {
        window.jobAutofillInspectFailedFields();
      } else {
        window.jobAutofillDebugDropdowns();
      }
    },
    args: [mode]
  });
}

async function traceAshbySelfIdentification() {
  traceAshbySelfIdButton.disabled = true;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error("No active tab was found.");
    const [{ result: page = {} } = {}] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => ({
        pageUrl: window.location.href,
        platformHints: {
          ashby: Boolean(document.querySelector(".ashby-application-form-container, .ashby-job-posting-heading, iframe[src*='jobs.ashbyhq.com']"))
        }
      })
    });
    const adapter = adapterRegistry.createAdapter({ tabId: activeTab.id, ...page });
    if (adapter.getPlatformName() !== "ashby" || typeof adapter.traceSelfIdentification !== "function") {
      throw new Error("The active page was not detected as Ashby.");
    }
    const selfIdentificationProfile = await storage.getSelfIdentificationProfile();
    const result = await adapter.traceSelfIdentification(selfIdentificationProfile);
    const traceRows = [
      ["Gender Trace", result.gender],
      ["Sexual Orientation Trace", result.sexualOrientation],
      ["Ethnicity Trace", result.raceEthnicity],
      ["Age Group Trace", result.ageGroup],
      ["Disability Trace", result.disabilityStatus],
      ["Veteran Trace", result.veteranStatus]
    ].map(([field, trace]) => ({
      platform: "ashby",
      field,
      canonicalType: trace?.stage1Scan?.canonicalType || trace?.stage2Classify?.classifierOutput || "",
      controlType: trace?.stage1Scan?.controlType || "",
      storedValue: trace?.storedValue || "",
      detectedQuestion: trace?.questionText || trace?.stage1Scan?.exactQuestionText || "",
      availableOptions: trace?.stage4AdapterMatch?.availableOptions || [],
      mappedTargetOption: trace?.stage4AdapterMatch?.mappedTargetOption || "",
      selectedOption: trace?.stage7Verify?.actualSelectedOption || "",
      detected: Boolean(trace?.directQuestionFound),
      attempted: Boolean(trace?.stage6Interaction?.methodsAttempted?.length),
      finalValue: trace?.stage7Verify?.actualSelectedOption || "",
      result: trace?.stage7Verify?.finalResult || trace?.result || "UNRESOLVED",
      reason: trace?.failureStage || trace?.result || ""
    }));
    popupState.diagnostics = traceRows;
    displayDiagnostics(traceRows);
  } catch (error) {
    console.error("Ashby Self-ID trace failed", error);
    greenhouseDiagnostics.textContent = `Ashby Self-ID trace failed: ${error.message}`;
  } finally {
    traceAshbySelfIdButton.disabled = false;
  }
}

async function initializeAshbyTraceBinding() {
  try {
    const { bindAshbySelfIdTrace } = await import("./src/ui/ashbyTraceBinding.js");
    bindAshbySelfIdTrace(traceAshbySelfIdButton, traceAshbySelfIdentification);
  } catch (error) {
    console.error("Ashby Self-ID trace setup failed", error);
    if (traceAshbySelfIdButton) {
      traceAshbySelfIdButton.disabled = true;
      traceAshbySelfIdButton.title = "Ashby trace unavailable";
      traceAshbySelfIdButton.textContent = "Ashby trace unavailable";
    }
  }
}

initializeAshbyTraceBinding();

async function saveSelectedResume(replaceExisting) {
  const file = resumeFileInput.files[0];

  if (!file) {
    resumeStorageStatus.textContent = "Choose a PDF first.";
    return;
  }

  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    resumeStorageStatus.textContent = "Only PDF resume files are supported.";
    return;
  }

  const metadata = readResumeMetadataForm();

  if (replaceExisting) {
    if (!resumeOverride.value) {
      resumeStorageStatus.textContent = "Select a resume to replace.";
      return;
    }
    await resumeManager.replace(resumeOverride.value, file, metadata);
  } else {
    await resumeManager.add(file, metadata);
  }
  resumeFileInput.value = "";
  resumeStorageStatus.textContent = replaceExisting ? "Resume replaced locally." : "Resume added locally.";
  await refreshStoredResumeName();
}

async function removeStoredResume() {
  if (!resumeOverride.value) {
    resumeStorageStatus.textContent = "Select a resume to remove.";
    return;
  }
  await resumeManager.remove(resumeOverride.value);
  resumeOverride.value = "";
  resumeFileInput.value = "";
  resumeStorageStatus.textContent = "Stored resume removed.";
  await refreshStoredResumeName();
}

async function refreshStoredResumeName() {
  const resumes = await resumeManager.listForSelection();
  const previousSelection = resumeOverride.value;
  resumeOverride.replaceChildren(new Option("Automatic selection", ""));
  for (const resume of resumes) {
    resumeOverride.append(new Option(
      `${resume.displayName}${resume.isDefault ? " (Default)" : ""}`,
      resume.id
    ));
  }
  resumeOverride.value = resumes.some((resume) => resume.id === previousSelection)
    ? previousSelection
    : "";
  const explained = resumeSelector.explain(resumes, {}, resumeOverride.value);
  const selection = explained.selection;
  const selectionDiagnostics = prepareResumeSelectionDiagnostics(explained.diagnostics, resumes);
  popupState.resumeSelection = selectionDiagnostics;
  const selected = resumes.find((resume) => resume.id === selection?.resumeId);
  storedResumeName.textContent = `Stored resumes: ${resumes.length}`;
  selectedResumeReason.textContent = selected ? compactResumeSelectionStatus(selectionDiagnostics) : "No resume selected";
  dashboardResumeName.textContent = selected?.displayName || "None selected";
  dashboardResumeStatus.classList.toggle("is-ready", Boolean(selected));
  statResume.textContent = selected ? "Yes" : "No";
  renderResumeCards(resumeList, resumes, selected?.id || "");
}

async function handleResumeCardAction(event) {
  const button = event.target.closest("[data-resume-action]");
  const card = button?.closest("[data-resume-id]");
  if (!button || !card) return;

  resumeOverride.value = card.dataset.resumeId;
  const action = button.dataset.resumeAction;
  if (action === "use") {
    await refreshDashboardContext();
    popupNavigation.showView("dashboard");
    return;
  }
  if (action === "default") return setSelectedResumeDefault();
  if (action === "remove") return removeStoredResume();
  if (action === "replace") return saveSelectedResume(true);

  if (action === "edit") {
    const selected = (await resumeManager.list()).find(
      (resume) => resume.id === card.dataset.resumeId
    );
    if (!selected) return;
    resumeDisplayName.value = selected.displayName || "";
    resumeJobTitles.value = (selected.jobTitles || []).join(", ");
    resumeKeywords.value = (selected.keywords || []).join(", ");
    resumeSkills.value = (selected.skills || []).join(", ");
    resumeStorageStatus.textContent = "Metadata loaded. Edit it, then choose Save Metadata.";
  }
}

function readResumeMetadataForm() {
  return {
    displayName: resumeDisplayName.value.trim(),
    jobTitles: resumeJobTitles.value,
    keywords: resumeKeywords.value,
    skills: resumeSkills.value
  };
}

async function setSelectedResumeDefault() {
  if (!resumeOverride.value) return;
  await resumeManager.setDefault(resumeOverride.value);
  await refreshStoredResumeName();
}

async function editSelectedResumeMetadata() {
  if (!resumeOverride.value) return;
  await resumeManager.updateMetadata(resumeOverride.value, readResumeMetadataForm());
  await refreshStoredResumeName();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }

  return btoa(binary);
}

async function getResumeForInjection(jobContext = {}) {
  const resumes = await resumeManager.listForSelection();
  const explained = resumeSelector.explain(resumes, jobContext, resumeOverride.value);
  const selection = explained.selection;
  const selectionDiagnostics = prepareResumeSelectionDiagnostics(explained.diagnostics, resumes);
  popupState.resumeSelection = selectionDiagnostics;
  const resume = resumes.find((item) => item.id === selection?.resumeId);

  if (!resume) {
    return null;
  }

  selectedResumeReason.textContent = compactResumeSelectionStatus(selectionDiagnostics);
  dashboardResumeName.textContent = resume.displayName;
  dashboardResumeStatus.classList.add("is-ready");
  statResume.textContent = "Yes";

  return {
    id: resume.id,
    name: resume.filename,
    type: resume.type,
    lastModified: resume.lastModified,
    base64: arrayBufferToBase64(resume.data),
    displayName: resume.displayName,
    selectionReason: selection.reasons.join(", ")
  };
}

async function getCurrentJobContext() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return {};
  const [{ result: page = {} } = {}] = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    func: () => ({
      pageUrl: window.location.href,
      platformHints: {
        greenhouse: Boolean(document.querySelector(
          "[id*='greenhouse' i], [class*='greenhouse' i], form[action*='greenhouse' i]"
        )),
        ashby: Boolean(document.querySelector(
          ".ashby-application-form-container, .ashby-job-posting-heading, iframe[src*='jobs.ashbyhq.com'], script[src*='ashbyhq.com'][src*='embed'], script[src*='ashbyprd.com']"
        )),
        workday: /workday|myworkdayjobs/i.test(window.location.href) && Boolean(document.querySelector("[data-automation-id], [data-uxi-element-id], [role='main']"))
      }
    })
  });
  const adapter = adapterRegistry.createAdapter({ tabId: activeTab.id, ...page });
  return new AutofillEngine(adapter).getJobContext();
}

async function refreshDashboardContext() {
  refreshContextButton.disabled = true;
  try {
    const context = await getCurrentJobContext();
    const platform = context.platform || "generic";
    const platformLabel = platform.replace(/-not-implemented$/i, "");
    const displayPlatform = platformLabel.charAt(0).toUpperCase() + platformLabel.slice(1);
    const jobTitle = context.jobTitle || "Job title unavailable";
    const company = context.company || "Company unavailable";

    headerPlatform.textContent = displayPlatform;
    headerPlatform.classList.add("badge--primary");
    headerJobTitle.textContent = context.jobTitle || "Current application";
    dashboardPlatform.textContent = displayPlatform;
    dashboardCompany.textContent = company;
    dashboardJobTitle.textContent = jobTitle;

    await getResumeForDashboard(context);
  } catch (error) {
    console.debug("Rend Autofill could not read dashboard context:", error);
    headerPlatform.textContent = "Unavailable";
    dashboardPlatform.textContent = "Unavailable";
    dashboardCompany.textContent = "Open a job application tab";
    dashboardJobTitle.textContent = "Job context unavailable";
  } finally {
    refreshContextButton.disabled = false;
  }
}

async function getResumeForDashboard(jobContext) {
  const resumes = await resumeManager.listForSelection();
  const explained = resumeSelector.explain(resumes, jobContext, resumeOverride.value);
  const selection = explained.selection;
  const selectionDiagnostics = prepareResumeSelectionDiagnostics(explained.diagnostics, resumes);
  popupState.resumeSelection = selectionDiagnostics;
  const resume = resumes.find((item) => item.id === selection?.resumeId);
  dashboardResumeName.textContent = resume?.displayName || "None selected";
  dashboardResumeStatus.classList.toggle("is-ready", Boolean(resume));
  statResume.textContent = resume ? "Yes" : "No";
  selectedResumeReason.textContent = resume ? compactResumeSelectionStatus(selectionDiagnostics) : "Add a resume in Settings";
  renderResumeCards(resumeList, resumes, resume?.id || "");
}

function prepareResumeSelectionDiagnostics(diagnostics, resumes = []) {
  if (!diagnostics) return null;
  const names = new Map(resumes.map((resume) => [resume.id, resume.displayName || resume.filename || "Unnamed resume"]));
  return {
    ...diagnostics,
    candidates: (diagnostics.candidates || []).map((candidate) => ({
      ...candidate,
      resumeName: names.get(candidate.resumeId) || "Unknown resume"
    })),
    selectedResume: names.get(diagnostics.selectedResumeId) || ""
  };
}

function compactResumeSelectionStatus(diagnostics) {
  if (diagnostics?.mode === "manual") return "Manual";
  if (diagnostics?.fallbackUsed) return "Automatic · Default fallback";
  const selected = diagnostics?.candidates?.find((candidate) => candidate.resumeId === diagnostics.selectedResumeId);
  return `Automatic · ${selected?.confidence || "No evidence"} confidence`;
}

async function runOnActiveTab(
  mode,
  profile = {},
  preferences = {},
  resume = null,
  selfIdentification = {},
  aiResolver = null,
  performanceTrace = null,
  resumeFactResolver = null
) {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!activeTab?.id) {
    throw new Error("No active tab was found.");
  }

  const [{ result: page = {} } = {}] = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    func: () => ({
      pageUrl: window.location.href,
      platformHints: {
        greenhouse: Boolean(document.querySelector(
          "[id*='greenhouse' i], [class*='greenhouse' i], form[action*='greenhouse' i]"
        )),
        ashby: Boolean(document.querySelector(
          ".ashby-application-form-container, .ashby-job-posting-heading, iframe[src*='jobs.ashbyhq.com'], script[src*='ashbyhq.com'][src*='embed'], script[src*='ashbyprd.com']"
        )),
        workday: /workday|myworkdayjobs/i.test(window.location.href) && Boolean(document.querySelector("[data-automation-id], [data-uxi-element-id], [role='main']"))
      }
    })
  });
  const adapter = adapterRegistry.createAdapter({
    tabId: activeTab.id,
    ...page
  });
  const engine = new AutofillEngine(adapter);
  const adapterOptions = {
    profile,
    preferences,
    resume,
    selfIdentification,
    debugDiagnostics: performanceTrace?.debug === true,
    aiEnabled: Boolean(aiResolver)
  };
  const executionContext = {
    runtime: processJobApplication,
    diagnosticInstaller: installJobAutofillDebugHelpers,
    options: adapterOptions,
    aiResolver,
    resumeFactResolver,
    performanceTrace
  };
  const adapterStartedAt = performanceTrace?.now();
  const result = mode === "scan"
    ? await engine.scan(executionContext)
    : await engine.autofill(executionContext);
  propagateAdapterTrace(result, adapter.getPlatformName(), performanceTrace);
  if (mode === "autofill" && performanceTrace && performanceTrace.timings.interactionMs === 0) {
    performanceTrace.addTiming("interactionMs", performanceTrace.now() - adapterStartedAt);
  }

  return result ?? (mode === "scan" ? [] : {
    basicFilled: [],
    preferencesFilled: [],
    multiSelectFilled: [],
    ambiguousMatches: [],
    storedOptionsNotFound: [],
    greenhouseDiagnostics: [],
    resume: {
      success: false,
      label: "",
      filename: resume?.name ?? "",
      reason: "No resume field was processed."
    },
    skipped: []
  });
}

function installJobAutofillDebugHelpers() {
  const sensitivePattern = /gender|sex|ethnicity|ethnic|race|hispanic|veteran|disability|disabled|captcha|recaptcha|hcaptcha|turnstile/i;

  function cleanText(value) {
    return (value ?? "").trim().replace(/\s+/g, " ");
  }

  function isVisible(element) {
    if (!element || element.getClientRects().length === 0) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0";
  }

  function truncate(value) {
    return cleanText(value).slice(0, 3000);
  }

  function findContainer(control) {
    const namedContainer = control.closest(
      "[class*='field' i], [class*='question' i], [data-field], fieldset, [role='group']"
    );
    let candidate = control.parentElement;

    for (let level = 0; candidate && level < 7; level += 1) {
      const text = cleanText(candidate.innerText);
      const isOnlyPrompt = /^(select|choose)(\.\.\.|…)?$/i.test(text);

      if (!isOnlyPrompt && text.length >= 10 && text.length <= 3000) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }

    return namedContainer || control.parentElement;
  }

  function ariaAttributes(element) {
    return [...element.attributes]
      .filter((attribute) => attribute.name.startsWith("aria-"))
      .reduce((attributes, attribute) => {
        attributes[attribute.name] = attribute.value;
        return attributes;
      }, {});
  }

  function inspectControl(control) {
    const container = findContainer(control) || control;
    const question = cleanText(container.innerText);

    if (sensitivePattern.test(question)) {
      return null;
    }

    const elements = [container, ...container.querySelectorAll("*")];
    const inputs = [...container.querySelectorAll("input")];
    const buttons = [...container.querySelectorAll("button")];
    const roleElements = elements.filter((element) => element.hasAttribute("role"));
    const ariaElements = elements.filter((element) =>
      [...element.attributes].some((attribute) => attribute.name.startsWith("aria-"))
    );

    return {
      question,
      desiredAnswer: "",
      questionContainerOuterHTML: truncate(container.outerHTML),
      comboboxOuterHTML: truncate(control.outerHTML),
      allInputsInsideContainer: inputs.map((input) => truncate(input.outerHTML)),
      allButtonsInsideContainer: buttons.map((button) => truncate(button.outerHTML)),
      allElementsWithRole: roleElements.map((element) => ({
        tagName: element.tagName.toLowerCase(),
        id: element.id,
        role: element.getAttribute("role"),
        text: cleanText(element.textContent)
      })),
      allAriaAttributes: ariaElements.map((element) => ({
        tagName: element.tagName.toLowerCase(),
        id: element.id,
        attributes: ariaAttributes(element)
      })),
      currentVisibleText: cleanText(control.value || control.textContent),
      reactSelectIdDetected: inputs.some((input) => /react-select/i.test(input.id)),
      selectClassDetected: elements.some((element) =>
        /select/i.test(String(element.className ?? ""))
      ),
      ariaControls: control.getAttribute("aria-controls") ?? "",
      ariaActivedescendant: control.getAttribute("aria-activedescendant") ?? ""
    };
  }

  function collectRecords() {
    const selector = [
      "[role='combobox']",
      "input[id*='react-select' i]",
      "input[aria-autocomplete='list']",
      "[aria-haspopup='listbox']",
      "[aria-controls]"
    ].join(", ");
    const seenContainers = new Set();
    const records = [];

    for (const control of document.querySelectorAll(selector)) {
      if (!isVisible(control)) {
        continue;
      }
      const container = findContainer(control);
      if (!container || seenContainers.has(container)) {
        continue;
      }
      const record = inspectControl(control);
      if (record) {
        seenContainers.add(container);
        records.push(record);
      }
    }

    return records;
  }

  function printRecords(records) {
    console.table(records.map((record) => ({
      question: record.question,
      currentVisibleText: record.currentVisibleText,
      reactSelectIdDetected: record.reactSelectIdDetected,
      selectClassDetected: record.selectClassDetected,
      ariaControls: record.ariaControls,
      ariaActivedescendant: record.ariaActivedescendant
    })));
    for (const record of records) {
      console.log(
        "JOB_AUTOFILL_DROPDOWN_RECORD",
        JSON.stringify(record, null, 2)
      );
    }
    return records;
  }

  window.jobAutofillDebugDropdowns = () => printRecords(collectRecords());
  window.jobAutofillInspectFailedFields = () => printRecords(
    collectRecords().filter((record) =>
      !record.currentVisibleText ||
      /\b(select|choose)\b/i.test(record.currentVisibleText)
    )
  );
  window.jobAutofillInspectQuestion = (keyword) => {
    const normalizedKeyword = cleanText(keyword).toLowerCase();
    const record = collectRecords().find((item) =>
      item.question.toLowerCase().includes(normalizedKeyword)
    );

    if (!record) {
      console.log("JOB_AUTOFILL_DROPDOWN_RECORD", "No matching safe question found.");
      return null;
    }

    printRecords([record]);
    return record;
  };
}

function setActionButtonsDisabled(disabled) {
  scanButton.disabled = disabled;
  autofillButton.disabled = disabled;
}

async function copyJobBrief() {
  copyJobBriefButton.disabled = true;
  copyJobBriefButton.textContent = "Preparing…";
  try {
    const jobContext = await getCurrentJobContext();
    const resumes = await resumeManager.listForSelection();
    const selection = popupState.resumeSelection;
    const selectedResume = resumes.find((resume) => resume.id === selection?.selectedResumeId);
    const outcome = await copyPreparedJobBrief({
      trigger: "manual",
      jobContext,
      selectedResumeName: selectedResume?.displayName || selection?.selectedResume || "",
      selectionMode: selection?.mode || "automatic"
    });
    copyJobBriefButton.textContent = outcome.success ? "Copied" : "Copy failed";
  } catch (error) {
    console.error("Rend Autofill job brief preparation failed", error);
    popupState.jobBrief = {
      manualCopyAvailable: true, autoCopyEnabled: true, lastCopyTrigger: "manual",
      lastCopySucceeded: false, lastCopyMethod: "none", lastCopyError: "job-brief-preparation-failed"
    };
    if (popupState.debugReport) popupState.debugReport.jobBrief = popupState.jobBrief;
    copyJobBriefButton.textContent = "Copy failed";
  } finally {
    copyJobBriefButton.disabled = false;
    window.setTimeout(() => { copyJobBriefButton.textContent = "Copy Job Brief"; }, 1500);
  }
}

async function copyPreparedJobBrief({ trigger, jobContext, selectedResumeName, selectionMode }) {
  const brief = createJobBrief({ jobContext, selectedResumeName, selectionMode });
  const outcome = await writeClipboardText(brief.text);
  popupState.jobBrief = {
    ...brief.metadata,
    manualCopyAvailable: true,
    autoCopyEnabled: true,
    lastCopyTrigger: trigger,
    lastCopySucceeded: outcome.success,
    lastCopyMethod: outcome.method,
    lastCopyError: outcome.error
  };
  if (popupState.debugReport) popupState.debugReport.jobBrief = popupState.jobBrief;
  return outcome;
}

function showPageError(error) {
  console.error("Rend Autofill could not access this page:", error);
  scanResult.textContent = "Unable to access this page.";
  autofillResult.replaceChildren();
}

function displayFields(fields) {
  const fragment = document.createDocumentFragment();

  for (const field of fields) {
    const card = document.createElement("section");
    card.className = "field-card";

    const label = document.createElement("h2");
    label.textContent = field.labelText || "Unlabeled field";
    card.append(label);

    const kind = document.createElement("p");
    kind.className = "field-kind";
    kind.textContent = field.type
      ? `${field.tagName} | ${field.type}`
      : field.tagName;
    card.append(kind);

    addMetadataLine(card, "canonical", field.canonicalField);
    addMetadataLine(card, "preference", field.preferenceField);
    addMetadataLine(card, "name", field.name);
    addMetadataLine(card, "id", field.id);
    addMetadataLine(card, "placeholder", field.placeholder);
    fragment.append(card);
  }

  fieldList.replaceChildren(fragment);
}

function addMetadataLine(card, key, value) {
  if (!value) {
    return;
  }

  const line = document.createElement("p");
  line.textContent = `${key}: ${value}`;
  card.append(line);
}

function displayAutofillSummary(summary) {
  const basicNames = summary.basicFilled.map((field) => field.label).join(", ");
  const preferenceNames = summary.preferencesFilled
    .map((field) => field.label)
    .join(", ");
  const multiSelectNames = summary.multiSelectFilled
    .map((field) => `${field.label}: ${field.selected.join(", ")}`)
    .join("; ");
  const skippedNames = summary.skipped
    .map((field) => `${field.label} (${field.reason})`)
    .join(", ");

  const count = document.createElement("p");
  count.textContent = `Basic fields filled: ${summary.basicFilled.length}`;

  const filled = document.createElement("p");
  filled.textContent = `Basic: ${basicNames || "None"}`;

  const preferences = document.createElement("p");
  preferences.textContent =
    `Single-select preferences filled: ${summary.preferencesFilled.length}`;

  const preferenceList = document.createElement("p");
  preferenceList.textContent = `Preferences: ${preferenceNames || "None"}`;

  const multiSelects = document.createElement("p");
  multiSelects.textContent =
    `Multi-select preferences filled: ${summary.multiSelectFilled.length}`;

  const multiSelectList = document.createElement("p");
  multiSelectList.textContent = `Multi-selects: ${multiSelectNames || "None"}`;

  const ambiguous = document.createElement("p");
  ambiguous.textContent = `Ambiguous matches: ${summary.ambiguousMatches.length}`;

  const missingOptions = document.createElement("p");
  missingOptions.textContent = `Stored options not found: ${summary.storedOptionsNotFound
    .map((item) => `${item.label}: ${item.values.join(", ")}`)
    .join("; ") || "None"}`;

  const skipped = document.createElement("p");
  skipped.textContent = `Skipped questions: ${skippedNames || "None"}`;

  const resume = document.createElement("p");
  resume.textContent = `Resume upload: ${summary.resume.success ? "Success" : "Not uploaded"}`;

  const resumeField = document.createElement("p");
  resumeField.textContent = `Detected resume field: ${summary.resume.label || "None"}`;

  const resumeFilename = document.createElement("p");
  resumeFilename.textContent = `Stored filename: ${summary.resume.filename || "None"}`;

  const resumeReason = document.createElement("p");
  resumeReason.textContent = summary.resume.success
    ? ""
    : `Resume skip reason: ${summary.resume.reason}`;

  autofillResult.replaceChildren(
    count,
    filled,
    preferences,
    preferenceList,
    multiSelects,
    multiSelectList,
    ambiguous,
    missingOptions,
    resume,
    resumeField,
    resumeFilename,
    resumeReason,
    skipped
  );
  displayDiagnostics(summary.diagnostics ?? []);
}

function normalizeAutofillResult(result = {}) {
  const diagnostics = Array.isArray(result.diagnostics)
    ? result.diagnostics
    : (Array.isArray(result.greenhouseDiagnostics) ? result.greenhouseDiagnostics : []);
  return {
    ...result,
    detectedCount: Number(result.detectedCount ?? diagnostics.length ?? 0),
    basicFilled: result.basicFilled || [],
    preferencesFilled: result.preferencesFilled || [],
    multiSelectFilled: result.multiSelectFilled || [],
    ambiguousMatches: result.ambiguousMatches || [],
    storedOptionsNotFound: result.storedOptionsNotFound || [],
    skipped: result.skipped || [],
    resume: result.resume || { success: false, label: "", filename: "", reason: "not-processed" },
    diagnostics,
    greenhouseDiagnostics: diagnostics
  };
}

function updateDashboardStats(summary) {
  const fallbackFilledCount =
    (summary.basicFilled?.length || 0) +
    (summary.preferencesFilled?.length || 0) +
    (summary.multiSelectFilled?.length || 0) +
    (summary.resume?.success ? 1 : 0);
  const diagnostics = summary.diagnostics || [];
  const diagnosticPassCount = diagnostics.filter((row) => row.result === "PASS").length;
  const fallbackUnresolvedCount =
    (summary.skipped?.length || 0) +
    (summary.ambiguousMatches?.length || 0) +
    (summary.storedOptionsNotFound?.length || 0);
  const diagnosticUnresolvedCount = diagnostics.filter((row) => row.result !== "SKIPPED" && (
    ["FAIL", "UNRESOLVED", "field-not-found", "control-not-found", "option-not-found", "verification-failed", "ambiguous", "ambiguous-option", "missing-stored-answer"].includes(row.result) ||
    ["field-not-found", "control-not-found", "option-not-found", "verification-failed", "ambiguous", "ambiguous-option", "missing-stored-answer"].includes(row.reason)
  )).length;

  statFilled.textContent = String(diagnostics.length ? diagnosticPassCount : fallbackFilledCount);
  statUnresolved.textContent = String(diagnostics.length ? diagnosticUnresolvedCount : fallbackUnresolvedCount);
  statResume.textContent = summary.resume?.success ? "Yes" : statResume.textContent;

  const diagnosticCount = diagnostics.length;
  if (diagnosticCount > 0) statDetected.textContent = String(diagnosticCount);
}

function displayDiagnostics(rows) {
  if (rows.length === 0) {
    greenhouseDiagnostics.textContent = "No adapter diagnostics available.";
    return;
  }

  const columns = [
    "field",
    "question",
    "canonicalType",
    "controlType",
    "deterministicResult",
    "aiUsed",
    "aiCanonicalType",
    "entities",
    "confidence",
    "storedAnswerFound",
    "answerSource",
    "answer",
    "resumeEvidence",
    "aiClassificationResult",
    "aiReason",
    "storedValue",
    "detectedQuestion",
    "availableOptions",
    "mappedTargetOption",
    "selectedOption",
    "detected",
    "attempted",
    "finalValue",
    "result",
    "reason"
  ];
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");

  for (const column of columns) {
    const cell = document.createElement("th");
    cell.textContent = column;
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tableRow = document.createElement("tr");
    for (const column of columns) {
      const cell = document.createElement("td");
      const value = row[column];
      cell.textContent = Array.isArray(value) ? value.join(", ") : (value && typeof value === "object" ? JSON.stringify(value) : String(value ?? ""));
      tableRow.append(cell);
    }
    body.append(tableRow);
  }
  table.append(body);
  const aiRows = rows.filter((row) => row.aiUsed);
  const counter = document.createElement("p");
  counter.className = "muted";
  const count = (label) => aiRows.filter((row) => row.aiClassificationResult === label).length;
  counter.textContent = [
    `Rule matched: ${rows.filter((row) => !row.aiUsed && row.result === "PASS").length}`,
    `AI classified: ${aiRows.filter((row) => row.aiCanonicalType).length}`,
    `AI + stored answer: ${count("AI classified")}`,
    `AI + resume answer: ${count("AI + resume answer")}`,
    `AI low confidence: ${count("AI low confidence")}`,
    `AI stored answer missing: ${count("Stored answer missing")}`,
    `AI resume evidence missing: ${count("AI resume evidence missing")}`,
    `Future long-form answer required: ${count("Future long-form answer required")}`
  ].join(" · ");
  greenhouseDiagnostics.replaceChildren(counter, table);
}

function renderPerformanceSummary(trace = {}) {
  const timings = trace.timings || {};
  const counts = trace.counts || {};
  const rows = [
    ["Total", `${timings.totalMs || 0} ms`], ["Scan", `${timings.scanMs || 0} ms`],
    ["Rules", `${timings.deterministicResolveMs || 0} ms`], ["AI classification", `${timings.aiClassificationMs || 0} ms`],
    ["Resume extraction", `${timings.resumeTextMs || 0} ms`], ["Resume facts", `${timings.resumeFactsMs || 0} ms`],
    ["Resume resolution", `${timings.resumeResolveMs || 0} ms`], ["Interaction", `${timings.interactionMs || 0} ms`],
    ["AI calls", String(counts.aiCalls || 0)],
    ["AI classification calls", String(counts.aiClassificationCalls || 0)], ["AI generation calls", String(counts.aiGenerationCalls || 0)],
    ["Classification cache", `hits ${counts.classificationCacheHits || 0} / misses ${counts.classificationCacheMisses || 0}`],
    ["Resume cache", `hits ${counts.resumeCacheHits || 0} / misses ${counts.resumeCacheMisses || 0}`]
  ];
  const list = document.createElement("dl");
  list.className = "performance-grid";
  for (const [label, value] of rows) {
    const term = document.createElement("dt"); term.textContent = label;
    const detail = document.createElement("dd"); detail.textContent = value;
    list.append(term, detail);
  }
  performanceSummary.replaceChildren(list);
}

async function createDebugReport(summary, trace) {
  const settings = await storage.getAISettings();
  return {
    extensionVersion: buildIdentity.extensionVersion,
    buildId: buildIdentity.buildId,
    platform: summary.platform || "unknown",
    ...(summary.workdayStep ? { workdayStep: summary.workdayStep } : {}),
    ai: {
      enabled: settings.enabled === true,
      provider: settings.provider,
      model: settings[settings.provider]?.model || "",
      autofillRemoteAiEnabled: REMOTE_AI_DURING_AUTOFILL_ENABLED
    },
    performance: trace.timings,
    fieldCounts: trace.counts,
    ...(popupState.resumeSelection ? { resumeSelection: popupState.resumeSelection } : {}),
    ...(popupState.jobBrief ? { jobBrief: popupState.jobBrief } : {}),
    ...(trace.debugEnabled ? {
      fieldTraces: trace.fieldTraces || [],
      locationAutocompletePrecheck: summary.locationAutocompletePrecheck || [],
      locationAutocomplete: summary.locationAutocomplete || [],
      workdayPhone: summary.workdayPhone || [],
      workdayCombobox: summary.workdayCombobox || [],
      ...(trace.resumeFactsSummary ? { resumeFactsSummary: trace.resumeFactsSummary } : {}),
      ...(trace.resumeKnowledgeDebug ? { resumeKnowledgeDebug: trace.resumeKnowledgeDebug } : {})
    } : {})
  };
}

async function reanalyzeSelectedResume() {
  if (!debugDiagnosticsEnabled.checked) {
    reanalyzeResumeButton.textContent = "Enable Debug Diagnostics first";
    window.setTimeout(() => { reanalyzeResumeButton.textContent = "Reanalyze Resume"; }, 1800);
    return;
  }
  reanalyzeResumeButton.disabled = true;
  reanalyzeResumeButton.textContent = "Reanalyzing…";
  try {
    const settings = await storage.getAISettings();
    const active = settings[settings.provider] || {};
    if (!active.apiKey || !active.model) throw new Error(`${AI_PROVIDER_LABELS[normalizeAIProvider(settings.provider)]} API key and model are required.`);
    const jobContext = await getCurrentJobContext();
    const resumes = await resumeManager.list();
    const selection = resumeSelector.select(resumes, jobContext, resumeOverride.value);
    const selected = resumes.find((resume) => resume.id === selection?.resumeId);
    if (!selected) throw new Error("No resume is selected.");
    const trace = new PerformanceTrace({ debug: true });
    const Provider = getAIProviderClass(settings.provider);
    const provider = new Provider({ apiKey: active.apiKey, model: active.model });
    await new ResumeKnowledgeService({ provider, performanceTrace: trace }).getFacts(selected, { regenerate: true });
    trace.finish();
    const snapshot = trace.snapshot();
    popupState.debugReport = await createDebugReport({ platform: jobContext.platform || "unknown" }, snapshot);
    renderPerformanceSummary(snapshot);
    const output = document.createElement("pre");
    output.className = "compact-diagnostics";
    output.textContent = JSON.stringify({
      action: "manual-resume-reanalysis",
      resumeFactsSummary: snapshot.resumeFactsSummary,
      resumeKnowledgeDebug: snapshot.resumeKnowledgeDebug
    }, null, 2);
    greenhouseDiagnostics.replaceChildren(output);
    console.info("RESUME_REANALYSIS_DIAGNOSTICS", {
      resumeFactsSummary: snapshot.resumeFactsSummary,
      resumeKnowledgeDebug: snapshot.resumeKnowledgeDebug
    });
    reanalyzeResumeButton.textContent = "Reanalysis complete";
  } catch (error) {
    const settings = await storage.getAISettings().catch(() => ({}));
    const safeMessage = String(error?.message || error).split(settings?.[settings.provider]?.apiKey || "\u0000").join("[REDACTED]");
    console.error("Rend Autofill resume reanalysis failed", safeMessage);
    reanalyzeResumeButton.textContent = "Reanalysis failed";
    greenhouseDiagnostics.textContent = `Resume reanalysis failed: ${safeMessage}`;
  } finally {
    reanalyzeResumeButton.disabled = false;
    window.setTimeout(() => { reanalyzeResumeButton.textContent = "Reanalyze Resume"; }, 2200);
  }
}

async function copyDebugReport() {
  if (!popupState.debugReport) {
    copyDebugReportButton.textContent = "Run autofill first";
    window.setTimeout(() => { copyDebugReportButton.textContent = "Copy Debug Report"; }, 1500);
    return;
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(popupState.debugReport, null, 2));
    copyDebugReportButton.textContent = "Copied";
  } catch (error) {
    console.error("Rend Autofill debug report copy failed", error);
    copyDebugReportButton.textContent = "Copy failed";
  }
  window.setTimeout(() => { copyDebugReportButton.textContent = "Copy Debug Report"; }, 1500);
}

async function processJobApplication(options) {
  const traceStartedAt = performance.now();
  let deterministicResolveMs = 0;
  const ignoredInputTypes = new Set([
    "hidden",
    "submit",
    "button",
    "reset",
    "image"
  ]);
  const profileKeyByCanonicalField = {
    firstName: "firstName",
    lastName: "lastName",
    email: "email",
    phone: "phone",
    country: "country",
    city: "city",
    currentEmployer: "currentEmployer",
    currentJobTitle: "currentJobTitle",
    yearsOfExperience: "totalYearsExperience",
    linkedinUrl: "linkedinUrl",
    githubUrl: "githubUrl",
    portfolioUrl: "portfolioUrl"
  };
  const dropdownPreferenceFields = new Set([
    "workAuthorization",
    "requiresSponsorship",
    "currentCountry",
    "preferredLocation",
    "interviewAccommodation",
    "onCallExperience",
    "infrastructureAutomationExperience",
    "monitoringObservabilityExperience",
    "productionToolingExperience",
    "kubernetesExperience",
    "cicdExperience",
    "employmentRestrictions",
    "sreCodeDiscussion",
    "previouslyWorkedAtCompany"
  ]);
  const sensitivePattern = /gender|sex|ethnicity|ethnic|race|hispanic|veteran|disability|disabled|demographic/i;
  const isGreenhousePage = /greenhouse/i.test(window.location.hostname) ||
    Boolean(document.querySelector("[id*='greenhouse' i], [class*='greenhouse' i]"));

  function cleanText(value) {
    return (value ?? "").trim().replace(/\s+/g, " ");
  }

  function normalizeMatchText(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getExplicitLabel(field) {
    if (!field.id) {
      return "";
    }

    return [...document.querySelectorAll("label[for]")]
      .filter((label) => label.htmlFor === field.id)
      .map((label) => cleanText(label.textContent))
      .filter(Boolean)
      .join(" | ");
  }

  function getParentLabel(field) {
    return cleanText(field.closest("label")?.textContent);
  }

  function getAriaLabelledBy(field) {
    return (field.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => cleanText(document.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(" | ");
  }

  function getNearbyText(field) {
    let container = field.parentElement;
    let fallback = "";

    for (let level = 0; container && level < 4; level += 1) {
      const text = cleanText(container.innerText);

      if (text && text.length <= 300) {
        return text;
      }

      if (!fallback && text) {
        fallback = text.slice(0, 300);
      }

      container = container.parentElement;
    }

    return fallback;
  }

  function isTechnicalField(field) {
    const technicalContainer = field.closest(
      "[class*='captcha' i], [id*='captcha' i], [class*='honeypot' i], [id*='honeypot' i], [class*='turnstile' i], [id*='turnstile' i]"
    );
    const identifiers = [
      field.name,
      field.id,
      field.getAttribute("aria-label"),
      field.getAttribute("title"),
      field.className
    ].join(" ");

    return Boolean(technicalContainer) ||
      /g-recaptcha-response|hcaptcha|captcha|cf-turnstile|honeypot|anti[-_ ]?bot/i.test(
        identifiers
      );
  }

  function classifyField(field, directLabelText) {
    const hasOpaqueQuestionId = /\bquestion[_-]?\d+\b/i.test(
      `${field.id} ${field.name}`
    );
    const structuralText = hasOpaqueQuestionId ? "" : `${field.id} ${field.name}`;
    const normalizedDirectLabel = normalizeMatchText(directLabelText).replace(/\brequired\b/g, "").trim();
    const exactProfileFacts = new Map([
      ["current employer", "currentEmployer"], ["current company", "currentEmployer"],
      ["present employer", "currentEmployer"], ["who is your current employer", "currentEmployer"],
      ["who do you currently work for", "currentEmployer"],
      ["current job title", "currentJobTitle"], ["current role", "currentJobTitle"],
      ["current position", "currentJobTitle"], ["what is your current title", "currentJobTitle"],
      ["present job title", "currentJobTitle"],
      ["how many years of professional experience do you have", "yearsOfExperience"],
      ["years of professional experience", "yearsOfExperience"],
      ["total years of experience", "yearsOfExperience"],
      ["how many years have you worked professionally", "yearsOfExperience"]
    ]);
    if (exactProfileFacts.has(normalizedDirectLabel)) return exactProfileFacts.get(normalizedDirectLabel);
    if (/^(are you currently located in|are you currently based in|do you currently reside in|are you located in)\b/.test(normalizedDirectLabel)) {
      return "currentCountryComparison";
    }
    const rules = [
      ["firstName", /\b(first|given)\s*name\b/],
      ["lastName", /\b(last|family|sur)\s*name\b/],
      ["email", /\be[- ]?mail\b/],
      ["phone", /\b(phone|telephone|mobile|cell)\b/],
      ["linkedinUrl", /\blinked\s*in\b/],
      ["githubUrl", /\bgit\s*hub\b/],
      ["portfolioUrl", /\b(portfolio|personal\s+website|website)\b/],
      ["city", /\b(city|town|municipality)\b/],
      ["coverLetter", /\bcover\s*letter\b/],
      ["resume", /\b(resume|résumé|curriculum vitae|cv)\b/],
      ["gender", /\b(gender|gender identity)\b/],
      ["ethnicity", /\b(ethnicity|ethnic|race|hispanic)\b/],
      ["veteranStatus", /\b(veteran|military service)\b/],
      ["disabilityStatus", /\b(disability|disabled)\b/],
      ["country", /\b(country|nation)\b/]
    ];

    function findSingleMatch(text) {
      const normalized = cleanText(text).toLowerCase().replace(/[_-]+/g, " ");
      const matches = rules
        .filter(([, pattern]) => pattern.test(normalized))
        .map(([canonicalField]) => canonicalField);

      return matches.length === 1 ? matches[0] : "unknown";
    }

    const directMatch = findSingleMatch(
      `${structuralText} ${directLabelText} ${field.ariaLabel} ${field.placeholder}`
    );

    return directMatch !== "unknown"
      ? directMatch
      : findSingleMatch(field.nearbyText);
  }

  function classifyPreference(field) {
    function findMatches(sourceText) {
      const text = normalizeMatchText(sourceText);
      const has = (pattern) => pattern.test(text);
      if (/^(are you currently located in|are you currently based in|do you currently reside in|are you located in)\b/.test(text)) {
        return [];
      }
      const rules = [
        ["requiresSponsorship", has(/\bsponsor(ship)?\b/) && has(/\b(require|requires|required|need|future)\b/)],
        ["workAuthorization", has(/\bwork\b/) && has(/\b(authori[sz]ed|authori[sz]ation|eligible|right to work)\b/)],
        ["currentCountry", has(/\bcountry\b/) && has(/\b(current|currently|residence|reside|living)\b/)],
        ["preferredLocation", has(/\bpreferred location\b/) || (has(/\b(country|location)\b/) && has(/\b(located|if hired|upon hire)\b/))],
        ["noticePeriod", has(/\bnotice period\b/) || has(/\b(available|availability)\b.*\b(start|commence)\b/)],
        ["salaryExpectation", has(/\b(salary|compensation)\b/) && has(/\b(expectation|expected|desired|requirement)\b/)],
        ["interviewAccommodation", has(/\b(interview|hiring process)\b/) && has(/\b(accommodation|adjustment|accessibility)\b/)],
        ["onCallExperience", has(/\bon call\b/) && has(/\b(experience|rotation|participated|part of)\b/)],
        ["infrastructureAutomationExperience", has(/\b(infrastructure|terraform|iac)\b/) && has(/\b(automat|automation|as code|experience)\b/)],
        ["monitoringObservabilityExperience", has(/\bmonitoring\b/) && has(/\bobservability\b/)],
        ["productionToolingExperience", has(/\bproduction\b/) && has(/\b(tooling|automation)\b/) && has(/\b(build|built|develop|created|experience)\b/)],
        ["kubernetesExperience", has(/\b(kubernetes|k8s)\b/) && has(/\b(experience|production|hands on)\b/)],
        ["cicdExperience", has(/\b(ci cd|continuous integration|continuous delivery|continuous deployment)\b/)],
        ["cloudProviders", has(/\b(cloud provider|cloud providers|aws|azure|gcp|google cloud)\b/) && has(/\b(run|workload|production|provider)\b/)],
        ["programmingLanguages", has(/\b(programming languages|languages)\b/) && has(/\b(shipped|production code|programming|code in)\b/)],
        ["preferredName", has(/\bname\b/) && has(/\b(prefer|preferred|use throughout|call you)\b/)],
        ["employmentRestrictions", has(/\b(employment agreement|post employment|non compete|employment restriction|restrictive covenant)\b/)],
        ["sreCodeDiscussion", has(/\b(code discussion|read debug|reason about code)\b/) && has(/\b(go|ruby|sre|technical interview)\b/)],
        ["previouslyWorkedAtCompany", has(/\b(previously|before|formerly)\b/) && has(/\b(worked at|worked for|consulted for|employee|employed by)\b/)]
      ];
      let matches = rules.filter(([, matched]) => matched).map(([name]) => name);

      if (matches.includes("infrastructureAutomationExperience")) {
        matches = matches.filter((name) => name !== "cicdExperience");
      }
      return matches;
    }

    const labelMatches = findMatches(field.labelText);
    const matches = labelMatches.length > 0
      ? labelMatches
      : findMatches(field.nearbyText);

    return {
      preferenceField: matches.length === 1 ? matches[0] : "unknown",
      preferenceMatches: matches
    };
  }

  const inspectedFields = [...document.querySelectorAll(
    "input, textarea, select, [role='combobox']"
  )]
    .filter((field) => {
      if (field.disabled || isTechnicalField(field)) {
        return false;
      }

      return !(
        field instanceof HTMLInputElement &&
        ignoredInputTypes.has(field.type)
      );
    })
    .map((element) => {
      const ariaLabel = element.getAttribute("aria-label") ?? "";
      const placeholder = element.getAttribute("placeholder") ?? "";
      const name = element.getAttribute("name") ?? "";
      const id = element.id;
      const nearbyText = getNearbyText(element);
      const directLabelText =
        getExplicitLabel(element) ||
        getParentLabel(element) ||
        cleanText(ariaLabel) ||
        getAriaLabelledBy(element);
      const labelText = directLabelText || nearbyText;
      const metadata = {
        tagName: element.tagName.toLowerCase(),
        type: element.type ?? "",
        name,
        id,
        placeholder,
        ariaLabel,
        labelText,
        directLabelText,
        nearbyText,
        required: Boolean(element.required),
        disabled: Boolean(element.disabled),
        readonly: Boolean(element.readOnly),
        role: element.getAttribute("role") ?? "",
        ariaControls: element.getAttribute("aria-controls") ?? ""
      };
      metadata.currentValue = cleanText("value" in element ? element.value : element.textContent);
      metadata.controlType = metadata.role === "combobox"
        ? "combobox"
        : element instanceof HTMLSelectElement
          ? "nativeSelect"
          : element instanceof HTMLTextAreaElement
            ? "textarea"
            : metadata.type || metadata.tagName;
      metadata.options = element instanceof HTMLSelectElement
        ? [...element.options].map((option) => cleanText(option.textContent)).filter(Boolean)
        : [];

      const resolveStartedAt = performance.now();
      const preference = classifyPreference(metadata);
      const canonicalField = classifyField(metadata, directLabelText);
      const countryComparison = canonicalField === "currentCountryComparison"
        ? normalizeMatchText(directLabelText).match(/\b(?:located|based|reside)\s+in\s+(?:the\s+)?(.+?)$/)?.[1] || ""
        : "";
      deterministicResolveMs += performance.now() - resolveStartedAt;

      return {
        element,
        metadata: {
          ...metadata,
          canonicalField,
          entities: countryComparison ? { country: countryComparison } : {},
          ...preference
        }
      };
    });

  const scanFinishedAt = performance.now();
  const fields = inspectedFields.map(({ metadata }) => metadata);
  const grouped = Object.entries(
    fields.reduce((counts, field) => {
      counts[field.canonicalField] = (counts[field.canonicalField] ?? 0) + 1;
      return counts;
    }, {})
  ).map(([canonicalField, count]) => ({ canonicalField, count }));
  console.group(`Rend Autofill: ${fields.length} useful field(s)`);
  console.log("All useful detected fields");
  console.table(fields);
  console.log("Summary grouped by canonicalField");
  console.table(grouped);
  console.log("Rend Autofill Answer Bank matching");
  console.table([
    "preferredName",
    "employmentRestrictions",
    "sreCodeDiscussion",
    "previouslyWorkedAtCompany",
    "preferredLocation"
  ].map((preferenceField) => ({
    preferenceField,
    storedValue: Array.isArray(options.preferences?.[preferenceField])
      ? options.preferences[preferenceField].join(", ")
      : options.preferences?.[preferenceField] ?? "",
    matchedQuestion: fields
      .filter((field) => field.preferenceField === preferenceField)
      .map((field) => field.labelText)
      .join(" | ")
  })));
  console.groupEnd();

  if (options.mode === "scan") {
    return fields;
  }

  function fieldDisplayName(field) {
    return field.labelText || field.name || field.id || field.canonicalField;
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (!setter) {
      return false;
    }

    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function chooseSelectValue(select, requestedValue, canonicalType = "") {
    const target = normalizeMatchText(requestedValue);
    const exact = [...select.options].filter(
      (item) => normalizeMatchText(item.value) === target ||
        normalizeMatchText(item.textContent) === target
    );
    if (exact.length === 1) return exact[0].value;
    if (canonicalType !== "yearsOfExperience") return "";
    const ranges = [...select.options].filter((item) => experienceRangeContains(item.textContent, requestedValue));
    return ranges.length === 1 ? ranges[0].value : "";
  }

  function isVisible(element) {
    if (!element || element.getClientRects().length === 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0";
  }

  function isCustomCombobox(element) {
    return element?.getAttribute("role") === "combobox" ||
      element?.hasAttribute("aria-controls") ||
      element?.hasAttribute("aria-expanded") ||
      element?.getAttribute("aria-haspopup") === "listbox";
  }

  function findQuestionContainer(element) {
    const namedContainer = element.closest(
      "[class*='field' i], [class*='question' i], [data-field], fieldset, [role='group']"
    );
    let container = element.parentElement;

    for (let level = 0; container && level < 7; level += 1) {
      const text = cleanText(container.innerText);
      const isOnlyPrompt = /^(select|choose)(\.\.\.|…)?$/i.test(text);

      if (!isOnlyPrompt && text.length >= 10 && text.length <= 3000) {
        return container;
      }
      container = container.parentElement;
    }

    return namedContainer || element.parentElement;
  }

  function findCombobox(element) {
    const container = findQuestionContainer(element);
    const selector = [
      "[role='combobox']",
      "input[id*='react-select' i]",
      "input[aria-autocomplete='list']",
      "[aria-haspopup='listbox']",
      "[aria-controls]"
    ].join(", ");
    const candidates = [
      ...(container ? container.querySelectorAll(selector) : []),
      ...(element.matches(selector) ? [element] : [])
    ].filter(isVisible);
    const reactSelectInput = candidates.find((candidate) =>
      /react-select/i.test(`${candidate.id} ${candidate.className}`)
    );

    if (reactSelectInput) {
      return reactSelectInput;
    }

    const semanticControl = candidates.find(isCustomCombobox);

    if (semanticControl) {
      return semanticControl;
    }

    const selectTextElements = container
      ? [...container.querySelectorAll("input, button, div")].filter((candidate) =>
        isVisible(candidate) &&
        /^(select|choose)(\.\.\.|…)?$/i.test(cleanText(
          "value" in candidate ? candidate.value : candidate.textContent
        ))
      )
      : [];

    return selectTextElements[0] ?? null;
  }

  function getComboboxCurrentText(combobox) {
    const input = combobox instanceof HTMLInputElement
      ? combobox
      : combobox.querySelector("input");

    if (input && cleanText(input.value)) {
      return cleanText(input.value);
    }

    const controlWrapper = combobox.closest("[class*='control' i]") || combobox;
    const selectedValue = controlWrapper.querySelector(
      "[aria-selected='true'], [class*='singleValue' i], [class*='selectedValue' i], [class*='single-value' i], [class*='selected-value' i]"
    );
    return cleanText(selectedValue?.textContent || controlWrapper.textContent);
  }

  function captureDropdownState(combobox, container) {
    const wrapper = getLikelyControlWrapper(combobox) || combobox;
    const descendantInput = combobox instanceof HTMLInputElement
      ? combobox
      : combobox.querySelector("input");
    const controlledIds = (combobox.getAttribute("aria-controls") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const selectedCandidates = [
      ...container.querySelectorAll("[role='option'][aria-selected='true']"),
      ...controlledIds.flatMap((id) => {
        const controlled = document.getElementById(id);
        return controlled
          ? [...controlled.querySelectorAll("[role='option'][aria-selected='true']")]
          : [];
      }),
      ...document.querySelectorAll(
        "[id*='react-select' i][id*='option' i][aria-selected='true']"
      )
    ].filter(isVisible);

    return {
      visibleValue: getComboboxCurrentText(combobox),
      inputValue: cleanText(descendantInput?.value),
      ariaValueText: cleanText(combobox.getAttribute("aria-valuetext")),
      ariaLabel: cleanText(combobox.getAttribute("aria-label")),
      hiddenInputValues: [...container.querySelectorAll("input[type='hidden']")]
        .map((input) => ({
          id: input.id,
          name: input.name,
          value: cleanText(input.value)
        })),
      selectedAriaOption: cleanText(selectedCandidates[0]?.textContent),
      selectedValues: [...wrapper.querySelectorAll(
        "[class*='multiValue' i]"
      )].map((value) => cleanText(value.textContent)).filter(Boolean),
      wrapperText: cleanText(wrapper.textContent)
    };
  }

  function dropdownStateHasDesiredValue(state, desiredAnswer, preferenceField) {
    const observableValues = [
      state.visibleValue,
      state.inputValue,
      state.ariaValueText,
      state.ariaLabel,
      state.selectedAriaOption,
      ...state.selectedValues,
      state.wrapperText,
      ...state.hiddenInputValues.map((input) => input.value)
    ];

    return observableValues.some((value) => observedAnswerMatches(preferenceField, desiredAnswer, value));
  }

  function dispatchRealisticClickSequence(element) {
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1
    };
    const PointerEventClass = window.PointerEvent || MouseEvent;

    element.dispatchEvent(new PointerEventClass("pointerdown", eventOptions));
    element.dispatchEvent(new MouseEvent("mousedown", eventOptions));
    element.focus();
    element.dispatchEvent(new FocusEvent("focus", {
      bubbles: true,
      composed: true
    }));
    element.dispatchEvent(new PointerEventClass("pointerup", {
      ...eventOptions,
      buttons: 0
    }));
    element.dispatchEvent(new MouseEvent("mouseup", {
      ...eventOptions,
      buttons: 0
    }));
    element.dispatchEvent(new MouseEvent("click", {
      ...eventOptions,
      buttons: 0
    }));
  }

  function getLikelyControlWrapper(combobox) {
    return combobox.closest(
      "[class*='control' i], [class*='select' i], [aria-haspopup='listbox'], [role='combobox']"
    ) || combobox.parentElement;
  }

  function getVisibleOptions(combobox) {
    const controlledIds = (combobox.getAttribute("aria-controls") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const controlledContainers = controlledIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const globalMenus = [
      ...document.querySelectorAll(
        "[role='listbox'], [role='menu'], [id*='react-select' i][id*='listbox' i], [class*='menu' i]"
      )
    ].filter(isVisible);
    const containers = [...new Set([...controlledContainers, ...globalMenus])];
    const optionSelector = [
      "[role='option']",
      "[role='menuitem']",
      "[role='menuitemradio']",
      "[role='menuitemcheckbox']",
      "[id*='react-select' i][id*='option' i]"
    ].join(", ");
    const options = [
      ...document.querySelectorAll("[role='option'], [id*='react-select' i][id*='option' i]"),
      ...containers.flatMap((container) => [
        ...container.querySelectorAll(optionSelector)
      ])
    ];

    return [...new Set(options)].filter((option) =>
      isVisible(option) &&
      option.getAttribute("aria-disabled") !== "true" &&
      !option.hasAttribute("disabled")
    );
  }

  function summarizeAddedElement(node) {
    if (!(node instanceof Element)) {
      return "";
    }

    return cleanText(node.outerHTML).slice(0, 300);
  }

  function openCombobox(combobox, timeoutMilliseconds = 800) {
    return new Promise((resolve) => {
      const addedElements = [];
      let finished = false;
      let observer;

      function finish(options) {
        if (finished) {
          return;
        }
        finished = true;
        observer.disconnect();
        window.clearTimeout(timeoutId);
        resolve({ options, addedElements });
      }

      function checkForOptions() {
        const visibleOptions = getVisibleOptions(combobox);

        if (visibleOptions.length > 0) {
          finish(visibleOptions);
          return true;
        }
        return false;
      }

      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            const summary = summarizeAddedElement(node);
            if (summary) {
              addedElements.push(summary);
            }
          }
        }
        checkForOptions();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timeoutId = window.setTimeout(() => finish([]), timeoutMilliseconds);

      dispatchRealisticClickSequence(combobox);

      if (!checkForOptions()) {
        queueMicrotask(() => {
          if (finished || checkForOptions()) {
            return;
          }

          const wrapper = getLikelyControlWrapper(combobox);
          if (wrapper && wrapper !== combobox) {
            dispatchRealisticClickSequence(wrapper);
            checkForOptions();
          }
        });
      }
    });
  }

  function normalizeDesiredAnswer(preferenceField, desiredAnswer) {
    const normalized = normalizeMatchText(desiredAnswer);
    const booleanPreferences = new Set([
      "workAuthorization",
      "requiresSponsorship",
      "interviewAccommodation",
      "onCallExperience",
      "infrastructureAutomationExperience",
      "monitoringObservabilityExperience",
      "productionToolingExperience",
      "kubernetesExperience",
      "cicdExperience",
      "employmentRestrictions",
      "sreCodeDiscussion",
      "previouslyWorkedAtCompany"
    ]);

    if (booleanPreferences.has(preferenceField)) {
      if (normalized === "true" || normalized === "yes") {
        return "yes";
      }
      if (normalized === "false" || normalized === "no") {
        return "no";
      }
    }

    return normalized;
  }

  function experienceRangeContains(optionText, desiredAnswer) {
    const years = Number(desiredAnswer);
    if (!Number.isFinite(years)) return false;
    const text = cleanText(optionText).toLowerCase();
    const range = text.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(?:years?)?$/);
    if (range) return years >= Number(range[1]) && years <= Number(range[2]);
    const plus = text.match(/^(\d+(?:\.\d+)?)\s*(?:\+|or more|plus)\s*(?:years?)?$/);
    return plus ? years >= Number(plus[1]) : false;
  }

  function observedAnswerMatches(category, desiredAnswer, observedValue) {
    return normalizeMatchText(observedValue) === normalizeDesiredAnswer(category, desiredAnswer) ||
      (category === "yearsOfExperience" && experienceRangeContains(observedValue, desiredAnswer));
  }

  function chooseMatchingOption(options, desiredAnswer, preferenceField) {
    const target = normalizeDesiredAnswer(preferenceField, desiredAnswer);
    const matches = options.filter(
      (option) => normalizeMatchText(option.textContent) === target ||
        (preferenceField === "yearsOfExperience" && experienceRangeContains(option.textContent, desiredAnswer))
    );

    return matches.length === 1 ? matches[0] : null;
  }

  function closeCombobox(combobox) {
    combobox.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true
    }));
    combobox.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true
    }));
    combobox.blur();
  }

  function waitForVerifiedState(
    combobox,
    container,
    desiredAnswer,
    preferenceField,
    timeoutMilliseconds = 500
  ) {
    return new Promise((resolve) => {
      function readState() {
        return captureDropdownState(combobox, container);
      }

      const immediateState = readState();
      if (dropdownStateHasDesiredValue(
        immediateState,
        desiredAnswer,
        preferenceField
      )) {
        resolve(immediateState);
        return;
      }

      const observer = new MutationObserver(() => {
        const state = readState();
        if (dropdownStateHasDesiredValue(state, desiredAnswer, preferenceField)) {
          observer.disconnect();
          window.clearTimeout(timeoutId);
          resolve(state);
        }
      });
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
      });
      const timeoutId = window.setTimeout(() => {
        observer.disconnect();
        resolve(readState());
      }, timeoutMilliseconds);
    });
  }

  async function attemptCustomCombobox(element, metadata, desiredAnswer) {
    const startedAt = performance.now();
    const combobox = findCombobox(element);
    const debug = {
      question: fieldDisplayName(metadata),
      desiredAnswer,
      controlType: "",
      reactSelectDetected: false,
      menuOpened: false,
      optionsFound: 0,
      matchedOption: "",
      verifiedValue: "",
      beforeVisibleValue: "",
      afterVisibleValue: "",
      beforeInputValue: "",
      afterInputValue: "",
      hiddenInputValues: [],
      selectedAriaOption: "",
      result: "control-not-found",
      durationMs: 0
    };

    if (!combobox) {
      console.debug("Rend Autofill dropdown details", {
        question: debug.question,
        desiredAnswer,
        controlOuterHTML: "",
        controlTagName: "",
        controlClassName: "",
        role: "",
        id: "",
        aria: {},
        descendantInputs: [],
        descendantInputIdsAndRoles: [],
        descendantIdContainsReactSelect: false,
        elementsAppearingInDom: [],
        visibleOptionText: []
      });
      debug.durationMs = Math.round(performance.now() - startedAt);
      return { success: false, status: "control-not-found", debug };
    }

    const container = findQuestionContainer(combobox) ||
      combobox.parentElement ||
      document.body;
    const descendantInputs = [...container.querySelectorAll("input")];
    const reactSelectDetected = descendantInputs.some((input) =>
      /react-select/i.test(`${input.id} ${input.className}`)
    ) || /react-select/i.test(`${combobox.id} ${combobox.className}`);
    debug.controlType = combobox.tagName.toLowerCase();
    debug.reactSelectDetected = reactSelectDetected;
    const beforeState = captureDropdownState(combobox, container);
    debug.beforeVisibleValue = beforeState.visibleValue;
    debug.beforeInputValue = beforeState.inputValue;
    debug.hiddenInputValues = beforeState.hiddenInputValues;
    debug.selectedAriaOption = beforeState.selectedAriaOption;

    console.debug("Rend Autofill dropdown details", {
      question: debug.question,
      desiredAnswer,
      controlOuterHTML: cleanText(combobox.outerHTML).slice(0, 1000),
      controlTagName: combobox.tagName,
      controlClassName: String(combobox.className ?? ""),
      role: combobox.getAttribute("role") ?? "",
      id: combobox.id,
      aria: {
        expanded: combobox.getAttribute("aria-expanded"),
        controls: combobox.getAttribute("aria-controls"),
        haspopup: combobox.getAttribute("aria-haspopup"),
        autocomplete: combobox.getAttribute("aria-autocomplete"),
        labelledby: combobox.getAttribute("aria-labelledby")
      },
      descendantInputs: descendantInputs.map((input) => cleanText(input.outerHTML).slice(0, 300)),
      descendantInputIdsAndRoles: descendantInputs.map((input) => ({
        id: input.id,
        role: input.getAttribute("role") ?? ""
      })),
      descendantIdContainsReactSelect: descendantInputs.some((input) =>
        /react-select/i.test(input.id)
      ),
      questionContainer: cleanText(container.outerHTML).slice(0, 1000)
    });

    const currentText = getComboboxCurrentText(combobox);
    const isPrompt = /^(select|choose)(\.\.\.|…)?$/i.test(currentText);

    if (currentText && !isPrompt) {
      debug.verifiedValue = currentText;
      debug.result = "already-answered";
      debug.durationMs = Math.round(performance.now() - startedAt);
      return { success: false, status: "already-answered", debug };
    }

    const opened = await openCombobox(combobox);
    const optionTexts = opened.options.map((option) => cleanText(option.textContent));
    debug.menuOpened = opened.options.length > 0 ||
      combobox.getAttribute("aria-expanded") === "true";
    debug.optionsFound = optionTexts.length;

    console.debug("Rend Autofill dropdown opened", {
      question: debug.question,
      elementsAppearingInDom: opened.addedElements,
      visibleOptionText: optionTexts
    });

    if (!debug.menuOpened) {
      closeCombobox(combobox);
      debug.result = "menu-not-opened";
      debug.durationMs = Math.round(performance.now() - startedAt);
      return { success: false, status: "menu-not-opened", debug };
    }

    if (opened.options.length === 0) {
      closeCombobox(combobox);
      debug.result = "options-not-found";
      debug.durationMs = Math.round(performance.now() - startedAt);
      return { success: false, status: "options-not-found", debug };
    }

    const matchingOption = chooseMatchingOption(
      opened.options,
      desiredAnswer,
      metadata.preferenceField
    );

    if (!matchingOption) {
      closeCombobox(combobox);
      debug.result = "desired-option-not-found";
      debug.durationMs = Math.round(performance.now() - startedAt);
      return { success: false, status: "desired-option-not-found", debug };
    }

    debug.matchedOption = cleanText(matchingOption.textContent);
    dispatchRealisticClickSequence(matchingOption);
    const afterState = await waitForVerifiedState(
      combobox,
      container,
      desiredAnswer,
      metadata.preferenceField
    );
    debug.afterVisibleValue = afterState.visibleValue;
    debug.afterInputValue = afterState.inputValue;
    debug.hiddenInputValues = afterState.hiddenInputValues;
    debug.selectedAriaOption = afterState.selectedAriaOption;
    debug.verifiedValue = [
      afterState.visibleValue,
      afterState.inputValue,
      afterState.ariaValueText,
      afterState.ariaLabel,
      afterState.selectedAriaOption,
      ...afterState.selectedValues,
      afterState.wrapperText,
      ...afterState.hiddenInputValues.map((input) => input.value)
    ].find((value) =>
      normalizeMatchText(value) === normalizeDesiredAnswer(
        metadata.preferenceField,
        desiredAnswer
      )
    ) ?? "";

    if (!dropdownStateHasDesiredValue(
      afterState,
      desiredAnswer,
      metadata.preferenceField
    )) {
      closeCombobox(combobox);
      debug.result = "verification-failed";
      debug.durationMs = Math.round(performance.now() - startedAt);
      return { success: false, status: "verification-failed", debug };
    }

    debug.result = "selected";
    debug.durationMs = Math.round(performance.now() - startedAt);
    return { success: true, status: "selected", debug };
  }

  function isGreenhouseLocationCityAutocomplete(element, metadata, combobox) {
    const label = normalizeMatchText(metadata.directLabelText || metadata.labelText);
    const editableInput = combobox instanceof HTMLInputElement
      ? combobox
      : combobox?.querySelector("input:not([type='hidden'])");
    const hasAutocompleteSemantics = Boolean(editableInput) && (
      editableInput.getAttribute("role") === "combobox" ||
      editableInput.getAttribute("aria-autocomplete") === "list" ||
      editableInput.hasAttribute("aria-controls") ||
      combobox?.getAttribute("role") === "combobox" ||
      combobox?.hasAttribute("aria-controls")
    );
    return metadata.canonicalField === "city" && label === "location city" && hasAutocompleteSemantics;
  }

  function locationCommitDecision({ editableValuePresent = false, selectedValuePresent = false, hiddenBackingPresent = false, ariaValuePresent = false } = {}) {
    const commitSignal = selectedValuePresent
      ? "selected-value-element"
      : hiddenBackingPresent
        ? "hidden-backing-value"
        : ariaValuePresent
          ? "aria-valuetext"
          : "";
    return {
      detected: true,
      editableValuePresent,
      committedValueDetected: Boolean(commitSignal),
      commitSignal,
      bypassedAsAlreadyAnswered: Boolean(commitSignal)
    };
  }

  function inspectLocationAutocompleteCommit(element, metadata, combobox) {
    const input = combobox instanceof HTMLInputElement
      ? combobox
      : combobox?.querySelector("input:not([type='hidden'])");
    const container = findQuestionContainer(combobox || element) || element.parentElement;
    const wrapper = getLikelyControlWrapper(combobox || element) || container;
    const editableValuePresent = Boolean(cleanText(input?.value));
    const selectedValue = wrapper?.querySelector(
      "[class*='singleValue' i], [class*='selected-value' i], [class*='single-value' i], [data-selected='true']"
    );
    const ariaValue = cleanText((combobox || input)?.getAttribute("aria-valuetext"));
    const identity = normalizeMatchText(`${metadata.id} ${metadata.name} location city`);
    const hiddenBacking = [...(container?.querySelectorAll("input[type='hidden']") || [])].find((hidden) => {
      const hiddenIdentity = normalizeMatchText(`${hidden.id} ${hidden.name}`);
      return cleanText(hidden.value) && hiddenIdentity && identity.split(" ").some((token) =>
        token.length > 3 && hiddenIdentity.includes(token)
      );
    });
    return locationCommitDecision({
      editableValuePresent,
      selectedValuePresent: Boolean(selectedValue && cleanText(selectedValue.textContent)),
      hiddenBackingPresent: Boolean(hiddenBacking),
      ariaValuePresent: Boolean(ariaValue)
    });
  }

  function locationSuggestionMatch(desiredValue, options) {
    const target = normalizeMatchText(desiredValue);
    const candidates = options.map((option) => ({
      option,
      text: cleanText(option.textContent),
      normalized: normalizeMatchText(option.textContent),
      cityComponent: normalizeMatchText(cleanText(option.textContent).split(",")[0])
    })).filter((candidate) => candidate.normalized);
    const unique = (matches, strategy) => matches.length === 1
      ? { option: matches[0].option, text: matches[0].text, strategy }
      : null;
    return unique(candidates.filter((candidate) => candidate.normalized === target), "exact") ||
      unique(candidates.filter((candidate) => candidate.cityComponent === target), "exact-city") ||
      unique(candidates.filter((candidate) =>
        candidate.normalized.startsWith(`${target} `) || target.startsWith(`${candidate.normalized} `)
      ), "unambiguous-contained");
  }

  function typeLocationQuery(input, query) {
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    if (!setNativeValue(input, "")) return false;
    if (!setNativeValue(input, query)) return false;
    const InputEventClass = window.InputEvent || Event;
    input.dispatchEvent(new InputEventClass("input", {
      bubbles: true,
      composed: true,
      data: query,
      inputType: "insertText"
    }));
    return cleanText(input.value) === cleanText(query);
  }

  function reactSelectInstancePrefix(value) {
    const id = String(value || "");
    const match = id.match(/^(react-select-.+?)-(?:input|listbox|option(?:-.*)?)$/i);
    return match?.[1] || (/^react-select-/i.test(id) ? id : "");
  }

  function findAssociatedLocationListbox(combobox) {
    const input = combobox instanceof HTMLInputElement
      ? combobox
      : combobox?.querySelector("input:not([type='hidden'])");
    const controls = [combobox, input].filter(Boolean);
    const relationshipIds = controls.flatMap((control) =>
      [control.getAttribute("aria-controls"), control.getAttribute("aria-owns")]
        .flatMap((value) => String(value || "").split(/\s+/).filter(Boolean))
    );
    const visibleListboxes = [...document.querySelectorAll("[role='listbox']")].filter(isVisible);
    const exact = relationshipIds.map((id) => document.getElementById(id))
      .find((candidate) => candidate?.getAttribute("role") === "listbox" && isVisible(candidate));
    if (exact) return { listbox: exact, associationSource: relationshipIds.includes(exact.id) && controls.some((control) => control.getAttribute("aria-controls")?.split(/\s+/).includes(exact.id)) ? "aria-controls" : "aria-owns", unrelatedListboxesIgnored: visibleListboxes.filter((item) => item !== exact).length };

    const prefixes = [...new Set([
      ...controls.map((control) => reactSelectInstancePrefix(control.id)),
      ...relationshipIds.map(reactSelectInstancePrefix)
    ].filter(Boolean))];
    const instanceMatches = visibleListboxes.filter((listbox) =>
      prefixes.some((prefix) => listbox.id === `${prefix}-listbox` || listbox.id.startsWith(`${prefix}-`))
    );
    if (instanceMatches.length === 1) return { listbox: instanceMatches[0], associationSource: "react-select-instance", unrelatedListboxesIgnored: visibleListboxes.length - 1 };

    const controlIdentity = normalizeMatchText(`${controls.map((control) => `${control.id} ${control.getAttribute("aria-controls") || ""} ${control.getAttribute("aria-owns") || ""}`).join(" ")}`);
    if (/candidate locat/.test(controlIdentity)) {
      const semanticMatches = visibleListboxes.filter((listbox) =>
        /^react-select-/i.test(listbox.id) && /candidate[-_]?locat/i.test(listbox.id)
      );
      if (semanticMatches.length === 1) return { listbox: semanticMatches[0], associationSource: "react-select-instance", unrelatedListboxesIgnored: visibleListboxes.length - 1 };
    }

    const fieldContainer = findQuestionContainer(combobox);
    const contained = fieldContainer
      ? [...fieldContainer.querySelectorAll("[role='listbox']")].filter(isVisible)
      : [];
    if (contained.length === 1 && /^react-select-/i.test(contained[0].id)) {
      return { listbox: contained[0], associationSource: "field-container", unrelatedListboxesIgnored: visibleListboxes.filter((item) => item !== contained[0]).length };
    }
    return { listbox: null, associationSource: "none", unrelatedListboxesIgnored: visibleListboxes.length };
  }

  function locationListboxState(combobox) {
    const associated = findAssociatedLocationListbox(combobox);
    const options = associated.listbox
      ? [...associated.listbox.querySelectorAll("[role='option']")].filter((option) =>
        isVisible(option) && option.getAttribute("aria-disabled") !== "true"
      )
      : [];
    return {
      ...associated,
      options,
      optionCount: associated.listbox?.querySelectorAll("[role='option']").length || 0,
      noResultsDetected: Boolean(associated.listbox && /\bno results\b/i.test(cleanText(associated.listbox.textContent)))
    };
  }

  function waitForLocationSuggestions(resolveCombobox, timeoutMilliseconds = 850) {
    return new Promise((resolve) => {
      let finished = false;
      let observer;
      const read = () => {
        const combobox = resolveCombobox();
        const state = combobox ? locationListboxState(combobox) : { listbox: null, associationSource: "none", unrelatedListboxesIgnored: 0, options: [], optionCount: 0, noResultsDetected: false };
        const input = combobox instanceof HTMLInputElement ? combobox : combobox?.querySelector("input:not([type='hidden'])");
        return { ...state, combobox, inputStayedFocused: Boolean(input && (document.activeElement === input || combobox?.contains(document.activeElement))) };
      };
      const finish = (state) => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        window.clearTimeout(timeoutId);
        resolve(state);
      };
      observer = new MutationObserver(() => {
        const state = read();
        if (state.noResultsDetected || state.options.length > 0) finish(state);
      });
      observer.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
      const timeoutId = window.setTimeout(() => finish(read()), timeoutMilliseconds);
      queueMicrotask(() => {
        const state = read();
        if (state.noResultsDetected || state.options.length > 0) finish(state);
      });
    });
  }

  function dispatchReactSelectOptionSequence(option) {
    const eventOptions = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1 };
    const PointerEventClass = window.PointerEvent || MouseEvent;
    option.dispatchEvent(new PointerEventClass("pointerdown", eventOptions));
    option.dispatchEvent(new MouseEvent("mousedown", eventOptions));
    option.dispatchEvent(new PointerEventClass("pointerup", { ...eventOptions, buttons: 0 }));
    option.dispatchEvent(new MouseEvent("mouseup", { ...eventOptions, buttons: 0 }));
    option.dispatchEvent(new MouseEvent("click", { ...eventOptions, buttons: 0 }));
  }

  function locationFallbackQuery(desiredValue) {
    const value = cleanText(desiredValue);
    if (!/^[\p{L}\p{M}'’-]+$/u.test(value) || [...value].length < 6) return "";
    return [...value].slice(0, 3).join("");
  }

  async function waitForLocationCommit(combobox, metadata, selectedText, hiddenBefore, timeoutMilliseconds = 650) {
    const read = () => {
      const liveElement = metadata.id ? document.getElementById(metadata.id) : null;
      const liveCombobox = liveElement ? findCombobox(liveElement) || liveElement : combobox;
      const liveInput = liveCombobox instanceof HTMLInputElement
        ? liveCombobox
        : liveCombobox?.querySelector("input:not([type='hidden'])");
      const container = findQuestionContainer(liveCombobox) || liveCombobox?.parentElement;
      const hiddenAfter = container ? [...container.querySelectorAll("input[type='hidden']")].map((input) => cleanText(input.value)) : [];
      const finalValue = cleanText(liveInput?.value || getComboboxCurrentText(liveCombobox));
      const visibleMatches = Boolean(locationSuggestionMatch(finalValue, [{ textContent: selectedText }]));
      const backingChanged = hiddenAfter.some((value, index) => value && value !== hiddenBefore[index]);
      const listboxState = locationListboxState(liveCombobox);
      const menuClosed = liveCombobox?.getAttribute("aria-expanded") !== "true" && !listboxState.listbox;
      const selectedAria = listboxState.options
        .some((option) => option.getAttribute("aria-selected") === "true");
      return { committed: visibleMatches && (backingChanged || menuClosed || selectedAria), finalValue };
    };
    return new Promise((resolve) => {
      const immediate = read();
      if (immediate.committed) return resolve(immediate);
      const observer = new MutationObserver(() => {
        const state = read();
        if (state.committed) {
          observer.disconnect();
          window.clearTimeout(timeoutId);
          resolve(state);
        }
      });
      observer.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
      const timeoutId = window.setTimeout(() => {
        observer.disconnect();
        resolve(read());
      }, timeoutMilliseconds);
    });
  }

  async function attemptGreenhouseLocationAutocomplete(element, metadata, desiredValue) {
    const debug = {
      detected: true,
      desiredValuePresent: Boolean(cleanText(desiredValue)),
      queryTyped: false,
      inputStayedFocusedThroughDiscovery: false,
      associatedListboxFound: false,
      listboxAssociationSource: "none",
      locationListboxDetected: false,
      unrelatedListboxesIgnored: 0,
      optionCount: 0,
      suggestionsOpened: false,
      visibleSuggestionCount: 0,
      matchFound: false,
      matchStrategy: "",
      fallbackQueryAttempted: false,
      selectionAttempted: false,
      commitVerified: false,
      failureStage: null
    };
    const combobox = findCombobox(element);
    let input = combobox instanceof HTMLInputElement
      ? combobox
      : combobox?.querySelector("input:not([type='hidden'])");
    if (!combobox || !input) return { success: false, status: "location-control-not-found", debug };
    const container = findQuestionContainer(combobox) || combobox.parentElement;
    const hiddenBefore = container ? [...container.querySelectorAll("input[type='hidden']")].map((field) => cleanText(field.value)) : [];
    const queries = [cleanText(desiredValue)];
    const fallback = locationFallbackQuery(desiredValue);
    if (fallback && normalizeMatchText(fallback) !== normalizeMatchText(desiredValue)) queries.push(fallback);
    const resolveLiveCombobox = () => {
      let liveElement = metadata.id ? document.getElementById(metadata.id) : null;
      if (!liveElement && metadata.name) {
        liveElement = [...document.querySelectorAll("input, [role='combobox']")]
          .find((candidate) => candidate.getAttribute("name") === metadata.name);
      }
      if (!liveElement && container?.isConnected) {
        liveElement = container.querySelector("[role='combobox'], input[aria-autocomplete='list'], input[id*='react-select' i]");
      }
      liveElement ||= element.isConnected ? element : null;
      return liveElement ? findCombobox(liveElement) || liveElement : null;
    };

    for (const query of queries) {
      const liveCombobox = resolveLiveCombobox() || combobox;
      input = liveCombobox instanceof HTMLInputElement
        ? liveCombobox
        : liveCombobox?.querySelector("input:not([type='hidden'])");
      debug.queryTyped = typeLocationQuery(input, query);
      if (!debug.queryTyped) {
        debug.failureStage = "query";
        return { success: false, status: "location-query-not-entered", debug };
      }
      if (query !== queries[0]) debug.fallbackQueryAttempted = true;
      const suggestionState = await waitForLocationSuggestions(resolveLiveCombobox);
      debug.inputStayedFocusedThroughDiscovery ||= suggestionState.inputStayedFocused;
      debug.associatedListboxFound ||= Boolean(suggestionState.listbox);
      debug.locationListboxDetected ||= Boolean(suggestionState.listbox);
      debug.listboxAssociationSource = suggestionState.associationSource !== "none"
        ? suggestionState.associationSource
        : debug.listboxAssociationSource;
      debug.unrelatedListboxesIgnored = Math.max(debug.unrelatedListboxesIgnored, suggestionState.unrelatedListboxesIgnored);
      debug.optionCount = Math.max(debug.optionCount, suggestionState.optionCount);
      debug.suggestionsOpened ||= Boolean(suggestionState.listbox && suggestionState.options.length > 0);
      debug.visibleSuggestionCount = Math.max(debug.visibleSuggestionCount, suggestionState.options.length);
      const match = locationSuggestionMatch(desiredValue, suggestionState.options);
      if (!match) {
        if (suggestionState.listbox && suggestionState.options.length > 0) {
          debug.failureStage = "match";
          closeCombobox(resolveLiveCombobox() || combobox);
          return { success: false, status: "location-no-matching-suggestion", debug };
        }
        if (query !== queries.at(-1)) continue;
        debug.failureStage = suggestionState.listbox ? "discover-options" : "wait-listbox";
        closeCombobox(resolveLiveCombobox() || combobox);
        return {
          success: false,
          status: suggestionState.options.length ? "location-no-matching-suggestion" : "location-suggestions-not-found",
          debug
        };
      }
      debug.matchFound = true;
      debug.matchStrategy = match.strategy;
      debug.selectionAttempted = true;
      dispatchReactSelectOptionSequence(match.option);
      const committed = await waitForLocationCommit(resolveLiveCombobox() || combobox, metadata, match.text, hiddenBefore);
      debug.commitVerified = committed.committed;
      if (!committed.committed) {
        debug.failureStage = "verify";
        closeCombobox(resolveLiveCombobox() || combobox);
        return { success: false, status: "location-commit-not-verified", debug };
      }
      debug.failureStage = null;
      return { success: true, status: "selected", value: committed.finalValue, debug };
    }
    debug.failureStage = "wait-listbox";
    return { success: false, status: "location-suggestions-not-found", debug };
  }

  async function attemptCustomMultiSelect(element, metadata, desiredAnswers) {
    const startedAt = performance.now();
    const initialContainer = findQuestionContainer(element);

    function refindControl() {
      let currentElement = metadata.id ? document.getElementById(metadata.id) : null;

      if (!currentElement && metadata.name) {
        currentElement = [...document.querySelectorAll("input, [role='combobox']")]
          .find((candidate) => candidate.getAttribute("name") === metadata.name);
      }

      if (!currentElement && initialContainer?.isConnected) {
        currentElement = initialContainer.querySelector(
          "[role='combobox'], input[id*='react-select' i], input[aria-autocomplete='list'], [aria-controls]"
        );
      }

      currentElement ||= element.isConnected ? element : null;
      const currentContainer = currentElement
        ? findQuestionContainer(currentElement)
        : null;
      return {
        currentContainer,
        currentCombobox: currentElement ? findCombobox(currentElement) : null
      };
    }

    const firstLookup = refindControl();
    const firstCombobox = firstLookup.currentCombobox;
    const debug = {
      question: fieldDisplayName(metadata),
      storedArray: [...desiredAnswers],
      desiredAnswer: desiredAnswers.join(", "),
      controlDetected: Boolean(firstCombobox),
      controlType: firstCombobox?.tagName.toLowerCase() ?? "",
      reactSelectDetected: Boolean(firstCombobox && /react-select/i.test(
        `${firstCombobox.id} ${firstCombobox.className}`
      )),
      menuOpened: false,
      optionsFound: 0,
      availableOptions: [],
      desiredOptions: [...desiredAnswers],
      matchedOptions: [],
      selectedOptions: [],
      missingOptions: [],
      finalVisibleSelectedValues: [],
      matchedOption: "",
      verifiedValue: "",
      result: "control-not-found",
      durationMs: 0
    };
    const selected = [];
    const missing = [];
    const availableOptionTexts = new Set();

    if (!firstCombobox) {
      debug.missingOptions = [...desiredAnswers];
      debug.durationMs = Math.round(performance.now() - startedAt);
      return { selected, missing: [...desiredAnswers], debug };
    }

    for (const desiredAnswer of desiredAnswers) {
      const lookup = refindControl();
      const activeCombobox = lookup.currentCombobox;
      const activeContainer = lookup.currentContainer;

      if (!activeCombobox || !activeContainer) {
        missing.push(desiredAnswer);
        continue;
      }

      const existingState = captureDropdownState(activeCombobox, activeContainer);

      if (dropdownStateHasDesiredValue(
        existingState,
        desiredAnswer,
        metadata.preferenceField
      )) {
        selected.push(desiredAnswer);
        continue;
      }

      let visibleOptions = getVisibleOptions(activeCombobox);

      if (visibleOptions.length === 0) {
        const opened = await openCombobox(activeCombobox);
        visibleOptions = opened.options;
      }

      for (const option of visibleOptions) {
        availableOptionTexts.add(cleanText(option.textContent));
      }
      debug.menuOpened = debug.menuOpened || visibleOptions.length > 0;
      debug.optionsFound = Math.max(debug.optionsFound, visibleOptions.length);
      const option = chooseMatchingOption(
        visibleOptions,
        desiredAnswer,
        metadata.preferenceField
      );

      if (!option) {
        missing.push(desiredAnswer);
        closeCombobox(activeCombobox);
        continue;
      }

      debug.matchedOptions.push(cleanText(option.textContent));
      dispatchRealisticClickSequence(option);
      const verifiedState = await waitForVerifiedState(
        activeCombobox,
        activeContainer,
        desiredAnswer,
        metadata.preferenceField
      );

      if (dropdownStateHasDesiredValue(
        verifiedState,
        desiredAnswer,
        metadata.preferenceField
      )) {
        selected.push(desiredAnswer);
      } else {
        missing.push(desiredAnswer);
      }
    }

    const finalLookup = refindControl();
    if (finalLookup.currentCombobox && finalLookup.currentContainer) {
      const finalState = captureDropdownState(
        finalLookup.currentCombobox,
        finalLookup.currentContainer
      );
      debug.finalVisibleSelectedValues = finalState.selectedValues.length > 0
        ? finalState.selectedValues
        : [finalState.visibleValue].filter(Boolean);
      closeCombobox(finalLookup.currentCombobox);
    }
    debug.availableOptions = [...availableOptionTexts];
    debug.selectedOptions = [...selected];
    debug.missingOptions = [...missing];
    debug.matchedOption = selected.join(" | ");
    debug.verifiedValue = debug.finalVisibleSelectedValues.join(" | ");
    debug.result = selected.length > 0 ? "selected" : "desired-option-not-found";
    debug.durationMs = Math.round(performance.now() - startedAt);
    return { selected, missing, debug };
  }

  function isClearResumeField(element, metadata) {
    if (!(element instanceof HTMLInputElement) || element.type !== "file") {
      return false;
    }

    const opaqueQuestion = /\bquestion[_-]?\d+\b/i.test(
      `${metadata.id} ${metadata.name}`
    );
    const structuralText = opaqueQuestion ? "" : `${metadata.id} ${metadata.name}`;
    const evidence = normalizeMatchText(
      `${metadata.labelText} ${metadata.ariaLabel} ${metadata.nearbyText} ${structuralText}`
    );

    return /\b(resume|cv|curriculum vitae)\b/.test(evidence) &&
      !/\bcover letter\b/.test(evidence);
  }

  function recreateStoredResume(storedResume) {
    const binary = atob(storedResume.base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new File([bytes], storedResume.name, {
      type: storedResume.type,
      lastModified: storedResume.lastModified
    });
  }

  function assignResumeFile(input, file) {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return input.files.length === 1 && input.files[0].name === file.name;
    } catch (error) {
      console.error("Rend Autofill could not assign the resume file:", error);
      return false;
    }
  }

  const result = {
    basicFilled: [],
    preferencesFilled: [],
    multiSelectFilled: [],
    ambiguousMatches: [],
    storedOptionsNotFound: [],
    greenhouseDiagnostics: [],
    selfIdentificationDiagnostics: [],
    aiPipelineDiagnostics: [],
    locationAutocomplete: options.debugDiagnostics ? [] : undefined,
    locationAutocompletePrecheck: options.debugDiagnostics ? [] : undefined,
    resolutionCandidates: [],
    skipped: [],
    resume: {
      success: false,
      label: "",
      filename: options.resume?.name ?? "",
      reason: "No clearly labeled resume field was found."
    }
  };
  const resumeCandidates = inspectedFields.filter(({ element, metadata }) =>
    isClearResumeField(element, metadata)
  );

  if (options.mode !== "ai-only" && resumeCandidates.length > 0) {
    const { element, metadata } = resumeCandidates[0];
    result.resume.label = fieldDisplayName(metadata);

    if (element.files.length > 0) {
      result.resume.reason = "The resume field already contains a file.";
    } else if (!options.resume) {
      result.resume.reason = "No resume is stored in the extension.";
    } else if (
      options.resume.type !== "application/pdf" ||
      !options.resume.name.toLowerCase().endsWith(".pdf")
    ) {
      result.resume.reason = "The stored resume is not a valid PDF.";
    } else {
      const resumeFile = recreateStoredResume(options.resume);
      result.resume.success = assignResumeFile(element, resumeFile);
      result.resume.reason = result.resume.success
        ? ""
        : "The browser did not accept the resume file.";
    }
  }

  const greenhouseBasicDebug = [];
  const greenhouseBasicElements = new Set();

  if (isGreenhousePage && options.mode !== "ai-only") {
    console.log("Saved Candidate Profile fields configured", Object.keys(options.profile || {}).filter((key) => Boolean(options.profile[key])));
    const exactBasicLabels = new Map([
      ["first name", ["firstName", "firstName"]],
      ["last name", ["lastName", "lastName"]],
      ["email", ["email", "email"]],
      ["phone", ["phone", "phone"]],
      ["phone number", ["phone", "phone"]],
      ["linkedin profile", ["linkedinUrl", "linkedin"]],
      ["linkedin url", ["linkedinUrl", "linkedin"]],
      ["linkedin", ["linkedinUrl", "linkedin"]]
    ]);

    for (const input of document.querySelectorAll("input, textarea")) {
      if (
        input.disabled ||
        input.readOnly ||
        (input instanceof HTMLInputElement && ["file", "hidden"].includes(input.type)) ||
        isTechnicalField(input)
      ) {
        continue;
      }

      const ownLabel = getExplicitLabel(input) || getParentLabel(input);
      const normalizedLabel = normalizeMatchText(
        ownLabel.replace(/\*/g, "").replace(/\brequired\b/gi, "")
      );
      const match = exactBasicLabels.get(normalizedLabel);

      if (!match) {
        continue;
      }

      const [profileKey, fieldName] = match;
      const profileValue = cleanText(options.profile[profileKey]);
      const beforeValue = cleanText(input.value);
      let status = "SKIPPED";
      let reason = "";

      greenhouseBasicElements.add(input);

      if (beforeValue) {
        reason = "already-answered";
      } else if (!profileValue) {
        status = "missing-stored-answer";
        reason = "missing-stored-answer";
      } else {
        setNativeValue(input, profileValue);
        input.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
        input.blur();
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        status = cleanText(input.value) === profileValue ? "PASS" : "FAIL";
        reason = status === "PASS" ? "verified" : "verification-failed";

        if (status === "PASS") {
          result.basicFilled.push({
            label: ownLabel,
            matchedField: profileKey,
            value: profileValue,
            name: input.name,
            id: input.id
          });
        }
      }

      greenhouseBasicDebug.push({
        field: fieldName,
        detectedLabel: ownLabel,
        profileValue,
        beforeValue,
        afterValue: cleanText(input.value),
        inputType: input.type,
        id: input.id,
        name: input.name,
        status,
        reason
      });
    }

    console.log("GREENHOUSE BASIC FIELD DEBUG");
    console.table(greenhouseBasicDebug);
  }

  const selfIdentificationCategories = [
    "gender",
    "raceEthnicity",
    "hispanicLatino",
    "veteranStatus",
    "disabilityStatus"
  ];
  const declineSynonyms = [
    "prefer not to answer",
    "decline to self identify",
    "decline to self-identify",
    "i do not want to answer",
    "i do not wish to answer",
    "i don t wish to answer"
  ];
  const selfIdentificationSynonyms = {
    gender: {
      Male: ["male", "man", "male man"],
      Female: ["female", "woman", "female woman"],
      "Non-binary": ["non binary", "nonbinary"],
      "Prefer not to answer": declineSynonyms
    },
    raceEthnicity: {
      Asian: ["asian", "asian or asian american", "asian american"],
      "Black or African American": ["black", "african american", "black or african american"],
      White: ["white", "white or caucasian", "caucasian"],
      "American Indian or Alaska Native": ["american indian", "alaska native", "american indian or alaska native"],
      "Native Hawaiian or Other Pacific Islander": ["native hawaiian", "pacific islander", "native hawaiian or other pacific islander"],
      "Two or more races": ["two or more races", "multiracial", "multiple races"],
      "Prefer not to answer": declineSynonyms
    },
    hispanicLatino: {
      Yes: ["yes", "hispanic or latino", "hispanic latino"],
      No: ["no", "not hispanic or latino", "not hispanic latino"],
      "Prefer not to answer": declineSynonyms
    },
    veteranStatus: {
      Veteran: ["veteran", "protected veteran", "i am a protected veteran", "i am a veteran"],
      "Not a veteran": ["not a veteran", "i am not a protected veteran", "i am not a veteran", "no"],
      "Prefer not to answer": declineSynonyms
    },
    disabilityStatus: {
      Yes: [
        "yes",
        "yes i have a disability",
        "i have a disability",
        "yes i have a disability or have had one in the past"
      ],
      No: [
        "no",
        "no i do not have a disability",
        "i do not have a disability",
        "no disability",
        "no i do not have a disability and have not had one in the past"
      ],
      "Prefer not to answer": declineSynonyms
    }
  };

  function classifySelfIdentificationLabel(label) {
    const text = normalizeMatchText(label)
      .replace(/\brequired\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const supportedLabels = new Map([
      ["gender", "gender"],
      ["are you hispanic latino", "hispanicLatino"],
      ["race", "raceEthnicity"],
      ["race ethnicity", "raceEthnicity"],
      ["ethnicity", "raceEthnicity"],
      ["please identify your race", "raceEthnicity"],
      ["veteran status", "veteranStatus"],
      ["protected veteran status", "veteranStatus"],
      ["disability status", "disabilityStatus"],
      ["disability", "disabilityStatus"]
    ]);

    return supportedLabels.get(text) ?? "";
  }

  function findSelfIdentificationOption(options, category, storedValue) {
    const allowed = selfIdentificationSynonyms[category]?.[storedValue] ?? [];
    const normalizedAllowed = new Set(allowed.map(normalizeMatchText));
    const exactMatches = options.filter((option) =>
      normalizeMatchText(option.textContent) === normalizeMatchText(storedValue)
    );
    const synonymMatches = options.filter((option) =>
      normalizedAllowed.has(normalizeMatchText(option.textContent))
    );

    return {
      matches: exactMatches.length === 1 ? exactMatches : synonymMatches,
      available: options.map((option) => cleanText(option.textContent)),
      exactMatchUsed: exactMatches.length === 1
    };
  }

  if (isGreenhousePage && options.mode !== "ai-only") {
    const processedSelfControls = new Set();
    const processedSelfCategories = new Set();
    const selfIdentificationRoots = new Set();

    function describeSelfIdentificationControl(element) {
      const directLabelText = getExplicitLabel(element) ||
        getParentLabel(element) ||
        cleanText(element.getAttribute("aria-label")) ||
        getAriaLabelledBy(element);
      return {
        element,
        metadata: {
          directLabelText,
          nearbyText: getNearbyText(element)
        }
      };
    }

    function collectSelfIdentificationCandidates(root) {
      if (!root?.isConnected) return [];
      const selector = "input, select, [role='combobox']";
      const elements = [
        ...(root.matches?.(selector) ? [root] : []),
        ...root.querySelectorAll(selector)
      ];
      return [...new Set(elements)]
        .filter((element) => !element.disabled && !isTechnicalField(element))
        .map(describeSelfIdentificationControl)
        .filter(({ metadata }) => {
          const ownLabel = metadata.directLabelText || metadata.nearbyText;
          const category = classifySelfIdentificationLabel(ownLabel);
          return category && !processedSelfCategories.has(category);
        });
    }

    function waitForNewSelfIdentificationCandidates(timeoutMilliseconds = 600) {
      return new Promise((resolve) => {
        const read = () => [...selfIdentificationRoots]
          .flatMap(collectSelfIdentificationCandidates);
        const immediate = read();
        if (immediate.length > 0) {
          resolve(immediate);
          return;
        }
        const observers = [];
        let finished = false;
        const finish = (candidates) => {
          if (finished) return;
          finished = true;
          observers.forEach((observer) => observer.disconnect());
          window.clearTimeout(timeoutId);
          resolve(candidates);
        };
        for (const root of selfIdentificationRoots) {
          if (!root?.isConnected) continue;
          const observer = new MutationObserver(() => {
            const candidates = read();
            if (candidates.length > 0) finish(candidates);
          });
          observer.observe(root, { childList: true, subtree: true });
          observers.push(observer);
        }
        const timeoutId = window.setTimeout(() => finish(read()), timeoutMilliseconds);
      });
    }

    async function processSelfIdentificationCandidate({ element, metadata }) {
      const ownLabel = metadata.directLabelText || metadata.nearbyText;
      const category = classifySelfIdentificationLabel(ownLabel);

      if (!category || processedSelfCategories.has(category)) return false;

      const control = element instanceof HTMLSelectElement
        ? element
        : findCombobox(element);
      if (!control || processedSelfControls.has(control)) {
        return false;
      }
      processedSelfControls.add(control);
      processedSelfCategories.add(category);
      const questionContainer = findQuestionContainer(control);
      const scopedRoot = control.closest(
        "fieldset, section, [class*='demographic' i], [class*='self-identification' i], [class*='eeoc' i], [class*='voluntary' i]"
      ) || questionContainer?.parentElement || questionContainer;
      if (scopedRoot) selfIdentificationRoots.add(scopedRoot);

      const storedValue = cleanText(options.selfIdentification?.[category]);
      const diagnostic = {
        field: category,
        storedValue,
        questionLabel: ownLabel,
        detectedQuestion: ownLabel,
        availableOptions: [],
        mappedTargetOption: "",
        selectedOption: "",
        finalVisibleValue: "",
        result: "SKIPPED",
        reason: ""
      };

      if (!storedValue) {
        diagnostic.result = "missing-stored-answer";
        diagnostic.reason = "missing-stored-answer";
        result.selfIdentificationDiagnostics.push(diagnostic);
        return false;
      }

      if (storedValue === "Not specified") {
        diagnostic.reason = "not-specified";
        result.selfIdentificationDiagnostics.push(diagnostic);
        return false;
      }

      const currentValue = control instanceof HTMLSelectElement
        ? cleanText(control.selectedOptions[0]?.textContent)
        : getComboboxCurrentText(control);
      const isPrompt = !currentValue || /^(select|choose)(\.\.\.|…)?$/i.test(currentValue);

      if (!isPrompt) {
        diagnostic.finalVisibleValue = currentValue;
        diagnostic.reason = "already-answered";
        result.selfIdentificationDiagnostics.push(diagnostic);
        return false;
      }

      let availableOptions;
      if (control instanceof HTMLSelectElement) {
        availableOptions = [...control.options].filter((option) => option.value);
      } else {
        const opened = await openCombobox(control);
        availableOptions = opened.options;
      }

      const optionResult = findSelfIdentificationOption(
        availableOptions,
        category,
        storedValue
      );
      diagnostic.availableOptions = optionResult.available;

      if (optionResult.matches.length === 0) {
        const positiveVeteranOptions = category === "veteranStatus" &&
          storedValue === "Veteran"
          ? optionResult.available.filter((optionText) => {
            const normalized = normalizeMatchText(optionText);
            return /\bveteran\b/.test(normalized) &&
              !/\b(not|decline|do not|don t|prefer not)\b/.test(normalized);
          })
          : [];
        const unsafeVeteranChoice = positiveVeteranOptions.length > 1;
        diagnostic.result = unsafeVeteranChoice
          ? "ambiguous-option"
          : "option-not-found";
        diagnostic.reason = diagnostic.result;
        closeCombobox(control);
        result.selfIdentificationDiagnostics.push(diagnostic);
        return false;
      }

      if (optionResult.matches.length > 1) {
        diagnostic.result = "ambiguous-option";
        diagnostic.reason = "ambiguous-option";
        closeCombobox(control);
        result.selfIdentificationDiagnostics.push(diagnostic);
        return false;
      }

      const selectedOption = optionResult.matches[0];
      diagnostic.mappedTargetOption = cleanText(selectedOption.textContent);
      diagnostic.selectedOption = cleanText(selectedOption.textContent);

      if (control instanceof HTMLSelectElement) {
        setNativeValue(control, selectedOption.value);
      } else {
        dispatchRealisticClickSequence(selectedOption);
      }

      let verified;
      if (control instanceof HTMLSelectElement) {
        verified = normalizeMatchText(control.selectedOptions[0]?.textContent) ===
          normalizeMatchText(diagnostic.selectedOption);
        diagnostic.finalVisibleValue = cleanText(
          control.selectedOptions[0]?.textContent
        );
      } else {
        const verifiedState = await waitForVerifiedState(
          control,
          findQuestionContainer(control),
          diagnostic.selectedOption,
          category
        );
        verified = dropdownStateHasDesiredValue(
          verifiedState,
          diagnostic.selectedOption,
          category
        );
        diagnostic.finalVisibleValue = verifiedState.visibleValue ||
          verifiedState.selectedAriaOption ||
          verifiedState.wrapperText;
      }
      diagnostic.result = verified ? "PASS" : "verification-failed";
      diagnostic.reason = verified ? "verified" : "verification-failed";
      result.selfIdentificationDiagnostics.push(diagnostic);
      return verified;
    }

    let successfulSelfIdentificationInteractions = 0;
    for (const candidate of inspectedFields) {
      if (await processSelfIdentificationCandidate(candidate)) {
        successfulSelfIdentificationInteractions += 1;
      }
    }

    for (let dynamicPass = 0; dynamicPass < 2 && successfulSelfIdentificationInteractions > 0; dynamicPass += 1) {
      const dynamicCandidates = await waitForNewSelfIdentificationCandidates();
      if (dynamicCandidates.length === 0) break;
      let newlySuccessful = 0;
      for (const candidate of dynamicCandidates) {
        if (await processSelfIdentificationCandidate(candidate)) newlySuccessful += 1;
      }
      successfulSelfIdentificationInteractions = newlySuccessful;
    }

    for (const category of selfIdentificationCategories) {
      if (!result.selfIdentificationDiagnostics.some((row) => row.field === category)) {
        result.selfIdentificationDiagnostics.push({
          field: category,
          storedValue: cleanText(options.selfIdentification?.[category]),
          questionLabel: "",
          detectedQuestion: "",
          availableOptions: [],
          mappedTargetOption: "",
          selectedOption: "",
          finalVisibleValue: "",
          result: "field-not-found",
          reason: "field-not-found"
        });
      }
    }

    console.log("GREENHOUSE SELF-IDENTIFICATION DEBUG");
    console.table(result.selfIdentificationDiagnostics);
    for (const row of result.selfIdentificationDiagnostics) {
      console.log(
        "JOB_AUTOFILL_SELF_IDENTIFICATION_RECORD",
        JSON.stringify(row, null, 2)
      );
    }
  }

  const dropdownDebug = [];
  const aiResolvedAnswers = Array.isArray(options.aiResolvedAnswers) ? options.aiResolvedAnswers : [];
  const processedResolvedAnswers = new Set();

  for (const { element, metadata } of inspectedFields) {
    const label = fieldDisplayName(metadata);
    const resolvedAnswer = aiResolvedAnswers.find((answer) =>
      (answer.id && answer.id === metadata.id) ||
      (answer.name && answer.name === metadata.name) ||
      answer.question === metadata.labelText
    );
    if (options.mode === "ai-only" && !resolvedAnswer) continue;
    if (resolvedAnswer && processedResolvedAnswers.has(resolvedAnswer)) continue;
    if (resolvedAnswer) processedResolvedAnswers.add(resolvedAnswer);
    if (greenhouseBasicElements.has(element)) {
      continue;
    }
    if (element instanceof HTMLInputElement && element.type === "file") {
      continue;
    }

    const visibleText = `${metadata.labelText} ${metadata.ariaLabel} ${metadata.placeholder} ${metadata.nearbyText}`;
    const profileKey = profileKeyByCanonicalField[metadata.canonicalField];
    const preferenceKey = resolvedAnswer?.canonicalType || metadata.preferenceField;

    if (sensitivePattern.test(visibleText)) {
      result.skipped.push({ label, reason: "sensitive field" });
      continue;
    }

    if (metadata.preferenceMatches.length > 1) {
      const ambiguous = {
        label,
        matches: metadata.preferenceMatches,
        reason: "ambiguous-category"
      };
      result.ambiguousMatches.push(ambiguous);
      result.skipped.push(ambiguous);
      continue;
    }

    if (metadata.readonly) {
      result.skipped.push({ label, reason: "read-only" });
      continue;
    }

    const relatedCombobox = findCombobox(element);

    if (!profileKey && preferenceKey === "unknown" && !resolvedAnswer) {
      result.skipped.push({ label, reason: "no-matching-category" });
      continue;
    }

    const source = resolvedAnswer ? options.preferences : preferenceKey !== "unknown"
      && (!profileKey || ["currentCountry", "preferredLocation"].includes(preferenceKey))
      ? options.preferences
      : options.profile;
    const usesPreference = source === options.preferences;
    const sourceKey = resolvedAnswer?.canonicalType || (usesPreference ? preferenceKey : profileKey);

    if (profileKey === "country" && !usesPreference) {
      const countryContext = normalizeMatchText(visibleText);
      const reason = /\b(phone|telephone|calling code|dial code|country code)\b/.test(
        countryContext
      )
        ? "telephone-country-code-not-confidently-determined"
        : "country-meaning-not-confirmed";
      result.skipped.push({ label, reason });
      continue;
    }
    const rawStoredValue = resolvedAnswer ? resolvedAnswer.value : source[sourceKey];
    const storedValues = Array.isArray(rawStoredValue)
      ? rawStoredValue.map(cleanText).filter(Boolean)
      : [cleanText(rawStoredValue)].filter(Boolean);
    const storedValue = storedValues[0] ?? "";

    if (usesPreference) {
      console.log("JOB_AUTOFILL_STORED_ANSWER", {
        category: preferenceKey,
        question: label,
        storedValue: rawStoredValue ?? ""
      });
    }

    if (storedValues.length === 0) {
      result.skipped.push({
        label,
        matchedField: sourceKey,
        reason: "missing-stored-answer"
      });
      continue;
    }

    if (
      usesPreference &&
      ["programmingLanguages", "cloudProviders"].includes(preferenceKey)
    ) {
      const multiAttempt = await attemptCustomMultiSelect(
        element,
        resolvedAnswer ? { ...metadata, preferenceField: preferenceKey } : metadata,
        storedValues
      );
      dropdownDebug.push(multiAttempt.debug);

      if (multiAttempt.selected.length > 0) {
        result.multiSelectFilled.push({
          label,
          matchedField: preferenceKey,
          selected: multiAttempt.selected,
          missing: multiAttempt.missing
        });
      }

      if (multiAttempt.missing.length > 0) {
        result.storedOptionsNotFound.push({
          label,
          values: multiAttempt.missing,
          reason: "multi-select-option-missing"
        });
      }

      if (multiAttempt.selected.length === 0) {
        result.skipped.push({
          label,
          matchedField: preferenceKey,
          reason: multiAttempt.debug.result === "control-not-found"
            ? "control-not-found"
            : "multi-select-option-missing"
        });
      }
      continue;
    }

    const currentValue = relatedCombobox
      ? getComboboxCurrentText(relatedCombobox)
      : cleanText("value" in element ? element.value : element.textContent);
    const isSelectPrompt = /^(select|choose)(\.\.\.|…)?$/i.test(currentValue);
    const looksLikeDropdownPrompt = isSelectPrompt ||
      /^(select|choose)(\.\.\.|…)?$/i.test(cleanText(metadata.placeholder));
    let filledSuccessfully = false;

    if (isGreenhouseLocationCityAutocomplete(element, metadata, relatedCombobox)) {
      const locationPrecheck = inspectLocationAutocompleteCommit(element, metadata, relatedCombobox);
      if (options.debugDiagnostics) result.locationAutocompletePrecheck.push(locationPrecheck);
      if (locationPrecheck.committedValueDetected) {
        result.skipped.push({ label, reason: "already-answered" });
        continue;
      }
      const locationAttempt = await attemptGreenhouseLocationAutocomplete(element, metadata, storedValue);
      if (options.debugDiagnostics) result.locationAutocomplete.push(locationAttempt.debug);
      filledSuccessfully = locationAttempt.success;
      if (!locationAttempt.success) {
        result.skipped.push({ label, matchedField: sourceKey, reason: locationAttempt.status });
        continue;
      }
    } else if (element instanceof HTMLSelectElement) {
      if (currentValue && !isSelectPrompt) {
        result.skipped.push({ label, reason: "already-answered" });
        continue;
      }

      const valueToSet = chooseSelectValue(element, storedValue, sourceKey);

      if (!valueToSet) {
        result.skipped.push({ label, matchedField: sourceKey, reason: "option-not-found" });
        continue;
      }
      filledSuccessfully = setNativeValue(element, valueToSet);
    } else if (
      relatedCombobox ||
      (usesPreference && dropdownPreferenceFields.has(preferenceKey)) ||
      (usesPreference && looksLikeDropdownPrompt)
    ) {
      const attempt = await attemptCustomCombobox(
        element,
        resolvedAnswer ? { ...metadata, preferenceField: preferenceKey } : { ...metadata, preferenceField: sourceKey },
        storedValue
      );
      filledSuccessfully = attempt.success;
      dropdownDebug.push(attempt.debug);

      if (!attempt.success) {
        result.skipped.push({ label, matchedField: sourceKey, reason: attempt.status });
        continue;
      }
    } else {
      if (currentValue && !isSelectPrompt) {
        result.skipped.push({ label, reason: "already has a value" });
        continue;
      }
      filledSuccessfully = setNativeValue(element, storedValue);
    }

    if (!filledSuccessfully) {
      result.skipped.push({ label, reason: "value could not be set" });
      continue;
    }

    const filledRecord = {
      label,
      matchedField: usesPreference
        ? preferenceKey
        : metadata.canonicalField,
      value: storedValue,
      answerSource: resolvedAnswer?.source || (usesPreference ? "answerBank" : "candidateProfile"),
      name: metadata.name,
      id: metadata.id
    };

    if (usesPreference) {
      result.preferencesFilled.push(filledRecord);
    } else {
      result.basicFilled.push(filledRecord);
    }
  }

  const basicDebugRows = inspectedFields
    .filter(({ metadata }) => profileKeyByCanonicalField[metadata.canonicalField])
    .map(({ element, metadata }) => {
      const profileKey = profileKeyByCanonicalField[metadata.canonicalField];
      const filled = result.basicFilled.find((item) =>
        item.id === metadata.id && item.name === metadata.name
      );
      return {
        canonicalField: metadata.canonicalField,
        detectedLabel: metadata.labelText,
        id: metadata.id,
        name: metadata.name,
        currentValue: cleanText("value" in element ? element.value : ""),
        profileValue: ["currentEmployer", "currentJobTitle", "city", "country"].includes(profileKey)
          ? (options.profile[profileKey] ? "[configured]" : "")
          : cleanText(options.profile[profileKey]),
        matched: Boolean(filled),
        skipReason: filled
          ? ""
          : result.skipped.find((item) => item.label === fieldDisplayName(metadata))?.reason ||
            "not-filled"
      };
    });
  const expectedAcceptanceValues = {
    firstName: options.profile.firstName,
    lastName: options.profile.lastName,
    email: options.profile.email,
    phone: options.profile.phone,
    phoneCountry: "",
    linkedin: options.profile.linkedinUrl,
    resume: options.resume?.name ?? "",
    currentCountry: options.preferences.currentCountry,
    requiresSponsorship: options.preferences.requiresSponsorship,
    preferredLocation: options.preferences.preferredLocation,
    preferredName: options.preferences.preferredName,
    employmentRestrictions: options.preferences.employmentRestrictions,
    sreCodeDiscussion: options.preferences.sreCodeDiscussion,
    onCallExperience: options.preferences.onCallExperience,
    infrastructureAutomationExperience: options.preferences.infrastructureAutomationExperience,
    monitoringObservabilityExperience: options.preferences.monitoringObservabilityExperience,
    productionToolingExperience: options.preferences.productionToolingExperience,
    kubernetesExperience: options.preferences.kubernetesExperience,
    programmingLanguages: options.preferences.programmingLanguages,
    cloudProviders: options.preferences.cloudProviders,
    previouslyWorkedAtCompany: options.preferences.previouslyWorkedAtCompany
  };
  const acceptanceAliases = { linkedin: "linkedinUrl" };
  const acceptanceReport = Object.entries(expectedAcceptanceValues).map(
    ([field, expected]) => {
      const expectedValue = Array.isArray(expected) ? expected.join(", ") : cleanText(expected);
      let actualValue = "";

      if (field === "resume") {
        actualValue = result.resume.success ? result.resume.filename : "";
      } else {
        const matchKey = acceptanceAliases[field] ?? field;
        const single = [...result.basicFilled, ...result.preferencesFilled]
          .find((item) => item.matchedField === matchKey);
        const multi = result.multiSelectFilled.find(
          (item) => item.matchedField === matchKey
        );
        actualValue = single?.value ?? multi?.selected.join(", ") ?? "";
      }

      const matchKey = acceptanceAliases[field] ?? field;
      const detected = field === "resume"
        ? resumeCandidates.length > 0
        : field === "phoneCountry"
          ? inspectedFields.some(({ metadata }) =>
            metadata.canonicalField === "country" &&
            /\b(phone|telephone|calling|dial)\b/i.test(
              `${metadata.labelText} ${metadata.nearbyText}`
            )
          )
          : inspectedFields.some(({ metadata }) =>
            metadata.canonicalField === matchKey ||
            metadata.preferenceField === matchKey
          );
      const status = actualValue
        ? "PASS"
        : !expectedValue && detected
          ? "missing-stored-answer"
          : expectedValue
            ? detected ? "FAIL" : "field-not-found"
            : "SKIPPED";
      const skipReason = result.skipped.find(
        (item) => item.matchedField === matchKey
      )?.reason;

      return {
        field,
        expectedValue,
        actualValue,
        status,
        reason: actualValue
          ? "verified"
          : status === "field-not-found"
            ? "field-not-found"
            : status === "missing-stored-answer"
              ? "missing-stored-answer"
              : expectedValue
                ? skipReason || "not filled; see detailed skip and dropdown logs"
                : "no stored value"
      };
    }
  );
  for (const row of result.selfIdentificationDiagnostics) {
    acceptanceReport.push({
      field: row.field,
      expectedValue: row.storedValue,
      actualValue: row.result === "PASS" ? row.selectedOption : "",
      status: row.result,
      reason: row.reason
    });
  }
  result.greenhouseDiagnostics = acceptanceReport
    .filter((row) => !selfIdentificationCategories.includes(row.field))
    .map((row) => ({
    field: row.field,
    storedValue: row.expectedValue,
    detected: !["field-not-found", "SKIPPED"].includes(row.status),
    attempted: Boolean(row.expectedValue) && row.status !== "field-not-found",
    finalValue: row.actualValue,
    result: row.status,
    reason: row.reason
    })).concat(result.selfIdentificationDiagnostics.map((row) => ({
    field: row.field,
    storedValue: row.storedValue,
    detectedQuestion: row.detectedQuestion,
    availableOptions: row.availableOptions,
    mappedTargetOption: row.mappedTargetOption,
    selectedOption: row.selectedOption,
    detected: Boolean(row.detectedQuestion),
    attempted: !["SKIPPED", "missing-stored-answer", "field-not-found"].includes(row.result),
    finalValue: row.finalVisibleValue,
    result: row.result,
    reason: row.reason
  })));

  if (options.mode !== "ai-only") {
    result.resolutionCandidates = inspectedFields.flatMap(({ metadata }) => {
      const label = fieldDisplayName(metadata);
      const filled = [...result.basicFilled, ...result.preferencesFilled].some((item) =>
        (metadata.id && item.id === metadata.id) || (metadata.name && item.name === metadata.name) || item.label === label
      ) || result.multiSelectFilled.some((item) => item.label === label) ||
        (metadata.type === "file" && result.resume.success && result.resume.label === label);
      const skipped = result.skipped.find((item) => item.label === label);
      if (filled || !skipped || /already|sensitive|read-only/i.test(skipped.reason || "")) return [];
      return [{
        id: metadata.id,
        name: metadata.name,
        label: metadata.labelText,
        questionText: metadata.labelText || metadata.nearbyText,
        canonicalType: metadata.preferenceField !== "unknown" ? metadata.preferenceField : metadata.canonicalField === "unknown" ? "customQuestion" : metadata.canonicalField,
        entities: metadata.entities || {},
        controlType: metadata.controlType,
        currentValue: metadata.currentValue,
        options: metadata.options.length
          ? metadata.options
          : (dropdownDebug.find((row) => row.question === label)?.availableOptions || []),
        required: metadata.required,
        skipReason: skipped.reason
      }];
    });
  }

  if (options.mode === "ai-only") {
    result.aiPipelineDiagnostics = aiResolvedAnswers.map((answer) => {
      const single = [...result.basicFilled, ...result.preferencesFilled].find((item) =>
        (answer.id && item.id === answer.id) || (answer.name && item.name === answer.name) || item.label === answer.question
      );
      const multi = result.multiSelectFilled.find((item) => item.label === answer.question || item.matchedField === answer.canonicalType);
      const skipped = result.skipped.find((item) => item.label === answer.question || item.matchedField === answer.canonicalType);
      const actualValue = single?.value ?? multi?.selected ?? null;
      return {
        platform: "greenhouse",
        field: answer.question,
        question: answer.question,
        canonicalType: answer.canonicalType,
        controlType: answer.controlType,
        source: answer.source,
        answerSource: answer.source,
        attemptedValue: answer.value,
        answer: answer.value,
        actualValue,
        result: actualValue !== null ? "PASS" : "UNRESOLVED",
        reason: actualValue !== null ? "verified" : (skipped?.reason || "not-filled"),
        deterministicResult: answer.initialCanonicalType,
        aiUsed: Boolean(answer.aiDiagnostic?.aiUsed),
        aiCanonicalType: answer.aiDiagnostic?.aiCanonicalType || "",
        confidence: answer.aiDiagnostic?.confidence ?? null,
        aiClassificationResult: answer.aiDiagnostic?.result || "",
        resumeEvidence: answer.aiDiagnostic?.resumeEvidence || []
      };
    });
  }

  const deterministicFilledCount = result.basicFilled.length + result.preferencesFilled.length +
    result.multiSelectFilled.length + (result.resume.success ? 1 : 0) +
    result.selfIdentificationDiagnostics.filter((row) => row.result === "PASS").length;
  const compactFieldTraces = options.debugDiagnostics ? inspectedFields.map(({ metadata }) => {
    const label = fieldDisplayName(metadata);
    const initialCanonicalType = metadata.preferenceField !== "unknown"
      ? metadata.preferenceField
      : metadata.canonicalField;
    const filled = [...result.basicFilled, ...result.preferencesFilled].some((item) =>
      (metadata.id && item.id === metadata.id) || (metadata.name && item.name === metadata.name) || item.label === label
    ) || result.multiSelectFilled.some((item) => item.label === label) ||
      (metadata.type === "file" && result.resume.success && result.resume.label === label);
    const skipped = result.skipped.find((item) => item.label === label);
    const sensitive = sensitivePattern.test(`${metadata.labelText} ${metadata.ariaLabel} ${metadata.placeholder} ${metadata.nearbyText}`);
    let aiEligibilityReason;
    if (!options.aiEnabled) aiEligibilityReason = "AI disabled";
    else if (!metadata.labelText && !metadata.nearbyText) aiEligibilityReason = "question text missing";
    else if (sensitive) aiEligibilityReason = "field excluded by safety policy";
    else if (initialCanonicalType !== "unknown" && skipped?.reason === "missing-stored-answer") aiEligibilityReason = "canonical type assigned but stored answer missing";
    else if (initialCanonicalType !== "unknown") aiEligibilityReason = "not customQuestion";
    else aiEligibilityReason = "adapter bypassed normalized AI resolver";
    return {
      question: cleanText(metadata.labelText || metadata.nearbyText).slice(0, 240),
      controlType: metadata.role === "combobox" ? "combobox" : (metadata.type || metadata.tagName || "unknown"),
      initialCanonicalType,
      deterministicMatched: initialCanonicalType !== "unknown",
      aiEligible: false,
      aiEligibilityReason,
      aiAttempted: false,
      aiCanonicalType: "",
      aiConfidence: null,
      resumeKnowledgeRequested: false,
      resumeCacheHit: null,
      resumeAnswerFound: false,
      finalStatus: filled ? "PASS" : /already/i.test(skipped?.reason || "") ? "SKIPPED" : "UNRESOLVED",
      skipReason: filled ? "" : (skipped?.reason || "not-filled"),
      error: ""
    };
  }) : undefined;
  result.performanceTrace = {
    timings: {
      scanMs: scanFinishedAt - traceStartedAt,
      deterministicResolveMs,
      interactionMs: performance.now() - scanFinishedAt
    },
    counts: {
      detectedFields: inspectedFields.length,
      deterministicResolved: deterministicFilledCount
    },
    ...(compactFieldTraces ? { fieldTraces: compactFieldTraces } : {})
  };

  console.group("Rend Autofill: autofill result");
  console.log("Basic field diagnostics");
  console.table(basicDebugRows);
  console.log(`Basic fields filled: ${result.basicFilled.length}`);
  console.table(result.basicFilled);
  console.log(`Single-select preferences filled: ${result.preferencesFilled.length}`);
  console.table(result.preferencesFilled);
  console.log(`Multi-select preferences filled: ${result.multiSelectFilled.length}`);
  console.table(result.multiSelectFilled);
  console.log(`Ambiguous matches: ${result.ambiguousMatches.length}`);
  console.table(result.ambiguousMatches);
  console.log("Stored options not found");
  console.table(result.storedOptionsNotFound);
  console.group("Rend Autofill dropdown debug");
  console.table(dropdownDebug);
  for (const record of dropdownDebug) {
    console.log(
      "JOB_AUTOFILL_DROPDOWN_RECORD",
      JSON.stringify(record, null, 2)
    );
  }
  console.groupEnd();
  console.log("Resume upload result");
  console.table([result.resume]);
  console.log(`Skipped ${result.skipped.length} field(s)`);
  console.table(result.skipped);
  console.groupEnd();
  console.log("JOB AUTOFILL ACCEPTANCE REPORT");
  console.table(acceptanceReport);

  return result;
}
