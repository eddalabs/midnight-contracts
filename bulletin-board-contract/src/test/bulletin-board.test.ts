import { BulletinBoardSimulator, logger } from "./simulators/simulator.js";
import { describe, it, expect } from "vitest";
import * as utils from "./utils/utils";

// Users' secret keys (32 bytes each)
const secretKey1 = utils.randomBytes(32);
const secretKey2 = utils.randomBytes(32);

// User identifiers for the simulator
export const user1 = utils.toHexPadded("user1");
export const user2 = utils.toHexPadded("user2");

function createSimulator() {
  const simulator = BulletinBoardSimulator.deployContract(secretKey1);
  simulator.createPrivateState("user2", secretKey2);
  return simulator;
}

describe("Bulletin Board smart contract", () => {
  it("should have empty board initially", () => {
    const simulator = createSimulator();
    const ledger = simulator.as("user1").getLedger();

    expect(ledger.hasNote).toEqual(false);

    logger.info({
      section: "Initial State",
      hasNote: ledger.hasNote,
      note: ledger.note,
    });
  });

  it("should allow a user to post a note anonymously", () => {
    const simulator = createSimulator();
    const noteContent = "Hello from an anonymous user!";

    // User1 posts a note
    const ledger = simulator.as("user1").postNote(noteContent);

    expect(ledger.hasNote).toEqual(true);
    expect(ledger.note).toEqual(noteContent);

    logger.info({
      section: "After Post",
      hasNote: ledger.hasNote,
      note: ledger.note,
      authorCommitment: ledger.authorCommitment,
    });
  });

  it("should prevent another user from posting when board is full", () => {
    const simulator = createSimulator();

    // User1 posts a note
    simulator.as("user1").postNote("First note!");

    // User2 tries to post - should fail
    expect(() => {
      simulator.as("user2").postNote("Second note!");
    }).toThrow("Board is full - someone already posted a note");
  });

  it("should prevent non-author from taking down the note", () => {
    const simulator = createSimulator();

    // User1 posts a note
    simulator.as("user1").postNote("My private note");

    // User2 tries to take it down - should fail
    expect(() => {
      simulator.as("user2").takeDown();
    }).toThrow("Only the original author can take down the note");
  });

  it("should allow the original author to take down their note", () => {
    const simulator = createSimulator();

    // User1 posts a note
    simulator.as("user1").postNote("My note to remove");
    let ledger = simulator.as("user1").getLedger();
    expect(ledger.hasNote).toEqual(true);

    // User1 takes it down
    ledger = simulator.as("user1").takeDown();
    expect(ledger.hasNote).toEqual(false);

    logger.info({
      section: "After Takedown",
      hasNote: ledger.hasNote,
    });
  });

  it("should allow a new user to post after original note is taken down", () => {
    const simulator = createSimulator();

    // User1 posts a note
    simulator.as("user1").postNote("First note");
    expect(simulator.getLedger().hasNote).toEqual(true);

    // User1 takes it down
    simulator.as("user1").takeDown();
    expect(simulator.getLedger().hasNote).toEqual(false);

    // Now user2 can post
    const ledger = simulator.as("user2").postNote("New note from user2!");
    expect(ledger.hasNote).toEqual(true);
    expect(ledger.note).toEqual("New note from user2!");

    logger.info({
      section: "After User2 Post",
      hasNote: ledger.hasNote,
      note: ledger.note,
      authorCommitment: ledger.authorCommitment,
    });
  });

  it("should prevent taking down when no note exists", () => {
    const simulator = createSimulator();

    // Try to take down when no note exists
    expect(() => {
      simulator.as("user1").takeDown();
    }).toThrow("No note to take down");
  });

  it("should preserve author privacy across multiple post/takedown cycles", () => {
    const simulator = createSimulator();

    // User1 posts
    let ledger = simulator.as("user1").postNote("Note 1");
    const commitment1 = ledger.authorCommitment;

    // User1 takes down
    simulator.as("user1").takeDown();

    // User1 posts again - same commitment
    ledger = simulator.as("user1").postNote("Note 2");
    const commitment2 = ledger.authorCommitment;

    // Same user should have same commitment (proves it's the same author without revealing identity)
    expect(commitment1).toEqual(commitment2);

    // Take down
    simulator.as("user1").takeDown();

    // User2 posts - different commitment
    ledger = simulator.as("user2").postNote("Note 3");
    const commitment3 = ledger.authorCommitment;

    // Different user should have different commitment
    expect(commitment1).not.toEqual(commitment3);

    logger.info({
      section: "Privacy Test",
      user1Commitment: commitment1,
      user2Commitment: commitment3,
      commitmentsMatch: commitment1 === commitment3,
    });
  });
});
