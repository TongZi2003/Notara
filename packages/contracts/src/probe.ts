/** Synthetic P0 reply; no learner data is read or written. */
export interface ProbeReply {
  workspaceLabel: string;
  echoedNonce: string;
}

export interface ProbeService {
  inspect(input: { nonce: string }): Promise<ProbeReply>;
}
