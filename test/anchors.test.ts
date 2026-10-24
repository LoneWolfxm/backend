import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { Keypair } from '@stellar/stellar-sdk';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

// ---------------------------------------------------------------------------
// Mock anchor server
// ---------------------------------------------------------------------------

interface MockAnchorState {
  signingKeypair: Keypair;
  // SEP-10
  challengeExpired: boolean;
  challengeWrongSigningKey: boolean;
  verifyShouldFail: boolean;
  // SEP-24
  depositInteractiveShouldFail: boolean;
  withdrawInteractiveShouldFail: boolean;
  transactionShouldFail: boolean;
  lastTransactionId: string;
  lastDepositRequest: any;
  lastWithdrawRequest: any;
}

const state: MockAnchorState = {
  signingKeypair: Keypair.random(),
  challengeExpired: false,
  challengeWrongSigningKey: false,
  verifyShouldFail: false,
  depositInteractiveShouldFail: false,
  withdrawInteractiveShouldFail: false,
  transactionShouldFail: false,
  lastTransactionId: 'tx-123',
  lastDepositRequest: null,
  lastWithdrawRequest: null,
};

function resetState() {
  state.challengeExpired = false;
  state.challengeWrongSigningKey = false;
  state.verifyShouldFail = false;
  state.depositInteractiveShouldFail = false;
  state.withdrawInteractiveShouldFail = false;
  state.transactionShouldFail = false;
  state.lastTransactionId = 'tx-123';
  state.lastDepositRequest = null;
  state.lastWithdrawRequest = null;
}

let server: Server;
let baseUrl: string;

function buildToml(): string {
  return [
    'VERSION="2.0.0"',
    'NETWORK_PASSPHRASE="Test SDF Network ; September 2015"',
    `SIGNING_KEY="${state.signingKeypair.publicKey()}"`,
    `WEB_AUTH_ENDPOINT="${baseUrl}/auth"`,
    `TRANSFER_SERVER_SEP0024="${baseUrl}/sep24"`,
    'ACCOUNTS=["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"]',
  ].join('\n');
}

function buildChallengeXdr(): string {
  // A minimal, structurally-valid-looking challenge XDR string. The SEP-10
  // client only needs to be able to parse it; we don't need a fully valid
  // transaction for these integration tests.
  return 'AAAAAgAAAAB...challenge...';
}

function startMockAnchor(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/.well-known/stellar.toml', (_req, res) => {
    res.type('text/plain').send(buildToml());
  });

  app.get('/auth', (req, res) => {
    const account = req.query.account as string | undefined;
    if (!account) {
      res.status(400).json({ error: 'missing account' });
      return;
    }
    if (state.challengeExpired) {
      res.status(400).json({ error: 'challenge expired' });
      return;
    }
    res.json({
      transaction: buildChallengeXdr(),
      network_passphrase: 'Test SDF Network ; September 2015',
    });
  });

  app.post('/auth', (req, res) => {
    if (state.verifyShouldFail) {
      res.status(400).json({ error: 'invalid signature' });
      return;
    }
    const token = 'mock-sep10-token';
    res.json({ token });
  });

  app.post('/sep24/transactions/deposit/interactive', (req, res) => {
    state.lastDepositRequest = req.body;
    if (state.depositInteractiveShouldFail) {
      res.status(500).json({ error: 'anchor exploded' });
      return;
    }
    res.json({
      type: 'interactive_customer_info_needed',
      url: `${baseUrl}/interactive/deposit`,
      id: 'deposit-1',
    });
  });

  app.post('/sep24/transactions/withdraw/interactive', (req, res) => {
    state.lastWithdrawRequest = req.body;
    if (state.withdrawInteractiveShouldFail) {
      res.status(500).json({ error: 'anchor exploded' });
      return;
    }
    res.json({
      type: 'interactive_customer_info_needed',
      url: `${baseUrl}/interactive/withdraw`,
      id: 'withdraw-1',
    });
  });

  app.get('/sep24/transaction', (req, res) => {
    if (state.transactionShouldFail) {
      res.status(500).json({ error: 'anchor exploded' });
      return;
    }
    const id = (req.query.id as string) || state.lastTransactionId;
    res.json({
      transaction: {
        id,
        kind: 'withdrawal',
        status: 'completed',
        status_eta: 0,
        amount_in: '10.00',
        amount_out: '9.90',
        amount_fee: '0.10',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message: 'ok',
      },
    });
  });

  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
}

function stopMockAnchor(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Module imports (after env setup so config picks up the mock URL)
// ---------------------------------------------------------------------------

let authenticateWithAnchor: typeof import('../src/interfaces/anchors/sep10').authenticateWithAnchor;
let startDeposit: typeof import('../src/interfaces/anchors/sep24').startDeposit;
let startWithdrawal: typeof import('../src/interfaces/anchors/sep24').startWithdrawal;
let fetchTransaction: typeof import('../src/interfaces/anchors/sep24').fetchTransaction;
let verifyWebhookSignature: typeof import('../src/api/anchors/service').verifyWebhookSignature;
let syncTransaction: typeof import('../src/api/anchors/service').syncTransaction;

beforeAll(async () => {
  await startMockAnchor();

  // Point the anchor config at the mock server.
  process.env.ANCHOR_HOME_DOMAIN = baseUrl;
  process.env.ANCHOR_TOML_URL = `${baseUrl}/.well-known/stellar.toml`;

  const sep10 = await import('../src/interfaces/anchors/sep10');
  const sep24 = await import('../src/interfaces/anchors/sep24');
  const service = await import('../src/api/anchors/service');

  authenticateWithAnchor = sep10.authenticateWithAnchor;
  startDeposit = sep24.startDeposit;
  startWithdrawal = sep24.startWithdrawal;
  fetchTransaction = sep24.fetchTransaction;
  verifyWebhookSignature = service.verifyWebhookSignature;
  syncTransaction = service.syncTransaction;
});

afterAll(async () => {
  await stopMockAnchor();
});

beforeEach(() => {
  resetState();
});

// ---------------------------------------------------------------------------
// SEP-10 authentication
// ---------------------------------------------------------------------------

describe('SEP-10 authentication', () => {
  it('authenticates against the mock anchor (happy path)', async () => {
    const userKeypair = Keypair.random();
    const result = await authenticateWithAnchor({
      account: userKeypair.publicKey(),
      signer: async (xdr: string) => {
        // Sign the challenge transaction with the user's keypair.
        const { TransactionBuilder, Networks } = await import('@stellar/stellar-sdk');
        const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
        tx.sign(userKeypair);
        return tx.toEnvelope().toXDR('base64');
      },
    });

    expect(result).toBeDefined();
    expect(result.token).toBe('mock-sep10-token');
  });

  it('fails when the challenge is expired', async () => {
    state.challengeExpired = true;
    const userKeypair = Keypair.random();

    await expect(
      authenticateWithAnchor({
        account: userKeypair.publicKey(),
        signer: async (xdr: string) => xdr,
      }),
    ).rejects.toThrow();
  });

  it('fails when the anchor rejects the signature (wrong signing key)', async () => {
    state.verifyShouldFail = true;
    const userKeypair = Keypair.random();

    await expect(
      authenticateWithAnchor({
        account: userKeypair.publicKey(),
        signer: async (xdr: string) => {
          const { TransactionBuilder, Networks } = await import('@stellar/stellar-sdk');
          const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
          tx.sign(userKeypair);
          return tx.toEnvelope().toXDR('base64');
        },
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SEP-24 deposit / withdraw / transaction
// ---------------------------------------------------------------------------

describe('SEP-24 flows', () => {
  it('starts a deposit (happy path)', async () => {
    const result = await startDeposit({
      token: 'mock-sep10-token',
      assetCode: 'USDC',
      account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    });

    expect(result).toBeDefined();
    expect(result.url).toContain('/interactive/deposit');
    expect(result.id).toBe('deposit-1');
    expect(state.lastDepositRequest).toBeTruthy();
  });

  it('surfaces a 5xx from the deposit endpoint', async () => {
    state.depositInteractiveShouldFail = true;

    await expect(
      startDeposit({
        token: 'mock-sep10-token',
        assetCode: 'USDC',
        account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      }),
    ).rejects.toThrow();
  });

  it('starts a withdrawal (happy path)', async () => {
    const result = await startWithdrawal({
      token: 'mock-sep10-token',
      assetCode: 'USDC',
      account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      amount: '10.00',
    });

    expect(result).toBeDefined();
    expect(result.url).toContain('/interactive/withdraw');
    expect(result.id).toBe('withdraw-1');
    expect(state.lastWithdrawRequest).toBeTruthy();
  });

  it('surfaces a 5xx from the withdraw endpoint', async () => {
    state.withdrawInteractiveShouldFail = true;

    await expect(
      startWithdrawal({
        token: 'mock-sep10-token',
        assetCode: 'USDC',
        account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        amount: '10.00',
      }),
    ).rejects.toThrow();
  });

  it('fetches a transaction (happy path)', async () => {
    const result = await fetchTransaction({
      token: 'mock-sep10-token',
      id: 'tx-123',
    });

    expect(result).toBeDefined();
    expect(result.id).toBe('tx-123');
    expect(result.status).toBe('completed');
  });

  it('surfaces a 5xx from the transaction endpoint', async () => {
    state.transactionShouldFail = true;

    await expect(
      fetchTransaction({
        token: 'mock-sep10-token',
        id: 'tx-123',
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

describe('verifyWebhookSignature', () => {
  function signPayload(payload: string, keypair: Keypair): string {
    const secretKey = keypair.rawSecretKey();
    const signature = nacl.sign.detached(
      Buffer.from(payload, 'utf8'),
      secretKey,
    );
    return Buffer.from(signature).toString('base64');
  }

  it('accepts a valid signature from the anchor signing key', () => {
    const payload = JSON.stringify({ id: 'tx-123', status: 'completed' });
    const signature = signPayload(payload, state.signingKeypair);

    const ok = verifyWebhookSignature({
      payload,
      signature,
      signingKey: state.signingKeypair.publicKey(),
    });

    expect(ok).toBe(true);
  });

  it('rejects a signature from the wrong key', () => {
    const payload = JSON.stringify({ id: 'tx-123', status: 'completed' });
    const wrongKeypair = Keypair.random();
    const signature = signPayload(payload, wrongKeypair);

    const ok = verifyWebhookSignature({
      payload,
      signature,
      signingKey: state.signingKeypair.publicKey(),
    });

    expect(ok).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const payload = JSON.stringify({ id: 'tx-123', status: 'completed' });
    const signature = signPayload(payload, state.signingKeypair);
    const tampered = JSON.stringify({ id: 'tx-123', status: 'failed' });

    const ok = verifyWebhookSignature({
      payload: tampered,
      signature,
      signingKey: state.signingKeypair.publicKey(),
    });

    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Remittance poller
// ---------------------------------------------------------------------------

describe('remittance poller', () => {
  it('refreshes a stale non-terminal transaction within one tick', async () => {
    const { runRemittancePollTick } = await import('../src/jobs/remittance-poller');

    const staleTx = {
      id: 'rem-1',
      status: 'pending_anchor',
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    };

    const findMany = vi.fn().mockResolvedValue([staleTx]);
    const prisma = {
      remittanceTransaction: { findMany },
    } as any;

    const syncSpy = vi.fn().mockResolvedValue(undefined);

    await runRemittancePollTick({
      prisma,
      syncTransaction: syncSpy,
      staleAfterSeconds: 60,
      batchSize: 10,
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenCalledWith('rem-1');
  });

  it('does not abort the batch when one transaction fails to sync', async () => {
    const { runRemittancePollTick } = await import('../src/jobs/remittance-poller');

    const txs = [
      { id: 'rem-1', status: 'pending_anchor', updatedAt: new Date(0) },
      { id: 'rem-2', status: 'pending_user_transfer', updatedAt: new Date(0) },
      { id: 'rem-3', status: 'pending_anchor', updatedAt: new Date(0) },
    ];

    const findMany = vi.fn().mockResolvedValue(txs);
    const prisma = {
      remittanceTransaction: { findMany },
    } as any;

    const syncSpy = vi
      .fn()
      .mockImplementation(async (id: string) => {
        if (id === 'rem-2') {
          throw new Error('anchor exploded');
        }
      });

    await expect(
      runRemittancePollTick({
        prisma,
        syncTransaction: syncSpy,
        staleAfterSeconds: 60,
        batchSize: 10,
      }),
    ).resolves.toBeUndefined();

    expect(syncSpy).toHaveBeenCalledTimes(3);
    expect(syncSpy).toHaveBeenCalledWith('rem-1');
    expect(syncSpy).toHaveBeenCalledWith('rem-2');
    expect(syncSpy).toHaveBeenCalledWith('rem-3');
  });

  it('queries only non-terminal transactions older than the stale threshold', async () => {
    const { runRemittancePollTick } = await import('../src/jobs/remittance-poller');

    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      remittanceTransaction: { findMany },
    } as any;

    const syncSpy = vi.fn();

    await runRemittancePollTick({
      prisma,
      syncTransaction: syncSpy,
      staleAfterSeconds: 120,
      batchSize: 5,
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0];
    expect(args.where.status.notIn).toEqual(['completed', 'failed']);
    expect(args.where.updatedAt.lt).toBeInstanceOf(Date);
    expect(args.take).toBe(5);
    expect(syncSpy).not.toHaveBeenCalled();
  });
});