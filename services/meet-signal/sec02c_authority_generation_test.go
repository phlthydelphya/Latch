package main

import (
	"errors"
	"sync"
	"testing"
	"time"
)

// sec02cMintHostToken mints a host token with an explicit room instance and
// generation so tests can exercise stale/foreign bindings.
func sec02cMintHostToken(t *testing.T, subject, roomID, roomInstanceID string, generation uint64) string {
	t.Helper()
	token, err := mintHostToken(subject, roomID, roomInstanceID, generation, 5*time.Minute)
	if err != nil {
		t.Fatalf("fixture host token mint failed: %v", err)
	}
	return token
}

func TestSEC02CAuthorityGenerationLifecycle(t *testing.T) {
	am := newAuthorityManager()
	roomID := "sec02c-gen-lifecycle"

	auth, err := am.createRoom(roomID, "p-host")
	if err != nil || auth.AuthorityGeneration != 1 || auth.HostID != "p-host" {
		t.Fatalf("createRoom did not initialize generation=1: %+v (err=%v)", auth, err)
	}

	// transfer advances generation
	if err := am.transferHost(roomID, "p-host", "p-target", 1); err != nil {
		t.Fatalf("transfer failed: %v", err)
	}
	afterTransfer, _ := am.getAuthority(roomID)
	if afterTransfer.AuthorityGeneration != 2 || afterTransfer.HostID != "p-target" {
		t.Errorf("transfer did not advance generation: %+v", afterTransfer)
	}

	// revocation advances generation and clears host
	am.revokeAuthority(roomID)
	afterRevoke, _ := am.getAuthority(roomID)
	if afterRevoke.HostID != "" || afterRevoke.AuthorityGeneration != 3 {
		t.Errorf("revocation did not advance generation and clear host: %+v", afterRevoke)
	}

	// generation never decreases
	if afterRevoke.AuthorityGeneration < afterTransfer.AuthorityGeneration {
		t.Error("authority generation decreased")
	}
}

func TestSEC02CHostTokenGenerationBinding(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			roomID := "sec02c-gen-binding"
			before := sec02aRoom(t, roomID, "p-host")
			hostAccess := sec02aAccessToken(t, "p-host", roomID, liveKit)
			hostSession := sec02bIssueSession(t, "p-host", before.RoomInstanceID, "host")
			sec02bIssueSession(t, "p-target", before.RoomInstanceID, "participant")

			staleGen := sec02cMintHostToken(t, "p-host", roomID, before.RoomInstanceID, 99)
			wrongInst := sec02cMintHostToken(t, "p-host", roomID, "inst-other", 1)
			genZero := sec02cMintHostToken(t, "p-host", roomID, before.RoomInstanceID, 0)

			err := transferHostIdentity(authManager, sessionManager, roomID, hostAccess, hostSession, staleGen, "p-target")
			sec02bAssertError(t, err, errIdentityMismatch)

			err = transferHostIdentity(authManager, sessionManager, roomID, hostAccess, hostSession, wrongInst, "p-target")
			sec02bAssertError(t, err, errIdentityMismatch)

			err = transferHostIdentity(authManager, sessionManager, roomID, hostAccess, hostSession, genZero, "p-target")
			sec02bAssertError(t, err, errIdentityMismatch)

			// Correct current-generation + instance binding succeeds.
			good := sec02aHostToken(t, "p-host", roomID)
			if err := transferHostIdentity(authManager, sessionManager, roomID, hostAccess, hostSession, good, "p-target"); err != nil {
				t.Fatalf("valid generation-bound transfer failed: %v", err)
			}
		})
	}
}

func TestSEC02CStaleGenerationCASRejected(t *testing.T) {
	am := newAuthorityManager()
	roomID := "sec02c-stale-cas"
	am.createRoom(roomID, "p-host")

	// Simulate an out-of-band generation advance while the host stays put.
	am.mu.Lock()
	am.rooms[roomID].AuthorityGeneration++
	am.mu.Unlock()

	err := am.transferHost(roomID, "p-host", "p-target", 1)
	if !errors.Is(err, errGenerationConflict) {
		t.Errorf("stale expectedGeneration returned %v; want errGenerationConflict", err)
	}
}

func TestSEC02CAB_AReplayImpossible(t *testing.T) {
	if hostPrivateKey == nil {
		initHostSigning()
	}
	am := newAuthorityManager()
	roomID := "sec02c-aba"
	before, _ := am.createRoom(roomID, "p-alice")

	aGen1 := sec02cMintHostToken(t, "p-alice", roomID, before.RoomInstanceID, 1)

	if err := am.transferHost(roomID, "p-alice", "p-bob", 1); err != nil {
		t.Fatalf("A→B failed: %v", err)
	}
	if err := am.transferHost(roomID, "p-bob", "p-alice", 2); err != nil {
		t.Fatalf("B→A failed: %v", err)
	}
	auth, _ := am.getAuthority(roomID)
	if auth.HostID != "p-alice" || auth.AuthorityGeneration != 3 {
		t.Fatalf("expected alice@gen3, got %+v", auth)
	}

	claims, err := validateHostToken(aGen1)
	if err != nil {
		t.Fatalf("A gen-1 token should still validate cryptographically: %v", err)
	}
	if claims.Generation == auth.AuthorityGeneration {
		t.Error("A's gen-1 token still matches the current generation")
	}
	if err := am.transferHost(roomID, "p-alice", "p-bob", claims.Generation); !errors.Is(err, errGenerationConflict) {
		t.Errorf("A gen-1 replay returned %v; want errGenerationConflict", err)
	}
}

func TestSEC02CResumeHandleOneUseAndStale(t *testing.T) {
	rh := newResumeHandleStore()
	handle, err := rh.issue("p-host", "inst-1", 1, 1, 5*time.Minute)
	if err != nil {
		t.Fatalf("resume handle issue failed: %v", err)
	}

	if !rh.consume(handle, "p-host", "inst-1", 1) {
		t.Fatal("first consume should succeed")
	}
	if rh.consume(handle, "p-host", "inst-1", 1) {
		t.Error("duplicate consume should fail")
	}
	if rh.consume(handle, "p-host", "inst-1", 2) {
		t.Error("wrong generation consume should fail")
	}
	if rh.consume(handle, "p-other", "inst-1", 1) {
		t.Error("wrong participant consume should fail")
	}
	if rh.consume(handle, "p-host", "inst-other", 1) {
		t.Error("wrong room instance consume should fail")
	}
}

func TestSEC02CConcurrentTransferOneWinner(t *testing.T) {
	am := newAuthorityManager()
	roomID := "sec02c-conc-transfer"
	am.createRoom(roomID, "p-host")

	var wg sync.WaitGroup
	results := make([]error, 2)
	targets := []string{"p-target-b", "p-target-c"}
	for i, target := range targets {
		wg.Add(1)
		go func(i int, target string) {
			defer wg.Done()
			results[i] = am.transferHost(roomID, "p-host", target, 1)
		}(i, target)
	}
	wg.Wait()

	successes := 0
	for _, err := range results {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Errorf("exactly one transfer should commit, got %d successes", successes)
	}
	auth, _ := am.getAuthority(roomID)
	if auth.AuthorityGeneration != 2 {
		t.Errorf("generation advanced to %d; want 2 (single transition)", auth.AuthorityGeneration)
	}
}

func TestSEC02CConcurrentResumeOneWinner(t *testing.T) {
	rh := newResumeHandleStore()
	handle, err := rh.issue("p-host", "inst-1", 1, 1, 5*time.Minute)
	if err != nil {
		t.Fatalf("resume handle issue failed: %v", err)
	}

	var wg sync.WaitGroup
	results := make([]bool, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = rh.consume(handle, "p-host", "inst-1", 1)
		}(i)
	}
	wg.Wait()

	successes := 0
	for _, ok := range results {
		if ok {
			successes++
		}
	}
	if successes != 1 {
		t.Errorf("exactly one resume handle consumption should succeed, got %d", successes)
	}
}

func TestSEC02CResumeAfterTransferRejected(t *testing.T) {
	am := newAuthorityManager()
	rh := newResumeHandleStore()
	roomID := "sec02c-resume-xfer"
	before, _ := am.createRoom(roomID, "p-host")

	handle, _ := rh.issue("p-host", before.RoomInstanceID, 1, 1, 5*time.Minute)

	// Transfer host away; the old host's resume handle becomes stale.
	if err := am.transferHost(roomID, "p-host", "p-target", 1); err != nil {
		t.Fatalf("transfer failed: %v", err)
	}
	if _, ok := am.consumeResumeHandle(roomID, "p-host", rh, handle); ok {
		t.Error("old host's resume handle consumed after authority moved away")
	}
}

func TestSEC02CGraceExpiryAdvancesGeneration(t *testing.T) {
	am := newAuthorityManager()
	roomID := "sec02c-grace"
	am.createRoom(roomID, "p-host")

	am.startHostGrace(roomID, "p-host", 10*time.Millisecond, nil)

	deadline := time.Now().Add(2 * time.Second)
	for {
		auth, _ := am.getAuthority(roomID)
		if auth.HostID == "" {
			if auth.AuthorityGeneration != 2 {
				t.Errorf("grace expiry did not advance generation: got %d", auth.AuthorityGeneration)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("grace expiry did not complete within timeout")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestSEC02CSigningFailureDoesNotCorruptAuthority(t *testing.T) {
	sec02aConfigure(t, false)
	roomID := "sec02c-sign-fail"
	before := sec02aRoom(t, roomID, "p-host")
	hostAccess := sec02aAccessToken(t, "p-host", roomID, false)
	hostProof := sec02aHostToken(t, "p-host", roomID)
	hostSession := sec02bIssueSession(t, "p-host", before.RoomInstanceID, "host")
	sec02bIssueSession(t, "p-target", before.RoomInstanceID, "participant")

	if err := transferHostIdentity(authManager, sessionManager, roomID, hostAccess, hostSession, hostProof, "p-target"); err != nil {
		t.Fatalf("transfer commit failed: %v", err)
	}
	beforeMint, _ := authManager.getAuthority(roomID)
	if beforeMint.HostID != "p-target" || beforeMint.AuthorityGeneration != 2 {
		t.Fatalf("authority not consistent after commit: %+v", beforeMint)
	}

	savedKey := hostPrivateKey
	hostPrivateKey = nil
	_, mintErr := mintHostToken("p-target", roomID, beforeMint.RoomInstanceID, beforeMint.AuthorityGeneration, 5*time.Minute)
	hostPrivateKey = savedKey
	if mintErr == nil {
		t.Fatal("expected mint failure with nil signing key")
	}

	afterMint, _ := authManager.getAuthority(roomID)
	if afterMint.HostID != beforeMint.HostID || afterMint.AuthorityGeneration != beforeMint.AuthorityGeneration {
		t.Errorf("mint failure corrupted authority: before=%+v after=%+v", beforeMint, afterMint)
	}
}

func TestSEC02CRoomRecreationFreshInstance(t *testing.T) {
	am := newAuthorityManager()
	roomID := "sec02c-recreate"

	first, err := am.createRoom(roomID, "p-host")
	if err != nil {
		t.Fatalf("first createRoom failed: %v", err)
	}
	am.revokeAuthority(roomID)

	second, err := am.createRoom(roomID, "p-new-host")
	if err != nil {
		t.Fatalf("recreateRoom failed after revocation: %v", err)
	}
	if second.RoomInstanceID == first.RoomInstanceID {
		t.Error("room recreation reused the previous room instance")
	}
	if second.AuthorityGeneration != 1 {
		t.Errorf("room recreation did not reset generation: got %d", second.AuthorityGeneration)
	}
}

func TestSEC02CRestartInvalidation(t *testing.T) {
	sec02aConfigure(t, false)
	roomID := "sec02c-restart"
	sec02aRoom(t, roomID, "p-host")
	oldToken := sec02aHostToken(t, "p-host", roomID)

	// Regenerating the signing key simulates process restart; prior host tokens
	// must fail signature validation.
	initHostSigning()
	if _, err := validateHostToken(oldToken); err == nil {
		t.Error("pre-restart host token remained valid after key regeneration")
	}
}