import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const CLIENT_RELATIVE_PATH = path.join("codex-rs", "core", "src", "client.rs");
const TEST_SUITE_MOD_RELATIVE_PATH = path.join("codex-rs", "core", "tests", "suite", "mod.rs");
const TEST_BINARY_SUPPORT_RELATIVE_PATH = path.join("codex-rs", "test-binary-support", "lib.rs");
const TEST_FALLBACK_PATCHES = [
  path.join("patches", "codex-hot-reload-tests.patch"),
  path.join("patches", "codex-hot-reload-tests-0.122.patch"),
];

const CLIENT_RUNTIME_REWRITES = [
  {
    id: "current-client-setup-field",
    variants: [
      {
        search: `struct CurrentClientSetup {
    auth: Option<CodexAuth>,
    api_provider: codex_api::Provider,
    api_auth: CoreAuthProvider,
}
`,
        replacement: `struct CurrentClientSetup {
    auth: Option<CodexAuth>,
    api_provider: codex_api::Provider,
    api_auth: CoreAuthProvider,
    auth_connection_changed: bool,
}
`,
      },
      {
        search: `struct CurrentClientSetup {
    auth: Option<CodexAuth>,
    api_provider: ApiProvider,
    api_auth: SharedAuthProvider,
}
`,
        replacement: `struct CurrentClientSetup {
    auth: Option<CodexAuth>,
    api_provider: ApiProvider,
    api_auth: SharedAuthProvider,
    auth_connection_changed: bool,
}
`,
      },
    ],
  },
  {
    id: "auth-connection-key-helper",
    anchor: `impl RequestRouteTelemetry {
    fn for_endpoint(endpoint: &'static str) -> Self {
        Self { endpoint }
    }
}
`,
    addition: `
#[derive(Debug, Clone, PartialEq, Eq)]
struct AuthConnectionKey {
    auth_mode: AuthMode,
    token: Option<String>,
    account_id: Option<String>,
}

fn auth_connection_key(auth: Option<&CodexAuth>) -> Option<AuthConnectionKey> {
    auth.map(|auth| AuthConnectionKey {
        auth_mode: auth.auth_mode(),
        token: auth.get_token().ok(),
        account_id: auth.get_account_id(),
    })
}
`,
    sentinel: "fn auth_connection_key(auth: Option<&CodexAuth>) -> Option<AuthConnectionKey> {",
  },
  {
    id: "current-client-setup-reload",
    variants: [
      {
        search: `    async fn current_client_setup(&self) -> Result<CurrentClientSetup> {
        let auth = match self.state.auth_manager.as_ref() {
            Some(manager) => manager.auth().await,
            None => None,
        };
        let api_provider = self
            .state
            .provider
            .to_api_provider(auth.as_ref().map(CodexAuth::auth_mode))?;
        let api_auth = auth_provider_from_auth(auth.clone(), &self.state.provider)?;
        Ok(CurrentClientSetup {
            auth,
            api_provider,
            api_auth,
        })
    }
`,
        replacement: `    async fn current_client_setup(&self) -> Result<CurrentClientSetup> {
        let (auth, auth_connection_changed) = match self.state.auth_manager.as_ref() {
            Some(manager) => {
                let cached_before_reload = auth_connection_key(manager.auth_cached().as_ref());
                manager.reload();
                let auth = manager.auth().await;
                let auth_connection_changed =
                    cached_before_reload != auth_connection_key(auth.as_ref());
                (auth, auth_connection_changed)
            }
            None => (None, false),
        };
        let api_provider = self
            .state
            .provider
            .to_api_provider(auth.as_ref().map(CodexAuth::auth_mode))?;
        let api_auth = auth_provider_from_auth(auth.clone(), &self.state.provider)?;
        Ok(CurrentClientSetup {
            auth,
            api_provider,
            api_auth,
            auth_connection_changed,
        })
    }
`,
      },
      {
        search: `    async fn current_client_setup(
        &self,
        agent_task: Option<&RegisteredAgentTask>,
    ) -> Result<CurrentClientSetup> {
        let auth = self.state.provider.auth().await;
        let api_provider = self.state.provider.api_provider().await?;
        let auth_manager = self.state.provider.auth_manager();
        let api_auth = match (agent_task, auth_manager.as_ref(), auth.as_ref()) {
            (Some(agent_task), Some(auth_manager), Some(auth)) => {
                if let Some(authorization_header_value) = auth_manager
                    .chatgpt_agent_task_authorization_header_for_auth(
                        auth,
                        agent_task.authorization_target(),
                    )
                    .map_err(|err| {
                        CodexErr::Stream(
                            format!("failed to build agent assertion authorization: {err}"),
                            None,
                        )
                    })?
                {
                    debug!(
                        agent_runtime_id = %agent_task.agent_runtime_id,
                        task_id = %agent_task.task_id,
                        "using agent assertion authorization for downstream request"
                    );
                    let mut auth_provider = AuthorizationHeaderAuthProvider::new(
                        Some(authorization_header_value),
                        /*account_id*/ None,
                    );
                    if auth.is_fedramp_account() {
                        auth_provider = auth_provider.with_fedramp_routing_header();
                    }
                    Arc::new(auth_provider)
                } else {
                    self.state.provider.api_auth().await?
                }
            }
            _ => self.state.provider.api_auth().await?,
        };
        Ok(CurrentClientSetup {
            auth,
            api_provider,
            api_auth,
        })
    }
`,
        replacement: `    async fn current_client_setup(
        &self,
        agent_task: Option<&RegisteredAgentTask>,
    ) -> Result<CurrentClientSetup> {
        let auth_manager = self.state.provider.auth_manager();
        let (auth, auth_connection_changed) = match auth_manager.as_ref() {
            Some(manager) => {
                let cached_before_reload = auth_connection_key(manager.auth_cached().as_ref());
                manager.reload();
                let auth = self.state.provider.auth().await;
                let auth_connection_changed =
                    cached_before_reload != auth_connection_key(auth.as_ref());
                (auth, auth_connection_changed)
            }
            None => (self.state.provider.auth().await, false),
        };
        let api_provider = self.state.provider.api_provider().await?;
        let api_auth = match (agent_task, auth_manager.as_ref(), auth.as_ref()) {
            (Some(agent_task), Some(auth_manager), Some(auth)) => {
                if let Some(authorization_header_value) = auth_manager
                    .chatgpt_agent_task_authorization_header_for_auth(
                        auth,
                        agent_task.authorization_target(),
                    )
                    .map_err(|err| {
                        CodexErr::Stream(
                            format!("failed to build agent assertion authorization: {err}"),
                            None,
                        )
                    })?
                {
                    debug!(
                        agent_runtime_id = %agent_task.agent_runtime_id,
                        task_id = %agent_task.task_id,
                        "using agent assertion authorization for downstream request"
                    );
                    let mut auth_provider = AuthorizationHeaderAuthProvider::new(
                        Some(authorization_header_value),
                        /*account_id*/ None,
                    );
                    if auth.is_fedramp_account() {
                        auth_provider = auth_provider.with_fedramp_routing_header();
                    }
                    Arc::new(auth_provider)
                } else {
                    self.state.provider.api_auth().await?
                }
            }
            _ => self.state.provider.api_auth().await?,
        };
        Ok(CurrentClientSetup {
            auth,
            api_provider,
            api_auth,
            auth_connection_changed,
        })
    }
`,
      },
    ],
  },
  {
    id: "preconnect-websocket-reset-on-auth-change",
    variants: [
      {
        search: `        if !self.client.responses_websocket_enabled() {
            return Ok(());
        }
        if self.websocket_session.connection.is_some() {
            return Ok(());
        }

        let client_setup = self.client.current_client_setup().await.map_err(|err| {
            ApiError::Stream(format!(
                "failed to build websocket prewarm client setup: {err}"
            ))
        })?;
`,
        replacement: `        if !self.client.responses_websocket_enabled() {
            return Ok(());
        }
        let client_setup = self.client.current_client_setup().await.map_err(|err| {
            ApiError::Stream(format!(
                "failed to build websocket prewarm client setup: {err}"
            ))
        })?;
        if client_setup.auth_connection_changed {
            self.reset_websocket_session();
        } else if self.websocket_session.connection.is_some() {
            return Ok(());
        }
`,
      },
      {
        search: `        if !self.client.responses_websocket_enabled() {
            return Ok(());
        }
        if self.websocket_session.connection.is_some() {
            return Ok(());
        }

        let client_setup = self
            .client
            .current_client_setup(self.agent_task.as_ref())
            .await
            .map_err(|err| {
                ApiError::Stream(format!(
                    "failed to build websocket prewarm client setup: {err}"
                ))
            })?;
`,
        replacement: `        if !self.client.responses_websocket_enabled() {
            return Ok(());
        }
        let client_setup = self
            .client
            .current_client_setup(self.agent_task.as_ref())
            .await
            .map_err(|err| {
                ApiError::Stream(format!(
                    "failed to build websocket prewarm client setup: {err}"
                ))
            })?;
        if client_setup.auth_connection_changed {
            self.reset_websocket_session();
        } else if self.websocket_session.connection.is_some() {
            return Ok(());
        }
`,
      },
    ],
  },
  {
    id: "websocket-params-destructure",
    search: `            turn_metadata_header,
            options,
            auth_context,
            request_route_telemetry,
        } = params;
        let needs_new = match self.websocket_session.connection.as_ref() {
            Some(conn) => conn.is_closed().await,
            None => true,
        };
`,
    replacement: `            turn_metadata_header,
            options,
            auth_context,
            auth_connection_changed,
            request_route_telemetry,
        } = params;
        if auth_connection_changed {
            self.reset_websocket_session();
        }
        let needs_new = match self.websocket_session.connection.as_ref() {
            _ if auth_connection_changed => true,
            Some(conn) => conn.is_closed().await,
            None => true,
        };
`,
  },
  {
    id: "responses-websocket-callsite",
    search: `                    turn_metadata_header,
                    options: &options,
                    auth_context: request_auth_context,
                    request_route_telemetry: RequestRouteTelemetry::for_endpoint(
                        RESPONSES_ENDPOINT,
                    ),
`,
    replacement: `                    turn_metadata_header,
                    options: &options,
                    auth_context: request_auth_context,
                    auth_connection_changed: client_setup.auth_connection_changed,
                    request_route_telemetry: RequestRouteTelemetry::for_endpoint(
                        RESPONSES_ENDPOINT,
                    ),
`,
  },
  {
    id: "websocket-connect-params-field",
    variants: [
      {
        search: `struct WebsocketConnectParams<'a> {
    session_telemetry: &'a SessionTelemetry,
    api_provider: codex_api::Provider,
    api_auth: CoreAuthProvider,
    turn_metadata_header: Option<&'a str>,
    options: &'a ApiResponsesOptions,
    auth_context: AuthRequestTelemetryContext,
    request_route_telemetry: RequestRouteTelemetry,
}
`,
        replacement: `struct WebsocketConnectParams<'a> {
    session_telemetry: &'a SessionTelemetry,
    api_provider: codex_api::Provider,
    api_auth: CoreAuthProvider,
    turn_metadata_header: Option<&'a str>,
    options: &'a ApiResponsesOptions,
    auth_context: AuthRequestTelemetryContext,
    auth_connection_changed: bool,
    request_route_telemetry: RequestRouteTelemetry,
}
`,
      },
      {
        search: `struct WebsocketConnectParams<'a> {
    session_telemetry: &'a SessionTelemetry,
    api_provider: codex_api::Provider,
    api_auth: SharedAuthProvider,
    turn_metadata_header: Option<&'a str>,
    options: &'a ApiResponsesOptions,
    auth_context: AuthRequestTelemetryContext,
    request_route_telemetry: RequestRouteTelemetry,
}
`,
        replacement: `struct WebsocketConnectParams<'a> {
    session_telemetry: &'a SessionTelemetry,
    api_provider: codex_api::Provider,
    api_auth: SharedAuthProvider,
    turn_metadata_header: Option<&'a str>,
    options: &'a ApiResponsesOptions,
    auth_context: AuthRequestTelemetryContext,
    auth_connection_changed: bool,
    request_route_telemetry: RequestRouteTelemetry,
}
`,
      },
    ],
  },
];

const TEST_SUITE_MOD_REWRITES = [
  {
    id: "suite-mod-pathbuf-import",
    anchor: `use std::path::Path;
`,
    addition: `use std::path::PathBuf;
`,
    sentinel: "use std::path::PathBuf;",
    optional: true,
  },
  {
    id: "suite-mod-safe-codex-home",
    search: `    #[allow(clippy::unwrap_used)]
    let codex_home = tempfile::Builder::new()
        .prefix("codex-core-tests")
        .tempdir()
        .unwrap();
`,
    replacement: `    #[allow(clippy::unwrap_used)]
    let codex_home_root = std::env::var_os("CODEX_TEST_CODEX_HOME_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap()
                .join(".codex-test-home")
        });
    #[allow(clippy::unwrap_used)]
    std::fs::create_dir_all(&codex_home_root).unwrap();
    #[allow(clippy::unwrap_used)]
    let codex_home = tempfile::Builder::new()
        .prefix("codex-core-tests")
        .tempdir_in(&codex_home_root)
        .unwrap();
`,
    optional: true,
  },
];

const TEST_BINARY_SUPPORT_REWRITES = [
  {
    id: "test-binary-support-pathbuf-import",
    anchor: `use std::path::Path;
`,
    addition: `use std::path::PathBuf;
`,
    sentinel: "use std::path::PathBuf;",
  },
  {
    id: "test-binary-support-safe-codex-home",
    search: `            let codex_home = match tempfile::Builder::new().prefix(codex_home_prefix).tempdir() {
                Ok(codex_home) => codex_home,
                Err(error) => panic!("failed to create test CODEX_HOME: {error}"),
            };
`,
    replacement: `            let codex_home_root = std::env::var_os("CODEX_TEST_CODEX_HOME_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    std::env::current_dir()
                        .unwrap()
                        .join(".codex-test-home")
                });
            if let Err(error) = std::fs::create_dir_all(&codex_home_root) {
                panic!("failed to create test CODEX_HOME root: {error}");
            }
            let codex_home = match tempfile::Builder::new()
                .prefix(codex_home_prefix)
                .tempdir_in(&codex_home_root)
            {
                Ok(codex_home) => codex_home,
                Err(error) => panic!("failed to create test CODEX_HOME: {error}"),
            };
`,
  },
];

export async function applyMaintainedPatch({
  projectRoot,
  upstreamRoot,
  mode = "apply",
} = {}) {
  if (!projectRoot || !upstreamRoot) {
    throw new Error("projectRoot and upstreamRoot are required");
  }

  const clientPath = path.join(upstreamRoot, CLIENT_RELATIVE_PATH);
  const originalClientText = await fs.readFile(clientPath, "utf8");
  const runtimeResult = applyClientRuntimeRewrites(originalClientText);

  if (mode === "apply" && runtimeResult.changed) {
    await fs.writeFile(clientPath, preserveEol(originalClientText, runtimeResult.text), "utf8");
  }

  const testSuiteModPath = path.join(upstreamRoot, TEST_SUITE_MOD_RELATIVE_PATH);
  const originalTestSuiteModText = await fs.readFile(testSuiteModPath, "utf8");
  const testSuiteModResult = applyTestSuiteModRewrites(originalTestSuiteModText);
  if (mode === "apply" && testSuiteModResult.changed) {
    await fs.writeFile(
      testSuiteModPath,
      preserveEol(originalTestSuiteModText, testSuiteModResult.text),
      "utf8",
    );
  }

  const testBinarySupportPath = path.join(upstreamRoot, TEST_BINARY_SUPPORT_RELATIVE_PATH);
  const testBinarySupportResult = await applyOptionalFileRewrites({
    filePath: testBinarySupportPath,
    rewrites: TEST_BINARY_SUPPORT_REWRITES,
    mode,
  });

  const fallbackPatchPaths = TEST_FALLBACK_PATCHES.map((patchPath) => path.join(projectRoot, patchPath));
  const fallbackPatch = await applyFallbackPatches({
    patchPaths: fallbackPatchPaths,
    upstreamRoot,
    mode,
  });

  return {
    clientPath,
    runtime: runtimeResult,
    testSuiteModPath,
    testSuiteMod: testSuiteModResult,
    testBinarySupportPath,
    testBinarySupport: testBinarySupportResult,
    fallbackPatch,
  };
}

export function applyClientRuntimeRewrites(sourceText) {
  const { text, steps } = applyRewritePlan(normalizeEol(sourceText), CLIENT_RUNTIME_REWRITES);

  return {
    changed: normalizeEol(sourceText) !== text,
    text,
    steps,
  };
}

export function applyTestSuiteModRewrites(sourceText) {
  const { text, steps } = applyRewritePlan(normalizeEol(sourceText), TEST_SUITE_MOD_REWRITES);

  return {
    changed: normalizeEol(sourceText) !== text,
    text,
    steps,
  };
}

export function applyTestBinarySupportRewrites(sourceText) {
  const { text, steps } = applyRewritePlan(normalizeEol(sourceText), TEST_BINARY_SUPPORT_REWRITES);

  return {
    changed: normalizeEol(sourceText) !== text,
    text,
    steps,
  };
}

async function applyOptionalFileRewrites({ filePath, rewrites, mode }) {
  let originalText;
  try {
    originalText = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        changed: false,
        steps: rewrites.map((rewrite) => ({ id: rewrite.id, status: "skipped-file-missing" })),
      };
    }
    throw error;
  }

  const { text, steps } = applyRewritePlan(normalizeEol(originalText), rewrites);
  const changed = normalizeEol(originalText) !== text;
  if (mode === "apply" && changed) {
    await fs.writeFile(filePath, preserveEol(originalText, text), "utf8");
  }

  return { changed, text, steps };
}

function applyRewritePlan(initialText, rewrites) {
  let text = initialText;
  const steps = [];

  for (const rewrite of rewrites) {
    if ("anchor" in rewrite) {
      const result = insertAfterUnique(text, rewrite);
      text = result.text;
      steps.push(result.step);
      continue;
    }
    const result = replaceUnique(text, rewrite);
    text = result.text;
    steps.push(result.step);
  }

  return { text, steps };
}

function replaceUnique(text, rewrite) {
  const variants = rewrite.variants ?? [rewrite];
  const searchMatches = variants.reduce((sum, variant) => sum + countOccurrences(text, variant.search), 0);
  const replacementPresent = variants.some((variant) => text.includes(variant.replacement));

  if (replacementPresent && searchMatches === 0) {
    return { text, step: { id: rewrite.id, status: "already-applied" } };
  }

  const matchedVariants = variants.filter((variant) => countOccurrences(text, variant.search) > 0);
  if (matchedVariants.length !== 1 || searchMatches !== 1) {
    if (rewrite.optional && searchMatches === 0) {
      return { text, step: { id: rewrite.id, status: "skipped" } };
    }
    throw new Error(
      `rewrite ${rewrite.id} expected exactly one match, found ${searchMatches}`,
    );
  }

  const [selectedVariant] = matchedVariants;
  return {
    text: text.replace(selectedVariant.search, selectedVariant.replacement),
    step: { id: rewrite.id, status: "applied" },
  };
}

function insertAfterUnique(text, rewrite) {
  if (text.includes(rewrite.sentinel)) {
    return { text, step: { id: rewrite.id, status: "already-applied" } };
  }

  const matches = countOccurrences(text, rewrite.anchor);
  if (matches !== 1) {
    if (rewrite.optional && matches === 0) {
      return { text, step: { id: rewrite.id, status: "skipped" } };
    }
    throw new Error(
      `rewrite ${rewrite.id} expected exactly one anchor match, found ${matches}`,
    );
  }

  return {
    text: text.replace(rewrite.anchor, `${rewrite.anchor}${rewrite.addition}`),
    step: { id: rewrite.id, status: "applied" },
  };
}

async function applyFallbackPatches({ patchPaths, upstreamRoot, mode }) {
  const failures = [];

  for (const patchPath of patchPaths) {
    try {
      return await applyFallbackPatch({ patchPath, upstreamRoot, mode });
    } catch (error) {
      failures.push(`${patchPath}: ${error.message}`);
    }
  }

  throw new Error(`fallback patch drifted: ${failures.join("\n")}`);
}

async function applyFallbackPatch({ patchPath, upstreamRoot, mode }) {
  const applyCheck = await runGitApply(["--check", patchPath], upstreamRoot);
  if (applyCheck.ok) {
    if (mode === "apply") {
      const applyResult = await runGitApply([patchPath], upstreamRoot);
      if (!applyResult.ok) {
        throw new Error(`fallback patch apply failed: ${applyResult.stderr || applyResult.stdout}`.trim());
      }
    }
    return { patchPath, status: mode === "apply" ? "applied" : "ready" };
  }

  const reverseCheck = await runGitApply(["--reverse", "--check", patchPath], upstreamRoot);
  if (reverseCheck.ok) {
    return { patchPath, status: "already-applied" };
  }

  throw new Error(
    `${applyCheck.stderr || applyCheck.stdout || reverseCheck.stderr || reverseCheck.stdout}`.trim(),
  );
}

async function runGitApply(args, cwd) {
  return run("git", ["apply", ...args], cwd);
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

function preserveEol(originalText, normalizedText) {
  return originalText.includes("\r\n") ? normalizedText.replace(/\n/g, "\r\n") : normalizedText;
}

function normalizeEol(value) {
  return value.replace(/\r\n/g, "\n");
}

function countOccurrences(text, search) {
  let count = 0;
  let startIndex = 0;
  while (true) {
    const nextIndex = text.indexOf(search, startIndex);
    if (nextIndex === -1) {
      return count;
    }
    count += 1;
    startIndex = nextIndex + search.length;
  }
}
