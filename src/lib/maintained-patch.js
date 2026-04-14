import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const CLIENT_RELATIVE_PATH = path.join("codex-rs", "core", "src", "client.rs");
const TEST_FALLBACK_PATCH = path.join("patches", "codex-hot-reload-tests.patch");

const CLIENT_RUNTIME_REWRITES = [
  {
    id: "current-client-setup-field",
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
    id: "preconnect-websocket-reset-on-auth-change",
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

  const fallbackPatchPath = path.join(projectRoot, TEST_FALLBACK_PATCH);
  const fallbackPatch = await applyFallbackPatch({
    patchPath: fallbackPatchPath,
    upstreamRoot,
    mode,
  });

  return {
    clientPath,
    runtime: runtimeResult,
    fallbackPatch,
  };
}

export function applyClientRuntimeRewrites(sourceText) {
  let text = normalizeEol(sourceText);
  const steps = [];

  for (const rewrite of CLIENT_RUNTIME_REWRITES) {
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

  return {
    changed: normalizeEol(sourceText) !== text,
    text,
    steps,
  };
}

function replaceUnique(text, rewrite) {
  if (text.includes(rewrite.replacement) && !text.includes(rewrite.search)) {
    return { text, step: { id: rewrite.id, status: "already-applied" } };
  }

  const matches = countOccurrences(text, rewrite.search);
  if (matches !== 1) {
    throw new Error(
      `rewrite ${rewrite.id} expected exactly one match, found ${matches}`,
    );
  }

  return {
    text: text.replace(rewrite.search, rewrite.replacement),
    step: { id: rewrite.id, status: "applied" },
  };
}

function insertAfterUnique(text, rewrite) {
  if (text.includes(rewrite.sentinel)) {
    return { text, step: { id: rewrite.id, status: "already-applied" } };
  }

  const matches = countOccurrences(text, rewrite.anchor);
  if (matches !== 1) {
    throw new Error(
      `rewrite ${rewrite.id} expected exactly one anchor match, found ${matches}`,
    );
  }

  return {
    text: text.replace(rewrite.anchor, `${rewrite.anchor}${rewrite.addition}`),
    step: { id: rewrite.id, status: "applied" },
  };
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
    `fallback patch drifted: ${applyCheck.stderr || applyCheck.stdout || reverseCheck.stderr || reverseCheck.stdout}`.trim(),
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
