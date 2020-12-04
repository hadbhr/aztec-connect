import { TxHash } from 'barretenberg/rollup_provider';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { UserId } from '../../user';
import { UserTx, UserTxAction } from '../../user_tx';
import { bigintTransformer, txHashTransformer, userIdTransformer } from './transformer';

@Entity({ name: 'userTx' })
@Index(['txHash', 'userId'], { unique: true })
export class UserTxDao implements UserTx {
  @PrimaryColumn('blob', { transformer: [txHashTransformer] })
  public txHash!: TxHash;

  @PrimaryColumn('blob', { transformer: [userIdTransformer] })
  public userId!: UserId;

  @Column('varchar')
  public action!: UserTxAction;

  @Column()
  public assetId!: number;

  @Column('bigint', { transformer: [bigintTransformer] })
  public value!: bigint;

  @Column()
  public settled!: boolean;

  @Column()
  public created!: Date;

  @Column({ nullable: true })
  public recipient?: Buffer;
}