import test from "node:test";
import assert from "node:assert/strict";

import {
  applyClientRuntimeRewrites,
  applyTestBinarySupportRewrites,
  applyTestSuiteModRewrites,
} from "../src/lib/maintained-patch.js";

const CLEAN_CLIENT_SNIPPET = `struct CurrentClientSetup {
    auth: Option<CodexAuth>,
    api_provider: codex_api::Provider,
    api_auth: CoreAuthProvider,
}

#[derive(Clone, Copy)]
struct RequestRouteTelemetry {
    endpoint: &'static str,
}

impl RequestRouteTelemetry {
    fn for_endpoint(endpoint: &'static str) -> Self {
        Self { endpoint }
    }
}

    async fn current_client_setup(&self) -> Result<CurrentClientSetup> {
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

    pub async fn preconnect_websocket(
        &mut self,
        session_telemetry: &SessionTelemetry,
        _model_info: &ModelInfo,
    ) -> std::result::Result<(), ApiError> {
        if !self.client.responses_websocket_enabled() {
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
        let auth_context = AuthRequestTelemetryContext::new(
            client_setup.auth.as_ref().map(CodexAuth::auth_mode),
            &client_setup.api_auth,
            PendingUnauthorizedRetry::default(),
        );
        let connection = self
            .client
            .connect_websocket(
                session_telemetry,
                client_setup.api_provider,
                client_setup.api_auth,
                Some(Arc::clone(&self.turn_state)),
                /*turn_metadata_header*/ None,
                auth_context,
                RequestRouteTelemetry::for_endpoint(RESPONSES_ENDPOINT),
            )
            .await?;
        self.websocket_session.connection = Some(connection);
        Ok(())
    }

            turn_metadata_header,
            options,
            auth_context,
            request_route_telemetry,
        } = params;
        let needs_new = match self.websocket_session.connection.as_ref() {
            Some(conn) => conn.is_closed().await,
            None => true,
        };

                    turn_metadata_header,
                    options: &options,
                    auth_context: request_auth_context,
                    request_route_telemetry: RequestRouteTelemetry::for_endpoint(
                        RESPONSES_ENDPOINT,
                    ),

struct WebsocketConnectParams<'a> {
    session_telemetry: &'a SessionTelemetry,
    api_provider: codex_api::Provider,
    api_auth: CoreAuthProvider,
    turn_metadata_header: Option<&'a str>,
    options: &'a ApiResponsesOptions,
    auth_context: AuthRequestTelemetryContext,
    request_route_telemetry: RequestRouteTelemetry,
}
`;

test("applyClientRuntimeRewrites patches the runtime hot-reload changes and is idempotent", () => {
  const first = applyClientRuntimeRewrites(CLEAN_CLIENT_SNIPPET);

  assert.equal(first.steps.every((step) => step.status === "applied"), true);
  assert.match(first.text, /auth_connection_changed: bool,/);
  assert.match(first.text, /fn auth_connection_key\(auth: Option<&CodexAuth>\)/);
  assert.match(first.text, /manager\.reload\(\);/);
  assert.match(first.text, /if client_setup\.auth_connection_changed \{/);
  assert.match(first.text, /_ if auth_connection_changed => true,/);
  assert.match(first.text, /auth_connection_changed: client_setup\.auth_connection_changed,/);

  const second = applyClientRuntimeRewrites(first.text);

  assert.equal(second.changed, false);
  assert.equal(second.steps.every((step) => step.status === "already-applied"), true);
});

const CLEAN_CLIENT_0122_SNIPPET = `struct CurrentClientSetup {
    auth: Option<CodexAuth>,
    api_provider: ApiProvider,
    api_auth: SharedAuthProvider,
}

#[derive(Clone, Copy)]
struct RequestRouteTelemetry {
    endpoint: &'static str,
}

impl RequestRouteTelemetry {
    fn for_endpoint(endpoint: &'static str) -> Self {
        Self { endpoint }
    }
}

    async fn current_client_setup(
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

    pub async fn preconnect_websocket(
        &mut self,
        session_telemetry: &SessionTelemetry,
        _model_info: &ModelInfo,
    ) -> std::result::Result<(), ApiError> {
        if !self.client.responses_websocket_enabled() {
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
        let auth_context = AuthRequestTelemetryContext::new(
            client_setup.auth.as_ref().map(CodexAuth::auth_mode),
            client_setup.api_auth.as_ref(),
            PendingUnauthorizedRetry::default(),
        );
        let connection = self
            .client
            .connect_websocket(
                session_telemetry,
                client_setup.api_provider,
                client_setup.api_auth,
                Some(Arc::clone(&self.turn_state)),
                /*turn_metadata_header*/ None,
                auth_context,
                RequestRouteTelemetry::for_endpoint(RESPONSES_ENDPOINT),
            )
            .await?;
        self.websocket_session.connection = Some(connection);
        self.websocket_session
            .set_connection_reused(/*connection_reused*/ false);
        Ok(())
    }

            turn_metadata_header,
            options,
            auth_context,
            request_route_telemetry,
        } = params;
        let needs_new = match self.websocket_session.connection.as_ref() {
            Some(conn) => conn.is_closed().await,
            None => true,
        };

                    turn_metadata_header,
                    options: &options,
                    auth_context: request_auth_context,
                    request_route_telemetry: RequestRouteTelemetry::for_endpoint(
                        RESPONSES_ENDPOINT,
                    ),

struct WebsocketConnectParams<'a> {
    session_telemetry: &'a SessionTelemetry,
    api_provider: codex_api::Provider,
    api_auth: SharedAuthProvider,
    turn_metadata_header: Option<&'a str>,
    options: &'a ApiResponsesOptions,
    auth_context: AuthRequestTelemetryContext,
    request_route_telemetry: RequestRouteTelemetry,
}
`;

test("applyClientRuntimeRewrites patches the upstream 0.122 runtime layout and is idempotent", () => {
  const first = applyClientRuntimeRewrites(CLEAN_CLIENT_0122_SNIPPET);

  assert.equal(first.steps.every((step) => step.status === "applied"), true);
  assert.match(first.text, /auth_connection_changed: bool,/);
  assert.match(first.text, /let \(auth, auth_connection_changed\) = match auth_manager\.as_ref\(\)/);
  assert.match(first.text, /manager\.reload\(\);/);
  assert.match(first.text, /None => \(self\.state\.provider\.auth\(\)\.await, false\),/);
  assert.match(first.text, /if client_setup\.auth_connection_changed \{/);
  assert.match(first.text, /auth_connection_changed: client_setup\.auth_connection_changed,/);

  const second = applyClientRuntimeRewrites(first.text);

  assert.equal(second.changed, false);
  assert.equal(second.steps.every((step) => step.status === "already-applied"), true);
});

const CLEAN_TEST_SUITE_MOD_SNIPPET = `// Aggregates all former standalone integration tests as modules.
use std::ffi::OsString;
use std::path::Path;

use codex_apply_patch::CODEX_CORE_APPLY_PATCH_ARG1;
use codex_arg0::Arg0PathEntryGuard;

    #[allow(clippy::unwrap_used)]
    let codex_home = tempfile::Builder::new()
        .prefix("codex-core-tests")
        .tempdir()
        .unwrap();
`;

test("applyTestSuiteModRewrites moves suite CODEX_HOME out of temporary roots", () => {
  const first = applyTestSuiteModRewrites(CLEAN_TEST_SUITE_MOD_SNIPPET);

  assert.equal(first.steps.every((step) => step.status === "applied"), true);
  assert.match(first.text, /use std::path::PathBuf;/);
  assert.match(first.text, /CODEX_TEST_CODEX_HOME_ROOT/);
  assert.match(first.text, /\.codex-test-home/);
  assert.match(first.text, /\.tempdir_in\(&codex_home_root\)/);

  const second = applyTestSuiteModRewrites(first.text);

  assert.equal(second.changed, false);
  assert.equal(second.steps.every((step) => step.status === "already-applied"), true);
});

test("applyTestSuiteModRewrites skips upstream suite harnesses that no longer need tempdir relocation", () => {
  const upstreamSnippet = `// Aggregates all former standalone integration tests as modules.
use codex_apply_patch::CODEX_CORE_APPLY_PATCH_ARG1;
use codex_sandboxing::landlock::CODEX_LINUX_SANDBOX_ARG0;
use codex_test_binary_support::configure_test_binary_dispatch;

#[ctor]
pub static CODEX_ALIASES_TEMP_DIR: Option<TestBinaryDispatchGuard> = {
    configure_test_binary_dispatch("codex-core-tests", |exe_name, argv1| {
        TestBinaryDispatchMode::InstallAliases
    })
};
`;

  const result = applyTestSuiteModRewrites(upstreamSnippet);

  assert.equal(result.changed, false);
  assert.deepEqual(
    result.steps.map((step) => step.status),
    ["skipped", "skipped"],
  );
});

const CLEAN_TEST_BINARY_SUPPORT_SNIPPET = `use std::path::Path;

use codex_arg0::Arg0DispatchPaths;
use codex_arg0::Arg0PathEntryGuard;
use codex_arg0::arg0_dispatch;
use tempfile::TempDir;

pub fn configure_test_binary_dispatch<F>(
    codex_home_prefix: &str,
    classify: F,
) -> Option<TestBinaryDispatchGuard>
where
    F: FnOnce(&str, Option<&str>) -> TestBinaryDispatchMode,
{
    match classify("", None) {
        TestBinaryDispatchMode::InstallAliases => {
            let codex_home = match tempfile::Builder::new().prefix(codex_home_prefix).tempdir() {
                Ok(codex_home) => codex_home,
                Err(error) => panic!("failed to create test CODEX_HOME: {error}"),
            };
        }
        _ => None,
    }
}
`;

test("applyTestBinarySupportRewrites relocates upstream 0.121 test CODEX_HOME roots", () => {
  const first = applyTestBinarySupportRewrites(CLEAN_TEST_BINARY_SUPPORT_SNIPPET);

  assert.equal(first.steps.every((step) => step.status === "applied"), true);
  assert.match(first.text, /use std::path::PathBuf;/);
  assert.match(first.text, /CODEX_TEST_CODEX_HOME_ROOT/);
  assert.match(first.text, /\.codex-test-home/);
  assert.match(first.text, /\.tempdir_in\(&codex_home_root\)/);

  const second = applyTestBinarySupportRewrites(first.text);

  assert.equal(second.changed, false);
  assert.equal(second.steps.every((step) => step.status === "already-applied"), true);
});
