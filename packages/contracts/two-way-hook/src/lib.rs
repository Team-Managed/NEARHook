use near_sdk::store::LookupMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseError,
    YieldId, env, near, require,
};

const YIELD_CALLBACK_GAS: u64 = 5;
const MAX_ACTION_ID_BYTES: usize = 128;
const MAX_RESPONSE_BYTES: usize = 1024;
const EVENT_STANDARD: &str = "nearhook";
const EVENT_VERSION: &str = "1.0.0";

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    PendingActions,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PendingAction {
    pub action_id: String,
    pub requester_id: AccountId,
    pub yield_id: YieldId,
    pub created_at_ns: u64,
}

#[near(serializers = [json])]
pub enum ActionOutcome {
    Resumed { request_id: u64, response: String },
    TimedOut { request_id: u64 },
    StateMissing { request_id: u64 },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    responder_id: AccountId,
    next_request_id: u64,
    pending_actions: LookupMap<u64, PendingAction>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, responder_id: AccountId) -> Self {
        require!(
            responder_id != env::current_account_id(),
            "Responder must differ from the contract account"
        );
        Self {
            owner_id,
            responder_id,
            next_request_id: 0,
            pending_actions: LookupMap::new(StorageKey::PendingActions),
        }
    }

    /// Pause this action until the configured responder resumes it or it times out.
    /// The attached deposit pays for the pending request's storage.
    #[payable]
    pub fn request_action(&mut self, action_id: String) -> Promise {
        require!(!action_id.is_empty(), "Action ID cannot be empty");
        require!(
            action_id.len() <= MAX_ACTION_ID_BYTES,
            "Action ID exceeds the maximum length"
        );

        let request_id = self.next_request_id;
        self.next_request_id = self
            .next_request_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("Request ID space exhausted"));

        let callback_args = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
            "request_id": request_id,
        }))
        .unwrap_or_else(|_| env::panic_str("Failed to serialize callback arguments"));

        let (yield_promise, yield_id) = Promise::new_yield(
            "on_action_resumed",
            &callback_args,
            Gas::from_tgas(YIELD_CALLBACK_GAS),
            GasWeight::default(),
        );

        let requester_id = env::predecessor_account_id();
        let storage_before = env::storage_usage();
        self.pending_actions.insert(
            request_id,
            PendingAction {
                action_id: action_id.clone(),
                requester_id: requester_id.clone(),
                yield_id: yield_id.clone(),
                created_at_ns: env::block_timestamp(),
            },
        );

        let storage_bytes = env::storage_usage().saturating_sub(storage_before);
        let required_deposit = NearToken::from_yoctonear(
            (storage_bytes as u128)
                .checked_mul(env::storage_byte_cost().as_yoctonear())
                .unwrap_or_else(|| env::panic_str("Storage cost overflow")),
        );
        let attached_deposit = env::attached_deposit();
        require!(
            attached_deposit >= required_deposit,
            format!(
                "Insufficient storage deposit; required {} yoctoNEAR",
                required_deposit.as_yoctonear()
            )
        );

        let excess_deposit = attached_deposit.saturating_sub(required_deposit);
        if excess_deposit > NearToken::from_yoctonear(0) {
            Promise::new(requester_id).transfer(excess_deposit).detach();
        }

        let event = near_sdk::serde_json::json!({
            "standard": EVENT_STANDARD,
            "version": EVENT_VERSION,
            "event": "yield_created",
            "data": [{
                "request_id": request_id,
                "action_id": action_id,
                "requester_id": env::predecessor_account_id(),
                "yield_token": yield_id,
            }],
        });
        env::log_str(&format!("EVENT_JSON:{event}"));

        yield_promise
    }

    /// Resume a pending request. Only the configured NearHook responder may call this.
    pub fn resume_action(&mut self, request_id: u64, payload: String) -> bool {
        require!(
            env::predecessor_account_id() == self.responder_id,
            "Only the configured responder may resume actions"
        );
        require!(!payload.is_empty(), "Resume payload cannot be empty");
        require!(
            payload.len() <= MAX_RESPONSE_BYTES,
            "Resume payload exceeds the maximum length"
        );

        let pending = self
            .pending_actions
            .get(&request_id)
            .unwrap_or_else(|| env::panic_str("No pending action with this request ID"));
        let yield_id = pending.yield_id.clone();
        let response_bytes = near_sdk::serde_json::to_vec(&payload)
            .unwrap_or_else(|_| env::panic_str("Failed to serialize resume payload"));

        match yield_id.resume(response_bytes) {
            Ok(()) => true,
            Err(_) => env::panic_str("Yield is no longer pending"),
        }
    }

    /// Callback for resumed or timed-out yields. Always clears pending state.
    #[private]
    pub fn on_action_resumed(
        &mut self,
        request_id: u64,
        #[callback_result] response: Result<String, PromiseError>,
    ) -> ActionOutcome {
        let Some(pending) = self.pending_actions.remove(&request_id) else {
            Self::emit_completion(request_id, "", "state_missing");
            return ActionOutcome::StateMissing { request_id };
        };

        match response {
            Ok(response) => {
                Self::emit_completion(request_id, &pending.action_id, "resumed");
                ActionOutcome::Resumed { request_id, response }
            }
            Err(_) => {
                Self::emit_completion(request_id, &pending.action_id, "timed_out");
                ActionOutcome::TimedOut { request_id }
            }
        }
    }

    pub fn get_pending_action(&self, request_id: u64) -> Option<PendingAction> {
        self.pending_actions.get(&request_id).cloned()
    }

    pub fn get_responder_id(&self) -> AccountId {
        self.responder_id.clone()
    }

    pub fn set_responder_id(&mut self, responder_id: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the contract owner may update the responder"
        );
        require!(
            responder_id != env::current_account_id(),
            "Responder must differ from the contract account"
        );
        self.responder_id = responder_id;
    }

    fn emit_completion(request_id: u64, action_id: &str, result: &str) {
        let event = near_sdk::serde_json::json!({
            "standard": EVENT_STANDARD,
            "version": EVENT_VERSION,
            "event": "yield_resolved",
            "data": [{
                "request_id": request_id,
                "action_id": action_id,
                "result": result,
            }],
        });
        env::log_str(&format!("EVENT_JSON:{event}"));
    }
}
