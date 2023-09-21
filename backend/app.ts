import express from "express";
import { createClient, RedisClientType, WatchError} from "redis";
import { json } from "body-parser";

const DEFAULT_BALANCE = 100;

enum Status {
    Success,
    InsufficientBalance,
    TransactionError,
  }

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
    status: Status,
}

async function connect(): Promise<ReturnType<typeof createClient>> {
    const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
    console.log(`Using redis URL ${url}`);
    const client = createClient({ url });
    await client.connect();
    return client;
}




async function reset(account: string): Promise<void> {
    const client = await connect();
    await client.set(`${account}/balance`, DEFAULT_BALANCE);
    try {
        await client.set(`${account}/balance`, DEFAULT_BALANCE);
    } finally {
        await client.disconnect();
    }
}

async function originalCharge(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    try {
        const balance = parseInt((await client.get(`${account}/balance`)) ?? "");
        if (balance >= charges) {
            await client.set(`${account}/balance`, balance - charges);
            const remainingBalance = parseInt((await client.get(`${account}/balance`)) ?? "");
            return { isAuthorized: true, remainingBalance, charges, status: Status.Success };
        } else {
            return { isAuthorized: false, remainingBalance: balance, charges: 0, status: Status.InsufficientBalance };
        }
    } finally {
        await client.disconnect();
    }
}

async function tryToCharge(account: string, charges: number, client: ReturnType<typeof createClient>): Promise<ChargeResult>{
    const key = `${account}/balance`;
    // Start watching the key
    await client.watch(key);
    
    // Get the current balance
    const balance = parseInt((await client.get(key)) ?? "0");
    if (balance >= charges) {

        const multi = client.multi();
        // Queue up the set command to reduce the balance
        multi.set(key, balance - charges);

        let results;
        
        // Execute the transaction
        try {
            results = await multi.exec();
        } catch(error){
            results = null;
        }
        

        if (results === null) {
            return { isAuthorized: false, remainingBalance: balance, charges: 0, status: Status.TransactionError };
        }

        return { isAuthorized: true, remainingBalance: balance - charges, charges, status: Status.Success };
    } else {
        return { isAuthorized: false, remainingBalance: balance, charges: 0, status: Status.InsufficientBalance };
    }
}
async function transactionCharge(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    
    try {
        const chargeResult = await tryToCharge(account, charges, client);
        // If successful, return the result
        return chargeResult;

    } finally {
        client.disconnect();
    }
}


export function buildApp(): express.Application {
    const app = express();
    app.use(json());
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await originalCharge(account, req.body.charges ?? 10);
            console.log(`Successfully charged account ${account}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/charge/v2", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await transactionCharge(account, req.body.charges ?? 10);
            if (result.status === Status.Success) {
                console.log(`Successfully charged account ${account}. Remaining balance ${result.remainingBalance}`);
            } else if (result.status === Status.InsufficientBalance) {
                console.log(`Insufficient balance on account ${account}. Remaining balance ${result.remainingBalance}`)
            } else {
                console.log(`Transaction error while trying to charge.`)
            }
            
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    return app;
}
