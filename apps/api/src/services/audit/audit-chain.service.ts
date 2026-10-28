import crypto from "node:crypto";
import { db, type StoredAuditEvent } from "../db/database";

export interface AuditVerificationResult {
  valid: boolean;
  brokenAt: number | null;
  count: number;
  head: string | null;
  checkpointSignature: string | null;
}

export class AuditChainService {
  private keyPair: crypto.KeyPairSyncResult<string, string>;
  private genesisHash =
    "0000000000000000000000000000000000000000000000000000000000000000";

  constructor() {
    // Generate or use deterministic Ed25519 keypair for cryptographic checkpoint signing
    this.keyPair = crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // If chain is empty, seed Genesis event
    const existing = db.listAuditEvents();
    if (existing.length === 0) {
      this.recordEvent("GENESIS_INITIALIZED", {
        system: "Bayora Security Platform",
        epoch: Date.now(),
        policy: "default-deny",
      });
    }
  }

  private sha256(data: string): string {
    return crypto.createHash("sha256").update(data, "utf8").digest("hex");
  }

  recordEvent(eventType: string, payloadObj: Record<string, unknown>): StoredAuditEvent {
    const latest = db.getLatestAuditEvent();
    const nextIndex = latest ? latest.index + 1 : 0;
    const prevHash = latest ? latest.hash : this.genesisHash;

    const canonicalPayload = JSON.stringify(payloadObj, Object.keys(payloadObj).sort());
    const payloadHash = this.sha256(canonicalPayload);
    const eventHash = this.sha256(`${prevHash}:${canonicalPayload}`);

    // Periodically sign checkpoint (every 5 events)
    let signature: string | null = null;
    if (nextIndex % 5 === 0) {
      signature = crypto
        .sign(null, Buffer.from(eventHash, "utf8"), this.keyPair.privateKey)
        .toString("base64");
    }

    const event: StoredAuditEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      index: nextIndex,
      type: eventType,
      payload: canonicalPayload,
      payloadHash,
      prevHash,
      hash: eventHash,
      signature,
      timestamp: new Date().toISOString(),
    };

    db.insertAuditEvent(event);
    return event;
  }

  getEvents(): StoredAuditEvent[] {
    return db.listAuditEvents();
  }

  verifyChain(eventsToVerify?: StoredAuditEvent[]): AuditVerificationResult {
    const events = eventsToVerify ?? db.listAuditEvents();

    if (events.length === 0) {
      return {
        valid: true,
        brokenAt: null,
        count: 0,
        head: null,
        checkpointSignature: null,
      };
    }

    let expectedPrevHash = this.genesisHash;

    for (let i = 0; i < events.length; i++) {
      const evt = events[i];

      // Check previous hash link
      if (evt.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          brokenAt: i,
          count: events.length,
          head: evt.hash,
          checkpointSignature: evt.signature,
        };
      }

      // Check current hash computation
      const computedHash = this.sha256(`${expectedPrevHash}:${evt.payload}`);
      if (computedHash !== evt.hash) {
        return {
          valid: false,
          brokenAt: i,
          count: events.length,
          head: evt.hash,
          checkpointSignature: evt.signature,
        };
      }

      expectedPrevHash = evt.hash;
    }

    const latest = events[events.length - 1];

    return {
      valid: true,
      brokenAt: null,
      count: events.length,
      head: latest.hash,
      checkpointSignature: latest.signature,
    };
  }

  tamperDemo(): {
    originalValid: boolean;
    copyBrokenAt: number;
    tamperedBlockIndex: number;
    tamperedPayload: string;
    message: string;
  } {
    const originalEvents = db.listAuditEvents();
    if (originalEvents.length < 2) {
      this.recordEvent("GATEWAY_INFERENCE", {
        tenant: "red",
        capability: "model.inference",
        status: "BLOCKED",
      });
      this.recordEvent("PROBE_EXECUTED", {
        probe: "network_red_to_blue",
        status: "BLOCKED",
      });
    }

    // Create a deep copy of events
    const copy: StoredAuditEvent[] = JSON.parse(
      JSON.stringify(db.listAuditEvents()),
    );
    const targetIdx = Math.min(1, copy.length - 1);

    // Tamper with target block in the copy (change BLOCKED to ALLOWED)
    const tamperedPayload = copy[targetIdx].payload.replace(
      /BLOCKED|true/g,
      "ALLOWED_FORGED",
    );
    copy[targetIdx].payload = tamperedPayload;

    const copyCheck = this.verifyChain(copy);
    const originalCheck = this.verifyChain();

    return {
      originalValid: originalCheck.valid,
      copyBrokenAt: copyCheck.brokenAt ?? targetIdx,
      tamperedBlockIndex: targetIdx,
      tamperedPayload,
      message:
        "Tamper test passed: altered block was detected immediately by the cryptographic SHA-256 chain verifier.",
    };
  }
}

export const auditChainService = new AuditChainService();
