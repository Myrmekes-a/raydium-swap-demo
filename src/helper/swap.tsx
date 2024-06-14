import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createWrappedNativeAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Liquidity,
  Token,
  Percent,
  LiquidityPoolKeys,
  jsonInfo2PoolKeys,
  CurrencyAmount,
  SOL,
  Currency,
  buildSimpleTransaction,
  TxVersion,
  LOOKUP_TABLE_CACHE,
} from "@raydium-io/raydium-sdk";

import { solConnection } from "@/utils/util";
import { WalletContextState } from "@solana/wallet-adapter-react";
import { SOL_USDC_PAIR, STANDARD_TOKENS, USDC_MINT } from "@/constants";
import { formatAmmKeysById, getBuyTx, getSellTx } from "@/utils/swapOnlyAmm";
import { execute } from "@/utils/legacy";

const swap = async (
  wallet: WalletContextState,
  inputToken: string,
  inputAmount: number,
  onSwap: (result: string) => void,
  onFailed: (error: string) => void
) => {
  if (!wallet?.signTransaction || !wallet?.publicKey) {
    onFailed("wallet not connected");
    return;
  }

  let reverse = true;
  if (inputToken === NATIVE_MINT.toString()) {
    reverse = false;
  }

  // // for SOL-USDC pair
  const solCurrency = new Token(
    TOKEN_PROGRAM_ID,
    new PublicKey(STANDARD_TOKENS[0].mint),
    STANDARD_TOKENS[0].decimals
  );
  const usdcCurrency = new Token(
    TOKEN_PROGRAM_ID,
    new PublicKey(STANDARD_TOKENS[1].mint),
    STANDARD_TOKENS[1].decimals
  );

  try {
    // console.log("Triggering swap..");

    // const poolInfos = await formatAmmKeysById(solConnection, SOL_USDC_PAIR);
    // const poolKeys = jsonInfo2PoolKeys(poolInfos) as LiquidityPoolKeys;
    // if (poolKeys == null) {
    //   onFailed("Failed to fetch pool info");
    //   return;
    // }

    // console.log("simulating amountOut...");
    // // default slippage
    // const slippage = new Percent(1, 100);

    // const poolInfo = await Liquidity.fetchInfo({
    //   connection: solConnection,
    //   poolKeys,
    // });

    const amountIn = Math.floor(
      inputAmount *
        10 ** (reverse ? usdcCurrency.decimals : solCurrency.decimals)
    );
    // console.log("amountIn", amountIn);
    // const currencyIn = new CurrencyAmount(
    //   reverse
    //     ? new Currency(
    //         usdcCurrency.decimals,
    //         usdcCurrency.symbol,
    //         usdcCurrency.name
    //       )
    //     : SOL,
    //   amountIn
    // );

    // const { minAmountOut } = Liquidity.computeAmountOut({
    //   poolKeys: poolKeys,
    //   poolInfo: poolInfo,
    //   amountIn: currencyIn,
    //   currencyOut: reverse ? solCurrency : usdcCurrency,
    //   slippage: slippage,
    // });

    // console.log("minAmountOut", minAmountOut);

    // const walletTokenAccounts = await getWalletTokenAccount(
    //   solConnection,
    //   wallet.publicKey
    // );

    // console.log("Building swap transaction..");
    // // -------- step 2: create instructions by SDK function --------
    // const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
    //   connection: solConnection,
    //   poolKeys,
    //   userKeys: {
    //     tokenAccounts: walletTokenAccounts,
    //     owner: wallet.publicKey,
    //   },
    //   amountIn: currencyIn,
    //   amountOut: minAmountOut,
    //   fixedSide: "in",
    //   makeTxVersion: TxVersion.V0,
    //   computeBudgetConfig: {
    //     microLamports: 12_000,
    //     units: 100_000,
    //   },
    // });

    // const willSendTx = (
    //   await buildSimpleTransaction({
    //     connection: solConnection,
    //     makeTxVersion: TxVersion.V0,
    //     payer: wallet.publicKey,
    //     innerTransactions: innerTransactions,
    //     addLookupTableInfo: LOOKUP_TABLE_CACHE,
    //   })
    // )[0];

    let preIxs: TransactionInstruction[] = [];

    const wSolAccount = getAssociatedTokenAddressSync(
      solCurrency.mint,
      wallet.publicKey!
    );

    const wSolAccountInfo = await solConnection.getAccountInfo(wSolAccount);
    if (!wSolAccountInfo) {
      preIxs.push(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          wSolAccount,
          wallet.publicKey,
          solCurrency.mint
        )
      );
      // }

      // // Wrap input sol
      // if (!reverse) {
      preIxs.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: wSolAccount,
          lamports: amountIn,
        })
      );
      preIxs.push(createSyncNativeInstruction(wSolAccount, TOKEN_PROGRAM_ID));
    }

    const tokenAta = getAssociatedTokenAddressSync(
      usdcCurrency.mint,
      wallet.publicKey!
    );
    const tokenAtaInfo = await solConnection.getAccountInfo(tokenAta);
    if (!tokenAtaInfo) {
      preIxs.push(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          tokenAta,
          wallet.publicKey,
          solCurrency.mint
        )
      );
    }

    if (preIxs.length > 0) {
      const preTx = new Transaction();
      preTx.add(...preIxs);
      preTx.feePayer = wallet.publicKey;
      const latestBlockhash = await solConnection.getLatestBlockhash();
      preTx.recentBlockhash = latestBlockhash.blockhash;

      const txSig = await wallet.sendTransaction(preTx, solConnection);
      console.log(`Wrap sol transaction: ${txSig}`);
      await solConnection.confirmTransaction(txSig);
    }

    const walletSendTx = reverse
      ? await getBuyTx(
          solConnection,
          wallet,
          solCurrency.mint,
          usdcCurrency.mint,
          inputAmount,
          SOL_USDC_PAIR
        )
      : await getSellTx(
          solConnection,
          wallet,
          solCurrency.mint,
          usdcCurrency.mint,
          amountIn.toString(),
          SOL_USDC_PAIR
        );

    console.log("Send and confirm swap transaction..");
    // Sign and send
    if (walletSendTx instanceof VersionedTransaction) {
      wallet.signTransaction(walletSendTx);

      // const latestBlockhash = await solConnection.getLatestBlockhash();
      // const txSig = await execute(walletSendTx, latestBlockhash);
      // const txSig = await wallet.sendTransaction(walletSendTx, solConnection, {
      //   skipPreflight: true,
      // });
      console.log(
        await solConnection.simulateTransaction(walletSendTx, undefined)
      );
      const txSig = await solConnection.sendTransaction(walletSendTx, {
        skipPreflight: true,
      });
      const swapTx = txSig ? `https://solscan.io/tx/${txSig}` : "";
      onSwap(swapTx);
    } else {
      onFailed("Swap failed");
    }
  } catch (error) {
    console.error("Failed to simulate swap", error);
    onFailed(JSON.stringify(error));
  }
};

export default swap;
