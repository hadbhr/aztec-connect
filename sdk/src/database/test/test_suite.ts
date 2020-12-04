import { GrumpkinAddress } from 'barretenberg/address';
import { AliasHash } from 'barretenberg/client_proofs/alias_hash';
import { TxHash } from 'barretenberg/rollup_provider';
import { randomBytes } from 'crypto';
import { Note } from '../../note';
import { AccountId, UserData, UserId } from '../../user';
import { UserTx } from '../../user_tx';
import { Database, SigningKey } from '../database';
import { randomAccountId, randomAlias, randomNote, randomSigningKey, randomUser, randomUserTx } from './fixtures';

const sort = (arr: any[], sortBy: string) => arr.sort((a, b) => (a[sortBy] < b[sortBy] ? -1 : 1));

export const databaseTestSuite = (
  dbName: string,
  createDb: () => Promise<Database>,
  destroyDb: () => Promise<void>,
) => {
  describe(dbName, () => {
    let db: Database;

    beforeEach(async () => {
      db = await createDb();
    });

    afterEach(async () => {
      await destroyDb();
    });

    describe('Note', () => {
      it('add note to db and get note by index', async () => {
        const note = randomNote();
        await db.addNote(note);

        const savedNote = await db.getNote(note.index);
        expect(savedNote).toEqual(note);
      });

      it('get note by nullifier', async () => {
        const note0 = randomNote();
        const note1 = randomNote();
        await db.addNote(note0);
        await db.addNote(note1);
        expect(await db.getNoteByNullifier(note0.nullifier)).toEqual(note0);
        expect(await db.getNoteByNullifier(note1.nullifier)).toEqual(note1);
        expect(await db.getNoteByNullifier(randomBytes(32))).toBeUndefined();
      });

      it('can nullify a note', async () => {
        const note = randomNote();
        await db.addNote(note);

        const savedNote = await db.getNote(note.index);
        expect(savedNote!.nullified).toBe(false);

        await db.nullifyNote(note.index);

        const updatedNote = await db.getNote(note.index);
        expect(updatedNote!.nullified).toBe(true);
      });

      it('get all notes belonging to a user that are not nullified', async () => {
        const userId = UserId.random();
        const userNotes: Note[] = [];
        for (let i = 0; i < 5; ++i) {
          const note = randomNote();
          note.owner = userId;
          await db.addNote(note);
          if (i % 2) {
            await db.nullifyNote(note.index);
          } else {
            userNotes.push(note);
          }
        }
        for (let i = 0; i < 5; ++i) {
          const note = randomNote();
          note.owner = UserId.random();
          await db.addNote(note);
        }

        const savedNotes = await db.getUserNotes(userId);
        expect(savedNotes).toEqual(sort(userNotes, 'index'));
      });
    });

    describe('User', () => {
      it('add user to db and get user by id', async () => {
        const user = randomUser();
        await db.addUser(user);

        const savedUser = await db.getUser(user.id);
        expect(savedUser).toEqual(user);
      });

      it('get all users', async () => {
        const users: UserData[] = [];
        for (let i = 0; i < 5; ++i) {
          const user = randomUser();
          await db.addUser(user);
          users.push(user);
        }
        const savedUsers = await db.getUsers();
        expect(sort(savedUsers, 'id')).toEqual(sort(users, 'id'));
      });

      it('update data for an existing user', async () => {
        const user = randomUser();
        await db.addUser(user);

        const newUser = { ...user, syncedToRollup: user.syncedToRollup + 1 };
        await db.updateUser(newUser);

        const updatedUser = await db.getUser(user.id);
        expect(updatedUser).toEqual(newUser);
      });

      it('ignore if try to update a non existent user', async () => {
        const user = randomUser();
        await db.addUser(user);

        const newUser = { ...user, id: UserId.random() };
        await db.updateUser(newUser);

        const oldUser = await db.getUser(user.id);
        expect(oldUser).toEqual(user);

        const updatedUser = await db.getUser(newUser.id);
        expect(updatedUser).toBeUndefined();
      });
    });

    describe('UserTx', () => {
      it('add user tx to db and get it by user id and tx hash', async () => {
        const userTx = randomUserTx();
        await db.addUserTx(userTx);

        const newUserId = UserId.random();
        const sharedUserTx = { ...userTx, userId: newUserId };
        await db.addUserTx(sharedUserTx);

        const savedUserTx = await db.getUserTx(userTx.userId, userTx.txHash);
        expect(savedUserTx).toEqual(userTx);

        const newUserTx = await db.getUserTx(newUserId, userTx.txHash);
        expect(newUserTx).toEqual(sharedUserTx);
      });

      it('will override old data if try to add a user tx with the same user id and tx hash combination', async () => {
        const userTx = randomUserTx();
        await db.addUserTx(userTx);

        const newUserTx = randomUserTx();
        newUserTx.userId = userTx.userId;
        newUserTx.txHash = userTx.txHash;
        await db.addUserTx(newUserTx);

        const savedUserTx = await db.getUserTx(userTx.userId, userTx.txHash);
        expect(savedUserTx).toEqual(newUserTx);
      });

      it('settle a user tx with specified user id and tx hash', async () => {
        const userTx = randomUserTx();

        const userId0 = UserId.random();
        await db.addUserTx({ ...userTx, userId: userId0 });

        const userId1 = UserId.random();
        await db.addUserTx({ ...userTx, userId: userId1 });

        await db.settleUserTx(userId0, userTx.txHash);

        const userTx0 = await db.getUserTx(userId0, userTx.txHash);
        expect(userTx0!.settled).toBe(true);

        const userTx1 = await db.getUserTx(userId1, userTx.txHash);
        expect(userTx1!.settled).toBe(false);
      });

      it('get all txs for a user from newest to oldest', async () => {
        const userId = UserId.random();
        const userTxs: UserTx[] = [];
        const now = Date.now();
        for (let i = 0; i < 5; ++i) {
          const userTx = randomUserTx();
          userTx.userId = userId;
          userTx.created = new Date(now + i);
          await db.addUserTx(userTx);
          userTxs.push(userTx);
        }

        const savedUserTxs = await db.getUserTxs(userId);
        expect(savedUserTxs).toEqual(userTxs.reverse());
      });

      it('get all txs with the same tx hash', async () => {
        const userTxs: UserTx[] = [];
        const txHash = TxHash.random();
        for (let i = 0; i < 5; ++i) {
          const userTx = randomUserTx();
          userTx.txHash = txHash;
          await db.addUserTx(userTx);
          userTxs.push(userTx);
        }
        for (let i = 0; i < 3; ++i) {
          const userTx = randomUserTx();
          await db.addUserTx(userTx);
        }

        const savedUserTxs = await db.getUserTxsByTxHash(txHash);
        expect(savedUserTxs.length).toEqual(userTxs.length);
        expect(savedUserTxs).toEqual(expect.arrayContaining(userTxs));
      });
    });

    describe('UserKey', () => {
      it('add signing key and get all keys for a user', async () => {
        const accountId = randomAccountId();
        const userKeys: SigningKey[] = [];
        for (let i = 0; i < 3; ++i) {
          const signingKey = randomSigningKey();
          signingKey.accountId = accountId;
          await db.addUserSigningKey(signingKey);
          userKeys.push(signingKey);
        }
        for (let i = 0; i < 5; ++i) {
          const signingKey = randomSigningKey();
          await db.addUserSigningKey(signingKey);
        }

        const savedUserKeys = await db.getUserSigningKeys(accountId);
        expect(sort(savedUserKeys, 'key')).toEqual(sort(userKeys, 'key'));
      });

      it('remove all signing keys of given account id', async () => {
        const generateAccountSigningKeys = async (accountId: AccountId, numKeys = 3) => {
          const keys: SigningKey[] = [];
          for (let i = 0; i < numKeys; ++i) {
            const signingKey = randomSigningKey();
            signingKey.accountId = accountId;
            await db.addUserSigningKey(signingKey);
            keys.push(signingKey);
          }
          return keys;
        };

        const accountId0 = randomAccountId();
        const accountId1 = randomAccountId();
        const keys0 = await generateAccountSigningKeys(accountId0);
        const keys1 = await generateAccountSigningKeys(accountId1);

        const savedSigningKeys0 = await db.getUserSigningKeys(accountId0);
        expect(sort(savedSigningKeys0, 'key')).toEqual(sort(keys0, 'key'));

        await db.removeUserSigningKeys(accountId0);

        expect(await db.getUserSigningKeys(accountId0)).toEqual([]);

        const savedSigningKeys1 = await db.getUserSigningKeys(accountId1);
        expect(sort(savedSigningKeys1, 'key')).toEqual(sort(keys1, 'key'));
      });

      it('get the index of a signing key', async () => {
        const accountId = randomAccountId();
        const signingKey = randomSigningKey();
        signingKey.accountId = accountId;
        await db.addUserSigningKey(signingKey);

        const fullKey = new GrumpkinAddress(Buffer.concat([signingKey.key, randomBytes(32)]));
        const index0 = await db.getUserSigningKeyIndex(accountId, fullKey);
        expect(index0).toEqual(signingKey.treeIndex);

        const index1 = await db.getUserSigningKeyIndex(randomAccountId(), fullKey);
        expect(index1).toBeUndefined();
      });
    });

    describe('Alias', () => {
      it('save alias and its address and nonce', async () => {
        const alias0 = randomAlias();
        await db.addAlias(alias0);
        const alias1 = randomAlias();
        await db.addAlias(alias1);
        const alias2 = { ...alias0, address: GrumpkinAddress.randomAddress(), latestNonce: alias0.latestNonce + 1 };
        await db.addAlias(alias2);

        const savedAlias0 = await db.getAlias(alias0.aliasHash, alias0.address);
        expect(savedAlias0).toEqual(alias0);

        const savedAlias2 = await db.getAlias(alias2.aliasHash, alias2.address);
        expect(savedAlias2).toEqual(alias2);

        const savedAliases0 = await db.getAliases(alias0.aliasHash);
        expect(sort(savedAliases0, 'latestNonce')).toEqual(sort([alias0, alias2], 'latestNonce'));

        const savedAliases1 = await db.getAliases(alias1.aliasHash);
        expect(savedAliases1).toEqual([alias1]);

        const emptyAliases = await db.getAliases(AliasHash.random());
        expect(emptyAliases).toEqual([]);
      });

      it('update alias with the same aliasHash and address pair', async () => {
        const alias1 = randomAlias();
        await db.addAlias(alias1);

        const alias2 = { ...alias1, aliasHash: AliasHash.random() };
        await db.addAlias(alias2);

        const updatedAlias = { ...alias1, latestNonce: alias1.latestNonce + 1 };

        await db.updateAlias(updatedAlias);

        const savedAliases1 = await db.getAliases(alias1.aliasHash);
        expect(savedAliases1).toEqual([updatedAlias]);

        const savedAliases2 = await db.getAliases(alias2.aliasHash);
        expect(savedAliases2).toEqual([alias2]);
      });

      it('get the largest nonce by public key', async () => {
        const address1 = GrumpkinAddress.randomAddress();
        const address2 = GrumpkinAddress.randomAddress();
        for (let i = 0; i < 3; ++i) {
          const alias = randomAlias();
          alias.address = address1;
          alias.latestNonce = i;
          await db.addAlias(alias);

          alias.address = address2;
          alias.latestNonce = 10 - i;
          await db.addAlias(alias);
        }

        expect(await db.getLatestNonceByAddress(address1)).toBe(2);
        expect(await db.getLatestNonceByAddress(address2)).toBe(10);
      });

      it('get the largest nonce by alias hash', async () => {
        const aliasHash1 = AliasHash.random();
        const aliasHash2 = AliasHash.random();
        for (let i = 0; i < 3; ++i) {
          const alias = randomAlias();
          alias.aliasHash = aliasHash1;
          alias.latestNonce = i;
          await db.addAlias(alias);

          alias.aliasHash = aliasHash2;
          alias.latestNonce = 10 - i;
          await db.addAlias(alias);
        }

        expect(await db.getLatestNonceByAliasHash(aliasHash1)).toBe(2);
        expect(await db.getLatestNonceByAliasHash(aliasHash2)).toBe(10);
      });

      it('get alias hash by public key and an optional nonce', async () => {
        const alias = randomAlias();
        const aliasHashes: AliasHash[] = [];
        for (let i = 0; i < 3; ++i) {
          alias.latestNonce = 10 - i * 2;
          alias.aliasHash = AliasHash.random();
          aliasHashes.push(alias.aliasHash);
          await db.addAlias(alias);
        }

        expect(await db.getAliasHashByAddress(alias.address)).toEqual(aliasHashes[0]);
        expect(await db.getAliasHashByAddress(alias.address, 0)).toEqual(aliasHashes[2]);
        expect(await db.getAliasHashByAddress(alias.address, 5)).toEqual(aliasHashes[2]);
        expect(await db.getAliasHashByAddress(alias.address, 6)).toEqual(aliasHashes[2]);
        expect(await db.getAliasHashByAddress(alias.address, 7)).toEqual(aliasHashes[1]);
        expect(await db.getAliasHashByAddress(alias.address, 8)).toEqual(aliasHashes[1]);
      });

      it('get public key by alias hash and an optional nonce', async () => {
        const alias = randomAlias();
        const publicKeys: GrumpkinAddress[] = [];
        for (let i = 0; i < 3; ++i) {
          alias.latestNonce = 10 - i * 2;
          alias.address = GrumpkinAddress.randomAddress();
          publicKeys.push(alias.address);
          await db.addAlias(alias);
        }

        expect(await db.getAddressByAliasHash(alias.aliasHash)).toEqual(publicKeys[0]);
        expect(await db.getAddressByAliasHash(alias.aliasHash, 0)).toEqual(publicKeys[2]);
        expect(await db.getAddressByAliasHash(alias.aliasHash, 5)).toEqual(publicKeys[2]);
        expect(await db.getAddressByAliasHash(alias.aliasHash, 6)).toEqual(publicKeys[2]);
        expect(await db.getAddressByAliasHash(alias.aliasHash, 7)).toEqual(publicKeys[1]);
        expect(await db.getAddressByAliasHash(alias.aliasHash, 8)).toEqual(publicKeys[1]);
      });
    });

    describe('Key', () => {
      it('add, get and delete key', async () => {
        const name = 'secretKey';
        const key = randomBytes(1000);
        await db.addKey(name, key);

        expect(await db.getKey(name)).toEqual(key);

        await db.deleteKey(name);

        expect(await db.getKey(name)).toBeUndefined();
      });
    });

    describe('Reset and Cleanup', () => {
      it('remove all data of a user', async () => {
        const generateUserProfile = async () => {
          const user = randomUser();
          await db.addUser(user);

          const note = randomNote();
          note.owner = user.id;
          await db.addNote(note);

          const signingKey = randomSigningKey();
          signingKey.address = user.publicKey;
          await db.addUserSigningKey(signingKey);

          const userTx = randomUserTx();
          userTx.userId = user.id;
          await db.addUserTx(userTx);

          return { user, note, signingKey, userTx };
        };

        const profile0 = await generateUserProfile();
        const profile1 = await generateUserProfile();

        await db.removeUser(profile0.user.id);

        expect(await db.getNote(profile0.note.index)).toBeUndefined();
        expect(await db.getUserSigningKeys(profile0.signingKey.accountId)).toEqual([]);
        expect(await db.getUserTxs(profile0.userTx.userId)).toEqual([]);

        expect(await db.getNote(profile1.note.index)).toEqual(profile1.note);
        expect(await db.getUserSigningKeys(profile1.signingKey.accountId)).toEqual([profile1.signingKey]);
        expect(await db.getUserTxs(profile1.userTx.userId)).toEqual([profile1.userTx]);
      });

      it('can reset user related data', async () => {
        const alias = randomAlias();
        await db.addAlias(alias);

        const note = randomNote();
        await db.addNote(note);

        const user = randomUser();
        await db.addUser(user);

        const keyName = 'secretKey';
        const key = randomBytes(1000);
        await db.addKey(keyName, key);

        const signingKey = randomSigningKey();
        const fullKey = new GrumpkinAddress(Buffer.concat([signingKey.key, randomBytes(32)]));
        await db.addUserSigningKey(signingKey);

        const userTx = randomUserTx();
        await db.addUserTx(userTx);

        await db.resetUsers();

        expect(await db.getAliases(alias.aliasHash)).toEqual([]);
        expect(await db.getNote(note.index)).toBeUndefined();
        expect(await db.getUserSigningKeyIndex(signingKey.accountId, fullKey)).toBeUndefined();
        expect(await db.getUserTx(userTx.userId, userTx.txHash)).toBeUndefined();

        expect(await db.getUser(user.id)).toEqual({
          ...user,
          syncedToRollup: -1,
        });

        expect(await db.getKey(keyName)).toEqual(key);
      });

      it('can clear all tables', async () => {
        const alias = randomAlias();
        await db.addAlias(alias);

        const note = randomNote();
        await db.addNote(note);

        const user = randomUser();
        await db.addUser(user);

        const keyName = 'secretKey';
        const key = randomBytes(1000);
        await db.addKey(keyName, key);

        const signingKey = randomSigningKey();
        const fullKey = new GrumpkinAddress(Buffer.concat([signingKey.key, randomBytes(32)]));
        await db.addUserSigningKey(signingKey);

        const userTx = randomUserTx();
        await db.addUserTx(userTx);

        await db.clear();

        expect(await db.getAliases(alias.aliasHash)).toEqual([]);
        expect(await db.getNote(note.index)).toBeUndefined();
        expect(await db.getUser(user.id)).toBeUndefined();
        expect(await db.getKey(keyName)).toBeUndefined();
        expect(await db.getUserSigningKeyIndex(signingKey.accountId, fullKey)).toBeUndefined();
        expect(await db.getUserTx(userTx.userId, userTx.txHash)).toBeUndefined();
      });
    });
  });
};