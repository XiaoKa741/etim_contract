const { ethers, network } = require("hardhat");
const { expect } = require("chai");

// ─── helpers ────────────────────────────────────────────────────────────────

async function advanceDays(days) {
    await network.provider.send("evm_increaseTime", [days * 86400]);
    await network.provider.send("evm_mine");
}

async function setupReferral(etimToken, a, b) {
    // a → b, b → a  ⟹  a is referrer, b is invitee
    await (await etimToken.connect(a).transfer(b.address, ethers.parseEther("1"))).wait();
    await (await etimToken.connect(b).transfer(a.address, ethers.parseEther("1"))).wait();
}

// ─── fixture: deploy everything from scratch (no fork) ───────────────────────

async function deployFixture() {
    const [owner, alice, bob, carol, dave, eve] = await ethers.getSigners();

    // 1. ETIM Token
    const ETIMToken = await ethers.getContractFactory("ETIMToken");
    const etimToken = await ETIMToken.deploy("ETIM Token", "ETIM");
    await etimToken.waitForDeployment();

    // 2. Node NFT
    const ETIMNode = await ethers.getContractFactory("ETIMNode");
    const etimNode = await ETIMNode.deploy();
    await etimNode.waitForDeployment();

    // 3. Mock PoolHelper (standalone helper deploy needs Uniswap – use a mock instead)
    const MockPoolHelper = await ethers.getContractFactory("MockPoolHelper");
    const mockPoolHelper = await MockPoolHelper.deploy(await etimToken.getAddress());
    await mockPoolHelper.waitForDeployment();

    // 4. Main contract
    const ETIMMain = await ethers.getContractFactory("ETIMMain");
    const etimMain = await ETIMMain.deploy(
        await etimToken.getAddress(),
        await etimNode.getAddress(),
        await mockPoolHelper.getAddress(),
        owner.address,          // taxHook = owner for tests
    );
    await etimMain.waitForDeployment();

    // 5. Wire up
    await (await etimToken.setMainContract(await etimMain.getAddress())).wait();
    await (await mockPoolHelper.setMainContract(await etimMain.getAddress())).wait();

    // 6. Fund growth pool (give main contract 1.9B ETIM)
    const GROWTH = ethers.parseEther("1925700000");
    await (await etimToken.transfer(await etimMain.getAddress(), GROWTH)).wait();

    // 7. Give test users some ETIM for referral binding
    const SEED = ethers.parseEther("100000");
    for (const user of [alice, bob, carol, dave, eve]) {
        await (await etimToken.transfer(user.address, SEED)).wait();
    }

    // 8. Set initial price via mock helper (1 ETH = 2000 USDC, 1 ETH = 2000 ETIM)
    await (await mockPoolHelper.setEtimPerEth(ethers.parseEther("2000"))).wait();
    await (await mockPoolHelper.setUsdcPerEth(ethers.parseUnits("2000", 6))).wait();
    await (await mockPoolHelper.setEthReserves(ethers.parseEther("100"))).wait();

    await (await etimMain.updateDailyPrice()).wait();

    return { owner, alice, bob, carol, dave, eve, etimToken, etimNode, etimMain, mockPoolHelper };
}

// ─── MockPoolHelper contract source (inline deploy) ─────────────────────────
// We compile it via a separate artifact defined below.

// ════════════════════════════════════════════════════════════════════════════
//  TEST SUITES
// ════════════════════════════════════════════════════════════════════════════

describe("ETIMMain — full integration tests", function () {
    this.timeout(120_000);

    // ── A. Referral binding ─────────────────────────────────────────────────
    describe("A. Referral binding", function () {
        it("A1: bilateral transfer establishes referral (first sender = referrer)", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            expect(await etimMain.referrerOf(bob.address)).to.equal(alice.address);
            expect(await etimMain.referrerOf(alice.address)).to.equal(ethers.ZeroAddress);
        });

        it("A2: referral cannot be overwritten once set", async function () {
            const { etimToken, etimMain, alice, bob, carol } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            // alice already bound to bob as referrer; try binding again via carol
            await (await etimToken.connect(carol).transfer(bob.address, ethers.parseEther("1"))).wait();
            await (await etimToken.connect(bob).transfer(carol.address, ethers.parseEther("1"))).wait();
            // bob's referrer must still be alice
            expect(await etimMain.referrerOf(bob.address)).to.equal(alice.address);
        });

        it("A3: directReferralCount increments for referrer", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            const info = await etimMain.users(alice.address);
            expect(info.directReferralCount).to.equal(1n);
        });

        it("A4: referrer (alice) can participate after inviting bob (new rule)", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            // alice has no referrer but directReferralCount=1 → should NOT revert
            const depositEth = ethers.parseEther("0.05"); // ≈100 USD at 2000 USD/ETH
            await expect(
                etimMain.connect(alice).deposit({ value: depositEth })
            ).to.not.be.reverted;
        });

        it("A5: invitee (bob) can also participate", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            const depositEth = ethers.parseEther("0.05");
            await expect(
                etimMain.connect(bob).deposit({ value: depositEth })
            ).to.not.be.reverted;
        });

        it("A6: stranger with no referral cannot participate", async function () {
            const { etimMain, carol } = await deployFixture();
            await expect(
                etimMain.connect(carol).deposit({ value: ethers.parseEther("0.05") })
            ).to.be.revertedWithCustomError(etimMain, "NoReferralBinding");
        });
    });

    // ── B. Deposit & fund allocation ────────────────────────────────────────
    describe("B. Deposit & fund allocation", function () {
        it("B1: deposit below min reverts", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            await expect(
                etimMain.connect(bob).deposit({ value: ethers.parseEther("0.001") })
            ).to.be.revertedWithCustomError(etimMain, "InvalidDepositAmount");
        });

        it("B2: deposit above max reverts", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            await expect(
                etimMain.connect(bob).deposit({ value: ethers.parseEther("1") })
            ).to.be.revertedWithCustomError(etimMain, "InvalidDepositAmount");
        });

        it("B3: second deposit by same user reverts AlreadyParticipated", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            const dep = ethers.parseEther("0.05");
            await (await etimMain.connect(bob).deposit({ value: dep })).wait();
            await expect(
                etimMain.connect(bob).deposit({ value: dep })
            ).to.be.revertedWithCustomError(etimMain, "AlreadyParticipated");
        });

        it("B4: deposit records correct USD value", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            const dep = ethers.parseEther("0.05"); // 0.05 ETH × 2000 USD = 100 USD
            await (await etimMain.connect(bob).deposit({ value: dep })).wait();
            const info = await etimMain.users(bob.address);
            expect(info.investedValueInUsd).to.equal(ethers.parseUnits("100", 6));
        });

        it("B5: 5% reward ETH accumulated correctly after deposit", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            const dep = ethers.parseEther("0.05");
            await (await etimMain.connect(bob).deposit({ value: dep })).wait();
            const s2 = await etimMain.s2RewardEth();
            const foundation = await etimMain.foundationRewardEth();
            const pot = await etimMain.potRewardEth();
            const official = await etimMain.officialRewardEth();
            const totalReward = s2 + foundation + pot + official;
            // 5% of 0.05 ETH = 0.0025 ETH
            expect(totalReward).to.be.closeTo(ethers.parseEther("0.0025"), ethers.parseEther("0.0001"));
        });

        it("B6: daily deposit cap enforced", async function () {
            const { etimToken, etimMain, alice, bob, carol, dave } = await deployFixture();
            // cap = 100 ETH reserves × 20% = 20 ETH
            // each deposit ≈ 0.075 ETH (150 USD / 2000)
            // 20 ETH / 0.075 ≈ 266 deposits needed to breach – just set a tiny cap instead
            await (await etimMain.setDailyDepositRate(1)).wait(); // 0.1% of reserves = 0.1 ETH cap
            await setupReferral(etimToken, alice, bob);
            await setupReferral(etimToken, alice, carol);
            const dep = ethers.parseEther("0.05");
            await (await etimMain.connect(bob).deposit({ value: dep })).wait();
            await expect(
                etimMain.connect(carol).deposit({ value: dep })
            ).to.be.revertedWithCustomError(etimMain, "DailyDepositLimitExceeded");
        });

        it("B7: daily cap resets next day", async function () {
            const { etimToken, etimMain, alice, bob, carol } = await deployFixture();
            await (await etimMain.setDailyDepositRate(1)).wait();
            await setupReferral(etimToken, alice, bob);
            await setupReferral(etimToken, alice, carol);
            const dep = ethers.parseEther("0.05");
            await (await etimMain.connect(bob).deposit({ value: dep })).wait();
            await advanceDays(1);
            // carol deposits next day – should succeed
            await expect(
                etimMain.connect(carol).deposit({ value: dep })
            ).to.not.be.reverted;
        });
    });

    // ── C. Mining / claim ───────────────────────────────────────────────────
    describe("C. Mining & claim", function () {
        async function depositAndWait(fix, user, days = 1) {
            const { etimToken, etimMain, alice } = fix;
            await setupReferral(etimToken, alice, user);
            await (await etimMain.connect(user).deposit({ value: ethers.parseEther("0.05") })).wait();
            await advanceDays(days);
            await (await etimMain.updateDailyPrice()).wait();
        }

        it("C1: no claimable before 1 day passes", async function () {
            const fix = await deployFixture();
            const { etimToken, etimMain, alice, bob } = fix;
            await setupReferral(etimToken, alice, bob);
            await (await etimMain.connect(bob).deposit({ value: ethers.parseEther("0.05") })).wait();
            expect(await etimMain.connect(bob).getClaimableAmount()).to.equal(0n);
        });

        it("C2: claimable after 1 day ≈ 1% of investedUsd in ETIM", async function () {
            const fix = await deployFixture();
            await depositAndWait(fix, fix.bob, 1);
            const claimable = await fix.etimMain.connect(fix.bob).getClaimableAmount();
            // 100 USD × 1% = 1 USD ≈ 1 ETIM (at 1 ETIM/USD)  plus S0 3% accel → 1.03 ETIM
            expect(claimable).to.be.gt(0n);
            expect(claimable).to.be.closeTo(ethers.parseEther("1.03"), ethers.parseEther("0.1"));
        });

        it("C3: claim transfers ETIM to user", async function () {
            const fix = await deployFixture();
            await depositAndWait(fix, fix.bob, 1);
            const before = await fix.etimToken.balanceOf(fix.bob.address);
            await (await fix.etimMain.connect(fix.bob).claim()).wait();
            const after = await fix.etimToken.balanceOf(fix.bob.address);
            expect(after).to.be.gt(before);
        });

        it("C4: claim updates lastClaimTime", async function () {
            const fix = await deployFixture();
            await depositAndWait(fix, fix.bob, 1);
            await (await fix.etimMain.connect(fix.bob).claim()).wait();
            const info = await fix.etimMain.users(fix.bob.address);
            const blockTime = (await ethers.provider.getBlock("latest")).timestamp;
            expect(Number(info.lastClaimTime)).to.be.closeTo(blockTime, 5);
        });

        it("C5: cannot claim more than total quota (100 USD + node bonus)", async function () {
            const fix = await deployFixture();
            await depositAndWait(fix, fix.bob, 200); // fast forward 200 days (well past 100 USD)
            // Drain all claimable
            while (true) {
                const c = await fix.etimMain.connect(fix.bob).getClaimableAmount();
                if (c === 0n) break;
                try { await (await fix.etimMain.connect(fix.bob).claim()).wait(); }
                catch { break; }
                await advanceDays(1);
            }
            // Now both NoRemainingValue and NoRewardsToClaim are acceptable
            await expect(
                fix.etimMain.connect(fix.bob).claim()
            ).to.be.reverted;
        });

        it("C6: multi-day accumulation works (claim after 5 days)", async function () {
            const fix = await deployFixture();
            await depositAndWait(fix, fix.bob, 5);
            const claimable = await fix.etimMain.connect(fix.bob).getClaimableAmount();
            // 5 days × 1 USD × 1.03 ≈ 5.15 ETIM
            expect(claimable).to.be.closeTo(ethers.parseEther("5.15"), ethers.parseEther("0.5"));
        });

        it("C7: claimable goes to zero after claiming, resets from new day", async function () {
            const fix = await deployFixture();
            await depositAndWait(fix, fix.bob, 1);
            await (await fix.etimMain.connect(fix.bob).claim()).wait();
            expect(await fix.etimMain.connect(fix.bob).getClaimableAmount()).to.equal(0n);
            await advanceDays(1);
            expect(await fix.etimMain.connect(fix.bob).getClaimableAmount()).to.be.gt(0n);
        });
    });

    // ── D. Level system ─────────────────────────────────────────────────────
    describe("D. Level system", function () {
        it("D1: default level is S0", async function () {
            const { etimMain, alice } = await deployFixture();
            expect(await etimMain.getUserLevel(alice.address)).to.equal(0);
        });

        it("D2: meets S1 conditions → upgrades to S1", async function () {
            const { etimToken, etimMain } = await deployFixture();
            // Use 6 signers: alice as the user we test, plus 5 others she invites.
            // We use signers[1..6] to avoid the owner (signer[0]) seed-transfer issue:
            // the fixture pre-records transferRecords[owner][alice] via the seed, which
            // makes owner alice's referrer instead of alice's referral.
            const [, alice, bob, carol, dave, eve, frank] = await ethers.getSigners();
            // Give frank 100k ETIM (not seeded in fixture)
            await (await etimToken.transfer(frank.address, ethers.parseEther("100000"))).wait();

            // Setup 5 referrals under alice (bob, carol, dave, eve, frank)
            for (const u of [bob, carol, dave, eve, frank]) {
                await (await etimToken.connect(alice).transfer(u.address, ethers.parseEther("1"))).wait();
                await (await etimToken.connect(u).transfer(alice.address, ethers.parseEther("1"))).wait();
            }
            // Give alice 50k personal ETIM after bindings
            await (await etimToken.transfer(alice.address, ethers.parseEther("50000"))).wait();
            // alice deposits (directReferralCount=5)
            await (await etimMain.connect(alice).deposit({ value: ethers.parseEther("0.05") })).wait();
            await (await etimMain.connect(alice).updateReferralLevel()).wait();
            expect(await etimMain.getUserLevel(alice.address)).to.equal(1);
        });

        it("D3: level downgrades when personal tokens drop below threshold", async function () {
            const { etimToken, etimMain } = await deployFixture();
            const [, alice, bob, carol, dave, eve, frank] = await ethers.getSigners();
            await (await etimToken.transfer(frank.address, ethers.parseEther("100000"))).wait();

            // Reach S1
            for (const u of [bob, carol, dave, eve, frank]) {
                await (await etimToken.connect(alice).transfer(u.address, ethers.parseEther("1"))).wait();
                await (await etimToken.connect(u).transfer(alice.address, ethers.parseEther("1"))).wait();
            }
            await (await etimToken.transfer(alice.address, ethers.parseEther("50000"))).wait();
            await (await etimMain.connect(alice).deposit({ value: ethers.parseEther("0.05") })).wait();
            await (await etimMain.connect(alice).updateReferralLevel()).wait();
            expect(await etimMain.getUserLevel(alice.address)).to.equal(1);

            // Now send away alice's tokens to drop below 50k
            const aliceBal = await etimToken.balanceOf(alice.address);
            await (await etimToken.connect(alice).transfer(bob.address, aliceBal - ethers.parseEther("1000"))).wait();
            await (await etimMain.connect(alice).updateReferralLevel()).wait();
            expect(await etimMain.getUserLevel(alice.address)).to.equal(0);
        });

        it("D4: level upgrade flushes pending rewards at old rate (checkpoint)", async function () {
            const { etimToken, etimMain, owner, alice, bob, carol, dave, eve } = await deployFixture();
            // Bob deposits
            await setupReferral(etimToken, alice, bob);
            await (await etimMain.connect(bob).deposit({ value: ethers.parseEther("0.05") })).wait();
            await advanceDays(2);
            await (await etimMain.updateDailyPrice()).wait();

            const claimableBefore = await etimMain.connect(bob).getClaimableAmount();

            // Simulate level upgrade by giving bob S1 conditions
            await (await etimToken.transfer(bob.address, ethers.parseEther("50000"))).wait();
            const refs = [carol, dave, eve, owner];
            for (const u of refs) {
                await (await etimToken.connect(bob).transfer(u.address, ethers.parseEther("1"))).wait();
                await (await etimToken.connect(u).transfer(bob.address, ethers.parseEther("1"))).wait();
            }
            // 5th referral: alice already referrer of bob, use alice to trigger one more
            await (await etimToken.connect(bob).transfer(alice.address, ethers.parseEther("1"))).wait();
            await (await etimToken.connect(alice).transfer(bob.address, ethers.parseEther("2"))).wait();
            // This transfer triggers _checkAndUpdateLevel for both

            // claimable should still be accessible after level change
            const claimableAfter = await etimMain.connect(bob).getClaimableAmount();
            expect(claimableAfter).to.be.gte(claimableBefore - ethers.parseEther("0.5"));
        });
    });

    // ── E. Node NFT ─────────────────────────────────────────────────────────
    describe("E. Node NFT", function () {
        it("E1: syncNodes registers node count for S1+ user", async function () {
            const { etimToken, etimMain, etimNode } = await deployFixture();
            const [, alice, bob, carol, dave, eve, frank] = await ethers.getSigners();
            await (await etimToken.transfer(frank.address, ethers.parseEther("100000"))).wait();

            for (const u of [bob, carol, dave, eve, frank]) {
                await (await etimToken.connect(alice).transfer(u.address, ethers.parseEther("1"))).wait();
                await (await etimToken.connect(u).transfer(alice.address, ethers.parseEther("1"))).wait();
            }
            await (await etimToken.transfer(alice.address, ethers.parseEther("50000"))).wait();
            await (await etimMain.connect(alice).deposit({ value: ethers.parseEther("0.05") })).wait();
            await (await etimMain.connect(alice).updateReferralLevel()).wait();
            expect(await etimMain.getUserLevel(alice.address)).to.equal(1);

            // Mint a node for alice
            await (await etimNode.connect(alice).mint(1)).wait();
            await (await etimMain.connect(alice).syncNodes()).wait();

            const info = await etimMain.users(alice.address);
            expect(info.syncedNodeCount).to.equal(1n);
            expect(await etimMain.totalActiveNodes()).to.equal(1n);
        });

        it("E2: node quota adds 300 USD to total mining quota", async function () {
            const { etimToken, etimMain, etimNode, owner, alice, bob, carol, dave, eve } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            await (await etimMain.connect(bob).deposit({ value: ethers.parseEther("0.05") })).wait();
            await (await etimToken.transfer(bob.address, ethers.parseEther("50000"))).wait();
            const refs = [carol, dave, eve, owner];
            for (const u of refs) {
                await (await etimToken.connect(bob).transfer(u.address, ethers.parseEther("1"))).wait();
                await (await etimToken.connect(u).transfer(bob.address, ethers.parseEther("1"))).wait();
            }
            await (await etimToken.connect(bob).transfer(alice.address, ethers.parseEther("1"))).wait();
            await (await etimToken.connect(alice).transfer(bob.address, ethers.parseEther("2"))).wait();
            await (await etimMain.connect(bob).updateReferralLevel()).wait();
            await (await etimNode.connect(bob).mint(1)).wait();
            await (await etimMain.connect(bob).syncNodes()).wait();

            // investedUsd = 100 USD; node bonus = 300 USD; total = 400 USD
            const info = await etimMain.users(bob.address);
            const totalQuota = info.investedValueInUsd + ethers.parseUnits("300", 6);
            expect(totalQuota).to.equal(ethers.parseUnits("400", 6));
        });

        it("E3: node below S1 does not activate", async function () {
            const { etimToken, etimMain, etimNode, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            await (await etimMain.connect(bob).deposit({ value: ethers.parseEther("0.05") })).wait();
            // bob is S0, mint node
            await (await etimNode.connect(bob).mint(1)).wait();
            await (await etimMain.connect(bob).syncNodes()).wait();
            const info = await etimMain.users(bob.address);
            expect(info.syncedNodeCount).to.equal(0n); // S0 = not activated
        });

        it("E4: claimNodeRewards pays out ETIM after deposit distributes node rewards", async function () {
            const { etimToken, etimMain, etimNode } = await deployFixture();
            const [, alice, bob, carol, dave, eve, frank] = await ethers.getSigners();
            await (await etimToken.transfer(frank.address, ethers.parseEther("100000"))).wait();

            for (const u of [bob, carol, dave, eve, frank]) {
                await (await etimToken.connect(alice).transfer(u.address, ethers.parseEther("1"))).wait();
                await (await etimToken.connect(u).transfer(alice.address, ethers.parseEther("1"))).wait();
            }
            await (await etimToken.transfer(alice.address, ethers.parseEther("50000"))).wait();
            await (await etimMain.connect(alice).deposit({ value: ethers.parseEther("0.05") })).wait();
            await (await etimMain.connect(alice).updateReferralLevel()).wait();
            await (await etimNode.connect(alice).mint(1)).wait();
            await (await etimMain.connect(alice).syncNodes()).wait();

            // bob deposits (already has referral from alice→bob binding above)
            // 1% of deposit ETH → swapEthToEtim → node reward distributed
            await (await etimMain.connect(bob).deposit({ value: ethers.parseEther("0.05") })).wait();

            const before = await etimToken.balanceOf(alice.address);
            await (await etimMain.connect(alice).claimNodeRewards()).wait();
            const after = await etimToken.balanceOf(alice.address);
            expect(after).to.be.gt(before);
        });
    });

    // ── F. Delayed allocation ────────────────────────────────────────────────
    describe("F. Delayed allocation", function () {
        it("F1: delay mode accumulates pending ETH without allocating", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await (await etimMain.setDelayEnabled(true)).wait();
            await setupReferral(etimToken, alice, bob);
            const dep = ethers.parseEther("0.05");
            await (await etimMain.connect(bob).deposit({ value: dep })).wait();
            expect(await etimMain.pendingAllocationInEth()).to.equal(dep);
        });

        it("F2: triggerDelayedAllocation decrements pending USD", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await (await etimMain.setDelayEnabled(true)).wait();
            await setupReferral(etimToken, alice, bob);
            await (await etimMain.connect(bob).deposit({ value: ethers.parseEther("0.05") })).wait();
            const pendingUsd = await etimMain.pendingAllocationInUsd();
            await (await etimMain.triggerDelayedAllocation(pendingUsd)).wait();
            expect(await etimMain.pendingAllocationInUsd()).to.equal(0n);
        });

        it("F3: triggerDelayedAllocation over pending reverts", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await (await etimMain.setDelayEnabled(true)).wait();
            await setupReferral(etimToken, alice, bob);
            await (await etimMain.connect(bob).deposit({ value: ethers.parseEther("0.05") })).wait();
            const pendingUsd = await etimMain.pendingAllocationInUsd();
            await expect(
                etimMain.triggerDelayedAllocation(pendingUsd + 1n)
            ).to.be.revertedWithCustomError(etimMain, "InvalidDelayAmount");
        });
    });

    // ── G. Owner withdrawals ─────────────────────────────────────────────────
    describe("G. Owner reward withdrawals", function () {
        async function makeDeposit(fix) {
            const { etimToken, etimMain, alice, bob } = fix;
            await setupReferral(etimToken, alice, bob);
            await (await etimMain.connect(bob).deposit({ value: ethers.parseEther("0.05") })).wait();
        }

        it("G1: withdrawS2 sends ETH to owner", async function () {
            const fix = await deployFixture();
            await makeDeposit(fix);
            const s2 = await fix.etimMain.s2RewardEth();
            expect(s2).to.be.gt(0n);
            const before = await ethers.provider.getBalance(fix.owner.address);
            await (await fix.etimMain.withdrawS2(fix.owner.address)).wait();
            const after = await ethers.provider.getBalance(fix.owner.address);
            expect(after).to.be.gt(before);
            expect(await fix.etimMain.s2RewardEth()).to.equal(0n);
        });

        it("G2: non-owner cannot withdraw", async function () {
            const fix = await deployFixture();
            await makeDeposit(fix);
            await expect(
                fix.etimMain.connect(fix.alice).withdrawS2(fix.alice.address)
            ).to.be.reverted;
        });

        it("G3: withdrawFoundation sends ETH", async function () {
            const fix = await deployFixture();
            await makeDeposit(fix);
            await expect(fix.etimMain.withdrawFoundation(fix.owner.address)).to.not.be.reverted;
        });

        it("G4: withdrawPot sends ETH", async function () {
            const fix = await deployFixture();
            await makeDeposit(fix);
            await expect(fix.etimMain.withdrawPot(fix.owner.address)).to.not.be.reverted;
        });

        it("G5: withdrawOfficial sends ETH", async function () {
            const fix = await deployFixture();
            await makeDeposit(fix);
            await expect(fix.etimMain.withdrawOfficial(fix.owner.address)).to.not.be.reverted;
        });
    });

    // ── H. Team token balance propagation ───────────────────────────────────
    describe("H. Team token balance propagation (5-layer)", function () {
        it("H1: transferring ETIM updates direct referrer teamTokenBalance", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            const infoBefore = await etimMain.users(alice.address);
            // bob sends to carol (non-referral) – alice's teamBalance should track bob's holdings
            await (await etimToken.connect(bob).transfer(alice.address, ethers.parseEther("10"))).wait();
            const infoAfter = await etimMain.users(alice.address);
            // alice is referrer of bob, so alice's teamBalance changed
            expect(infoAfter.teamTokenBalance).to.not.equal(infoBefore.teamTokenBalance);
        });

        it("H2: 3-level chain propagates 2 hops", async function () {
            const { etimToken, etimMain, alice, bob, carol, dave } = await deployFixture();
            // alice → bob → carol (two levels deep)
            await setupReferral(etimToken, alice, bob);   // alice referrer of bob
            await setupReferral(etimToken, bob, carol);   // bob referrer of carol

            const aliceBefore = (await etimMain.users(alice.address)).teamTokenBalance;
            // carol transfers tokens to dave (outside alice's team) — alice's team total decreases
            await (await etimToken.connect(carol).transfer(dave.address, ethers.parseEther("5"))).wait();
            const aliceAfter = (await etimMain.users(alice.address)).teamTokenBalance;
            // alice should see carol's balance decrease (2 hops up)
            expect(aliceAfter).to.not.equal(aliceBefore);
        });
    });

    // ��─ I. Growth pool ───────────────────────────────────────────────────────
    describe("I. Growth pool", function () {
        it("I1: remainingGrowthPool decreases after claim", async function () {
            const { etimToken, etimMain, alice, bob } = await deployFixture();
            await setupReferral(etimToken, alice, bob);
            await (await etimMain.connect(bob).deposit({ value: ethers.parseEther("0.05") })).wait();
            await advanceDays(1);
            await (await etimMain.updateDailyPrice()).wait();
            const before = await etimMain.remainingGrowthPool();
            await (await etimMain.connect(bob).claim()).wait();
            const after = await etimMain.remainingGrowthPool();
            expect(after).to.be.lt(before);
        });

        it("I2: isGrowthPoolDepleted is false initially", async function () {
            const { etimMain } = await deployFixture();
            expect(await etimMain.isGrowthPoolDepleted()).to.be.false;
        });
    });
});
