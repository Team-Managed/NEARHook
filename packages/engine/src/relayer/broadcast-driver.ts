import {
  Account,
  JsonRpcProvider,
  nearToYocto,
  teraToGas,
  type KeyPairString,
} from "near-api-js";
import type { YieldResumeAction, YieldResumeDriver } from "./yield-resume.js";

export interface NearRpcBroadcastDriverOptions {
  rpcUrl: string;
  accountId: string;
  privateKey: string;
}

/** Signs and submits resume_action calls using an isolated relayer account. */
export class NearRpcBroadcastDriver implements YieldResumeDriver {
  private readonly account: Account;

  public constructor(options: NearRpcBroadcastDriverOptions) {
    if (!options.rpcUrl || !options.accountId || !options.privateKey) {
      throw new Error("RPC URL, relayer account ID, and private key are required");
    }
    const provider = new JsonRpcProvider({ url: options.rpcUrl });
    this.account = new Account(options.accountId, provider, options.privateKey as KeyPairString);
  }

  public async broadcast(action: YieldResumeAction): Promise<string> {
    const result = await this.account.callFunctionRaw({
      contractId: action.contract_id,
      methodName: action.method_name,
      args: action.args,
      gas: teraToGas(action.gas_tgas),
      deposit: nearToYocto("0"),
    });
    const hash = result.transaction.hash;
    if (typeof hash !== "string" || hash.length === 0) {
      throw new Error("NEAR RPC did not return the resume transaction hash");
    }
    return hash;
  }
}
