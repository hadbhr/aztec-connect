import { TransactionReceipt, TransactionResponse } from '@ethersproject/abstract-provider';
import { Web3Provider } from '@ethersproject/providers';
import { EthAddress } from '@aztec/barretenberg/address';
import { AssetId } from '@aztec/barretenberg/asset';
import { PermitArgs } from '@aztec/barretenberg/blockchain';
import { Block } from '@aztec/barretenberg/block_source';
import { BridgeId, DefiInteractionNote } from '@aztec/barretenberg/client_proofs';
import { RollupProofData } from '@aztec/barretenberg/rollup_proof';
import { TxHash } from '@aztec/barretenberg/tx_hash';
import { Contract, Signer, utils } from 'ethers';
import { abi as RollupABI } from './artifacts/contracts/RollupProcessor.sol/RollupProcessor.json';
import { solidityFormatSignatures } from './solidity_format_signatures';

const IDefiBridgeEvent = new utils.Interface([
  'event DefiBridgeProcessed(uint256 indexed bridgeId, uint256 indexed nonce, uint256 totalInputValue, uint256 totalOutputValueA, uint256 totalOutputValueB, bool result)',
]);

const fixEthersStackTrace = (err: Error) => {
  err.stack! += new Error().stack;
  throw err;
};

export class RollupProcessor {
  private rollupProcessor: Contract;

  constructor(private rollupContractAddress: EthAddress, private provider: Web3Provider) {
    this.rollupProcessor = new Contract(rollupContractAddress.toString(), RollupABI, this.provider);
  }

  get address() {
    return this.rollupContractAddress;
  }

  async feeDistributor() {
    return EthAddress.fromString(await this.rollupProcessor.feeDistributor());
  }

  async numberOfAssets() {
    return +(await this.rollupProcessor.numberOfAssets());
  }

  async numberOfBridgeCalls() {
    return +(await this.rollupProcessor.numberOfBridgeCalls());
  }

  async nextRollupId() {
    return +(await this.rollupProcessor.nextRollupId());
  }

  async dataSize() {
    return +(await this.rollupProcessor.dataSize());
  }

  async dataRoot() {
    return Buffer.from((await this.rollupProcessor.dataRoot()).slice(2), 'hex');
  }

  async nullRoot() {
    return Buffer.from((await this.rollupProcessor.nullRoot()).slice(2), 'hex');
  }

  async rootRoot() {
    return Buffer.from((await this.rollupProcessor.rootRoot()).slice(2), 'hex');
  }

  async defiInteractionHash() {
    return Buffer.from((await this.rollupProcessor.defiInteractionHash()).slice(2), 'hex');
  }

  async totalDeposited() {
    return ((await this.rollupProcessor.getTotalDeposited()) as string[]).map(v => BigInt(v));
  }

  async totalWithdrawn() {
    return ((await this.rollupProcessor.getTotalWithdrawn()) as string[]).map(v => BigInt(v));
  }

  async totalFees() {
    return ((await this.rollupProcessor.getTotalFees()) as string[]).map(v => BigInt(v));
  }

  async totalPendingDeposit() {
    return ((await this.rollupProcessor.getTotalPendingDeposit()) as string[]).map(v => BigInt(v));
  }

  async weth() {
    return EthAddress.fromString(await this.rollupProcessor.weth());
  }

  async getSupportedAssets() {
    const assetAddresses: string[] = await this.rollupProcessor.getSupportedAssets();
    return assetAddresses.map((a: string) => EthAddress.fromString(a));
  }

  async setSupportedAsset(assetAddress: EthAddress, supportsPermit: boolean, signer?: EthAddress | Signer) {
    const rollupProcessor = this.getContractWithSigner(signer);
    const tx = await rollupProcessor.setSupportedAsset(assetAddress.toString(), supportsPermit);
    return TxHash.fromString(tx.hash);
  }

  async getAssetPermitSupport(assetId: AssetId): Promise<boolean> {
    return this.rollupProcessor.getAssetPermitSupport(assetId);
  }

  async getEscapeHatchStatus() {
    const [escapeOpen, blocksRemaining]: [boolean, any] = await this.rollupProcessor.getEscapeHatchStatus();
    return { escapeOpen, blocksRemaining: +blocksRemaining };
  }

  async createEscapeHatchProofTx(
    proofData: Buffer,
    viewingKeys: Buffer[],
    signatures: Buffer[],
    signer?: EthAddress | Signer,
  ) {
    const rollupProcessor = this.getContractWithSigner(signer);
    const formattedSignatures = solidityFormatSignatures(signatures);
    const tx = await rollupProcessor.populateTransaction
      .escapeHatch(`0x${proofData.toString('hex')}`, formattedSignatures, Buffer.concat(viewingKeys))
      .catch(fixEthersStackTrace);
    return Buffer.from(tx.data!.slice(2), 'hex');
  }

  async createRollupProofTx(
    proofData: Buffer,
    signatures: Buffer[],
    viewingKeys: Buffer[],
    providerSignature: Buffer,
    providerAddress: EthAddress,
    feeReceiver: EthAddress,
    feeLimit: bigint,
  ) {
    const rollupProcessor = new Contract(this.rollupContractAddress.toString(), RollupABI);
    const formattedSignatures = solidityFormatSignatures(signatures);
    const tx = await rollupProcessor.populateTransaction
      .processRollup(
        `0x${proofData.toString('hex')}`,
        formattedSignatures,
        Buffer.concat(viewingKeys),
        providerSignature,
        providerAddress.toString(),
        feeReceiver.toString(),
        feeLimit,
      )
      .catch(fixEthersStackTrace);
    return Buffer.from(tx.data!.slice(2), 'hex');
  }

  async depositPendingFunds(assetId: AssetId, amount: bigint, permitArgs?: PermitArgs, signer?: EthAddress | Signer) {
    const rollupProcessor = this.getContractWithSigner(signer);
    const depositorAddress = await rollupProcessor.signer.getAddress();
    if (permitArgs) {
      const tx = await rollupProcessor
        .depositPendingFundsPermit(
          assetId,
          amount,
          depositorAddress,
          this.rollupProcessor.address,
          permitArgs.approvalAmount,
          permitArgs.deadline,
          permitArgs.signature.v,
          permitArgs.signature.r,
          permitArgs.signature.s,
          { value: assetId === 0 ? amount : undefined },
        )
        .catch(fixEthersStackTrace);
      return TxHash.fromString(tx.hash);
    } else {
      const tx = await rollupProcessor
        .depositPendingFunds(assetId, amount, depositorAddress, {
          value: assetId === 0 ? amount : undefined,
        })
        .catch(fixEthersStackTrace);
      return TxHash.fromString(tx.hash);
    }
  }

  async approveProof(proofHash: string, signer?: EthAddress | Signer) {
    const rollupProcessor = this.getContractWithSigner(signer);
    const tx = await rollupProcessor.approveProof(proofHash).catch(fixEthersStackTrace);
    return TxHash.fromString(tx.hash);
  }

  async getUserPendingDeposit(assetId: AssetId, account: EthAddress) {
    return BigInt(await this.rollupProcessor.getUserPendingDeposit(assetId, account.toString()));
  }

  async getUserProofApprovalStatus(address: EthAddress, proofHash: string): Promise<boolean> {
    return await this.rollupProcessor.depositProofApprovals(address.toString(), proofHash);
  }

  async getRollupBlocksFrom(rollupId: number, minConfirmations: number) {
    const rollupFilter = this.rollupProcessor.filters.RollupProcessed(rollupId);
    const [rollupEvent] = await this.rollupProcessor.queryFilter(rollupFilter);
    if (!rollupEvent) {
      return [];
    }
    const filter = this.rollupProcessor.filters.RollupProcessed();
    const rollupEvents = await this.rollupProcessor.queryFilter(filter, rollupEvent.blockNumber);
    if (!rollupEvents.length) {
      return [];
    }
    const txs = (await Promise.all(rollupEvents.map(event => event.getTransaction()))).filter(
      tx => tx.confirmations >= minConfirmations,
    );
    const receipts = await Promise.all(txs.map(tx => this.provider.getTransactionReceipt(tx.hash)));
    const blocks = await Promise.all(txs.map(tx => this.provider.getBlock(tx.blockNumber!)));
    const interactionResultMap = await this.getDefiBridgeEvents(rollupEvent.blockNumber);
    return txs.map((tx, i) =>
      this.decodeBlock({ ...tx, timestamp: blocks[i].timestamp }, receipts[0], interactionResultMap[tx.blockNumber!]),
    );
  }

  private async getDefiBridgeEvents(fromBlock: number) {
    const filter = this.rollupProcessor.filters.DefiBridgeProcessed();
    const defiBridgeEvents = await this.rollupProcessor.queryFilter(filter, fromBlock);
    const interactionResultMap: { [blockNumber: number]: DefiInteractionNote[] } = {};
    defiBridgeEvents.forEach((log: { blockNumber: number; topics: string[]; data: string }) => {
      const {
        args: { bridgeId, nonce, totalInputValue, totalOutputValueA, totalOutputValueB, result },
      } = IDefiBridgeEvent.parseLog(log);
      if (!interactionResultMap[log.blockNumber]) {
        interactionResultMap[log.blockNumber] = [];
      }
      interactionResultMap[log.blockNumber].push(
        new DefiInteractionNote(
          BridgeId.fromBigInt(BigInt(bridgeId)),
          nonce,
          BigInt(totalInputValue),
          BigInt(totalOutputValueA),
          BigInt(totalOutputValueB),
          result,
        ),
      );
    });
    return interactionResultMap;
  }

  private decodeBlock(
    tx: TransactionResponse,
    receipt: TransactionReceipt,
    interactionResult: DefiInteractionNote[],
  ): Block {
    const rollupAbi = new utils.Interface(RollupABI);
    const result = rollupAbi.parseTransaction({ data: tx.data });
    const rollupProofData = Buffer.from(result.args.proofData.slice(2), 'hex');
    const viewingKeysData = Buffer.from(result.args.viewingKeys.slice(2), 'hex');

    return {
      created: new Date(tx.timestamp! * 1000),
      txHash: TxHash.fromString(tx.hash),
      rollupProofData,
      viewingKeysData,
      interactionResult,
      rollupId: RollupProofData.getRollupIdFromBuffer(rollupProofData),
      rollupSize: RollupProofData.getRollupSizeFromBuffer(rollupProofData),
      gasPrice: BigInt(tx.gasPrice.toString()),
      gasUsed: receipt.gasUsed.toNumber(),
    };
  }

  private getContractWithSigner(signer?: EthAddress | Signer) {
    const ethSigner = !signer
      ? this.provider.getSigner(0)
      : signer instanceof EthAddress
      ? this.provider.getSigner(signer.toString())
      : signer;
    return new Contract(this.rollupContractAddress.toString(), RollupABI, ethSigner);
  }
}
