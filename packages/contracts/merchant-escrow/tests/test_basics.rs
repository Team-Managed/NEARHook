use near_api::{AccountId, Contract, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};

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

#[tokio::test]
async fn sandbox_receiver_accepts_valid_item_and_refunds_rejected_item() -> testresult::TestResult<()>
{
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let token = create_subaccount(&sandbox, "token.sandbox").await?;
    let sender = create_subaccount(&sandbox, "sender.sandbox").await?;
    let contract = create_subaccount(&sandbox, "merchant.sandbox")
        .await?
        .as_contract();
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let wasm = std::fs::read(wasm_path)?;
    Contract::deploy(contract.account_id().clone())
        .use_code(wasm)
        .with_init_call("new", json!({ "ft_contract_id": token.account_id() }))?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let accepted: Value = contract
        .call_function(
            "ft_on_transfer",
            json!({
                "sender_id": sender.account_id(),
                "amount": "1000",
                "msg": "{\"item_id\":\"item_123\"}",
            }),
        )
        .transaction()
        .with_signer(token.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success()
        .json()?;
    assert_eq!(accepted, json!("0"));

    let refunded: Value = contract
        .call_function(
            "ft_on_transfer",
            json!({
                "sender_id": sender.account_id(),
                "amount": "1000",
                "msg": "{\"item_id\":\"item_out_of_stock\"}",
            }),
        )
        .transaction()
        .with_signer(token.account_id().clone(), signer)
        .send_to(&network)
        .await?
        .assert_success()
        .json()?;
    assert_eq!(refunded, json!("1000"));

    Ok(())
}
