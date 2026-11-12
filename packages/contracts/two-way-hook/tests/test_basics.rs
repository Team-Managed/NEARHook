use near_api::{AccountId, Contract, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};
use std::time::Duration;

async fn create_subaccount(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<near_api::Account> {
    let account_id: AccountId = name.parse()?;
    sandbox
        .create_account(account_id.clone())
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(near_api::Account(account_id))
}

async fn deploy(
) -> testresult::TestResult<(
    near_sandbox::Sandbox,
    NetworkConfig,
    Contract,
    Signer,
    near_api::Account,
    near_api::Account,
)> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let owner = create_subaccount(&sandbox, "owner.sandbox").await?;
    let responder = create_subaccount(&sandbox, "responder.sandbox").await?;
    let caller = create_subaccount(&sandbox, "caller.sandbox").await?;
    let contract = create_subaccount(&sandbox, "hook.sandbox")
        .await?
        .as_contract();
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let wasm = std::fs::read(wasm_path)?;
    Contract::deploy(contract.account_id().clone())
        .use_code(wasm)
        .with_init_call(
            "new",
            json!({
                "owner_id": owner.account_id(),
                "responder_id": responder.account_id(),
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    Ok((sandbox, network, contract, signer, owner, caller))
}

async fn wait_for_pending_action(
    contract: &Contract,
    network: &NetworkConfig,
    request_id: u64,
) -> testresult::TestResult<Value> {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let pending: Option<Value> = contract
                .call_function("get_pending_action", json!({ "request_id": request_id }))
                .read_only()
                .fetch_from(network)
                .await?
                .data;
            if let Some(pending) = pending {
                return Ok(pending);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await?
}

#[tokio::test]
async fn authorized_responder_resumes_yield_and_callback_clears_state()
-> testresult::TestResult<()> {
    let (sandbox, network, contract, signer, _owner, caller) = deploy().await?;
    let pending_call = contract
        .call_function("request_action", json!({ "action_id": "approve-order-1" }))
        .transaction()
        .deposit(NearToken::from_millinear(100))
        .with_signer(caller.account_id().clone(), signer.clone());
    let pending_network = network.clone();
    let pending_task = tokio::spawn(async move { pending_call.send_to(&pending_network).await });

    let pending = wait_for_pending_action(&contract, &network, 0).await?;
    assert_eq!(pending["action_id"], "approve-order-1");
    assert!(pending["yield_id"].is_string());

    contract
        .call_function(
            "resume_action",
            json!({ "request_id": 0, "payload": "{\"approved\":true}" }),
        )
        .transaction()
        .with_signer(caller.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();

    contract
        .call_function(
            "resume_action",
            json!({ "request_id": 0, "payload": "{\"approved\":true}" }),
        )
        .transaction()
        .with_signer(
            "responder.sandbox".parse()?,
            Signer::from_secret_key(
                near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
            )?,
        )
        .send_to(&network)
        .await?
        .assert_success();

    tokio::time::timeout(Duration::from_secs(30), pending_task).await???;
    let pending_after: Option<Value> = contract
        .call_function("get_pending_action", json!({ "request_id": 0 }))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert!(pending_after.is_none());

    drop(sandbox);
    Ok(())
}

#[tokio::test]
async fn timed_out_yield_clears_pending_state()
-> testresult::TestResult<()> {
    let (sandbox, network, contract, signer, _owner, caller) = deploy().await?;
    let pending_call = contract
        .call_function("request_action", json!({ "action_id": "wait-for-timeout" }))
        .transaction()
        .deposit(NearToken::from_millinear(100))
        .with_signer(caller.account_id().clone(), signer);
    let pending_network = network.clone();
    let pending_task = tokio::spawn(async move { pending_call.send_to(&pending_network).await });

    let pending = wait_for_pending_action(&contract, &network, 0).await?;
    assert_eq!(pending["action_id"], "wait-for-timeout");
    sandbox.fast_forward(210).await?;
    tokio::time::timeout(Duration::from_secs(30), pending_task).await???;

    let pending_after: Option<Value> = contract
        .call_function("get_pending_action", json!({ "request_id": 0 }))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert!(pending_after.is_none());
    drop(sandbox);
    Ok(())
}
