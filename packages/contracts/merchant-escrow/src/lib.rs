use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

const EVENT_STANDARD: &str = "nearhook";
const EVENT_VERSION: &str = "1.0.0";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    ft_contract_id: AccountId,
}

#[near]
impl Contract {
    #[init]
    pub fn new(ft_contract_id: AccountId) -> Self {
        require!(
            ft_contract_id != env::current_account_id(),
            "The token contract must differ from the escrow account"
        );
        Self { ft_contract_id }
    }

    /// NEP-141 receiver callback. Returns the amount of tokens not accepted.
    ///
    /// This demo accepts any well-formed item except an explicit out-of-stock or
    /// simulated-refund request. Malformed messages and unexpected FT contracts
    /// are refunded in full.
    pub fn ft_on_transfer(&self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        if env::predecessor_account_id() != self.ft_contract_id {
            return amount;
        }

        let parsed_message = serde_json::from_str::<TransferMessage>(&msg);
        let (unused_amount, reason, item_id) = match parsed_message {
            Ok(message) if message.simulate_refund => {
                (amount.0, "simulated_refund", Some(message.item_id))
            }
            Ok(message) if message.item_id == "item_out_of_stock" => {
                (amount.0, "out_of_stock", Some(message.item_id))
            }
            Ok(message) => (0, "accepted", Some(message.item_id)),
            Err(_) => (amount.0, "invalid_message", None),
        };

        let event = near_sdk::serde_json::json!({
            "standard": EVENT_STANDARD,
            "version": EVENT_VERSION,
            "event": "payment_received",
            "data": [{
                "sender_id": sender_id,
                "item_id": item_id,
                "result": reason,
                "unused_amount": unused_amount.to_string(),
            }],
        });
        env::log_str(&format!("EVENT_JSON:{event}"));

        U128(unused_amount)
    }
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct TransferMessage {
    item_id: String,
    #[serde(default)]
    simulate_refund: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

    fn set_predecessor(predecessor: AccountId) {
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(accounts(0))
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor);
        testing_env!(context.build());
    }

    fn receiver() -> Contract {
        Contract::new(accounts(1))
    }

    #[test]
    fn accepts_a_valid_in_stock_item() {
        set_predecessor(accounts(1));
        let result = receiver().ft_on_transfer(
            accounts(2),
            U128(500),
            r#"{"item_id":"item_123"}"#.to_string(),
        );
        assert_eq!(result, U128(0));
    }

    #[test]
    fn refunds_an_out_of_stock_item() {
        set_predecessor(accounts(1));
        let result = receiver().ft_on_transfer(
            accounts(2),
            U128(500),
            r#"{"item_id":"item_out_of_stock"}"#.to_string(),
        );
        assert_eq!(result, U128(500));
    }

    #[test]
    fn refunds_an_explicitly_simulated_rejection() {
        set_predecessor(accounts(1));
        let result = receiver().ft_on_transfer(
            accounts(2),
            U128(500),
            r#"{"item_id":"item_123","simulate_refund":true}"#.to_string(),
        );
        assert_eq!(result, U128(500));
    }

    #[test]
    fn refunds_malformed_messages() {
        set_predecessor(accounts(1));
        let result = receiver().ft_on_transfer(accounts(2), U128(500), "not-json".to_string());
        assert_eq!(result, U128(500));
    }

    #[test]
    fn refunds_calls_from_unconfigured_token_contracts() {
        set_predecessor(accounts(3));
        let result = receiver().ft_on_transfer(
            accounts(2),
            U128(500),
            r#"{"item_id":"item_123"}"#.to_string(),
        );
        assert_eq!(result, U128(500));
    }
}
