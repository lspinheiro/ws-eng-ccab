import { expect } from "chai";
import { performance } from "perf_hooks";
import supertest from "supertest";
import { buildApp } from "./app";
import { doesNotMatch } from "assert";

const app = buildApp();
const request = supertest(app);

/*
From manual tests. The average latency was around 65ms
*/
describe("Basic Latency Tests", function () {

    beforeEach(async function () {
        await request.post("/reset").expect(204);
    });

    it("should measure average latency for multiple charge requests", async function () {
        const numRequests = 5;
        let totalLatency = 0;

        for (let i = 0; i < numRequests; i++) {
            const start = Date.now();
            await request.post("/charge").send({ charges: 10 }).expect(200);
            totalLatency += Date.now() - start;
        }

        const averageLatency = totalLatency / numRequests;
        console.log(`Average Latency for ${numRequests} requests: ${averageLatency} ms`);
        
        expect(averageLatency).to.be.below(200);
    });
});

describe("Updated Charge Latency Tests", function () {

    beforeEach(async function () {
        await request.post("/reset").expect(204);
    });

    it("should measure average latency for multiple charge requests", async function () {
        const numRequests = 5;
        let totalLatency = 0;

        for (let i = 0; i < numRequests; i++) {
            const start = Date.now();
            await request.post("/charge/v2").send({ charges: 10 }).expect(200);
            totalLatency += Date.now() - start;
        }

        const averageLatency = totalLatency / numRequests;
        console.log(`Average Latency for ${numRequests} requests: ${averageLatency} ms`);
        
        expect(averageLatency).to.be.below(200);
    });
});

describe("Account Management API - Race Conditions", () => {
    const testAccount = "raceAccount";
    const numberOfAttempts = 50; // You can adjust this number as needed

    beforeEach(async () => {
        await request.post("/reset").send({ account: testAccount });
    });

    it("should attempt to reproduce a race condition", async (done) => {
        const chargeAmount = 60; // Assume DEFAULT_BALANCE is 100, so two charges of 60 should not both be authorized

        for (let i = 0; i < numberOfAttempts; i++) {
            // Reset the account balance before each attempt
            await request.post("/reset").send({ account: testAccount });

            // Send two charge requests nearly simultaneously
            const promise1 = request.post("/charge").send({ account: testAccount, charges: chargeAmount });
            const promise2 = request.post("/charge").send({ account: testAccount, charges: chargeAmount });

            const [response1, response2] = await Promise.all([promise1, promise2]);

            // Check if both transactions were authorized, which would be a symptom of a race condition
            if (response1.body.isAuthorized && response2.body.isAuthorized) {
                return done(new Error(`Race condition detected on attempt ${i + 1}: Both transactions were authorized`));
            }
        }
        done();
    });
});

describe("Account Management API - No Race Conditions", () => {
    const testAccount = "raceAccount";
    const numberOfAttempts = 1; // You can adjust this number as needed

    it("should attempt to reproduce a race condition", (done) => {
        const chargeAmount = 60;

        const attemptCharge = (i: number) => {
            if (i >= numberOfAttempts) {
                return done(); // If all attempts have been made, call done()
            }

            // Reset the account balance before each attempt
            request.post("/reset").send({ account: testAccount }).then(() => {

                // Send two charge requests nearly simultaneously
                const promise1 = request.post("/charge/v2").send({ account: testAccount, charges: chargeAmount });
                const promise2 = request.post("/charge/v2").send({ account: testAccount, charges: chargeAmount });

                return Promise.all([promise1, promise2]);

            }).then(([response1, response2]) => {

                // Check if both transactions were authorized, which would be a symptom of a race condition
                if (response1.body.isAuthorized && response2.body.isAuthorized) {
                    done(new Error(`Race condition detected on attempt ${i + 1}: Both transactions were authorized`));
                } else {
                    attemptCharge(i + 1);
                }

            }).catch((err) => {
                done(err);
            });
        };

        attemptCharge(0); // Start the first attempt
    });
});


